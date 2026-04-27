import { DEFAULT_TEXTURE_ATLAS, PROP_TEXTURE_ATLAS, normalizeTextureAtlasId } from './textureAtlasRegistry.js';
import { normalizeTreeBuilder } from '../world/VegetationTreeBuilder.js';

export const VEGETATION_KINDS = Object.freeze(['grass', 'plant', 'hedge', 'tree']);
export const VEGETATION_RENDER_MODES = Object.freeze(['instancedCards', 'module', 'glb']);
export const VEGETATION_PLACEMENT_MODES = Object.freeze(['single', 'patch', 'line']);
export const VEGETATION_AREA_SHAPES = Object.freeze(['rect', 'circle']);
export const VEGETATION_SHADOW_MODES = Object.freeze(['none', 'nearOnly', 'full']);
export const VEGETATION_COLLISION_MODES = Object.freeze(['none', 'box', 'cylinder']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 4) {
  return Number(Number(value || 0).toFixed(decimals));
}

function cloneVectorLike(source, fallback) {
  return {
    x: source?.x ?? fallback.x,
    y: source?.y ?? fallback.y,
    z: source?.z ?? fallback.z,
  };
}

function normalizeKind(value) {
  return VEGETATION_KINDS.includes(value) ? value : 'grass';
}

function normalizeRenderMode(value) {
  return VEGETATION_RENDER_MODES.includes(value) ? value : 'instancedCards';
}

function normalizePlacementMode(value) {
  return VEGETATION_PLACEMENT_MODES.includes(value) ? value : 'single';
}

function normalizeAreaShape(value) {
  return VEGETATION_AREA_SHAPES.includes(value) ? value : 'rect';
}

function normalizeShadowMode(value) {
  return VEGETATION_SHADOW_MODES.includes(value) ? value : 'nearOnly';
}

function normalizeCollisionMode(value) {
  return VEGETATION_COLLISION_MODES.includes(value) ? value : 'none';
}

function normalizeCellList(value = []) {
  const source = Array.isArray(value)
    ? value
    : Number.isFinite(value)
      ? [value]
      : [];
  const cells = Array.from(new Set(source
    .map((entry) => Number(entry))
    .filter(Number.isFinite)
    .map((entry) => Math.max(0, Math.trunc(entry)))));
  return cells.slice(0, 16);
}

function normalizeArea(area = {}) {
  return {
    shape: normalizeAreaShape(area.shape),
    width: round(clamp(Number(area.width ?? 2), 0.25, 32)),
    depth: round(clamp(Number(area.depth ?? 2), 0.25, 32)),
    radius: round(clamp(Number(area.radius ?? 1.5), 0.15, 16)),
  };
}

function normalizeLine(line = {}) {
  return {
    length: round(clamp(Number(line.length ?? 4), 0.25, 64)),
    width: round(clamp(Number(line.width ?? 0.8), 0.1, 12)),
  };
}

function getDefaultCollisionShape({
  kind = 'grass',
  treeBuilder = null,
  size = {},
} = {}) {
  if (kind === 'tree') {
    const builder = normalizeTreeBuilder(treeBuilder ?? {});
    const radius = round(Math.max(builder.trunk.radiusBase, builder.trunk.radiusTop, 0.03));
    const height = round(builder.trunk.height);
    return {
      width: round(radius * 2),
      depth: round(radius * 2),
      radius,
      height,
      offsetY: round(height * 0.5),
    };
  }

  const width = round(clamp(
    ((Number(size.widthMin ?? 0.18) + Number(size.widthMax ?? 0.28)) * 0.5),
    0.05,
    24,
  ));
  const height = round(clamp(
    ((Number(size.heightMin ?? 0.35) + Number(size.heightMax ?? 0.6)) * 0.5),
    0.05,
    32,
  ));
  return {
    width,
    depth: width,
    radius: round(width * 0.5),
    height,
    offsetY: round(height * 0.5),
  };
}

function normalizeCollisionShape(shape = {}, defaults = {}) {
  const fallback = defaults ?? getDefaultCollisionShape();
  return {
    width: round(clamp(Number(shape.width ?? fallback.width), 0.05, 24)),
    depth: round(clamp(Number(shape.depth ?? fallback.depth), 0.05, 24)),
    radius: round(clamp(Number(shape.radius ?? fallback.radius), 0.025, 12)),
    height: round(clamp(Number(shape.height ?? fallback.height), 0.05, 32)),
    offsetY: round(clamp(Number(shape.offsetY ?? fallback.offsetY), -8, 32)),
  };
}

function normalizePlacementSize(size = null) {
  if (!size) return null;
  const widthMin = clamp(Number(size.widthMin ?? 0.18), 0.02, 24);
  const widthMax = Math.max(widthMin, clamp(Number(size.widthMax ?? widthMin), widthMin, 24));
  const heightMin = clamp(Number(size.heightMin ?? 0.35), 0.02, 32);
  const heightMax = Math.max(heightMin, clamp(Number(size.heightMax ?? heightMin), heightMin, 32));
  return {
    widthMin: round(widthMin),
    widthMax: round(widthMax),
    heightMin: round(heightMin),
    heightMax: round(heightMax),
  };
}

