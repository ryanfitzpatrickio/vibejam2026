const TICK_RATE = 30;
const MAX_PLAYERS = 6;
const WORLD = {
  minX: -48,
  maxX: 48,
  minZ: -48,
  maxZ: 48,
};
const SPAWNS = [
  { x: 10, y: 0.1, z: -4 },
  { x: 4, y: 0.1, z: 20 },
];
const CAT_SPAWN = { x: -10, y: 0.1, z: 8 };
const CHEESE_SPAWNS = [
  { x: 8.5, y: 0.1, z: -2.6 },
  { x: 11.4, y: 0.1, z: -5.2 },
  { x: 5.4, y: 0.1, z: 18.6 },
  { x: 2.6, y: 0.1, z: 21.2 },
  { x: -2.5, y: 0.1, z: 8.4 },
  { x: -6.5, y: 0.1, z: 11.2 },
  { x: 14.2, y: 0.1, z: 10.4 },
  { x: -12.8, y: 0.1, z: -2.8 },
];
const EMOTES = ['wave', 'dance', 'cheer', 'point', 'flex', 'clap', 'laugh', 'sit', 'sleep'];
const ANIM_STATES = ['idle', 'walk', 'run', 'jump', 'death', 'slide'];
const EXTRA_BALL_RADIUS = 0.38;
const MAX_EXTRA_BALLS = 96;
const ROUND_DURATION_SECONDS = 210;
const CAT_CHASE_SPEED = 3.4;
const CAT_CHASE_RANGE = 18;
const CAT_ATTACK_RANGE = 1.25;
const CAT_ATTACK_WINDUP_TICKS = Math.ceil(TICK_RATE * 0.5);
const CAT_ATTACK_COOLDOWN_TICKS = TICK_RATE;
const CAT_DAMAGE = 1;
const CAT_KNOCKBACK_SPEED = 5.5;
const GRAB_RANGE = 1.35;
const BALL_GRAB_RANGE = 1.55;
const CHEESE_PICKUP_RADIUS_SQ = 0.85 * 0.85;
const MAX_CHEESE_PICKUPS = 160;
const MAX_HEALTH = 2;
const LIVES_PER_PLAYER = 2;
const RESPAWN_TICKS = TICK_RATE * 3;
const THROW_REGRAB_BLOCK_TICKS = Math.ceil(TICK_RATE * 0.8);
const CARRY_HEIGHT = 0.72;
const FRIDGE_TASKS = [
  {
    id: 'raid-task-fridge-raid-01',
    taskType: 'fridge_raid',
    mode: 'physical',
    x: 18,
    y: 0,
    z: 14,
    ry: -1.5708,
  },
];
const PHYSICAL_TASK_RADIUS_SQ = 1.8 * 1.8;
const FRIDGE_OPEN_DISTANCE = 1.55;
const FRIDGE_PUSH_GAIN = 0.18;
const FRIDGE_LATCH_PULLBACK = 0.08;
const FRIDGE_LATCH_MAX_TRACK_SPEED = 0.42;
const SMACK_RANGE = 2.0;
const SMACK_COOLDOWN_TICKS = Math.ceil(TICK_RATE * 1.5);
const SMACK_STUN_TICKS = TICK_RATE;
const SMACK_KNOCKBACK_SPEED = 8;
const SMACK_BALL_SPEED = 12;
const SMACK_BALL_UP = 3.8;
const CHARGED_SMACK_MIN_TICKS = TICK_RATE;
const CHARGED_SMACK_MAX_TICKS = Math.ceil(TICK_RATE * 1.6);
const CHARGED_SMACK_RANGE = 2.45;
const CHARGED_SMACK_COOLDOWN_TICKS = Math.ceil(TICK_RATE * 1.9);
const CHARGED_SMACK_BALL_MIN_SPEED = 18;
const CHARGED_SMACK_BALL_MAX_SPEED = 32;
const CHARGED_SMACK_BALL_MIN_UP = 4.8;
const CHARGED_SMACK_BALL_MAX_UP = 8;
const CHARGED_SMACK_PLAYER_MIN_SPEED = 8.8;
const CHARGED_SMACK_PLAYER_MAX_SPEED = 14;
const CHARGED_SMACK_CAT_RANGE = 3.15;
const CHARGED_SMACK_CAT_STUN_TICKS = TICK_RATE * 3;
const CHARGED_SMACK_CAT_KNOCKBACK = 0.55;
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
const RUNE_BLOCKERS = [
  // Coarse wall/furniture blockers for the lightweight Rune cat/ball simulation.
  { minX: -26.3, maxX: 26.3, minZ: -26.3, maxZ: -25.7 },
  { minX: -26.3, maxX: 26.3, minZ: 25.7, maxZ: 26.3 },
  { minX: 25.7, maxX: 26.3, minZ: -24.3, maxZ: 24.3 },
  { minX: -26.3, maxX: -25.7, minZ: -6.3, maxZ: 24.3 },
  { minX: -24.3, maxX: -23.7, minZ: -24.3, maxZ: 24.3 },
  { minX: -25.3, maxX: 21.3, minZ: -24.3, maxZ: -23.7 },
  { minX: -24.3, maxX: 12.3, minZ: -6.3, maxZ: -5.7 },
  { minX: -24.3, maxX: 8.3, minZ: -4.3, maxZ: -3.7 },
  { minX: -22.3, maxX: -21.7, minZ: -6.3, maxZ: 22.3 },
  { minX: 11.7, maxX: 12.3, minZ: -24.3, maxZ: -3.7 },
  { minX: 21.7, maxX: 22.3, minZ: -22.3, maxZ: 22.3 },
  { minX: -24.3, maxX: 2.3, minZ: 21.7, maxZ: 22.3 },
  { minX: 5.7, maxX: 24.3, minZ: 21.7, maxZ: 22.3 },
  { minX: -13.0, maxX: 3.2, minZ: -17.8, maxZ: -10.2 },
  { minX: -3.4, maxX: 1.4, minZ: 3.6, maxZ: 15.9 },
  { minX: 9.7, maxX: 22.2, minZ: 17.8, maxZ: 22.4 },
  { minX: 17.3, maxX: 21.8, minZ: 7.5, maxZ: 16.3 },
  { minX: 16.8, maxX: 21.4, minZ: 3.3, maxZ: 7.8 },
  { minX: -9.2, maxX: -4.7, minZ: -1.9, maxZ: 2.6 },
  { minX: -2.9, maxX: 1.1, minZ: -1.9, maxZ: 2.1 },
  { minX: -21.9, maxX: -17.3, minZ: 6.5, maxZ: 11.2 },
];

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value) {
  return clamp(finiteNumber(value), -1, 1);
}

function clampSeq(value) {
  return clamp(Math.floor(finiteNumber(value, -1)), -1, 2147483647);
}

