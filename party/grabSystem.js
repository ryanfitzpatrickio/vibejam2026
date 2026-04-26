import { GRAB_RANGE, MISCHIEF_POINTS } from './interactionTuning.js';

function findNearestGrabbablePlayer(runtime, grabberId, grabber) {
  const origin = runtime.mountWorld?.getGrabPointForPlayer?.(grabberId, grabber) ?? grabber.position;
  let bestId = null;
  let bestDist = GRAB_RANGE;
  for (const [otherId, other] of runtime.players) {
    if (otherId === grabberId || !other.alive || other.smackStunTimer > 0) continue;
    if (other.extracted || other.spectator || other.isAdversary) continue;
    if (runtime.mouseLaunchWorld.isFlying(otherId)) continue;
    const dx = other.position.x - origin.x;
    const dz = other.position.z - origin.z;
    const dy = Math.abs(other.position.y - (origin.y ?? grabber.position.y));
    if (dy > 1.35) continue;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = otherId;
    }
  }
  return bestId;
}

function canStartGrab(grabber) {
  return !!(
    grabber?.alive
    && grabber.grabCooldown <= 0
    && !grabber.grabbedTarget
    && !grabber.grabbedBallId
    && !grabber.extracted
    && !grabber.spectator
    && !grabber.isAdversary
  );
}

function clearPreviousGrabber(runtime, target) {
  if (!target?.grabbedBy) return;
  const oldGrabber = runtime.players.get(target.grabbedBy);
  if (!oldGrabber) return;
  oldGrabber.grabbedTarget = null;
  oldGrabber._quickTossActive = false;
  oldGrabber._quickTossHoldSeconds = 0;
}

function claimPlayer(runtime, grabberId, targetId, { quickToss }) {
  const grabber = runtime.players.get(grabberId);
  const target = runtime.players.get(targetId);
  if (!grabber || !target) return;

  clearPreviousGrabber(runtime, target);
  grabber.grabbedTarget = targetId;
  grabber._quickTossActive = !!quickToss;
  grabber._quickTossHoldSeconds = 0;
  if (quickToss) grabber._chargedThrowHoldSeconds = 0;
  target.grabbedBy = grabberId;
  grabber.grabAnimTimer = quickToss ? 0.45 : 0.6;
  target.grabAnimTimer = quickToss ? 0.45 : 0.6;
  if (grabber.roundStats) {
    grabber.roundStats.grabsInitiated = (grabber.roundStats.grabsInitiated ?? 0) + 1;
  }
  runtime._awardMischief(grabber, MISCHIEF_POINTS.grab);
  runtime._emitNoise(grabber, quickToss ? 8 : 7, quickToss ? 100 : 90);
}

function findNearestGrabbableBall(runtime, grabberId, grabber, claimedBalls) {
  const origin = runtime.mountWorld?.getGrabPointForPlayer?.(grabberId, grabber) ?? {
    x: grabber.position.x,
    y: grabber.position.y + 0.5,
    z: grabber.position.z,
  };
  let bestBall = null;
  let bestBallDist = GRAB_RANGE;
  for (const entry of runtime.pushBallWorld.getBallEntries()) {
    if (claimedBalls.has(entry.id)) continue;
    const dx = entry.body.position.x - origin.x;
    const dz = entry.body.position.z - origin.z;
    const dy = entry.body.position.y - origin.y;
    const distXZ = Math.sqrt(dx * dx + dz * dz);
    if (distXZ - entry.radius > bestBallDist) continue;
    if (Math.abs(dy) > 1.4 + entry.radius) continue;
    const effective = distXZ - entry.radius;
    if (effective < bestBallDist) {
      bestBallDist = effective;
      bestBall = entry;
    }
  }
  return bestBall;
}

export function processGrabAcquisition(runtime, {
  grabHeld,
  quickTossReleaseIds,
  quickTossAttempts,
  grabAttempts,
}) {
  for (const [id, state] of runtime.players) {
    if (state.grabbedTarget && !grabHeld.has(id) && !quickTossReleaseIds.has(id)) {
      const target = runtime.players.get(state.grabbedTarget);
      if (target) target.grabbedBy = null;
      state.grabbedTarget = null;
      state._quickTossActive = false;
      state._quickTossHoldSeconds = 0;
    }
    if (state.grabbedBallId && !grabHeld.has(id)) {
      state.grabbedBallId = null;
    }
  }

  const claimedBalls = new Set();
  for (const [, state] of runtime.players) {
    if (state.grabbedBallId) claimedBalls.add(state.grabbedBallId);
  }

  for (const grabberId of quickTossAttempts) {
    const grabber = runtime.players.get(grabberId);
    if (!canStartGrab(grabber)) continue;
    const bestId = findNearestGrabbablePlayer(runtime, grabberId, grabber);
    if (!bestId) continue;
    claimPlayer(runtime, grabberId, bestId, { quickToss: true });
  }

  for (const grabberId of grabAttempts) {
    const grabber = runtime.players.get(grabberId);
    if (!canStartGrab(grabber)) continue;
    const bestId = findNearestGrabbablePlayer(runtime, grabberId, grabber);
    if (bestId) {
      claimPlayer(runtime, grabberId, bestId, { quickToss: false });
      continue;
    }

    const bestBall = findNearestGrabbableBall(runtime, grabberId, grabber, claimedBalls);
    if (bestBall) {
      grabber.grabbedBallId = bestBall.id;
      grabber.grabAnimTimer = 0.6;
      claimedBalls.add(bestBall.id);
    }
  }
}
