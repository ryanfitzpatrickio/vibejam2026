import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Third-person spring-arm camera controller with collision handling.
 */
export class ThirdPersonCamera {
  constructor({
    camera,
    domElement = null,
    collisionObjects = null,
    collisionQuery = null,
    armLength = 4.5,
    minArmLength = 0.55,
    maxArmLength = 7.5,
    shoulderOffset = new THREE.Vector3(0, 1.3, 0),
    stiffness = 22,
    damping = 10,
    yaw = Math.PI,
    pitch = -0.22,
    minPitch = -1.2,
    maxPitch = 1.2,
    mouseSensitivity = 0.0024,
    cameraCollisionRadius = 0.42,
    cameraCollisionHeight = 0.24,
    fov = null,
  } = {}) {
    if (!camera) {
      throw new Error('ThirdPersonCamera requires a THREE.PerspectiveCamera instance.');
    }

    this.camera = camera;
    this.domElement = domElement;

    this.collisionObjects = collisionObjects;
    this.collisionQuery = collisionQuery;

    this.armLength = armLength;
    this.minArmLength = minArmLength;
    this.maxArmLength = maxArmLength;

    this.stiffness = stiffness;
    this.damping = damping;

    this.yaw = yaw;
    this.pitch = pitch;
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.mouseSensitivity = mouseSensitivity;
    this.cameraCollisionRadius = cameraCollisionRadius;
    this.cameraCollisionHeight = cameraCollisionHeight;
    this.enabled = true;

    this.pointerLocked = false;

    this.shoulderOffset = shoulderOffset.clone();
    this.sideOffset = 0;

    this._currentPosition = this.camera.position.clone();
    this._targetPosition = new THREE.Vector3();
    this._pivot = new THREE.Vector3();
    this._smoothedPivot = new THREE.Vector3();
    this._firstUpdate = true;
    this._velocity = new THREE.Vector3();

    this._raycaster = new THREE.Raycaster();
    this._lookDirection = new THREE.Vector3();

    this._desiredQuaternion = new THREE.Quaternion();
    this._smoothedQuaternion = this.camera.quaternion.clone();
    this._rotationEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._actualArmLength = this.armLength;
    this._desiredArmLength = this.armLength;
    this._collisionArmLength = this.armLength;
    this._collisionCorrection = new THREE.Vector3();

    this._tempVectorA = new THREE.Vector3();
    this._tempVectorB = new THREE.Vector3();
    this._tempVectorC = new THREE.Vector3();
    this._tempVectorD = new THREE.Vector3();
    this._tempVectorE = new THREE.Vector3();
    this._tempVectorF = new THREE.Vector3();
    this._tempVectorG = new THREE.Vector3();
    this._tempMatrix3 = new THREE.Matrix3();

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onWheel = this._onWheel.bind(this);

    this._baseFov = typeof fov === 'number' ? fov : camera.fov;
    this._targetFov = this._baseFov;
    this._fovLerpRate = 6;
    if (typeof fov === 'number') {
      this.setFov(fov);
    }

    if (this.domElement) {
      this.attachPointerLock(this.domElement);
    }
  }

