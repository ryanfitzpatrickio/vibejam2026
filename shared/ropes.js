/**
 * Shared rope definitions. Client and server agree on placement, length,
 * and segment count. Server is authoritative for segment positions.
 */

export const ROPE_SEGMENT_RADIUS = 0.06;
export const ROPE_GRAB_RANGE = 0.9;

export const DEFAULT_ROPE_LENGTH = 2.4;
export const DEFAULT_ROPE_SEGMENTS = 8;
export const MIN_ROPE_LENGTH = 0.5;
export const MAX_ROPE_LENGTH = 12;
export const MIN_ROPE_SEGMENTS = 3;
export const MAX_ROPE_SEGMENTS = 32;

/** Cross-section radius of rope (physics sphere + render tube). */
export const MIN_SEGMENT_RADIUS = 0.02;
export const MAX_SEGMENT_RADIUS = 0.12;
export const MIN_ROPE_CARD_WIDTH = 0.08;
export const MAX_ROPE_CARD_WIDTH = 2.4;

export const DEFAULT_ROPE_COLOR = '#c48a4a';
export const DEFAULT_ROPE_CARD_WIDTH = 0.7;
export const DEFAULT_ROPE_CARD_OPACITY = 0.88;
export const ROPE_VISUAL_MODES = Object.freeze(['rope', 'cards', 'rope-cards']);
const DEFAULT_TEXTURE_ATLAS = 'textures';

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cloneAnchor(anchor) {
  return {
    x: Number(anchor?.x ?? 0),
    y: Number(anchor?.y ?? 3.2),
    z: Number(anchor?.z ?? 0),
  };
}

function normalizeAtlasId(value) {
  if (typeof value === 'string' && /^textures\d*$/i.test(value)) return value.toLowerCase();
  return DEFAULT_TEXTURE_ATLAS;
}

function normalizeRopeTexture(entry) {
  const raw = entry?.texture;
  if (!raw || typeof raw !== 'object') return null;
  const cell = Number(raw.cell);
  if (!Number.isFinite(cell)) return null;
  return {
    atlas: normalizeAtlasId(raw.atlas),
    cell: Math.round(cell),
  };
}

function normalizeColor(value) {
  if (typeof value !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    return DEFAULT_ROPE_COLOR;
  }
  return value.trim();
}

function normalizeVisualMode(value) {
  return ROPE_VISUAL_MODES.includes(value) ? value : 'rope';
}

function normalizeRopeCards(entry) {
  const raw = entry?.cards && typeof entry.cards === 'object' ? entry.cards : {};
  const legacyEnabled = entry?.cardVisual === true || entry?.cardsEnabled === true;
  const enabled = raw.enabled === true || legacyEnabled || normalizeVisualMode(entry?.visualMode) !== 'rope';
  return {
    enabled,
    width: clampNumber(raw.width ?? entry?.cardWidth, MIN_ROPE_CARD_WIDTH, MAX_ROPE_CARD_WIDTH, DEFAULT_ROPE_CARD_WIDTH),
    opacity: clampNumber(raw.opacity ?? entry?.cardOpacity, 0.05, 1, DEFAULT_ROPE_CARD_OPACITY),
  };
}

export function normalizeRope(entry = {}) {
  const id = typeof entry.id === 'string' && entry.id
    ? entry.id
    : `rope-${Math.random().toString(36).slice(2, 8)}`;
  const name = typeof entry.name === 'string' && entry.name.length
    ? entry.name
    : `rope-${id.slice(-5)}`;

  let segmentRadius = clampNumber(entry.segmentRadius, MIN_SEGMENT_RADIUS, MAX_SEGMENT_RADIUS, ROPE_SEGMENT_RADIUS);
  if (entry.thickness != null && entry.segmentRadius == null) {
    const t = Number(entry.thickness);
    if (Number.isFinite(t) && t > 0) {
      segmentRadius = clampNumber(t * 0.5, MIN_SEGMENT_RADIUS, MAX_SEGMENT_RADIUS, ROPE_SEGMENT_RADIUS);
    }
  }

  const visualMode = normalizeVisualMode(entry.visualMode ?? (entry.cards?.enabled ? 'rope-cards' : 'rope'));
  const cards = normalizeRopeCards({ ...entry, visualMode });

  return {
    id,
    name,
    anchor: cloneAnchor(entry.anchor ?? entry.position),
    length: clampNumber(entry.length, MIN_ROPE_LENGTH, MAX_ROPE_LENGTH, DEFAULT_ROPE_LENGTH),
    segmentCount: Math.round(
      clampNumber(entry.segmentCount, MIN_ROPE_SEGMENTS, MAX_ROPE_SEGMENTS, DEFAULT_ROPE_SEGMENTS),
    ),
    segmentRadius,
    color: normalizeColor(entry.color),
    texture: normalizeRopeTexture(entry),
    visualMode,
    cards,
    deleted: entry.deleted === true,
  };
}

export const ROPES = Object.freeze([
  normalizeRope({
    id: 'rope-test-0',
    anchor: { x: 0, y: 3.2, z: 0 },
    length: 2.4,
    segmentCount: 8,
    segmentRadius: ROPE_SEGMENT_RADIUS,
    color: DEFAULT_ROPE_COLOR,
    texture: null,
  }),
]);
