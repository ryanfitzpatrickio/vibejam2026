import * as THREE from 'three';

export const RECONCILE_SNAP_THRESHOLD = 3.0;
export const RECONCILE_SKIP_THRESHOLD = 0.001;
export const RECONCILE_SMOOTH_RATE = 20;

export function copyServerToPrediction(predictionState, ss) {
  predictionState.position.x = ss.position.x;
  predictionState.position.y = ss.position.y;
  predictionState.position.z = ss.position.z;
  predictionState.velocity.x = ss.velocity.x;
  predictionState.velocity.y = ss.velocity.y;
  predictionState.velocity.z = ss.velocity.z;
  predictionState.rotation = ss.rotation;
  predictionState.grounded = ss.grounded;
  predictionState.stamina = ss.stamina;
  predictionState.staminaRegenTimer = ss.staminaRegenTimer ?? 0;
  predictionState.health = ss.health;
  predictionState.alive = ss.alive;
  predictionState.sprinting = !!ss.sprinting;
  predictionState.crouching = !!ss.crouching;
  predictionState.sliding = !!ss.sliding;
  predictionState.slideTimer = ss.slideTimer ?? 0;
  predictionState.slideCooldownTimer = ss.slideCooldownTimer ?? 0;
  predictionState.slideDirX = ss.slideDirX ?? 0;
  predictionState.slideDirZ = ss.slideDirZ ?? 0;
  predictionState.canDoubleJump = !!ss.canDoubleJump;
  predictionState.hasDoubleJumped = !!ss.hasDoubleJumped;
  predictionState.wallHolding = !!ss.wallHolding;
  predictionState.wallNormalX = ss.wallNormalX ?? 0;
  predictionState.wallNormalZ = ss.wallNormalZ ?? 0;
  predictionState.wallJumpWindowTimer = ss.wallJumpWindowTimer ?? 0;
  predictionState.wallAttachCooldownTimer = ss.wallAttachCooldownTimer ?? 0;
  predictionState.deathTime = ss.deathTime ?? 0;
  predictionState.deaths = ss.deaths ?? 0;
  predictionState.longestChaseSeconds = ss.longestChaseSeconds ?? 0;
  predictionState.chaseStreakSeconds = ss.chaseStreakSeconds ?? 0;
  predictionState.cheeseCarried = ss.cheeseCarried ?? 0;
  // Mirror ropeSwing so simulateTick's rope early-return triggers during
  // client prediction. Otherwise ground physics fights server rope movement.
  predictionState.ropeSwing = ss.ropeSwing ?? null;
  predictionState.livesRemaining = ss.livesRemaining ?? predictionState.livesRemaining;
  predictionState.spectator = !!ss.spectator;
  predictionState.extracted = !!ss.extracted;
  predictionState.extractProgress = ss.extractProgress ?? 0;
  predictionState.animState = ss.animState ?? predictionState.animState;
  predictionState.mountId = ss.mountId ?? null;
  predictionState.smackLimpThrowWindowTimer = ss.smackLimpThrowWindowTimer ?? 0;
  predictionState.limpThrownBounceTimer = ss.limpThrownBounceTimer ?? 0;
  predictionState.limpBounceHitSeq = ss.limpBounceHitSeq ?? 0;
  predictionState.isAdversary = !!ss.isAdversary;
  predictionState.adversaryRole = ss.adversaryRole ?? null;
  predictionState.adversarySafeSeconds = ss.adversarySafeSeconds ?? 0;
  predictionState.adversarySafeStreakSeconds = ss.adversarySafeStreakSeconds ?? 0;
  predictionState.isHero = !!ss.isHero;
  predictionState.heroAvatar = ss.heroAvatar ?? null;
  predictionState.heroAvailable = !!ss.heroAvailable;
  predictionState.heroAvatarAvailable = ss.heroAvatarAvailable ?? null;
  predictionState.heroTimeRemaining = ss.heroTimeRemaining ?? 0;
  if (ss.roundStats && typeof ss.roundStats === 'object') {
    predictionState.roundStats = { ...predictionState.roundStats, ...ss.roundStats };
  }
  if (typeof ss.displayName === 'string' && ss.displayName.trim()) {
    predictionState.displayName = ss.displayName;
  }
}

export function restoreTinyPredictionCorrection(predictionState, previousPosition) {
  const dx = predictionState.position.x - previousPosition.x;
  const dy = predictionState.position.y - previousPosition.y;
  const dz = predictionState.position.z - previousPosition.z;
  const errorSq = dx * dx + dy * dy + dz * dz;

  if (errorSq >= RECONCILE_SKIP_THRESHOLD * RECONCILE_SKIP_THRESHOLD) return false;
  predictionState.position.x = previousPosition.x;
  predictionState.position.y = previousPosition.y;
  predictionState.position.z = previousPosition.z;
  return true;
}

export function createRenderPositionSmoother() {
  const position = new THREE.Vector3();
  let initialized = false;

  function snapToPrediction(predictionState, groundOffset = 0) {
    position.set(
      predictionState.position.x,
      predictionState.position.y + groundOffset,
      predictionState.position.z,
    );
    initialized = true;
    return position;
  }

  function snapToWorld(worldPosition) {
    position.copy(worldPosition);
    initialized = true;
    return position;
  }

  function updateFromPrediction(predictionState, groundOffset = 0, deltaSeconds = 1 / 30) {
    const targetX = predictionState.position.x;
    const targetY = predictionState.position.y + groundOffset;
    const targetZ = predictionState.position.z;

    if (!initialized) {
      position.set(targetX, targetY, targetZ);
      initialized = true;
      return position;
    }

    const errX = targetX - position.x;
    const errY = targetY - position.y;
    const errZ = targetZ - position.z;
    const errSq = errX * errX + errY * errY + errZ * errZ;

    if (errSq > RECONCILE_SNAP_THRESHOLD * RECONCILE_SNAP_THRESHOLD) {
      position.set(targetX, targetY, targetZ);
      return position;
    }

    const t = 1 - Math.exp(-RECONCILE_SMOOTH_RATE * deltaSeconds);
    position.x += errX * t;
    position.y += errY * t;
    position.z += errZ * t;
    return position;
  }

  return {
    position,
    isInitialized: () => initialized,
    snapToPrediction,
    snapToWorld,
    updateFromPrediction,
  };
}
