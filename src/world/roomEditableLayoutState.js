import { collectVibePortalPlacementsFromLayout } from '../../shared/vibePortal.js';
import {
  normalizeEditableExtractionPortal,
  normalizeEditableFan,
  normalizeEditableLight,
  normalizeEditablePortal,
  normalizeEditablePrimitive,
  normalizeEditableRaidTask,
  normalizeEditableRope,
  normalizeEditableVegetation,
} from './editableLayoutNormalize.js';

export function isRoomPrimitiveVisible(room, primitive) {
  if (primitive?.deleted) return false;
  if (primitive?.hiddenByGeneratedBake) return false;
  if (primitive?.spawnType) return room.spawnMarkersVisible;
  return true;
}

export function setRoomSpawnMarkersVisible(room, visible) {
  room.spawnMarkersVisible = visible === true;

  for (const primitive of room.editableLayout.primitives) {
    if (!primitive?.spawnType) continue;
    const mesh = room.editableMeshes.get(primitive.id);
    if (mesh) {
      mesh.visible = room._isPrimitiveVisible(primitive);
    }
  }
}

export function setRoomPortalHelpersVisible(room, visible) {
  room.portalHelpersVisible = visible === true;
  for (const entry of room.editablePortalObjects.values()) {
    entry.group.visible = room.portalHelpersVisible && !entry.definition.deleted;
  }
}

export function setRoomExtractionHelpersVisible(room, visible) {
  room.extractionHelpersVisible = visible === true;
  for (const entry of room.editableExtractionPortalObjects.values()) {
    entry.group.visible = room.extractionHelpersVisible && !entry.definition.deleted;
  }
}

export function setRoomRaidTaskHelpersVisible(room, visible) {
  room.raidTaskHelpersVisible = visible === true;
  for (const entry of room.editableRaidTaskObjects.values()) {
    entry.group.visible = room.raidTaskHelpersVisible && !entry.definition.deleted;
  }
}

export function setRoomRaidTaskPrefabEditorPreview(room, taskId, slot = 'auto') {
  if (!taskId) return;
  const entry = room.editableRaidTaskObjects.get(taskId);
  entry?.group.userData.setRaidTaskEditorPreview?.(slot);
}

export function setRoomRaidTaskPrefabEditTarget(room, taskId, slot = 'marker') {
  if (!taskId) return;
  const normalized = slot === 'before' || slot === 'after' ? slot : 'marker';
  if (normalized === 'marker') {
    room.raidTaskPrefabEditTargets.delete(taskId);
  } else {
    room.raidTaskPrefabEditTargets.set(taskId, normalized);
  }
}

export function getRoomVibePortalPlacements(room) {
  return collectVibePortalPlacementsFromLayout(room.getEditableLayout());
}

export function getRoomEditableLayout(room) {
  const builtIns = Array.from(room.builtInEditableMeshes.values()).map((entry) => room._serializeBuiltInPrimitive(entry));
  const customs = room.editableLayout.primitives.map((entry) => normalizeEditablePrimitive(entry));
  const lights = (room.editableLayout.lights ?? []).map((entry) => normalizeEditableLight(entry));
  const portals = (room.editableLayout.portals ?? []).map((entry) => normalizeEditablePortal(entry));
  const ropes = (room.editableLayout.ropes ?? []).map((entry) => normalizeEditableRope(entry));
  const fans = (room.editableLayout.fans ?? []).map((entry) => normalizeEditableFan(entry));
  const extractionPortals = (room.editableLayout.extractionPortals ?? []).map((entry) => normalizeEditableExtractionPortal(entry));
  const raidTasks = (room.editableLayout.raidTasks ?? []).map((entry) => normalizeEditableRaidTask(entry));
  const vegetation = (room.editableLayout.vegetation ?? []).map((entry) => normalizeEditableVegetation(entry));
  return {
    version: Math.max(room.loadedEditableLayout.version ?? 1, room.editableLayout.version ?? 1, 1),
    primitives: [...builtIns, ...customs],
    lights,
    portals,
    ropes,
    fans,
    extractionPortals,
    raidTasks,
    vegetation,
  };
}

export function setRoomEditableLayout(room, layout) {
  room.loadedEditableLayout = {
    version: layout?.version ?? 1,
    primitives: Array.isArray(layout?.primitives) ? layout.primitives.map((entry) => normalizeEditablePrimitive(entry)) : [],
    lights: Array.isArray(layout?.lights) ? layout.lights.map((entry) => normalizeEditableLight(entry)) : [],
    portals: Array.isArray(layout?.portals) ? layout.portals.map((entry) => normalizeEditablePortal(entry)) : [],
    ropes: Array.isArray(layout?.ropes) ? layout.ropes.map((entry) => normalizeEditableRope(entry)) : [],
    fans: Array.isArray(layout?.fans) ? layout.fans.map((entry) => normalizeEditableFan(entry)) : [],
    extractionPortals: Array.isArray(layout?.extractionPortals)
      ? layout.extractionPortals.map((entry) => normalizeEditableExtractionPortal(entry))
      : [],
    raidTasks: Array.isArray(layout?.raidTasks)
      ? layout.raidTasks.map((entry) => normalizeEditableRaidTask(entry))
      : [],
    vegetation: Array.isArray(layout?.vegetation)
      ? layout.vegetation.map((entry) => normalizeEditableVegetation(entry))
      : [],
  };
  room._applyLoadedEditableLayout();
  room._rebuildEditableLayout();
  return room.getEditableLayout();
}

export function getRoomEditableRopeDefinitions(room) {
  return (room.editableLayout.ropes ?? [])
    .map((entry) => normalizeEditableRope(entry))
    .filter((entry) => !entry.deleted)
    .map(({ id, anchor, length, segmentCount }) => ({ id, anchor, length, segmentCount }));
}
