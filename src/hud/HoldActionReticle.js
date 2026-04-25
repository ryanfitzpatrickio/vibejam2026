import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function createHoldActionReticle({
  keyLabel = 'E',
  actionLabel = 'HOLD',
  color = '#ff7a90',
  glow = 'rgba(255,122,144,0.54)',
  position = { x: 0, y: -0.56, z: 0 },
} = {}) {
  const root = document.createElement('div');
  Object.assign(root.style, {
    width: '78px',
    height: '78px',
    borderRadius: '999px',
    display: 'none',
    position: 'relative',
    pointerEvents: 'none',
    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.5))',
  });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 78 78');
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '78px',
    height: '78px',
    overflow: 'visible',
  });

  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', '39');
  track.setAttribute('cy', '39');
  track.setAttribute('r', '31');
  track.setAttribute('fill', 'rgba(18,13,16,0.58)');
  track.setAttribute('stroke', 'rgba(255,255,255,0.22)');
  track.setAttribute('stroke-width', '8');

  const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fill.setAttribute('cx', '39');
  fill.setAttribute('cy', '39');
  fill.setAttribute('r', '31');
  fill.setAttribute('fill', 'none');
  fill.setAttribute('stroke', color);
  fill.setAttribute('stroke-width', '8');
  fill.setAttribute('stroke-linecap', 'round');
  fill.setAttribute('pathLength', '100');
  fill.setAttribute('stroke-dasharray', '0 100');
  fill.style.transform = 'rotate(-90deg)';
  fill.style.transformOrigin = '39px 39px';

  svg.append(track, fill);

  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '52px',
    height: '52px',
    borderRadius: '999px',
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'linear-gradient(180deg, rgba(54,31,36,0.88), rgba(22,13,16,0.84))',
    border: '2px solid rgba(255,255,255,0.78)',
    color: '#fff4d7',
    font: '900 17px "Fredoka", "Baloo", system-ui, sans-serif',
    textShadow: '0 2px 0 #25100b',
    display: 'grid',
    placeItems: 'center',
    lineHeight: '0.9',
  });

  const key = document.createElement('div');
  key.textContent = keyLabel;
  Object.assign(key.style, {
    fontSize: '20px',
    letterSpacing: '0.02em',
  });

  const action = document.createElement('div');
  action.textContent = actionLabel;
  Object.assign(action.style, {
    fontSize: '8px',
    letterSpacing: '0.1em',
    marginTop: '-6px',
    color,
  });

  inner.append(key, action);
  root.append(svg, inner);

  const label = new CSS2DObject(root);
  label.position.set(position.x ?? 0, position.y ?? -0.56, position.z ?? 0);
  label.visible = false;

  function setVisible(visible) {
    label.visible = !!visible;
    root.style.display = visible ? 'flex' : 'none';
  }

  return {
    label,
    root,
    setVisible,
    update({
      visible = true,
      progress = 0,
      keyLabel: nextKeyLabel = keyLabel,
      actionLabel: nextActionLabel = actionLabel,
    } = {}) {
      const pct = Math.round(clamp01(progress) * 100);
      setVisible(visible);
      if (!visible) return;
      fill.setAttribute('stroke-dasharray', `${pct} 100`);
      key.textContent = pct >= 100 ? 'GO' : nextKeyLabel;
      action.textContent = pct >= 100 ? 'RELEASE' : nextActionLabel;
      root.style.boxShadow = `0 0 ${12 + pct * 0.26}px ${glow}`;
      root.style.transform = `scale(${1 + Math.sin(clamp01(progress) * Math.PI) * 0.06})`;
    },
    dispose() {
      label.removeFromParent?.();
      root.remove();
    },
  };
}
