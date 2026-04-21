#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Blob } from 'node:buffer';
import sharp from 'sharp';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

class ImageDataShim {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class Canvas2DShim {
  constructor(canvas) {
    this.canvas = canvas;
  }

  translate() {}

  scale() {}

  putImageData(imageData) {
    this.canvas.width = imageData.width;
    this.canvas.height = imageData.height;
    this.canvas._raw = Buffer.from(imageData.data);
  }

  drawImage() {
    throw new Error('CanvasShim.drawImage() is not implemented for bake-house-glb.');
  }
}

class CanvasShim {
  constructor() {
    this.width = 1;
    this.height = 1;
    this._raw = Buffer.alloc(4);
  }

  getContext(type) {
    if (type !== '2d') return null;
    return new Canvas2DShim(this);
  }

  toBlob(callback, mimeType = 'image/png') {
    sharp(this._raw, {
      raw: {
        width: Math.max(1, this.width),
        height: Math.max(1, this.height),
        channels: 4,
      },
    })
      .png()
      .toBuffer()
      .then((buffer) => callback(new Blob([buffer], { type: mimeType })))
      .catch((error) => {
        throw error;
      });
  }
}

const noop = () => {};
const makeStubElement = (tagName) => {
  if (tagName === 'canvas') return new CanvasShim();
  return {
    style: {},
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    getAttribute: () => null,
    getContext: () => null,
  };
};

globalThis.window = { URL: { createObjectURL: () => 'blob:house-bake' } };
globalThis.Blob = Blob;
globalThis.self = globalThis;
globalThis.Image = class Image {
  addEventListener(event, cb) { if (event === 'load') setTimeout(cb, 0); }
  set src(_value) {}
};
globalThis.ImageBitmap = class {};
globalThis.ImageData = ImageDataShim;
globalThis.document = {
  createElementNS: (_ns, tagName) => makeStubElement(tagName),
  createElement: (tagName) => makeStubElement(tagName),
};
globalThis.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      if (this.onloadend) this.onloadend({ target: this });
      if (this.onload) this.onload({ target: this });
    }).catch((err) => {
      if (this.onerror) this.onerror(err);
    });
  }
};

const ATLAS_GRID = 10;
const ATLAS_CELL_MARGIN_PX = 3;
const DEFAULT_TEXTURE_ATLAS = 'textures';
const FACE_TEXTURE_SLOTS = Object.freeze({
  box: Object.freeze(['right', 'left', 'top', 'bottom', 'front', 'back']),
  cylinder: Object.freeze(['side', 'top', 'bottom']),
  wedge: Object.freeze(['back', 'bottom', 'left', 'right', 'slope']),
  plane: Object.freeze([]),
  prop: Object.freeze([]),
});
const AVAILABLE_ATLAS_IDS = new Set([
  'textures',
  'textures2',
  'textures3',
  'textures4',
  'textures5',
  'props',
  'props2',
]);
const LAYOUT_PATH = path.resolve('public/levels/kitchen-layout.json');
const GLB_REGISTRY_PATH = path.resolve('public/levels/glb-registry.json');
const SOURCE_DIR = path.resolve('assets/source/custom');
const HOUSE_LAYOUT_ID = 'kitchen-layout';
const HOUSE_ASSET_ID = 'asset-house-kitchen-layout';
const HOUSE_GLTF_PRIMITIVE_ID = 'primitive-house-kitchen-layout-glb';
const HOUSE_GLTF_FILENAME = 'house-kitchen-layout.glb';
const HOUSE_BAKE_KIND = 'house';
const HOUSE_BAKE_REPEAT_EPSILON = 1e-6;

function createPrimitiveGeometry(type) {
  if (type === 'wedge') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
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
    ]), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, 1, 1, 1, 1, 0,
      0, 1, 1, 1, 1, 0, 0, 0,
      0, 0, 1, 0, 0, 1,
      0, 0, 0, 1, 1, 0,
      0, 1, 0, 0, 1, 0, 1, 1,
    ]), 2));
    geometry.setIndex([
      0, 1, 2,
      0, 2, 3,
      4, 5, 6,
      4, 6, 7,
      8, 9, 10,
      11, 12, 13,
      14, 15, 16,
      14, 16, 17,
    ]);
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
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1);
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

