import * as THREE from 'three';

export function roundVectorLike(source, fallback) {
  return {
    x: Number((source?.x ?? fallback.x).toFixed(4)),
    y: Number((source?.y ?? fallback.y).toFixed(4)),
    z: Number((source?.z ?? fallback.z).toFixed(4)),
  };
}

export function isObjectVisibleInHierarchy(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

export function worldToLocalPrefabPosition(position, origin, rotation, scale) {
  const local = new THREE.Vector3(
    position.x - origin.x,
    position.y - origin.y,
    position.z - origin.z,
  );
  const inverseRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0),
  ).invert();
  local.applyQuaternion(inverseRotation);
  local.divide(new THREE.Vector3(
    Math.abs(scale.x) > 1e-6 ? scale.x : 1,
    Math.abs(scale.y) > 1e-6 ? scale.y : 1,
    Math.abs(scale.z) > 1e-6 ? scale.z : 1,
  ));
  return roundVectorLike(local, { x: 0, y: 0, z: 0 });
}

export function cloneLayout(layout, fallback) {
  return JSON.parse(JSON.stringify(layout ?? fallback));
}

export class AABB {
  constructor(min = new THREE.Vector3(), max = new THREE.Vector3()) {
    this.min = min;
    this.max = max;
  }

  static fromMesh(mesh) {
    const box = new THREE.Box3();
    box.setFromObject(mesh);
    return new AABB(box.min.clone(), box.max.clone());
  }

  intersects(other) {
    return (
      this.min.x <= other.max.x &&
      this.max.x >= other.min.x &&
      this.min.y <= other.max.y &&
      this.max.y >= other.min.y &&
      this.min.z <= other.max.z &&
      this.max.z >= other.min.z
    );
  }
}
