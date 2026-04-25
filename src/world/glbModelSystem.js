import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assetUrl } from '../utils/assetUrl.js';
import { ensureMeshGeometryBvh } from '../physics/meshBvhSupport.js';
import { createPrimitiveGeometry } from './primitiveGeometry.js';

export async function loadGlbRegistry(room) {
  if (room.glbRegistry) return room.glbRegistry;
  try {
    const response = await fetch(assetUrl('levels/glb-registry.json'), { cache: 'no-store' });
    if (!response.ok) return { assets: [] };
    room.glbRegistry = await response.json();
    return room.glbRegistry;
  } catch {
    return { assets: [] };
  }
}

export async function initGlbLoader(room) {
  if (room.glbLoader) return;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  room.glbLoader = new GLTFLoader();
  room.glbLoader.setMeshoptDecoder(MeshoptDecoder);
}

export function applyGlbChromaKey(scene, assetEntry = null) {
  if (assetEntry?.chromaKey !== true) return;
  const processed = new Set();
  scene.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material?.map || processed.has(material.map)) return;
      const texture = material.map;
      const image = texture.image;
      if (!image || processed.has(image)) return;

      const canvas = document.createElement('canvas');
      canvas.width = image.width || image.videoWidth || 1;
      canvas.height = image.height || image.videoHeight || 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let changed = false;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (g > 200 && r < 80 && b < 80) {
          data[i + 3] = 0;
          changed = true;
        }
      }

      if (changed) {
        ctx.putImageData(imageData, 0, 0);
        texture.image = canvas;
        texture.needsUpdate = true;
        material.transparent = true;
        material.alphaTest = 0.1;
        material.needsUpdate = true;
      }

      processed.add(texture);
      processed.add(image);
    });
  });
}

export function getGeneratedBakeSourceBounds(room, assetId) {
  const sourcePrimitives = (room.loadedEditableLayout?.primitives ?? []).filter((primitive) => (
    primitive?.bakedAssetId === assetId
    && !primitive?.deleted
    && primitive?.type !== 'prop'
    && primitive?.type !== 'glb'
  ));
  if (!sourcePrimitives.length) return null;

  const combined = new THREE.Box3();
  let hasAny = false;
  const localPosition = new THREE.Vector3();
  const localScale = new THREE.Vector3();
  const prefabOrigin = new THREE.Vector3();
  const prefabScale = new THREE.Vector3();
  const localEuler = new THREE.Euler();
  const prefabEuler = new THREE.Euler();
  const localQuat = new THREE.Quaternion();
  const prefabQuat = new THREE.Quaternion();
  const localMatrix = new THREE.Matrix4();
  const prefabMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();

  for (const primitive of sourcePrimitives) {
    const geometry = createPrimitiveGeometry(primitive.type);
    localPosition.set(primitive.position.x, primitive.position.y, primitive.position.z);
    localEuler.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
    localQuat.setFromEuler(localEuler);
    localScale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
    localMatrix.compose(localPosition, localQuat, localScale);
    worldMatrix.copy(localMatrix);

    if (primitive.prefabInstanceId) {
      const origin = primitive.prefabInstanceOrigin ?? { x: 0, y: 0, z: 0 };
      const rotation = primitive.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
      const scale = primitive.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
      prefabOrigin.set(origin.x, origin.y, origin.z);
      prefabEuler.set(rotation.x, rotation.y, rotation.z);
      prefabQuat.setFromEuler(prefabEuler);
      prefabScale.set(scale.x, scale.y, scale.z);
      prefabMatrix.compose(prefabOrigin, prefabQuat, prefabScale);
      worldMatrix.premultiply(prefabMatrix);
    }

    geometry.applyMatrix4(worldMatrix);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      if (!hasAny) {
        combined.copy(geometry.boundingBox);
        hasAny = true;
      } else {
        combined.union(geometry.boundingBox);
      }
    }
    geometry.dispose();
  }

  return hasAny ? combined : null;
}

export function validateGeneratedBakeScene(room, assetId, scene) {
  const expectedBounds = getGeneratedBakeSourceBounds(room, assetId);
  if (!expectedBounds) return true;

  scene.updateMatrixWorld(true);
  const actualBounds = new THREE.Box3().setFromObject(scene);
  const expectedSize = expectedBounds.getSize(new THREE.Vector3());
  const actualSize = actualBounds.getSize(new THREE.Vector3());
  const expectedMax = Math.max(expectedSize.x, expectedSize.y, expectedSize.z, 0.0001);
  const actualMax = Math.max(actualSize.x, actualSize.y, actualSize.z, 0.0001);
  const ratio = actualMax / expectedMax;

  if (ratio < 0.6 || ratio > 1.67) {
    console.warn(
      `[generated-bake] rejecting ${assetId}: loaded size ratio ${ratio.toFixed(3)} expected=${expectedSize.toArray().map((n) => n.toFixed(3)).join(',')} actual=${actualSize.toArray().map((n) => n.toFixed(3)).join(',')}`,
    );
    return false;
  }

  return true;
}