function cloneVectorLike(source, fallback) {
  return {
    x: source?.x ?? fallback.x,
    y: source?.y ?? fallback.y,
    z: source?.z ?? fallback.z,
  };
}

function normalizeTextureSettings(texture = {}) {
  if (typeof texture === 'number') {
    return { x: texture, y: texture, rotation: 0, offset: { x: 0, y: 0 } };
  }
  return {
    x: texture?.x ?? 1,
    y: texture?.y ?? texture?.x ?? 1,
    rotation: texture?.rotation ?? 0,
    offset: {
      x: texture?.offset?.x ?? 0,
      y: texture?.offset?.y ?? 0,
    },
  };
}

function normalizeTextureRef(value, fallbackCell = 0) {
  if (typeof value === 'number') {
    return {
      atlas: DEFAULT_TEXTURE_ATLAS,
      cell: value,
    };
  }
  if (value && typeof value === 'object') {
    return {
      atlas: normalizeTextureAtlasId(value.atlas),
      cell: Number.isFinite(value.cell) ? value.cell : fallbackCell,
    };
  }
  return {
    atlas: DEFAULT_TEXTURE_ATLAS,
    cell: fallbackCell,
  };
}

function normalizeTextureAtlasId(value) {
  const id = typeof value === 'string' ? value.toLowerCase() : '';
  return AVAILABLE_ATLAS_IDS.has(id) ? id : DEFAULT_TEXTURE_ATLAS;
}

function normalizeFaceTextures(type, value = {}) {
  const slots = FACE_TEXTURE_SLOTS[type] ?? [];
  const result = {};
  slots.forEach((slot) => {
    const ref = value?.[slot];
    if (ref == null) return;
    if (ref === null) {
      result[slot] = null;
      return;
    }
    result[slot] = normalizeTextureRef(ref);
  });
  return result;
}

function normalizePrimitive(entry = {}) {
  const type = entry.type === 'plane' || entry.type === 'cylinder' || entry.type === 'wedge' || entry.type === 'glb' || entry.type === 'prop'
    ? entry.type
    : 'box';
  const texture = typeof entry.texture === 'number' ? { cell: entry.texture } : (entry.texture ?? {});
  const atlas = normalizeTextureAtlasId(texture.atlas);
  return {
    ...entry,
    id: entry.id ?? `primitive-${Date.now().toString(36)}`,
    name: entry.name ?? type,
    type,
    position: cloneVectorLike(entry.position, { x: 0, y: 0.5, z: 0 }),
    rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
    scale: cloneVectorLike(entry.scale, { x: 1, y: 1, z: 1 }),
    texture: {
      atlas,
      cell: Number.isFinite(texture.cell) ? texture.cell : 0,
      repeat: {
        x: texture.repeat?.x ?? 1,
        y: texture.repeat?.y ?? 1,
      },
      rotation: texture.rotation ?? 0,
      offset: {
        x: texture.offset?.x ?? 0,
        y: texture.offset?.y ?? 0,
      },
    },
    faceTextures: normalizeFaceTextures(type, entry.faceTextures),
    material: {
      color: entry.material?.color ?? '#ffffff',
      roughness: entry.material?.roughness ?? 0.88,
      metalness: entry.material?.metalness ?? 0.04,
    },
    prefabInstanceId: entry.prefabInstanceId ?? null,
    prefabInstanceOrigin: entry.prefabInstanceOrigin ? cloneVectorLike(entry.prefabInstanceOrigin, { x: 0, y: 0, z: 0 }) : null,
    prefabInstanceRotation: entry.prefabInstanceRotation ? cloneVectorLike(entry.prefabInstanceRotation, { x: 0, y: 0, z: 0 }) : null,
    prefabInstanceScale: entry.prefabInstanceScale ? cloneVectorLike(entry.prefabInstanceScale, { x: 1, y: 1, z: 1 }) : null,
    castShadow: entry.castShadow !== false,
    receiveShadow: entry.receiveShadow !== false,
    collider: entry.collider !== false,
    deleted: entry.deleted === true,
    spawnType: entry.spawnType ?? null,
    zIndex: type === 'plane' && Number.isFinite(entry.zIndex) ? Math.trunc(entry.zIndex) : 0,
    bakedAssetId: entry.bakedAssetId ?? null,
  };
}

