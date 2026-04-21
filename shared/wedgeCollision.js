const DEFAULT_WEDGE_COLLIDER_STEPS = 12;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function wedgeTopYAtLocalZ(z) {
  return -z;
}

export function createWedgeLocalColliderBoxes(stepCount = DEFAULT_WEDGE_COLLIDER_STEPS) {
  const steps = Math.max(2, Math.floor(stepCount) || DEFAULT_WEDGE_COLLIDER_STEPS);
  const boxes = [];

  for (let index = 0; index < steps; index += 1) {
    const t0 = index / steps;
    const t1 = (index + 1) / steps;
    const z0 = -0.5 + t0;
    const z1 = -0.5 + t1;
    const midZ = -0.5 + (t0 + t1) * 0.5;
    const topY = Math.max(-0.5, wedgeTopYAtLocalZ(midZ));
    if (topY <= -0.5) continue;

    boxes.push({
      min: { x: -0.5, y: -0.5, z: z0 },
      max: { x: 0.5, y: topY, z: z1 },
    });
  }

  return boxes;
}

export function sampleWedgeHeightAtLocalZ(z) {
  const normalized = clamp01((z + 0.5));
  return wedgeTopYAtLocalZ(-0.5 + normalized);
}
