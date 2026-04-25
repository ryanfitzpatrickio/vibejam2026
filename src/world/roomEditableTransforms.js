import { cloneVectorLike } from './editableLayoutNormalize.js';
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
import { roundVectorLike } from './roomUtils.js';

export function updateRoomEditableRopeTransform(room, id, transform = {}) {
  const ropes = room.editableLayout.ropes ?? [];
  const index = ropes.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const rope = normalizeEditableRope(ropes[index]);
  if (transform.position) {
    rope.anchor = cloneVectorLike(transform.position, rope.anchor);
  } else if (transform.anchor) {
    rope.anchor = cloneVectorLike(transform.anchor, rope.anchor);
  }

  ropes[index] = rope;
  const current = room.editableRopeObjects.get(id);
  if (current) {
    room._applyRopeToObject(rope, current);
  }
  return rope;
}

export function updateRoomEditableFanTransform(room, id, transform = {}) {
  const fans = room.editableLayout.fans ?? [];
  const index = fans.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const fan = normalizeEditableFan(fans[index]);
  if (transform.position) {
    fan.position = cloneVectorLike(transform.position, fan.position);
  }
  if (transform.rotation) {
    fan.rotation = cloneVectorLike(transform.rotation, fan.rotation);
  }
  fans[index] = fan;
  const current = room.editableFanObjects.get(id);
  if (current) {
    room._applyFanToObject(fan, current);
  }
  return fan;
}

export function updateRoomEditableVegetationTransform(room, id, transform = {}) {
  const list = room.editableLayout.vegetation ?? [];
  const index = list.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const vegetation = normalizeEditableVegetation(list[index]);
  if (transform.position) {
    vegetation.position = cloneVectorLike(transform.position, vegetation.position);
  }
  if (transform.rotation) {
    vegetation.rotation = cloneVectorLike(transform.rotation, vegetation.rotation);
  }
  if (transform.scale) {
    vegetation.scale = cloneVectorLike(transform.scale, vegetation.scale);
  }

  list[index] = vegetation;
  const current = room.vegetationSystem.getEditableObject(id);
  if (current) {
    current.position.set(vegetation.position.x, vegetation.position.y, vegetation.position.z);
    current.rotation.set(vegetation.rotation.x, vegetation.rotation.y, vegetation.rotation.z);
    current.scale.set(vegetation.scale.x, vegetation.scale.y, vegetation.scale.z);
    current.updateMatrixWorld(true);
    room.refreshColliders();
  }
  return vegetation;
}

export function updateRoomEditablePrimitiveTransform(room, id, transform = {}) {
  if (!id) return null;

  const prefabInstanceId = room.prefabInstanceIdByPrimitiveId.get(id);
  if (prefabInstanceId) {
    return room.updatePrefabInstanceTransform(prefabInstanceId, transform);
  }

  if (room.prefabInstanceGroups.has(id)) {
    return room.updatePrefabInstanceTransform(id, transform);
  }

  if (room.builtInEditableMeshes.has(id)) {
    const entry = room.builtInEditableMeshes.get(id);
    const next = room._serializeBuiltInPrimitive(entry);

    if (transform.position) {
      next.position = cloneVectorLike(transform.position, next.position);
    }
    if (transform.rotation) {
      next.rotation = cloneVectorLike(transform.rotation, next.rotation);
    }
    if (transform.scale) {
      next.scale = cloneVectorLike(transform.scale, next.scale);
    }

    return room.upsertEditablePrimitive(next);
  }

  const index = room.editableLayout.primitives.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const primitive = normalizeEditablePrimitive(room.editableLayout.primitives[index]);
  if (transform.position) {
    primitive.position = cloneVectorLike(transform.position, primitive.position);
  }
  if (transform.rotation) {
    primitive.rotation = cloneVectorLike(transform.rotation, primitive.rotation);
  }
  if (transform.scale) {
    primitive.scale = cloneVectorLike(transform.scale, primitive.scale);
  }

  room.editableLayout.primitives[index] = primitive;
  const mesh = room.editableMeshes.get(id);
  if (mesh) {
    mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
    mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
    mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
    mesh.updateMatrixWorld(true);
  }
  room.refreshColliders();
  return primitive;
}

export function updateRoomEditableLightTransform(room, id, transform = {}) {
  const index = room.editableLayout.lights.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const light = normalizeEditableLight(room.editableLayout.lights[index]);
  if (transform.position) {
    light.position = cloneVectorLike(transform.position, light.position);
  }
  if (transform.rotation) {
    light.rotation = cloneVectorLike(transform.rotation, light.rotation);
  }

  room.editableLayout.lights[index] = light;
  const current = room.editableLightObjects.get(id);
  if (current) {
    room._applyLightToObject(light, current);
  }
  return light;
}

export function updateRoomEditablePortalTransform(room, id, transform = {}) {
  const index = room.editableLayout.portals.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const portal = normalizeEditablePortal(room.editableLayout.portals[index]);
  if (transform.position) {
    portal.position = cloneVectorLike(transform.position, portal.position);
  }
  if (transform.rotation) {
    portal.rotation = cloneVectorLike(transform.rotation, portal.rotation);
  }
  if (Number.isFinite(transform.triggerRadius)) {
    portal.triggerRadius = Math.max(0.1, transform.triggerRadius);
  }

  room.editableLayout.portals[index] = portal;
  const current = room.editablePortalObjects.get(id);
  if (current) {
    room._applyPortalToObject(portal, current);
  }
  return portal;
}

