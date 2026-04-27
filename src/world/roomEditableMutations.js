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

export function upsertRoomEditablePrimitive(room, definition) {
  const primitive = normalizeEditablePrimitive(definition);
  if (room.builtInEditableMeshes.has(primitive.id)) {
    const entry = room.builtInEditableMeshes.get(primitive.id);
    room.deletedBuiltInPrimitives.delete(primitive.id);
    primitive.deleted = false;
    entry.primitive = primitive;
    room._applyPrimitiveToMesh(primitive, entry.mesh);
    room.refreshColliders();
    room._applyTextureAtlas();
    return primitive;
  }
  const index = room.editableLayout.primitives.findIndex((entry) => entry.id === primitive.id);
  if (index >= 0) {
    room.editableLayout.primitives[index] = primitive;
  } else {
    room.editableLayout.primitives.push(primitive);
  }
  room._rebuildEditableLayout();
  return primitive;
}

export function replaceRoomEditablePrimitive(room, id, definitions = []) {
  const replacements = Array.isArray(definitions)
    ? definitions.map((entry) => normalizeEditablePrimitive(entry))
    : [];

  if (room.builtInEditableMeshes.has(id)) {
    const entry = room.builtInEditableMeshes.get(id);
    room.deletedBuiltInPrimitives.add(id);
    entry.mesh.visible = false;
    entry.mesh.userData.colliderEnabled = false;
  }

  room.editableLayout.primitives = room.editableLayout.primitives.filter((entry) => entry.id !== id);
  room.loadedEditableLayout.primitives = (room.loadedEditableLayout.primitives ?? []).filter((entry) => entry.id !== id);

  room.editableLayout.primitives.push(...replacements.map((entry) => normalizeEditablePrimitive(entry)));
  room.loadedEditableLayout.primitives.push(...replacements.map((entry) => normalizeEditablePrimitive(entry)));

  room._rebuildEditableLayout();
  return replacements;
}

export function upsertRoomEditableLight(room, definition) {
  const light = normalizeEditableLight(definition);
  const index = room.editableLayout.lights.findIndex((entry) => entry.id === light.id);
  if (index >= 0) {
    const current = room.editableLightObjects.get(light.id);
    const currentType = current?.definition?.lightType ?? room.editableLayout.lights[index]?.lightType;
    if (currentType !== light.lightType) {
      room.editableLayout.lights[index] = light;
      room._rebuildEditableLayout();
      return light;
    }
    room.editableLayout.lights[index] = light;
    if (current) {
      room._applyLightToObject(light, current);
    }
    return light;
  }

  room.editableLayout.lights.push(light);
  room._rebuildEditableLayout();
  return light;
}

export function upsertRoomEditablePortal(room, definition) {
  const portal = normalizeEditablePortal(definition);
  const index = room.editableLayout.portals.findIndex((entry) => entry.id === portal.id);
  if (index >= 0) {
    const previous = normalizeEditablePortal(room.editableLayout.portals[index]);
    room.editableLayout.portals[index] = portal;
    if (
      previous.portalType !== portal.portalType
      || Math.abs((previous.triggerRadius ?? 0) - (portal.triggerRadius ?? 0)) > 0.0001
    ) {
      room._rebuildEditableLayout();
      return portal;
    }
    const current = room.editablePortalObjects.get(portal.id);
    if (current) {
      room._applyPortalToObject(portal, current);
    }
    return portal;
  }

  room.editableLayout.portals.push(portal);
  room._rebuildEditableLayout();
  return portal;
}

