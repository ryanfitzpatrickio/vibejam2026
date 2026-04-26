// Centralized eye-placement data + override store for all characters.
//
// Each "target" is a model the eye sprite-sheet (MouseEyeAtlasAnimator) can
// be attached to. Defaults live in code; the dressing-room dialog (dev only)
// writes overrides to localStorage so artists/devs can tune positions
// without rebuilding.
//
// Future-proofed for additional "slots" (e.g. hand items) under each target.

// Bump the suffix whenever you bake new defaults into DEFAULT_TARGETS so
// stale localStorage overrides don't shadow them.
const STORAGE_KEY = 'dressingRoom:eyePlacements:v9';

/**
 * @typedef {Object} EyePlacement
 * @property {string|null} socket   Bone/object name to parent eyes to. null = model root.
 * @property {{x:number,y:number,z:number}} position
 * @property {{x:number,y:number,z:number}} rotation  Euler radians
 * @property {{x:number,y:number,z:number}} scale
 * @property {number} eyeSize
 * @property {Record<string,string>} [stateToExpression]
 */

/**
 * @typedef {Object} EyeTargetDef
 * @property {string} key
 * @property {string} label
 * @property {string} kind            'mouse' | 'hero' | 'predator' | 'mount'
 * @property {string} modelPath       Asset path (relative)
 * @property {string} [defaultSocket] Bone name commonly present on this model
 * @property {EyePlacement} placement Default placement
 */

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

/** @type {Record<string, EyeTargetDef>} */
const DEFAULT_TARGETS = Object.freeze({
  mouse: {
    key: 'mouse',
    label: 'Mouse (player)',
    kind: 'mouse',
    modelPath: 'mouse-skinned.optimized.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 0.6,
    placement: {
      socket: 'Head',
      position: v3(-0.00576, 0.03805, -0.17668),
      rotation: v3(-2.3096, 0, 0),
      scale: v3(2.071, 2.059, 2.06),
      eyeSize: 0.13,
    },
  },
  brain: {
    key: 'brain',
    label: 'Brain (hero)',
    kind: 'hero',
    modelPath: 'models/brain.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 0.6,
    placement: {
      socket: 'mixamorigHead',
      position: v3(-0.20485, 23.22034, 44.47516),
      rotation: v3(0, 0, 0),
      scale: v3(1.5, 1.5, 1.5),
      eyeSize: 24,
    },
  },
  jerry: {
    key: 'jerry',
    label: 'Jerry (hero)',
    kind: 'hero',
    modelPath: 'models/jerry.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 0.6,
    placement: {
      socket: 'mixamorigHead',
      position: v3(0.1099, 42.7039, 38.5184),
      rotation: v3(0, 0, 0),
      scale: v3(1.5, 1.5, 1.5),
      eyeSize: 24,
    },
  },
  gus: {
    key: 'gus',
    label: 'Gus (hero)',
    kind: 'hero',
    modelPath: 'models/gus.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 0.6,
    placement: {
      socket: 'mixamorigHead',
      position: v3(-1.1048945342778045, 30.272571524082284, 26.524565745154717),
      rotation: v3(-0.6304103473295954, 0.030576893163649005, 0.03508419574589626),
      scale: v3(1.5, 1.5, 1.5),
      eyeSize: 24,
    },
  },
  speedy: {
    key: 'speedy',
    label: 'Speedy (hero)',
    kind: 'hero',
    modelPath: 'models/speedy.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 0.6,
    placement: {
      socket: 'mixamorigHead',
      position: v3(0.7282319382734805, 29.676788650822736, 41.53705809640216),
      rotation: v3(0, 0, 0),
      scale: v3(1.5, 1.5, 1.5),
      eyeSize: 24,
    },
  },
  cat: {
    key: 'cat',
    label: 'Cat (predator)',
    kind: 'predator',
    modelPath: 'models/cat.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 1.6,
    placement: {
      socket: 'Head',
      position: v3(-0.00290, 0.13045, -0.00980),
      rotation: v3(-2.06019, -0.00388, 0.00009),
      scale: v3(1, 1, 1),
      eyeSize: 0.13,
    },
  },
  human: {
    key: 'human',
    label: 'Human / Cop (predator)',
    kind: 'predator',
    modelPath: 'models/cop.glb',
    defaultSocket: 'Head',
    previewWorldHeight: 9.0,
    placement: {
      socket: 'mixamorigHead',
      position: v3(0.14437, 13.74347, 11.64151),
      rotation: v3(-0.22088, -0.02463, 0.02165),
      scale: v3(2, 2, 2),
      eyeSize: 5,
    },
  },
  bird: {
    key: 'bird',
    label: 'Love Bird (mount)',
    kind: 'mount',
    modelPath: 'models/bird.glb',
    defaultSocket: 'head',
    previewWorldHeight: 1.2,
    placement: {
      socket: 'head',
      position: v3(0.00017500532376880001, 0.06077240521370369, -0.08864301810865419),
      rotation: v3(-2.320547885549613, 0.0005672320068981572, 0.0016720254234105676),
      scale: v3(1, 1, 1),
      eyeSize: 0.098,
    },
  },
});

