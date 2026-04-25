import { PREDATOR_AI } from '../shared/predator.js';
import {
  CHARGED_SMACK_CAT_KNOCKBACK,
  CHARGED_SMACK_CAT_RANGE,
  CHARGED_SMACK_CAT_STUN_SECONDS,
  CHARGED_SMACK_COOLDOWN,
  CHARGED_SMACK_LAUNCH_MAX_SCALE,
  CHARGED_SMACK_LAUNCH_MIN_SCALE,
  CHARGED_SMACK_MAX_HOLD_SECONDS,
  CHARGED_SMACK_MIN_HOLD_SECONDS,
  CHARGED_SMACK_RANGE,
  CHARGED_THROW_BALL_SPEED,
  CHARGED_THROW_BALL_SPIN,
  CHARGED_THROW_BALL_UP,
  CHARGED_THROW_MIN_HOLD_SECONDS,
  CHARGED_THROW_MOUSE_LAUNCH_SCALE,
  CHARGED_THROW_MOUSE_UP_MULTIPLIER,
  CHARGED_THROW_ORBIT_RADIUS,
  CHARGED_THROW_ORBIT_SPEED,
  CHARGED_THROW_ORBIT_UP,
  GRAB_COOLDOWN,
  GRAB_INITIATOR_ADVANTAGE,
  MISCHIEF_POINTS,
  QUICK_TOSS_BACK_LAUNCH_SCALE,
  QUICK_TOSS_BACK_UP_MULTIPLIER,
  QUICK_TOSS_FULL_HOLD_SECONDS,
  QUICK_TOSS_MOUSE_LAUNCH_SCALE,
  QUICK_TOSS_MOUSE_UP_MULTIPLIER,
  SMACK_COOLDOWN,
  SMACK_KNOCKBACK,
  SMACK_RANGE,
  SMACK_STUN_DURATION,
  THROW_SMACK_SUPPRESS_SECONDS,
} from './interactionTuning.js';

