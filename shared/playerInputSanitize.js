/**
 * Clamp client movement input before server simulation (anti-grief / NaN guard).
 */

const MAX_SEQ = Number.MAX_SAFE_INTEGER;
const ALLOWED_EMOTES = new Set([
  'wave',
  'dance',
  'laugh',
  'cry',
  'angry',
  'love',
  'thumbsup',
  'scream',
]);

function clampUnit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function clampRotation(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1e5, Math.min(1e5, n));
}

function clampSeq(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_SEQ);
}

function sanitizeEmote(value) {
  if (typeof value !== 'string') return null;
  return ALLOWED_EMOTES.has(value) ? value : null;
}

/**
 * @param {object} data Raw parsed JSON from client
 * @returns {object} Safe fields for simulateTick queue
 */
export function sanitizePlayerInputMessage(data) {
  return {
    moveX: clampUnit(data.moveX),
    moveZ: clampUnit(data.moveZ),
    sprint: !!data.sprint,
    jump: !!(data.jumpPressed ?? data.jump),
    jumpPressed: !!(data.jumpPressed ?? data.jump),
    jumpHeld: !!(data.jumpHeld ?? data.jumpPressed ?? data.jump),
    jumpCharge: Math.max(0, Math.min(1, Number(data.jumpCharge) || 0)),
    crouch: !!data.crouch,
    rotation: clampRotation(data.rotation),
    emote: sanitizeEmote(data.emote),
    grab: !!data.grab,
    smack: !!data.smack,
    /** Held while E winds up a proximity charged smack. */
    smackHeld: !!data.smackHeld,
    /** One-shot E release after windup. */
    chargedSmackRelease: !!data.chargedSmackRelease,
    /** Held while E winds up a super throw on a grabbed mouse/object. */
    chargedThrowHeld: !!data.chargedThrowHeld,
    /** One-shot E release after full super-throw charge. */
    chargedThrowRelease: !!data.chargedThrowRelease,
    chargedThrowAimX: clampUnit(data.chargedThrowAimX),
    chargedThrowAimZ: clampUnit(data.chargedThrowAimZ),
    /** Left-click arcade toss: hold to auto-grab a nearby mouse and charge a launch. */
    quickTossHeld: !!data.quickTossHeld,
    /** One-shot left-click release to sling the quick-toss target. */
    quickTossRelease: !!data.quickTossRelease,
    quickTossAimX: clampUnit(data.quickTossAimX),
    quickTossAimZ: clampUnit(data.quickTossAimZ),
    /** One-shot RB / G press to throw a held mouse or ball with physics. */
    throw: !!data.throw,
    ropeGrab: !!data.ropeGrab,
    /** Hold E — extraction progress during extract phase. */
    interactHeld: !!data.interactHeld,
    /** One-shot H press to activate hero mode (server ignores if not offered). */
    heroActivate: !!data.heroActivate,
    /** One-shot J press to claim/release the single adversary role. */
    adversaryToggle: !!data.adversaryToggle,
    seq: clampSeq(data.seq),
  };
}