export function createVegetationSpeciesId() {
  return `veg-species-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createVegetationPlacementId() {
  return `veg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeVegetationSpecies(entry = {}) {
  const kind = normalizeKind(entry.kind);
  const renderMode = normalizeRenderMode(entry.renderMode);
  const cells = normalizeCellList(entry.cells);
  const widthMin = clamp(Number(entry.size?.widthMin ?? 0.18), 0.02, 24);
  const widthMax = Math.max(widthMin, clamp(Number(entry.size?.widthMax ?? 0.28), widthMin, 24));
  const heightMin = clamp(Number(entry.size?.heightMin ?? 0.35), 0.02, 32);
  const heightMax = Math.max(heightMin, clamp(Number(entry.size?.heightMax ?? 0.6), heightMin, 32));
  const treeBuilder = kind === 'tree' ? normalizeTreeBuilder(entry.treeBuilder) : undefined;
  const defaultAtlas = renderMode === 'instancedCards'
    ? PROP_TEXTURE_ATLAS
    : kind === 'tree'
      ? 'props2'
      : DEFAULT_TEXTURE_ATLAS;
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : createVegetationSpeciesId(),
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Vegetation Species',
    kind,
    renderMode,
    atlas: normalizeTextureAtlasId(entry.atlas ?? defaultAtlas),
    cells: cells.length ? cells : [0],
    cardCount: clamp(Math.trunc(Number(entry.cardCount ?? (kind === 'grass' ? 3 : 4))), 1, 8),
    size: {
      widthMin: round(widthMin),
      widthMax: round(widthMax),
      heightMin: round(heightMin),
      heightMax: round(heightMax),
    },
    wind: {
      amp: round(clamp(Number(entry.wind?.amp ?? 0.08), 0, 1)),
      freq: round(clamp(Number(entry.wind?.freq ?? 1.4), 0, 10)),
      stiffness: round(clamp(Number(entry.wind?.stiffness ?? 0.8), 0, 2)),
    },
    lineSpacing: round(clamp(Number(entry.lineSpacing ?? (kind === 'hedge' ? 0.55 : 0.4)), 0.05, 8)),
    shadow: normalizeShadowMode(entry.shadow),
    collision: normalizeCollisionMode(entry.collision),
    collisionShape: normalizeCollisionShape(entry.collisionShape, getDefaultCollisionShape({
      kind,
      treeBuilder,
      size: {
        widthMin,
        widthMax,
        heightMin,
        heightMax,
      },
    })),
    assetId: typeof entry.assetId === 'string' && entry.assetId.trim() ? entry.assetId.trim() : null,
    treeBuilder,
  };
}

export function normalizeVegetationLibrary(library = {}) {
  const species = Array.isArray(library?.species)
    ? library.species.map((entry) => normalizeVegetationSpecies(entry))
    : [];
  return {
    version: Math.max(1, Math.trunc(Number(library?.version ?? 1)) || 1),
    species,
  };
}

export function normalizeVegetationPlacement(entry = {}) {
  const mode = normalizePlacementMode(entry.mode);
  const scale = cloneVectorLike(entry.scale, { x: 1, y: 1, z: 1 });
  const kind = VEGETATION_KINDS.includes(entry.kind) ? entry.kind : null;
  const collision = VEGETATION_COLLISION_MODES.includes(entry.collision) ? entry.collision : null;
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : createVegetationPlacementId(),
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'vegetation',
    speciesId: typeof entry.speciesId === 'string' && entry.speciesId.trim() ? entry.speciesId.trim() : null,
    kind,
    collision,
    collisionShape: entry.collisionShape ? normalizeCollisionShape(entry.collisionShape) : null,
    size: normalizePlacementSize(entry.size),
    mode,
    position: cloneVectorLike(entry.position, { x: 0, y: 0, z: 0 }),
    rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
    scale: {
      x: round(clamp(Number(scale.x), 0.1, 32)),
      y: round(clamp(Number(scale.y), 0.1, 32)),
      z: round(clamp(Number(scale.z), 0.1, 32)),
    },
    area: normalizeArea(entry.area),
    density: Math.max(1, Math.trunc(Number(entry.density ?? (mode === 'single' ? 1 : 24))) || 1),
    seed: Math.trunc(Number(entry.seed ?? 1)) || 1,
    line: normalizeLine(entry.line),
    deleted: entry.deleted === true,
  };
}

export const DEFAULT_VEGETATION_LIBRARY = Object.freeze(normalizeVegetationLibrary({
  version: 1,
  species: [
    {
      id: 'grass-debug-a',
      name: 'Debug Grass',
      kind: 'grass',
      renderMode: 'instancedCards',
      atlas: 'props',
      cells: [2, 3],
      cardCount: 3,
      size: {
        widthMin: 0.14,
        widthMax: 0.24,
        heightMin: 0.35,
        heightMax: 0.6,
      },
      wind: { amp: 0.08, freq: 1.4, stiffness: 0.8 },
      shadow: 'nearOnly',
      collision: 'none',
      lineSpacing: 0.32,
    },
    {
      id: 'hedge-debug-a',
      name: 'Debug Hedge',
      kind: 'hedge',
      renderMode: 'instancedCards',
      atlas: 'props',
      cells: [0, 1, 2, 3],
      cardCount: 4,
      size: {
        widthMin: 0.4,
        widthMax: 0.6,
        heightMin: 0.8,
        heightMax: 1.25,
      },
      wind: { amp: 0.04, freq: 0.9, stiffness: 1.1 },
      shadow: 'nearOnly',
      collision: 'none',
      lineSpacing: 0.45,
    },
    {
      id: 'tree-glb-a',
      name: 'Tree GLB',
      kind: 'tree',
      renderMode: 'glb',
      atlas: 'props2',
      cells: [0, 1, 2, 3],
      cardCount: 2,
      size: {
        widthMin: 1.2,
        widthMax: 2.4,
        heightMin: 2.4,
        heightMax: 4.6,
      },
      wind: { amp: 0.02, freq: 0.5, stiffness: 1.4 },
      shadow: 'full',
      collision: 'cylinder',
      assetId: null,
      treeBuilder: normalizeTreeBuilder({
        trunkAssetName: 'tree-oak-a',
      }),
    },
  ],
}));
