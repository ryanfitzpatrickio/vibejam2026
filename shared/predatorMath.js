export function distXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distSqXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function normalizeXZ(v) {
  const len = Math.sqrt(v.x * v.x + v.z * v.z);
  if (len < 0.0001) return { x: 0, z: 0 };
  return { x: v.x / len, z: v.z / len };
}

export function getVerticalSpan(positionY, height) {
  return {
    min: positionY,
    max: positionY + Math.max(0, height ?? 0),
  };
}

export function spansOverlap(a, b) {
  return a.min <= b.max && a.max >= b.min;
}

export function angleDiff(target, current) {
  let delta = target - current;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
