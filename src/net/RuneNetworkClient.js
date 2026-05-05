const MIN_INPUT_ACTION_MS = 220;
const MIN_POSE_MOVE_DELTA_SQ = 0.0004;
const MIN_POSE_ROT_DELTA = 0.01;

function callRuneAction(name, payload) {
  const action = globalThis.Rune?.actions?.[name];
  if (typeof action === 'function') action(payload);
}

function compactNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : 0;
}

function compactVector3(value) {
  return [
    compactNumber(value?.x),
    compactNumber(value?.y),
    compactNumber(value?.z),
  ];
}

export class RuneNetworkClient {
  ws = null;
  localId = null;
  connected = false;
  remotePlayers = new Map();
  remotePredators = new Map();
  pushBalls = [];
  mounts = [];
  ropes = [];
  fans = [];
  physicalTasks = [];
  completedTaskIds = [];
  completedTaskRevision = 0;
  dronePurchase = { ok: false, pending: false, message: '' };
  cheesePickups = [];
  round = null;
  extractionPortals = [];
  adversary = { playerId: null, available: false, safeRadius: 0 };
  heroClaims = {};
  unlockItems = [];
  seq = 0;
  pendingInputs = [];
  serverState = null;
  serverSeq = -1;
  positionOnly = true;
  ping = 0;
  _lastInputActionAt = 0;
  _queuedInput = null;
  _lastSentPose = null;
  listeners = [];

  constructor(roomId = 'rune', { portalArrival = null } = {}) {
    this.roomId = roomId;
    this.portalArrival = portalArrival;
  }

  connect() {
    if (typeof globalThis.Rune?.initClient !== 'function') {
      for (const fn of this.listeners) {
        fn({ type: 'error', message: 'Rune SDK client is unavailable' });
      }
      return;
    }

    globalThis.Rune.initClient({
      onChange: ({ game, players, yourPlayerId, action, event }) => {
        this._handleRuneChange({ game, players, yourPlayerId, action, event });
      },
    });
  }

  sendInput(input) {
    const seq = this.seq++;
    const payload = { ...input, seq };
    this._queuedInput = this._mergeQueuedInput(this._queuedInput, payload);
    const now = performance.now();
    if (this._lastInputActionAt && now - this._lastInputActionAt < MIN_INPUT_ACTION_MS) {
      return seq;
    }
    const actionPayload = this._queuedInput;
    if (!this._poseChangedEnough(actionPayload)) return seq;
    this._queuedInput = null;
    this._lastInputActionAt = now;
    this._sendInputAction(actionPayload);
    return seq;
  }

  _sendInputAction(payload) {
    const poseAction = this._toPoseAction(payload);
    callRuneAction('input', poseAction);
    this._lastSentPose = poseAction;
  }

  _mergeQueuedInput(previous, next) {
    if (!previous) return next;
    return { ...previous, ...next };
  }

  _toPoseAction(input) {
    return {
      q: input.seq,
      p: compactVector3(input.position),
      v: compactVector3(input.velocity),
      r: compactNumber(input.rotation),
      a: input.animState || 'idle',
      g: input.grounded === true,
      s: input.sprinting === true,
      c: input.crouching === true,
      l: input.sliding === true,
      e: typeof input.emote === 'string' ? input.emote : null,
    };
  }

  _poseChangedEnough(input) {
    if (!this._lastSentPose) return true;
    const last = this._lastSentPose;
    const dx = compactNumber(input.position?.x) - (last.p?.[0] ?? 0);
    const dy = compactNumber(input.position?.y) - (last.p?.[1] ?? 0);
    const dz = compactNumber(input.position?.z) - (last.p?.[2] ?? 0);
    const dr = Math.abs(compactNumber(input.rotation) - (last.r ?? 0));
    if ((dx * dx) + (dy * dy) + (dz * dz) >= MIN_POSE_MOVE_DELTA_SQ) return true;
    if (dr >= MIN_POSE_ROT_DELTA) return true;
    if ((input.animState || 'idle') !== last.a) return true;
    if ((typeof input.emote === 'string' ? input.emote : null) !== last.e) return true;
    return false;
  }

  sendSpawnExtraBall() {}

  sendTaskComplete() {}

  sendSqueak() {}

  sendUnlockPickup() {}

  sendClaimHero() {}

  sendDronePurchase() {
    this.dronePurchase = { ok: false, pending: false, message: 'Drone purchase unavailable on Rune position-only mode' };
  }

  sendDisplayName() {}

  sendDevSyncLayout() {
    return false;
  }

  async fetchLeaderboard() {
    return null;
  }