function isEligibleHousePrimitive(primitive) {
  return (
    !primitive.deleted
    && !primitive.spawnType
    && primitive.type !== 'prop'
    && primitive.type !== 'glb'
    && primitive.type !== 'light'
    && primitive.type !== 'portal'
    && primitive.type !== 'rope'
  );
}

function isIdentityRepeat(value) {
  return Math.abs((value ?? 1) - 1) < HOUSE_BAKE_REPEAT_EPSILON;
}

function isSafeBakedHousePrimitive(primitive) {
  const repeatX = primitive.texture?.repeat?.x ?? 1;
  const repeatY = primitive.texture?.repeat?.y ?? 1;
  const rotation = primitive.texture?.rotation ?? 0;
  const zIndex = primitive.type === 'plane' ? (primitive.zIndex ?? 0) : 0;
  return (
    isIdentityRepeat(repeatX)
    && isIdentityRepeat(repeatY)
    && Math.abs(rotation) < HOUSE_BAKE_REPEAT_EPSILON
    && zIndex === 0
  );
}

function getFaceTextureRef(primitive, slot) {
  if (Object.prototype.hasOwnProperty.call(primitive.faceTextures ?? {}, slot)) {
    const value = primitive.faceTextures[slot];
    if (value == null) return value;
    return normalizeTextureRef(value);
  }
  return primitive.texture;
}

function getCellBounds(index, size) {
  const start = Math.round((index / ATLAS_GRID) * size);
  const end = Math.round(((index + 1) / ATLAS_GRID) * size);
  return {
    start,
    end,
    size: Math.max(1, end - start),
  };
}

function wrap01(value) {
  return THREE.MathUtils.euclideanModulo(value, 1);
}

function bakeUvRepeatRotation(geometry, settings) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  const rx = settings?.x ?? 1;
  const ry = settings?.y ?? rx;
  const rot = settings?.rotation ?? 0;
  const offsetX = settings?.offset?.x ?? 0;
  const offsetY = settings?.offset?.y ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const array = uv.array;
  for (let i = 0; i < array.length; i += 2) {
    const u = array[i] - 0.5;
    const v = array[i + 1] - 0.5;
    array[i] = (cos * u - sin * v) * rx + 0.5 + offsetX;
    array[i + 1] = (sin * u + cos * v) * ry + 0.5 + offsetY;
  }
  uv.needsUpdate = true;
}

function bakeUvToAtlasCell(geometry, atlasImage, cellIndex) {
  if (!atlasImage || !Number.isFinite(cellIndex)) return;
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  const col = cellIndex % ATLAS_GRID;
  const row = Math.floor(cellIndex / ATLAS_GRID);
  const xBounds = getCellBounds(col, atlasImage.width);
  const yBounds = getCellBounds(row, atlasImage.height);
  const cropMarginX = Math.min(ATLAS_CELL_MARGIN_PX, Math.floor((xBounds.size - 1) * 0.25));
  const cropMarginY = Math.min(ATLAS_CELL_MARGIN_PX, Math.floor((yBounds.size - 1) * 0.25));
  const minU = (xBounds.start + cropMarginX) / atlasImage.width;
  const maxU = (xBounds.end - cropMarginX) / atlasImage.width;
  const minV = (yBounds.start + cropMarginY) / atlasImage.height;
  const maxV = (yBounds.end - cropMarginY) / atlasImage.height;
  const spanU = Math.max(1e-6, maxU - minU);
  const spanV = Math.max(1e-6, maxV - minV);
  const array = uv.array;
  for (let i = 0; i < array.length; i += 2) {
    array[i] = minU + wrap01(array[i]) * spanU;
    array[i + 1] = minV + wrap01(array[i + 1]) * spanV;
  }
  uv.needsUpdate = true;
}

