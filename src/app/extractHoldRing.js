import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export function createExtractHoldRing() {
  const root = document.createElement('div');
  Object.assign(root.style, {
    width: '74px',
    height: '74px',
    borderRadius: '999px',
    display: 'none',
    position: 'relative',
    pointerEvents: 'none',
    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.5))',
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 74 74');
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '74px',
    height: '74px',
    overflow: 'visible',
  });
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', '37');
  track.setAttribute('cy', '37');
  track.setAttribute('r', '30');
  track.setAttribute('fill', 'rgba(18,13,8,0.54)');
  track.setAttribute('stroke', 'rgba(255,255,255,0.2)');
  track.setAttribute('stroke-width', '8');
  const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fill.setAttribute('cx', '37');
  fill.setAttribute('cy', '37');
  fill.setAttribute('r', '30');
  fill.setAttribute('fill', 'none');
  fill.setAttribute('stroke', '#fff176');
  fill.setAttribute('stroke-width', '8');
  fill.setAttribute('stroke-linecap', 'round');
  fill.setAttribute('pathLength', '100');
  fill.setAttribute('stroke-dasharray', '0 100');
  fill.style.transform = 'rotate(-90deg)';
  fill.style.transformOrigin = '37px 37px';
  svg.append(track, fill);
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '48px',
    height: '48px',
    borderRadius: '999px',
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(33,22,12,0.7)',
    border: '2px solid rgba(255,255,255,0.78)',
    color: '#fff7c2',
    font: '900 18px "Fredoka", "Baloo", system-ui, sans-serif',
    textShadow: '0 2px 0 #25100b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  inner.textContent = 'E';
  root.appendChild(svg);
  root.appendChild(inner);
  const label = new CSS2DObject(root);
  label.position.set(0, -0.56, 0);
  label.visible = false;
  return { root, fill, inner, label };
}

export function updateExtractHoldRing(ring, visible, progress) {
  ring.label.visible = !!visible;
  ring.root.style.display = visible ? 'flex' : 'none';
  if (!visible) return;
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const pct = Math.round(safeProgress * 100);
  ring.fill.setAttribute('stroke-dasharray', `${pct} 100`);
  ring.root.style.boxShadow = `0 0 ${12 + safeProgress * 24}px rgba(255,241,118,0.52)`;
  ring.inner.textContent = `${pct}%`;
}

export function hideExtractHoldRing(ring) {
  ring.label.visible = false;
  ring.root.style.display = 'none';
}
