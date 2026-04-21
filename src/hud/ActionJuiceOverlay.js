import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const DEFAULT_DURATION = 1.08;
const DEFAULT_RISE = 1.05;

const STYLE_PRESETS = Object.freeze({
  cheese: {
    color: '#fff7da',
    border: 'rgba(255, 232, 140, 0.94)',
    background: 'linear-gradient(180deg, rgba(246,186,54,0.96) 0%, rgba(214,128,25,0.96) 100%)',
    shadow: 'rgba(255, 193, 79, 0.5)',
  },
  smack: {
    color: '#fff3f6',
    border: 'rgba(255, 174, 188, 0.95)',
    background: 'linear-gradient(180deg, rgba(252,104,132,0.96) 0%, rgba(207,45,87,0.96) 100%)',
    shadow: 'rgba(255, 105, 135, 0.44)',
  },
  mischief: {
    color: '#f6fffc',
    border: 'rgba(161, 255, 219, 0.95)',
    background: 'linear-gradient(180deg, rgba(31,201,157,0.96) 0%, rgba(17,128,115,0.96) 100%)',
    shadow: 'rgba(56, 243, 191, 0.42)',
  },
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function disposeEntry(scene, entry) {
  if (!entry) return;
  entry.anchor.remove(entry.label);
  scene?.remove(entry.anchor);
  entry.root.remove();
}

function applyBubbleStyle(bubble, tone) {
  const preset = STYLE_PRESETS[tone] ?? STYLE_PRESETS.cheese;
  Object.assign(bubble.style, {
    display: 'inline-flex',
    'align-items': 'center',
    gap: '0.28em',
    padding: '6px 12px',
    'border-radius': '999px',
    border: `2px solid ${preset.border}`,
    background: preset.background,
    color: preset.color,
    fontFamily: '"Fredoka", "Baloo", system-ui, sans-serif',
    fontSize: '22px',
    fontWeight: '800',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    textShadow: [
      '-1.5px -1.5px 0 rgba(37,20,14,0.72)',
      '1.5px -1.5px 0 rgba(37,20,14,0.72)',
      '-1.5px 1.5px 0 rgba(37,20,14,0.72)',
      '1.5px 1.5px 0 rgba(37,20,14,0.72)',
    ].join(', '),
    boxShadow: [
      `0 10px 22px ${preset.shadow}`,
      'inset 0 2px 0 rgba(255,255,255,0.3)',
      'inset 0 -2px 0 rgba(0,0,0,0.18)',
    ].join(', '),
    transformOrigin: '50% 100%',
    willChange: 'transform, opacity',
  });
}

export class ActionJuiceOverlay {
  constructor({ scene, maxPopups = 18 } = {}) {
    this.scene = scene;
    this.maxPopups = Math.max(1, Math.floor(maxPopups) || 18);
    this.enabled = true;
    /** @type {Array<{ anchor: THREE.Object3D, label: CSS2DObject, root: HTMLDivElement, bubble: HTMLDivElement, age: number, duration: number, rise: number, driftX: number, driftZ: number, baseY: number }>} */
    this.entries = [];
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    for (const entry of this.entries) {
      entry.root.style.display = this.enabled ? '' : 'none';
    }
  }

  spawn({
    text,
    position,
    tone = 'cheese',
    duration = DEFAULT_DURATION,
    rise = DEFAULT_RISE,
    yOffset = 0,
  } = {}) {
    if (!this.scene || !position || !text) return;
    while (this.entries.length >= this.maxPopups) {
      disposeEntry(this.scene, this.entries.shift());
    }

    const root = document.createElement('div');
    Object.assign(root.style, {
      pointerEvents: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      contain: 'layout style',
      overflow: 'visible',
      display: this.enabled ? '' : 'none',
    });

    const bubble = document.createElement('div');
    bubble.textContent = String(text);
    applyBubbleStyle(bubble, tone);
    root.appendChild(bubble);

    const anchor = new THREE.Object3D();
    anchor.position.copy(position);
    anchor.position.y += yOffset;

    const label = new CSS2DObject(root);
    label.position.set(0, 0, 0);
    label.renderOrder = 995;
    anchor.add(label);
    this.scene.add(anchor);

    const angle = (Math.random() - 0.5) * Math.PI;
    const drift = 0.16 + Math.random() * 0.1;
    const entry = {
      anchor,
      label,
      root,
      bubble,
      age: 0,
      duration: Math.max(0.4, Number(duration) || DEFAULT_DURATION),
      rise: Math.max(0.35, Number(rise) || DEFAULT_RISE),
      driftX: Math.sin(angle) * drift,
      driftZ: Math.cos(angle) * drift * 0.28,
      baseY: anchor.position.y,
    };
    this.entries.push(entry);
    this._applyEntryVisual(entry);
  }

  _applyEntryVisual(entry) {
    const progress = clamp01(entry.age / entry.duration);
    const floatProgress = easeOutCubic(progress);
    entry.anchor.position.y = entry.baseY + entry.rise * floatProgress;
    entry.bubble.style.opacity = progress > 0.74
      ? `${clamp01(1 - ((progress - 0.74) / 0.26))}`
      : '1';
    const scale = 0.84 + Math.sin(progress * Math.PI) * 0.18 + (1 - progress) * 0.12;
    entry.bubble.style.transform = `translateY(${-progress * 22}px) scale(${scale.toFixed(3)})`;
  }

  update(deltaSeconds = 0) {
    if (!this.entries.length) return;
    const dt = Math.max(0, Number(deltaSeconds) || 0);
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      entry.age += dt;
      entry.anchor.position.x += entry.driftX * dt;
      entry.anchor.position.z += entry.driftZ * dt;
      if (entry.age >= entry.duration) {
        disposeEntry(this.scene, entry);
        this.entries.splice(i, 1);
        continue;
      }
      this._applyEntryVisual(entry);
    }
  }

  clear() {
    for (const entry of this.entries) disposeEntry(this.scene, entry);
    this.entries.length = 0;
  }

  dispose() {
    this.clear();
  }
}
