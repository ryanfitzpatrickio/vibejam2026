import * as THREE from 'three';
import { normalizePrefabPrimitive } from './prefabRegistry.js';
import { createVegetationPlacementId, normalizeVegetationPlacement } from './vegetationRegistry.js';
import { PROP_TEXTURE_ATLAS } from './textureAtlasRegistry.js';
import { SPAWN_TYPES } from '../../shared/spawnPoints.js';
import { NAV_AREA_TYPES } from '../../shared/navConfig.js';
import { VIBE_PORTAL_TYPES, normalizeVibePortalType } from '../../shared/vibePortal.js';
import {
  DEFAULT_ROPE_LENGTH,
  DEFAULT_ROPE_SEGMENTS,
  normalizeRope,
} from '../../shared/ropes.js';
import { RAID_TASK_TYPES, normalizeExtractionPortalEntry, normalizeRaidTaskEntry } from '../../shared/raidLayout.js';

export function createPrimitiveId() {
  return `primitive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createLightId() {
  return `light-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createPortalId() {
  return `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createRopeId() {
  return `rope-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createExtractionPortalId() {
  return `extract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createRaidTaskId() {
  return `raid-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultRope(app) {
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(1.75));
  const anchorY = Math.max(app.mouse.position.y + 2.4, 2.6);

  return normalizeRope({
    id: createRopeId(),
    name: `rope-${Math.random().toString(36).slice(2, 5)}`,
    anchor: {
      x: Number(spawn.x.toFixed(3)),
      y: Number(anchorY.toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    length: DEFAULT_ROPE_LENGTH,
    segmentCount: DEFAULT_ROPE_SEGMENTS,
  });
}

export function createDefaultPrimitive(type, app) {
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.25));
  spawn.y = Math.max(app.mouse.position.y, 0.6);

  const primitive = {
    id: createPrimitiveId(),
    name: `${type}-${Math.random().toString(36).slice(2, 5)}`,
    type,
    position: {
      x: Number(spawn.x.toFixed(3)),
      y: Number(spawn.y.toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    texture: {
      atlas: type === 'prop' ? PROP_TEXTURE_ATLAS : 'textures',
      cell: 0,
      repeat: { x: 1, y: 1 },
      rotation: 0,
    },
    material: {
      color: '#ffffff',
      roughness: 0.88,
      metalness: 0.04,
    },
    prefabId: null,
    navArea: NAV_AREA_TYPES.DEFAULT,
    collider: true,
    castShadow: true,
    receiveShadow: true,
  };

  if (type === 'plane') {
    primitive.rotation.x = -Math.PI * 0.5;
    primitive.scale = { x: 1, y: 1, z: 1 };
    primitive.zIndex = 0;
  }

  if (type === 'cylinder') {
    primitive.scale = { x: 1, y: 1.5, z: 1 };
  }

  if (type === 'wedge') {
    primitive.scale = { x: 1, y: 1, z: 1 };
  }

  if (type === 'box') {
    primitive.scale = { x: 1, y: 1, z: 1 };
  }

  if (type === 'prop') {
    primitive.scale = { x: 1, y: 1, z: 1 };
    primitive.position.y = Number((spawn.y + 0.5).toFixed(3));
    primitive.chroma = { similarity: 0.32, feather: 0.08 };
    primitive.collider = false;
    primitive.castShadow = false;
    primitive.receiveShadow = false;
    primitive.material.roughness = 1;
    primitive.material.metalness = 0;
  }

  return normalizePrefabPrimitive(primitive);
}

export function createSpawnMarkerPrimitive(spawnType, app) {
  const type = spawnType === SPAWN_TYPES.ENEMY
    || spawnType === SPAWN_TYPES.HUMAN
    || spawnType === SPAWN_TYPES.ROOMBA
    ? spawnType
    : SPAWN_TYPES.PLAYER;
  const markerColor = type === SPAWN_TYPES.PLAYER
    ? '#4fd1ff'
    : type === SPAWN_TYPES.HUMAN
      ? '#f4d35e'
      : type === SPAWN_TYPES.ROOMBA
        ? '#b9c2c9'
        : '#ff7a59';
  const namePrefix = type === SPAWN_TYPES.ROOMBA ? 'roomba-base' : `${type}-spawn`;
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.25));
  const scale = { x: 0.65, y: 0.3, z: 0.65 };
  const baseY = Math.max(app.mouse.position.y, 0);
  const marker = {
    id: createPrimitiveId(),
    name: `${namePrefix}-${Math.random().toString(36).slice(2, 5)}`,
    type: 'cylinder',
    spawnType: type,
    position: {
      x: Number(spawn.x.toFixed(3)),
      y: Number((baseY + scale.y * 0.5).toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale,
    texture: {
      atlas: 'textures',
      cell: null,
      repeat: { x: 1, y: 1 },
      rotation: 0,
    },
    material: {
      color: markerColor,
      roughness: 0.36,
      metalness: 0.06,
    },
    prefabId: null,
    navArea: NAV_AREA_TYPES.DEFAULT,
    collider: false,
    colliderClearance: 0,
    castShadow: false,
    receiveShadow: false,
  };

  return marker;
}

export function createDefaultLight(lightType, app) {
  const type = lightType === 'spot' || lightType === 'directional' ? lightType : 'point';
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.5));
  const yaw = Math.atan2(forward.x, forward.z);
  const defaults = type === 'spot'
    ? {
      color: '#ffd89f',
      intensity: 24,
      distance: 18,
      decay: 2,
      angle: Math.PI / 5,
      penumbra: 0.28,
      castShadow: true,
    }
    : type === 'directional'
      ? {
        color: '#ffe1b8',
        intensity: 1.7,
        distance: 0,
        decay: 2,
        angle: Math.PI / 4,
        penumbra: 0,
        castShadow: true,
      }
      : {
        color: '#ffc47a',
        intensity: 18,
        distance: 14,
        decay: 2,
        angle: Math.PI / 4,
        penumbra: 0,
        castShadow: false,
      };

  return {
    id: createLightId(),
    name: `${type}-light-${Math.random().toString(36).slice(2, 5)}`,
    lightType: type,
    position: {
      x: Number(spawn.x.toFixed(3)),
      y: Number(Math.max(app.mouse.position.y, 1.8).toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    rotation: {
      x: type === 'point' ? 0 : Number((-25 * Math.PI / 180).toFixed(4)),
      y: Number(yaw.toFixed(4)),
      z: 0,
    },
    color: defaults.color,
    intensity: defaults.intensity,
    distance: defaults.distance,
    decay: defaults.decay,
    angle: defaults.angle,
    penumbra: defaults.penumbra,
    castShadow: defaults.castShadow,
  };
}

export function createDefaultExtractionPortal(app) {
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.5));
  const yaw = Math.atan2(forward.x, forward.z);

  return normalizeExtractionPortalEntry({
    id: createExtractionPortalId(),
    name: `extraction-${Math.random().toString(36).slice(2, 5)}`,
    position: {
      x: Number(spawn.x.toFixed(3)),
      y: Number(Math.max(0, app.mouse.position.y).toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    rotation: {
      x: 0,
      y: Number(yaw.toFixed(4)),
      z: 0,
    },
    radius: 1.15,
  });
}

export function createDefaultRaidTask(app) {
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.5));
  const yaw = Math.atan2(forward.x, forward.z);

  return normalizeRaidTaskEntry({
    id: createRaidTaskId(),
    name: `task-${Math.random().toString(36).slice(2, 5)}`,
    taskType: RAID_TASK_TYPES.PLACEHOLDER,
    position: {
      x: Number(spawn.x.toFixed(3)),
      y: Number(Math.max(0, app.mouse.position.y).toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    rotation: {
      x: 0,
      y: Number(yaw.toFixed(4)),
      z: 0,
    },
  });
}

export function createDefaultPortal(portalType, app) {
  const type = normalizeVibePortalType(portalType);
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.5));
  const yaw = Math.atan2(forward.x, forward.z);

  return {
    id: createPortalId(),
    name: type === VIBE_PORTAL_TYPES.RETURN
      ? `return-portal-${Math.random().toString(36).slice(2, 5)}`
      : `vibe-portal-${Math.random().toString(36).slice(2, 5)}`,
    portalType: type,
    position: {
      x: Number(spawn.x.toFixed(3)),
      y: Number(Math.max(0, app.mouse.position.y).toFixed(3)),
      z: Number(spawn.z.toFixed(3)),
    },
    rotation: {
      x: 0,
      y: Number(yaw.toFixed(4)),
      z: 0,
    },
    triggerRadius: 0.9,
  };
}

export async function loadPrefabLibraryFromAsset(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export function createDefaultVegetation(species, mode, app) {
  const forward = new THREE.Vector3();
  app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  forward.normalize();

  const spawn = app.mouse.position.clone().add(forward.multiplyScalar(2.4));
  spawn.y = Math.max(app.mouse.position.y, 0);
  const nextMode = mode === 'patch' || mode === 'line' ? mode : 'single';
  const label = species?.name ?? 'vegetation';

  return normalizeVegetationPlacement({
    id: createVegetationPlacementId(),
    name: `${label.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 5)}`,
    speciesId: species?.id ?? null,
    mode: nextMode,
    position: {
      x: Number(spawn.x.toFixed(4)),
      y: Number(spawn.y.toFixed(4)),
      z: Number(spawn.z.toFixed(4)),
    },
    rotation: { x: 0, y: Math.atan2(forward.x, forward.z), z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    area: {
      shape: 'rect',
      width: species?.kind === 'hedge' ? 4 : 3,
      depth: species?.kind === 'hedge' ? 0.9 : 2,
      radius: 1.5,
    },
    density: nextMode === 'single' ? 1 : (species?.kind === 'grass' ? 42 : 18),
    seed: Math.abs(createVegetationPlacementId().split('-').join('').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)),
    line: {
      length: species?.kind === 'hedge' ? 5 : 4,
      width: species?.kind === 'hedge' ? 0.9 : 0.75,
    },
  });
}

export async function loadVegetationLibraryFromAsset(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}