function makePrimitiveWorldMatrix(primitive) {
  const localPosition = new THREE.Vector3(
    primitive.position.x,
    primitive.position.y,
    primitive.position.z,
  );
  const localRotation = new THREE.Euler(
    primitive.rotation.x,
    primitive.rotation.y,
    primitive.rotation.z,
  );
  const localScale = new THREE.Vector3(
    primitive.scale.x,
    primitive.scale.y,
    primitive.scale.z,
  );
  const localMatrix = new THREE.Matrix4().compose(
    localPosition,
    new THREE.Quaternion().setFromEuler(localRotation),
    localScale,
  );
  if (!primitive.prefabInstanceId) return localMatrix;

  const origin = primitive.prefabInstanceOrigin ?? { x: 0, y: 0, z: 0 };
  const rotation = primitive.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
  const scale = primitive.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
  const instanceMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z)),
    new THREE.Vector3(scale.x, scale.y, scale.z),
  );
  return instanceMatrix.multiply(localMatrix);
}

function createGroupSubGeometry(sourceGeometry, group) {
  const geometry = sourceGeometry.clone();
  if (group && geometry.index) {
    const indices = Array.from(geometry.index.array.slice(group.start, group.start + group.count));
    geometry.setIndex(indices);
  }
  geometry.clearGroups();
  return geometry;
}

function getAtlasFilePath(atlasId) {
  return path.resolve('public', `${normalizeTextureAtlasId(atlasId)}.optimized.webp`);
}

function makeHouseAssetEntry() {
  return {
    id: HOUSE_ASSET_ID,
    name: 'house-kitchen-layout',
    filename: HOUSE_GLTF_FILENAME,
    sourcePath: `assets/source/custom/${HOUSE_GLTF_FILENAME}`,
    publicPath: `models/${HOUSE_GLTF_FILENAME}`,
    generatedFromLayoutId: HOUSE_LAYOUT_ID,
    size: 0,
    uploadedAt: new Date().toISOString(),
  };
}

function makeHouseGlbPrimitive(assetId) {
  return {
    id: HOUSE_GLTF_PRIMITIVE_ID,
    name: 'house-baked',
    type: 'glb',
    glbAssetId: assetId,
    generatedBakeKind: HOUSE_BAKE_KIND,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    collider: true,
    colliderClearance: 0,
    castShadow: true,
    receiveShadow: true,
    deleted: false,
  };
}

function stripGeneratedBakeFields(entry) {
  const {
    bakedAssetId,
    hiddenByGeneratedBake,
    generatedBakeKind,
    ...rest
  } = entry ?? {};
  return rest;
}

