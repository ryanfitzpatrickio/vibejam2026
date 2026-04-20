#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { Blob } from 'node:buffer';

const noop = () => {};
const stubElement = () => ({
  style: {},
  addEventListener: noop,
  removeEventListener: noop,
  setAttribute: noop,
  getAttribute: () => null,
  getContext: () => null,
});

globalThis.window = {
  URL: {
    createObjectURL: () => 'blob:vegetation-tree',
  },
};
globalThis.Blob = Blob;
globalThis.self = globalThis;
globalThis.document = { createElementNS: stubElement, createElement: stubElement };
globalThis.Image = class Image {
  addEventListener(event, cb) { if (event === 'load') setTimeout(cb, 0); }
  set src(_value) {}
};
globalThis.ImageBitmap = class {};
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

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  buildTreeTrunkMesh,
} from '../src/world/VegetationTreeBuilder.js';

const VEGETATION_LIBRARY_PATH = path.resolve('public/levels/vegetation-library.json');
const GLB_REGISTRY_PATH = path.resolve('public/levels/glb-registry.json');
const SOURCE_DIR = path.resolve('assets/source/custom');

function sanitizeSlug(value, fallback) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function makeGeneratedAssetEntry(species) {
  const safeId = sanitizeSlug(species.id, 'tree');
  const safeName = sanitizeSlug(species.name, safeId);
  const filename = `veg-tree-${safeName}-${safeId}.glb`;
  return {
    id: `asset-veg-tree-${safeId}`,
    name: `veg-tree-${safeName}`,
    filename,
    sourcePath: `assets/source/custom/${filename}`,
    publicPath: `models/${filename}`,
    generatedFromVegetationSpeciesId: species.id,
    size: 0,
    uploadedAt: new Date().toISOString(),
  };
}

async function exportGroupToGlb(root) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(root, resolve, reject, {
      binary: true,
      onlyVisible: true,
      trs: false,
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

async function main() {
  if (!fsSync.existsSync(VEGETATION_LIBRARY_PATH)) {
    console.log('No vegetation library found, skipping tree bake.');
    return;
  }

  const rawLibrary = await readJson(VEGETATION_LIBRARY_PATH, { version: 1, species: [] });
  const library = {
    version: Math.max(1, Math.trunc(Number(rawLibrary?.version ?? 1)) || 1),
    species: Array.isArray(rawLibrary?.species) ? rawLibrary.species.map((entry) => ({ ...entry })) : [],
  };
  const registry = await readJson(GLB_REGISTRY_PATH, { assets: [] });
  const nextAssets = Array.isArray(registry.assets) ? [...registry.assets] : [];
  const generatedIds = new Set();

  await fs.mkdir(SOURCE_DIR, { recursive: true });

  let wroteAny = false;
  for (const species of library.species) {
    if (species?.kind !== 'tree' || !species?.treeBuilder) continue;

    const assetEntry = makeGeneratedAssetEntry(species);
    generatedIds.add(assetEntry.id);

    const mesh = buildTreeTrunkMesh(species.treeBuilder);
    mesh.castShadow = species.shadow !== 'none';
    mesh.receiveShadow = true;
    const root = new THREE.Group();
    root.name = `${species.name || species.id}-baked-tree`;
    root.add(mesh);

    const glb = Buffer.from(await exportGroupToGlb(root));
    const outputPath = path.resolve(assetEntry.sourcePath);
    const existing = await fs.readFile(outputPath).catch(() => null);
    if (!existing || !existing.equals(glb)) {
      await fs.writeFile(outputPath, glb);
      wroteAny = true;
      console.log(`Baked tree GLB: ${assetEntry.filename}`);
    }

    const stat = await fs.stat(outputPath);
    assetEntry.size = stat.size;

    const existingAssetIndex = nextAssets.findIndex((entry) =>
      entry?.id === assetEntry.id
      || entry?.generatedFromVegetationSpeciesId === species.id
      || entry?.sourcePath === assetEntry.sourcePath,
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

    species.renderMode = 'glb';
    species.assetId = assetEntry.id;
  }

  const filteredAssets = nextAssets.filter((entry) => {
    if (!entry?.generatedFromVegetationSpeciesId) return true;
    return generatedIds.has(entry.id);
  });

  const libraryText = `${JSON.stringify({
    version: library.version ?? 1,
    species: library.species,
  }, null, 2)}\n`;
  const registryText = `${JSON.stringify({ assets: filteredAssets }, null, 2)}\n`;

  const prevLibraryText = await fs.readFile(VEGETATION_LIBRARY_PATH, 'utf8').catch(() => '');
  if (prevLibraryText !== libraryText) {
    await fs.writeFile(VEGETATION_LIBRARY_PATH, libraryText);
    wroteAny = true;
    console.log('Updated vegetation library tree asset bindings.');
  }

  const prevRegistryText = await fs.readFile(GLB_REGISTRY_PATH, 'utf8').catch(() => '');
  if (prevRegistryText !== registryText) {
    await fs.writeFile(GLB_REGISTRY_PATH, registryText);
    wroteAny = true;
    console.log('Updated GLB registry with generated tree assets.');
  }

  if (!wroteAny) {
    console.log('Vegetation tree bake up to date.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
