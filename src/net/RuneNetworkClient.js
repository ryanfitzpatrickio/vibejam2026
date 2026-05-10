const MIN_INPUT_ACTION_MS = 130;
const MIN_POSE_MOVE_DELTA_SQ = 0.0004;
const MIN_POSE_ROT_DELTA = 0.01;
const REMOTE_POSE_LEAD_SECONDS = 0.1;
const REMOTE_POSE_MAX_LEAD_METERS = 1.2;
const POS_SCALE = 100;
const VEL_SCALE = 100;
const ROT_STEPS = 4096;
const FLAG_GROUNDED = 1;
const FLAG_SPRINTING = 2;
const FLAG_CROUCHING = 4;
const FLAG_SLIDING = 8;
const INPUT_GRAB = 1;
const INPUT_THROW = 2;
const INPUT_SMACK = 4;
const INPUT_SMACK_HELD = 8;
const INPUT_CHARGED_SMACK = 16;
const EMOTES = ['wave', 'dance', 'cheer', 'point', 'flex', 'clap', 'laugh', 'sit', 'sleep'];
const ANIM_STATES = ['idle', 'walk', 'run', 'jump', 'death', 'slide'];
const PX = 0;
const PY = 1;
const PZ = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const ROT = 6;
const ANIM = 7;
const FLAGS = 8;
const EMOTE = 9;

