import { assetUrl } from '../utils/assetUrl.js';
import { GENERATED_TEXTURE_ATLASES } from './textureAtlasRegistry.generated.js';

export const DEFAULT_TEXTURE_ATLAS = 'textures';
export const PROP_TEXTURE_ATLAS = 'props';

export function isPropTextureAtlas(id) {
  return /^props\d*$/i.test(String(id ?? ''));
}

const PROP_SOURCE_URL = new URL('../../assets/source/props.jpg', import.meta.url).href;

const PROP_ATLAS = Object.freeze({
  id: PROP_TEXTURE_ATLAS,
  label: 'props.jpg',
  imageUrl: PROP_SOURCE_URL,
  manifestUrl: assetUrl('props.manifest.json'),
  chromaKey: true,
});

export const TEXTURE_ATLASES = Object.freeze(
  [
    ...((GENERATED_TEXTURE_ATLASES?.length ? GENERATED_TEXTURE_ATLASES : [
      Object.freeze({
        id: 'textures',
        label: 'textures.webp',
        imageUrl: assetUrl('textures.optimized.webp'),
        manifestUrl: assetUrl('textures.manifest.json'),
      }),
    ]).map((atlas) => Object.freeze({
      ...atlas,
      chromaKey: atlas.chromaKey ?? isPropTextureAtlas(atlas.id),
    }))),
    ...(GENERATED_TEXTURE_ATLASES?.some((atlas) => atlas.id === PROP_TEXTURE_ATLAS) ? [] : [PROP_ATLAS]),
  ],
);

export function getTextureAtlasById(id) {
  return TEXTURE_ATLASES.find((atlas) => atlas.id === id) ?? TEXTURE_ATLASES[0];
}

export function normalizeTextureAtlasId(value) {
  const id = typeof value === 'string' ? value.toLowerCase() : '';
  return TEXTURE_ATLASES.some((atlas) => atlas.id === id) ? id : DEFAULT_TEXTURE_ATLAS;
}

async function loadManifest(manifestUrl) {
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return {
      grid: { columns: 10, rows: 10 },
      cells: Array.from({ length: 100 }, (_, index) => ({
        index,
        description: `Cell ${index}`,
      })),
    };
  }
}

export async function loadTextureAtlases() {
  return Promise.all(TEXTURE_ATLASES.map(async (atlas) => ({
    ...atlas,
    manifest: await loadManifest(atlas.manifestUrl),
  })));
}
