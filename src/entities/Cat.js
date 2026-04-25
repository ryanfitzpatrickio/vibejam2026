import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Predator } from './Predator.js';
import { MouseEyeAtlasAnimator } from '../animation/MouseEyeAtlasAnimator.js';
import { attachEyesToModel } from '../data/attachEyes.js';
import { assetUrl } from '../utils/assetUrl.js';

const AI_STATE_TO_EXPRESSION = Object.freeze({
  idle: 'idle',
  patrol: 'shifty',
  alert: 'surprised',
  chase: 'angry',
  chase_ball: 'shifty',
  attack: 'angry',
  cooldown: 'shifty',
  stunned: 'shocked',
  roar: 'angry',
  death: 'shocked',
  sleep: 'idle',
  groom: 'idle',
  play: 'shifty',
  bored_wander: 'shifty',
  elevation_search: 'surprised',
});

const LERP_SPEED = 12;
/** Snap instantly when target jumps further than this in one update (teleports, reconnects). */
const HARD_SNAP_DIST = 2.0;
/** Stop interpolating if no fresh server snapshot has arrived in this long (sec). */
const STALE_SNAPSHOT_SEC = 0.6;
/** Floor for the dt fed into the lerp so background-throttled frames still pull aggressively. */
const MIN_LERP_DT = 1 / 30;
/** The cat's Fall clip floats above the floor; lower only the rendered model while stunned. */
const STUNNED_FALL_MODEL_Y_OFFSET = -0.8;

export class Cat extends Predator {
  constructor(options = {}) {
    super({
      name: 'Cat',
      aggroRange: 12,
      attackRange: 1.8,
      leashRange: 24,
      moveSpeed: 3.5,
      chaseSpeed: 6.5,
      turnSpeed: 10,
      attackCooldown: 1.2,
      stunDuration: 1.0,
      alertDuration: 0.5,
      roarDuration: 1.2,
      damage: 1,
      knockbackForce: 8,
      maxHealth: 4,
      patrolRadius: 10,
      radius: 0.5,
      height: 1.6,
      ...options,
    });

    this.eyeAnimator = new MouseEyeAtlasAnimator({
      stateToExpression: AI_STATE_TO_EXPRESSION,
    });

    this._targetPos = new THREE.Vector3();
    this._targetRot = 0;
    this._serverAiState = 'idle';
    this._prevAiState = 'idle';
    /** @type {number} chase vertical phase from server: 0=run, 2=prep jump, 3=air */
    this._chaseVert = 0;
    this._prevChaseVert = -1;
    this._serverAlive = true;
    this._serverHealth = 4;
    this._initialized = false;
    /** Wall-clock time of the most recent applyServerState (ms). */
    this._lastServerAt = 0;
    this._baseModelY = 0;

    this.ready = this._load();
  }

  async _load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(assetUrl('models/cat.glb'));
    this._attachModel(gltf, { height: 1.6, groundOffset: -0.1 });
    this._baseModelY = this.model?.position?.y ?? 0;
    this.playAnimation('Idle', { fadeIn: 0, loop: true });

    try {
      await this.eyeAnimator.load();
      this._attachEyes();
    } catch {
      // eyes unavailable, continue without
    }

