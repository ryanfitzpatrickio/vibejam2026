import { PHYSICS } from './physics.js';

export const VIBE_PORTAL_URL = '';
export const VIBE_PORTAL_PARAM_KEYS = Object.freeze([
  'portal',
  'username',
  'color',
  'speed',
  'ref',
  'avatar_url',
  'team',
  'hp',
  'speed_x',
  'speed_y',
  'speed_z',
  'rotation_x',
  'rotation_y',
  'rotation_z',
]);

export const VIBE_PORTAL_POSITIONS = Object.freeze({
  exit: Object.freeze({ x: 8, y: 0, z: -3 }),
  start: Object.freeze({ x: 8, y: 0, z: 4 }),
  arrivalSpawn: Object.freeze({ x: 8, y: 0, z: 4 }),
});

export const VIBE_PORTAL_ROTATIONS = Object.freeze({
  exit: Math.PI,
  start: 0,
  arrival: 0,
});

export const VIBE_PORTAL_TRIGGER_RADIUS = 0.9;
export const VIBE_PORTAL_TYPES = Object.freeze({
  EXIT: 'exit',
  RETURN: 'return',
});

const MAX_ARRIVAL_SPEED = 12;

export function normalizeVibePortalType(value) {
  return value === VIBE_PORTAL_TYPES.RETURN ? VIBE_PORTAL_TYPES.RETURN : VIBE_PORTAL_TYPES.EXIT;
}

export function getDefaultVibePortalPlacements() {
  return {
    exit: {
      id: 'vibe-portal-exit-default',
      name: 'Vibe Jam Portal',
      portalType: VIBE_PORTAL_TYPES.EXIT,
      position: { ...VIBE_PORTAL_POSITIONS.exit },
      rotation: { x: 0, y: VIBE_PORTAL_ROTATIONS.exit, z: 0 },
      triggerRadius: VIBE_PORTAL_TRIGGER_RADIUS,
    },
    return: {
      id: 'vibe-portal-return-default',
      name: 'Return Portal',
      portalType: VIBE_PORTAL_TYPES.RETURN,
      position: { ...VIBE_PORTAL_POSITIONS.start },
      rotation: { x: 0, y: VIBE_PORTAL_ROTATIONS.start, z: 0 },
      triggerRadius: VIBE_PORTAL_TRIGGER_RADIUS,
    },
  };
}

export function normalizeVibePortal(entry = {}) {
  const type = normalizeVibePortalType(entry.portalType);
  const defaults = getDefaultVibePortalPlacements()[type];
  const triggerRadius = Number(entry.triggerRadius);
  return {
    id: entry.id ?? `vibe-portal-${type}`,
    name: entry.name ?? defaults.name,
    portalType: type,
    position: {
      x: Number.isFinite(entry.position?.x) ? entry.position.x : defaults.position.x,
      y: Number.isFinite(entry.position?.y) ? entry.position.y : defaults.position.y,
      z: Number.isFinite(entry.position?.z) ? entry.position.z : defaults.position.z,
    },
    rotation: {
      x: Number.isFinite(entry.rotation?.x) ? entry.rotation.x : defaults.rotation.x,
      y: Number.isFinite(entry.rotation?.y) ? entry.rotation.y : defaults.rotation.y,
      z: Number.isFinite(entry.rotation?.z) ? entry.rotation.z : defaults.rotation.z,
    },
    triggerRadius: Number.isFinite(triggerRadius) && triggerRadius > 0 ? triggerRadius : defaults.triggerRadius,
    deleted: entry.deleted === true,
  };
}

export function collectVibePortalPlacementsFromLayout(layout) {
  const defaults = getDefaultVibePortalPlacements();
  const placements = {
    exit: defaults.exit,
    return: defaults.return,
  };

  for (const entry of layout?.portals ?? []) {
    if (entry?.deleted === true) continue;
    const portal = normalizeVibePortal(entry);
    placements[portal.portalType] = portal;
  }

  return placements;
}

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function readNumberParam(params, key, min, max, fallback = 0) {
  if (!params.has(key)) return fallback;
  return clampNumber(params.get(key), min, max, fallback);
}