export function processThrowRequests(runtime, { quickTossRequests, chargedThrowRequests, throwRequests, now }) {
  const THROW_BALL_SPEED = 14;
  const THROW_BALL_UP = 5.5;
  const THROW_BALL_SPIN = 8;
  for (const request of quickTossRequests) {
    const throwerId = request?.id;
    const thrower = runtime.players.get(throwerId);
    if (!thrower?.alive || thrower.spectator || thrower.extracted) continue;
    thrower._suppressSmackUntil = Math.max(
      Number(thrower._suppressSmackUntil) || 0,
      now + THROW_SMACK_SUPPRESS_SECONDS,
    );
    const targetId = thrower.grabbedTarget;
    const target = targetId ? runtime.players.get(targetId) : null;
    const rot = thrower.rotation ?? 0;
    const fullCharge = (Number(request?.chargeSeconds) || 0) >= QUICK_TOSS_FULL_HOLD_SECONDS * 0.95;
    const aimX = Number(thrower._quickTossAimX) || 0;
    const aimZ = Number(thrower._quickTossAimZ) || 0;
    const aimLen = Math.hypot(aimX, aimZ);
    const forwardX = Math.sin(rot);
    const forwardZ = Math.cos(rot);
    const fx = fullCharge && aimLen > 0.001 ? aimX / aimLen : -forwardX;
    const fz = fullCharge && aimLen > 0.001 ? aimZ / aimLen : -forwardZ;
    const launchScale = fullCharge ? QUICK_TOSS_MOUSE_LAUNCH_SCALE : QUICK_TOSS_BACK_LAUNCH_SCALE;
    const upMultiplier = fullCharge ? QUICK_TOSS_MOUSE_UP_MULTIPLIER : QUICK_TOSS_BACK_UP_MULTIPLIER;
    if (target) {
      const startOffset = fullCharge ? 0.7 : 0.25;
      target.position.x = thrower.position.x + fx * startOffset;
      target.position.z = thrower.position.z + fz * startOffset;
      target.position.y = thrower.position.y + (fullCharge ? 0.95 : 1.18);
      target.velocity.x = 0;
      target.velocity.y = 0;
      target.velocity.z = 0;
      target.grabbedBy = null;
      target.grabCooldown = GRAB_COOLDOWN;
      runtime.mouseLaunchWorld.startFlight(
        target.id ?? targetId,
        target,
        fx,
        fz,
        launchScale,
        { jitter: false, upMultiplier },
      );
      if (thrower.roundStats) {
        thrower.roundStats.throwsLanded = (thrower.roundStats.throwsLanded ?? 0) + 1;
      }
      runtime._awardMischief(thrower, fullCharge ? MISCHIEF_POINTS.throw * 2 : MISCHIEF_POINTS.throw);
      runtime._emitNoise(thrower, fullCharge ? 16 : 12, fullCharge ? 220 : 130);
    }
    thrower.grabbedTarget = null;
    if (target) thrower.grabCooldown = GRAB_COOLDOWN * 0.5;
    thrower._quickTossHoldSeconds = 0;
    thrower._quickTossActive = false;
    thrower._quickTossHeldInput = false;
    thrower._throwSpinCharge = 0;
  }
  for (const request of chargedThrowRequests) {
    const throwerId = request?.id;
    const thrower = runtime.players.get(throwerId);
    if (!thrower?.alive || thrower.spectator || thrower.extracted) continue;
    thrower._suppressSmackUntil = Math.max(
      Number(thrower._suppressSmackUntil) || 0,
      now + THROW_SMACK_SUPPRESS_SECONDS,
    );
    if ((Number(request?.chargeSeconds) || 0) < CHARGED_THROW_MIN_HOLD_SECONDS * 0.85) {
      throwRequests.add(throwerId);
      continue;
    }
    const rot = thrower.rotation ?? 0;
    const aimX = Number(thrower._chargedThrowAimX) || 0;
    const aimZ = Number(thrower._chargedThrowAimZ) || 0;
    const aimLen = Math.hypot(aimX, aimZ);
    const fx = aimLen > 0.001 ? aimX / aimLen : Math.sin(rot);
    const fz = aimLen > 0.001 ? aimZ / aimLen : Math.cos(rot);
    thrower._chargedThrowHoldSeconds = 0;
    thrower._quickTossHoldSeconds = 0;
    thrower._quickTossActive = false;
    thrower._throwSpinCharge = 0;
    if (thrower.grabbedTarget) {
      const target = runtime.players.get(thrower.grabbedTarget);
      if (target) {
        target.position.x = thrower.position.x + fx * 0.8;
        target.position.z = thrower.position.z + fz * 0.8;
        target.position.y = thrower.position.y + 1.0;
        target.velocity.x = 0;
        target.velocity.y = 0;
        target.velocity.z = 0;
        target.grabbedBy = null;
        target.grabCooldown = GRAB_COOLDOWN;
        runtime.mouseLaunchWorld.startFlight(
          target.id ?? thrower.grabbedTarget,
          target,
          fx,
          fz,
          CHARGED_THROW_MOUSE_LAUNCH_SCALE,
          { jitter: false, upMultiplier: CHARGED_THROW_MOUSE_UP_MULTIPLIER },
        );
        if (thrower.roundStats) {
          thrower.roundStats.throwsLanded = (thrower.roundStats.throwsLanded ?? 0) + 1;
        }
        runtime._awardMischief(thrower, MISCHIEF_POINTS.throw * 2);
        runtime._emitNoise(thrower, 16, 220);
      }
      thrower.grabbedTarget = null;
      thrower.grabCooldown = GRAB_COOLDOWN;
    }
    if (thrower.grabbedBallId) {
      runtime.pushBallWorld.applyBallImpulse(
        thrower.grabbedBallId,
        fx * CHARGED_THROW_BALL_SPEED,
        CHARGED_THROW_BALL_UP,
        fz * CHARGED_THROW_BALL_SPEED,
        CHARGED_THROW_BALL_SPIN,
      );
      thrower.grabbedBallId = null;
      thrower.grabCooldown = GRAB_COOLDOWN;
      runtime._awardMischief(thrower, MISCHIEF_POINTS.throw * 2);
      runtime._emitNoise(thrower, 16, 220);
    }
  }
  for (const throwerId of throwRequests) {
    const thrower = runtime.players.get(throwerId);
    if (!thrower?.alive || thrower.spectator || thrower.extracted) continue;
    if (thrower.grabbedTarget || thrower.grabbedBallId) {
      thrower._suppressSmackUntil = Math.max(
        Number(thrower._suppressSmackUntil) || 0,
        now + THROW_SMACK_SUPPRESS_SECONDS,
      );
    }
    const rot = thrower.rotation ?? 0;
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    const spinBoost = 1 + Math.min(0.9, Math.max(0, Number(thrower._throwSpinCharge) || 0) * 0.45);
    thrower._quickTossHoldSeconds = 0;
    thrower._quickTossActive = false;
    thrower._throwSpinCharge = 0;
    if (thrower.grabbedTarget) {
      const target = runtime.players.get(thrower.grabbedTarget);
      if (target) {
        target.position.x = thrower.position.x + fx * 0.6;
        target.position.z = thrower.position.z + fz * 0.6;
        target.position.y = thrower.position.y + 0.9;
        target.grabbedBy = null;
        target.grabCooldown = GRAB_COOLDOWN;
        runtime.mouseLaunchWorld.startFlight(target.id ?? thrower.grabbedTarget, target, fx, fz, spinBoost);
        if (thrower.roundStats) {
          thrower.roundStats.throwsLanded = (thrower.roundStats.throwsLanded ?? 0) + 1;
        }
        runtime._awardMischief(thrower, MISCHIEF_POINTS.throw);
        runtime._emitNoise(thrower, 12, 130);
      }
      thrower.grabbedTarget = null;
      thrower.grabCooldown = GRAB_COOLDOWN;
    }
    if (thrower.grabbedBallId) {
      runtime.pushBallWorld.applyBallImpulse(
        thrower.grabbedBallId,
        fx * THROW_BALL_SPEED * spinBoost,
        THROW_BALL_UP * Math.sqrt(spinBoost),
        fz * THROW_BALL_SPEED * spinBoost,
        THROW_BALL_SPIN * spinBoost,
      );
      thrower.grabbedBallId = null;
      thrower.grabCooldown = GRAB_COOLDOWN;
    }
  }
}