function clampRotation(value) {
  const rotation = finiteNumber(value);
  const pi2 = Math.PI * 2;
  return ((rotation % pi2) + pi2) % pi2;
}

function packNumber(value, scale) {
  return Math.round(finiteNumber(value) * scale);
}

function unpackNumber(value, scale) {
  return finiteNumber(value) / scale;
}

function packRotation(value) {
  return Math.round((clampRotation(value) / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS;
}

function unpackRotation(value) {
  return (clamp(Math.floor(finiteNumber(value)), 0, ROT_STEPS - 1) / ROT_STEPS) * Math.PI * 2;
}

function unpackPackedVector3(value, scale, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: unpackNumber(value?.[0], scale) || fallback.x,
    y: unpackNumber(value?.[1], scale) || fallback.y,
    z: unpackNumber(value?.[2], scale) || fallback.z,
  };
}

function intersectsExpandedBlocker(x, z, radius = 0) {
  return RUNE_BLOCKERS.some((b) => (
    x >= b.minX - radius
    && x <= b.maxX + radius
    && z >= b.minZ - radius
    && z <= b.maxZ + radius
  ));
}

function segmentIntersectsExpandedBlocker(ax, az, bx, bz, radius = 0) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.22));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (intersectsExpandedBlocker(ax + (bx - ax) * t, az + (bz - az) * t, radius)) return true;
  }
  return false;
}

function moveAroundBlockers(fromX, fromZ, toX, toZ, radius = 0.42) {
  if (!segmentIntersectsExpandedBlocker(fromX, fromZ, toX, toZ, radius)) {
    return { x: toX, z: toZ };
  }
  if (!segmentIntersectsExpandedBlocker(fromX, fromZ, toX, fromZ, radius)) {
    return { x: toX, z: fromZ };
  }
  if (!segmentIntersectsExpandedBlocker(fromX, fromZ, fromX, toZ, radius)) {
    return { x: fromX, z: toZ };
  }
  return { x: fromX, z: fromZ };
}

function sanitizeDisplayName(value) {
  const text = String(value ?? '').trim().slice(0, 24);
  return text || 'Mouse';
}

function sanitizeShortString(value, maxLength = 64) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function colorForId(value) {
  const hash = hashString(value);
  const r = 72 + (hash & 127);
  const g = 72 + ((hash >>> 8) & 127);
  const b = 72 + ((hash >>> 16) & 127);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function sanitizeVector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finiteNumber(value?.x, fallback.x),
    y: finiteNumber(value?.y, fallback.y),
    z: finiteNumber(value?.z, fallback.z),
  };
}

function playerMeta(game, playerId) {
  game.m ??= {};
  game.m[playerId] ??= {};
  return game.m[playerId];
}

function ensurePlayerVitals(game, playerId) {
  const meta = playerMeta(game, playerId);
  meta.health = clamp(Math.floor(finiteNumber(meta.health, MAX_HEALTH)), 0, MAX_HEALTH);
  meta.alive = meta.alive !== false;
  meta.livesRemaining = clamp(Math.floor(finiteNumber(meta.livesRemaining, LIVES_PER_PLAYER)), 0, LIVES_PER_PLAYER);
  meta.deaths = Math.max(0, Math.floor(finiteNumber(meta.deaths)));
  meta.spectator = meta.spectator === true;
  meta.grabBlockedUntilTick = Math.max(0, Math.floor(finiteNumber(meta.grabBlockedUntilTick)));
  meta.smackCooldownTicks = Math.max(0, Math.floor(finiteNumber(meta.smackCooldownTicks)));
  meta.smackStunTicks = Math.max(0, Math.floor(finiteNumber(meta.smackStunTicks)));
  meta.smackHoldTicks = Math.max(0, Math.floor(finiteNumber(meta.smackHoldTicks)));
  meta.chargedSmackHitSeq = Math.max(0, Math.floor(finiteNumber(meta.chargedSmackHitSeq)));
  meta.smacksLanded = Math.max(0, Math.floor(finiteNumber(meta.smacksLanded)));
  return meta;
}

function emitGameEvent(game, type, payload = {}) {
  game.eventSeq = Math.max(0, Math.floor(finiteNumber(game.eventSeq))) + 1;
  game.lastEvent = {
    seq: game.eventSeq,
    type,
    ...payload,
  };
}

function createPlayerState(id, index) {
  const spawn = SPAWNS[index % SPAWNS.length] ?? SPAWNS[0];
  return [
    packNumber(spawn.x, POS_SCALE),
    packNumber(spawn.y, POS_SCALE),
    packNumber(spawn.z, POS_SCALE),
    0,
    0,
    0,
    0,
    0,
    FLAG_GROUNDED,
    -1,
  ];
}

function createPredators() {
  return [
    {
      id: 'cat-0',
      type: 'cat',
      px: CAT_SPAWN.x,
      py: CAT_SPAWN.y,
      pz: CAT_SPAWN.z,
      ry: 0,
      ai: 'idle',
      cv: 0,
      alive: true,
      hp: 4,
    },
  ];
}

function createInitialCheesePickups() {
  return CHEESE_SPAWNS.map((spawn, index) => ({
    id: `cz-${index + 1}`,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    amount: 1,
  }));
}

function createPhysicalTaskStates() {
  return FRIDGE_TASKS.map((task) => ({
    id: task.id,
    taskType: task.taskType,
    mode: task.mode,
    progress: 0,
    helpers: 0,
  }));
}

