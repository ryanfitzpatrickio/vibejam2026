import * as THREE from 'three';
import { FACE_TEXTURE_SLOTS } from '../dev/prefabRegistry.js';
import {
  DEFAULT_TEXTURE_ATLAS,
  normalizeTextureAtlasId,
} from '../dev/textureAtlasRegistry.js';
import { normalizeVegetationPlacement } from '../dev/vegetationRegistry.js';
import { normalizeSpawnType } from '../../shared/spawnPoints.js';
import { normalizeNavArea } from '../../shared/navConfig.js';
import { normalizeVibePortal } from '../../shared/vibePortal.js';
import {
  normalizeExtractionPortalEntry,
  normalizeRaidTaskEntry,
} from '../../shared/raidLayout.js';
import { normalizeRope } from '../../shared/ropes.js';
import { normalizeCeilingFan } from '../../shared/ceilingFans.js';

export const ROOM_TEXTURE_CELLS = Object.freeze({
  floor: 0,
  wall: 3,
  cabinet: 55,
  cabinetDark: 21,
  counter: 89,
  backsplash: 27,
  appliance: 44,
  fridge: 45,
  fabric: 94,
  woodAlt: 19,
  woodDark: 21,
  tile: 45,
});

const EDITABLE_TYPE_DEFAULTS = Object.freeze({
  box: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  plane: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  cylinder: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  wedge: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  prop: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
});

const EDITABLE_LIGHT_DEFAULTS = Object.freeze({
  point: Object.freeze({
    intensity: 18,
    distance: 14,
    decay: 2,
    angle: Math.PI / 4,
    penumbra: 0,
    castShadow: false,
    color: '#ffc47a',
  }),
  spot: Object.freeze({
    intensity: 24,
    distance: 18,
    decay: 2,
    angle: Math.PI / 5,
    penumbra: 0.28,
    castShadow: true,
    color: '#ffd89f',
  }),
  directional: Object.freeze({
    intensity: 1.7,
    distance: 0,
    decay: 2,
    angle: Math.PI / 4,
    penumbra: 0,
    castShadow: true,
    color: '#ffe1b8',
  }),
});

function normalizeLightType(value) {
  return value === 'spot' || value === 'directional' ? value : 'point';
}

function normalizeGlbPropPhysicsShape(value) {
  return value === 'box' || value === 'openBox' || value === 'cylinder' ? value : 'sphere';
}

function normalizePhysicsSize(value = {}) {
  return {
    x: THREE.MathUtils.clamp(Number(value.x ?? 1) || 1, 0.05, 5),
    y: THREE.MathUtils.clamp(Number(value.y ?? 1) || 1, 0.05, 5),
    z: THREE.MathUtils.clamp(Number(value.z ?? 1) || 1, 0.05, 5),
  };
}

export function normalizeTextureSettings(texture = {}) {
  if (typeof texture === 'number') {
    return {
      x: texture,
      y: texture,
      rotation: 0,
      offset: { x: 0, y: 0 },
    };
  }

  return {
    x: texture?.x ?? 1,
    y: texture?.y ?? texture?.x ?? 1,
    rotation: texture?.rotation ?? 0,
    offset: {
      x: texture?.offset?.x ?? 0,
      y: texture?.offset?.y ?? 0,
    },
  };
}

export function cloneVectorLike(source, fallback) {
  return {
    x: source?.x ?? fallback.x,
    y: source?.y ?? fallback.y,
    z: source?.z ?? fallback.z,
  };
}

export function normalizeFaceTextures(type, value = {}) {
  const slots = FACE_TEXTURE_SLOTS[type] ?? [];
  const result = {};

  slots.forEach((slot) => {
    const ref = value?.[slot];
    if (ref == null) return;
    if (ref === null) {
      result[slot] = null;
      return;
    }
    if (typeof ref === 'number') {
      result[slot] = {
        atlas: DEFAULT_TEXTURE_ATLAS,
        cell: ref,
      };
      return;
    }
    result[slot] = {
      atlas: normalizeTextureAtlasId(ref.atlas),
      cell: Number.isFinite(ref.cell) ? ref.cell : 0,
    };
  });

  return result;
}

export function colorToHex(color, fallback = '#ffffff') {
  if (typeof color === 'string') return color;
  if (color?.isColor) return `#${color.getHexString()}`;
  return fallback;
}

export function materialToEditableSurface(material, fallbackColor = '#ffffff') {
  return {
    color: colorToHex(material?.color, fallbackColor),
    roughness: material?.roughness ?? 0.88,
    metalness: material?.metalness ?? 0.04,
  };
}

