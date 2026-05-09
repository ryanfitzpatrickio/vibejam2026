import * as THREE from 'three';
import { PHYSICS } from '../../shared/physics.js';
import {
  VIBE_PORTAL_TRIGGER_RADIUS,
  VIBE_PORTAL_URL,
  getDefaultVibePortalPlacements,
  readVibePortalArrivalFromSearch,
} from '../../shared/vibePortal.js';

const EXIT_COLOR = '#24f0b4';
const START_COLOR = '#ff5a48';
const DEFAULT_PLAYER_COLOR = '#f5a962';
const RETURN_GRACE_SECONDS = 4.0;

function normalizeUrl(value) {
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function getCurrentRef() {
  return window.location.origin;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }

  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function createLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(9, 12, 10, 0.72)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  const radius = 42;
  ctx.beginPath();
  drawRoundRect(ctx, 12, 20, canvas.width - 24, canvas.height - 40, radius);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '800 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPortalGroup({ label, color, position, rotationY = 0 }) {
  const group = new THREE.Group();
  group.name = label.toLowerCase().replace(/\s+/g, '-');
  group.position.set(position.x, position.y + 1.0, position.z);
  group.rotation.y = rotationY;
  group.userData.skipOutline = true;

  const ringGeometry = new THREE.TorusGeometry(0.72, 0.065, 18, 96);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.userData.skipOutline = true;
  group.add(ring);

  const innerGeometry = new THREE.CircleGeometry(0.62, 64);
  const innerMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const inner = new THREE.Mesh(innerGeometry, innerMaterial);
  inner.userData.skipOutline = true;
  inner.position.z = -0.015;
  group.add(inner);

  const particleCount = 96;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.62 + Math.random() * 0.24;
    const base = i * 3;
    positions[base] = Math.cos(angle) * radius;
    positions[base + 1] = Math.sin(angle) * radius;
    positions[base + 2] = (Math.random() - 0.5) * 0.12;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color,
    size: 0.035,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.userData.skipOutline = true;
  group.add(particles);

  const labelTexture = createLabelTexture(label, color);
  const labelMaterial = new THREE.SpriteMaterial({
    map: labelTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const labelSprite = new THREE.Sprite(labelMaterial);
  labelSprite.userData.skipOutline = true;
  labelSprite.position.set(0, 1.0, 0);
  labelSprite.scale.set(1.85, 0.38, 1);
  group.add(labelSprite);

  const glow = new THREE.PointLight(color, 1.1, 3.2, 2);
  glow.userData.skipOutline = true;
  glow.position.set(0, 0, 0.1);
  group.add(glow);

  group.userData.portalParts = {
    ring,
    inner,
    particles,
    positions,
    particleSeeds: Array.from({ length: particleCount }, () => Math.random() * Math.PI * 2),
  };

  return group;
}

function copyForwardedParams(targetParams, sourceParams) {
  for (const [key, value] of sourceParams) {
    if (key === 'ref') continue;
    targetParams.set(key, value);
  }
}

export class VibePortalManager {
  constructor({
    scene,
    getPlayerState,
    getPlayerObject,
    getPlayerColor = () => DEFAULT_PLAYER_COLOR,
    getPortalPlacements = () => getDefaultVibePortalPlacements(),
    search = window.location.search,
  } = {}) {
    this.scene = scene;
    this.getPlayerState = getPlayerState;
    this.getPlayerObject = getPlayerObject;
    this.getPlayerColor = getPlayerColor;
    this.getPortalPlacements = getPortalPlacements;
    this.search = search;
    this.arrival = readVibePortalArrivalFromSearch(search);
    this.redirecting = false;
    this.elapsed = 0;
    this.placements = getDefaultVibePortalPlacements();
    this.placementKey = '';
    this.exitPortal = null;
    this.startPortal = null;
    /** When false, portal meshes stay hidden (logic still runs). */
    this._portalsVisible = true;

    this._syncPortalObjects();
  }

  getPortalsVisible() {
    return this._portalsVisible;
  }

  setPortalsVisible(visible) {
    this._portalsVisible = !!visible;
    if (this.exitPortal) this.exitPortal.visible = this._portalsVisible;
    if (this.startPortal) this.startPortal.visible = this._portalsVisible;
  }

  getArrivalPayload() {
    return this.arrival.active ? this.arrival : null;
  }

  update(deltaSeconds) {
    this.elapsed += deltaSeconds;
    this._syncPortalObjects();
    this._animatePortal(this.exitPortal, deltaSeconds, 1);
    if (this.startPortal) {
      this._animatePortal(this.startPortal, deltaSeconds, -1);
    }
    this._checkTriggers();
  }

  _animatePortal(group, deltaSeconds, direction = 1) {
    if (!group) return;
    const parts = group.userData.portalParts;
    if (parts?.ring) {
      parts.ring.rotation.z += deltaSeconds * 0.75 * direction;
    }
    if (parts?.inner) {
      parts.inner.rotation.z -= deltaSeconds * 1.5 * direction;
      parts.inner.material.opacity = 0.18 + Math.sin(this.elapsed * 4) * 0.045;
    }
    if (parts?.particles) {
      parts.particles.rotation.z += deltaSeconds * 0.55 * direction;
      const array = parts.positions;
      for (let i = 0; i < array.length / 3; i += 1) {
        const base = i * 3;
        const angle = this.elapsed * (1.2 + (i % 5) * 0.08) + parts.particleSeeds[i];
        array[base + 2] = Math.sin(angle) * 0.08;
      }
      parts.particles.geometry.attributes.position.needsUpdate = true;
    }
  }

  _readPortalPlacements() {
    const placements = this.getPortalPlacements?.() ?? getDefaultVibePortalPlacements();
    const defaults = getDefaultVibePortalPlacements();
    return {
      exit: placements.exit ?? defaults.exit,
      return: placements.return ?? defaults.return,
    };
  }

  _getPlacementKey(placements) {
    const parts = [placements.exit, placements.return].map((portal) => [
      portal?.id,
      portal?.name,
      portal?.portalType,
      portal?.position?.x,
      portal?.position?.y,
      portal?.position?.z,
      portal?.rotation?.x,
      portal?.rotation?.y,
      portal?.rotation?.z,
      portal?.triggerRadius,
    ].join(':'));
    return `${parts.join('|')}|arrival:${this.arrival.active ? 1 : 0}|ref:${this.arrival.ref || ''}`;
  }

  _syncPortalObjects() {
    const placements = this._readPortalPlacements();
    const key = this._getPlacementKey(placements);
    if (key === this.placementKey) return;

    this.placementKey = key;
    this.placements = placements;

    this._disposeGroup(this.exitPortal);
    this._disposeGroup(this.startPortal);
    this.exitPortal = createPortalGroup({
      label: placements.exit?.name || 'Vibe Jam Portal',
      color: EXIT_COLOR,
      position: placements.exit.position,
      rotationY: placements.exit.rotation?.y ?? Math.PI,
    });
    this.scene.add(this.exitPortal);
    this.exitPortal.visible = this._portalsVisible;

    this.startPortal = null;
    if (this.arrival.active && this.arrival.ref) {
      this.startPortal = createPortalGroup({
        label: placements.return?.name || 'Return Portal',
        color: START_COLOR,
        position: placements.return.position,
        rotationY: placements.return.rotation?.y ?? 0,
      });
      this.scene.add(this.startPortal);
      this.startPortal.visible = this._portalsVisible;
    }
  }

  _checkTriggers() {
    if (this.redirecting) return;
    const player = this.getPlayerObject?.();
    const playerState = this.getPlayerState?.();
    if (!player || !playerState) return;

    if (this._isInsidePortal(player, this.placements.exit)) {
      this._redirect(this._buildExitUrl(playerState));
      return;
    }

    if (
      this.startPortal
      && this.elapsed >= RETURN_GRACE_SECONDS
      && this._isInsidePortal(player, this.placements.return)
    ) {
      const returnUrl = this._buildReturnUrl(playerState);
      if (returnUrl) this._redirect(returnUrl);
    }
  }

  _isInsidePortal(player, portal) {
    const dx = player.position.x - portal.position.x;
    const dz = player.position.z - portal.position.z;
    const playerMidY = player.position.y + 0.5;
    const portalMidY = portal.position.y + 0.8;
    if (Math.abs(playerMidY - portalMidY) > 1.4) return false;
    return Math.sqrt(dx * dx + dz * dz) <= (portal.triggerRadius ?? VIBE_PORTAL_TRIGGER_RADIUS);
  }

  _buildBaseParams(playerState) {
    const sourceParams = new URLSearchParams(this.search);
    const params = new URLSearchParams();
    copyForwardedParams(params, sourceParams);

    const vx = playerState.velocity?.x ?? 0;
    const vy = playerState.velocity?.y ?? 0;
    const vz = playerState.velocity?.z ?? 0;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const hp = Math.max(1, Math.min(100, Math.round(((playerState.health ?? PHYSICS.maxHealth) / PHYSICS.maxHealth) * 100)));

    params.set('portal', 'true');
    params.set('username', params.get('username') || 'mouse');
    params.set('color', params.get('color') || this.getPlayerColor());
    params.set('speed', speed.toFixed(3));
    params.set('hp', String(hp));
    params.set('speed_x', vx.toFixed(3));
    params.set('speed_y', vy.toFixed(3));
    params.set('speed_z', vz.toFixed(3));
    params.set('rotation_x', '0');
    params.set('rotation_y', (playerState.rotation ?? 0).toFixed(4));
    params.set('rotation_z', '0');
    return params;
  }

  _buildExitUrl(playerState) {
    if (!VIBE_PORTAL_URL) return null;
    const url = new URL(VIBE_PORTAL_URL);
    const params = this._buildBaseParams(playerState);
    params.set('ref', getCurrentRef());
    url.search = params.toString();
    return url.toString();
  }

  _buildReturnUrl(playerState) {
    const url = normalizeUrl(this.arrival.ref);
    if (!url) return null;
    const params = this._buildBaseParams(playerState);
    params.set('ref', getCurrentRef());
    url.search = params.toString();
    return url.toString();
  }

  _redirect(url) {
    if (!url) return;
    this.redirecting = true;
    window.location.href = url;
  }

  dispose() {
    this._disposeGroup(this.exitPortal);
    this._disposeGroup(this.startPortal);
  }

  _disposeGroup(group) {
    if (!group) return;
    group.removeFromParent();
    group.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => this._disposeMaterial(material));
      } else {
        this._disposeMaterial(child.material);
      }
    });
  }

  _disposeMaterial(material) {
    if (!material) return;
    material.map?.dispose?.();
    material.dispose?.();
  }
}