function sanitizeInput(data) {
  const packed = data?.z === 1;
  const rawEmote = data?.e ?? data?.emote;
  const emoteIndex = typeof rawEmote === 'number' ? Math.floor(rawEmote) : EMOTES.indexOf(rawEmote);
  const emote = emoteIndex >= 0 && emoteIndex < EMOTES.length ? EMOTES[emoteIndex] : null;
  const compactPosition = Array.isArray(data?.p) ? data.p : null;
  const compactVelocity = Array.isArray(data?.v) ? data.v : null;
  const position = packed && compactPosition
    ? unpackPackedVector3(compactPosition, POS_SCALE)
    : compactPosition
      ? { x: compactPosition[0], y: compactPosition[1], z: compactPosition[2] }
    : data?.position;
  const velocity = packed && compactVelocity
    ? unpackPackedVector3(compactVelocity, VEL_SCALE)
    : compactVelocity
      ? { x: compactVelocity[0], y: compactVelocity[1], z: compactVelocity[2] }
    : data?.velocity;
  const animStateValue = data?.a ?? data?.animState;
  const animState = typeof animStateValue === 'number'
    ? ANIM_STATES[Math.floor(animStateValue)]
    : animStateValue;
  const flags = Math.floor(finiteNumber(data?.f, 0));
  const inputFlags = Math.floor(finiteNumber(data?.u, 0));
  return {
    seq: clampSeq(data?.q ?? data?.seq),
    moveX: clampUnit(data?.moveX),
    moveZ: clampUnit(data?.moveZ),
    sprint: data?.sprint === true,
    jump: data?.jump === true,
    jumpPressed: data?.jumpPressed === true,
    jumpHeld: data?.jumpHeld === true,
    jumpCharge: clamp(finiteNumber(data?.jumpCharge), 0, 1),
    crouch: data?.crouch === true,
    rotation: packed && typeof data?.r === 'number'
      ? unpackRotation(data.r)
      : clampRotation(data?.r ?? data?.rotation),
    position: sanitizeVector3(position),
    velocity: sanitizeVector3(velocity),
    grounded: typeof data?.f === 'number' ? (flags & FLAG_GROUNDED) !== 0 : (data?.g ?? data?.grounded) === true,
    sprinting: typeof data?.f === 'number' ? (flags & FLAG_SPRINTING) !== 0 : (data?.s ?? data?.sprinting) === true,
    crouching: typeof data?.f === 'number' ? (flags & FLAG_CROUCHING) !== 0 : (data?.c ?? data?.crouching) === true,
    sliding: typeof data?.f === 'number' ? (flags & FLAG_SLIDING) !== 0 : (data?.l ?? data?.sliding) === true,
    grab: typeof data?.u === 'number' ? (inputFlags & INPUT_GRAB) !== 0 : (data?.grab ?? data?.ropeGrab) === true,
    throw: typeof data?.u === 'number'
      ? (inputFlags & INPUT_THROW) !== 0
      : (data?.throw ?? data?.chargedThrowRelease ?? data?.quickTossRelease) === true,
    smack: typeof data?.u === 'number' ? (inputFlags & INPUT_SMACK) !== 0 : data?.smack === true,
    smackHeld: typeof data?.u === 'number' ? (inputFlags & INPUT_SMACK_HELD) !== 0 : data?.smackHeld === true,
    chargedSmackRelease: typeof data?.u === 'number'
      ? (inputFlags & INPUT_CHARGED_SMACK) !== 0
      : data?.chargedSmackRelease === true,
    animState: ANIM_STATES.indexOf(animState) >= 0 ? animState : 'idle',
    emote,
  };
}

function addPlayer(game, playerId) {
  if (game.players[playerId]) return;
  game.playerOrder.push(playerId);
  game.players[playerId] = createPlayerState(playerId, game.playerOrder.length - 1);
  game.seqs[playerId] = -1;
  game.names ??= {};
  game.names[playerId] ??= 'Mouse';
  ensurePlayerVitals(game, playerId);
}

function removePlayer(game, playerId) {
  delete game.players[playerId];
  delete game.seqs[playerId];
  delete game.names?.[playerId];
  delete game.m?.[playerId];
  delete game.dronePurchases?.[playerId];
  game.playerOrder = game.playerOrder.filter((id) => id !== playerId);
}

function setup(allPlayerIds) {
  const game = {
    version: 2,
    playerOrder: [],
    players: {},
    seqs: {},
    names: {},
    m: {},
    completedTaskIds: [],
    heroClaims: {},
    unlockItems: [],
    cheesePickups: createInitialCheesePickups(),
    nextCheeseId: CHEESE_SPAWNS.length + 1,
    pushBalls: [],
    nextBallId: 0,
    physicalTasks: createPhysicalTaskStates(),
    taskLatches: {},
    predators: createPredators(),
    round: {
      number: 1,
      phase: 'forage',
      duration: ROUND_DURATION_SECONDS,
    },
    dronePurchases: {},
    tick: 0,
    eventSeq: 0,
    lastEvent: null,
  };
  for (const playerId of allPlayerIds) addPlayer(game, playerId);
  return game;
}

function applyPose(state, input) {
  state[PX] = packNumber(clamp(input.position.x, WORLD.minX + 0.22, WORLD.maxX - 0.22), POS_SCALE);
  state[PY] = packNumber(clamp(input.position.y, -12, 24), POS_SCALE);
  state[PZ] = packNumber(clamp(input.position.z, WORLD.minZ + 0.22, WORLD.maxZ - 0.22), POS_SCALE);
  state[VX] = packNumber(clamp(input.velocity.x, -80, 80), VEL_SCALE);
  state[VY] = packNumber(clamp(input.velocity.y, -80, 80), VEL_SCALE);
  state[VZ] = packNumber(clamp(input.velocity.z, -80, 80), VEL_SCALE);
  state[ROT] = packRotation(input.rotation);
  state[ANIM] = ANIM_STATES.indexOf(input.animState);
  state[FLAGS] = (input.grounded ? FLAG_GROUNDED : 0)
    | (input.sprinting ? FLAG_SPRINTING : 0)
    | (input.crouching ? FLAG_CROUCHING : 0)
    | (input.sliding ? FLAG_SLIDING : 0);
  state[EMOTE] = input.emote ? EMOTES.indexOf(input.emote) : -1;
}

function getPlayerPosition(player) {
  return {
    x: unpackNumber(player?.[PX], POS_SCALE),
    y: unpackNumber(player?.[PY], POS_SCALE),
    z: unpackNumber(player?.[PZ], POS_SCALE),
  };
}

function setPlayerPosition(player, position) {
  if (!player) return;
  player[PX] = packNumber(clamp(position.x, WORLD.minX + 0.22, WORLD.maxX - 0.22), POS_SCALE);
  player[PY] = packNumber(clamp(position.y, -12, 24), POS_SCALE);
  player[PZ] = packNumber(clamp(position.z, WORLD.minZ + 0.22, WORLD.maxZ - 0.22), POS_SCALE);
}

function getPlayerRotation(player) {
  return unpackRotation(player?.[ROT]);
}

function isNearPhysicalTask(pos, task) {
  const dx = task.x - pos.x;
  const dy = task.y - pos.y;
  const dz = task.z - pos.z;
  return dx * dx + dz * dz + dy * dy * 0.18 <= PHYSICAL_TASK_RADIUS_SQ;
}

function isGrabbingPhysicalTask(game, playerId, pos) {
  if (game.completedTaskIds?.includes?.(FRIDGE_TASKS[0].id)) return false;
  return FRIDGE_TASKS.some((task) => isNearPhysicalTask(pos, task));
}

function resetPlayerToSpawn(game, playerId) {
  const index = Math.max(0, game.playerOrder.indexOf(playerId));
  game.players[playerId] = createPlayerState(playerId, index);
}

function respawnPlayer(game, playerId) {
  const player = game.players[playerId];
  if (!player) return;
  resetPlayerToSpawn(game, playerId);
  const meta = ensurePlayerVitals(game, playerId);
  meta.health = MAX_HEALTH;
  meta.alive = true;
  meta.spectator = false;
  meta.respawnTick = null;
  meta.deathTick = null;
  clearGrab(game, playerId);
}

