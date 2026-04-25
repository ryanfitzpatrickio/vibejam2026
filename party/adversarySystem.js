import { respawnPlayer } from '../shared/physics.js';

export const ADVERSARY_SAFE_RADIUS = 7.5;
const ADVERSARY_SAFE_RADIUS_SQ = ADVERSARY_SAFE_RADIUS * ADVERSARY_SAFE_RADIUS;

export function currentAdversaryId(players) {
  for (const [id, state] of players) {
    if (state?.isAdversary) return id;
  }
  return null;
}

export function recordAdversaryScore(stats, connectionId, state) {
  if (!connectionId || !state) return;
  const safeSeconds = Math.max(0, Number(state.adversarySafeSeconds) || 0);
  if (safeSeconds <= 0) return;
  stats?.recordAdversaryScore(connectionId, {
    displayName: state.displayName,
    safeSeconds,
  });
}

export function setAdversary(runtime, state, active, connectionId = null) {
  if (!state) return;
  if (state.isAdversary && !active) {
    recordAdversaryScore(runtime.stats, connectionId ?? state.id, state);
  }
  state.isAdversary = !!active;
  state.adversaryRole = active ? 'human' : null;
  state.cheeseCarried = 0;
  state.extractProgress = 0;
  state.extracted = false;
  state.grabbedBy = null;
  state.grabbedTarget = null;
  state.grabbedBallId = null;
  state._quickTossHoldSeconds = 0;
  state._quickTossActive = false;
  state._quickTossHeldInput = false;
  state.heroAvailable = false;
  state.isHero = false;
  state.heroAvatar = null;
  state.heroTimeRemaining = 0;
  state.heroAvatarAvailable = null;
  if (!active) state.adversarySafeStreakSeconds = 0;
  if (active) {
    const spawn = runtime._pickHumanSpawn();
    respawnPlayer(state, spawn.x, spawn.z, spawn.y);
    runtime.mouseLaunchWorld?.removePlayer?.(state.id);
    runtime.ropeWorld?.removePlayer?.(state.id);
    runtime.fanWorld?.removePlayer?.(state.id);
    runtime._lastRopeGrab.delete(state.id);
    runtime._lastRopeJump?.delete(state.id);
  }
}

export function tickAdversaryScores(runtime, dt) {
  for (const [, state] of runtime.players) {
    if (!state?.isAdversary || !state.alive || state.spectator || runtime.round.phase === 'intermission') {
      if (state?.isAdversary) state.adversarySafeStreakSeconds = 0;
      continue;
    }

    let nearestMouseDistSq = Infinity;
    for (const [, other] of runtime.players) {
      if (!other || other === state || other.isAdversary || !other.alive || other.spectator || other.extracted) continue;
      const dx = other.position.x - state.position.x;
      const dz = other.position.z - state.position.z;
      nearestMouseDistSq = Math.min(nearestMouseDistSq, dx * dx + dz * dz);
    }

    if (nearestMouseDistSq > ADVERSARY_SAFE_RADIUS_SQ) {
      state.adversarySafeSeconds = (state.adversarySafeSeconds ?? 0) + dt;
      state.adversarySafeStreakSeconds = (state.adversarySafeStreakSeconds ?? 0) + dt;
    } else {
      state.adversarySafeStreakSeconds = 0;
    }
  }
}