    return this;
  }

  _attachEyes() {
    if (!this.eyeAnimator?.loaded || !this.model) return;
    this._eyeUnsub?.();
    this._eyeUnsub = attachEyesToModel('cat', this.eyeAnimator, this.model);
    this.eyeAnimator.setState('idle', { immediate: true });
  }

  dispose() {
    this._eyeUnsub?.();
    this._eyeUnsub = null;
    this.eyeAnimator?.dispose?.();
    super.dispose?.();
  }

  applyServerState(snapshot) {
    if (!snapshot) return;

    this._targetPos.set(snapshot.px ?? 0, snapshot.py ?? 0, snapshot.pz ?? 0);
    this._targetRot = snapshot.ry ?? 0;
    this._serverAiState = snapshot.ai ?? 'idle';
    this._chaseVert = snapshot.cv ?? 0;
    this._serverAlive = snapshot.alive ?? true;
    this._serverHealth = snapshot.hp ?? 0;
    this._lastServerAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (!this._initialized) {
      this._initialized = true;
      this.position.copy(this._targetPos);
      this.rotation.y = this._targetRot;
      return;
    }

    // If the authoritative position jumped a lot in one update (teleport, reconnect,
    // long stall), snap rather than slow-easing. Without this the visual cat lags
    // behind server truth indefinitely once it falls far enough behind.
    const dx = this._targetPos.x - this.position.x;
    const dy = this._targetPos.y - this.position.y;
    const dz = this._targetPos.z - this.position.z;
    if (dx * dx + dy * dy + dz * dz > HARD_SNAP_DIST * HARD_SNAP_DIST) {
      this.position.copy(this._targetPos);
      this.rotation.y = this._targetRot;
    }
  }

  _animateForAiState(aiState) {
    this.eyeAnimator?.setState(aiState);
    if (this.model) {
      this.model.position.y = this._baseModelY
        + (aiState === 'stunned' ? STUNNED_FALL_MODEL_Y_OFFSET : 0);
    }

    switch (aiState) {
      case 'idle':
        this.playAnimation('Idle');
        break;
      case 'patrol':
        this.playAnimation('Walk');
        break;
      case 'alert':
        this.playAnimation('Idle Alert');
        break;
      case 'roar':
        this.playAnimation('Bite', { loop: false, clampWhenFinished: true });
        break;
      case 'chase':
        if ((this._chaseVert ?? 0) >= 2) {
          this.playAnimation('Jump', { loop: true });
        } else {
          this.playAnimation('Run');
        }
        break;
      case 'chase_ball':
        this.playAnimation('Run');
        break;
      case 'attack':
        this.playAnimation('Bite', { loop: false, clampWhenFinished: true });
        break;
      case 'cooldown':
        this.playAnimation('Idle');
        break;
      case 'stunned':
        this.playAnimation('Fall', { loop: false, clampWhenFinished: true });
        break;
      case 'death':
        this.playAnimation('Death', { loop: false, clampWhenFinished: true });
        break;
      case 'sleep':
        this.playAnimation('Idle');
        break;
      case 'groom':
        this.playAnimation('Idle');
        break;
      case 'play':
        this.playAnimation('Run');
        break;
      case 'bored_wander':
        this.playAnimation('Walk');
        break;
      case 'elevation_search':
        this.playAnimation('Jump', { loop: true });
        break;
      default:
        this.playAnimation('Idle');
    }
  }

  update(dt) {
    if (!this.alive && !this._serverAlive) {
      this.mixer?.update(dt);
      this.eyeAnimator?.update(dt);
      return;
    }

    this.alive = this._serverAlive;
    this.health = this._serverHealth;

    if (this._serverAiState !== this._prevAiState) {
      this._prevAiState = this._serverAiState;
      this._prevChaseVert = this._serverAiState === 'chase' ? this._chaseVert : -1;
      this._animateForAiState(this._serverAiState);
    } else if (this._serverAiState === 'chase' && this._chaseVert !== this._prevChaseVert) {
      this._prevChaseVert = this._chaseVert;
      this._animateForAiState('chase');
    }

    if (this._initialized) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const stale = (now - this._lastServerAt) > STALE_SNAPSHOT_SEC * 1000;
      // Freeze interpolation once the snapshot stream goes silent so we don't
      // keep drifting toward an old target during a network hiccup.
      if (!stale) {
        // Floor the dt so background-throttled frames (tiny dt) still pull the
        // visual aggressively toward server truth instead of crawling.
        const lerpDt = Math.max(dt, MIN_LERP_DT);
        const t = 1 - Math.exp(-LERP_SPEED * lerpDt);
        this.position.x += (this._targetPos.x - this.position.x) * t;
        this.position.y += (this._targetPos.y - this.position.y) * t;
        this.position.z += (this._targetPos.z - this.position.z) * t;

        let diff = this._targetRot - this.rotation.y;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        this.rotation.y += diff * t;
      }
    }

    this.mixer?.update(dt);
    this.eyeAnimator?.update(dt);
  }
}