export function processSmackRequests(runtime, { chargedSmackRequests, smackRequests, now }) {
  for (const request of chargedSmackRequests) {
    const attackerId = request?.id;
    const attacker = runtime.players.get(attackerId);
    const chargeSeconds = Math.max(0, Number(request?.chargeSeconds) || 0);
    if (
      !attacker?.alive
      || attacker.smackCooldown > 0
      || attacker.extracted
      || attacker.spectator
      || attacker.isAdversary
      || attacker.grabbedTarget
      || attacker.grabbedBallId
      || (Number(attacker._suppressSmackUntil) || 0) > now
      || chargeSeconds < CHARGED_SMACK_MIN_HOLD_SECONDS
    ) {
      continue;
    }

    let bestId = null;
    let bestCat = null;
    let bestDist = CHARGED_SMACK_RANGE;
    for (const [otherId, other] of runtime.players) {
      if (otherId === attackerId || !other.alive || other.smackStunTimer > 0) continue;
      if (other.extracted || other.spectator || other.isAdversary) continue;
      if (runtime.mouseLaunchWorld.isFlying(otherId)) continue;
      const dx = other.position.x - attacker.position.x;
      const dz = other.position.z - attacker.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = otherId;
      }
    }

    let bestCatDist = bestId ? bestDist : CHARGED_SMACK_CAT_RANGE;
    for (const predator of runtime.predators) {
      if (predator?.type !== 'cat' || predator.alive === false || predator.aiState === PREDATOR_AI.DEATH) continue;
      const dx = predator.position.x - attacker.position.x;
      const dz = predator.position.z - attacker.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestCatDist) {
        bestCatDist = dist;
        bestCat = predator;
        bestId = null;
      }
    }

    if (bestCat) {
      attacker.smackCooldown = CHARGED_SMACK_COOLDOWN;
      attacker._chargedSmackHoldSeconds = 0;
      if (attacker.roundStats) {
        attacker.roundStats.smacksLanded = (attacker.roundStats.smacksLanded ?? 0) + 1;
      }
      runtime._awardMischief(attacker, MISCHIEF_POINTS.smack * 2);
      runtime._emitNoise(attacker, 18, 260);
      bestCat.aiState = PREDATOR_AI.STUNNED;
      bestCat.aiTimer = Math.max(Number(bestCat.aiTimer) || 0, CHARGED_SMACK_CAT_STUN_SECONDS);
      bestCat.aggroTargetId = null;
      bestCat.chaseTargetId = null;
      const dx = bestCat.position.x - attacker.position.x;
      const dz = bestCat.position.z - attacker.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      bestCat.position.x += (dx / len) * CHARGED_SMACK_CAT_KNOCKBACK;
      bestCat.position.z += (dz / len) * CHARGED_SMACK_CAT_KNOCKBACK;
      if (bestCat.velocity) {
        bestCat.velocity.x = 0;
        bestCat.velocity.z = 0;
      }
      continue;
    }

    if (!bestId) continue;
    const target = runtime.players.get(bestId);
    if (!target) continue;
    const dx = target.position.x - attacker.position.x;
    const dz = target.position.z - attacker.position.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const fallbackRot = attacker.rotation ?? 0;
    const nx = len > 0.001 ? dx / len : Math.sin(fallbackRot);
    const nz = len > 0.001 ? dz / len : Math.cos(fallbackRot);
    const chargeT = Math.max(0, Math.min(
      1,
      (chargeSeconds - CHARGED_SMACK_MIN_HOLD_SECONDS)
        / (CHARGED_SMACK_MAX_HOLD_SECONDS - CHARGED_SMACK_MIN_HOLD_SECONDS),
    ));
    const gusResist = target.isHero && target.heroAvatar === 'gus';
    const launchScale = (
      CHARGED_SMACK_LAUNCH_MIN_SCALE
      + (CHARGED_SMACK_LAUNCH_MAX_SCALE - CHARGED_SMACK_LAUNCH_MIN_SCALE) * chargeT
    ) * (gusResist ? 0.55 : 1);

    attacker.smackCooldown = CHARGED_SMACK_COOLDOWN;
    attacker._chargedSmackHoldSeconds = 0;
    if (attacker.roundStats) {
      attacker.roundStats.smacksLanded = (attacker.roundStats.smacksLanded ?? 0) + 1;
    }
    runtime._awardMischief(attacker, MISCHIEF_POINTS.smack * 2);
    runtime._emitNoise(attacker, 17, 240);
    runtime._breakPlayerGrabLinks(bestId, target);
    runtime.cheeseWorld.onDeathDropCarried(target);
    target.grabCooldown = Math.max(target.grabCooldown ?? 0, GRAB_COOLDOWN);
    target.smackCooldown = Math.max(target.smackCooldown ?? 0, 0.35);
    target.animState = 'jump';
    target.position.x = attacker.position.x + nx * 0.7;
    target.position.z = attacker.position.z + nz * 0.7;
    target.position.y = Math.max(target.position.y, attacker.position.y + 0.75);
    runtime.mouseLaunchWorld.startFlight(bestId, target, nx, nz, launchScale);
  }

  for (const attackerId of smackRequests) {
    const attacker = runtime.players.get(attackerId);
    if (
      !attacker?.alive
      || attacker.smackCooldown > 0
      || attacker.extracted
      || attacker.spectator
      || attacker.isAdversary
      || attacker.grabbedTarget
      || attacker.grabbedBallId
      || (Number(attacker._suppressSmackUntil) || 0) > now
    ) {
      continue;
    }
    const smackRot = attacker.rotation ?? 0;
    const smackFx = Math.sin(smackRot);
    const smackFz = Math.cos(smackRot);
    const ballsHit = runtime.pushBallWorld.smackBallsInFront(
      attacker.position,
      smackFx,
      smackFz,
      { range: SMACK_RANGE, speed: 12, upSpeed: 3.8 },
    );
    if (ballsHit > 0) {
      attacker.smackCooldown = SMACK_COOLDOWN;
      runtime._awardMischief(attacker, MISCHIEF_POINTS.ballSmack * Math.min(3, ballsHit));
      runtime._emitNoise(attacker, 11, 120);
    }
    let bestId = null;
    let bestDist = SMACK_RANGE;
    for (const [otherId, other] of runtime.players) {
      if (otherId === attackerId || !other.alive || other.smackStunTimer > 0) continue;
      if (other.extracted || other.spectator || other.isAdversary) continue;
      if (runtime.mouseLaunchWorld.isFlying(otherId)) continue;
      const dx = other.position.x - attacker.position.x;
      const dz = other.position.z - attacker.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = otherId;
      }
    }
    if (bestId) {
      const target = runtime.players.get(bestId);
      if (attacker.roundStats) {
        attacker.roundStats.smacksLanded = (attacker.roundStats.smacksLanded ?? 0) + 1;
      }
      runtime._awardMischief(attacker, MISCHIEF_POINTS.smack);
      runtime._emitNoise(attacker, 13, 150);
      attacker.smackCooldown = SMACK_COOLDOWN;
      const gusResist = target.isHero && target.heroAvatar === 'gus';
      target.smackStunTimer = gusResist ? SMACK_STUN_DURATION * 0.45 : SMACK_STUN_DURATION;
      target.alive = false;
      target.animState = 'death';
      target.deathTime = 0;
      runtime.cheeseWorld.onDeathDropCarried(target);
      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const knockback = gusResist ? SMACK_KNOCKBACK * 0.45 : SMACK_KNOCKBACK;
      target.velocity.x += (dx / len) * knockback;
      target.velocity.y += gusResist ? 1.4 : 3;
      target.velocity.z += (dz / len) * knockback;
      runtime._breakPlayerGrabLinks(bestId, target);
    }
  }
}

