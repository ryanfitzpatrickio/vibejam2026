#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { isAssetBuildUpToDate, markAssetBuildCurrent } from './build-cache.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'assets', 'source');

function atlasIdFromFilename(filename) {
  const match = /^(textures|props)(\d*)\.(webp|jpg|jpeg|png)$/i.exec(filename);
  if (!match) return null;
  const prefix = match[1].toLowerCase();
  const suffix = match[2] ?? '';
  return suffix ? `${prefix}${suffix}` : prefix;
}

function atlasSortRank(id) {
  const match = /^(textures|props)(\d*)$/i.exec(id);
  if (!match) return 9999;
  const prefix = match[1].toLowerCase();
  const suffix = match[2];
  const base = prefix === 'textures' ? 0 : 1000;
  const rank = suffix ? Number.parseInt(suffix, 10) : 0;
  return base + (Number.isFinite(rank) ? rank : 999);
}

async function optimizeImage({ input, output, width, quality, nearLossless, label }) {
  const exists = await fs
    .access(input)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    throw new Error(`Missing source image: ${input}`);
  }

  const sourceSize = (await fs.stat(input)).size;
  const image = sharp(input, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();

  let pipeline = image;
  if (metadata.width && metadata.width > width) {
    pipeline = pipeline.resize({ width, withoutEnlargement: true, fit: 'inside' });
  }

  await pipeline
    .webp({
      quality,
      effort: 6,
      nearLossless,
    })
    .toFile(output);

  const outputSize = (await fs.stat(output)).size;
  console.log(`${label}: ${(sourceSize / 1024).toFixed(0)} KB -> ${(outputSize / 1024).toFixed(0)} KB`);
}

async function main() {
  await fs.mkdir(path.join(ROOT, 'public'), { recursive: true });

  const files = await fs.readdir(SOURCE_DIR);
  const atlasSources = files
    .map((filename) => {
      const id = atlasIdFromFilename(filename);
      return id ? {
        id,
        input: path.join(SOURCE_DIR, filename),
        output: path.join(ROOT, 'public', `${id}.optimized.webp`),
        width: 1536,
        quality: 62,
        nearLossless: false,
        label: `${id} atlas`,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => atlasSortRank(a.id) - atlasSortRank(b.id));

  const otherSources = [
    {
      input: path.join(SOURCE_DIR, 'eyeset1.jpg'),
      output: path.join(ROOT, 'public', 'eyeset1.optimized.webp'),
      width: 1920,
      quality: 60,
      nearLossless: false,
      label: 'eye atlas',
    },
    {
      input: path.join(SOURCE_DIR, 'eyesrandom1.jpg'),
      output: path.join(ROOT, 'public', 'eyesrandom1.optimized.webp'),
      width: 1920,
      quality: 60,
      nearLossless: false,
      label: 'one-shot eye atlas 1',
    },
    {
      input: path.join(SOURCE_DIR, 'eyesrandom2.jpg'),
      output: path.join(ROOT, 'public', 'eyesrandom2.optimized.webp'),
      width: 1920,
      quality: 60,
      nearLossless: false,
      label: 'one-shot eye atlas 2',
    },
  ];

  for (const entry of [...atlasSources, ...otherSources]) {
    const inputs = [
      entry.input,
      path.join(ROOT, 'scripts', 'optimize-runtime-images.mjs'),
      path.join(ROOT, 'scripts', 'build-cache.mjs'),
    ];
    if (await isAssetBuildUpToDate({
      cacheName: `optimize-runtime-image-${path.basename(entry.output)}`,
      inputs,
      outputs: [entry.output],
    })) {
      console.log(`Skipped ${path.relative(ROOT, entry.output)} (up to date)`);
      continue;
    }

    await optimizeImage(entry);

    await markAssetBuildCurrent({
      cacheName: `optimize-runtime-image-${path.basename(entry.output)}`,
      inputs,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
