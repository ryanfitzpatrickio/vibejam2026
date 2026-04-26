import { PHYSICS, respawnPlayer } from '../shared/physics.js';
import { resetMouseBotBrain } from '../shared/mouseBot.js';
import {
  computePlayerRoundScore,
  createRoundStats,
  LIVES_PER_ROUND,
  resetRoundStats,
  ROUND_DURATIONS,
} from '../shared/roundState.js';

export function advanceRoundPhase(runtime, wallNow) {
  if (wallNow < runtime.round.phaseEndsAt) return;
  const phase = runtime.round.phase;
  if (phase === 'forage') {
    runtime.round = {
      ...runtime.round,
      phase: 'extract',
      phaseEndsAt: wallNow + ROUND_DURATIONS.extract,
    };
    runtime.broadcast(JSON.stringify({
      type: 'round-phase',
      phase: 'extract',
      phaseEndsAt: runtime.round.phaseEndsAt,
      number: runtime.round.number,
      message: 'HUMAN COMING HOME! Mouse holes opening — stand in one to extract!',
    }));
    return;
  }
  if (phase === 'extract') {
    finishRound(runtime);
    runtime.round = {
      ...runtime.round,
      phase: 'intermission',
      phaseEndsAt: wallNow + ROUND_DURATIONS.intermission,
    };
    return;
  }
  if (phase === 'intermission') {
    startNewRound(runtime);
    runtime.round = {
      number: runtime.round.number + 1,
      phase: 'forage',
      phaseEndsAt: wallNow + ROUND_DURATIONS.forage,
      heroCandidateId: null,
    };
  }
}

export function finishRound(runtime) {
  const results = [];
  const adversaryResults = [];
  for (const [id, state] of runtime.players) {
    if (state.mountId) {
      runtime.mountWorld?.celebrationDismount?.(id, state);
    }
    if (state.extracted && state.alive && !state.isAdversary) {
      state.animState = 'win';
      state.emote = null;
    }
    const br = computePlayerRoundScore(state);
    state.roundStats.finalScore = br.finalScore;
    state.roundStats.xpAwarded = br.xpAwarded;
    state.roundStats.tasksCompleted = br.completedTaskIds;
    results.push({
      id,
      displayName: state.displayName,
      isBot: !!state.isBot,
      ...br,
      smacksLanded: Math.max(0, Math.floor(Number(state.roundStats.smacksLanded) || 0)),
      grabsInitiated: Math.max(0, Math.floor(Number(state.roundStats.grabsInitiated) || 0)),
      throwsLanded: Math.max(0, Math.floor(Number(state.roundStats.throwsLanded) || 0)),
      mischiefEvents: Math.max(0, Math.floor(Number(state.roundStats.mischiefEvents) || 0)),
      maxCombo: Math.max(0, Math.floor(Number(state.roundStats.mischiefCombo) || 0)),
      tasksCompletedCount: Array.isArray(br.completedTaskIds) ? br.completedTaskIds.length : 0,
      adversarySafeSeconds: Math.round(Math.max(0, Number(state.adversarySafeSeconds) || 0) * 10) / 10,
    });
    if (state.isAdversary || (state.adversarySafeSeconds ?? 0) > 0) {
      const safeSeconds = Math.round(Math.max(0, Number(state.adversarySafeSeconds) || 0) * 10) / 10;
      adversaryResults.push({
        id,
        displayName: state.displayName,
        isBot: !!state.isBot,
        safeSeconds,
      });
      if (runtime.inputQueues.has(id)) {
        runtime.stats?.recordAdversaryScore(id, {
          displayName: state.displayName,
          safeSeconds,
        });
      }
    }
    if (runtime.inputQueues.has(id)) {
      runtime.stats?.recordExtractionRaid(id, {
        xpGained: br.xpAwarded,
        roundScore: br.finalScore,
        extracted: br.extracted,
        displayName: state.displayName,
      });
    }
    if (state.isAdversary) runtime._setAdversary(state, false, id);
  }
  results.sort((a, b) => b.finalScore - a.finalScore);
  adversaryResults.sort((a, b) => b.safeSeconds - a.safeSeconds);
  runtime.broadcast(JSON.stringify({
    type: 'round-end',
    roundNumber: runtime.round.number,
    results,
    adversaryResults,
  }));
}

