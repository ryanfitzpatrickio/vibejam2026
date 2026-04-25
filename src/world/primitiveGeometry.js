import * as THREE from 'three';

export function createPrimitiveGeometry(type) {
  if (type === 'wedge') {
    const positions = new Float32Array([
      -0.5, -0.5, -0.5,
      -0.5, 0.5, -0.5,
      0.5, 0.5, -0.5,
      0.5, -0.5, -0.5,
      -0.5, -0.5, -0.5,
      0.5, -0.5, -0.5,
      0.5, -0.5, 0.5,
      -0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,
      -0.5, -0.5, 0.5,
      -0.5, 0.5, -0.5,
      0.5, -0.5, -0.5,
      0.5, 0.5, -0.5,
      0.5, -0.5, 0.5,
      -0.5, 0.5, -0.5,
      -0.5, -0.5, 0.5,
      0.5, -0.5, 0.5,
      0.5, 0.5, -0.5,
    ]);
    const uvs = new Float32Array([
      0, 0,
      0, 1,
      1, 1,
      1, 0,
      0, 1,
      1, 1,
      1, 0,
      0, 0,
      0, 0,
      1, 0,
      0, 1,
      0, 0,
      0, 1,
      1, 0,
      0, 1,
      0, 0,
      1, 0,
      1, 1,
    ]);
    const indices = [
      0, 1, 2,
      0, 2, 3,
      4, 5, 6,
      4, 6, 7,
      8, 9, 10,
      11, 12, 13,
      14, 15, 16,
      14, 16, 17,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.clearGroups();
    geometry.addGroup(0, 6, 0);
    geometry.addGroup(6, 6, 1);
    geometry.addGroup(12, 3, 2);
    geometry.addGroup(15, 3, 3);
    geometry.addGroup(18, 6, 4);
    geometry.computeVertexNormals();
    return geometry;
  }

  switch (type) {
    case 'prop':
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1);
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}