  attachPointerLock(domElement) {
    this.detachPointerLock();

    this.domElement = domElement;

    if (!this.domElement || typeof document === 'undefined') {
      return;
    }

    document.addEventListener('mousemove', this._onMouseMove, false);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onPointerLockChange, false);
    this._onPointerLockChange();
  }

  detachPointerLock() {
    if (typeof document === 'undefined') {
      this.pointerLocked = false;
      return;
    }

    document.removeEventListener('mousemove', this._onMouseMove, false);
    this.domElement?.removeEventListener('wheel', this._onWheel, false);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange, false);
    this.pointerLocked = false;
  }

  requestPointerLock() {
    if (!this.domElement || !this.domElement.requestPointerLock) {
      return null;
    }

    try {
      const result = this.domElement.requestPointerLock();
      if (result?.catch) {
        result.catch(() => {});
      }
      return result;
    } catch {
      return null;
    }
  }

  setFov(fov) {
    this.camera.fov = fov;
    this._baseFov = fov;
    this._targetFov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Set a transient target FOV that will be smoothly lerped each update (used for
   * sprint / wall-run speed push). Clamped to ±20° around base.
   */
  setTargetFov(fov) {
    const base = this._baseFov;
    this._targetFov = Math.max(base - 20, Math.min(base + 20, fov));
  }

  /** Reset transient FOV back to base. */
  clearTargetFov() {
    this._targetFov = this._baseFov;
  }

  setArmLength(length) {
    this.armLength = THREE.MathUtils.clamp(length, this.minArmLength, this.maxArmLength);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  getCharacterOpacity(minOpacity = 0.2) {
    return 1;
  }

  syncFromCamera(targetPosition) {
    if (!targetPosition) return;

    this._pivot.copy(targetPosition).add(this.shoulderOffset);
    this._tempVectorA.copy(this.camera.position).sub(this._pivot);
    this.armLength = THREE.MathUtils.clamp(
      this._tempVectorA.length(),
      this.minArmLength,
      this.maxArmLength,
    );

    if (this.armLength <= 0.0001) return;

    const offset = this._tempVectorA.normalize();
    this.yaw = Math.atan2(offset.x, offset.z);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(offset.y, -1, 1)),
      this.minPitch,
      this.maxPitch,
    );
    this._currentPosition.copy(this.camera.position);
    this._targetPosition.copy(this.camera.position);
    this._smoothedPivot.copy(this._pivot);
  }

  /**
   * Returns a normalized, camera-relative movement direction from WASD-like input.
   */
  /**
   * Returns a normalized camera-relative move direction (XZ plane).
   * Reuses internal scratch vectors — do not retain the reference across
   * awaits or other calls that may re-enter this method.
   */
  getCameraRelativeMovement(inputState) {
    const x = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
    const back = inputState.back ?? inputState.backward ?? false;
    const z = (back ? 1 : 0) - (inputState.forward ? 1 : 0);

    const move = this._tempVectorC;
    if (x === 0 && z === 0) {
      move.set(0, 0, 0);
      return move;
    }

    const forward = this._tempVectorA.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = this._tempVectorB.crossVectors(forward, UP).normalize().negate();

    move.set(0, 0, 0);
    move.addScaledVector(forward, z);
    move.addScaledVector(right, x);

    return move.normalize();
  }

  /**
   * @param {number} delta - seconds
   * @param {THREE.Vector3} targetPosition - character/world follow point
   */
  update(delta, targetPosition) {
    if (!targetPosition) {
      throw new Error('ThirdPersonCamera.update(delta, targetPosition) requires targetPosition.');
    }

    if (!this.enabled) {
      return;
    }

    const dt = Math.max(0.0001, delta || 0.016);

    this._pivot.copy(targetPosition).add(this.shoulderOffset);

    const snap = this._firstUpdate;
    if (snap) {
      this._smoothedPivot.copy(this._pivot);
      this._firstUpdate = false;
    } else {
      this._smoothedPivot.lerp(this._pivot, 1 - Math.exp(-this.stiffness * dt));
    }

    this._rotationEuler.set(this.pitch, this.yaw, 0);
    this._desiredQuaternion.setFromEuler(this._rotationEuler);
    this._smoothedQuaternion.slerp(this._desiredQuaternion, 1 - Math.exp(-this.damping * dt));

    this._lookDirection.set(0, 0, 1).applyQuaternion(this._smoothedQuaternion).normalize();
    this._tempVectorG.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const unclampedArm = THREE.MathUtils.clamp(this.armLength, this.minArmLength, this.maxArmLength);
    const collisionResult = this._resolveCollisionArmLength(this._smoothedPivot, this._lookDirection, unclampedArm);
    this._desiredArmLength = unclampedArm;
    this._collisionArmLength = collisionResult.armLength;
    this._collisionCorrection.copy(collisionResult.correction);

    this._targetPosition.copy(this._smoothedPivot)
      .addScaledVector(this._lookDirection, collisionResult.armLength)
      .addScaledVector(this._tempVectorG, this.sideOffset)
      .add(this._collisionCorrection);

    if (snap) {
      this._currentPosition.copy(this._targetPosition);
    } else {
      const alpha = 1 - Math.exp(-this.stiffness * dt);
      this._currentPosition.lerp(this._targetPosition, alpha);
    }
    this.camera.position.copy(this._currentPosition);
    this._actualArmLength = this.camera.position.distanceTo(this._smoothedPivot);

    this._tempVectorA.copy(this._smoothedPivot);
    this.camera.lookAt(this._tempVectorA);

    // --- Smooth FOV toward transient target (sprint / wall-run push) ---
    if (Math.abs(this.camera.fov - this._targetFov) > 0.01) {
      const t = 1 - Math.exp(-this._fovLerpRate * dt);
      this.camera.fov += (this._targetFov - this.camera.fov) * t;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.detachPointerLock();
  }

  _resolveCollisionArmLength(pivot, lookDirection, desiredArm) {
    const rawObjects =
      typeof this.collisionQuery === 'function' ? this.collisionQuery() : this.collisionObjects;

    if (!rawObjects || rawObjects.length === 0) {
      return { armLength: desiredArm, correction: this._collisionCorrection.set(0, 0, 0) };
    }

    const objects = rawObjects
      .map((entry) => entry?.mesh ?? entry)
      .filter((entry) => entry?.isObject3D && entry.visible !== false);

    if (!objects.length) {
      return { armLength: desiredArm, correction: this._collisionCorrection.set(0, 0, 0) };
    }

    const forward = this._tempVectorB.copy(lookDirection).normalize();
    const right = this._tempVectorC.crossVectors(forward, UP);
    if (right.lengthSq() <= 0.000001) {
      right.set(1, 0, 0);
    }
    right.normalize();
    const up = this._tempVectorD.crossVectors(right, forward).normalize();
    const sampleOffsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 0.8],
      [0, -0.8],
      [0.85, 0.55],
      [-0.85, 0.55],
      [0.85, -0.55],
      [-0.85, -0.55],
    ];

    let safeArm = desiredArm;
    let bestHit = null;

    for (const [xOffset, yOffset] of sampleOffsets) {
      const sampleTarget = this._tempVectorA.copy(pivot)
        .addScaledVector(forward, desiredArm)
        .addScaledVector(right, this.cameraCollisionRadius * xOffset)
        .addScaledVector(up, this.cameraCollisionHeight * yOffset);

      const sampleDirection = this._tempVectorE.copy(sampleTarget).sub(pivot);
      const sampleDistance = sampleDirection.length();
      if (sampleDistance <= 0.0001) continue;

      sampleDirection.divideScalar(sampleDistance);
      this._raycaster.set(pivot, sampleDirection);
      this._raycaster.far = sampleDistance;

      const intersections = this._raycaster.intersectObjects(objects, false)
        .filter((intersection) => {
          const object = intersection.object;
          const surfaceType = object?.userData?.surfaceType;
          if (object?.userData?.cameraOccluder === false) return false;
          if (surfaceType === 'floor') return false;
          if (object?.userData?.runnable === true) return false;
          return true;
        });
      if (!intersections.length) continue;
      const hit = intersections[0];
      const hitIsPlane = hit.object?.geometry?.type === 'PlaneGeometry'
        || hit.object?.geometry?.isPlaneGeometry === true
        || hit.object?.userData?.surfaceType === 'plane';
      const surfacePadding = hitIsPlane ? 0.28 : 0.18;

      const collisionDistance = Math.max(this.minArmLength, hit.distance - surfacePadding);
      safeArm = Math.min(safeArm, collisionDistance);

      if (!bestHit || hit.distance < bestHit.hit.distance) {
        bestHit = { hit };
      }
    }

    const correction = this._collisionCorrection.set(0, 0, 0);
    if (bestHit?.hit?.face && bestHit.hit.object) {
      const candidateCamera = this._tempVectorA.copy(pivot).addScaledVector(forward, safeArm);
      this._tempMatrix3.getNormalMatrix(bestHit.hit.object.matrixWorld);
      const wallNormal = this._tempVectorB.copy(bestHit.hit.face.normal)
        .applyMatrix3(this._tempMatrix3)
        .normalize();
      const wallPoint = this._tempVectorC.copy(bestHit.hit.point);
      const signedDistance = wallNormal.dot(this._tempVectorD.copy(candidateCamera).sub(wallPoint));
      const wallClearance = bestHit.hit.object?.geometry?.type === 'PlaneGeometry'
        || bestHit.hit.object?.geometry?.isPlaneGeometry === true
        || bestHit.hit.object?.userData?.surfaceType === 'plane'
        ? 0.18
        : 0.06;

      if (signedDistance < wallClearance) {
        correction.copy(wallNormal).multiplyScalar(wallClearance - signedDistance);
      }
    }

    return { armLength: safeArm, correction };
  }

  _onMouseMove(event) {
    if (!this.pointerLocked) {
      return;
    }

    this.yaw -= event.movementX * this.mouseSensitivity;
    this.pitch -= event.movementY * this.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
  }

  _onPointerLockChange() {
    if (typeof document === 'undefined') {
      this.pointerLocked = false;
      return;
    }

    this.pointerLocked = document.pointerLockElement === this.domElement;
  }

  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();

    const zoomSpeed = event.shiftKey ? 0.18 : 0.08;
    const delta = Math.sign(event.deltaY) * zoomSpeed;
    this.setArmLength(this.armLength + delta);
  }
}

export default ThirdPersonCamera;
