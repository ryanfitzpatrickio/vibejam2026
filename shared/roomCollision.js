import { sortCollidersForPlaneZIndex } from './physics.js';
import { createWedgeColliderDescriptor } from './wedgeCollision.js';

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
const GLB_COMPOUND_COLLIDER_BOUNDS_BY_ASSET_ID = Object.freeze({
  'asset-mnnc9723-f5tn1': Object.freeze([
    // Main car body. Starts above the ground so mice can navigate the open undercarriage.
    Object.freeze({
      name: 'body',
      min: Object.freeze({ x: -0.86, y: 0.28, z: -2.22 }),
      max: Object.freeze({ x: 0.86, y: 0.82, z: 1.78 }),
    }),
    // Roof/cabin volume.
    Object.freeze({
      name: 'cabin',
      min: Object.freeze({ x: -0.68, y: 0.72, z: -0.86 }),
      max: Object.freeze({ x: 0.68, y: 1.28011, z: 0.82 }),
    }),
    // Wheel/contact blocks. These preserve tire hits without filling the whole underside.
    Object.freeze({
      name: 'front-left-wheel',
      min: Object.freeze({ x: -0.94, y: -0.00011, z: -1.82 }),
      max: Object.freeze({ x: -0.52, y: 0.48, z: -1.12 }),
    }),
    Object.freeze({
      name: 'front-right-wheel',
      min: Object.freeze({ x: 0.52, y: -0.00011, z: -1.82 }),
      max: Object.freeze({ x: 0.94, y: 0.48, z: -1.12 }),
    }),
    Object.freeze({
      name: 'rear-left-wheel',
      min: Object.freeze({ x: -0.94, y: -0.00011, z: 0.98 }),
      max: Object.freeze({ x: -0.52, y: 0.48, z: 1.68 }),
    }),
    Object.freeze({
      name: 'rear-right-wheel',
      min: Object.freeze({ x: 0.52, y: -0.00011, z: 0.98 }),
      max: Object.freeze({ x: 0.94, y: 0.48, z: 1.68 }),
    }),
  ]),
});
const VEGETATION_COLLIDER_SHAPES_BY_SPECIES_ID = Object.freeze({
  'tree-glb-a': Object.freeze({
    kind: 'tree',
    collision: 'cylinder',
    baseHeight: 2.55,
    size: Object.freeze({
      widthMin: 1.2,
      widthMax: 2.4,
      heightMin: 2.4,
      heightMax: 4.6,
    }),
    shape: Object.freeze({
      width: 0.56,
      depth: 0.56,
      radius: 0.28,
      height: 2.55,
      offsetY: 1.275,
    }),
  }),
  'veg-species-moh2ros3-9lu5s': Object.freeze({
    kind: 'tree',
    collision: 'cylinder',
    baseHeight: 3.4690008088252835,
    size: Object.freeze({
      widthMin: 0.3,
      widthMax: 0.3,
      heightMin: 0.35,
      heightMax: 0.6,
    }),
    shape: Object.freeze({
      width: 0.84,
      depth: 0.84,
      radius: 0.42,
      height: 3.25,
      offsetY: 1.625,
    }),
  }),
});

