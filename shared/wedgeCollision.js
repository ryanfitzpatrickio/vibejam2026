const DEFAULT_WEDGE_COLLIDER_STEPS = 12;
const DEFAULT_WEDGE_MAX_STEP_HEIGHT = 0.28;
const MIN_WEDGE_COLLIDER_STEPS = 4;
const MAX_WEDGE_COLLIDER_STEPS = 160;
const WEDGE_FACE_EPSILON = 0.025;
const WEDGE_RAY_EPSILON = 1e-6;

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

export function getWedgeColliderStepCountForScale(scale = {}, maxStepHeight = DEFAULT_WEDGE_MAX_STEP_HEIGHT) {
  const scaleY = Math.abs(Number(scale.y) || 1);
  const scaleZ = Math.abs(Number(scale.z) || 1);
  const verticalSpan = Math.max(scaleY, scaleZ);
  const targetStepHeight = Math.max(0.05, Number(maxStepHeight) || DEFAULT_WEDGE_MAX_STEP_HEIGHT);
  return Math.max(
    MIN_WEDGE_COLLIDER_STEPS,
    Math.min(MAX_WEDGE_COLLIDER_STEPS, Math.ceil(verticalSpan / targetStepHeight)),
  );
}

export function createWedgeLocalColliderBoxesForScale(scale = {}, maxStepHeight = DEFAULT_WEDGE_MAX_STEP_HEIGHT) {
  return createWedgeLocalColliderBoxes(getWedgeColliderStepCountForScale(scale, maxStepHeight));
}