function killPlayer(game, playerId) {
  const player = game.players[playerId];
  if (!player) return;
  const meta = ensurePlayerVitals(game, playerId);
  meta.health = 0;
  meta.alive = false;
  meta.deaths += 1;
  meta.livesRemaining = Math.max(0, meta.livesRemaining - 1);
  meta.spectator = meta.livesRemaining <= 0;
  meta.deathTick = game.tick ?? 0;
  meta.respawnTick = meta.spectator ? null : (game.tick ?? 0) + RESPAWN_TICKS;
  player[VX] = 0;
  player[VY] = 0;
  player[VZ] = 0;
  player[ANIM] = ANIM_STATES.indexOf('death');
  clearGrab(game, playerId);
}

function damagePlayerFromCat(game, playerId, cat, targetPos) {
  const player = game.players[playerId];
  if (!player) return;
  const meta = ensurePlayerVitals(game, playerId);
  if (!meta.alive || meta.spectator) return;

  meta.health = Math.max(0, meta.health - CAT_DAMAGE);
  const dx = targetPos.x - cat.px;
  const dz = targetPos.z - cat.pz;
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  player[VX] = packNumber((dx / dist) * CAT_KNOCKBACK_SPEED, VEL_SCALE);
  player[VZ] = packNumber((dz / dist) * CAT_KNOCKBACK_SPEED, VEL_SCALE);
  if (meta.health <= 0) {
    killPlayer(game, playerId);
  }
  emitGameEvent(game, 'cat-hit', {
    playerId,
    health: meta.health,
    livesRemaining: meta.livesRemaining,
  });
}

function stepCat(game, dt = 1 / TICK_RATE) {
  const cat = Array.isArray(game.predators) ? game.predators.find((p) => p?.id === 'cat-0') : null;
  if (!cat) return;
  if (cat.st > 0) {
    cat.st = Math.max(0, Math.floor(finiteNumber(cat.st)) - 1);
    cat.ai = 'stunned';
    return;
  }
  cat.cv = Math.max(0, Math.floor(finiteNumber(cat.cv)) - 1);
  let target = null;
  let bestDistSq = CAT_CHASE_RANGE * CAT_CHASE_RANGE;
  for (const [id, player] of Object.entries(game.players ?? {})) {
    const meta = ensurePlayerVitals(game, id);
    if (!meta.alive || meta.spectator) continue;
    const pos = getPlayerPosition(player);
    const dx = pos.x - cat.px;
    const dz = pos.z - cat.pz;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      target = { id, pos, dx, dz };
    }
  }
  if (!target) {
    cat.ai = 'idle';
    return;
  }
  const dist = Math.max(0.001, Math.sqrt(bestDistSq));
  const step = Math.min(dist, CAT_CHASE_SPEED * dt);
  const next = moveAroundBlockers(
    cat.px,
    cat.pz,
    cat.px + (target.dx / dist) * step,
    cat.pz + (target.dz / dist) * step,
    0.48,
  );
  cat.px = Math.round(next.x * 1000) / 1000;
  cat.pz = Math.round(next.z * 1000) / 1000;
  cat.ry = Math.atan2(target.dx, target.dz);
  const postDx = target.pos.x - cat.px;
  const postDz = target.pos.z - cat.pz;
  const postDist = Math.sqrt(postDx * postDx + postDz * postDz);
  cat.ai = postDist < 1.8 ? 'attack' : 'chase';
  if (postDist > CAT_ATTACK_RANGE || cat.cv > 0) {
    cat.aw = 0;
    cat.tid = null;
    return;
  }

  if (cat.tid !== target.id || cat.aw <= 0) {
    cat.tid = target.id;
    cat.aw = CAT_ATTACK_WINDUP_TICKS;
    return;
  }

  cat.aw = Math.max(0, Math.floor(finiteNumber(cat.aw)) - 1);
  if (cat.aw > 0) return;

  damagePlayerFromCat(game, target.id, cat, target.pos);
  cat.cv = CAT_ATTACK_COOLDOWN_TICKS;
  cat.tid = null;
  cat.ai = 'attack';
}

function clearGrab(game, playerId) {
  const meta = playerMeta(game, playerId);
  if (meta.grabbedTarget) {
    const targetMeta = playerMeta(game, meta.grabbedTarget);
    if (targetMeta.grabbedBy === playerId) targetMeta.grabbedBy = null;
    meta.grabbedTarget = null;
  }
  meta.grabbedBallId = null;
}

function processGrab(game, playerId, input) {
  const player = game.players[playerId];
  if (!player) return;
  const meta = playerMeta(game, playerId);
  meta.grabHeld = input.grab === true;
  if (!input.grab) {
    clearGrab(game, playerId);
    return;
  }
  if (meta.grabbedTarget || meta.grabbedBallId) return;
  if ((game.tick ?? 0) < (meta.grabBlockedUntilTick ?? 0)) return;
  const pos = getPlayerPosition(player);
  if (isGrabbingPhysicalTask(game, playerId, pos)) {
    clearGrab(game, playerId);
    return;
  }
  let bestId = null;
  let bestDistSq = GRAB_RANGE * GRAB_RANGE;
  for (const [otherId, other] of Object.entries(game.players ?? {})) {
    if (otherId === playerId) continue;
    const otherMeta = playerMeta(game, otherId);
    const otherVitals = ensurePlayerVitals(game, otherId);
    if (!otherVitals.alive || otherVitals.spectator) continue;
    if ((game.tick ?? 0) < (otherMeta.grabBlockedUntilTick ?? 0)) continue;
    if (otherMeta.grabbedBy) continue;
    const otherPos = getPlayerPosition(other);
    if (Math.abs(otherPos.y - pos.y) > 1.35) continue;
    const dx = otherPos.x - pos.x;
    const dz = otherPos.z - pos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = otherId;
    }
  }
  if (bestId) {
    meta.grabbedTarget = bestId;
    const targetMeta = playerMeta(game, bestId);
    targetMeta.grabbedBy = playerId;
    return;
  }

  let bestBall = null;
  let bestBallDistSq = BALL_GRAB_RANGE * BALL_GRAB_RANGE;
  const claimedBalls = new Set();
  for (const [otherId] of Object.entries(game.players ?? {})) {
    if (otherId === playerId) continue;
    const otherMeta = playerMeta(game, otherId);
    if (otherMeta.grabbedBallId) claimedBalls.add(otherMeta.grabbedBallId);
  }
  for (const ball of game.pushBalls ?? []) {
    if (!ball?.id || claimedBalls.has(ball.id)) continue;
    const radius = Math.max(0.1, finiteNumber(ball.r, EXTRA_BALL_RADIUS));
    const dx = finiteNumber(ball.x) - pos.x;
    const dy = finiteNumber(ball.y) - (pos.y + 0.5);
    const dz = finiteNumber(ball.z) - pos.z;
    const distSq = dx * dx + dz * dz + dy * dy * 0.35;
    if (distSq > bestBallDistSq + radius * radius) continue;
    bestBallDistSq = distSq;
    bestBall = ball;
  }
  if (bestBall) meta.grabbedBallId = bestBall.id;
}

