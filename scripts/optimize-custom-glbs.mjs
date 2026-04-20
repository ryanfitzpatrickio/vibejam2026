#!/usr/bin/env node
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  quantize,
  resample,
  meshopt,
  textureCompress,
} from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptEncoder } from 'meshoptimizer';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsCb from 'node:fs';
import { isAssetBuildUpToDate, markAssetBuildCurrent } from './build-cache.mjs';

const REGISTRY_PATH = path.resolve('public/levels/glb-registry.json');
const SOURCE_DIR = path.resolve('assets/source/custom');
const PUBLIC_DIR = path.resolve('public/models');

async function main() {
  let registry;
  try {
    const data = await fs.readFile(REGISTRY_PATH, 'utf8');
    registry = JSON.parse(data);
  } catch {
    console.log('No GLB registry found, skipping custom GLB optimization.');
    return;
  }

  const assets = registry.assets ?? [];
  if (!assets.length) {
    console.log('No custom GLB assets to optimize.');
    return;
  }

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  for (const asset of assets) {
    const inputPath = path.resolve(asset.sourcePath);
    const outputPath = path.resolve('public', asset.publicPath);

    const scriptPath = path.join(process.cwd(), 'scripts', 'optimize-custom-glbs.mjs');
    const upToDate = await isAssetBuildUpToDate({
      cacheName: `optimize-glb-${asset.id}`,
      inputs: [inputPath, scriptPath],
      outputs: [outputPath],
    });

    if (upToDate) {
      console.log(`Skipped ${asset.filename} (up to date)`);
      continue;
    }

    let inputExists;
    try {
      await fs.access(inputPath);
      inputExists = true;
    } catch {
      inputExists = false;
    }

    if (!inputExists) {
      console.log(`Source not found: ${asset.sourcePath}, using existing public copy if available.`);
      try {
        await fs.access(outputPath);
        continue;
      } catch {
        console.warn(`  Skipping ${asset.name}: no source or public file.`);
        continue;
      }
    }

    console.log(`Optimizing ${asset.filename}...`);
    const inputSize = (await fs.stat(inputPath)).size;
    console.log(`  Input: ${(inputSize / 1024).toFixed(0)} KB`);

    try {
      const document = await io.read(inputPath);
      const useSafeLayoutProfile = Boolean(asset.generatedFromLayoutId);

      await document.transform(
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: [512, 512],
          quality: 72,
          effort: 6,
          nearLossless: true,
        }),
      );

      await document.transform(dedup());
      await document.transform(prune());
      await document.transform(resample());
      if (useSafeLayoutProfile) {
        console.log('  Using safe layout-bake optimization profile (skipping quantize/meshopt).');
      } else {
        await document.transform(
          quantize({
            quantizePosition: 14,
            quantizeNormal: 10,
            quantizeTexcoord: 12,
          }),
        );
        await document.transform(
          meshopt({
            encoder: MeshoptEncoder,
            level: 'high',
          }),
        );
      }

      await fs.mkdir(PUBLIC_DIR, { recursive: true });
      await io.write(outputPath, document);

      await markAssetBuildCurrent({
        cacheName: `optimize-glb-${asset.id}`,
        inputs: [inputPath, scriptPath],
      });

      const outputSize = (await fs.stat(outputPath)).size;
      console.log(`  Output: ${(outputSize / 1024).toFixed(0)} KB (${((1 - outputSize / inputSize) * 100).toFixed(1)}% saved)`);
    } catch (err) {
      console.warn(`  Failed to optimize ${asset.filename}: ${err.message}`);
      if (inputExists) {
        await fs.mkdir(PUBLIC_DIR, { recursive: true });
        await fs.copyFile(inputPath, outputPath);
        console.log(`  Copied unoptimized source to public/models/`);
      }
    }
  }

  console.log('Custom GLB optimization complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