export function removeRoomEditablePrimitive(room, id) {
  if (room.builtInEditableMeshes.has(id)) {
    const entry = room.builtInEditableMeshes.get(id);
    room.deletedBuiltInPrimitives.add(id);
    entry.mesh.visible = false;
    entry.mesh.userData.colliderEnabled = false;
    room.refreshColliders();
    return;
  }
  room.editableLayout.primitives = room.editableLayout.primitives.filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function removeRoomEditableLight(room, id) {
  room.editableLayout.lights = room.editableLayout.lights.filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function removeRoomEditablePortal(room, id) {
  room.editableLayout.portals = room.editableLayout.portals.filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditablePrimitive(room, id) {
  if (room.builtInEditableMeshes.has(id)) {
    const entry = room.builtInEditableMeshes.get(id);
    room.deletedBuiltInPrimitives.add(id);
    entry.mesh.visible = false;
    entry.mesh.userData.colliderEnabled = false;
    room.refreshColliders();
    return;
  }

  const prefabInstanceId = room.prefabInstanceIdByPrimitiveId.get(id);
  if (prefabInstanceId) {
    room.editableLayout.primitives = room.editableLayout.primitives.filter((entry) => entry.prefabInstanceId !== prefabInstanceId);
    room.loadedEditableLayout.primitives = room.loadedEditableLayout.primitives.filter((entry) => entry.prefabInstanceId !== prefabInstanceId);
    room._rebuildEditableLayout();
    return;
  }

  room.editableLayout.primitives = room.editableLayout.primitives.filter((entry) => entry.id !== id);
  room.loadedEditableLayout.primitives = room.loadedEditableLayout.primitives.filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditableLight(room, id) {
  room.editableLayout.lights = room.editableLayout.lights.filter((entry) => entry.id !== id);
  room.loadedEditableLayout.lights = (room.loadedEditableLayout.lights ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditablePortal(room, id) {
  room.editableLayout.portals = room.editableLayout.portals.filter((entry) => entry.id !== id);
  room.loadedEditableLayout.portals = (room.loadedEditableLayout.portals ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function upsertRoomEditableExtractionPortal(room, definition) {
  const ep = normalizeEditableExtractionPortal(definition);
  const list = room.editableLayout.extractionPortals ?? (room.editableLayout.extractionPortals = []);
  const index = list.findIndex((entry) => entry.id === ep.id);
  if (index >= 0) {
    const previous = normalizeEditableExtractionPortal(list[index]);
    list[index] = ep;
    if (Math.abs((previous.radius ?? 0) - (ep.radius ?? 0)) > 0.0001) {
      room._rebuildEditableLayout();
      return ep;
    }
    const current = room.editableExtractionPortalObjects.get(ep.id);
    if (current) {
      room._applyExtractionPortalToObject(ep, current);
    }
    return ep;
  }

  list.push(ep);
  room._rebuildEditableLayout();
  return ep;
}

export function removeRoomEditableExtractionPortal(room, id) {
  const list = room.editableLayout.extractionPortals ?? [];
  room.editableLayout.extractionPortals = list.filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditableExtractionPortal(room, id) {
  const list = room.editableLayout.extractionPortals ?? [];
  room.editableLayout.extractionPortals = list.filter((entry) => entry.id !== id);
  room.loadedEditableLayout.extractionPortals = (room.loadedEditableLayout.extractionPortals ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function upsertRoomEditableRaidTask(room, definition) {
  const task = normalizeEditableRaidTask(definition);
  const list = room.editableLayout.raidTasks ?? (room.editableLayout.raidTasks = []);
  const index = list.findIndex((entry) => entry.id === task.id);
  if (index >= 0) {
    list[index] = task;
    const current = room.editableRaidTaskObjects.get(task.id);
    if (current) {
      room._applyRaidTaskToObject(task, current);
    }
    return task;
  }

  list.push(task);
  room._rebuildEditableLayout();
  return task;
}

export function removeRoomEditableRaidTask(room, id) {
  const list = room.editableLayout.raidTasks ?? [];
  room.editableLayout.raidTasks = list.filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditableRaidTask(room, id) {
  const list = room.editableLayout.raidTasks ?? [];
  room.editableLayout.raidTasks = list.filter((entry) => entry.id !== id);
  room.loadedEditableLayout.raidTasks = (room.loadedEditableLayout.raidTasks ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function upsertRoomEditableRope(room, definition) {
  const rope = normalizeEditableRope(definition);
  const ropes = room.editableLayout.ropes ?? (room.editableLayout.ropes = []);
  const index = ropes.findIndex((entry) => entry.id === rope.id);
  if (index >= 0) {
    const previous = normalizeEditableRope(ropes[index]);
    ropes[index] = rope;
    if (
      Math.abs(previous.length - rope.length) > 0.0001
      || previous.segmentCount !== rope.segmentCount
      || Math.abs((previous.segmentRadius ?? 0) - (rope.segmentRadius ?? 0)) > 0.0001
    ) {
      room._rebuildEditableLayout();
      return rope;
    }
    const current = room.editableRopeObjects.get(rope.id);
    if (current) {
      room._applyRopeToObject(rope, current);
    }
    return rope;
  }

  ropes.push(rope);
  room._rebuildEditableLayout();
  return rope;
}

export function upsertRoomEditableFan(room, definition) {
  const fan = normalizeEditableFan(definition);
  const fans = room.editableLayout.fans ?? (room.editableLayout.fans = []);
  const index = fans.findIndex((entry) => entry.id === fan.id);
  if (index >= 0) {
    const previous = normalizeEditableFan(fans[index]);
    fans[index] = fan;
    if (
      previous.bladeCount !== fan.bladeCount
      || Math.abs(previous.bladeLength - fan.bladeLength) > 0.0001
      || Math.abs(previous.bladeWidth - fan.bladeWidth) > 0.0001
      || Math.abs(previous.hubRadius - fan.hubRadius) > 0.0001
      || Math.abs(previous.rodLength - fan.rodLength) > 0.0001
    ) {
      room._rebuildEditableLayout();
      return fan;
    }
    const current = room.editableFanObjects.get(fan.id);
    if (current) {
      room._applyFanToObject(fan, current);
    }
    return fan;
  }

  fans.push(fan);
  room._rebuildEditableLayout();
  return fan;
}

export function removeRoomEditableRope(room, id) {
  room.editableLayout.ropes = (room.editableLayout.ropes ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditableRope(room, id) {
  room.editableLayout.ropes = (room.editableLayout.ropes ?? []).filter((entry) => entry.id !== id);
  room.loadedEditableLayout.ropes = (room.loadedEditableLayout.ropes ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function removeRoomEditableFan(room, id) {
  room.editableLayout.fans = (room.editableLayout.fans ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function purgeRoomEditableFan(room, id) {
  room.editableLayout.fans = (room.editableLayout.fans ?? []).filter((entry) => entry.id !== id);
  room.loadedEditableLayout.fans = (room.loadedEditableLayout.fans ?? []).filter((entry) => entry.id !== id);
  room._rebuildEditableLayout();
}

export function setRoomRopeHelpersVisible(room, visible) {
  room.ropeHelpersVisible = visible === true;
  room.editableRopeObjects.forEach((entry) => {
    if (entry?.group) {
      entry.group.visible = room.ropeHelpersVisible && !entry.definition?.deleted;
    }
  });
}

export function setRoomVegetationLibrary(room, library) {
  return room.vegetationSystem.setLibrary(library);
}

export function upsertRoomEditableVegetation(room, definition) {
  const vegetation = normalizeEditableVegetation(definition);
  const list = room.editableLayout.vegetation ?? (room.editableLayout.vegetation = []);
  const index = list.findIndex((entry) => entry.id === vegetation.id);
  if (index >= 0) {
    list[index] = vegetation;
  } else {
    list.push(vegetation);
  }
  room.lastVegetationRebuildPromise = room.vegetationSystem.rebuild(list);
  void room.lastVegetationRebuildPromise;
  return vegetation;
}

export function purgeRoomEditableVegetation(room, id) {
  room.editableLayout.vegetation = (room.editableLayout.vegetation ?? []).filter((entry) => entry.id !== id);
  room.loadedEditableLayout.vegetation = (room.loadedEditableLayout.vegetation ?? []).filter((entry) => entry.id !== id);
  room.lastVegetationRebuildPromise = room.vegetationSystem.rebuild(room.editableLayout.vegetation ?? []);
  void room.lastVegetationRebuildPromise;
}