function hashSeed(value) {
  const input = String(value ?? '');
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return (hash >>> 0) || 1;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getGlbColliderLocalBounds(assetId) {
  return GLB_COLLIDER_BOUNDS_BY_ASSET_ID[assetId] ?? null;
}

export function getGlbCompoundColliderLocalBounds(assetId) {
  return GLB_COMPOUND_COLLIDER_BOUNDS_BY_ASSET_ID[assetId] ?? null;
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

function getTaskPrefabPlaneWorldNormal(part, task, prefab) {
  const partNormal = rotateEulerXYZ({ x: 0, y: 0, z: 1 }, part.rotation);
  const prefabNormal = rotateEulerXYZ(partNormal, prefab?.rotation);
  return rotateEulerXYZ(prefabNormal, task?.rotation);
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

function colliderTypeForTaskPrefabPart(part, task, prefab) {
  if (part.type !== 'plane') {
    return 'furniture';
  }
  const normal = getTaskPrefabPlaneWorldNormal(part, task, prefab);
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
    case 'glb': {
      const compoundBounds = GLB_COMPOUND_COLLIDER_BOUNDS_BY_ASSET_ID[primitive.glbAssetId];
      if (compoundBounds?.length) {
        return compoundBounds.flatMap((bounds) => createPointsFromBounds(bounds));
      }
      return createPointsFromBounds(GLB_COLLIDER_BOUNDS_BY_ASSET_ID[primitive.glbAssetId]);
    }
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

function transformTaskPrefabPoint(point, part, task, prefab, scaleFactor = 1) {
  const localPoint = applyTransform(point, {
    position: scaleVec3(part.position, scaleFactor),
    rotation: part.rotation,
    scale: scaleVec3(defaultScale(part.scale), scaleFactor),
  });
  const prefabPoint = applyTransform(localPoint, {
    position: scaleVec3(prefab?.position, scaleFactor),
    rotation: prefab?.rotation,
    scale: defaultScale(prefab?.scale),
  });
  return applyTransform(prefabPoint, {
    position: scaleVec3(task?.position, scaleFactor),
    rotation: task?.rotation,
    scale: { x: 1, y: 1, z: 1 },
  });
}

export function buildPrimitiveAabb(primitive, scaleFactor = 1) {
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

function buildTaskPrefabPartAabb(part, task, prefab, scaleFactor = 1) {
  const points = getPrimitiveLocalPoints(part);
  const aabb = createEmptyAabb();

  for (const point of points) {
    expandAabb(aabb, transformTaskPrefabPoint(point, part, task, prefab, scaleFactor));
  }

  const clearance = part.colliderClearance ?? 0;
  if (clearance > 0) {
    aabb.min.y += clearance * scaleFactor;
  }

  return aabb;
}

function buildTaskPrefabLocalBoundsAabb(bounds, part, task, prefab, scaleFactor = 1) {
  const points = createBoxCornerPoints(bounds);
  const aabb = createEmptyAabb();

  for (const point of points) {
    expandAabb(aabb, transformTaskPrefabPoint(point, part, task, prefab, scaleFactor));
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

function getVegetationColliderConfig(placement) {
  if (!placement || placement.deleted === true) return null;
  if (placement.collision === 'none') return null;
  const libraryConfig = VEGETATION_COLLIDER_SHAPES_BY_SPECIES_ID[placement.speciesId] ?? null;
  const kind = placement.kind ?? libraryConfig?.kind ?? null;
  if (kind !== 'tree') return null;
  const shape = placement.collisionShape ?? libraryConfig?.shape ?? null;
  if (!shape) return null;
  return {
    kind,
    collision: placement.collision ?? libraryConfig?.collision ?? 'cylinder',
    shape,
    size: placement.size ?? libraryConfig?.size ?? null,
    baseHeight: Number(placement.visualBaseHeight ?? libraryConfig?.baseHeight ?? shape.height ?? 1),
  };
}

function consumeVegetationInstanceRandoms(rng, placement) {
  const mode = placement?.mode ?? 'single';
  if (mode === 'patch') {
    rng();
    rng();
  } else if (mode === 'line') {
    rng();
  }
  rng(); // instance height
  rng(); // instance width
  rng(); // yaw
  rng(); // atlas cell
  rng(); // brightness
  rng(); // phase
  rng(); // bend
}

function getVegetationVisualScalar(placement, config) {
  const size = placement?.size ?? config?.size;
  const baseHeight = Math.max(0.001, Number(config?.baseHeight ?? config?.shape?.height ?? 1));
  if (!size) return 1;
  const heightMin = Number(size.heightMin);
  const heightMax = Number(size.heightMax);
  if (!Number.isFinite(heightMin) || !Number.isFinite(heightMax)) return 1;
  const range = Math.max(0.0001, heightMax - heightMin);
  const rng = mulberry32(hashSeed(`${placement?.id}:${placement?.seed}:${placement?.speciesId}:glb`));
  consumeVegetationInstanceRandoms(rng, placement);
  const desiredHeight = heightMin + rng() * range;
  return desiredHeight / baseHeight;
}

function createVegetationLocalBounds(shape) {
  const radius = Math.max(0.025, Number(shape.radius ?? 0.15));
  const width = Math.max(0.05, Number(shape.width ?? radius * 2));
  const depth = Math.max(0.05, Number(shape.depth ?? radius * 2));
  const height = Math.max(0.05, Number(shape.height ?? 1));
  const offsetY = Number.isFinite(shape.offsetY) ? shape.offsetY : height * 0.5;
  const minY = offsetY - (height * 0.5);
  const maxY = offsetY + (height * 0.5);
  const makeBounds = (name, w, d) => ({
    name,
    min: { x: -w * 0.5, y: minY, z: -d * 0.5 },
    max: { x: w * 0.5, y: maxY, z: d * 0.5 },
  });

  // Shared physics resolves AABBs. Use a cross-shaped compound trunk so a
  // tree does not act like one large square block.
  return [
    makeBounds('trunk-core', width * 0.55, depth * 0.55),
    makeBounds('trunk-x', width, depth * 0.32),
    makeBounds('trunk-z', width * 0.32, depth),
  ];
}

function buildVegetationBoundsAabb(bounds, placement, scaleFactor = 1) {
  const points = createBoxCornerPoints(bounds);
  const aabb = createEmptyAabb();
  const config = getVegetationColliderConfig(placement);
  const followsPlacementScale = placement.collisionFollowsScale !== false;
  const visualScalar = followsPlacementScale ? getVegetationVisualScalar(placement, config) : 1;
  const placementScale = defaultScale(placement.scale);
  const transform = {
    position: scaleVec3(placement.position, scaleFactor),
    rotation: placement.rotation,
    scale: followsPlacementScale
      ? scaleVec3({
        x: placementScale.x * visualScalar,
        y: placementScale.y * visualScalar,
        z: placementScale.z * visualScalar,
      }, scaleFactor)
      : { x: scaleFactor, y: scaleFactor, z: scaleFactor },
  };

  for (const point of points) {
    expandAabb(aabb, applyTransform(point, transform));
  }

  return aabb;
}

function buildPrimitiveWedgeDescriptor(primitive, scaleFactor = 1) {
  const origin = transformPrimitivePoint({ x: 0, y: 0, z: 0 }, primitive, scaleFactor);
  const xPoint = transformPrimitivePoint({ x: 1, y: 0, z: 0 }, primitive, scaleFactor);
  const yPoint = transformPrimitivePoint({ x: 0, y: 1, z: 0 }, primitive, scaleFactor);
  const zPoint = transformPrimitivePoint({ x: 0, y: 0, z: 1 }, primitive, scaleFactor);
  return createWedgeColliderDescriptor(
    origin,
    { x: xPoint.x - origin.x, y: xPoint.y - origin.y, z: xPoint.z - origin.z },
    { x: yPoint.x - origin.x, y: yPoint.y - origin.y, z: yPoint.z - origin.z },
    { x: zPoint.x - origin.x, y: zPoint.y - origin.y, z: zPoint.z - origin.z },
  );
}

function buildTaskPrefabWedgeDescriptor(part, task, prefab, scaleFactor = 1) {
  const origin = transformTaskPrefabPoint({ x: 0, y: 0, z: 0 }, part, task, prefab, scaleFactor);
  const xPoint = transformTaskPrefabPoint({ x: 1, y: 0, z: 0 }, part, task, prefab, scaleFactor);
  const yPoint = transformTaskPrefabPoint({ x: 0, y: 1, z: 0 }, part, task, prefab, scaleFactor);
  const zPoint = transformTaskPrefabPoint({ x: 0, y: 0, z: 1 }, part, task, prefab, scaleFactor);
  return createWedgeColliderDescriptor(
    origin,
    { x: xPoint.x - origin.x, y: xPoint.y - origin.y, z: xPoint.z - origin.z },
    { x: yPoint.x - origin.x, y: yPoint.y - origin.y, z: yPoint.z - origin.z },
    { x: zPoint.x - origin.x, y: zPoint.y - origin.y, z: zPoint.z - origin.z },
  );
}

export function buildRoomCollidersFromLayout(layout, {
  scaleFactor = ROOM_COLLISION_CONFIG.scaleFactor,
  completedTaskIds = null,
} = {}) {
  const primitives = Array.isArray(layout?.primitives) ? layout.primitives : [];
  const raidTasks = Array.isArray(layout?.raidTasks) ? layout.raidTasks : [];
  const vegetation = Array.isArray(layout?.vegetation) ? layout.vegetation : [];
  const completedTasks = completedTaskIds instanceof Set
    ? completedTaskIds
    : new Set(Array.isArray(completedTaskIds) ? completedTaskIds : []);
  const colliders = [];

  for (const primitive of primitives) {
    if (!primitive || primitive.deleted === true) continue;
    if (primitive.glbProp === true) continue;

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
      colliders.push({
        type: colliderType,
        metadata: {
          ...metadata,
          wedgeProxy: true,
          wedge: buildPrimitiveWedgeDescriptor(primitive, scaleFactor),
        },
        aabb: buildPrimitiveAabb(primitive, scaleFactor),
      });
      continue;
    }

    if (primitive.type === 'glb') {
      const compoundBounds = getGlbCompoundColliderLocalBounds(primitive.glbAssetId);
      if (compoundBounds?.length) {
        compoundBounds.forEach((localBounds, index) => {
          colliders.push({
            type: colliderType,
            metadata: {
              ...metadata,
              glbProxy: true,
              glbProxyName: localBounds.name ?? `part-${index}`,
              glbProxyIndex: index,
              localBounds,
            },
            aabb: buildLocalBoundsAabb(localBounds, primitive, scaleFactor),
          });
        });
        continue;
      }
    }

    colliders.push({
      type: colliderType,
      metadata,
      aabb: buildPrimitiveAabb(primitive, scaleFactor),
    });
  }

  for (const task of raidTasks) {
    if (!task || task.deleted === true) continue;
    const completed = completedTasks.has(task.id);
    const preferredPrefab = completed ? task.afterPrefab : task.beforePrefab;
    const fallbackPrefab = completed ? task.beforePrefab : task.afterPrefab;
    const prefab = preferredPrefab?.enabled !== false && Array.isArray(preferredPrefab?.primitives)
      ? preferredPrefab
      : fallbackPrefab;
    if (!prefab?.primitives?.length) continue;

    for (const part of prefab.primitives) {
      if (!part || part.deleted === true) continue;
      if (part.type === 'prop') continue;
      if (part.collider === false) continue;

      const colliderType = colliderTypeForTaskPrefabPart(part, task, prefab);
      const metadata = {
        source: 'layout',
        raidTaskId: task.id ?? null,
        raidTaskType: task.taskType ?? null,
        raidTaskPrefabSlot: completed ? 'after' : 'before',
        primitiveId: part.id ?? null,
        primitiveName: part.name ?? null,
        prefabId: prefab.prefabId ?? null,
        colliderClearance: part.colliderClearance ?? 0,
        runnable: colliderType === 'surface',
        taskPrefab: true,
      };
      if (part.type === 'plane' && colliderType === 'surface') {
        metadata.plane = true;
        metadata.zIndex = Number.isFinite(part.zIndex) ? Math.trunc(part.zIndex) : 0;
      }

      if (part.type === 'wedge') {
        colliders.push({
          type: colliderType,
          metadata: {
            ...metadata,
            wedgeProxy: true,
            wedge: buildTaskPrefabWedgeDescriptor(part, task, prefab, scaleFactor),
          },
          aabb: buildTaskPrefabPartAabb(part, task, prefab, scaleFactor),
        });
        continue;
      }

      colliders.push({
        type: colliderType,
        metadata,
        aabb: buildTaskPrefabPartAabb(part, task, prefab, scaleFactor),
      });
    }
  }

  for (const placement of vegetation) {
    const config = getVegetationColliderConfig(placement);
    if (!config) continue;
    const localBoundsList = createVegetationLocalBounds(config.shape);
    localBoundsList.forEach((localBounds, index) => {
      colliders.push({
        type: 'furniture',
        metadata: {
          source: 'vegetation',
          vegetationId: placement.id ?? null,
          vegetationName: placement.name ?? null,
          speciesId: placement.speciesId ?? null,
          collisionMode: 'trunk-shape',
          vegetationProxy: true,
          vegetationProxyName: localBounds.name ?? `part-${index}`,
          vegetationProxyIndex: index,
          nonWalkable: false,
        },
        aabb: buildVegetationBoundsAabb(localBounds, placement, scaleFactor),
      });
    });
  }

  return sortCollidersForPlaneZIndex(colliders);
}