function callRuneAction(name, payload) {
  const action = globalThis.Rune?.actions?.[name];
  if (typeof action === 'function') action(payload);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function packNumber(value, scale) {
  return Math.round(finiteNumber(value) * scale);
}

function unpackNumber(value, scale) {
  return finiteNumber(value) / scale;
}

function packVector3(value, scale) {
  return [
    packNumber(value?.x, scale),
    packNumber(value?.y, scale),
    packNumber(value?.z, scale),
  ];
}

function packRotation(value) {
  const pi2 = Math.PI * 2;
  const rotation = ((finiteNumber(value) % pi2) + pi2) % pi2;
  return Math.round((rotation / pi2) * ROT_STEPS) % ROT_STEPS;
}

function unpackRotation(value) {
  return (Math.max(0, Math.min(ROT_STEPS - 1, Math.floor(finiteNumber(value)))) / ROT_STEPS) * Math.PI * 2;
}

function unpackVector3Tuple(player, xIndex, yIndex, zIndex, scale) {
  return {
    x: unpackNumber(player?.[xIndex], scale),
    y: unpackNumber(player?.[yIndex], scale),
    z: unpackNumber(player?.[zIndex], scale),
  };
}

function leadPosition(position, velocity) {
  const vx = finiteNumber(velocity?.x);
  const vy = finiteNumber(velocity?.y);
  const vz = finiteNumber(velocity?.z);
  const speed = Math.hypot(vx, vy, vz);
  if (speed <= 0.01) return position;

  const leadSeconds = Math.min(REMOTE_POSE_LEAD_SECONDS, REMOTE_POSE_MAX_LEAD_METERS / speed);
  return {
    x: finiteNumber(position?.x) + vx * leadSeconds,
    y: finiteNumber(position?.y) + vy * leadSeconds,
    z: finiteNumber(position?.z) + vz * leadSeconds,
  };
}

function packFlags(input) {
  return (input.grounded === true ? FLAG_GROUNDED : 0)
    | (input.sprinting === true ? FLAG_SPRINTING : 0)
    | (input.crouching === true ? FLAG_CROUCHING : 0)
    | (input.sliding === true ? FLAG_SLIDING : 0);
}

function packInputFlags(input) {
  return (input.grab === true || input.ropeGrab === true ? INPUT_GRAB : 0)
    | (input.throw === true || input.chargedThrowRelease === true || input.quickTossRelease === true ? INPUT_THROW : 0)
    | (input.smack === true ? INPUT_SMACK : 0)
    | (input.smackHeld === true ? INPUT_SMACK_HELD : 0)
    | (input.chargedSmackRelease === true ? INPUT_CHARGED_SMACK : 0);
}

function packedAngleDelta(a, b) {
  const half = ROT_STEPS / 2;
  return Math.abs((((a - b) + half) % ROT_STEPS + ROT_STEPS) % ROT_STEPS - half);
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
  _seenGameEventSeq = 0;
  _roundPhaseKey = '';
  _roundPhaseStartedAtMs = 0;
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
    const poseAction = this._toPoseAction(actionPayload);
    if (!this._poseChangedEnough(poseAction)) return seq;
    this._queuedInput = null;
    this._lastInputActionAt = now;
    this._sendInputAction(poseAction);
    return seq;
  }

  _sendInputAction(poseAction) {
    callRuneAction('input', poseAction);
    this._lastSentPose = poseAction;
  }

  _mergeQueuedInput(previous, next) {
    if (!previous) return next;
    return { ...previous, ...next };
  }

  _toPoseAction(input) {
    const animIndex = ANIM_STATES.indexOf(input.animState || 'idle');
    const emoteIndex = typeof input.emote === 'string' ? EMOTES.indexOf(input.emote) : -1;
    return {
      z: 1,
      q: input.seq,
      p: packVector3(input.position, POS_SCALE),
      v: packVector3(input.velocity, VEL_SCALE),
      r: packRotation(input.rotation),
      a: animIndex >= 0 ? animIndex : 0,
      f: packFlags(input),
      u: packInputFlags(input),
      e: emoteIndex >= 0 ? emoteIndex : -1,
    };
  }

  _poseChangedEnough(pose) {
    if (!this._lastSentPose) return true;
    const last = this._lastSentPose;
    const dx = (pose.p?.[0] ?? 0) - (last.p?.[0] ?? 0);
    const dy = (pose.p?.[1] ?? 0) - (last.p?.[1] ?? 0);
    const dz = (pose.p?.[2] ?? 0) - (last.p?.[2] ?? 0);
    if (((dx * dx) + (dy * dy) + (dz * dz)) / (POS_SCALE * POS_SCALE) >= MIN_POSE_MOVE_DELTA_SQ) return true;
    if (packedAngleDelta(pose.r ?? 0, last.r ?? 0) * ((Math.PI * 2) / ROT_STEPS) >= MIN_POSE_ROT_DELTA) return true;
    if ((pose.a ?? 0) !== (last.a ?? 0)) return true;
    if ((pose.f ?? 0) !== (last.f ?? 0)) return true;
    if ((pose.u ?? 0) !== (last.u ?? 0)) return true;
    if ((pose.e ?? -1) !== (last.e ?? -1)) return true;
    return false;
  }

  sendSpawnExtraBall() {
    callRuneAction('spawnExtraBall', {});
  }

  sendTaskComplete({ taskId, taskType, position, amount } = {}) {
    callRuneAction('taskComplete', {
      taskId,
      taskType,
      position,
      amount,
    });
  }

  sendSqueak() {
    callRuneAction('squeak', {});
  }

  sendUnlockPickup(itemId) {
    callRuneAction('unlockPickup', { itemId });
  }

  sendClaimHero({ heroKey, taskId } = {}) {
    callRuneAction('claimHero', { heroKey, taskId });
  }

  sendDronePurchase() {
    this.dronePurchase = { ok: false, pending: true, message: 'Buying drone...' };
    callRuneAction('purchaseDrone', {});
  }

  sendDisplayName(displayName) {
    callRuneAction('hello', { displayName });
  }

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
    this._applyPlayers(game, players ?? {});
    this._emitActionEvent(game, event);

    if (!wasConnected) {
      this._seenGameEventSeq = Math.max(this._seenGameEventSeq, Math.floor(finiteNumber(game.eventSeq)));
      this._emit({ type: 'open' });
      this._emit({
        type: 'init',
        id: this.localId,
        players: this._expandPlayers(game, players ?? {}),
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
    } else {
      this._emitGameEvent(game);
    }

    this._emit({
      type: 'snapshot',
      players: this._expandPlayers(game, players ?? {}),
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
      heroClaims: this.heroClaims,
      unlockItems: this.unlockItems,
    });
  }

  _applyGame(game) {
    const localData = game.players?.[this.localId];
    if (localData) {
      this.serverState = this._expandPlayer(this.localId, localData, null, game);
      const ackedSeq = game.seqs?.[this.localId] ?? -1;
      this.serverSeq = ackedSeq;
    }

    this._applyPredators(game.predators);
    this.pushBalls = Array.isArray(game.pushBalls) ? game.pushBalls : [];
    this.mounts = [];
    this.ropes = [];
    this.fans = [];
    this.physicalTasks = Array.isArray(game.physicalTasks) ? game.physicalTasks : [];
    this.cheesePickups = Array.isArray(game.cheesePickups) ? game.cheesePickups : [];
    this.round = this._expandRound(game.round);
    this.extractionPortals = [];
    this.adversary = { playerId: null, available: false, safeRadius: 0 };
    this.heroClaims = game.heroClaims ? { ...game.heroClaims } : {};
    this.unlockItems = Array.isArray(game.unlockItems) ? game.unlockItems : [];
    this._setCompletedTaskIds(Array.isArray(game.completedTaskIds) ? game.completedTaskIds : []);
    const purchase = game.dronePurchases?.[this.localId];
    if (purchase) this.dronePurchase = this._dronePurchaseState(purchase);
  }

  _applyPredators(predators) {
    if (!Array.isArray(predators) || predators.length <= 0) {
      this.remotePredators.clear();
      return;
    }
    const seen = new Set();
    for (const predator of predators) {
      if (predator?.id == null) continue;
      this.remotePredators.set(predator.id, predator);
      seen.add(predator.id);
    }
    for (const id of this.remotePredators.keys()) {
      if (!seen.has(id)) this.remotePredators.delete(id);
    }
  }

  _expandRound(round) {
    if (!round?.phase) return null;
    const number = Math.max(1, Math.floor(finiteNumber(round.number, 1)));
    const phase = String(round.phase);
    const key = `${number}:${phase}`;
    if (this._roundPhaseKey !== key) {
      this._roundPhaseKey = key;
      this._roundPhaseStartedAtMs = performance.now();
    }
    const duration = Math.max(0, finiteNumber(round.duration, 210));
    return {
      number,
      phase,
      phaseEndsAt: (Date.now() + Math.max(0, duration * 1000 - (performance.now() - this._roundPhaseStartedAtMs))) / 1000,
    };
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

  _applyPlayers(game, runePlayers) {
    const gamePlayers = game.players ?? {};
    for (const [id, player] of Object.entries(gamePlayers)) {
      if (id === this.localId) continue;
      const runePlayer = runePlayers[id];
      this.remotePlayers.set(id, this._expandPlayer(id, player, runePlayer, game));
    }
    for (const id of this.remotePlayers.keys()) {
      if (!(id in gamePlayers)) this.remotePlayers.delete(id);
    }
  }

  _expandPlayers(game, runePlayers) {
    const expanded = {};
    const gamePlayers = game.players ?? {};
    for (const [id, player] of Object.entries(gamePlayers)) {
      expanded[id] = this._expandPlayer(id, player, runePlayers[id], game);
    }
    return expanded;
  }

  _expandPlayer(id, player, runePlayer, game = null) {
    const meta = game?.m?.[id] ?? {};
    const displayName = game?.names?.[id] || runePlayer?.displayName || 'Mouse';
    const health = Math.max(0, Math.min(2, finiteNumber(meta.health, 2)));
    const alive = meta.alive !== false;
    const livesRemaining = Math.max(0, Math.min(2, Math.floor(finiteNumber(meta.livesRemaining, 2))));
    const spectator = meta.spectator === true;
    const smacksLanded = Math.max(0, Math.floor(finiteNumber(meta.smacksLanded)));
    if (Array.isArray(player)) {
      const flags = Math.floor(finiteNumber(player[FLAGS]));
      const animIndex = Math.floor(finiteNumber(player[ANIM]));
      const emoteIndex = Math.floor(finiteNumber(player[EMOTE], -1));
      const position = unpackVector3Tuple(player, PX, PY, PZ, POS_SCALE);
      const velocity = unpackVector3Tuple(player, VX, VY, VZ, VEL_SCALE);
      return {
        id,
        displayName,
        position,
        renderPosition: leadPosition(position, velocity),
        velocity,
        rotation: unpackRotation(player[ROT]),
        grounded: (flags & FLAG_GROUNDED) !== 0,
        sprinting: (flags & FLAG_SPRINTING) !== 0,
        crouching: (flags & FLAG_CROUCHING) !== 0,
        sliding: (flags & FLAG_SLIDING) !== 0,
        animState: ANIM_STATES[animIndex] ?? 'idle',
        emote: EMOTES[emoteIndex] ?? null,
        stamina: 100,
        staminaRegenTimer: 0,
        health,
        alive,
        livesRemaining,
        spectator,
        deathTime: 0,
        deaths: Math.max(0, Math.floor(finiteNumber(meta.deaths))),
        throwTick: Math.max(0, Math.floor(finiteNumber(meta.throwTick))),
        smackStunTimer: Math.max(0, finiteNumber(meta.smackStunTicks) / 30),
        smackLimpThrowWindowTimer: Math.max(0, finiteNumber(meta.smackStunTicks) / 30),
        chargedSmackHitSeq: Math.max(0, Math.floor(finiteNumber(meta.chargedSmackHitSeq))),
        extracted: false,
        extractProgress: 0,
        cheeseCarried: meta.cheeseCarried ?? 0,
        grabbedTarget: meta.grabbedTarget ?? null,
        grabbedBy: meta.grabbedBy ?? null,
        grabbedBallId: meta.grabbedBallId ?? null,
        sewingCollected: meta.sewingCollected ?? 0,
        speedTokensCollected: meta.speedTokensCollected ?? 0,
        isHero: meta.isHero === true,
        heroAvatar: meta.heroAvatar ?? null,
        heroAvailable: meta.heroAvailable === true,
        heroTimeRemaining: meta.heroTimeRemaining ?? 0,
        roundStats: { smacksLanded },
      };
    }
    const position = Array.isArray(player?.p)
      ? { x: player.p[0] ?? 0, y: player.p[1] ?? 0, z: player.p[2] ?? 0 }
      : (player?.position ?? { x: 0, y: 0, z: 0 });
    const velocity = Array.isArray(player?.v)
      ? { x: player.v[0] ?? 0, y: player.v[1] ?? 0, z: player.v[2] ?? 0 }
      : (player?.velocity ?? { x: 0, y: 0, z: 0 });
    return {
      id,
      displayName: player?.displayName || displayName,
      position,
      renderPosition: leadPosition(position, velocity),
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
      health,
      alive,
      livesRemaining,
      spectator,
      deathTime: 0,
      deaths: Math.max(0, Math.floor(finiteNumber(meta.deaths))),
      throwTick: Math.max(0, Math.floor(finiteNumber(meta.throwTick))),
      smackStunTimer: Math.max(0, finiteNumber(meta.smackStunTicks) / 30),
      smackLimpThrowWindowTimer: Math.max(0, finiteNumber(meta.smackStunTicks) / 30),
      chargedSmackHitSeq: Math.max(0, Math.floor(finiteNumber(meta.chargedSmackHitSeq))),
      extracted: false,
      extractProgress: 0,
      cheeseCarried: meta.cheeseCarried ?? 0,
      grabbedTarget: meta.grabbedTarget ?? null,
      grabbedBy: meta.grabbedBy ?? null,
      grabbedBallId: meta.grabbedBallId ?? null,
      sewingCollected: meta.sewingCollected ?? 0,
      speedTokensCollected: meta.speedTokensCollected ?? 0,
      isHero: meta.isHero === true,
      heroAvatar: meta.heroAvatar ?? null,
      heroAvailable: meta.heroAvailable === true,
      heroTimeRemaining: meta.heroTimeRemaining ?? 0,
      roundStats: { smacksLanded },
    };
  }

  _dronePurchaseState(data) {
    return {
      ok: data?.ok === true,
      pending: data?.pending === true,
      message: data?.ok === true
        ? 'Drone reserved for next round'
        : (data?.reason === 'need_cheese'
          ? `Need ${data.cost ?? 12} carried cheese`
          : data?.reason === 'already_reserved'
            ? 'Drone already reserved'
            : data?.reason === 'too_far'
              ? 'Move closer to the screen'
              : 'Drone purchase unavailable'),
    };
  }

  _emitGameEvent(game) {
    const event = game.lastEvent;
    const seq = Math.floor(finiteNumber(event?.seq));
    if (!event || seq <= this._seenGameEventSeq) return;
    this._seenGameEventSeq = seq;

    if (event.type === 'drone-purchase-result') {
      if (event.playerId === this.localId) {
        this.dronePurchase = this._dronePurchaseState(event);
        this._emit({
          type: 'drone-purchase-result',
          ok: event.ok === true,
          reason: event.reason,
          cost: event.cost,
        });
      }
      return;
    }

    this._emit({ ...event });
  }

  _emitActionEvent(game, event) {
    if (event?.name === 'playerLeft' && event.params?.playerId) {
      this._emit({ type: 'player-left', id: event.params.playerId });
    } else if (event?.name === 'playerJoined' && event.params?.playerId) {
      const player = game.players?.[event.params.playerId];
      if (player) {
        this._emit({
          type: 'player-joined',
          player: this._expandPlayer(event.params.playerId, player, null, game),
        });
      }
    }
  }
}
