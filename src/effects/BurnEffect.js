import * as THREE from 'three';

const FIRE_LIFETIME = 0.34;
const SMOKE_LIFETIME = 1.15;

let _fireTexture = null;
let _smokeTexture = null;

function makeRadialTexture(stops) {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getFireTexture() {
  if (!_fireTexture) {
    _fireTexture = makeRadialTexture([
      [0, 'rgba(255, 255, 190, 1)'],
      [0.22, 'rgba(255, 135, 34, 0.95)'],
      [0.62, 'rgba(255, 30, 10, 0.45)'],
      [1, 'rgba(80, 0, 0, 0)'],
    ]);
  }
  return _fireTexture;
}

function getSmokeTexture() {
  if (!_smokeTexture) {
    _smokeTexture = makeRadialTexture([
      [0, 'rgba(225, 225, 225, 0.6)'],
      [0.48, 'rgba(90, 90, 90, 0.3)'],
      [1, 'rgba(20, 20, 20, 0)'],
    ]);
  }
  return _smokeTexture;
}

export class BurnEffect {
  constructor(scene, worldPos) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'BurnEffect';
    this.group.position.copy(worldPos);
    scene.add(this.group);

    this.active = true;
    this._fireTimer = 0;
    this._smokeTimer = 0;
    this._flames = [];
    this._smoke = [];
  }

  setPosition(worldPos) {
    this.group.position.copy(worldPos);
  }

  setActive(active) {
    this.active = active === true;
  }

  _spawnFlame() {
    const material = new THREE.SpriteMaterial({
      map: getFireTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set((Math.random() - 0.5) * 0.34, 0.1 + Math.random() * 0.28, (Math.random() - 0.5) * 0.34);
    sprite.scale.setScalar(0.28 + Math.random() * 0.18);
    this.group.add(sprite);
    this._flames.push({
      sprite,
      material,
      age: 0,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.65 + Math.random() * 0.3, (Math.random() - 0.5) * 0.25),
    });
  }

  _spawnSmoke() {
    const material = new THREE.SpriteMaterial({
      map: getSmokeTexture(),
      color: 0xb0aaa0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set((Math.random() - 0.5) * 0.22, 0.35 + Math.random() * 0.22, (Math.random() - 0.5) * 0.22);
    sprite.scale.setScalar(0.22 + Math.random() * 0.12);
    this.group.add(sprite);
    this._smoke.push({
      sprite,
      material,
      age: 0,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.18, 0.5 + Math.random() * 0.24, (Math.random() - 0.5) * 0.18),
    });
  }

  update(dt) {
    if (this.active) {
      this._fireTimer -= dt;
      while (this._fireTimer <= 0) {
        this._fireTimer += 0.055;
        this._spawnFlame();
      }
      this._smokeTimer -= dt;
      if (this._smokeTimer <= 0) {
        this._smokeTimer = 0.18;
        this._spawnSmoke();
      }
    }

    for (let i = this._flames.length - 1; i >= 0; i -= 1) {
      const flame = this._flames[i];
      flame.age += dt;
      flame.sprite.position.addScaledVector(flame.vel, dt);
      const t = flame.age / FIRE_LIFETIME;
      flame.sprite.scale.multiplyScalar(1 + dt * 1.7);
      flame.material.opacity = Math.max(0, 1 - t);
      if (flame.age >= FIRE_LIFETIME) {
        this.group.remove(flame.sprite);
        flame.material.dispose();
        this._flames.splice(i, 1);
      }
    }

    for (let i = this._smoke.length - 1; i >= 0; i -= 1) {
      const puff = this._smoke[i];
      puff.age += dt;
      puff.sprite.position.addScaledVector(puff.vel, dt);
      const t = puff.age / SMOKE_LIFETIME;
      puff.sprite.scale.setScalar(0.2 + 0.48 * t);
      puff.material.opacity = Math.max(0, 0.5 * (1 - t));
      if (puff.age >= SMOKE_LIFETIME) {
        this.group.remove(puff.sprite);
        puff.material.dispose();
        this._smoke.splice(i, 1);
      }
    }
  }

  get finished() {
    return !this.active && this._flames.length === 0 && this._smoke.length === 0;
  }

  dispose() {
    for (const flame of this._flames) {
      this.group.remove(flame.sprite);
      flame.material.dispose();
    }
    for (const puff of this._smoke) {
      this.group.remove(puff.sprite);
      puff.material.dispose();
    }
    this._flames.length = 0;
    this._smoke.length = 0;
    this.scene.remove(this.group);
  }
}
