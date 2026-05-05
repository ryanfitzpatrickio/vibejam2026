const TICK_RATE = 30;
const MAX_PLAYERS = 6;
const WORLD = {
  minX: -48,
  maxX: 48,
  minZ: -48,
  maxZ: 48,
};
const SPAWNS = [
  { x: -3, y: 0, z: -3 },
  { x: 3, y: 0, z: -3 },
  { x: -3, y: 0, z: 3 },
  { x: 3, y: 0, z: 3 },
  { x: 0, y: 0, z: -6 },
  { x: 0, y: 0, z: 6 },
];
const EMOTES = ['wave', 'dance', 'cheer', 'point', 'flex', 'clap', 'laugh', 'sit', 'sleep'];
const ANIM_STATES = ['idle', 'walk', 'run', 'jump', 'death', 'slide'];

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

function sanitizeDisplayName(value) {
  const text = String(value ?? '').trim().slice(0, 24);
  return text || 'Mouse';
}

function sanitizeVector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finiteNumber(value?.x, fallback.x),
    y: finiteNumber(value?.y, fallback.y),
    z: finiteNumber(value?.z, fallback.z),
  };
}

function createPlayerState(id, index) {
  const spawn = SPAWNS[index % SPAWNS.length] ?? SPAWNS[0];
  return {
    p: [spawn.x, spawn.y, spawn.z],
    v: [0, 0, 0],
    r: 0,
    a: 'idle',
    g: true,
    s: false,
    c: false,
    l: false,
    e: null,
  };
}

function sanitizeInput(data) {
  const rawEmote = data?.e ?? data?.emote;
  const emote = typeof rawEmote === 'string' && EMOTES.indexOf(rawEmote) >= 0
    ? rawEmote
    : null;
  const compactPosition = Array.isArray(data?.p) ? data.p : null;
  const compactVelocity = Array.isArray(data?.v) ? data.v : null;
  const position = compactPosition
    ? { x: compactPosition[0], y: compactPosition[1], z: compactPosition[2] }
    : data?.position;
  const velocity = compactVelocity
    ? { x: compactVelocity[0], y: compactVelocity[1], z: compactVelocity[2] }
    : data?.velocity;
  const animState = data?.a ?? data?.animState;
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
    rotation: clampRotation(data?.rotation),
    position: sanitizeVector3(position),
    velocity: sanitizeVector3(velocity),
    grounded: (data?.g ?? data?.grounded) === true,
    sprinting: (data?.s ?? data?.sprinting) === true,
    crouching: (data?.c ?? data?.crouching) === true,
    sliding: (data?.l ?? data?.sliding) === true,
    animState: ANIM_STATES.indexOf(animState) >= 0 ? animState : 'idle',
    emote,
  };
}

function addPlayer(game, playerId) {
  if (game.players[playerId]) return;
  game.playerOrder.push(playerId);
  game.players[playerId] = createPlayerState(playerId, game.playerOrder.length - 1);
  game.seqs[playerId] = -1;
}

function removePlayer(game, playerId) {
  delete game.players[playerId];
  delete game.seqs[playerId];
  game.playerOrder = game.playerOrder.filter((id) => id !== playerId);
}

function setup(allPlayerIds) {
  const game = {
    version: 1,
    tick: 0,
    playerOrder: [],
    players: {},
    seqs: {},
  };
  for (const playerId of allPlayerIds) addPlayer(game, playerId);
  return game;
}

function applyPose(state, input) {
  state.p[0] = clamp(input.position.x, WORLD.minX + 0.22, WORLD.maxX - 0.22);
  state.p[1] = clamp(input.position.y, -12, 24);
  state.p[2] = clamp(input.position.z, WORLD.minZ + 0.22, WORLD.maxZ - 0.22);
  state.v[0] = clamp(input.velocity.x, -80, 80);
  state.v[1] = clamp(input.velocity.y, -80, 80);
  state.v[2] = clamp(input.velocity.z, -80, 80);
  state.r = input.rotation;
  state.a = input.animState;
  state.g = input.grounded;
  state.s = input.sprinting;
  state.c = input.crouching;
  state.l = input.sliding;
  state.e = input.emote;
}

function update({ game }) {
  game.tick += 1;
}

function input(data, { game, playerId }) {
  const player = game.players[playerId];
  if (!player) return;
  const pose = sanitizeInput(data);
  applyPose(player, pose);
  game.seqs[playerId] = pose.seq;
}

function hello(data, { game, playerId }) {
  const player = game.players[playerId];
  if (!player) return;
}

function squeak(data, { game, playerId }) {
}

function spawnExtraBall() {}

function taskComplete(data, { game }) {
}

function unlockPickup(data, { game }) {
}

function claimHero(data, { game, playerId }) {
}

function purchaseDrone(data, { game, playerId }) {
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
