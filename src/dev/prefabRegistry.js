import { DEFAULT_TEXTURE_ATLAS, normalizeTextureAtlasId } from './textureAtlasRegistry.js';

function cloneVectorLike(source, fallback) {
  return {
    x: source?.x ?? fallback.x,
    y: source?.y ?? fallback.y,
    z: source?.z ?? fallback.z,
  };
}

export const FACE_TEXTURE_SLOTS = Object.freeze({
  box: Object.freeze(['right', 'left', 'top', 'bottom', 'front', 'back']),
  cylinder: Object.freeze(['side', 'top', 'bottom']),
  wedge: Object.freeze(['back', 'bottom', 'left', 'right', 'slope']),
  plane: Object.freeze([]),
  prop: Object.freeze([]),
});

function normalizeTextureRef(value, fallbackCell = 0) {
  if (typeof value === 'number') {
    return {
      atlas: DEFAULT_TEXTURE_ATLAS,
      cell: value,
    };
  }

  if (value && typeof value === 'object') {
    return {
      atlas: normalizeTextureAtlasId(value.atlas),
      cell: Number.isFinite(value.cell) ? value.cell : fallbackCell,
    };
  }

  return {
    atlas: DEFAULT_TEXTURE_ATLAS,
    cell: fallbackCell,
  };
}

function normalizeFaceTextures(type, value = {}) {
  const slots = FACE_TEXTURE_SLOTS[type] ?? [];
  const result = {};

  slots.forEach((slot) => {
    const ref = value?.[slot];
    if (ref == null) return;
    if (ref === null) {
      result[slot] = null;
      return;
    }
    result[slot] = normalizeTextureRef(ref);
  });

  return result;
}

export function createPrefabId() {
  return `prefab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createPrefabPartId() {
  return `prefab-part-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizePrefabPrimitive(entry = {}) {
  const type = entry.type === 'plane'
    || entry.type === 'cylinder'
    || entry.type === 'wedge'
    || entry.type === 'prop'
    ? entry.type
    : 'box';
  const texture = entry.texture ?? {};
  const textureRef = normalizeTextureRef(texture, 0);

  return {
    id: entry.id ?? createPrefabPartId(),
    name: entry.name ?? `${type}-part`,
    type,
    position: cloneVectorLike(entry.position, { x: 0, y: 0.5, z: 0 }),
    rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
    scale: cloneVectorLike(entry.scale, { x: 1, y: 1, z: 1 }),
    texture: {
      atlas: textureRef.atlas,
      cell: textureRef.cell,
      repeat: {
        x: texture.repeat?.x ?? 1,
        y: texture.repeat?.y ?? 1,
      },
      rotation: texture.rotation ?? 0,
      offset: {
        x: texture.offset?.x ?? 0,
        y: texture.offset?.y ?? 0,
      },
    },
    faceTextures: normalizeFaceTextures(type, entry.faceTextures),
    material: {
      color: entry.material?.color ?? '#ffffff',
      roughness: entry.material?.roughness ?? 0.88,
      metalness: entry.material?.metalness ?? 0.04,
    },
    ...(type === 'prop' ? {
      chroma: {
        similarity: Math.min(1, Math.max(0, Number(entry.chroma?.similarity ?? 0.32))),
        feather: Math.min(1, Math.max(0, Number(entry.chroma?.feather ?? 0.08))),
      },
    } : {}),
    prefabInstanceOrigin: entry.prefabInstanceOrigin
      ? cloneVectorLike(entry.prefabInstanceOrigin, { x: 0, y: 0, z: 0 })
      : null,
    collider: type === 'prop' ? entry.collider === true : entry.collider !== false,
    castShadow: type === 'prop' ? entry.castShadow === true : entry.castShadow !== false,
    receiveShadow: type === 'prop' ? entry.receiveShadow === true : entry.receiveShadow !== false,
    ...(type === 'plane' ? {
      zIndex: Number.isFinite(entry.zIndex) ? Math.trunc(entry.zIndex) : 0,
    } : {}),
  };
}

export function normalizePrefab(entry = {}) {
  return {
    id: entry.id ?? createPrefabId(),
    name: entry.name ?? 'New Prefab',
    size: {
      x: Math.max(1, Math.round(entry.size?.x ?? 1)),
      y: Math.max(1, Math.round(entry.size?.y ?? 1)),
      z: Math.max(1, Math.round(entry.size?.z ?? 1)),
    },
    primitives: Array.isArray(entry.primitives)
      ? entry.primitives.map((primitive) => normalizePrefabPrimitive(primitive))
      : [],
  };
}

export function normalizePrefabLibrary(value = {}) {
  return {
    version: value?.version ?? 1,
    prefabs: Array.isArray(value?.prefabs)
      ? value.prefabs.map((prefab) => normalizePrefab(prefab))
      : [],
  };
}

export const DEFAULT_PREFAB_LIBRARY = Object.freeze({
  version: 1,
  prefabs: [
    normalizePrefab({
      id: 'counter-module',
      name: 'Counter Module',
      size: { x: 1, y: 1, z: 1 },
      primitives: [],
    }),
    normalizePrefab({
      id: 'chair-module',
      name: 'Chair Module',
      size: { x: 1, y: 1, z: 1 },
      primitives: [],
    }),
    normalizePrefab({
      id: 'appliance-module',
      name: 'Appliance Module',
      size: { x: 1, y: 2, z: 1 },
      primitives: [],
    }),
  ],
});
