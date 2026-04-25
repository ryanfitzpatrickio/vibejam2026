import * as THREE from 'three';
import {
  collectBvhProxyColliderBoxes,
  worldAabbFromLocalBox,
} from '../physics/meshBvhSupport.js';
import { sortCollidersForPlaneZIndex } from '../../shared/physics.js';
import { createWedgeLocalColliderBoxes } from '../../shared/wedgeCollision.js';
import {
  AABB,
  isObjectVisibleInHierarchy,
} from './roomUtils.js';

export function refreshRoomColliders(room) {
  room.group.updateMatrixWorld(true);
  const active = [];
  room.colliders.forEach((collider) => {
    const mesh = collider.mesh;
    const mergedHidden = mesh?.userData?.mergedIntoStatic === true;
    const alwaysActive = mesh?.userData?.colliderAlwaysActive === true;
    const visible = mesh && (mergedHidden || isObjectVisibleInHierarchy(mesh));
    if ((!visible && !alwaysActive) || mesh?.userData?.colliderEnabled === false) {
      return;
    }
    if (collider.metadata?.localBox) {
      collider.aabb = worldAabbFromLocalBox(collider.metadata.localBox, collider.mesh.matrixWorld);
    } else {
      collider.aabb = AABB.fromMesh(collider.mesh);
    }
    const clearance = collider.metadata?.colliderClearance ?? collider.mesh?.userData?.colliderClearance ?? 0;
    if (clearance > 0) {
      collider.aabb.min.y += clearance;
    }
    active.push(collider);
  });
  return active;
}

export function registerRoomCollider(room, mesh, {
  type = 'furniture',
  metadata = {},
  useBvh = false,
  bvhOptions = null,
} = {}) {
  if (!mesh) return;
  if (useBvh) {
    const localBoxes = collectBvhProxyColliderBoxes(mesh, {
      maxDepth: bvhOptions?.maxDepth ?? 3,
      maxLeafSize: bvhOptions?.maxLeafSize ?? 16,
      maxBoxes: bvhOptions?.maxBoxes ?? 48,
      minSize: bvhOptions?.minSize ?? 0.04,
      exclude: bvhOptions?.exclude ?? null,
    });
    if (localBoxes.length) {
      localBoxes.forEach((localBox, index) => {
        room.colliders.push({
          mesh,
          aabb: worldAabbFromLocalBox(localBox, mesh.matrixWorld),
          type,
          metadata: {
            ...metadata,
            localBox,
            bvhProxy: true,
            bvhProxyIndex: index,
          },
        });
      });
      return;
    }
  }

  room.colliders.push({
    mesh,
    aabb: AABB.fromMesh(mesh),
    type,
    metadata,
  });
}

export function registerPrimitiveRoomCollider(room, mesh, primitive, {
  type = primitive?.type === 'plane' ? 'surface' : 'furniture',
  metadata = {},
} = {}) {
  if (!mesh || !primitive?.collider) return;

  if (primitive.type === 'wedge') {
    const localBoxes = createWedgeLocalColliderBoxes().map((box) => new THREE.Box3(
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ));
    localBoxes.forEach((localBox, index) => {
      room.colliders.push({
        mesh,
        aabb: worldAabbFromLocalBox(localBox, mesh.matrixWorld),
        type,
        metadata: {
          ...metadata,
          localBox,
          wedgeProxy: true,
          wedgeProxyIndex: index,
        },
      });
    });
    return;
  }

  registerRoomCollider(room, mesh, { type, metadata });
}

export function checkRoomCollision(room, playerAABB) {
  refreshRoomColliders(room);
  return room.colliders.filter((col) => playerAABB.intersects(col.aabb));
}

export function getRoomCollisionColliders(room) {
  return sortCollidersForPlaneZIndex(refreshRoomColliders(room));
}

export function getRoomClimbables(room) {
  return room.climbables.filter((mesh) => (
    mesh.visible !== false || mesh.userData?.mergedIntoStatic === true
  ) && mesh.userData?.colliderEnabled !== false);
}

export function getRoomRunnables(room) {
  return room.runnables.filter((mesh) => (
    mesh.visible !== false || mesh.userData?.mergedIntoStatic === true
  ) && mesh.userData?.colliderEnabled !== false);
}
