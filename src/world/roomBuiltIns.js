import * as THREE from 'three';
import {
  materialToEditableSurface,
  ROOM_TEXTURE_CELLS,
} from './editableLayoutNormalize.js';
import { AABB } from './roomUtils.js';

export function buildRoomBuiltIns(room) {
  buildFloorAndWalls(room);
}

export function buildFloorAndWalls(room) {
  const floorMat = room._createSurfaceMaterial(room.floorColor, {
    textureCell: ROOM_TEXTURE_CELLS.floor,
    roughness: 0.98,
    metalness: 0.02,
    planeZIndex: 0,
  });

  const floorGeo = new THREE.PlaneGeometry(room.width, room.depth);
  const floorRepeat = { x: 6, y: 6, rotation: 0 };
  // Keep pristine UVs so later repeat/rotation changes can rebake from 0-1 space.
  const floorBaseUvs = new Float32Array(floorGeo.getAttribute('uv').array);
  room._bakeUvTransform(floorGeo, floorRepeat);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI * 0.5;
  floor.position.y = 0;
  floor.name = 'Floor';
  floor.renderOrder = 0;
  floor.receiveShadow = true;
  floor.userData.surfaceType = 'floor';
  floor.userData.cameraOccluder = false;
  floor.userData.textureRepeat = floorRepeat;
  floor.userData._baseUvs = floorBaseUvs;
  room.group.add(floor);
  const floorCollider = {
    mesh: floor,
    aabb: AABB.fromMesh(floor),
    type: 'surface',
    metadata: { runnable: true, plane: true, zIndex: 0 },
  };
  room.colliders.push(floorCollider);
  room.runnables.push(floor);
  room._registerBuiltInPrimitive(floor, {
    id: 'builtin-floor',
    name: floor.name,
    type: 'plane',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: floor.rotation.x, y: floor.rotation.y, z: floor.rotation.z },
    scale: { x: room.width, y: room.depth, z: 1 },
    texture: {
      cell: floorMat.userData.textureCell,
      repeat: {
        x: floorRepeat.x,
        y: floorRepeat.y,
      },
      rotation: floorRepeat.rotation,
      offset: { x: 0, y: 0 },
    },
    material: materialToEditableSurface(floorMat, room.floorColor),
    collider: true,
    castShadow: false,
    receiveShadow: true,
  }, floorCollider);
}
