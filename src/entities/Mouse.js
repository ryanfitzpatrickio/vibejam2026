import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MouseAnimationManager } from '../animation/MouseAnimationManager.js';
import { MouseEyeAtlasAnimator } from '../animation/MouseEyeAtlasAnimator.js';
import { assetUrl } from '../utils/assetUrl.js';

const IS_MOBILE = typeof navigator !== 'undefined'
  && (navigator.maxTouchPoints > 0 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));

function applyCommonProps(material, sourceMaterial) {
  material.map = sourceMaterial?.map ?? null;
  material.alphaMap = sourceMaterial?.alphaMap ?? null;
  material.alphaTest = sourceMaterial?.alphaTest ?? material.alphaTest;
  material.transparent = sourceMaterial?.transparent ?? material.transparent;
  material.opacity = sourceMaterial?.opacity ?? material.opacity;
  material.side = sourceMaterial?.side ?? material.side;
  material.skinning = sourceMaterial?.skinning ?? false;
  material.morphTargets = sourceMaterial?.morphTargets ?? false;
  material.morphNormals = sourceMaterial?.morphNormals ?? false;
  material.depthTest = sourceMaterial?.depthTest ?? material.depthTest;
  material.depthWrite = sourceMaterial?.depthWrite ?? material.depthWrite;
  material.fog = false;
  return material;
}

function createLitAvatarMaterial(sourceMaterial) {
  const baseColor = sourceMaterial?.color?.clone?.() ?? new THREE.Color(sourceMaterial?.color ?? '#ffffff');
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: sourceMaterial?.roughness ?? 0.65,
    metalness: sourceMaterial?.metalness ?? 0.0,
  });
  material.flatShading = false;
  applyCommonProps(material, sourceMaterial);
  material.needsUpdate = true;
  return material;
}

function cloneMaterialSet(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => entry?.clone?.() ?? entry);
  }

  return material?.clone?.() ?? material;
}

/**
 * Mouse character: procedural mesh + animation system
 * Sized appropriately for human/mouse scale interaction with room furniture
 */
export class Mouse extends THREE.Group {
  constructor(options = {}) {
    super();
    this.name = 'Mouse';

    // Customization
    this.furColor = options.furColor ?? '#f5a962';
    this.bellyColor = options.bellyColor ?? '#f8d4b0';
    this.eyeColor = options.eyeColor ?? '#000000';
    this.noseColor = options.noseColor ?? '#ff8866';
    this.scale.set(0.6, 0.6, 0.6); // Small relative to room
    this.groundOffset = options.groundOffset ?? 0.35;

    // Animation state
    this.animationState = 'idle';
    this.carryingItem = null;
    this.targetPosition = new THREE.Vector3();
    this.targetRotation = new THREE.Euler();
    this.yaw = 0;

    // Body parts (stored for animation access)
    this.parts = {};

    // Animation parameters
    this.animationTime = 0;
    this.animationSpeed = 1.0;
    this.blendFactor = 0.0; // For smooth transitions

    this.avatar = null;
    // Pivot that can be pitched/rolled for parkour lean without being clobbered
    // by the AnimationMixer. Populated when the GLB avatar loads.
    this.bodyPivot = null;
    this.animationManager = new MouseAnimationManager({
      fadeDuration: options.fadeDuration,
    });
    this.eyeAnimator = new MouseEyeAtlasAnimator({
      atlasUrl: options.eyeAtlasUrl ?? assetUrl('eyeset1.optimized.webp'),
    });
    this._usingModel = false;
    this._ready = false;
    this.viewCamera = null;
    this._occlusionOpacity = 1;
    this._fadeMaterials = new Map();

    // Build the primitive mouse immediately so the first frame renders with a
    // visible character. The skinned GLB streams in behind the scenes and
    // replaces the primitives when it finishes loading.
    this.buildMouse();

    this.ready = this._loadAvatar();
  }

  async _loadAvatar() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const modelUrls = [assetUrl('mouse-skinned.optimized.glb')];

    for (const modelUrl of modelUrls) {
      try {
        const gltf = await loader.loadAsync(modelUrl);
        this._teardownPrimitiveParts();
        this._attachAvatar(gltf);
        break;
      } catch {
        continue;
      }
    }

