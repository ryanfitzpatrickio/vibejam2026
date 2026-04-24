/**
 * Normalizers for raid-related layout entries (editor + JSON).
 * Gameplay may consume these gradually; unknown fields are ignored at runtime.
 */

export const RAID_TASK_TYPES = Object.freeze({
  PLACEHOLDER: 'placeholder',
  CHEW_WIRES: 'chew_wires',
  TOPPLE_TOWER: 'topple_tower',
  FRIDGE_RAID: 'fridge_raid',
  CUT_LIGHTS: 'cut_lights',
  KNIFE_DRAWER: 'knife_drawer',
  SABOTAGE_ROOMBA: 'sabotage_roomba',
  UNLOCK_GUS: 'unlock_gus',
  UNLOCK_SPEEDY: 'unlock_speedy',
});

export const RAID_TASK_TYPE_LABELS = Object.freeze({
  [RAID_TASK_TYPES.PLACEHOLDER]: 'Placeholder',
  [RAID_TASK_TYPES.CHEW_WIRES]: 'Chew Wires',
  [RAID_TASK_TYPES.TOPPLE_TOWER]: 'Topple Tower',
  [RAID_TASK_TYPES.FRIDGE_RAID]: 'Fridge Raid',
  [RAID_TASK_TYPES.CUT_LIGHTS]: 'Cut Lights',
  [RAID_TASK_TYPES.KNIFE_DRAWER]: 'Knife Drawer',
  [RAID_TASK_TYPES.SABOTAGE_ROOMBA]: 'Sabotage Roomba',
  [RAID_TASK_TYPES.UNLOCK_GUS]: 'Unlock Gus',
  [RAID_TASK_TYPES.UNLOCK_SPEEDY]: 'Unlock Speedy',
});

function cloneVectorLike(source, fallback) {
  return {
    x: Number.isFinite(source?.x) ? source.x : fallback.x,
    y: Number.isFinite(source?.y) ? source.y : fallback.y,
    z: Number.isFinite(source?.z) ? source.z : fallback.z,
  };
}

function normalizeTaskPrefabPrimitive(entry = {}) {
  const type = entry.type === 'plane'
    || entry.type === 'cylinder'
    || entry.type === 'wedge'
    || entry.type === 'prop'
    ? entry.type
    : 'box';
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : `task-prefab-part-${Math.random().toString(36).slice(2, 8)}`,
    name: typeof entry.name === 'string' ? entry.name : `${type}-part`,
    type,
    position: cloneVectorLike(entry.position, { x: 0, y: 0.5, z: 0 }),
    rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
    scale: cloneVectorLike(entry.scale, { x: 1, y: 1, z: 1 }),
    material: {
      color: typeof entry.material?.color === 'string' ? entry.material.color : '#ffffff',
      roughness: Number.isFinite(entry.material?.roughness) ? entry.material.roughness : 0.82,
      metalness: Number.isFinite(entry.material?.metalness) ? entry.material.metalness : 0.04,
    },
  };
}

export function normalizeRaidTaskPrefab(value = null) {
  if (!value || typeof value !== 'object') return null;
  const primitives = Array.isArray(value.primitives)
    ? value.primitives.slice(0, 64).map((entry) => normalizeTaskPrefabPrimitive(entry))
    : [];
  return {
    enabled: value.enabled === true,
    prefabId: typeof value.prefabId === 'string' ? value.prefabId : '',
    name: typeof value.name === 'string' ? value.name : '',
    position: cloneVectorLike(value.position, { x: 0, y: 0, z: 0 }),
    rotation: cloneVectorLike(value.rotation, { x: 0, y: 0, z: 0 }),
    scale: cloneVectorLike(value.scale, { x: 1, y: 1, z: 1 }),
    primitives,
  };
}

/**
 * @param {object} [entry]
 */
export function normalizeExtractionPortalEntry(entry = {}) {
  return {
    id: typeof entry.id === 'string' && entry.id.length > 0
      ? entry.id
      : `extract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: typeof entry.name === 'string' ? entry.name : 'Extraction hole',
    position: {
      x: Number.isFinite(entry.position?.x) ? entry.position.x : 0,
      y: Number.isFinite(entry.position?.y) ? entry.position.y : 0,
      z: Number.isFinite(entry.position?.z) ? entry.position.z : 0,
    },
    rotation: {
      x: Number.isFinite(entry.rotation?.x) ? entry.rotation.x : 0,
      y: Number.isFinite(entry.rotation?.y) ? entry.rotation.y : 0,
      z: Number.isFinite(entry.rotation?.z) ? entry.rotation.z : 0,
    },
    radius: Math.max(0.35, Math.min(4, Number(entry.radius) || 1.15)),
    deleted: entry.deleted === true,
  };
}

/**
 * @param {object} [entry]
 */
export function normalizeRaidTaskEntry(entry = {}) {
  const rawType = typeof entry.taskType === 'string' ? entry.taskType : RAID_TASK_TYPES.PLACEHOLDER;
  const taskType = rawType.length > 32 ? RAID_TASK_TYPES.PLACEHOLDER : rawType;
  return {
    id: typeof entry.id === 'string' && entry.id.length > 0
      ? entry.id
      : `raid-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: typeof entry.name === 'string' ? entry.name : 'Task marker',
    taskType,
    position: {
      x: Number.isFinite(entry.position?.x) ? entry.position.x : 0,
      y: Number.isFinite(entry.position?.y) ? entry.position.y : 0,
      z: Number.isFinite(entry.position?.z) ? entry.position.z : 0,
    },
    rotation: {
      x: Number.isFinite(entry.rotation?.x) ? entry.rotation.x : 0,
      y: Number.isFinite(entry.rotation?.y) ? entry.rotation.y : 0,
      z: Number.isFinite(entry.rotation?.z) ? entry.rotation.z : 0,
    },
    beforePrefab: normalizeRaidTaskPrefab(entry.beforePrefab),
    afterPrefab: normalizeRaidTaskPrefab(entry.afterPrefab),
    deleted: entry.deleted === true,
  };
}
