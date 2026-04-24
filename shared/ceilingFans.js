function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cloneVector3(source, fallback) {
  return {
    x: Number.isFinite(source?.x) ? source.x : fallback.x,
    y: Number.isFinite(source?.y) ? source.y : fallback.y,
    z: Number.isFinite(source?.z) ? source.z : fallback.z,
  };
}

export const DEFAULT_CEILING_FAN_BLADE_COUNT = 4;
export const DEFAULT_CEILING_FAN_BLADE_LENGTH = 1.1;
export const DEFAULT_CEILING_FAN_HUB_RADIUS = 0.18;
export const DEFAULT_CEILING_FAN_ROD_LENGTH = 0.34;
export const DEFAULT_CEILING_FAN_SPIN_SPEED = 2.6;
export const DEFAULT_CEILING_FAN_CHEESE_AMOUNT = 12;
export const DEFAULT_CEILING_FAN_GRIP_RING_COUNT = 5;
export const CEILING_FAN_GRAB_RANGE = 0.7;
export const CEILING_FAN_CENTER_PICKUP_RADIUS = 0.42;

export function createCeilingFanId() {
  return `fan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeCeilingFan(entry = {}) {
  return {
    id: typeof entry.id === 'string' && entry.id.length > 0
      ? entry.id
      : createCeilingFanId(),
    name: typeof entry.name === 'string' && entry.name.length > 0
      ? entry.name
      : 'ceiling-fan',
    position: cloneVector3(entry.position, { x: 0, y: 3.35, z: 0 }),
    rotation: cloneVector3(entry.rotation, { x: 0, y: 0, z: 0 }),
    bladeCount: Math.round(clampNumber(entry.bladeCount, 2, 8, DEFAULT_CEILING_FAN_BLADE_COUNT)),
    bladeLength: clampNumber(entry.bladeLength, 0.45, 3.4, DEFAULT_CEILING_FAN_BLADE_LENGTH),
    hubRadius: clampNumber(entry.hubRadius, 0.08, 0.75, DEFAULT_CEILING_FAN_HUB_RADIUS),
    rodLength: clampNumber(entry.rodLength, 0.08, 1.5, DEFAULT_CEILING_FAN_ROD_LENGTH),
    spinSpeed: clampNumber(entry.spinSpeed, 0.1, 12, DEFAULT_CEILING_FAN_SPIN_SPEED),
    gripRingCount: Math.round(clampNumber(entry.gripRingCount, 2, 8, DEFAULT_CEILING_FAN_GRIP_RING_COUNT)),
    cheeseAmount: Math.round(clampNumber(entry.cheeseAmount, 1, 99, DEFAULT_CEILING_FAN_CHEESE_AMOUNT)),
    deleted: entry.deleted === true,
  };
}