export function readVibePortalArrivalFromSearch(search = '') {
  const params = new URLSearchParams(search);
  const active = params.has('portal') && params.get('portal') !== 'false';
  if (!active) {
    return { active: false };
  }

  return {
    active: true,
    ref: params.get('ref') || '',
    velocity: {
      x: readNumberParam(params, 'speed_x', -MAX_ARRIVAL_SPEED, MAX_ARRIVAL_SPEED, 0),
      y: readNumberParam(params, 'speed_y', -MAX_ARRIVAL_SPEED, MAX_ARRIVAL_SPEED, 0),
      z: readNumberParam(params, 'speed_z', -MAX_ARRIVAL_SPEED, MAX_ARRIVAL_SPEED, 0),
    },
    rotation: {
      x: readNumberParam(params, 'rotation_x', -Math.PI * 2, Math.PI * 2, 0),
      y: readNumberParam(params, 'rotation_y', -Math.PI * 2, Math.PI * 2, VIBE_PORTAL_ROTATIONS.arrival),
      z: readNumberParam(params, 'rotation_z', -Math.PI * 2, Math.PI * 2, 0),
    },
    hp: readNumberParam(params, 'hp', 1, 100, 100),
  };
}

export function sanitizePortalArrivalPayload(payload) {
  if (!payload?.active) {
    return { active: false };
  }

  return {
    active: true,
    velocity: {
      x: clampNumber(payload.velocity?.x, -MAX_ARRIVAL_SPEED, MAX_ARRIVAL_SPEED, 0),
      y: clampNumber(payload.velocity?.y, -MAX_ARRIVAL_SPEED, MAX_ARRIVAL_SPEED, 0),
      z: clampNumber(payload.velocity?.z, -MAX_ARRIVAL_SPEED, MAX_ARRIVAL_SPEED, 0),
    },
    rotation: {
      x: clampNumber(payload.rotation?.x, -Math.PI * 2, Math.PI * 2, 0),
      y: clampNumber(payload.rotation?.y, -Math.PI * 2, Math.PI * 2, VIBE_PORTAL_ROTATIONS.arrival),
      z: clampNumber(payload.rotation?.z, -Math.PI * 2, Math.PI * 2, 0),
    },
    hp: clampNumber(payload.hp, 1, 100, 100),
  };
}

export function applyPortalArrivalToPlayerState(state, payload, placements = getDefaultVibePortalPlacements()) {
  const arrival = sanitizePortalArrivalPayload(payload);
  if (!arrival.active || !state) return false;

  const spawn = placements.return?.position ?? VIBE_PORTAL_POSITIONS.arrivalSpawn;
  state.position.x = spawn.x;
  state.position.y = spawn.y;
  state.position.z = spawn.z;
  state.velocity.x = arrival.velocity.x;
  state.velocity.y = arrival.velocity.y;
  state.velocity.z = arrival.velocity.z;
  state.rotation = arrival.rotation.y;
  state.grounded = spawn.y <= 0.001;
  state.stamina = PHYSICS.maxStamina;
  state.staminaRegenTimer = 0;
  state.health = Math.max(1, Math.round(PHYSICS.maxHealth * (arrival.hp / 100)));
  state.alive = true;
  state.sprinting = false;
  state.crouching = false;
  state.sliding = false;
  state.slideTimer = 0;
  state.slideCooldownTimer = 0;
  state.slideDirX = 0;
  state.slideDirZ = 0;
  state.canDoubleJump = true;
  state.hasDoubleJumped = false;
  state.wallHolding = false;
  state.wallNormalX = 0;
  state.wallNormalZ = 0;
  state.wallJumpWindowTimer = 0;
  state.wallAttachCooldownTimer = 0;
  state.animState = 'idle';
  state.deathTime = 0;
  return true;
}
