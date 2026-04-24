import { sortCollidersForPlaneZIndex } from './physics.js';
import { createWedgeLocalColliderBoxes } from './wedgeCollision.js';

export const ROOM_COLLISION_CONFIG = Object.freeze({
  scaleFactor: 1,
});

const CYLINDER_SEGMENTS = 24;
const GLB_COLLIDER_BOUNDS_BY_ASSET_ID = Object.freeze({
  // Local-space bounds from the optimized GLB asset. Using the true mesh extents
  // keeps the server collider aligned with the client and leaves the undercarriage open.
  'asset-mnnc9723-f5tn1': Object.freeze({
    min: Object.freeze({ x: -0.91017, y: -0.00011, z: -2.39234 }),
    max: Object.freeze({ x: 0.91017, y: 1.28011, z: 1.96239 }),
  }),
});

export function getGlbColliderLocalBounds(assetId) {
  return GLB_COLLIDER_BOUNDS_BY_ASSET_ID[assetId] ?? null;
}

function scaleVec3(value = {}, scaleFactor = 1) {
  return {
    x: (value.x ?? 0) * scaleFactor,
    y: (value.y ?? 0) * scaleFactor,
    z: (value.z ?? 0) * scaleFactor,
  };
}

function defaultScale(value = {}) {
  return {
    x: value.x ?? 1,
    y: value.y ?? 1,
    z: value.z ?? 1,
  };
}

function rotateEulerXYZ(point, rotation = {}) {
  const x = point.x ?? 0;
  const y = point.y ?? 0;
  const z = point.z ?? 0;
  const rx = rotation.x ?? 0;
  const ry = rotation.y ?? 0;
  const rz = rotation.z ?? 0;

  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const c = Math.cos(ry);
  const d = Math.sin(ry);
  const e = Math.cos(rz);
  const f = Math.sin(rz);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  return {
    x: (c * e) * x + (-c * f) * y + d * z,
    y: (af + be * d) * x + (ae - bf * d) * y + (-b * c) * z,
    z: (bf - ae * d) * x + (be + af * d) * y + (a * c) * z,
  };
}

function getPlaneWorldNormal(primitive) {
  const primitiveNormal = rotateEulerXYZ({ x: 0, y: 0, z: 1 }, primitive.rotation);

  if (!primitive.prefabInstanceId) {
    return primitiveNormal;
  }

  return rotateEulerXYZ(primitiveNormal, primitive.prefabInstanceRotation);
}

function applyTransform(point, {
  position = { x: 0, y: 0, z: 0 },
  rotation = { x: 0, y: 0, z: 0 },
  scale = { x: 1, y: 1, z: 1 },
} = {}) {
  const scaled = {
    x: (point.x ?? 0) * (scale.x ?? 1),
    y: (point.y ?? 0) * (scale.y ?? 1),
    z: (point.z ?? 0) * (scale.z ?? 1),
  };
  const rotated = rotateEulerXYZ(scaled, rotation);
  return {
    x: rotated.x + (position.x ?? 0),
    y: rotated.y + (position.y ?? 0),
    z: rotated.z + (position.z ?? 0),
  };
}

function colliderTypeForPrimitive(primitive) {
  if (primitive.type !== 'plane') {
    return 'furniture';
  }

  const normal = getPlaneWorldNormal(primitive);
  return normal.y >= 0.75 ? 'surface' : 'wall';
}

function createBoxPoints() {
  const points = [];
  for (const x of [-0.5, 0.5]) {
    for (const y of [-0.5, 0.5]) {
      for (const z of [-0.5, 0.5]) {
        points.push({ x, y, z });
      }
    }
  }
  return points;
}

function createPointsFromBounds(bounds) {
  if (!bounds?.min || !bounds?.max) {
    return createBoxPoints();
  }

  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        points.push({ x, y, z });
      }
    }
  }
  return points;
}

function createPlanePoints() {
  return [
    { x: -0.5, y: -0.5, z: 0 },
    { x: 0.5, y: -0.5, z: 0 },
    { x: 0.5, y: 0.5, z: 0 },
    { x: -0.5, y: 0.5, z: 0 },
  ];
}

function createCylinderPoints() {
  const points = [];
  for (let i = 0; i < CYLINDER_SEGMENTS; i += 1) {
    const angle = (i / CYLINDER_SEGMENTS) * Math.PI * 2;
    const x = Math.cos(angle) * 0.5;
    const z = Math.sin(angle) * 0.5;
    points.push({ x, y: -0.5, z });
    points.push({ x, y: 0.5, z });
  }
  return points;
}