function processThrow(game, playerId) {
  const player = game.players[playerId];
  if (!player) return;
  const meta = playerMeta(game, playerId);
  const pos = getPlayerPosition(player);
  const rot = getPlayerRotation(player);
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);

  if (meta.grabbedTarget) {
    const target = game.players[meta.grabbedTarget];
    const targetMeta = playerMeta(game, meta.grabbedTarget);
    if (target) {
      setPlayerPosition(target, {
        x: pos.x + fx * 0.75,
        y: pos.y + 0.95,
        z: pos.z + fz * 0.75,
      });
      target[VX] = packNumber(fx * 8, VEL_SCALE);
      target[VY] = packNumber(4.2, VEL_SCALE);
      target[VZ] = packNumber(fz * 8, VEL_SCALE);
      target[ROT] = player[ROT] ?? 0;
      target[ANIM] = ANIM_STATES.indexOf('jump');
      targetMeta.grabbedBy = null;
      targetMeta.throwTick = game.tick ?? 0;
      targetMeta.grabBlockedUntilTick = (game.tick ?? 0) + THROW_REGRAB_BLOCK_TICKS;
    }
    meta.grabbedTarget = null;
  }

  if (meta.grabbedBallId) {
    const ball = (game.pushBalls ?? []).find((entry) => entry?.id === meta.grabbedBallId);
    if (ball) {
      ball.x = Math.round((pos.x + fx * 0.7) * 1000) / 1000;
      ball.y = Math.round((pos.y + 1.05) * 1000) / 1000;
      ball.z = Math.round((pos.z + fz * 0.7) * 1000) / 1000;
      ball.vx = Math.round(fx * 9 * 1000) / 1000;
      ball.vy = 4.8;
      ball.vz = Math.round(fz * 9 * 1000) / 1000;
    }
    meta.grabbedBallId = null;
  }
  meta.grabHeld = false;
  meta.grabBlockedUntilTick = (game.tick ?? 0) + THROW_REGRAB_BLOCK_TICKS;
}

function smackBalls(game, origin, fx, fz, range, speed, upSpeed) {
  let hit = 0;
  for (const ball of game.pushBalls ?? []) {
    if (!ball?.id) continue;
    const dx = finiteNumber(ball.x) - origin.x;
    const dz = finiteNumber(ball.z) - origin.z;
    const dist = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    const radius = Math.max(0.1, finiteNumber(ball.r, EXTRA_BALL_RADIUS));
    if (dist - radius > range) continue;
    const dot = ((dx / dist) * fx) + ((dz / dist) * fz);
    if (dot < 0.18) continue;
    ball.vx = Math.round((dx / dist) * speed * 1000) / 1000;
    ball.vy = upSpeed;
    ball.vz = Math.round((dz / dist) * speed * 1000) / 1000;
    hit += 1;
  }
  return hit;
}

function clearTargetGrabLinks(game, targetId) {
  const targetMeta = playerMeta(game, targetId);
  if (targetMeta.grabbedBy) {
    const grabberMeta = playerMeta(game, targetMeta.grabbedBy);
    if (grabberMeta.grabbedTarget === targetId) grabberMeta.grabbedTarget = null;
    targetMeta.grabbedBy = null;
  }
  if (targetMeta.grabbedTarget) {
    const grabbedMeta = playerMeta(game, targetMeta.grabbedTarget);
    if (grabbedMeta.grabbedBy === targetId) grabbedMeta.grabbedBy = null;
    targetMeta.grabbedTarget = null;
  }
  targetMeta.grabbedBallId = null;
}

function findSmackTarget(game, attackerId, origin, range) {
  let bestId = null;
  let bestDistSq = range * range;
  for (const [otherId, other] of Object.entries(game.players ?? {})) {
    if (otherId === attackerId) continue;
    const otherMeta = ensurePlayerVitals(game, otherId);
    if (!otherMeta.alive || otherMeta.spectator || otherMeta.smackStunTicks > 0) continue;
    const pos = getPlayerPosition(other);
    if (Math.abs(pos.y - origin.y) > 1.6) continue;
    const dx = pos.x - origin.x;
    const dz = pos.z - origin.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = otherId;
    }
  }
  return bestId;
}

function applySmackToPlayer(game, attackerId, targetId, speed, stunTicks, charged = false) {
  const attacker = game.players[attackerId];
  const target = game.players[targetId];
  if (!attacker || !target) return false;
  const attackerPos = getPlayerPosition(attacker);
  const targetPos = getPlayerPosition(target);
  const dx = targetPos.x - attackerPos.x;
  const dz = targetPos.z - attackerPos.z;
  const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const targetMeta = ensurePlayerVitals(game, targetId);
  clearTargetGrabLinks(game, targetId);
  targetMeta.alive = false;
  targetMeta.smackStunTicks = stunTicks;
  targetMeta.throwTick = game.tick ?? 0;
  targetMeta.chargedSmackHitSeq += charged ? 1 : 0;
  targetMeta.grabBlockedUntilTick = (game.tick ?? 0) + THROW_REGRAB_BLOCK_TICKS;
  setPlayerPosition(target, {
    x: attackerPos.x + (dx / len) * 0.7,
    y: Math.max(targetPos.y, attackerPos.y + (charged ? 0.75 : 0.35)),
    z: attackerPos.z + (dz / len) * 0.7,
  });
  target[VX] = packNumber((dx / len) * speed, VEL_SCALE);
  target[VY] = packNumber(charged ? 5.2 : 3.0, VEL_SCALE);
  target[VZ] = packNumber((dz / len) * speed, VEL_SCALE);
  target[ANIM] = ANIM_STATES.indexOf(charged ? 'jump' : 'death');
  return true;
}

function stepSmackedPlayerFlight(player, dt) {
  const pos = getPlayerPosition(player);
  let vx = unpackNumber(player[VX], VEL_SCALE);
  let vy = unpackNumber(player[VY], VEL_SCALE);
  let vz = unpackNumber(player[VZ], VEL_SCALE);

  vy -= 16 * dt;
  const nextX = pos.x + vx * dt;
  const nextZ = pos.z + vz * dt;
  const next = moveAroundBlockers(pos.x, pos.z, nextX, nextZ, 0.36);
  if (Math.abs(next.x - nextX) > 0.001) vx = 0;
  if (Math.abs(next.z - nextZ) > 0.001) vz = 0;

  let nextY = pos.y + vy * dt;
  if (nextY <= 0.1) {
    nextY = 0.1;
    vy = Math.abs(vy) > 2.2 ? Math.abs(vy) * 0.22 : 0;
    vx *= 0.72;
    vz *= 0.72;
  } else {
    vx *= 0.985;
    vz *= 0.985;
  }

  setPlayerPosition(player, { x: next.x, y: nextY, z: next.z });
  player[VX] = packNumber(vx, VEL_SCALE);
  player[VY] = packNumber(vy, VEL_SCALE);
  player[VZ] = packNumber(vz, VEL_SCALE);
}