export function startNewRound(runtime) {
  runtime.pushBallWorld?.resetRound?.(runtime._layout);
  runtime.mountWorld?.resetRound?.(runtime._layout);
  runtime.cheeseWorld.seedScatter();
  runtime.fanWorld?.resetRound?.();
  runtime.heroClaims = { gus: null, speedy: null };
  runtime.unlockItems = runtime._scatterUnlockItems();
  runtime._claimHeroCooldown.clear();
  runtime._unlockPickupCooldown.clear();
  runtime._spawnBallCooldown.clear();
  runtime._playerExtraBallSpawnCount.clear();
  runtime._taskCompleteCooldown.clear();
  runtime._taskCompletionClaims.clear();
  runtime._refreshLevelColliders();
  runtime.broadcast(JSON.stringify({
    type: 'unlock-reset',
    heroClaims: { ...runtime.heroClaims },
    unlockItems: runtime.unlockItems,
  }));
  let idx = 0;
  for (const [id, state] of runtime.players) {
    if (!state.roundStats) state.roundStats = createRoundStats();
    else resetRoundStats(state.roundStats);
    state.livesRemaining = LIVES_PER_ROUND;
    state.spectator = false;
    state.extracted = false;
    state.extractProgress = 0;
    state.cheeseCarried = 0;
    state.isAdversary = false;
    state.adversaryRole = null;
    state.adversarySafeSeconds = 0;
    state.adversarySafeStreakSeconds = 0;
    state.health = PHYSICS.maxHealth;
    state.heroAvailable = false;
    state.isHero = false;
    state.heroAvatar = null;
    state.heroTimeRemaining = 0;
    state.heroAvatarAvailable = null;
    state.deaths = 0;
    state.alive = true;
    state.deathTime = 0;
    state.animState = 'idle';
    state.smackStunTimer = 0;
    state.chargedSmackHitSeq = 0;
    state.smackLimpThrowWindowTimer = 0;
    state.limpThrownBounceTimer = 0;
    state.limpBounceHitSeq = 0;
    state._chargedSmackHoldSeconds = 0;
    state._suppressMountReleaseSmack = false;
    state._chargedJumpHoldSeconds = 0;
    state._chargedThrowHoldSeconds = 0;
    state._chargedThrowOrbitAngle = 0;
    state._chargedThrowAimX = 0;
    state._chargedThrowAimZ = 1;
    state._quickTossHoldSeconds = 0;
    state._quickTossActive = false;
    state._quickTossHeldInput = false;
    state._quickTossAimX = 0;
    state._quickTossAimZ = 1;
    state._nextQuickTossAttemptAt = 0;
    state._grabHeldInput = false;
    state._nextGrabAttemptAt = 0;
    state._roundEndMountCelebrationTimer = 0;
    state._roundEndMountCelebrationGroundY = null;
    state.grabbedBy = null;
    state.grabbedTarget = null;
    state.grabbedBallId = null;
    state.mountId = null;
    state.roombaLaunch = null;
    state.ropeSwing = null;
    const spawn = runtime._pickPlayerSpawn(idx);
    idx += 1;
    respawnPlayer(state, spawn.x, spawn.z, spawn.y);
    runtime.mouseLaunchWorld?.removePlayer?.(id);
    runtime.ropeWorld?.removePlayer?.(id);
    runtime.fanWorld?.removePlayer?.(id);
    runtime.mountWorld?.clearPlayer?.(id, state);
    runtime._lastRopeGrab.delete(id);
    runtime._lastRopeJump?.delete(id);
    if (!runtime.inputQueues.has(id)) {
      resetMouseBotBrain(runtime.botBrains.get(id));
    }
  }
  runtime.predators = [];
  runtime._initPredators();
}