export function normalizeEditablePrimitive(entry = {}) {
  const type = entry.type === 'plane'
    || entry.type === 'cylinder'
    || entry.type === 'wedge'
    || entry.type === 'glb'
    || entry.type === 'prop'
    ? entry.type
    : 'box';
  const defaults = EDITABLE_TYPE_DEFAULTS[type] ?? EDITABLE_TYPE_DEFAULTS.box;
  const texture = typeof entry.texture === 'number' ? { cell: entry.texture } : (entry.texture ?? {});
  const atlas = normalizeTextureAtlasId(texture.atlas);

  return {
    id: entry.id ?? `primitive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: entry.name ?? `${type}-${(entry.id ?? 'item').slice(0, 4)}`,
    type,
    spawnType: normalizeSpawnType(entry.spawnType),
    position: cloneVectorLike(entry.position, { x: 0, y: 0.5, z: 0 }),
    rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
    scale: cloneVectorLike(entry.scale, defaults.scale),
    texture: {
      atlas,
      cell: Number.isFinite(texture.cell) ? texture.cell : (texture.cell === null ? null : ROOM_TEXTURE_CELLS.tile),
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
      color: entry.material?.color ?? '#c9b391',
      roughness: entry.material?.roughness ?? 0.88,
      metalness: entry.material?.metalness ?? 0.04,
    },
    ...(type === 'prop' ? {
      chroma: {
        similarity: THREE.MathUtils.clamp(Number(entry.chroma?.similarity ?? 0.32), 0, 1),
        feather: THREE.MathUtils.clamp(Number(entry.chroma?.feather ?? 0.08), 0, 1),
      },
    } : {}),
    glbAssetId: entry.glbAssetId ?? null,
    glbProp: type === 'glb' && entry.glbProp === true,
    catFavoriteToy: type === 'glb' && entry.glbProp === true && entry.catFavoriteToy === true,
    mount: type === 'glb' && entry.mount === true,
    mountKind: typeof entry.mountKind === 'string' && entry.mountKind ? entry.mountKind : null,
    mountSocketName: typeof entry.mountSocketName === 'string' && entry.mountSocketName ? entry.mountSocketName : 'spine',
    mountRiderOffset: entry.mountRiderOffset ? cloneVectorLike(entry.mountRiderOffset, { x: 0, y: 0.42, z: 0.12 }) : null,
    mountGrabOffset: entry.mountGrabOffset ? cloneVectorLike(entry.mountGrabOffset, { x: 0, y: -0.38, z: 0.24 }) : null,
    physicsShape: type === 'glb' && entry.glbProp === true
      ? normalizeGlbPropPhysicsShape(entry.physicsShape)
      : 'sphere',
    physicsRadius: Number.isFinite(entry.physicsRadius)
      ? THREE.MathUtils.clamp(Number(entry.physicsRadius), 0.12, 2.5)
      : null,
    physicsSize: normalizePhysicsSize(entry.physicsSize),
    physicsMass: Number.isFinite(entry.physicsMass)
      ? THREE.MathUtils.clamp(Number(entry.physicsMass), 0.2, 80)
      : null,
    prefabId: entry.prefabId ?? null,
    navArea: normalizeNavArea(entry.navArea),
    prefabInstanceId: entry.prefabInstanceId ?? null,
    prefabInstanceOrigin: entry.prefabInstanceOrigin ? cloneVectorLike(entry.prefabInstanceOrigin, { x: 0, y: 0, z: 0 }) : null,
    prefabInstanceRotation: entry.prefabInstanceRotation ? cloneVectorLike(entry.prefabInstanceRotation, { x: 0, y: 0, z: 0 }) : null,
    prefabInstanceScale: entry.prefabInstanceScale ? cloneVectorLike(entry.prefabInstanceScale, { x: 1, y: 1, z: 1 }) : null,
    gameplayType: entry.gameplayType === 'hot_surface' || entry.hazardType === 'hot_surface' ? 'hot_surface' : null,
    collider: type === 'prop' ? entry.collider === true : entry.collider !== false,
    colliderClearance: entry.colliderClearance ?? 0,
    castShadow: type === 'prop' ? entry.castShadow === true : entry.castShadow !== false,
    receiveShadow: type === 'prop' ? entry.receiveShadow === true : entry.receiveShadow !== false,
    deleted: entry.deleted === true,
    ...(type === 'plane' ? {
      zIndex: Number.isFinite(entry.zIndex) ? Math.trunc(entry.zIndex) : 0,
    } : {}),
    bakedAssetId: entry.bakedAssetId ?? null,
    generatedBakeKind: typeof entry.generatedBakeKind === 'string' ? entry.generatedBakeKind : null,
    hiddenByGeneratedBake: entry.hiddenByGeneratedBake === true,
    ...(typeof entry.cameraOccluder === 'boolean' ? { cameraOccluder: entry.cameraOccluder } : {}),
  };
}

export function normalizeEditableLight(entry = {}) {
  const lightType = normalizeLightType(entry.lightType);
  const defaults = EDITABLE_LIGHT_DEFAULTS[lightType] ?? EDITABLE_LIGHT_DEFAULTS.point;
  return {
    id: entry.id ?? `light-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: entry.name ?? `${lightType}-light`,
    lightType,
    position: cloneVectorLike(entry.position, { x: 0, y: 2, z: 0 }),
    rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
    color: colorToHex(entry.color, defaults.color),
    intensity: Number.isFinite(entry.intensity) ? entry.intensity : defaults.intensity,
    distance: Number.isFinite(entry.distance) ? entry.distance : defaults.distance,
    decay: Number.isFinite(entry.decay) ? entry.decay : defaults.decay,
    angle: Number.isFinite(entry.angle) ? entry.angle : defaults.angle,
    penumbra: Number.isFinite(entry.penumbra) ? entry.penumbra : defaults.penumbra,
    castShadow: entry.castShadow ?? defaults.castShadow,
    deleted: entry.deleted === true,
  };
}

export const normalizeEditablePortal = normalizeVibePortal;
export const normalizeEditableExtractionPortal = normalizeExtractionPortalEntry;
export const normalizeEditableRaidTask = normalizeRaidTaskEntry;
export const normalizeEditableRope = normalizeRope;
export const normalizeEditableFan = normalizeCeilingFan;
export const normalizeEditableVegetation = normalizeVegetationPlacement;
