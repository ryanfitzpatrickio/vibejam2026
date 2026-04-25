import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function clearStaticMergedMeshes(room) {
  // Unhide originals that were merged. Materials on merged meshes are shared
  // references to the originals, so do NOT dispose them. Only dispose
  // geometries we created (the merged path); instanced path reuses the
  // primitive's cached geometry and must not be disposed.
  room._staticMergedGroup.traverse((child) => {
    if (!child.isMesh) return;
    if (child.isInstancedMesh) {
      child.dispose?.();
      return;
    }
    if (child.userData?.staticInstanceKind === 'merged' && child.geometry) {
      child.geometry.dispose();
    }
  });
  room._staticMergedGroup.clear();
  for (const mesh of room.editableMeshes.values()) {
    if (mesh?.userData?.mergedIntoStatic) {
      mesh.userData.mergedIntoStatic = false;
      mesh.visible = room._isPrimitiveVisible(
        room.editableLayout.primitives.find((p) => p.id === mesh.userData.primitiveId) ?? {},
      );
    }
  }
}

function createStaticBakeStats() {
  return {
    instancedGroups: 0,
    instancedPrimitives: 0,
    mergedGroups: 0,
    mergedPrimitives: 0,
    skippedPrimitives: 0,
    totalEligible: 0,
    // One draw call per instanced group + one per merged group, replacing
    // `instancedPrimitives + mergedPrimitives` original per-mesh calls.
    bakedDrawCalls: 0,
    replacedDrawCalls: 0,
  };
}

function collectStaticInstanceGroups(room, stats) {
  const instanceGroups = new Map();
  for (const [primitiveId, mesh] of room.editableMeshes.entries()) {
    if (!mesh?.isMesh) continue;
    if (mesh.userData?.isGlbClone) { stats.skippedPrimitives += 1; continue; }
    if (mesh.userData?.spawnType) { stats.skippedPrimitives += 1; continue; }
    if (!mesh.visible) { stats.skippedPrimitives += 1; continue; }
    if (!mesh.geometry || !mesh.material) { stats.skippedPrimitives += 1; continue; }
    if (Array.isArray(mesh.material)) { stats.skippedPrimitives += 1; continue; }
    stats.totalEligible += 1;

    const castShadow = mesh.castShadow ? 1 : 0;
    const receiveShadow = mesh.receiveShadow ? 1 : 0;
    const instanceKey = `${mesh.geometry.uuid}|${mesh.material.uuid}|${castShadow}|${receiveShadow}`;
    let bucket = instanceGroups.get(instanceKey);
    if (!bucket) {
      bucket = {
        geometry: mesh.geometry,
        material: mesh.material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        meshes: [],
      };
      instanceGroups.set(instanceKey, bucket);
    }
    bucket.meshes.push({ mesh, primitiveId });
  }
  return instanceGroups;
}

function buildInstancedGroups(room, instanceGroups, parentInv, localMatrix, stats) {
  const mergeCandidates = [];
  for (const bucket of instanceGroups.values()) {
    if (bucket.meshes.length < 2) {
      // Single mesh: let the merge pass try to pair it by material instead.
      for (const entry of bucket.meshes) mergeCandidates.push(entry);
      continue;
    }

    const instanced = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.meshes.length);
    instanced.castShadow = bucket.castShadow;
    instanced.receiveShadow = bucket.receiveShadow;
    instanced.userData.isStaticMerged = true;
    instanced.userData.staticInstanceKind = 'instanced';
    instanced.userData.skipOutline = true;
    // Instance matrices place room parts across the whole authored level; the
    // source geometry bounds stay near local origin and can be culled incorrectly.
    instanced.frustumCulled = false;
    instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    bucket.meshes.forEach((entry, i) => {
      entry.mesh.updateMatrixWorld(true);
      localMatrix.multiplyMatrices(parentInv, entry.mesh.matrixWorld);
      instanced.setMatrixAt(i, localMatrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    room._staticMergedGroup.add(instanced);

    for (const entry of bucket.meshes) {
      entry.mesh.visible = false;
      entry.mesh.userData.mergedIntoStatic = true;
    }
    stats.instancedGroups += 1;
    stats.instancedPrimitives += bucket.meshes.length;
  }
  return mergeCandidates;
}

function collectMergeGroups(mergeCandidates) {
  const mergeGroups = new Map();
  for (const entry of mergeCandidates) {
    const { mesh } = entry;
    const key = `${mesh.material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
    let bucket = mergeGroups.get(key);
    if (!bucket) {
      bucket = {
        material: mesh.material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        meshes: [],
      };
      mergeGroups.set(key, bucket);
    }
    bucket.meshes.push(entry);
  }
  return mergeGroups;
}

function buildMergedGroups(room, mergeGroups, parentInv, localMatrix, stats) {
  for (const bucket of mergeGroups.values()) {
    if (bucket.meshes.length < 2) continue;

    const geometries = [];
    const merged = [];
    for (const entry of bucket.meshes) {
      const { mesh } = entry;
      const source = mesh.geometry;
      if (!source.attributes?.position) continue;
      const baked = source.clone();
      if (baked.groups?.length) baked.clearGroups();
      mesh.updateMatrixWorld(true);
      localMatrix.multiplyMatrices(parentInv, mesh.matrixWorld);
      baked.applyMatrix4(localMatrix);
      geometries.push(baked);
      merged.push(entry);
    }

    if (geometries.length < 2) {
      geometries.forEach((g) => g.dispose());
      continue;
    }

    const mergedGeometry = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!mergedGeometry) continue;
    mergedGeometry.computeBoundingBox();
    mergedGeometry.computeBoundingSphere();

    const mergedMesh = new THREE.Mesh(mergedGeometry, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    mergedMesh.userData.isStaticMerged = true;
    mergedMesh.userData.staticInstanceKind = 'merged';
    mergedMesh.userData.skipOutline = true;
    mergedMesh.frustumCulled = false;
    room._staticMergedGroup.add(mergedMesh);

    for (const entry of merged) {
      entry.mesh.visible = false;
      entry.mesh.userData.mergedIntoStatic = true;
    }
    stats.mergedGroups += 1;
    stats.mergedPrimitives += merged.length;
  }
}

export function buildStaticMergedMeshes(room) {
  clearStaticMergedMeshes(room);
  const stats = createStaticBakeStats();
  const instanceGroups = collectStaticInstanceGroups(room, stats);

  room.editableGroup.updateMatrixWorld(true);
  const parentInv = new THREE.Matrix4().copy(room._staticMergedGroup.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4();

  const mergeCandidates = buildInstancedGroups(room, instanceGroups, parentInv, localMatrix, stats);
  const mergeGroups = collectMergeGroups(mergeCandidates);
  buildMergedGroups(room, mergeGroups, parentInv, localMatrix, stats);

  stats.bakedDrawCalls = stats.instancedGroups + stats.mergedGroups;
  stats.replacedDrawCalls = stats.instancedPrimitives + stats.mergedPrimitives;
  room._staticBakeStats = stats;
}
