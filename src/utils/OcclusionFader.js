import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();
const _direction = new THREE.Vector3();
const _savedFadeState = new WeakMap();

function asMaterialArray(material) {
  return Array.isArray(material) ? material : [material];
}

function cloneMaterialSet(material) {
  if (Array.isArray(material)) return material.map((entry) => entry?.clone?.() ?? entry);
  return material?.clone?.() ?? material;
}

function saveAndCloneMaterialForFade(obj) {
  if (_savedFadeState.has(obj)) return _savedFadeState.get(obj);
  const originalMaterial = obj.material;
  const clonedMaterial = cloneMaterialSet(originalMaterial);
  obj.material = clonedMaterial;
  const materials = asMaterialArray(clonedMaterial);
  const state = {
    originalMaterial,
    clonedMaterial,
    opacity: materials.map((m) => m?.opacity ?? 1),
    transparent: materials.map((m) => !!m?.transparent),
    depthWrite: materials.map((m) => m?.depthWrite !== false),
  };
  _savedFadeState.set(obj, state);
  return state;
}

function restoreFadedMaterial(obj) {
  const saved = _savedFadeState.get(obj);
  if (!saved) return;
  const currentMaterials = asMaterialArray(obj.material);
  for (const material of currentMaterials) {
    if (!material) continue;
    // These are per-object fade clones; texture ownership stays with the
    // original shared material, so disposing the clone is safe.
    material.dispose?.();
  }
  obj.material = saved.originalMaterial;
  const originals = asMaterialArray(obj.material);
  for (let i = 0; i < originals.length; i += 1) {
    const material = originals[i];
    if (!material) continue;
    material.opacity = saved.opacity[i] ?? material.opacity;
    material.transparent = saved.transparent[i] ?? material.transparent;
    material.depthWrite = saved.depthWrite[i] ?? material.depthWrite;
    material.needsUpdate = true;
  }
  _savedFadeState.delete(obj);
}

export class OcclusionFader {
  constructor({
    scene,
    camera,
    getPlayer,
    fadeOpacity = 0.15,
    fadeSpeed = 8,
    raycastInterval = 1 / 12,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.getPlayer = getPlayer;
    this.fadeOpacity = fadeOpacity;
    this.fadeSpeed = fadeSpeed;
    this.raycastInterval = Math.max(0, Number(raycastInterval) || 0);
    this.enabled = true;
    this._fading = new Map();
    this._playerSet = new Set();
    this._hitMeshes = new Set();
    this._raycastTimer = 0;
  }

  /** When false, stops updates and restores any meshes still faded. */
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this._restoreAllFades();
      this._hitMeshes.clear();
      this._raycastTimer = 0;
    }
  }

  _restoreAllFades() {
    for (const [obj] of this._fading) {
      restoreFadedMaterial(obj);
    }
    this._fading.clear();
  }

  _scanHitMeshes() {
    const player = this.getPlayer();
    if (!player) return new Set();

    const playerPos = player.position;
    const camPos = this.camera.position;

    this._playerSet.clear();
    player.traverse((child) => {
      if (child.isMesh) this._playerSet.add(child);
    });
    _direction.copy(playerPos).sub(camPos);
    const distance = _direction.length();
    if (distance < 0.001) return new Set();
    _direction.divideScalar(distance);

    _raycaster.set(camPos, _direction);
    _raycaster.far = distance;
    _raycaster.camera = this.camera;

    const hits = _raycaster.intersectObjects(this.scene.children, true);
    const hitMeshes = new Set();

    for (const hit of hits) {
      const obj = hit.object;
      if (!obj.isMesh) continue;
      if (obj.visible === false) continue;
      if (this._playerSet.has(obj)) continue;
      if (obj.userData?.skipFade) continue;
      if (obj.userData?.isFloor) continue;
      if (obj.userData?.surfaceType === 'floor') continue;
      // Match ThirdPersonCamera: props that must not pull the camera arm also should not be x-ray faded.
      if (obj.userData?.cameraOccluder === false) continue;
      if (obj.userData?.runnable === true) continue;

      saveAndCloneMaterialForFade(obj);

      hitMeshes.add(obj);
      if (!this._fading.has(obj)) {
        this._fading.set(obj, { current: 1.0 });
      }
    }

    return hitMeshes;
  }

  update(dt) {
    if (!this.enabled) return;
    const safeDt = Math.max(0, Number(dt) || 0);
    this._raycastTimer -= safeDt;
    if (this._raycastTimer <= 0) {
      this._hitMeshes = this._scanHitMeshes();
      this._raycastTimer = this.raycastInterval;
    }
    const hitMeshes = this._hitMeshes;

    for (const [obj, state] of this._fading) {
      const targetOpacity = hitMeshes.has(obj) ? this.fadeOpacity : 1.0;
      state.current += (targetOpacity - state.current) * Math.min(1, this.fadeSpeed * safeDt);

      const materials = asMaterialArray(obj.material);
      for (const mat of materials) {
        if (!mat) continue;
        mat.transparent = true;
        mat.opacity = state.current;
        mat.depthWrite = state.current > 0.95;
        mat.needsUpdate = true;
      }

      if (state.current >= 0.99 && !hitMeshes.has(obj)) {
        restoreFadedMaterial(obj);
        this._fading.delete(obj);
      }
    }
  }
}
