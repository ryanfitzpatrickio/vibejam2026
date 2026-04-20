#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isAssetBuildUpToDate, markAssetBuildCurrent } from './build-cache.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'assets', 'source');
const ANALYZE_SCRIPT = path.join(ROOT, 'scripts', 'analyze-texture-atlas.mjs');
const OUTPUT_DIR = path.join(ROOT, 'public');
const SHEET_DIR = path.join(ROOT, 'artifacts');

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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  const files = await fs.readdir(SOURCE_DIR);
  const atlases = files
    .map((filename) => {
      const id = atlasIdFromFilename(filename);
      return id ? { id, input: path.join(SOURCE_DIR, filename) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => atlasSortRank(a.id) - atlasSortRank(b.id));

  if (!atlases.length) {
    throw new Error(`No texture atlases found in ${SOURCE_DIR}`);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(SHEET_DIR, { recursive: true });

  for (const atlas of atlases) {
    const manifest = path.join(OUTPUT_DIR, `${atlas.id}.manifest.json`);
    const sheet = path.join(SHEET_DIR, `${atlas.id}-contact-sheet.png`);
    const inputs = [
      path.join(ROOT, 'scripts', 'analyze-texture-atlases.mjs'),
      path.join(ROOT, 'scripts', 'build-cache.mjs'),
      ANALYZE_SCRIPT,
      atlas.input,
    ];
    if (await isAssetBuildUpToDate({
      cacheName: `analyze-texture-atlas-${atlas.id}`,
      inputs,
      outputs: [manifest, sheet],
    })) {
      console.log(`Skipped ${path.relative(ROOT, manifest)} and ${path.relative(ROOT, sheet)} (up to date)`);
      continue;
    }

    await run('node', [
      ANALYZE_SCRIPT,
      '--input', atlas.input,
      '--output', manifest,
      '--sheet', sheet,
    ]);

    await markAssetBuildCurrent({
      cacheName: `analyze-texture-atlas-${atlas.id}`,
      inputs,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
