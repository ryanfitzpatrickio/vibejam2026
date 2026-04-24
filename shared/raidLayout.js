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
    deleted: entry.deleted === true,
  };
}
