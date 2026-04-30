import * as THREE from 'three';
import { DRONE_PURCHASE_CHEESE_COST, isDeviceScreenPrimitive } from '../../shared/deviceScreens.js';

const SCREEN_RANGE = 2.8;
const BUTTON = Object.freeze({ x: 0.18, y: 0.62, w: 0.64, h: 0.2 });

function pointInRect(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function statusText(net) {
  const message = net?.dronePurchase?.message;
  if (message) return message;
  const cheese = Math.max(0, Math.floor(Number(net?.serverState?.cheeseCarried) || 0));
  return cheese >= DRONE_PURCHASE_CHEESE_COST
    ? 'Drone delivery ready'
    : `Carry ${DRONE_PURCHASE_CHEESE_COST} cheese to buy`;
}

export class DeviceScreenController {
  constructor({ camera, canvas, room, net, getPlayer }) {
    this.camera = camera;
    this.canvas = canvas;
    this.room = room;
    this.net = net;
    this.getPlayer = getPlayer;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerClient = { x: 0, y: 0 };
    this.screens = new Map();
    this.hover = null;
    this._onPointerMove = (event) => {
      this.pointerClient.x = event.clientX;
      this.pointerClient.y = event.clientY;
    };
    this._onPointerDown = (event) => {
      if (event.button !== 0 || !this.hover?.uv || !pointInRect(this.hover.uv, BUTTON)) return;
      event.preventDefault();
      this.net?.sendDronePurchase?.();
      this._drawAll();
    };
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', this._onPointerDown);
  }

  _syncScreens() {
    const layout = this.room?.editableLayout;
    const primitives = Array.isArray(layout?.primitives) ? layout.primitives : [];
    const seen = new Set();
    for (const primitive of primitives) {
      if (!isDeviceScreenPrimitive(primitive)) continue;
      const mesh = this.room?.editableMeshes?.get?.(primitive.id);
      if (!mesh?.isMesh) continue;
      seen.add(primitive.id);
      if (!this.screens.has(primitive.id)) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 320;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        this.screens.set(primitive.id, {
          id: primitive.id,
          mesh,
          canvas,
          ctx: canvas.getContext('2d'),
          texture,
          material,
          originalMaterial: mesh.material,
          cursor: { x: 0.5, y: 0.5 },
        });
        mesh.material = material;
        mesh.userData.deviceScreen = true;
      } else {
        const screen = this.screens.get(primitive.id);
        screen.mesh = mesh;
        if (mesh.material !== screen.material) {
          screen.originalMaterial = mesh.material;
          mesh.material = screen.material;
        }
      }
    }
    for (const [id, screen] of this.screens) {
      if (seen.has(id)) continue;
      if (screen.mesh?.material === screen.material) screen.mesh.material = screen.originalMaterial;
      screen.material.dispose();
      screen.texture.dispose();
      this.screens.delete(id);
    }
  }

  _updatePointerNdc() {
    const rect = this.canvas.getBoundingClientRect();
    const locked = document.pointerLockElement === this.canvas;
    const x = locked ? rect.left + rect.width * 0.5 : this.pointerClient.x;
    const y = locked ? rect.top + rect.height * 0.5 : this.pointerClient.y;
    this.pointer.x = ((x - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(((y - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  }

  _findHover() {
    const player = this.getPlayer?.();
    if (!player?.position || this.screens.size <= 0) return null;
    this._updatePointerNdc();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects([...this.screens.values()].map((s) => s.mesh), false);
    for (const hit of intersects) {
      const screen = [...this.screens.values()].find((entry) => entry.mesh === hit.object);
      if (!screen || !hit.uv) continue;
      const wp = new THREE.Vector3();
      screen.mesh.getWorldPosition(wp);
      if (wp.distanceTo(player.position) > SCREEN_RANGE) continue;
      screen.cursor = { x: hit.uv.x, y: 1 - hit.uv.y };
      return { screen, uv: screen.cursor };
    }
    return null;
  }

  _draw(screen, active) {
    const ctx = screen.ctx;
    if (!ctx) return;
    const w = screen.canvas.width;
    const h = screen.canvas.height;
    const cursor = screen.cursor;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#07111f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0e2438';
    ctx.fillRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = '#72f6d1';
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText('NEST WEB', 42, 62);
    ctx.fillStyle = '#f7e7a3';
    ctx.font = '700 36px system-ui, sans-serif';
    ctx.fillText('Drone Drop', 42, 114);
    ctx.fillStyle = '#dbeafe';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(`Cost: ${DRONE_PURCHASE_CHEESE_COST} carried cheese`, 42, 152);
    ctx.fillText(statusText(this.net), 42, 184);

    const bx = BUTTON.x * w;
    const by = BUTTON.y * h;
    const bw = BUTTON.w * w;
    const bh = BUTTON.h * h;
    const overButton = active && pointInRect(cursor, BUTTON);
    ctx.fillStyle = overButton ? '#f8cf5a' : '#39d8a8';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#fff7c2';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#07111f';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText('BUY NEXT-ROUND DRONE', bx + 22, by + 42);

    if (active) {
      const cx = cursor.x * w;
      const cy = cursor.y * h;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();
    }
    screen.texture.needsUpdate = true;
  }

  _drawAll() {
    for (const screen of this.screens.values()) {
      this._draw(screen, this.hover?.screen === screen);
    }
  }

  update() {
    this._syncScreens();
    this.hover = this._findHover();
    this._drawAll();
  }

  dispose() {
    window.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    for (const screen of this.screens.values()) {
      if (screen.mesh?.material === screen.material) screen.mesh.material = screen.originalMaterial;
      screen.material.dispose();
      screen.texture.dispose();
    }
    this.screens.clear();
  }
}