    try {
      await this.eyeAnimator.load();
      this._attachEyeAtlas();
    } catch {
      // Keep the fallback eye meshes if the atlas is unavailable.
    }

    this._ready = true;
    return this;
  }

  _teardownPrimitiveParts() {
    if (this._usingModel) return;
    for (const key of Object.keys(this.parts)) {
      const part = this.parts[key];
      if (!part) continue;
      this.remove(part);
      if (part.geometry?.dispose) part.geometry.dispose();
      const mat = part.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m?.dispose?.();
      } else {
        mat?.dispose?.();
      }
    }
    this.parts = {};
  }

  _attachAvatar(gltf) {
    this._usingModel = true;
    this.groundOffset = 0.02;
    this.avatar = gltf.scene;
    this.avatar.name = 'MouseAvatar';
    this.avatar.traverse((child) => {
      if (child.isMesh) {
        const sourceMaterial = cloneMaterialSet(child.material);
        child.userData.avatarSourceMaterial = sourceMaterial;
        child.material = cloneMaterialSet(sourceMaterial);
        child.castShadow = true;
        child.receiveShadow = false;
        child.frustumCulled = false;
      }
    });

    const box = new THREE.Box3().setFromObject(this.avatar);
    this.avatar.position.y = -box.min.y;
    // Wrap the animated avatar in a pivot group so external code can apply
    // body lean / climb rotations without fighting the AnimationMixer writing
    // back to the avatar root's quaternion each frame.
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.name = 'MouseBodyPivot';
    this.bodyPivot.add(this.avatar);
    this.add(this.bodyPivot);

    this.animationManager.attach(this.avatar, gltf.animations);
    this._applyLitMaterialsToAvatar();
    this._collectFadeMaterials();
    this.animationManager.setState(this.animationState, { immediate: true });
  }

  _applyLitMaterialsToAvatar() {
    if (!this._usingModel || !this.avatar) return;

    const materialCache = new Map();
    this.avatar.traverse((child) => {
      if (!child.isMesh || !child.material) return;

      const sourceMaterialSet = child.userData.avatarSourceMaterial ?? child.material;
      const sourceMaterials = Array.isArray(sourceMaterialSet) ? sourceMaterialSet : [sourceMaterialSet];
      const converted = sourceMaterials.map((material) => {
        if (!material) return material;
        if (materialCache.has(material)) return materialCache.get(material);

        const nextMaterial = createLitAvatarMaterial(material);
        materialCache.set(material, nextMaterial);
        return nextMaterial;
      });

      child.material = Array.isArray(sourceMaterialSet) ? converted : converted[0];
    });
  }

  _collectFadeMaterials() {
    this._fadeMaterials.clear();

    this.traverse((child) => {
      if (!child.isMesh || child.userData?.skipOutline) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material || this._fadeMaterials.has(material)) return;
        this._fadeMaterials.set(material, {
          opacity: material.opacity ?? 1,
          transparent: material.transparent ?? false,
          depthWrite: material.depthWrite ?? true,
          alphaHash: material.alphaHash ?? false,
        });
      });
    });
  }

  setOcclusionOpacity(opacity = 1) {
    this._occlusionOpacity = 1;
    this._fadeMaterials.forEach((state, material) => {
      const renderStateChanged = material.alphaHash !== state.alphaHash
        || material.transparent !== state.transparent
        || material.depthWrite !== state.depthWrite;

      material.opacity = state.opacity;
      material.alphaHash = state.alphaHash;
      material.transparent = state.transparent;
      material.depthWrite = state.depthWrite;
      if (renderStateChanged) {
        material.needsUpdate = true;
      }
    });

    this.eyeAnimator?.setOpacity(1);
  }

  _attachEyeAtlas() {
    if (!this.eyeAnimator?.loaded) return;
    this.eyeAnimator.setViewCamera(this.viewCamera);

    const anchor = this._usingModel
      ? (this.avatar?.getObjectByName('Head') ?? this.avatar)
      : (this.parts.head ?? this);

    if (!anchor) return;

    const hideTargets = this._usingModel
      ? []
      : [this.parts.eyeLeft, this.parts.eyeRight, this.parts.pupilLeft, this.parts.pupilRight];

    const placement = this._usingModel
      ? { hideTargets }
      : {
        localOffset: new THREE.Vector3(0, 0.03, 0.14),
        eyeSize: 0.14,
        hideTargets,
      };

    this.eyeAnimator.attach(anchor, placement);
    this.eyeAnimator.setOpacity(this._occlusionOpacity);
    this.eyeAnimator.setState(this.animationState, { immediate: true });
  }

  setViewCamera(camera) {
    this.viewCamera = camera ?? null;
    this.eyeAnimator?.setViewCamera(this.viewCamera);
  }

  buildMouse() {
    // Materials
    const furMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.furColor),
      roughness: 0.65,
      metalness: 0.0,
      fog: false,
    });

    const bellyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.bellyColor),
      roughness: 0.65,
      metalness: 0.0,
      fog: false,
    });

    const eyeMat = new THREE.MeshStandardMaterial({
      color: this.eyeColor,
      metalness: 0.5,
      roughness: 0.2,
      emissive: '#222222',
      fog: false,
    });

    const noseMat = new THREE.MeshStandardMaterial({
      color: this.noseColor,
      metalness: 0.3,
      roughness: 0.3,
      fog: false,
    });

    // BODY: elongated torso aligned forward (+Z)
    const bodyGeo = new THREE.CapsuleGeometry(0.26, 0.9, 10, 12);
    const body = new THREE.Mesh(bodyGeo, furMat);
    body.position.y = -0.03;
    body.rotation.x = Math.PI * 0.5;
    body.name = 'Body';
    this.add(body);
    this.parts.body = body;

    // BELLY: lighter underbelly panel
    const bellyGeo = new THREE.CapsuleGeometry(0.2, 0.65, 8, 8);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, -0.1, 0.14);
    belly.rotation.x = Math.PI * 0.5;
    belly.scale.z = 0.62;
    belly.name = 'Belly';
    this.add(belly);
    this.parts.belly = belly;

    // HEAD: compact forward head
    const headGeo = new THREE.SphereGeometry(0.29, 16, 12);
    const head = new THREE.Mesh(headGeo, furMat);
    head.position.set(0, 0.02, 0.73);
    head.name = 'Head';
    this.add(head);
    this.parts.head = head;

    // EARS: smaller and less exaggerated
    const earGeo = new THREE.ConeGeometry(0.12, 0.35, 10);
    const earLeft = new THREE.Mesh(earGeo, furMat);
    earLeft.position.set(-0.16, 0.23, 0.72);
    earLeft.rotation.set(0.18, 0, 0.22);
    earLeft.name = 'EarLeft';
    this.add(earLeft);
    this.parts.earLeft = earLeft;

    const earRight = new THREE.Mesh(earGeo, furMat);
    earRight.position.set(0.16, 0.23, 0.72);
    earRight.rotation.set(0.18, 0, -0.22);
    earRight.name = 'EarRight';
    this.add(earRight);
    this.parts.earRight = earRight;

    // EYES: smaller and placed on the front half of the head
    const eyeGeo = new THREE.SphereGeometry(0.08, 12, 8);
    const eyeLeft = new THREE.Mesh(eyeGeo, eyeMat);
    eyeLeft.position.set(-0.12, 0.08, 0.95);
    eyeLeft.name = 'EyeLeft';
    eyeLeft.userData.skipOutline = true;
    this.add(eyeLeft);
    this.parts.eyeLeft = eyeLeft;

    const eyeRight = new THREE.Mesh(eyeGeo, eyeMat);
    eyeRight.position.set(0.12, 0.08, 0.95);
    eyeRight.name = 'EyeRight';
    eyeRight.userData.skipOutline = true;
    this.add(eyeRight);
    this.parts.eyeRight = eyeRight;

    // PUPILS: glossy highlights for expression
    const pupilGeo = new THREE.SphereGeometry(0.035, 8, 6);
    const pupilMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      metalness: 0.8,
      roughness: 0.1,
      emissive: '#ffffff',
      emissiveIntensity: 0.3,
      transparent: true,
      fog: false,
    });

    const pupilLeft = new THREE.Mesh(pupilGeo, pupilMat);
    pupilLeft.position.set(-0.12, 0.08, 1.01);
    pupilLeft.name = 'PupilLeft';
    pupilLeft.userData.skipOutline = true;
    this.add(pupilLeft);
    this.parts.pupilLeft = pupilLeft;

    const pupilRight = new THREE.Mesh(pupilGeo, pupilMat);
    pupilRight.position.set(0.12, 0.08, 1.01);
    pupilRight.name = 'PupilRight';
    pupilRight.userData.skipOutline = true;
    this.add(pupilRight);
    this.parts.pupilRight = pupilRight;

    // NOSE: more compact front tip
    const noseGeo = new THREE.SphereGeometry(0.08, 8, 6);
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, 0.01, 1.07);
    nose.name = 'Nose';
    this.add(nose);
    this.parts.nose = nose;

    // TAIL: slender and attached to rear of body
    const tailGeo = new THREE.TubeGeometry(
      new THREE.LineCurve3(
        new THREE.Vector3(0, -0.12, -0.6),
        new THREE.Vector3(0.18, -0.2, -1.25),
      ),
      8,
      0.055,
      8,
    );
    const tail = new THREE.Mesh(tailGeo, furMat);
    tail.name = 'Tail';
    this.add(tail);
    this.parts.tail = tail;

    // LEGS: four short vertical legs
    const legGeo = new THREE.CapsuleGeometry(0.065, 0.24, 6, 6);
    const legPositions = [
      { x: -0.17, z: 0.35 }, // front left
      { x: 0.17, z: 0.35 }, // front right
      { x: -0.19, z: -0.34 }, // back left
      { x: 0.19, z: -0.34 }, // back right
    ];

    legPositions.forEach((pos, i) => {
      const leg = new THREE.Mesh(legGeo, furMat);
      leg.position.set(pos.x, -0.34, pos.z);
      leg.name = `Leg${i}`;
      this.add(leg);
      this.parts[`leg${i}`] = leg;
    });

    this.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    this._collectFadeMaterials();
    this.setOcclusionOpacity(this._occlusionOpacity);
  }

  /**
   * Set animation state and trigger transition
   */
  setAnimationState(newState) {
    if (this.animationState !== newState) {
      this.animationState = newState;
      this.animationTime = 0;
      this.blendFactor = 0;
      if (this._usingModel) {
        this.animationManager?.setState(newState);
      }
    }

    this.eyeAnimator?.setState(newState);
  }

  /**
   * Check current animation state
   */
  getAnimationState() {
    return this.animationState;
  }

  playEyeOneShot(expression, options) {
    return this.eyeAnimator?.playOneShot?.(expression, options) ?? false;
  }

  /**
   * Update animation based on state and time
   */
  update(deltaTime = 0.016) {
    if (this._usingModel) {
      this.animationManager?.update(deltaTime);
    } else {
      this.animationTime += deltaTime * this.animationSpeed;

      // Update animation based on current state
      switch (this.animationState) {
        case 'idle':
          this.animateIdle();
          break;
        case 'run':
          this.animateRun();
          break;
        case 'jump':
          this.animateJump();
          break;
        case 'chew':
          this.animateChew();
          break;
        case 'carry':
          this.animateCarry();
          break;
        case 'win':
          this.animateCarry();
          break;
        case 'death':
          this.animateDeath(deltaTime);
          break;
      }
    }

    this.eyeAnimator?.update(deltaTime);

    // Update carried item position if present
    if (this.carryingItem) {
      this.updateCarriedItem();
    }
  }

  /**
   * IDLE: Subtle breathing and weight shift
   */
  animateIdle() {
    const t = this.animationTime;
    const bob = Math.sin(t * 2) * 0.05;
    const sway = Math.sin(t * 0.8) * 0.08;

    // Body breathing
    this.parts.body.position.y = bob;
    this.parts.belly.position.y = bob;
    this.parts.head.position.y = bob + 0.02;

    // Head rotation sway
    this.parts.head.rotation.z = sway * 0.3;

    // Tail sway
    this.parts.tail.rotation.y = sway;

    // Ears wiggle
    this.parts.earLeft.rotation.x = Math.sin(t * 3) * 0.1;
    this.parts.earRight.rotation.x = Math.sin(t * 3 + Math.PI) * 0.1;

    // Eye blink (simple opacity)
    const blink = Math.max(0, Math.sin(t * 1.5));
    [this.parts.pupilLeft, this.parts.pupilRight].forEach((eye) => {
      eye.material.opacity = blink;
    });
  }

  /**
   * RUN: Full body motion - leg cycle, body bob, tail swish
   */
  animateRun() {
    const t = this.animationTime * 2; // Faster
    const legCycle = Math.sin(t) * 0.3;
    const legCycle2 = Math.sin(t + Math.PI) * 0.3;
    const bodyBob = Math.abs(Math.sin(t * 0.5)) * 0.15;
    const tailSwish = Math.sin(t) * 0.5;

    // Legs: alternating cycle
    this.parts.leg0.rotation.x = legCycle;
    this.parts.leg1.rotation.x = legCycle2;
    this.parts.leg2.rotation.x = legCycle2;
    this.parts.leg3.rotation.x = legCycle;

    // Body bob and lean
    this.parts.body.position.y = bodyBob;
    this.parts.body.rotation.z = Math.sin(t) * 0.15;

    // Head forward lean
    this.parts.head.rotation.x = 0.2;
    this.parts.head.position.y = bodyBob;

    // Tail active swish
    this.parts.tail.rotation.y = tailSwish;
    this.parts.tail.rotation.x = Math.sin(t) * 0.3;
  }

  /**
   * JUMP: Tuck and stretch
   */
  animateJump() {
    const t = this.animationTime;
    let jumpPhase;

    if (t < 0.3) {
      // Crouch phase
      jumpPhase = t / 0.3;
    } else if (t < 0.7) {
      // Air phase
      jumpPhase = 1.0;
    } else if (t < 1.0) {
      // Land phase
      jumpPhase = 1.0 - (t - 0.7) / 0.3;
    } else {
      // Return to idle
      this.setAnimationState('idle');
      return;
    }

    // Crouch tuck
    const tuck = (1.0 - jumpPhase) * 0.4;
    this.parts.body.scale.y = 1.0 - tuck;
    this.parts.body.position.y = -tuck * 0.2;

    // Head tuck
    this.parts.head.position.z = 0.65 - tuck * 0.3;

    // Legs curl
    [0, 1, 2, 3].forEach((i) => {
      this.parts[`leg${i}`].rotation.x = -tuck * 1.5;
    });

    // Jump upward arc
    const jumpHeight = jumpPhase * 0.8;
    this.position.y = jumpHeight;

    // Stretch on landing
    this.parts.body.scale.y = 1.0 + jumpPhase * 0.1;
  }

  /**
   * CHEW: Head bobbing, jaw-like motion
   */
  animateChew() {
    const t = this.animationTime * 3;
    const chewBob = Math.sin(t) * 0.12;
    const chewTilt = Math.sin(t * 0.7) * 0.2;

    // Head vertical bob
    this.parts.head.position.y = chewBob;

    // Head tilt side to side
    this.parts.head.rotation.x = chewTilt;

    // Nose wrinkle
    this.parts.nose.scale.x = 1.0 + Math.sin(t) * 0.15;

    // Ears twitch
    this.parts.earLeft.rotation.x = Math.sin(t) * 0.15;
    this.parts.earRight.rotation.x = Math.sin(t + 0.5) * 0.15;

    // Tail sway
    this.parts.tail.rotation.y = Math.sin(t * 0.5) * 0.3;
  }

  /**
   * CARRY: Item positioned on back or in mouth
   */
  animateCarry() {
    const t = this.animationTime;
    const idleBob = Math.sin(t * 2) * 0.04;

    // Idle-like but with slight forward lean
    this.parts.body.position.y = idleBob;
    this.parts.body.rotation.x = 0.1;
    this.parts.head.rotation.x = 0.15;

    // Tail curled
    this.parts.tail.rotation.y = 0.3;
    this.parts.tail.rotation.z = 0.2;

    // Back legs slightly bent (carrying weight)
    this.parts.leg2.rotation.x = -0.2;
    this.parts.leg3.rotation.x = -0.2;
  }

  /**
   * DEATH: Ragdoll tumble
   */
  animateDeath(deltaTime = 0.016) {
    const t = this.animationTime;

    // Spin and tumble
    this.rotation.x += 6.0 * deltaTime;
    this.rotation.y += 9.0 * deltaTime;
    this.rotation.z += 4.8 * deltaTime;

    // Limbs flail
    [0, 1, 2, 3].forEach((i) => {
      this.parts[`leg${i}`].rotation.x = Math.sin(t + i) * Math.PI * 0.5;
    });

    // Head flop
    this.parts.head.rotation.z = Math.sin(t * 2) * 0.4;
    this.parts.head.rotation.y = Math.cos(t * 1.5) * 0.4;

    // Tail wild
    this.parts.tail.rotation.y = Math.sin(t * 3) * 0.8;

    // Falling
    this.position.y -= 1.2 * deltaTime;
  }

  /**
   * Update position of carried item
   */
  updateCarriedItem() {
    if (!this.carryingItem) return;

    // Position on back
    const itemOffset = new THREE.Vector3(0, 0.3, -0.2);
    itemOffset.applyQuaternion(this.quaternion);
    this.carryingItem.position.copy(this.position).add(itemOffset);

    // Match rotation
    this.carryingItem.rotation.copy(this.rotation);
  }

  /**
   * Pick up an item
   */
  pickupItem(item) {
    this.carryingItem = item;
    this.setAnimationState('carry');
    if (item.parent) {
      item.removeFromParent();
    }
    this.add(item);
  }

  /**
   * Drop carried item
   */
  dropItem() {
    if (this.carryingItem) {
      const world = this.parent;
      if (world) {
        world.add(this.carryingItem);
      }
      this.carryingItem = null;
      this.setAnimationState('idle');
    }
  }

  /**
   * Simple movement
   */
  move(direction, distance = 0.1) {
    direction.normalize();
    const movement = direction.multiplyScalar(distance);

    // Add to current position
    this.position.add(movement);

    // Rotate to face direction
    if (direction.lengthSq() > 0.01) {
      const angle = Math.atan2(direction.x, direction.z);
      this.setYaw(angle);
    }
  }

  getYaw() {
    return Number.isFinite(this.yaw) ? this.yaw : this.rotation.y;
  }

  setYaw(yaw) {
    const nextYaw = Number.isFinite(yaw) ? yaw : 0;
    this.yaw = nextYaw;
    this.rotation.y = THREE.MathUtils.euclideanModulo(nextYaw + Math.PI, Math.PI * 2) - Math.PI;
    return this.yaw;
  }

  rotateYaw(delta) {
    return this.setYaw(this.getYaw() + (Number.isFinite(delta) ? delta : 0));
  }

  dispose() {
    this.animationManager?.dispose();
    this.eyeAnimator?.dispose?.();

    // Walk every descendant and free GPU resources. Without this, each
    // remote-player join/leave cycle leaks the cloned material set, the
    // skinned mesh's geometry view, and the attached edge-outline meshes.
    const seenMaterials = new Set();
    const seenGeometries = new Set();
    const disposeMaterial = (mat) => {
      if (!mat || seenMaterials.has(mat)) return;
      seenMaterials.add(mat);
      // Dispose any textures the material owns. We only dispose textures that
      // were cloned per-mouse (cloneMaterialSet keeps refs); shared atlas
      // textures are wrapped via .source so disposing the .image-less wrapper
      // is safe — only the GL handle is freed.
      for (const key of Object.keys(mat)) {
        const v = mat[key];
        if (v && v.isTexture) v.dispose?.();
      }
      mat.dispose?.();
    };
    this.traverse((child) => {
      const geo = child.geometry;
      if (geo && !seenGeometries.has(geo)) {
        seenGeometries.add(geo);
        geo.dispose?.();
      }
      const mat = child.material;
      if (Array.isArray(mat)) {
        for (const m of mat) disposeMaterial(m);
      } else {
        disposeMaterial(mat);
      }
      // Cached source materials live on userData (cloneMaterialSet stores them
      // for live re-tinting); dispose those too.
      const src = child.userData?.avatarSourceMaterial;
      if (src) {
        if (Array.isArray(src)) for (const m of src) disposeMaterial(m);
        else disposeMaterial(src);
        child.userData.avatarSourceMaterial = null;
      }
    });

    this._fadeMaterials.clear();
    this._fadeMaterials = null;
    this.parts = {};
    this.avatar = null;
    this.bodyPivot = null;
  }
}