export function applyGrabCoupling(runtime, dt) {
  const processedGrabs = new Set();
  for (const [id, state] of runtime.players) {
    if (!state.grabbedTarget || processedGrabs.has(id)) continue;
    const target = runtime.players.get(state.grabbedTarget);
    if (!target || !target.alive || !state.alive) {
      if (target) target.grabbedBy = null;
      state.grabbedTarget = null;
      state._quickTossActive = false;
      state._quickTossHoldSeconds = 0;
      continue;
    }
    processedGrabs.add(id);
    processedGrabs.add(state.grabbedTarget);

    const throwOrbitActive = (Number(state._chargedThrowHoldSeconds) || 0) > 0
      || (Number(state._quickTossHoldSeconds) || 0) > 0
      || !!state._quickTossActive;
    if (throwOrbitActive) {
      state._chargedThrowOrbitAngle = (Number(state._chargedThrowOrbitAngle) || 0) + CHARGED_THROW_ORBIT_SPEED * dt;
      const angle = state._chargedThrowOrbitAngle;
      const ox = Math.sin(angle) * CHARGED_THROW_ORBIT_RADIUS;
      const oz = Math.cos(angle) * CHARGED_THROW_ORBIT_RADIUS;
      const faceTarget = Math.atan2(ox, oz);
      target.position.x = state.position.x + ox;
      target.position.z = state.position.z + oz;
      target.position.y = state.position.y + CHARGED_THROW_ORBIT_UP;
      target.velocity.x = 0;
      target.velocity.y = 0;
      target.velocity.z = 0;
      state.rotation = faceTarget;
      target.rotation = faceTarget + Math.PI;
      state.animState = 'grab';
      target.animState = 'grab';
      continue;
    }

    const adv = GRAB_INITIATOR_ADVANTAGE;
    const blendVx = state.velocity.x * adv + target.velocity.x * (1 - adv);
    const blendVz = state.velocity.z * adv + target.velocity.z * (1 - adv);
    state.velocity.x = blendVx;
    state.velocity.z = blendVz;
    target.velocity.x = blendVx;
    target.velocity.z = blendVz;

    const rot = state.rotation ?? 0;
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    target.position.x = state.position.x + fx * 0.15;
    target.position.z = state.position.z + fz * 0.15;
    target.position.y = state.position.y + 1.0;
    target.rotation = rot;

    if ((state.grabAnimTimer ?? 0) > 0) {
      state.grabAnimTimer = Math.max(0, state.grabAnimTimer - dt);
      state.animState = 'grab';
    }
    if ((target.grabAnimTimer ?? 0) > 0) {
      target.grabAnimTimer = Math.max(0, target.grabAnimTimer - dt);
      target.animState = 'grab';
    }
  }
}

