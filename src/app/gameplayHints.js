export const ROPE_HINT_RANGE = 1.85;
export const ROPE_POSE_GRACE_SECONDS = 0.22;

export function nearestRopeDistanceSq(ropesSnapshot, playerPos) {
  if (!Array.isArray(ropesSnapshot) || !playerPos) return Infinity;
  let nearestSq = Infinity;
  for (const rope of ropesSnapshot) {
    if (!Array.isArray(rope?.segments)) continue;
    for (const segment of rope.segments) {
      const dx = (Number(segment?.x) || 0) - playerPos.x;
      const dy = (Number(segment?.y) || 0) - (playerPos.y + 0.65);
      const dz = (Number(segment?.z) || 0) - playerPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < nearestSq) nearestSq = distSq;
    }
  }
  return nearestSq;
}

export function buildGameplayHint({
  isCoarsePointer,
  controller,
  net,
  ropePoseActive,
  ropeDistanceSq,
  balls,
  mousePosition,
  nowMs,
  smackBallHintCooldownUntil,
  smackBallHintCooldownMs,
  smackFiredThisFrame,
}) {
  let nextHint = null;
  let nextSmackBallHintCooldownUntil = smackBallHintCooldownUntil;
  if ((net.serverState?.grabbedTarget || net.serverState?.grabbedBallId) && controller.alive) {
    nextHint = isCoarsePointer
      ? { id: 'throwHeldBall', key: 'SMACK', text: 'Throw what you are holding' }
      : { id: 'throwHeldBall', action: 'smack', text: 'Throw what you are holding' };
  } else if (ropePoseActive && controller.alive) {
    nextHint = {
      id: 'ropeSwing',
      items: isCoarsePointer
        ? [
          { key: 'STICK', text: 'Swing on the rope' },
          { key: 'JUMP', text: 'Jump up the rope' },
        ]
        : [
          { key: 'WASD', text: 'Swing on the rope' },
          { action: 'jump', text: 'Jump up the rope' },
        ],
    };
  } else if (
    controller.alive
    && ropeDistanceSq <= ROPE_HINT_RANGE * ROPE_HINT_RANGE
  ) {
    nextHint = {
      id: 'ropeGrab',
      items: isCoarsePointer
        ? [
          { key: 'JUMP', text: 'Jump toward the rope or fan' },
          { key: 'ROPE', text: 'Hold to grab rope / fan blades' },
        ]
        : [
          { action: 'jump', text: 'Jump toward the rope or fan' },
          { action: 'grab', text: 'Hold to grab rope / fan blades' },
        ],
    };
  } else if (nowMs >= smackBallHintCooldownUntil && Array.isArray(balls) && balls.length > 0 && controller.alive) {
    let nearestSq = Infinity;
    for (const ball of balls) {
      const dx = ball.x - mousePosition.x;
      const dz = ball.z - mousePosition.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestSq) nearestSq = distSq;
    }
    if (nearestSq < 2.5 * 2.5) {
      nextHint = {
        id: 'smackBall',
        items: isCoarsePointer
          ? [
            { key: 'SMACK', text: 'Smack the ball' },
            { key: 'GRAB', text: 'Pick up the ball' },
          ]
          : [
            { action: 'smack', text: 'Smack the ball' },
            { action: 'grab', text: 'Pick up the ball' },
          ],
      };
      if (smackFiredThisFrame) {
        nextSmackBallHintCooldownUntil = nowMs + smackBallHintCooldownMs;
        nextHint = null;
      }
    }
  }

  return { hint: nextHint, smackBallHintCooldownUntil: nextSmackBallHintCooldownUntil };
}
