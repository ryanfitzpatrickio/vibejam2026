import { normalizeEditablePrimitive } from './editableLayoutNormalize.js';

export function getRoomEditableObject(room, id) {
  const vegetationObject = room.vegetationSystem.getEditableObject(id);
  if (vegetationObject) {
    return vegetationObject;
  }
  if (room.editableLightObjects.has(id)) {
    return room.editableLightObjects.get(id)?.group ?? null;
  }
  if (room.editablePortalObjects.has(id)) {
    return room.editablePortalObjects.get(id)?.group ?? null;
  }
  if (room.editableExtractionPortalObjects.has(id)) {
    return room.editableExtractionPortalObjects.get(id)?.group ?? null;
  }
  if (room.editableRaidTaskObjects.has(id)) {
    const entry = room.editableRaidTaskObjects.get(id);
    const slot = room.raidTaskPrefabEditTargets.get(id);
    if (slot === 'before' || slot === 'after') {
      return entry?.group.userData.getRaidTaskPrefabObject?.(slot) ?? entry?.group ?? null;
    }
    return entry?.group ?? null;
  }
  if (room.editableFanObjects.has(id)) {
    return room.editableFanObjects.get(id)?.group ?? null;
  }
  if (room.editableRopeObjects.has(id)) {
    return room.editableRopeObjects.get(id)?.group ?? null;
  }
  const prefabInstanceId = room.prefabInstanceIdByPrimitiveId.get(id);
  if (prefabInstanceId) {
    return room.prefabInstanceGroups.get(prefabInstanceId)?.group ?? null;
  }
  if (room.builtInEditableMeshes.has(id)) {
    return room.builtInEditableMeshes.get(id)?.mesh ?? null;
  }

  return room.editableMeshes.get(id) ?? null;
}

export function instantiateRoomPrefab(room, prefab, {
  col = 0,
  row = 0,
  scale: placeScale = 2,
  instanceId = `prefab-instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
} = {}) {
  if (!prefab?.id || !Array.isArray(prefab.primitives)) {
    return [];
  }

  const size = {
    x: Math.max(1, Math.round(prefab.size?.x ?? 1)),
    y: Math.max(1, Math.round(prefab.size?.y ?? 1)),
    z: Math.max(1, Math.round(prefab.size?.z ?? 1)),
  };
  const anchor = room.getBuildGridAnchorPosition(col, row, size.x, size.z);
  const created = [];

  prefab.primitives.forEach((part, index) => {
    const primitive = normalizeEditablePrimitive({
      ...part,
      id: `${instanceId}-part-${index + 1}`,
      name: `${prefab.name}-${part.name ?? `part-${index + 1}`}`,
      position: {
        x: (part.position?.x ?? 0) * placeScale,
        y: (part.position?.y ?? 0) * placeScale,
        z: (part.position?.z ?? 0) * placeScale,
      },
      scale: {
        x: (part.scale?.x ?? 1) * placeScale,
        y: (part.scale?.y ?? 1) * placeScale,
        z: (part.scale?.z ?? 1) * placeScale,
      },
      prefabInstanceOrigin: {
        x: anchor.x,
        y: anchor.y,
        z: anchor.z,
      },
      prefabInstanceRotation: {
        x: 0,
        y: 0,
        z: 0,
      },
      prefabInstanceScale: {
        x: 1,
        y: 1,
        z: 1,
      },
      prefabId: prefab.id,
      prefabInstanceId: instanceId,
    });
    room.upsertEditablePrimitive(primitive);
    created.push(primitive.id);
  });

  return created;
}