  on(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== fn);
    };
  }

  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.localId = null;
    for (const fn of this.listeners) fn({ type: 'close' });
  }

  _emit(data) {
    for (const fn of this.listeners) fn(data);
  }

  _handleRuneChange({ game, players, yourPlayerId, action, event }) {
    if (!game || !yourPlayerId) return;

    const wasConnected = this.connected;
    this.localId = yourPlayerId;
    this.connected = true;

    this._applyGame(game);
    this._applyPlayers(game.players ?? {}, players ?? {});
    this._emitActionEvent(game, event);

    if (!wasConnected) {
      this._emit({ type: 'open' });
      this._emit({
        type: 'init',
        id: this.localId,
        players: this._expandPlayers(game.players ?? {}, players ?? {}),
        predators: game.predators ?? [],
        pushBalls: this.pushBalls,
        mounts: this.mounts,
        ropes: this.ropes,
        fans: this.fans,
        physicalTasks: this.physicalTasks,
        completedTaskIds: this.completedTaskIds,
        cheesePickups: this.cheesePickups,
        round: this.round,
        adversary: this.adversary,
        extractionPortals: this.extractionPortals,
        heroClaims: this.heroClaims,
        unlockItems: this.unlockItems,
      });
    }

    this._emit({
      type: 'snapshot',
      players: this._expandPlayers(game.players ?? {}, players ?? {}),
      seqs: game.seqs ?? {},
      predators: game.predators ?? [],
      pushBalls: this.pushBalls,
      mounts: this.mounts,
      ropes: this.ropes,
      fans: this.fans,
      physicalTasks: this.physicalTasks,
      completedTaskIds: this.completedTaskIds,
      cheesePickups: this.cheesePickups,
      round: this.round,
      adversary: this.adversary,
      extractionPortals: this.extractionPortals,
    });
  }

  _applyGame(game) {
    const localData = game.players?.[this.localId];
    if (localData) {
      this.serverState = this._expandPlayer(this.localId, localData, null);
      const ackedSeq = game.seqs?.[this.localId] ?? -1;
      this.serverSeq = ackedSeq;
    }

    this.remotePredators.clear();
    this.pushBalls = [];
    this.mounts = [];
    this.ropes = [];
    this.fans = [];
    this.physicalTasks = [];
    this.cheesePickups = [];
    this.round = null;
    this.extractionPortals = [];
    this.adversary = { playerId: null, available: false, safeRadius: 0 };
    this.heroClaims = {};
    this.unlockItems = [];
    this.completedTaskIds = [];
    this.dronePurchase = { ok: false, pending: false, message: '' };
  }

  _applyPlayers(gamePlayers, runePlayers) {
    for (const [id, player] of Object.entries(gamePlayers)) {
      if (id === this.localId) continue;
      const runePlayer = runePlayers[id];
      this.remotePlayers.set(id, this._expandPlayer(id, player, runePlayer));
    }
    for (const id of this.remotePlayers.keys()) {
      if (!(id in gamePlayers)) this.remotePlayers.delete(id);
    }
  }

  _expandPlayers(gamePlayers, runePlayers) {
    const expanded = {};
    for (const [id, player] of Object.entries(gamePlayers)) {
      expanded[id] = this._expandPlayer(id, player, runePlayers[id]);
    }
    return expanded;
  }

  _expandPlayer(id, player, runePlayer) {
    const position = Array.isArray(player?.p)
      ? { x: player.p[0] ?? 0, y: player.p[1] ?? 0, z: player.p[2] ?? 0 }
      : (player?.position ?? { x: 0, y: 0, z: 0 });
    const velocity = Array.isArray(player?.v)
      ? { x: player.v[0] ?? 0, y: player.v[1] ?? 0, z: player.v[2] ?? 0 }
      : (player?.velocity ?? { x: 0, y: 0, z: 0 });
    return {
      id,
      displayName: runePlayer?.displayName || player?.displayName || 'Mouse',
      position,
      velocity,
      rotation: player?.r ?? player?.rotation ?? 0,
      grounded: player?.g ?? player?.grounded ?? true,
      sprinting: player?.s ?? player?.sprinting ?? false,
      crouching: player?.c ?? player?.crouching ?? false,
      sliding: player?.l ?? player?.sliding ?? false,
      animState: player?.a ?? player?.animState ?? 'idle',
      emote: player?.e ?? player?.emote ?? null,
      stamina: 100,
      staminaRegenTimer: 0,
      health: 2,
      alive: true,
      livesRemaining: 2,
      spectator: false,
      extracted: false,
      extractProgress: 0,
      roundStats: {},
    };
  }

  _emitActionEvent(game, event) {
    if (event?.name === 'playerLeft' && event.params?.playerId) {
      this._emit({ type: 'player-left', id: event.params.playerId });
    } else if (event?.name === 'playerJoined' && event.params?.playerId) {
      const player = game.players?.[event.params.playerId];
      if (player) this._emit({ type: 'player-joined', player });
    }
  }
}