export function updateRoomEditableExtractionPortalTransform(room, id, transform = {}) {
  const list = room.editableLayout.extractionPortals ?? [];
  const index = list.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const ep = normalizeEditableExtractionPortal(list[index]);
  if (transform.position) {
    ep.position = cloneVectorLike(transform.position, ep.position);
  }
  if (transform.rotation) {
    ep.rotation = cloneVectorLike(transform.rotation, ep.rotation);
  }
  if (Number.isFinite(transform.radius)) {
    ep.radius = Math.max(0.35, Math.min(4, transform.radius));
  }

  list[index] = ep;
  const current = room.editableExtractionPortalObjects.get(id);
  if (current) {
    room._applyExtractionPortalToObject(ep, current);
  }
  return ep;
}

export function updateRoomEditableRaidTaskTransform(room, id, transform = {}) {
  const list = room.editableLayout.raidTasks ?? [];
  const index = list.findIndex((entry) => entry.id === id);
  if (index < 0) return null;

  const task = normalizeEditableRaidTask(list[index]);
  const prefabSlot = transform.prefabSlot === 'before' || transform.prefabSlot === 'after'
    ? transform.prefabSlot
    : null;
  if (prefabSlot) {
    const key = prefabSlot === 'after' ? 'afterPrefab' : 'beforePrefab';
    const currentPrefab = task[key] ?? {
      enabled: true,
      prefabId: '',
      name: '',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      primitives: [],
    };
    task[key] = {
      ...currentPrefab,
      enabled: currentPrefab.enabled !== false,
      position: transform.position ? cloneVectorLike(transform.position, currentPrefab.position) : currentPrefab.position,
      rotation: transform.rotation ? cloneVectorLike(transform.rotation, currentPrefab.rotation) : currentPrefab.rotation,
      scale: transform.scale ? cloneVectorLike(transform.scale, currentPrefab.scale) : currentPrefab.scale,
    };
    list[index] = normalizeEditableRaidTask(task);
    const current = room.editableRaidTaskObjects.get(id);
    if (current) {
      room._applyRaidTaskToObject(list[index], current);
    }
    return list[index];
  }

  if (transform.position) {
    task.position = cloneVectorLike(transform.position, task.position);
  }
  if (transform.rotation) {
    task.rotation = cloneVectorLike(transform.rotation, task.rotation);
  }

  list[index] = task;
  const current = room.editableRaidTaskObjects.get(id);
  if (current) {
    room._applyRaidTaskToObject(task, current);
  }
  return task;
}

export function updateRoomPrefabInstanceTransform(room, instanceId, transform = {}) {
  const primitives = room.editableLayout.primitives.filter((entry) => entry.prefabInstanceId === instanceId);
  if (!primitives.length) return null;

  if (!transform.position && !transform.rotation && !transform.scale) {
    return primitives[0];
  }

  const anchor = primitives[0].prefabInstanceOrigin ?? primitives[0].position;
  const nextAnchor = transform.position ? cloneVectorLike(transform.position, anchor) : cloneVectorLike(anchor, { x: 0, y: 0, z: 0 });
  const nextRotation = transform.rotation
    ? cloneVectorLike(transform.rotation, primitives[0].prefabInstanceRotation ?? { x: 0, y: 0, z: 0 })
    : cloneVectorLike(primitives[0].prefabInstanceRotation ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const nextScale = transform.scale
    ? cloneVectorLike(transform.scale, primitives[0].prefabInstanceScale ?? { x: 1, y: 1, z: 1 })
    : cloneVectorLike(primitives[0].prefabInstanceScale ?? { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });

  primitives.forEach((primitive) => {
    primitive.prefabInstanceOrigin = roundVectorLike(nextAnchor, { x: 0, y: 0, z: 0 });
    primitive.prefabInstanceRotation = roundVectorLike(nextRotation, { x: 0, y: 0, z: 0 });
    primitive.prefabInstanceScale = roundVectorLike(nextScale, { x: 1, y: 1, z: 1 });
  });

  room.editableLayout.primitives = room.editableLayout.primitives.map((entry) => (
    entry.prefabInstanceId === instanceId
      ? primitives.find((primitive) => primitive.id === entry.id) ?? entry
      : entry
  ));

  const instanceEntry = room.prefabInstanceGroups.get(instanceId);
  if (instanceEntry) {
    const newOrigin = primitives[0].prefabInstanceOrigin ?? primitives[0].position;
    const newRotation = primitives[0].prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
    const newScale = primitives[0].prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
    instanceEntry.group.position.set(newOrigin.x, newOrigin.y, newOrigin.z);
    instanceEntry.group.rotation.set(newRotation.x, newRotation.y, newRotation.z);
    instanceEntry.group.scale.set(newScale.x, newScale.y, newScale.z);
    instanceEntry.origin = cloneVectorLike(newOrigin, { x: 0, y: 0, z: 0 });
    instanceEntry.rotation = cloneVectorLike(newRotation, { x: 0, y: 0, z: 0 });
    instanceEntry.scale = cloneVectorLike(newScale, { x: 1, y: 1, z: 1 });

    primitives.forEach((primitive) => {
      const mesh = room.editableMeshes.get(primitive.id);
      if (mesh) {
        mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      }
    });

    instanceEntry.group.updateMatrixWorld(true);
  }

  room.refreshColliders();
  return primitives[0];
}