function vector(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function subtract(a, b) {
  return vector(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return vector(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function scaleVector(a, scalar) {
  return vector(a.x * scalar, a.y * scalar, a.z * scalar);
}

function addScaled3(a, bx, x, by, y, bz, z) {
  return vector(
    a.x + bx.x * x + by.x * y + bz.x * z,
    a.y + bx.y * x + by.y * y + bz.y * z,
    a.z + bx.z * x + by.z * y + bz.z * z,
  );
}

function normalize(a) {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len <= WEDGE_RAY_EPSILON) return vector(0, 0, 0);
  return scaleVector(a, 1 / len);
}

function inverseBasisRows(basisX, basisY, basisZ) {
  const det = dot(basisX, cross(basisY, basisZ));
  if (Math.abs(det) <= WEDGE_RAY_EPSILON) return null;
  const invDet = 1 / det;
  return [
    scaleVector(cross(basisY, basisZ), invDet),
    scaleVector(cross(basisZ, basisX), invDet),
    scaleVector(cross(basisX, basisY), invDet),
  ];
}

export function createWedgeColliderDescriptor(origin, basisX, basisY, basisZ) {
  const inverseRows = inverseBasisRows(basisX, basisY, basisZ);
  if (!inverseRows) return null;
  return {
    origin: vector(origin.x, origin.y, origin.z),
    basisX: vector(basisX.x, basisX.y, basisX.z),
    basisY: vector(basisY.x, basisY.y, basisY.z),
    basisZ: vector(basisZ.x, basisZ.y, basisZ.z),
    inverseRows,
  };
}

export function worldToWedgeLocal(wedge, point) {
  if (!wedge?.inverseRows || !wedge?.origin) return null;
  const d = subtract(point, wedge.origin);
  return vector(
    dot(wedge.inverseRows[0], d),
    dot(wedge.inverseRows[1], d),
    dot(wedge.inverseRows[2], d),
  );
}

export function wedgeLocalToWorld(wedge, point) {
  if (!wedge?.origin || !wedge?.basisX || !wedge?.basisY || !wedge?.basisZ) return null;
  return addScaled3(wedge.origin, wedge.basisX, point.x, wedge.basisY, point.y, wedge.basisZ, point.z);
}

function worldNormalFromLocal(wedge, localNormal) {
  if (!wedge?.inverseRows) return vector(0, 0, 0);
  return normalize(vector(
    wedge.inverseRows[0].x * localNormal.x + wedge.inverseRows[1].x * localNormal.y + wedge.inverseRows[2].x * localNormal.z,
    wedge.inverseRows[0].y * localNormal.x + wedge.inverseRows[1].y * localNormal.y + wedge.inverseRows[2].y * localNormal.z,
    wedge.inverseRows[0].z * localNormal.x + wedge.inverseRows[1].z * localNormal.y + wedge.inverseRows[2].z * localNormal.z,
  ));
}

function localInsideWedgeFace(local, face, margin = WEDGE_FACE_EPSILON) {
  if (!local) return false;
  if (local.x < -0.5 - margin || local.x > 0.5 + margin) return false;

  if (face === 'slope') {
    return local.z >= -0.5 - margin
      && local.z <= 0.5 + margin
      && local.y >= -0.5 - margin
      && local.y <= 0.5 + margin
      && Math.abs(local.y + local.z) <= margin * 2;
  }

  if (face === 'bottom') {
    return local.z >= -0.5 - margin
      && local.z <= 0.5 + margin
      && Math.abs(local.y + 0.5) <= margin * 2;
  }

  if (face === 'back') {
    return local.y >= -0.5 - margin
      && local.y <= 0.5 + margin
      && Math.abs(local.z + 0.5) <= margin * 2;
  }

  if (face === 'left' || face === 'right') {
    const expectedX = face === 'left' ? -0.5 : 0.5;
    return Math.abs(local.x - expectedX) <= margin * 2
      && local.z >= -0.5 - margin
      && local.z <= 0.5 + margin
      && local.y >= -0.5 - margin
      && local.y <= -local.z + margin;
  }

  return false;
}

function intersectVerticalPlane(wedge, worldX, worldZ, planeNormal, planeOffset, face) {
  if (!wedge?.inverseRows) return null;
  const p0 = vector(worldX, 0, worldZ);
  const d = subtract(p0, wedge.origin);
  const localAtZero = vector(
    dot(wedge.inverseRows[0], d),
    dot(wedge.inverseRows[1], d),
    dot(wedge.inverseRows[2], d),
  );
  const localPerWorldY = vector(
    wedge.inverseRows[0].y,
    wedge.inverseRows[1].y,
    wedge.inverseRows[2].y,
  );
  const denom = dot(planeNormal, localPerWorldY);
  if (Math.abs(denom) <= WEDGE_RAY_EPSILON) return null;

  const worldY = -(dot(planeNormal, localAtZero) + planeOffset) / denom;
  if (!Number.isFinite(worldY)) return null;
  const local = worldToWedgeLocal(wedge, vector(worldX, worldY, worldZ));
  if (!localInsideWedgeFace(local, face)) return null;
  return { y: worldY, local };
}

const WEDGE_SURFACES = Object.freeze([
  {
    face: 'back',
    planeNormal: Object.freeze({ x: 0, y: 0, z: -1 }),
    planeOffset: -0.5,
    faceNormal: Object.freeze({ x: 0, y: 0, z: -1 }),
  },
  {
    face: 'bottom',
    planeNormal: Object.freeze({ x: 0, y: -1, z: 0 }),
    planeOffset: -0.5,
    faceNormal: Object.freeze({ x: 0, y: -1, z: 0 }),
  },
  {
    face: 'slope',
    planeNormal: Object.freeze({ x: 0, y: 1, z: 1 }),
    planeOffset: 0,
    faceNormal: Object.freeze({ x: 0, y: 1, z: 1 }),
  },
  {
    face: 'left',
    planeNormal: Object.freeze({ x: -1, y: 0, z: 0 }),
    planeOffset: -0.5,
    faceNormal: Object.freeze({ x: -1, y: 0, z: 0 }),
  },
  {
    face: 'right',
    planeNormal: Object.freeze({ x: 1, y: 0, z: 0 }),
    planeOffset: -0.5,
    faceNormal: Object.freeze({ x: 1, y: 0, z: 0 }),
  },
]);

function sampleWedgeVerticalSurfaceY(wedge, worldX, worldZ, radius = 0, normalTest = () => true) {
  const samples = [
    { x: worldX, z: worldZ },
  ];
  const r = Math.max(0, Number(radius) || 0);
  if (r > 0.001) {
    samples.push(
      { x: worldX + r, z: worldZ },
      { x: worldX - r, z: worldZ },
      { x: worldX, z: worldZ + r },
      { x: worldX, z: worldZ - r },
    );
  }

  let bestY = null;
  for (const surface of WEDGE_SURFACES) {
    const normal = worldNormalFromLocal(wedge, surface.faceNormal);
    if (!normalTest(normal)) continue;
    for (const sample of samples) {
      const hit = intersectVerticalPlane(
        wedge,
        sample.x,
        sample.z,
        surface.planeNormal,
        surface.planeOffset,
        surface.face,
      );
      if (!hit) continue;
      bestY = bestY == null ? hit.y : Math.max(bestY, hit.y);
    }
  }
  return bestY;
}

export function sampleWedgeSupportY(wedge, worldX, worldZ, radius = 0) {
  return sampleWedgeVerticalSurfaceY(wedge, worldX, worldZ, radius, (normal) => normal.y > 0.08);
}

export function sampleWedgeCeilingY(wedge, worldX, worldZ, radius = 0) {
  return sampleWedgeVerticalSurfaceY(wedge, worldX, worldZ, radius, (normal) => normal.y < -0.08);
}