async function exportSceneToGlb(root) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(root, resolve, reject, {
      binary: true,
      onlyVisible: true,
      trs: false,
      maxTextureSize: 4096,
    });
  });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function loadAtlasTexture(atlasId, cache) {
  const normalizedId = normalizeTextureAtlasId(atlasId);
  const existing = cache.get(normalizedId);
  if (existing) return existing;

  const filePath = getAtlasFilePath(normalizedId);
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const texture = new THREE.DataTexture(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;

  const atlasImage = { width: info.width, height: info.height };
  const record = { texture, atlasImage };
  cache.set(normalizedId, record);
  return record;
}

async function buildHouseScene(primitives) {
  const root = new THREE.Group();
  root.name = 'KitchenHouseBaked';
  const atlasCache = new Map();
  const mergedBuckets = new Map();

  for (const primitive of primitives) {
    const baseGeometry = createPrimitiveGeometry(primitive.type);
    const groupSpecs = [];
    const faceSlots = FACE_TEXTURE_SLOTS[primitive.type] ?? [];
    if (faceSlots.length > 0 && Array.isArray(baseGeometry.groups) && baseGeometry.groups.length) {
      for (let i = 0; i < Math.min(faceSlots.length, baseGeometry.groups.length); i += 1) {
        groupSpecs.push({
          geometryGroup: baseGeometry.groups[i],
          slot: faceSlots[i],
        });
      }
    } else {
      groupSpecs.push({ geometryGroup: null, slot: null });
    }

    const worldMatrix = makePrimitiveWorldMatrix(primitive);
    for (const spec of groupSpecs) {
      const geometry = createGroupSubGeometry(baseGeometry, spec.geometryGroup);
      bakeUvRepeatRotation(geometry, normalizeTextureSettings({
        x: primitive.texture?.repeat?.x ?? 1,
        y: primitive.texture?.repeat?.y ?? 1,
        rotation: primitive.texture?.rotation ?? 0,
      }));

      const textureRef = spec.slot ? getFaceTextureRef(primitive, spec.slot) : primitive.texture;
      let atlasId = null;
      let atlasRecord = null;
      if (textureRef?.cell != null) {
        atlasId = normalizeTextureAtlasId(textureRef.atlas);
        atlasRecord = await loadAtlasTexture(atlasId, atlasCache);
        bakeUvToAtlasCell(geometry, atlasRecord.atlasImage, textureRef.cell);
      }

      geometry.applyMatrix4(worldMatrix);
      const color = new THREE.Color(primitive.material?.color ?? '#ffffff').getHexString();
      const roughness = Number(primitive.material?.roughness ?? 0.88).toFixed(4);
      const metalness = Number(primitive.material?.metalness ?? 0.04).toFixed(4);
      const side = primitive.type === 'plane' ? 'double' : 'front';
      const bucketKey = [
        atlasId ?? 'none',
        color,
        roughness,
        metalness,
        side,
        primitive.castShadow ? 1 : 0,
        primitive.receiveShadow ? 1 : 0,
      ].join('|');

      let bucket = mergedBuckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          atlasId,
          atlasRecord,
          color: `#${color}`,
          roughness: Number(roughness),
          metalness: Number(metalness),
          side,
          castShadow: primitive.castShadow !== false,
          receiveShadow: primitive.receiveShadow !== false,
          geometries: [],
        };
        mergedBuckets.set(bucketKey, bucket);
      }
      bucket.geometries.push(geometry);
    }

    baseGeometry.dispose();
  }

  for (const bucket of mergedBuckets.values()) {
    const geometry = bucket.geometries.length === 1
      ? bucket.geometries[0]
      : mergeGeometries(bucket.geometries, false);
    if (!geometry) {
      bucket.geometries.forEach((entry) => entry.dispose());
      continue;
    }
    if (geometry !== bucket.geometries[0]) {
      bucket.geometries.forEach((entry) => entry.dispose());
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(bucket.color),
      roughness: bucket.roughness,
      metalness: bucket.metalness,
      map: bucket.atlasRecord?.texture ?? null,
      side: bucket.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (material.map) material.map.needsUpdate = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    root.add(mesh);
  }

  return root;
}

function getEligibleHousePrimitives(layout) {
  return (layout.primitives ?? [])
    .map((entry) => normalizePrimitive(entry))
    .filter((primitive) => isEligibleHousePrimitive(primitive));
}

