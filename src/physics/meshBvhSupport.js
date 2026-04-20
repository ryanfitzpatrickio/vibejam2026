import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

let installed = false;

const _rootInverse = new THREE.Matrix4();
const _relativeMatrix = new THREE.Matrix4();
const _size = new THREE.Vector3();

export function installMeshBvhSupport() {
  if (installed) return;
  installed = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

export function ensureMeshGeometryBvh(geometry, options = {}) {
  if (!geometry?.attributes?.position) return false;
  installMeshBvhSupport();
  if (!geometry.boundsTree) {
    geometry.computeBoundsTree?.({
      strategy: options.strategy,
      maxDepth: options.maxDepth ?? 24,
      maxLeafTris: options.maxLeafTris ?? 16,
    });
  }
  return !!geometry.boundsTree;
}

function toBox3(boundingData) {
  return new THREE.Box3(
    new THREE.Vector3(boundingData[0], boundingData[1], boundingData[2]),
    new THREE.Vector3(boundingData[3], boundingData[4], boundingData[5]),
  );
}

export function collectBvhProxyBoxes(root, {
  maxDepth = 3,
  maxLeafTris = 16,
  maxBoxes = 48,
  minSize = 0.04,
  exclude = null,
} = {}) {
  if (!root) return [];
  installMeshBvhSupport();
  root.updateMatrixWorld(true);
  _rootInverse.copy(root.matrixWorld).invert();
  const boxes = [];

  root.traverse((child) => {
    if (boxes.length >= maxBoxes) return;
    if (!child?.isMesh) return;
    if (exclude?.(child)) return;
    const geometry = child.geometry;
    if (!ensureMeshGeometryBvh(geometry, { maxLeafTris })) return;

    _relativeMatrix.multiplyMatrices(_rootInverse, child.matrixWorld);
    geometry.boundsTree.traverse((depth, isLeaf, boundingData, _offsetOrSplit, triCount = 0) => {
      if (boxes.length >= maxBoxes) return true;
      const shouldCollect = isLeaf || depth >= maxDepth || triCount <= maxLeafTris;
      if (!shouldCollect) return false;
      const localBox = toBox3(boundingData).applyMatrix4(_relativeMatrix);
      localBox.getSize(_size);
      if (_size.x < minSize && _size.y < minSize && _size.z < minSize) {
        return true;
      }
      boxes.push(localBox.clone());
      return true;
    });
  });

  return boxes;
}

export function worldAabbFromLocalBox(localBox, matrixWorld) {
  const worldBox = localBox.clone().applyMatrix4(matrixWorld);
  return {
    min: worldBox.min.clone(),
    max: worldBox.max.clone(),
  };
}
