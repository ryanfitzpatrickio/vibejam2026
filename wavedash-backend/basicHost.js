import { createPlayerState, simulateTick } from '../shared/physics.js';
import { buildRoomCollidersFromLayout } from '../shared/roomCollision.js';
import { collectSpawnPointsFromLayout } from '../shared/spawnPoints.js';
import { sanitizeDisplayName } from '../shared/displayName.js';
import { sanitizePlayerInputMessage } from '../shared/playerInputSanitize.js';
import kitchenLayout from '../shared/kitchen-layout.generated.js';
import { LEVEL_WORLD_BOUNDS_XZ } from '../shared/levelWorldBounds.js';

const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const MAX_INPUT_QUEUE = 8;
const ROOM_CAPACITY = 8;
const BOUNDS = LEVEL_WORLD_BOUNDS_XZ;
const DEFAULT_INPUT = Object.freeze({
  moveX: 0,
  moveZ: 0,
  sprint: false,
  jump: false,
  jumpPressed: false,
  jumpHeld: false,
  jumpCharge: 0,
  crouch: false,
  rotation: 0,
  emote: null,
  seq: -1,
});

function serializePlayerState(p) {
  return {
    id: p.id,
    displayName: p.displayName,
    position: p.position,
    velocity: p.velocity,
    rotation: p.rotation,
    grounded: p.grounded,
    groundedGraceTimer: p.groundedGraceTimer,
    stamina: p.stamina,
    staminaRegenTimer: p.staminaRegenTimer,
    health: p.health,
    alive: p.alive,
    sprinting: p.sprinting,
    crouching: p.crouching,
    sliding: p.sliding,
    slideTimer: p.slideTimer,
    slideCooldownTimer: p.slideCooldownTimer,
    slideDirX: p.slideDirX,
    slideDirZ: p.slideDirZ,
    canDoubleJump: p.canDoubleJump,
    hasDoubleJumped: p.hasDoubleJumped,
    wallHolding: p.wallHolding,
    wallNormalX: p.wallNormalX,
    wallNormalZ: p.wallNormalZ,
    wallJumpWindowTimer: p.wallJumpWindowTimer,
    wallAttachCooldownTimer: p.wallAttachCooldownTimer,
    animState: p.animState,
    emote: p.emote,
    livesRemaining: p.livesRemaining,
  };
}

function serializePlayers(players) {
  const out = {};
  for (const [id, state] of players) {
    out[id] = serializePlayerState(state);
  }
  return out;
}

