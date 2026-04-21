import { createSignal } from 'solid-js';

/**
 * Tracks the most recent input source (keyboard/mouse vs. gamepad) so the UI
 * can show contextually appropriate button hints. SolidJS components read
 * `inputSource()` or `actionLabel(action)` reactively; vanilla code can use
 * `getInputSource()` and `subscribeInputSource(cb)`.
 */

const KEYBOARD = 'keyboard';
const GAMEPAD = 'gamepad';

const [source, setSource] = createSignal(KEYBOARD);
const listeners = new Set();

export function inputSource() {
  return source();
}

export function getInputSource() {
  return source();
}

export function setInputSource(next) {
  if (next !== KEYBOARD && next !== GAMEPAD) return;
  if (source() === next) return;
  setSource(next);
  for (const cb of listeners) {
    try { cb(next); } catch { /* ignore */ }
  }
}

export function subscribeInputSource(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const LABELS = {
  [KEYBOARD]: {
    jump: 'Space',
    interact: 'E',
    emote: 'F',
    grab: 'Q',
    drop: 'G',
    throw: 'G',
    sprint: 'Shift',
    crouch: 'Ctrl',
    heroActivate: 'H',
    adversaryToggle: 'J',
    smack: 'E',
    dismiss: 'Space / Enter',
    confirm: 'Enter',
    cancel: 'Esc',
  },
  [GAMEPAD]: {
    jump: 'A',
    interact: 'X',
    emote: 'Y',
    grab: 'B',
    drop: 'RB',
    throw: 'RB',
    sprint: 'RT',
    crouch: 'LT',
    heroActivate: 'LB',
    adversaryToggle: 'Menu',
    smack: 'X',
    dismiss: 'A',
    confirm: 'A',
    cancel: 'B',
  },
};

export function actionLabel(action) {
  const src = source();
  return LABELS[src][action] ?? LABELS[KEYBOARD][action] ?? action;
}

let installed = false;
/**
 * Attach global keyboard/mouse listeners that flip the source back to
 * keyboard. Safe to call multiple times — only installs once.
 */
export function installInputSourceTracking() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const onKeyboard = () => setInputSource(KEYBOARD);
  document.addEventListener('keydown', onKeyboard, true);
  document.addEventListener('mousemove', onKeyboard, true);
  document.addEventListener('mousedown', onKeyboard, true);
  document.addEventListener('wheel', onKeyboard, { capture: true, passive: true });
}
