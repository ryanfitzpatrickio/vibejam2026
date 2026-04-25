import * as THREE from 'three';
import { FACE_TEXTURE_SLOTS } from '../dev/prefabRegistry.js';
import {
  DEFAULT_TEXTURE_ATLAS,
  PROP_TEXTURE_ATLAS,
  isPropTextureAtlas,
  normalizeTextureAtlasId,
} from '../dev/textureAtlasRegistry.js';
import { normalizeTextureSettings } from './editableLayoutNormalize.js';
import { createPrimitiveGeometry } from './primitiveGeometry.js';
import { flattenGlbScene } from './glbModelSystem.js';

const ATLAS_GRID = 10;
const ATLAS_CELL_MARGIN_PX = 3;

function getCellBounds(index, size) {
  const start = Math.round((index / ATLAS_GRID) * size);
  const end = Math.round(((index + 1) / ATLAS_GRID) * size);
  return {
    start,
    end,
    size: Math.max(1, end - start),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

export function getFaceTextureRef(definition, slot) {
  if (Object.prototype.hasOwnProperty.call(definition.faceTextures ?? {}, slot)) {
    const value = definition.faceTextures[slot];
    if (value == null) return value;
    if (typeof value === 'number') {
      return {
        atlas: DEFAULT_TEXTURE_ATLAS,
        cell: value,
      };
    }
    return {
      atlas: normalizeTextureAtlasId(value.atlas),
      cell: Number.isFinite(value.cell) ? value.cell : null,
    };
  }

  return definition.texture;
}

function getFaceTextureCell(definition, slot) {
  const ref = getFaceTextureRef(definition, slot);
  return ref?.cell ?? null;
}

function getFaceTextureAtlas(definition, slot) {
  const ref = getFaceTextureRef(definition, slot);
  return ref?.atlas ?? DEFAULT_TEXTURE_ATLAS;
}

export function createSurfaceMaterial(room, baseColor, {
  textureCell = null,
  textureAtlas = DEFAULT_TEXTURE_ATLAS,
  roughness = 0.92,
  metalness = 0.04,
  side = THREE.FrontSide,
  alphaTest = 0,
  transparent = false,
  depthWrite = true,
  planeZIndex = null,
} = {}) {
  const zKey = planeZIndex != null && Number.isFinite(planeZIndex)
    ? `|pz=${Math.trunc(planeZIndex)}`
    : '';
  const cacheKey = `${baseColor}|${textureCell}|${textureAtlas}|${roughness}|${metalness}|${side}|${alphaTest}|${transparent ? 1 : 0}|${depthWrite ? 1 : 0}${zKey}`;

  if (!room._materialCache) room._materialCache = new Map();
  const cached = room._materialCache.get(cacheKey);
  if (cached) return cached;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(baseColor),
    roughness,
    metalness,
    side,
    alphaTest,
    transparent,
    depthWrite,
  });

  material.dithering = true;
  material.userData.textureAtlas = textureAtlas;
  material.userData.textureCell = textureCell;
  if (planeZIndex != null && Number.isFinite(planeZIndex)) {
    const zi = Math.trunc(planeZIndex);
    material.userData.planeZIndex = zi;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -(1 + zi);
  }
  room.surfaceMaterials.add(material);
  room._materialCache.set(cacheKey, material);
  return material;
}

export function disposeEditableMaterial(room, material) {
  if (!material || room.surfaceMaterials.has(material)) return;
  material.customDepthMaterial?.dispose?.();
  material.customDistanceMaterial?.dispose?.();
  material.dispose?.();
}

export function disposeEditableMaterialSet(room, material) {
  if (Array.isArray(material)) {
    material.forEach((entry) => disposeEditableMaterial(room, entry));
    return;
  }
  disposeEditableMaterial(room, material);
}

export async function loadTextureAtlas(room) {
  const entries = Object.entries(room.textureAtlasUrls);
  const results = await Promise.all(entries.map(async ([atlas, url]) => {
    try {
      return [atlas, await loadImage(url)];
    } catch (error) {
      if (atlas === DEFAULT_TEXTURE_ATLAS) throw error;
      return null;
    }
  }));
  room.textureAtlasImages = new Map(results.filter(Boolean));
  room.textureAtlasImage = room.textureAtlasImages.get(DEFAULT_TEXTURE_ATLAS) ?? null;
  return room.textureAtlasImage;
}

