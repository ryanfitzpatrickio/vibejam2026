#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAssetBuildUpToDate, markAssetBuildCurrent } from './build-cache.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'assets', 'source');
const OUTPUT_FILE = path.join(ROOT, 'src', 'dev', 'textureAtlasRegistry.generated.js');
const CACHE_NAME = 'generate-texture-atlas-registry';

function atlasIdFromFilename(filename) {
  const match = /^(textures|props)(\d*)\.(webp|jpg|jpeg|png)$/i.exec(filename);
  if (!match) return null;
  const prefix = match[1].toLowerCase();
  const suffix = match[2] ?? '';
  return suffix ? `${prefix}${suffix}` : prefix;
}

function atlasLabel(id) {
  return `${id}.webp`;
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

async function main() {
  const files = await fs.readdir(SOURCE_DIR);
  const atlases = files
    .map((filename) => {
      const id = atlasIdFromFilename(filename);
      if (!id) return null;
      return {
        id,
        input: path.join(SOURCE_DIR, filename),
        label: atlasLabel(id),
        imageUrl: `assetUrl('${id}.optimized.webp')`,
        manifestUrl: `assetUrl('${id}.manifest.json')`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => atlasSortRank(a.id) - atlasSortRank(b.id));

  const inputs = [
    path.join(ROOT, 'scripts', 'generate-texture-atlas-registry.mjs'),
    path.join(ROOT, 'scripts', 'build-cache.mjs'),
    ...atlases.map((atlas) => atlas.input),
  ];

  if (await isAssetBuildUpToDate({
    cacheName: CACHE_NAME,
    inputs,
    outputs: [OUTPUT_FILE],
  })) {
    console.log(`Skipped ${path.relative(ROOT, OUTPUT_FILE)} (up to date)`);
    return;
  }

  const body = `import { assetUrl } from '../utils/assetUrl.js';

export const GENERATED_TEXTURE_ATLASES = Object.freeze([
${atlases.map((atlas) => `  Object.freeze({
    id: '${atlas.id}',
    label: '${atlas.label}',
    imageUrl: ${atlas.imageUrl},
    manifestUrl: ${atlas.manifestUrl},
  }),`).join('\n')}
]);
`;

  await fs.writeFile(OUTPUT_FILE, body);
  await markAssetBuildCurrent({
    cacheName: CACHE_NAME,
    inputs,
  });
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
