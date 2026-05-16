import { serializePredatorState } from '../shared/predator.js';
import { serializeRoombaState } from '../shared/roomba.js';
import { ADVERSARY_SAFE_RADIUS, currentAdversaryId } from './adversarySystem.js';
import { serializePhysicalTaskStates } from './physicalTaskSystem.js';

function serializePredators(predators) {
  return predators.map((p) => (p.type === 'roomba' ? serializeRoombaState(p) : serializePredatorState(p)));
}

function buildAdversaryPayload(runtime) {
  const playerId = currentAdversaryId(runtime.players);
  return {
    playerId,
    available: !playerId && runtime.round.phase !== 'intermission',
    safeRadius: ADVERSARY_SAFE_RADIUS,
  };
}

function hasRoundStatsValue(rs) {
  if (!rs || typeof rs !== 'object') return false;
  return !!(
    Number(rs.cheeseCollected)
    || Number(rs.maxCarried)
    || Number(rs.mischiefScore)
    || Number(rs.mischiefCombo)
    || Number(rs.mischiefComboEndsAt)
    || Number(rs.mischiefEvents)
    || Number(rs.smacksLanded)
    || Number(rs.grabsInitiated)
    || Number(rs.throwsLanded)
    || Number(rs.maxChaseStreak)
    || Number(rs.totalChaseSeconds)
    || Number(rs.finalScore)
    || Number(rs.xpAwarded)
    || rs.tasksCompleted?.length
  );
}

function setNumberIf(out, key, value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n) && n !== fallback) out[key] = n;
}

function setBoolIf(out, key, value) {
  if (value === true) out[key] = true;
}

function setValueIf(out, key, value) {
  if (value !== null && value !== undefined) out[key] = value;
}

function serializePlayerState(p) {
  const out = {
    id: p.id,
    displayName: p.displayName,
    position: p.position,
    velocity: p.velocity,
    rotation: p.rotation,
    grounded: p.grounded,
    stamina: p.stamina,
    health: p.health,
    alive: p.alive,
    animState: p.animState,
    livesRemaining: p.livesRemaining,
  };
  setNumberIf(out, 'groundedGraceTimer', p.groundedGraceTimer);
  setNumberIf(out, 'staminaRegenTimer', p.staminaRegenTimer);
  setBoolIf(out, 'sprinting', p.sprinting);
  setBoolIf(out, 'crouching', p.crouching);
  setBoolIf(out, 'sliding', p.sliding);
  setNumberIf(out, 'slideTimer', p.slideTimer);
  setNumberIf(out, 'slideCooldownTimer', p.slideCooldownTimer);
  setNumberIf(out, 'slideDirX', p.slideDirX);
  setNumberIf(out, 'slideDirZ', p.slideDirZ);
  setBoolIf(out, 'canDoubleJump', p.canDoubleJump);
  setBoolIf(out, 'hasDoubleJumped', p.hasDoubleJumped);
  setBoolIf(out, 'wallHolding', p.wallHolding);
  setNumberIf(out, 'wallNormalX', p.wallNormalX);
  setNumberIf(out, 'wallNormalZ', p.wallNormalZ);
  setNumberIf(out, 'wallJumpWindowTimer', p.wallJumpWindowTimer);
  setNumberIf(out, 'wallAttachCooldownTimer', p.wallAttachCooldownTimer);
  setNumberIf(out, 'deathTime', p.deathTime);
  setNumberIf(out, 'deaths', p.deaths);
  setNumberIf(out, 'longestChaseSeconds', p.longestChaseSeconds);
  setNumberIf(out, 'chaseStreakSeconds', p.chaseStreakSeconds);
  setNumberIf(out, 'cheeseCarried', p.cheeseCarried);
  setValueIf(out, 'emote', p.emote);
  setValueIf(out, 'roombaLaunch', p.roombaLaunch);
  setValueIf(out, 'ropeSwing', p.ropeSwing);
  setValueIf(out, 'grabbedBy', p.grabbedBy);
  setValueIf(out, 'grabbedTarget', p.grabbedTarget);
  setValueIf(out, 'grabbedBallId', p.grabbedBallId);
  setValueIf(out, 'mountId', p.mountId);
  setBoolIf(out, 'droneNextRound', p.droneNextRound);
  setBoolIf(out, 'isDrone', p.isDrone);
  setNumberIf(out, 'smackStunTimer', p.smackStunTimer);
  setNumberIf(out, 'chargedSmackHitSeq', p.chargedSmackHitSeq);
  setNumberIf(out, 'smackLimpThrowWindowTimer', p.smackLimpThrowWindowTimer);
  setNumberIf(out, 'limpThrownBounceTimer', p.limpThrownBounceTimer);
  setNumberIf(out, 'limpBounceHitSeq', p.limpBounceHitSeq);
  setNumberIf(out, 'burnTimer', p.burnTimer);
  setNumberIf(out, 'burnEffectSeq', p.burnEffectSeq);
  setBoolIf(out, 'spectator', p.spectator);
  setBoolIf(out, 'extracted', p.extracted);
  setNumberIf(out, 'extractProgress', p.extractProgress);
  if (hasRoundStatsValue(p.roundStats)) out.roundStats = p.roundStats;
  setBoolIf(out, 'heroAvailable', p.heroAvailable);
  setBoolIf(out, 'isHero', p.isHero);
  setValueIf(out, 'heroAvatar', p.heroAvatar);
  setNumberIf(out, 'heroTimeRemaining', p.heroTimeRemaining);
  setValueIf(out, 'heroAvatarAvailable', p.heroAvatarAvailable);
  setNumberIf(out, 'sewingCollected', p.sewingCollected);
  setNumberIf(out, 'speedTokensCollected', p.speedTokensCollected);
  setBoolIf(out, 'isAdversary', p.isAdversary);
  setValueIf(out, 'adversaryRole', p.adversaryRole);
  setNumberIf(out, 'adversarySafeSeconds', p.adversarySafeSeconds);
  setNumberIf(out, 'adversarySafeStreakSeconds', p.adversarySafeStreakSeconds);
  return out;
}

