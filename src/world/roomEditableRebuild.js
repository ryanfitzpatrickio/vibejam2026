import * as THREE from 'three';
import { worldAabbFromLocalBox } from '../physics/meshBvhSupport.js';
import { getGlbCompoundColliderLocalBounds } from '../../shared/roomCollision.js';

export function rebuildRoomEditableLayout(room) {
  room._removeEditableColliders();

  room.editableGroup.traverse((child) => {
    if (child.userData?.isGlbClone) {
      room._disposeEditableMaterialSet(child.material);
      return;
    }
    if (child.geometry && !child.geometry.userData?.isCachedEditableGeometry) child.geometry.dispose();
    room._disposeEditableMaterialSet(child.material);
  });
  room.editableGroup.clear();
  room.editableMeshes.clear();
  room.editableLightObjects.clear();
  room.editablePortalObjects.clear();
  room.editableRopeObjects.clear();
  room.editableFanObjects.clear();
  room.editableExtractionPortalObjects.clear();
  room.editableRaidTaskObjects.clear();
  room.prefabInstanceGroups.clear();
  room.prefabInstanceIdByPrimitiveId.clear();

  const groupedPrimitives = new Map();

  for (const primitive of room.editableLayout.primitives) {
    if (primitive.prefabInstanceId) {
      const bucket = groupedPrimitives.get(primitive.prefabInstanceId) ?? [];
      bucket.push(primitive);
      groupedPrimitives.set(primitive.prefabInstanceId, bucket);
      room.prefabInstanceIdByPrimitiveId.set(primitive.id, primitive.prefabInstanceId);
      continue;
    }

    if (primitive.type === 'glb') {
      const cachedModel = room.glbModelCache.get(primitive.glbAssetId);
      if (!cachedModel) continue;
      const clone = cachedModel.clone(true);
      const rematerialized = room._applySharedGlbSurfaceMaterial(clone, primitive);
      if (!rematerialized) {
        clone.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material = Array.isArray(child.material)
              ? child.material.map((m) => m.clone())
              : child.material.clone();
          }
        });
      }
      clone.name = primitive.name;
      clone.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      clone.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      clone.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
      clone.castShadow = primitive.castShadow;
      clone.receiveShadow = primitive.receiveShadow;
      clone.visible = room._isPrimitiveVisible(primitive);
      clone.userData.editablePrimitive = true;
      clone.userData.primitiveId = primitive.id;
      clone.userData.colliderEnabled = primitive.collider;
      clone.userData.colliderClearance = primitive.colliderClearance ?? 0;
      clone.userData.spawnType = primitive.spawnType;
      clone.userData.skipOutline = primitive.spawnType != null;
      clone.userData.isGlbClone = true;
      clone.traverse((child) => { child.userData.isGlbClone = true; });
      room._syncCameraOccluderUserData(clone, primitive);
      room.editableGroup.add(clone);
      room.editableMeshes.set(primitive.id, clone);

      const collisionMode = room._getEditableGlbCollisionMode(primitive);
      if (collisionMode === 'compound-bounds') {
        const bounds = getGlbCompoundColliderLocalBounds(primitive.glbAssetId) ?? [];
        clone.updateWorldMatrix(true, false);
        bounds.forEach((localBounds, index) => {
          const localBox = new THREE.Box3(
            new THREE.Vector3(localBounds.min.x, localBounds.min.y, localBounds.min.z),
            new THREE.Vector3(localBounds.max.x, localBounds.max.y, localBounds.max.z),
          );
          room.colliders.push({
            mesh: clone,
            aabb: worldAabbFromLocalBox(localBox, clone.matrixWorld),
            type: 'furniture',
            metadata: {
              source: 'editable',
              primitiveId: primitive.id,
              colliderClearance: primitive.colliderClearance,
              collisionMode,
              glbProxy: true,
              glbProxyName: localBounds.name ?? `part-${index}`,
              glbProxyIndex: index,
              localBox,
            },
          });
        });
      } else if (collisionMode === 'bvh-proxy') {
        room._registerCollider(clone, {
          type: 'furniture',
          metadata: {
            source: 'editable',
            primitiveId: primitive.id,
            colliderClearance: primitive.colliderClearance,
            collisionMode,
          },
          useBvh: true,
          bvhOptions: {
            maxDepth: 3,
            maxLeafSize: 18,
            maxBoxes: 48,
          },
        });
      }
      continue;
    }

    if (primitive.type === 'prop') {
      const material = room._createEditablePrimitiveMaterial(primitive);
      const sprite = new THREE.Sprite(material);
      sprite.name = primitive.name;
      sprite.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      sprite.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      sprite.scale.set(primitive.scale.x, primitive.scale.y, 1);
      sprite.castShadow = false;
      sprite.receiveShadow = false;
      sprite.visible = room._isPrimitiveVisible(primitive);
      sprite.userData.editablePrimitive = true;
      sprite.userData.primitiveId = primitive.id;
      sprite.userData.colliderEnabled = false;
      sprite.userData.spawnType = primitive.spawnType;
      sprite.userData.skipOutline = true;
      room._syncCameraOccluderUserData(sprite, primitive);
      room.editableGroup.add(sprite);
      room.editableMeshes.set(primitive.id, sprite);
      continue;
    }

    const geometry = room._getEditableGeometry(primitive);
    const material = room._createEditablePrimitiveMaterial(primitive);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = primitive.name;
    mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
    mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
    mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
    mesh.castShadow = primitive.castShadow;
    mesh.receiveShadow = primitive.receiveShadow;
    mesh.visible = room._isPrimitiveVisible(primitive);
    mesh.userData.editablePrimitive = true;
    mesh.userData.primitiveId = primitive.id;
    mesh.userData.colliderEnabled = primitive.collider;
    mesh.userData.spawnType = primitive.spawnType;
    mesh.userData.skipOutline = primitive.spawnType != null;
    if (primitive.type === 'plane') {
      mesh.renderOrder = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
    }
    room._syncCameraOccluderUserData(mesh, primitive);
    room.editableGroup.add(mesh);
    room.editableMeshes.set(primitive.id, mesh);

    if (primitive.collider) {
      const isPlane = primitive.type === 'plane';
      room._registerPrimitiveCollider(mesh, primitive, {
        type: isPlane ? 'surface' : 'furniture',
        metadata: {
          source: 'editable',
          primitiveId: primitive.id,
          collisionMode: 'primitive',
          ...(isPlane ? { plane: true, zIndex: primitive.zIndex ?? 0 } : {}),
        },
      });
    }
  }

  for (const [instanceId, primitives] of groupedPrimitives.entries()) {
    const anchor = primitives[0];
    if (!anchor) continue;
    const origin = anchor.prefabInstanceOrigin ?? anchor.position;
    const rotation = anchor.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
    const scale = anchor.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };

    const group = new THREE.Group();
    group.name = `PrefabInstance-${instanceId}`;
    group.position.set(origin.x, origin.y, origin.z);
    group.rotation.set(rotation.x, rotation.y, rotation.z);
    group.scale.set(scale.x, scale.y, scale.z);
    group.userData.editablePrimitive = true;
    group.userData.prefabInstanceId = instanceId;
    room.editableGroup.add(group);
    room.prefabInstanceGroups.set(instanceId, {
      group,
      origin,
      rotation,
      scale,
      primitiveIds: primitives.map((primitive) => primitive.id),
    });

    primitives.forEach((primitive) => {
      if (primitive.type === 'prop') {
        const material = room._createEditablePrimitiveMaterial(primitive);
        const sprite = new THREE.Sprite(material);
        sprite.name = primitive.name;
        sprite.position.set(
          primitive.position.x,
          primitive.position.y,
          primitive.position.z,
        );
        sprite.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
        sprite.scale.set(primitive.scale.x, primitive.scale.y, 1);
        sprite.castShadow = false;
        sprite.receiveShadow = false;
        sprite.visible = room._isPrimitiveVisible(primitive);
        sprite.userData.editablePrimitive = true;
        sprite.userData.primitiveId = primitive.id;
        sprite.userData.prefabInstanceId = instanceId;
        sprite.userData.spawnType = primitive.spawnType;
        sprite.userData.skipOutline = true;
        sprite.userData.colliderEnabled = false;
        room._syncCameraOccluderUserData(sprite, primitive);
        group.add(sprite);
        room.editableMeshes.set(primitive.id, sprite);
        room.prefabInstanceIdByPrimitiveId.set(primitive.id, instanceId);
        return;
      }

      const geometry = room._getEditableGeometry(primitive);
      const material = room._createEditablePrimitiveMaterial(primitive);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = primitive.name;
      mesh.position.set(
        primitive.position.x,
        primitive.position.y,
        primitive.position.z,
      );
      mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
      mesh.castShadow = primitive.castShadow;
      mesh.receiveShadow = primitive.receiveShadow;
      mesh.visible = room._isPrimitiveVisible(primitive);
      mesh.userData.editablePrimitive = true;
      mesh.userData.primitiveId = primitive.id;
      mesh.userData.prefabInstanceId = instanceId;
      mesh.userData.spawnType = primitive.spawnType;
      mesh.userData.skipOutline = primitive.spawnType != null;
      if (primitive.type === 'plane') {
        mesh.renderOrder = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
      }
      room._syncCameraOccluderUserData(mesh, primitive);
      group.add(mesh);
      room.editableMeshes.set(primitive.id, mesh);
      room.prefabInstanceIdByPrimitiveId.set(primitive.id, instanceId);

      if (primitive.collider) {
        const isPlane = primitive.type === 'plane';
        room._registerPrimitiveCollider(mesh, primitive, {
          type: isPlane ? 'surface' : 'furniture',
          metadata: {
            source: 'editable',
            primitiveId: primitive.id,
            prefabInstanceId: instanceId,
            ...(isPlane ? { plane: true, zIndex: primitive.zIndex ?? 0 } : {}),
          },
        });
      }
    });
  }

  for (const definition of room.editableLayout.lights ?? []) {
    const entry = room._createEditableLightObject(definition);
    room.editableGroup.add(entry.group);
    room.editableLightObjects.set(entry.definition.id, entry);
  }

  for (const definition of room.editableLayout.portals ?? []) {
    const entry = room._createEditablePortalObject(definition);
    room.editableGroup.add(entry.group);
    room.editablePortalObjects.set(entry.definition.id, entry);
  }

  for (const definition of room.editableLayout.ropes ?? []) {
    const entry = room._createEditableRopeObject(definition);
    room.editableGroup.add(entry.group);
    room.editableRopeObjects.set(entry.definition.id, entry);
  }

  for (const definition of room.editableLayout.fans ?? []) {
    const entry = room._createEditableFanObject(definition);
    room.editableGroup.add(entry.group);
    room.editableFanObjects.set(entry.definition.id, entry);
  }

  for (const definition of room.editableLayout.extractionPortals ?? []) {
    const entry = room._createEditableExtractionPortalObject(definition);
    room.editableGroup.add(entry.group);
    room.editableExtractionPortalObjects.set(entry.definition.id, entry);
  }

  for (const definition of room.editableLayout.raidTasks ?? []) {
    const entry = room._createEditableRaidTaskObject(definition);
    room.editableGroup.add(entry.group);
    room.editableRaidTaskObjects.set(entry.definition.id, entry);
    room._registerRaidTaskPrefabColliders(entry);
  }

  room._applyTextureAtlas();
  room.refreshColliders();
  void room.vegetationSystem.rebuild(room.editableLayout.vegetation ?? []);

  if (room._staticMergeEnabled) {
    room._buildStaticMergedMeshes();
  }
  if (import.meta.env.DEV) {
    console.info('[room] rebuilt editable layout', {
      primitives: room.editableLayout.primitives.length,
      editableMeshes: room.editableMeshes.size,
      editableChildren: room.editableGroup.children.length,
      staticChildren: room._staticMergedGroup.children.length,
      staticBake: room._staticBakeStats,
    });
  }
}