function processSmack(game, playerId, input) {
  const player = game.players[playerId];
  if (!player) return;
  const meta = ensurePlayerVitals(game, playerId);
  if (!meta.alive || meta.spectator || meta.grabbedTarget || meta.grabbedBallId || meta.smackCooldownTicks > 0) return;

  const charged = input.chargedSmackRelease === true && meta.smackHoldTicks >= CHARGED_SMACK_MIN_TICKS;
  if (!input.smack && !charged) return;

  const chargeT = charged
    ? clamp((meta.smackHoldTicks - CHARGED_SMACK_MIN_TICKS) / Math.max(1, CHARGED_SMACK_MAX_TICKS - CHARGED_SMACK_MIN_TICKS), 0, 1)
    : 0;
  const pos = getPlayerPosition(player);
  const rot = getPlayerRotation(player);
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const range = charged ? CHARGED_SMACK_RANGE : SMACK_RANGE;
  const ballHits = smackBalls(
    game,
    pos,
    fx,
    fz,
    range,
    charged ? CHARGED_SMACK_BALL_MIN_SPEED + (CHARGED_SMACK_BALL_MAX_SPEED - CHARGED_SMACK_BALL_MIN_SPEED) * chargeT : SMACK_BALL_SPEED,
    charged ? CHARGED_SMACK_BALL_MIN_UP + (CHARGED_SMACK_BALL_MAX_UP - CHARGED_SMACK_BALL_MIN_UP) * chargeT : SMACK_BALL_UP,
  );

  let landed = ballHits > 0;
  const targetId = findSmackTarget(game, playerId, pos, range);
  if (targetId) {
    landed = applySmackToPlayer(
      game,
      playerId,
      targetId,
      charged
        ? CHARGED_SMACK_PLAYER_MIN_SPEED + (CHARGED_SMACK_PLAYER_MAX_SPEED - CHARGED_SMACK_PLAYER_MIN_SPEED) * chargeT
        : SMACK_KNOCKBACK_SPEED,
      charged ? Math.ceil(SMACK_STUN_TICKS * 1.25) : SMACK_STUN_TICKS,
      charged,
    ) || landed;
  }

  if (charged) {
    const cat = Array.isArray(game.predators) ? game.predators.find((p) => p?.id === 'cat-0') : null;
    if (cat?.alive !== false) {
      const dx = cat.px - pos.x;
      const dz = cat.pz - pos.z;
      const dist = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
      if (dist <= CHARGED_SMACK_CAT_RANGE) {
        cat.ai = 'stunned';
        cat.st = CHARGED_SMACK_CAT_STUN_TICKS;
        cat.px = Math.round((cat.px + (dx / dist) * CHARGED_SMACK_CAT_KNOCKBACK) * 1000) / 1000;
        cat.pz = Math.round((cat.pz + (dz / dist) * CHARGED_SMACK_CAT_KNOCKBACK) * 1000) / 1000;
        landed = true;
      }
    }
  }

  if (!landed) return;
  meta.smackCooldownTicks = charged ? CHARGED_SMACK_COOLDOWN_TICKS : SMACK_COOLDOWN_TICKS;
  meta.smackHoldTicks = 0;
  meta.smacksLanded += 1;
  if (charged) meta.chargedSmackHitSeq += 1;
}

function collectCheese(game, playerId) {
  if (!Array.isArray(game.cheesePickups) || game.cheesePickups.length <= 0) return;
  const player = game.players[playerId];
  if (!player) return;
  const pos = getPlayerPosition(player);
  const meta = playerMeta(game, playerId);
  for (let i = game.cheesePickups.length - 1; i >= 0; i -= 1) {
    const cheese = game.cheesePickups[i];
    const dx = cheese.x - pos.x;
    const dz = cheese.z - pos.z;
    if (dx * dx + dz * dz > CHEESE_PICKUP_RADIUS_SQ) continue;
    if (Math.abs((cheese.y ?? 0) - pos.y) > 0.75) continue;
    meta.cheeseCarried = Math.max(0, Math.floor(finiteNumber(meta.cheeseCarried))) + Math.max(1, Math.floor(finiteNumber(cheese.amount, 1)));
    game.cheesePickups.splice(i, 1);
  }
}

function spawnCheese(game, position, amount) {
  game.cheesePickups ??= [];
  game.nextCheeseId = Math.max(1, Math.floor(finiteNumber(game.nextCheeseId, 1)));
  const pieces = Math.min(6, Math.max(1, Math.floor(finiteNumber(amount, 6))));
  const perPiece = Math.max(1, Math.floor(finiteNumber(amount, 6) / pieces));
  for (let i = 0; i < pieces; i += 1) {
    const angle = (i / pieces) * Math.PI * 2;
    const radius = 0.55 + (i % 3) * 0.16;
    game.cheesePickups.push({
      id: `cz-${game.nextCheeseId++}`,
      x: Math.round((position.x + Math.cos(angle) * radius) * 1000) / 1000,
      y: Math.round(finiteNumber(position.y) * 1000) / 1000,
      z: Math.round((position.z + Math.sin(angle) * radius) * 1000) / 1000,
      amount: i === pieces - 1 ? Math.max(1, Math.floor(finiteNumber(amount, 6)) - perPiece * (pieces - 1)) : perPiece,
    });
  }
  if (game.cheesePickups.length > MAX_CHEESE_PICKUPS) {
    game.cheesePickups.splice(0, game.cheesePickups.length - MAX_CHEESE_PICKUPS);
  }
}