export function createWavedashBasicHost({
  roomId = 'wavedash-lobby',
  onSend = () => {},
  onBroadcast = null,
  now = () => Date.now(),
} = {}) {
  const players = new Map();
  const inputQueues = new Map();
  const lastSeqs = new Map();
  const spawnPoints = collectSpawnPointsFromLayout(kitchenLayout);
  const colliders = buildRoomCollidersFromLayout(kitchenLayout, { scaleFactor: 1 });
  let tickInterval = null;

  function send(userId, payload) {
    onSend(userId, JSON.stringify(payload));
  }

  function broadcast(payload, exclude = []) {
    if (onBroadcast) {
      onBroadcast(JSON.stringify(payload), exclude);
      return;
    }
    for (const id of players.keys()) {
      if (!exclude.includes(id)) send(id, payload);
    }
  }

  function pickSpawn(joinIndex = 0) {
    const points = spawnPoints.player;
    if (points?.length) return points[joinIndex % points.length];
    const angle = joinIndex * (Math.PI * 2 / ROOM_CAPACITY);
    return {
      x: Math.cos(angle) * 2,
      y: 0,
      z: Math.sin(angle) * 2,
    };
  }

  function sendInit(userId) {
    send(userId, {
      type: 'init',
      id: userId,
      players: serializePlayers(players),
      predators: [],
      mounts: [],
      pushBalls: [],
      cheesePickups: [],
      ropes: [],
      fans: [],
      physicalTasks: [],
      completedTaskIds: [],
      round: null,
      adversary: { playerId: null, available: false, safeRadius: 0 },
      extractionPortals: [],
      heroClaims: {},
      unlockItems: [],
    });
  }

  function connect(userId, { displayName = null } = {}) {
    const id = String(userId ?? '').trim();
    if (!id) throw new Error('connect requires a user id');
    if (players.has(id)) {
      sendInit(id);
      return players.get(id);
    }
    if (players.size >= ROOM_CAPACITY) {
      send(id, { type: 'error', message: 'Room full' });
      return null;
    }

    const state = createPlayerState(id);
    state.displayName = sanitizeDisplayName(displayName ?? 'Mouse');
    const spawn = pickSpawn(players.size);
    state.position.x = spawn.x;
    state.position.y = spawn.y;
    state.position.z = spawn.z;
    state.grounded = spawn.y <= 0.001;

    players.set(id, state);
    inputQueues.set(id, []);
    lastSeqs.set(id, -1);

    broadcast({ type: 'player-joined', player: serializePlayerState(state) }, [id]);
    sendInit(id);
    return state;
  }

  function disconnect(userId) {
    const id = String(userId ?? '').trim();
    if (!players.has(id)) return false;
    players.delete(id);
    inputQueues.delete(id);
    lastSeqs.delete(id);
    broadcast({ type: 'player-left', id });
    return true;
  }

  function receive(userId, rawMessage) {
    const id = String(userId ?? '').trim();
    if (!players.has(id)) return false;
    let data = rawMessage;
    if (typeof rawMessage === 'string') {
      try {
        data = JSON.parse(rawMessage);
      } catch {
        return false;
      }
    }
    if (!data || typeof data !== 'object') return false;

    if (data.type === 'hello') {
      const player = players.get(id);
      if (player && typeof data.displayName === 'string') {
        player.displayName = sanitizeDisplayName(data.displayName);
        broadcast({ type: 'player-joined', player: serializePlayerState(player) }, [id]);
      }
      return true;
    }

    if (data.type === 'input') {
      const queue = inputQueues.get(id);
      if (!queue) return false;
      if (queue.length >= MAX_INPUT_QUEUE) queue.shift();
      queue.push(sanitizePlayerInputMessage(data));
      return true;
    }

    return true;
  }

  function tick(dt = 1 / TICK_RATE) {
    const seqs = {};
    for (const [id, state] of players) {
      const queue = inputQueues.get(id) ?? [];
      const latestInput = queue.length ? queue[queue.length - 1] : {
        ...DEFAULT_INPUT,
        rotation: state.rotation,
        emote: state.emote ?? null,
        seq: lastSeqs.get(id) ?? -1,
      };
      queue.length = 0;
      if (Number.isFinite(latestInput.seq)) {
        lastSeqs.set(id, latestInput.seq);
      }
      state.emote = latestInput.emote ?? null;
      simulateTick(state, latestInput, dt, BOUNDS, colliders, null);
      seqs[id] = lastSeqs.get(id) ?? -1;
    }

    broadcast({
      type: 'snapshot',
      tick: now(),
      seqs,
      players: serializePlayers(players),
      predators: [],
      mounts: [],
      pushBalls: [],
      cheesePickups: [],
      ropes: [],
      fans: [],
      physicalTasks: [],
      completedTaskIds: [],
      round: null,
      adversary: { playerId: null, available: false, safeRadius: 0 },
      extractionPortals: [],
    });
  }

  function start() {
    if (tickInterval) return;
    tickInterval = setInterval(() => tick(1 / TICK_RATE), TICK_MS);
  }

  function stop() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    players.clear();
    inputQueues.clear();
    lastSeqs.clear();
  }

  return {
    roomId,
    players,
    connect,
    disconnect,
    receive,
    tick,
    start,
    stop,
  };
}
