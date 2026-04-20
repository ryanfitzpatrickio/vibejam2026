import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** Local-space offset from mouse root (feet) to name anchor — follows scale/rotation. */
export const NAMEPLATE_HEAD_OFFSET_Y = 0.94;

const _headLocal = new THREE.Vector3(0, NAMEPLATE_HEAD_OFFSET_Y, 0);

/**
 * Keep a scene-root anchor aligned above the mouse so the label is not a child of the avatar
 * (avoids inheriting visibility / culling) and still tracks the head in world space.
 * @param {THREE.Object3D} anchor — parent of the CSS2DObject, direct child of scene
 * @param {THREE.Object3D} mouse
 */
export function syncNameplateWorldPosition(anchor, mouse, offsetY = NAMEPLATE_HEAD_OFFSET_Y) {
  _headLocal.set(0, offsetY, 0).applyMatrix4(mouse.matrixWorld);
  anchor.position.copy(_headLocal);
}

/**
 * WoW-style floating name: gold text, dark outline. Renders in CSS2D layer above the WebGL canvas
 * (not depth-tested against level geometry).
 * @param {THREE.Object3D} anchor — scene-level object; call {@link syncNameplateWorldPosition} each frame
 * @param {string} text
 */
export function createPlayerNameplate(anchor, text) {
  const el = document.createElement('div');
  el.className = 'player-nameplate';
  el.textContent = text;
  Object.assign(el.style, {
    fontFamily: '"Palatino Linotype", Palatino, "Times New Roman", Georgia, serif',
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '0.02em',
    color: '#ffdd55',
    textShadow:
      '0 0 2px #000, 0 0 4px #000, 0 1px 2px #000, 1px 1px 0 #0a0604',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  });

  const obj = new CSS2DObject(el);
  obj.position.set(0, 0, 0);
  obj.renderOrder = 999;
  anchor.add(obj);

  let occluded = false;
  let alive = true;
  let visible = true;

  function applyVisual() {
    if (!visible || occluded) {
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = '';
    el.style.opacity = alive ? '1' : '0.4';
    el.style.filter = alive ? 'none' : 'grayscale(0.5)';
  }

  return {
    setText(t) {
      const next = String(t ?? '');
      if (el.textContent !== next) el.textContent = next;
    },
    setAlive(v) {
      alive = !!v;
      applyVisual();
    },
    setVisible(v) {
      visible = !!v;
      applyVisual();
    },
    /** Hide when walls / props block camera line of sight to the name anchor. */
    setOccluded(v) {
      const next = !!v;
      if (next === occluded) return;
      occluded = next;
      applyVisual();
    },
    dispose() {
      anchor.remove(obj);
      el.remove();
    },
  };
}