function syncGrabbedPlayersAndBalls(game) {
  for (const [playerId, player] of Object.entries(game.players ?? {})) {
    const meta = playerMeta(game, playerId);
    if (!meta.grabHeld) {
      clearGrab(game, playerId);
      continue;
    }
    const vitals = ensurePlayerVitals(game, playerId);
    if (!vitals.alive || vitals.spectator) {
      clearGrab(game, playerId);
      continue;
    }
    const pos = getPlayerPosition(player);
    const rot = getPlayerRotation(player);
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);

    if (meta.grabbedTarget) {
      const target = game.players[meta.grabbedTarget];
      const targetMeta = playerMeta(game, meta.grabbedTarget);
      const targetVitals = ensurePlayerVitals(game, meta.grabbedTarget);
      if (!target || !targetVitals.alive || targetVitals.spectator || targetMeta.grabbedBy !== playerId) {
        clearGrab(game, playerId);
      } else {
        setPlayerPosition(target, {
          x: pos.x + fx * 0.15,
          y: pos.y + CARRY_HEIGHT,
          z: pos.z + fz * 0.15,
        });
        target[VX] = player[VX] ?? 0;
        target[VY] = 0;
        target[VZ] = player[VZ] ?? 0;
        target[ROT] = player[ROT] ?? 0;
        target[ANIM] = ANIM_STATES.indexOf('walk');
      }
    }

    if (meta.grabbedBallId) {
      const ball = (game.pushBalls ?? []).find((entry) => entry?.id === meta.grabbedBallId);
      if (!ball) {
        meta.grabbedBallId = null;
      } else {
        ball.x = Math.round((pos.x + fx * 0.15) * 1000) / 1000;
        ball.y = Math.round((pos.y + 0.86 + Math.max(0.1, finiteNumber(ball.r, EXTRA_BALL_RADIUS))) * 1000) / 1000;
        ball.z = Math.round((pos.z + fz * 0.15) * 1000) / 1000;
        ball.qy = Math.sin(rot * 0.5);
        ball.qw = Math.cos(rot * 0.5);
      }
    }
  }
}

function stepPushBalls(game, dt) {
  if (!Array.isArray(game.pushBalls)) return;
  const held = new Set();
  for (const meta of Object.values(game.m ?? {})) {
    if (meta?.grabbedBallId) held.add(meta.grabbedBallId);
  }
  for (const ball of game.pushBalls) {
    if (!ball?.id || held.has(ball.id)) continue;
    let vx = finiteNumber(ball.vx);
    let vy = finiteNumber(ball.vy);
    let vz = finiteNumber(ball.vz);
    if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) <= 0.001) continue;
    vy -= 14 * dt;
    let nx = finiteNumber(ball.x) + vx * dt;
    let ny = finiteNumber(ball.y) + vy * dt;
    let nz = finiteNumber(ball.z) + vz * dt;
    const radius = Math.max(0.1, finiteNumber(ball.r, EXTRA_BALL_RADIUS));
    const resolved = moveAroundBlockers(finiteNumber(ball.x), finiteNumber(ball.z), nx, nz, radius);
    if (resolved.x !== nx) vx *= -0.35;
    if (resolved.z !== nz) vz *= -0.35;
    nx = resolved.x;
    nz = resolved.z;
    if (ny < radius + 0.08) {
      ny = radius + 0.08;
      vy = Math.abs(vy) > 1.2 ? -vy * 0.35 : 0;
      vx *= 0.92;
      vz *= 0.92;
    }
    ball.x = Math.round(nx * 1000) / 1000;
    ball.y = Math.round(ny * 1000) / 1000;
    ball.z = Math.round(nz * 1000) / 1000;
    ball.vx = Math.round(vx * 1000) / 1000;
    ball.vy = Math.round(vy * 1000) / 1000;
    ball.vz = Math.round(vz * 1000) / 1000;
  }
}

function stepPhysicalTasks(game, dt) {
  game.physicalTasks = Array.isArray(game.physicalTasks) ? game.physicalTasks : createPhysicalTaskStates();
  game.taskLatches ??= {};
  for (const task of FRIDGE_TASKS) {
    let state = game.physicalTasks.find((entry) => entry?.id === task.id);
    if (!state) {
      state = { id: task.id, taskType: task.taskType, mode: task.mode, progress: 0, helpers: 0 };
      game.physicalTasks.push(state);
    }
    if (game.completedTaskIds?.includes?.(task.id)) {
      state.progress = 1;
      state.helpers = 0;
      continue;
    }
    const latches = game.taskLatches[task.id] ?? {};
    const yaw = finiteNumber(task.ry);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    let helpers = 0;
    for (const [playerId, player] of Object.entries(game.players ?? {})) {
      const meta = playerMeta(game, playerId);
      const vitals = ensurePlayerVitals(game, playerId);
      const pos = getPlayerPosition(player);
      const shouldLatch = vitals.alive && !vitals.spectator && meta.grabHeld === true && isNearPhysicalTask(pos, task);
      if (!shouldLatch) {
        delete latches[playerId];
        continue;
      }
      clearGrab(game, playerId);
      meta.grabHeld = true;
      const coord = pos.x * rightX + pos.z * rightZ;
      const previous = finiteNumber(latches[playerId], coord);
      const rawDelta = coord - previous;
      const maxDelta = FRIDGE_LATCH_MAX_TRACK_SPEED * Math.max(0.001, dt);
      const delta = clamp(rawDelta, -maxDelta, maxDelta);
      if (delta > 0) {
        state.progress = Math.min(1, finiteNumber(state.progress) + (delta / FRIDGE_OPEN_DISTANCE) * FRIDGE_PUSH_GAIN);
      } else if (delta < -0.015) {
        state.progress = Math.max(0, finiteNumber(state.progress) + (delta / FRIDGE_OPEN_DISTANCE) * FRIDGE_LATCH_PULLBACK);
      }
      latches[playerId] = previous + delta;
      helpers += 1;
    }
    state.helpers = helpers;
    state.progress = Math.round(clamp(finiteNumber(state.progress), 0, 1) * 1000) / 1000;
    game.taskLatches[task.id] = latches;
    if (state.progress >= 1) {
      if (!Array.isArray(game.completedTaskIds)) game.completedTaskIds = [];
      if (!game.completedTaskIds.includes(task.id)) game.completedTaskIds.push(task.id);
      spawnCheese(game, { x: task.x, y: task.y + 0.2, z: task.z }, 22);
      emitGameEvent(game, 'task-completed', {
        playerId: Object.keys(latches)[0] ?? '',
        taskId: task.id,
        taskType: task.taskType,
        amount: 22,
        position: { x: task.x, y: task.y + 0.2, z: task.z },
      });
    }
  }
}

function update({ game }) {
  game.tick = Math.max(0, Math.floor(finiteNumber(game.tick))) + 1;
  for (const [playerId, player] of Object.entries(game.players ?? {})) {
    if (!player) continue;
    const meta = ensurePlayerVitals(game, playerId);
    meta.smackCooldownTicks = Math.max(0, meta.smackCooldownTicks - 1);
    if (meta.smackHeld) meta.smackHoldTicks = Math.min(CHARGED_SMACK_MAX_TICKS, meta.smackHoldTicks + 1);
    else meta.smackHoldTicks = 0;
    if (meta.smackStunTicks > 0) {
      meta.smackStunTicks = Math.max(0, meta.smackStunTicks - 1);
      if (meta.smackStunTicks > 0) stepSmackedPlayerFlight(player, 1 / TICK_RATE);
      if (meta.smackStunTicks <= 0 && meta.livesRemaining > 0 && !meta.spectator) {
        meta.alive = true;
        player[ANIM] = ANIM_STATES.indexOf('idle');
      }
    }
    if (!meta.alive && !meta.spectator && meta.respawnTick != null && game.tick >= meta.respawnTick) {
      respawnPlayer(game, playerId);
    }
  }
  syncGrabbedPlayersAndBalls(game);
  stepPushBalls(game, 1 / TICK_RATE);
  stepPhysicalTasks(game, 1 / TICK_RATE);
  stepCat(game, 1 / TICK_RATE);
}