export const EYE_TARGET_KEYS = Object.freeze(Object.keys(DEFAULT_TARGETS));

function clonePlacement(p) {
  return {
    socket: p.socket ?? null,
    position: { ...p.position },
    rotation: { ...p.rotation },
    scale: { ...p.scale },
    eyeSize: p.eyeSize ?? 0.13,
    stateToExpression: p.stateToExpression ? { ...p.stateToExpression } : undefined,
  };
}

function readOverrides() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* private mode etc. */
  }
}

/** @type {Map<string, Set<(p: EyePlacement) => void>>} */
const subscribers = new Map();

function notify(modelKey, placement) {
  const set = subscribers.get(modelKey);
  if (!set) return;
  for (const fn of set) {
    try { fn(placement); } catch { /* keep notifying */ }
  }
}

export function listEyeTargets() {
  return EYE_TARGET_KEYS.map((k) => ({ ...DEFAULT_TARGETS[k] }));
}

export function getEyeTargetDef(modelKey) {
  return DEFAULT_TARGETS[modelKey] ?? null;
}

/** Returns the effective placement (defaults merged with persisted override). */
export function getEyePlacement(modelKey) {
  const def = DEFAULT_TARGETS[modelKey];
  if (!def) return null;
  const overrides = readOverrides();
  const override = overrides[modelKey];
  const merged = clonePlacement(def.placement);
  if (override) {
    if (override.socket !== undefined) merged.socket = override.socket;
    if (override.position) merged.position = { ...merged.position, ...override.position };
    if (override.rotation) merged.rotation = { ...merged.rotation, ...override.rotation };
    if (override.scale) merged.scale = { ...merged.scale, ...override.scale };
    if (typeof override.eyeSize === 'number') merged.eyeSize = override.eyeSize;
    if (override.stateToExpression) merged.stateToExpression = { ...override.stateToExpression };
  }
  return merged;
}

/** Persist a (partial) placement override and notify subscribers. */
export function setEyePlacement(modelKey, patch) {
  if (!DEFAULT_TARGETS[modelKey]) return;
  const overrides = readOverrides();
  const next = { ...(overrides[modelKey] ?? {}) };
  if (patch.socket !== undefined) next.socket = patch.socket;
  if (patch.position) next.position = { ...(next.position ?? {}), ...patch.position };
  if (patch.rotation) next.rotation = { ...(next.rotation ?? {}), ...patch.rotation };
  if (patch.scale) next.scale = { ...(next.scale ?? {}), ...patch.scale };
  if (typeof patch.eyeSize === 'number') next.eyeSize = patch.eyeSize;
  if (patch.stateToExpression) next.stateToExpression = { ...patch.stateToExpression };
  overrides[modelKey] = next;
  writeOverrides(overrides);
  notify(modelKey, getEyePlacement(modelKey));
}

/** Restore defaults for a single model. */
export function resetEyePlacement(modelKey) {
  const overrides = readOverrides();
  if (overrides[modelKey]) {
    delete overrides[modelKey];
    writeOverrides(overrides);
  }
  notify(modelKey, getEyePlacement(modelKey));
}

/** Subscribe to placement changes for a model. Returns unsubscribe fn. */
export function subscribeEyePlacement(modelKey, fn) {
  let set = subscribers.get(modelKey);
  if (!set) {
    set = new Set();
    subscribers.set(modelKey, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

/** All current overrides as a JSON-friendly object (for "copy JSON" / export). */
export function exportEyePlacements() {
  const overrides = readOverrides();
  const out = {};
  for (const key of EYE_TARGET_KEYS) {
    out[key] = getEyePlacement(key);
    out[key].__overridden = !!overrides[key];
  }
  return out;
}