export function pinHeldBalls(runtime, dt) {
  for (const [, state] of runtime.players) {
    if (!state.grabbedBallId || !state.alive) {
      if (state.grabbedBallId && !state.alive) state.grabbedBallId = null;
      continue;
    }
    const entry = runtime.pushBallWorld.getBallEntry(state.grabbedBallId);
    if (!entry) {
      state.grabbedBallId = null;
      continue;
    }
    const rot = state.rotation ?? 0;
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    let hx = state.position.x;
    let hz = state.position.z;
    let hy = state.position.y + 1.05 + entry.radius;
    if ((Number(state._chargedThrowHoldSeconds) || 0) > 0) {
      state._chargedThrowOrbitAngle = (Number(state._chargedThrowOrbitAngle) || 0) + CHARGED_THROW_ORBIT_SPEED * dt;
      const angle = state._chargedThrowOrbitAngle;
      const ox = Math.sin(angle) * CHARGED_THROW_ORBIT_RADIUS;
      const oz = Math.cos(angle) * CHARGED_THROW_ORBIT_RADIUS;
      hx = state.position.x + ox;
      hz = state.position.z + oz;
      hy = state.position.y + CHARGED_THROW_ORBIT_UP + entry.radius;
      state.rotation = Math.atan2(ox, oz);
      state.animState = 'grab';
    } else {
      hx += fx * 0;
      hz += fz * 0;
    }
    runtime.pushBallWorld.pinBall(state.grabbedBallId, hx, hy, hz);
    if ((state.grabAnimTimer ?? 0) > 0) state.animState = 'grab';
  }
}