async function main() {
  const layout = await readJson(LAYOUT_PATH, { version: 1, primitives: [] });
  const registry = await readJson(GLB_REGISTRY_PATH, { assets: [] });
  const housePrimitives = getEligibleHousePrimitives(layout);
  const bakedHousePrimitives = housePrimitives.filter((primitive) => isSafeBakedHousePrimitive(primitive));

  if (!bakedHousePrimitives.length) {
    console.log('No eligible house primitives found, skipping house bake.');
    return;
  }
  console.log(`House bake subset: ${bakedHousePrimitives.length}/${housePrimitives.length} primitives`);

  await fs.mkdir(SOURCE_DIR, { recursive: true });

  const scene = await buildHouseScene(bakedHousePrimitives);
  const glb = Buffer.from(await exportSceneToGlb(scene));
  const assetEntry = makeHouseAssetEntry();
  const outputPath = path.resolve(assetEntry.sourcePath);
  const previousGlb = await fs.readFile(outputPath).catch(() => null);
  let wroteAny = false;

  if (!previousGlb || !previousGlb.equals(glb)) {
    await fs.writeFile(outputPath, glb);
    wroteAny = true;
    console.log(`Baked house GLB: ${assetEntry.filename}`);
  }

  const stat = await fs.stat(outputPath);
  assetEntry.size = stat.size;

  const nextAssets = Array.isArray(registry.assets) ? [...registry.assets] : [];
  const existingAssetIndex = nextAssets.findIndex((entry) =>
    entry?.id === assetEntry.id
    || entry?.generatedFromLayoutId === HOUSE_LAYOUT_ID,
  );
  if (existingAssetIndex >= 0) {
    nextAssets[existingAssetIndex] = {
      ...nextAssets[existingAssetIndex],
      ...assetEntry,
      uploadedAt: nextAssets[existingAssetIndex]?.uploadedAt ?? assetEntry.uploadedAt,
    };
  } else {
    nextAssets.push(assetEntry);
  }

  const houseGlbPrimitive = makeHouseGlbPrimitive(assetEntry.id);
  const bakedPrimitiveIds = new Set(bakedHousePrimitives.map((primitive) => primitive.id));
  const nextPrimitives = [];
  let hasHouseGlbPrimitive = false;

  for (const entry of layout.primitives ?? []) {
    const primitive = normalizePrimitive(entry);
    const isSourceHousePrimitive = isEligibleHousePrimitive(primitive);
    const shouldHideBehindBake = isSourceHousePrimitive && bakedPrimitiveIds.has(primitive.id);

    if (primitive.id === HOUSE_GLTF_PRIMITIVE_ID
      || (primitive.type === 'glb'
        && primitive.generatedBakeKind === HOUSE_BAKE_KIND
        && primitive.glbAssetId === assetEntry.id)) {
      nextPrimitives.push({
        ...entry,
        ...houseGlbPrimitive,
      });
      hasHouseGlbPrimitive = true;
      continue;
    }

    if (shouldHideBehindBake) {
      nextPrimitives.push({
        ...stripGeneratedBakeFields(entry),
        bakedAssetId: assetEntry.id,
      });
      continue;
    }

    if (entry?.bakedAssetId === assetEntry.id) {
      nextPrimitives.push(stripGeneratedBakeFields(entry));
      continue;
    }

    nextPrimitives.push(stripGeneratedBakeFields(entry));
  }

  if (!hasHouseGlbPrimitive) {
    nextPrimitives.push(houseGlbPrimitive);
  }

  const layoutText = `${JSON.stringify({
    ...layout,
    primitives: nextPrimitives,
  }, null, 2)}\n`;
  const registryText = `${JSON.stringify({ assets: nextAssets }, null, 2)}\n`;

  const previousLayoutText = await fs.readFile(LAYOUT_PATH, 'utf8').catch(() => '');
  if (previousLayoutText !== layoutText) {
    await fs.writeFile(LAYOUT_PATH, layoutText);
    wroteAny = true;
    console.log('Updated layout with baked house GLB bindings.');
  }

  const previousRegistryText = await fs.readFile(GLB_REGISTRY_PATH, 'utf8').catch(() => '');
  if (previousRegistryText !== registryText) {
    await fs.writeFile(GLB_REGISTRY_PATH, registryText);
    wroteAny = true;
    console.log('Updated GLB registry with baked house asset.');
  }

  if (!wroteAny) {
    console.log('House bake up to date.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