function createWedgePoints() {
  return [
    // back
    { x: -0.5, y: -0.5, z: -0.5 },
    { x: -0.5, y: 0.5, z: -0.5 },
    { x: 0.5, y: 0.5, z: -0.5 },
    { x: 0.5, y: -0.5, z: -0.5 },
    // bottom front edge
    { x: -0.5, y: -0.5, z: 0.5 },
    { x: 0.5, y: -0.5, z: 0.5 },
  ];
}

function createBoxCornerPoints(bounds) {
  if (!bounds?.min || !bounds?.max) return createBoxPoints();
  return createPointsFromBounds(bounds);
}

function getPrimitiveLocalPoints(primitive) {
  switch (primitive.type) {
    case 'plane':
      return createPlanePoints();
    case 'cylinder':
      return createCylinderPoints();
    case 'wedge':
      return createWedgePoints();
    case 'glb':
      return createPointsFromBounds(GLB_COLLIDER_BOUNDS_BY_ASSET_ID[primitive.glbAssetId]);
    case 'box':
    default:
      return createBoxPoints();
  }
}

function createEmptyAabb() {
  return {
    min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
    max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
  };
}

function expandAabb(aabb, point) {
  aabb.min.x = Math.min(aabb.min.x, point.x);
  aabb.min.y = Math.min(aabb.min.y, point.y);
  aabb.min.z = Math.min(aabb.min.z, point.z);
  aabb.max.x = Math.max(aabb.max.x, point.x);
  aabb.max.y = Math.max(aabb.max.y, point.y);
  aabb.max.z = Math.max(aabb.max.z, point.z);
}

function transformPrimitivePoint(point, primitive, scaleFactor = 1) {
  const localPoint = applyTransform(point, {
    position: scaleVec3(primitive.position, scaleFactor),
    rotation: primitive.rotation,
    scale: scaleVec3(defaultScale(primitive.scale), scaleFactor),
  });

  if (!primitive.prefabInstanceId) {
    return localPoint;
  }

  return applyTransform(localPoint, {
    position: scaleVec3(primitive.prefabInstanceOrigin, scaleFactor),
    rotation: primitive.prefabInstanceRotation,
    scale: defaultScale(primitive.prefabInstanceScale),
  });
}

function buildPrimitiveAabb(primitive, scaleFactor = 1) {
  const points = getPrimitiveLocalPoints(primitive);
  const aabb = createEmptyAabb();

  for (const point of points) {
    expandAabb(aabb, transformPrimitivePoint(point, primitive, scaleFactor));
  }

  const clearance = primitive.colliderClearance ?? 0;
  if (clearance > 0) {
    aabb.min.y += clearance * scaleFactor;
  }

  return aabb;
}

function buildLocalBoundsAabb(bounds, primitive, scaleFactor = 1) {
  const points = createBoxCornerPoints(bounds);
  const aabb = createEmptyAabb();

  for (const point of points) {
    expandAabb(aabb, transformPrimitivePoint(point, primitive, scaleFactor));
  }

  return aabb;
}

export function buildRoomCollidersFromLayout(layout, {
  scaleFactor = ROOM_COLLISION_CONFIG.scaleFactor,
} = {}) {
  const primitives = Array.isArray(layout?.primitives) ? layout.primitives : [];
  const colliders = [];

  for (const primitive of primitives) {
    if (!primitive || primitive.deleted === true) continue;

    const colliderType = colliderTypeForPrimitive(primitive);
    // Outer room shells are often plane primitives with collider: false (visual-only in editor).
    // Still emit wall-type planes so shared physics + Cannon use the same room bounds.
    const wallPlaneAlwaysSolid = primitive.type === 'plane' && colliderType === 'wall';
    if (primitive.collider === false && !wallPlaneAlwaysSolid) continue;

    const metadata = {
      source: 'layout',
      primitiveId: primitive.id ?? null,
      primitiveName: primitive.name ?? null,
      prefabId: primitive.prefabId ?? null,
      prefabInstanceId: primitive.prefabInstanceId ?? null,
      glbAssetId: primitive.glbAssetId ?? null,
      colliderClearance: primitive.colliderClearance ?? 0,
      runnable: colliderType === 'surface',
    };
    if (primitive.type === 'plane' && colliderType === 'surface') {
      metadata.plane = true;
      metadata.zIndex = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
    }

    if (primitive.type === 'wedge') {
      const boxes = createWedgeLocalColliderBoxes();
      boxes.forEach((localBox, index) => {
        colliders.push({
          type: colliderType,
          metadata: {
            ...metadata,
            wedgeProxy: true,
            wedgeProxyIndex: index,
          },
          aabb: buildLocalBoundsAabb(localBox, primitive, scaleFactor),
        });
      });
      continue;
    }

    colliders.push({
      type: colliderType,
      metadata,
      aabb: buildPrimitiveAabb(primitive, scaleFactor),
    });
  }

  return sortCollidersForPlaneZIndex(colliders);
}