function serializePlayers(players) {
  const out = {};
  for (const [id, state] of players instanceof Map ? players : Object.entries(players ?? {})) {
    out[id] = serializePlayerState(state);
  }
  return out;
}

export function buildInitPayload(runtime, connectionId) {
  return {
    type: 'init',
    id: connectionId,
    players: serializePlayers(runtime.players),
    predators: serializePredators(runtime.predators),
    mounts: runtime.mountWorld?.getMountsState?.() ?? [],
    pushBalls: runtime.pushBallWorld.getBallsState(),
    cheesePickups: runtime.cheeseWorld.serializePickups(),
    ropes: runtime.ropeWorld.getRopesSnapshot(),
    fans: runtime.fanWorld.serialize(),
    physicalTasks: serializePhysicalTaskStates(runtime),
    completedTaskIds: [...(runtime._completedRaidTaskIds?.() ?? [])],
    round: runtime.round,
    adversary: buildAdversaryPayload(runtime),
    extractionPortals: runtime.round.phase === 'extract' ? runtime.extractionPortalDefs : [],
    heroClaims: { ...runtime.heroClaims },
    unlockItems: runtime.unlockItems.filter((it) => !it.consumed),
  };
}

export function buildSnapshotPayload(runtime, seqs, players = Object.fromEntries(runtime.players)) {
  return {
    type: 'snapshot',
    tick: Date.now(),
    seqs,
    players: serializePlayers(players),
    predators: serializePredators(runtime.predators),
    mounts: runtime.mountWorld?.getMountsState?.() ?? [],
    pushBalls: runtime.pushBallWorld.getBallsState(),
    cheesePickups: runtime.cheeseWorld.serializePickups(),
    ropes: runtime.ropeWorld.getRopesSnapshot(),
    fans: runtime.fanWorld.serialize(),
    physicalTasks: serializePhysicalTaskStates(runtime),
    completedTaskIds: [...(runtime._completedRaidTaskIds?.() ?? [])],
    round: runtime.round,
    adversary: buildAdversaryPayload(runtime),
    extractionPortals: runtime.round.phase === 'extract' ? runtime.extractionPortalDefs : [],
  };
}