export function flattenGlbScene(scene) {
  let hasSkinned = false;
  let hasMorphs = false;
  const meshes = [];
  scene.traverse((child) => {
    if (child.isSkinnedMesh || child.isBone) {
      hasSkinned = true;
      return;
    }
    if (!child.isMesh) return;
    if (child.geometry?.morphAttributes && Object.keys(child.geometry.morphAttributes).length) {
      hasMorphs = true;
    }
    meshes.push(child);
  });
  if (hasSkinned || hasMorphs) return;
  if (meshes.length < 2) return;

  const groups = new Map();
  let unflattenable = false;
  for (const mesh of meshes) {
    const material = Array.isArray(mesh.material) ? null : mesh.material;
    if (!material) {
      unflattenable = true;
      break;
    }
    const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        meshes: [],
      };
      groups.set(key, bucket);
    }
    bucket.meshes.push(mesh);
  }
  if (unflattenable) return;

  const rootUserData = scene.userData;
  const rootName = scene.name;
  const flatGroup = new THREE.Group();
  flatGroup.name = rootName;
  flatGroup.userData = rootUserData;
  const allowedAttrs = new Set(['position', 'normal', 'uv']);

  let flattenedAny = false;
  scene.updateMatrixWorld(true);

  for (const bucket of groups.values()) {
    const baked = [];
    for (const mesh of bucket.meshes) {
      const source = mesh.geometry;
      if (!source?.attributes?.position) continue;
      const clone = source.clone();
      if (clone.groups?.length) clone.clearGroups();
      for (const name of Object.keys(clone.attributes)) {
        if (!allowedAttrs.has(name)) clone.deleteAttribute(name);
      }
      clone.applyMatrix4(mesh.matrixWorld);
      baked.push(clone);
    }

    if (!baked.length) continue;

    let outGeometry;
    const outMaterial = bucket.material;
    if (baked.length === 1) {
      outGeometry = baked[0];
    } else {
      const merged = mergeGeometries(baked, false);
      baked.forEach((g) => g.dispose());
      if (!merged) continue;
      outGeometry = merged;
    }
    const outMesh = new THREE.Mesh(outGeometry, outMaterial);
    outMesh.castShadow = bucket.castShadow;
    outMesh.receiveShadow = bucket.receiveShadow;
    flatGroup.add(outMesh);
    flattenedAny = true;
  }

  if (!flattenedAny) return;
  while (scene.children.length) scene.remove(scene.children[0]);
  while (flatGroup.children.length) scene.add(flatGroup.children[0]);
  scene.updateMatrixWorld(true);
}

export async function loadGlbModelByAssetId(room, assetId) {
  if (room.glbModelCache.has(assetId)) return room.glbModelCache.get(assetId);
  const registry = await loadGlbRegistry(room);
  const entry = registry.assets?.find((a) => a.id === assetId);
  if (!entry) return null;
  await initGlbLoader(room);
  const url = assetUrl(entry.publicPath);
  try {
    const gltf = await room.glbLoader.loadAsync(url);
    const scene = gltf.scene;
    applyGlbChromaKey(scene, entry);
    scene.updateMatrixWorld(true);
    flattenGlbScene(scene);
    if (!validateGeneratedBakeScene(room, assetId, scene)) {
      room.invalidGeneratedBakeAssetIds.add(assetId);
      return null;
    }
    scene.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      child.geometry.userData.isSharedGlbGeometry = true;
      ensureMeshGeometryBvh(child.geometry);
    });
    room.glbModelCache.set(assetId, scene);
    return scene;
  } catch (err) {
    console.warn(`Failed to load GLB asset ${assetId}:`, err);
    return null;
  }
}

export function isGeneratedBakePrimitiveEnabled(room, primitive) {
  if (!primitive?.generatedBakeKind || primitive?.deleted) return false;
  if (!room.useGeneratedBakes) return false;
  if (room.invalidGeneratedBakeAssetIds.has(primitive.glbAssetId)) return false;
  if (primitive.generatedBakeKind === 'house') return room.useHouseGeneratedBake;
  return true;
}

function getLoadableGlbPrimitives(room) {
  return room.loadedEditableLayout.primitives.filter((p) => (
    p.type === 'glb'
    && p.glbAssetId
    && (!p.generatedBakeKind || isGeneratedBakePrimitiveEnabled(room, p))
  ));
}

export async function loadGlbModels(room) {
  const glbPrimitives = getLoadableGlbPrimitives(room);
  if (!glbPrimitives.length) return;
  const assetIds = [...new Set(glbPrimitives.map((p) => p.glbAssetId))];
  await Promise.all(assetIds.map((id) => loadGlbModelByAssetId(room, id)));
}

export function streamGlbModels(room) {
  const glbPrimitives = getLoadableGlbPrimitives(room);
  if (!glbPrimitives.length) return;
  const assetIds = [...new Set(glbPrimitives.map((p) => p.glbAssetId))];
  Promise.all(assetIds.map(async (id) => {
    await loadGlbModelByAssetId(room, id);
    room._applyLoadedEditableLayout();
    room._rebuildEditableLayout();
  }));
}
