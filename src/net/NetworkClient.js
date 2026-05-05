/**
 * Client networking layer for server-authoritative multiplayer.
 * Sends inputs to server, receives authoritative snapshots.
 * Supports client-side prediction with server reconciliation.
 */
import PartySocket from 'partysocket';
import { getClientPreferredDisplayName } from '../utils/playerDisplayName.js';

const PARTYKIT_HOST =
  import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';

/** Max pending inputs to keep for reconciliation */
const MAX_PENDING = 120;
const PLAYER_KEY_STORAGE = 'mouseTrouble.playerKey.v1';
const PLAYER_KEY_PATTERN = /^[a-f0-9]{64}$/;

async function parseLeaderboardResponse(response) {
  if (!response?.ok) return null;
  const contentType = response.headers?.get?.('Content-Type') ?? '';
  if (!contentType.includes('application/json')) return null;
  const data = await response.json();
  return data?.leaderboards ? data : null;
}

function createPlayerKey() {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getOrCreatePlayerKey() {
  try {
    const existing = localStorage.getItem(PLAYER_KEY_STORAGE);
    if (PLAYER_KEY_PATTERN.test(existing ?? '')) return existing;
    const created = createPlayerKey();
    localStorage.setItem(PLAYER_KEY_STORAGE, created);
    return created;
  } catch {
    return createPlayerKey();
  }
}

export class NetworkClient {
  /** @type {PartySocket | null} */
  ws = null;
  localId = null;
  connected = false;

  /** @type {Map<string, object>} */
  remotePlayers = new Map();

  /** @type {Map<string, object>} predator snapshots keyed by id */
  remotePredators = new Map();

  /** Authoritative pushable balls (cannon-es on server); empty until init/snapshot */
  pushBalls = [];

  /** Authoritative rideable mounts; empty until init/snapshot */
  mounts = [];

  /** Authoritative rope segment positions (server-authoritative); empty until init/snapshot */
  ropes = [];

  /** Authoritative ceiling fan runtime state; empty until init/snapshot */
  fans = [];

  /** Physical task progress snapshots keyed by task id on the client */
  physicalTasks = [];

  completedTaskIds = [];
  completedTaskRevision = 0;

  dronePurchase = { ok: false, pending: false, message: '' };

  /** @type {{ id: string, x: number, y: number, z: number, amount: number }[]} */
  cheesePickups = [];

  /** Raid round state from server snapshots */
  round = null;

  /** Active extraction portal markers when `round.phase === 'extract'` */
  extractionPortals = [];

  /** Single playable adversary slot state from the server. */
  adversary = { playerId: null, available: false, safeRadius: 0 };

  /** Sequence counter for inputs */
  seq = 0;
  /** Pending inputs not yet confirmed by server (for reconciliation) */
  pendingInputs = [];

  /** Latest server-confirmed state for the local player */
  serverState = null;
  /** Latest server seq ack for the local player */
  serverSeq = -1;

  /** RTT in ms (smoothed) */
  ping = 0;
  /** Stable anonymous browser/install id used for aggregate server stats. */
  playerKey = getOrCreatePlayerKey();
  /** Maps seq -> send timestamp for RTT measurement */
  _sendTimes = new Map();

  /** @type {((event: {type: string, [k:string]: any}) => void)[]} */
  listeners = [];

  constructor(roomId = 'default', { portalArrival = null } = {}) {
    this.roomId = roomId;
    this.portalArrival = portalArrival;
  }

  connect() {
    this.ws = new PartySocket({
      host: PARTYKIT_HOST,
      room: this.roomId,
      party: 'main',
    });

    this.ws.addEventListener('message', (e) => {
      this._handleMessage(JSON.parse(e.data));
    });

    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.ws?.send(JSON.stringify({
        type: 'hello',
        playerKey: this.playerKey,
        displayName: getClientPreferredDisplayName(),
        portal: this.portalArrival ?? undefined,
      }));
      console.log('[net] connected to room:', this.roomId);
      for (const fn of this.listeners) fn({ type: 'open' });
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.localId = null;
      this.remotePredators.clear();
      this.pushBalls = [];
      this.mounts = [];
      this.fans = [];
      this.cheesePickups = [];
      this.physicalTasks = [];
      this.completedTaskIds = [];
      this.completedTaskRevision += 1;
      this.dronePurchase = { ok: false, pending: false, message: '' };
      this.round = null;
      this.extractionPortals = [];
      this.adversary = { playerId: null, available: false, safeRadius: 0 };
      console.log('[net] disconnected');
      for (const fn of this.listeners) fn({ type: 'close' });
    });
  }

  /**
   * Send an input to the server and store it for reconciliation.
   * @param {{
   *   moveX: number,
   *   moveZ: number,
   *   sprint: boolean,
   *   jump?: boolean,
   *   jumpPressed?: boolean,
   *   jumpHeld?: boolean,
   *   crouch: boolean,
   *   rotation: number,
   * }} input
   * @returns {number} seq number of this input
   */
  sendInput(input) {
    const seq = this.seq++;
    const msg = { type: 'input', ...input, seq };

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }

    this._sendTimes.set(seq, performance.now());
    // Prune old entries
    if (this._sendTimes.size > 150) {
      const oldest = this._sendTimes.keys().next().value;
      this._sendTimes.delete(oldest);
    }

    this.pendingInputs.push({ ...input, seq });
    if (this.pendingInputs.length > MAX_PENDING) {
      this.pendingInputs.shift();
    }

    return seq;
  }

  sendSpawnExtraBall() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'spawn-extra-ball' }));
    }
  }

  sendTaskComplete({ taskId, taskType, position, amount }) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'task-complete',
      taskId,
      taskType,
      position,
      amount,
    }));
  }

  sendSqueak() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'squeak' }));
  }

  sendUnlockPickup(itemId) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'unlock-pickup', itemId }));
  }

  sendClaimHero({ heroKey, taskId }) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'claim-hero',
      heroKey,
      taskId,
    }));
  }

  sendDronePurchase() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.dronePurchase = { ok: false, pending: true, message: 'Buying drone...' };
    this.ws.send(JSON.stringify({ type: 'purchase-drone' }));
  }

  sendDisplayName(displayName) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'hello',
        playerKey: this.playerKey,
        displayName,
      }));
    }
  }

  sendDevSyncLayout(layout, syncToken) {
    if (!syncToken || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({
      type: 'dev-sync-layout',
      syncToken,
      layout,
    }));
    return true;
  }

  async fetchLeaderboard() {
    try {
      const sameOrigin = await parseLeaderboardResponse(await fetch('/api/leaderboard', {
        headers: { Accept: 'application/json' },
      }));
      if (sameOrigin) return sameOrigin;
    } catch {}

    try {
      const response = await PartySocket.fetch({
        host: PARTYKIT_HOST,
        room: this.roomId,
        party: 'main',
        path: 'leaderboard',
      }, {
        headers: { Accept: 'application/json' },
      });
      return await parseLeaderboardResponse(response);
    } catch {
      return null;
    }
  }

  _applyPushBallsPayload(data) {
    if (Array.isArray(data.pushBalls)) {
      this.pushBalls = data.pushBalls;
    } else if (data.pushBall) {
      this.pushBalls = [data.pushBall];
    }
  }

  _applyMountsPayload(data) {
    if (Array.isArray(data.mounts)) {
      this.mounts = data.mounts;
    }
  }

  _applyRopesPayload(data) {
    if (Array.isArray(data.ropes)) {
      this.ropes = data.ropes;
    }
  }

  _applyFansPayload(data) {
    if (Array.isArray(data.fans)) {
      this.fans = data.fans;
    }
  }

  _applyPhysicalTasksPayload(data) {
    if (Array.isArray(data.physicalTasks)) {
      this.physicalTasks = data.physicalTasks;
    }
    if (Array.isArray(data.completedTaskIds)) {
      this._setCompletedTaskIds(data.completedTaskIds);
    }
  }

  _setCompletedTaskIds(ids) {
    const next = ids.filter((id) => typeof id === 'string');
    if (
      next.length === this.completedTaskIds.length
      && next.every((id, index) => id === this.completedTaskIds[index])
    ) {
      return;
    }
    this.completedTaskIds = next;
    this.completedTaskRevision += 1;
  }

  _applyCheesePayload(data) {
    if (Array.isArray(data.cheesePickups)) {
      this.cheesePickups = data.cheesePickups;
    }
  }

  on(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  _handleMessage(data) {
    switch (data.type) {
      case 'init':
        this.localId = data.id;
        for (const [id, player] of Object.entries(data.players)) {
          if (id !== this.localId) {
            this.remotePlayers.set(id, player);
          }
        }
        if (data.players[this.localId]) {
          this.serverState = data.players[this.localId];
          this.serverSeq = -1;
        }
        if (Array.isArray(data.predators)) {
          this.remotePredators.clear();
          for (const pred of data.predators) {
            if (pred?.id != null) this.remotePredators.set(pred.id, pred);
          }
        }
        this._applyPushBallsPayload(data);
        this._applyMountsPayload(data);
        this._applyRopesPayload(data);
        this._applyFansPayload(data);
        this._applyPhysicalTasksPayload(data);
        this._applyCheesePayload(data);
        if (data.round) this.round = data.round;
        if (data.adversary) this.adversary = data.adversary;
        if (Array.isArray(data.extractionPortals)) this.extractionPortals = data.extractionPortals;
        if (data.heroClaims) this.heroClaims = { ...data.heroClaims };
        if (Array.isArray(data.unlockItems)) this.unlockItems = data.unlockItems;
        break;

      case 'unlock-reset':
        if (Array.isArray(data.unlockItems)) this.unlockItems = data.unlockItems;
        if (data.heroClaims) this.heroClaims = { ...data.heroClaims };
        this._setCompletedTaskIds([]);
        break;

      case 'unlock-pickup-consumed':
        if (Array.isArray(this.unlockItems)) {
          this.unlockItems = this.unlockItems.filter((it) => it.id !== data.itemId);
        }
        break;

      case 'drone-purchase-result':
        this.dronePurchase = {
          ok: data.ok === true,
          pending: false,
          message: data.ok === true
            ? 'Drone reserved for next round'
            : (data.reason === 'need_cheese'
              ? `Need ${data.cost ?? 12} carried cheese`
              : data.reason === 'already_reserved'
                ? 'Drone already reserved'
                : data.reason === 'too_far'
                  ? 'Move closer to the screen'
                  : 'Drone purchase unavailable'),
        };
        break;

      case 'hero-claimed':
        this.heroClaims = { ...(this.heroClaims ?? {}), [data.heroKey]: data.playerId };
        break;

      case 'task-completed':
        if (typeof data.taskId === 'string' && !this.completedTaskIds.includes(data.taskId)) {
          this._setCompletedTaskIds([...this.completedTaskIds, data.taskId]);
        }
        break;

      case 'portal-spawn':
        if (data.player?.id === this.localId) {
          this.serverState = data.player;
          this.serverSeq = -1;
          this.pendingInputs.length = 0;
          this._sendTimes.clear();
        }
        break;

      case 'snapshot': {
        // Update local authoritative state
        const localData = data.players?.[this.localId];
        if (localData) {
          this.serverState = localData;
          const ackedSeq = data.seqs?.[this.localId] ?? -1;
          this.serverSeq = ackedSeq;
          // Measure RTT from the acked input's send time
          const sentAt = this._sendTimes.get(ackedSeq);
          if (sentAt !== undefined) {
            const rtt = performance.now() - sentAt;
            this.ping = this.ping === 0 ? rtt : this.ping * 0.8 + rtt * 0.2;
            // Clean up measured entries
            for (const key of this._sendTimes.keys()) {
              if (key <= ackedSeq) this._sendTimes.delete(key);
            }
          }
          // Discard inputs already processed by the server
          this.pendingInputs = this.pendingInputs.filter((i) => i.seq > this.serverSeq);
        }

        // Update remote players
        for (const [id, player] of Object.entries(data.players)) {
          if (id !== this.localId) {
            this.remotePlayers.set(id, player);
          }
        }
        for (const id of this.remotePlayers.keys()) {
          if (!(id in data.players)) {
            this.remotePlayers.delete(id);
          }
        }

        // Only replace predator state when the snapshot actually carried a
        // non-empty list. A transient empty array would otherwise blank the
        // cat for a frame and the visual would freeze until the next
        // snapshot landed. Use diff-based update instead of clear+refill so
        // we never have a window where remotePredators is empty.
        if (Array.isArray(data.predators) && data.predators.length > 0) {
          const seenPred = new Set();
          for (const pred of data.predators) {
            if (pred?.id != null) {
              this.remotePredators.set(pred.id, pred);
              seenPred.add(pred.id);
            }
          }
          for (const id of this.remotePredators.keys()) {
            if (!seenPred.has(id)) this.remotePredators.delete(id);
          }
        }
        this._applyPushBallsPayload(data);
        this._applyMountsPayload(data);
        this._applyRopesPayload(data);
        this._applyFansPayload(data);
        this._applyPhysicalTasksPayload(data);
        this._applyCheesePayload(data);
        if (data.round) this.round = data.round;
        if (data.adversary) this.adversary = data.adversary;
        if (Array.isArray(data.extractionPortals)) this.extractionPortals = data.extractionPortals;
        break;
      }

      case 'round-phase':
        if (data.phase != null && typeof data.phaseEndsAt === 'number') {
          this.round = {
            ...(this.round ?? {}),
            phase: data.phase,
            phaseEndsAt: data.phaseEndsAt,
            number: data.number ?? this.round?.number ?? 1,
          };
          this._applyPhysicalTasksPayload(data);
        }
        break;
      case 'round-end':
        break;

      case 'player-joined':
        if (data.player.id !== this.localId) {
          this.remotePlayers.set(data.player.id, data.player);
        }
        break;

      case 'player-left':
        this.remotePlayers.delete(data.id);
        break;
    }

    for (const fn of this.listeners) fn(data);
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