export function createAtlasTexture(room, cellIndex, atlas = DEFAULT_TEXTURE_ATLAS, chroma = null) {
  const atlasId = atlas ?? DEFAULT_TEXTURE_ATLAS;
  const image = room.textureAtlasImages.get(atlasId) ?? room.textureAtlasImage;
  if (!image) return null;

  const similarity = THREE.MathUtils.clamp(Number(chroma?.similarity ?? 0.32), 0, 1);
  const feather = THREE.MathUtils.clamp(Number(chroma?.feather ?? 0.08), 0, 1);
  const chromaKey = isPropTextureAtlas(atlasId)
    ? `|ck=${similarity.toFixed(3)}:${feather.toFixed(3)}`
    : '';
  const cacheKey = `${atlasId}:${cellIndex}${chromaKey}`;
  const cached = room.textureCache.get(cacheKey);
  if (cached) return cached;

  const col = cellIndex % ATLAS_GRID;
  const row = Math.floor(cellIndex / ATLAS_GRID);
  const xBounds = getCellBounds(col, image.width);
  const yBounds = getCellBounds(row, image.height);
  const cropMarginX = Math.min(ATLAS_CELL_MARGIN_PX, Math.floor((xBounds.size - 1) * 0.25));
  const cropMarginY = Math.min(ATLAS_CELL_MARGIN_PX, Math.floor((yBounds.size - 1) * 0.25));
  const sourceX = xBounds.start + cropMarginX;
  const sourceY = yBounds.start + cropMarginY;
  const sourceWidth = Math.max(1, xBounds.size - cropMarginX * 2);
  const sourceHeight = Math.max(1, yBounds.size - cropMarginY * 2);
  const canvas = document.createElement('canvas');
  canvas.width = xBounds.size;
  canvas.height = yBounds.size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    xBounds.size,
    yBounds.size,
  );

  if (isPropTextureAtlas(atlasId)) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const greenDistance = Math.hypot(r, g - 1, b) / Math.sqrt(3);
      const edge = Math.max(0.0001, feather);
      const alpha = THREE.MathUtils.smoothstep(greenDistance, similarity, similarity + edge);
      data[i + 3] = Math.round(data[i + 3] * alpha);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.center.set(0.5, 0.5);
  texture.needsUpdate = true;
  room.textureCache.set(cacheKey, texture);
  return texture;
}

export function bakeUvTransform(geometry, settings) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return geometry;
  const rx = settings?.x ?? 1;
  const ry = settings?.y ?? rx;
  const rot = settings?.rotation ?? 0;
  const offsetX = settings?.offset?.x ?? 0;
  const offsetY = settings?.offset?.y ?? 0;
  if (rx === 1 && ry === 1 && rot === 0 && offsetX === 0 && offsetY === 0) return geometry;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const array = uv.array;
  for (let i = 0; i < array.length; i += 2) {
    const u = array[i] - 0.5;
    const v = array[i + 1] - 0.5;
    const ru = (cos * u - sin * v) * rx + 0.5 + offsetX;
    const rv = (sin * u + cos * v) * ry + 0.5 + offsetY;
    array[i] = ru;
    array[i + 1] = rv;
  }
  uv.needsUpdate = true;
  return geometry;
}

export function rebakeMeshUvs(mesh, settings) {
  const geometry = mesh?.geometry;
  const uv = geometry?.getAttribute?.('uv');
  if (!uv) return;
  let base = mesh.userData?._baseUvs;
  if (!base) {
    base = new Float32Array(uv.array);
    if (!mesh.userData) mesh.userData = {};
    mesh.userData._baseUvs = base;
  }
  uv.array.set(base);
  bakeUvTransform(geometry, normalizeTextureSettings(settings));
  uv.needsUpdate = true;
}