function input(data, { game, playerId }) {
  const player = game.players[playerId];
  if (!player) return;
  const meta = ensurePlayerVitals(game, playerId);
  if (!meta.alive || meta.spectator) return;
  const pose = sanitizeInput(data);
  if (meta.grabbedBy) {
    game.seqs[playerId] = pose.seq;
    return;
  }
  applyPose(player, pose);
  meta.smackHeld = pose.smackHeld === true;
  if (pose.chargedSmackRelease || pose.smack) {
    processSmack(game, playerId, pose);
    if (pose.chargedSmackRelease) meta.smackHeld = false;
  }
  if (pose.throw) {
    processThrow(game, playerId);
  } else {
    processGrab(game, playerId, pose);
  }
  collectCheese(game, playerId);
  game.seqs[playerId] = pose.seq;
}

function hello(data, { game, playerId }) {
  const player = game.players[playerId];
  if (!player) return;
  game.names ??= {};
  game.names[playerId] = sanitizeDisplayName(data?.displayName);
}

function squeak(data, { game, playerId }) {
  const player = game.players[playerId];
  if (!player) return;
  emitGameEvent(game, 'squeak', {
    playerId,
    position: {
      x: unpackNumber(player[PX], POS_SCALE),
      y: unpackNumber(player[PY], POS_SCALE),
      z: unpackNumber(player[PZ], POS_SCALE),
    },
  });
}

function spawnExtraBall(data, { game, playerId }) {
  const player = game.players[playerId];
  if (!player) return;
  game.pushBalls ??= [];
  game.nextBallId = Math.max(0, Math.floor(finiteNumber(game.nextBallId)));
  const id = `ball-${game.nextBallId}`;
  game.nextBallId += 1;
  const rotation = unpackRotation(player[ROT]);
  const x = unpackNumber(player[PX], POS_SCALE) + Math.sin(rotation) * 1.2;
  const z = unpackNumber(player[PZ], POS_SCALE) + Math.cos(rotation) * 1.2;
  const y = Math.max(unpackNumber(player[PY], POS_SCALE) + 0.45, EXTRA_BALL_RADIUS + 0.12);
  game.pushBalls.push({
    id,
    r: EXTRA_BALL_RADIUS,
    color: colorForId(`${playerId}:${id}`),
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    z: Math.round(z * 1000) / 1000,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  if (game.pushBalls.length > MAX_EXTRA_BALLS) {
    game.pushBalls.splice(0, game.pushBalls.length - MAX_EXTRA_BALLS);
  }
  emitGameEvent(game, 'spawn-extra-ball', { playerId });
}

function taskComplete(data, { game, playerId }) {
  if (!game.players[playerId]) return;
  const taskId = sanitizeShortString(data?.taskId);
  if (!taskId) return;
  if (!Array.isArray(game.completedTaskIds)) game.completedTaskIds = [];
  if (game.completedTaskIds.indexOf(taskId) < 0) game.completedTaskIds.push(taskId);
  const rewardPosition = sanitizeVector3(data?.position, getPlayerPosition(game.players[playerId]));
  spawnCheese(game, rewardPosition, clamp(Math.floor(finiteNumber(data?.amount, 6)), 1, 99));
  emitGameEvent(game, 'task-completed', {
    playerId,
    taskId,
    taskType: sanitizeShortString(data?.taskType, 40),
    amount: clamp(Math.floor(finiteNumber(data?.amount)), 0, 999),
    position: rewardPosition,
  });
}

function unlockPickup(data, { game, playerId }) {
  if (!game.players[playerId]) return;
  const itemId = sanitizeShortString(data?.itemId);
  if (!itemId) return;
  let kind = '';
  if (Array.isArray(game.unlockItems)) {
    const item = game.unlockItems.find((entry) => entry?.id === itemId);
    kind = sanitizeShortString(item?.kind, 20);
    game.unlockItems = game.unlockItems.filter((entry) => entry?.id !== itemId);
  }
  const meta = playerMeta(game, playerId);
  if (kind === 'sewing') meta.sewingCollected = Math.max(0, Math.floor(finiteNumber(meta.sewingCollected))) + 1;
  if (kind === 'speed') meta.speedTokensCollected = Math.max(0, Math.floor(finiteNumber(meta.speedTokensCollected))) + 1;
  emitGameEvent(game, 'unlock-pickup-consumed', {
    playerId,
    itemId,
    kind,
  });
}

function claimHero(data, { game, playerId }) {
  if (!game.players[playerId]) return;
  const heroKey = sanitizeShortString(data?.heroKey, 24);
  if (!heroKey) return;
  game.heroClaims ??= {};
  if (game.heroClaims[heroKey]) return;
  game.heroClaims[heroKey] = playerId;
  const meta = playerMeta(game, playerId);
  meta.isHero = true;
  meta.heroAvatar = heroKey;
  meta.heroAvailable = false;
  meta.heroTimeRemaining = Math.max(0, finiteNumber(meta.heroTimeRemaining, 30) || 30);
  emitGameEvent(game, 'hero-claimed', {
    playerId,
    heroKey,
    taskId: sanitizeShortString(data?.taskId),
  });
}

function purchaseDrone(data, { game, playerId }) {
  if (!game.players[playerId]) return;
  game.dronePurchases ??= {};
  game.dronePurchases[playerId] = {
    ok: false,
    pending: false,
    reason: 'not_available',
    cost: 12,
  };
  emitGameEvent(game, 'drone-purchase-result', {
    playerId,
    ok: false,
    reason: 'not_available',
    cost: 12,
  });
}

Rune.initLogic({
  minPlayers: 1,
  maxPlayers: MAX_PLAYERS,
  landscape: true,
  updatesPerSecond: TICK_RATE,
  setup,
  update,
  actions: {
    input,
    hello,
    squeak,
    spawnExtraBall,
    taskComplete,
    unlockPickup,
    claimHero,
    purchaseDrone,
  },
  events: {
    playerJoined(playerId, { game }) {
      addPlayer(game, playerId);
    },
    playerLeft(playerId, { game }) {
      removePlayer(game, playerId);
    },
  },
});