export function getEditableGeometry(room, primitive) {
  const settings = normalizeTextureSettings({
    x: primitive.texture?.repeat?.x ?? 1,
    y: primitive.texture?.repeat?.y ?? 1,
    rotation: primitive.texture?.rotation ?? 0,
    offset: primitive.texture?.offset,
  });
  const rxKey = Number(settings.x.toFixed(4));
  const ryKey = Number(settings.y.toFixed(4));
  const rotKey = Number(settings.rotation.toFixed(4));
  const offsetXKey = Number((settings.offset?.x ?? 0).toFixed(4));
  const offsetYKey = Number((settings.offset?.y ?? 0).toFixed(4));
  const key = `${primitive.type}|${rxKey}|${ryKey}|${rotKey}|${offsetXKey}|${offsetYKey}`;
  const cached = room._editableGeometryCache.get(key);
  if (cached) return cached;
  const geometry = createPrimitiveGeometry(primitive.type);
  bakeUvTransform(geometry, settings);
  geometry.userData = geometry.userData || {};
  geometry.userData.isCachedEditableGeometry = true;
  room._editableGeometryCache.set(key, geometry);
  return geometry;
}

export function applyTextureAtlas(room) {
  if (!room.textureAtlasImages.size) return;

  room.surfaceMaterials.forEach((material) => {
    const cellIndex = material.userData?.textureCell;
    if (cellIndex == null) {
      material.map = null;
      material.needsUpdate = true;
      return;
    }

    const texture = createAtlasTexture(
      room,
      cellIndex,
      material.userData.textureAtlas ?? DEFAULT_TEXTURE_ATLAS,
    );
    if (!texture) return;
    material.map = texture;
    material.needsUpdate = true;
  });
}

export function shouldUseSharedGlbSurfaceMaterial(primitive) {
  return Number.isFinite(primitive?.texture?.cell);
}

export function applySharedGlbSurfaceMaterial(room, scene, primitive) {
  if (!scene || !shouldUseSharedGlbSurfaceMaterial(primitive)) return false;

  const material = createSurfaceMaterial(room, primitive.material.color, {
    textureCell: primitive.texture.cell,
    textureAtlas: primitive.texture.atlas ?? DEFAULT_TEXTURE_ATLAS,
    roughness: primitive.material.roughness,
    metalness: primitive.material.metalness,
    side: THREE.DoubleSide,
    alphaTest: isPropTextureAtlas(primitive.texture.atlas) ? 0.45 : 0,
  });

  let hasMesh = false;
  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.material = material;
    child.userData.usesSharedSurfaceMaterial = true;
    hasMesh = true;
  });

  if (!hasMesh) return false;

  flattenGlbScene(scene);
  scene.traverse((child) => {
    if (child.isMesh) child.userData.usesSharedSurfaceMaterial = true;
  });
  return true;
}

export function createEditablePrimitiveMaterial(room, definition) {
  if (definition.type === 'prop') {
    const texture = createAtlasTexture(
      room,
      definition.texture.cell ?? 0,
      definition.texture.atlas ?? PROP_TEXTURE_ATLAS,
      definition.chroma,
    );
    return new THREE.SpriteMaterial({
      map: texture ?? null,
      color: new THREE.Color(definition.material.color ?? '#ffffff'),
      transparent: true,
      alphaTest: 0.12,
      depthTest: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
  }

  const materialOptions = {
    roughness: definition.material.roughness,
    metalness: definition.material.metalness,
  };
  const faceSlots = FACE_TEXTURE_SLOTS[definition.type] ?? [];

  if (faceSlots.length > 0) {
    const planeZ = definition.type === 'plane' ? (definition.zIndex ?? 0) : null;
    const materials = faceSlots.map((slot) => createSurfaceMaterial(room, definition.material.color, {
      ...materialOptions,
      textureCell: getFaceTextureCell(definition, slot),
      textureAtlas: getFaceTextureAtlas(definition, slot),
      alphaTest: isPropTextureAtlas(getFaceTextureAtlas(definition, slot)) ? 0.45 : 0,
      ...(planeZ != null ? { planeZIndex: planeZ } : {}),
    }));
    const first = materials[0];
    if (first && materials.every((material) => material === first)) {
      return first;
    }
    return materials;
  }

  const planeZ = definition.type === 'plane' ? (definition.zIndex ?? 0) : null;
  return createSurfaceMaterial(room, definition.material.color, {
    ...materialOptions,
    textureCell: definition.texture.cell,
    textureAtlas: definition.texture.atlas ?? DEFAULT_TEXTURE_ATLAS,
    side: definition.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: isPropTextureAtlas(definition.texture.atlas) ? 0.45 : 0,
    ...(planeZ != null ? { planeZIndex: planeZ } : {}),
  });
}
