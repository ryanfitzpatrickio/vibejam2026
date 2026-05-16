/**
 * Extraction Raid round state & scoring.
 * Authoritative on the server; broadcast as `snapshot.round` each tick.
 *
 * Phases:
 *   forage       — free roam, collect cheese, chase tasks, deaths cost a life
 *   extract      — portals open, stand in one to escape with carried cheese
 *   intermission — round-end score breakdown; next round begins when timer hits 0
 */

export const ROUND_DURATIONS = Object.freeze({
  forage: 210,       // 3:30
  extract: 30,       // 0:30 panic window
  intermission: 15,  // 0:15 score breakdown
});

export const LIVES_PER_ROUND = 2;
export const RESPAWN_SECONDS = 8;
/** Player must be within this XZ radius of an active portal to extract. */
export const EXTRACT_TRIGGER_RADIUS = 1.2;
export const EXTRACT_TRIGGER_RADIUS_SQ = EXTRACT_TRIGGER_RADIUS * EXTRACT_TRIGGER_RADIUS;

/**
 * Task definitions. Progress is tracked per-player in `state.roundStats`.
 * Each task has a completion threshold and a bonus applied once when completed.
 */
export const TASK_DEFS = Object.freeze([
  {
    id: 'hoarder',
    label: 'Hoarder — carry 20 cheese at once',
    target: 20,
    bonusScore: 50,
    progressField: 'maxCarried',
  },
  {
    id: 'brawler',
    label: 'Brawler — smack 3 mice',
    target: 3,
    bonusScore: 50,
    progressField: 'smacksLanded',
  },
  {
    id: 'survivor',
    label: 'Survivor — survive 30s of chase',
    target: 30,
    bonusScore: 50,
    progressField: 'maxChaseStreak',
  },
]);

export function createRoundState({ phase = 'forage', number = 1, now = Date.now() / 1000 } = {}) {
  return {
    number,
    phase,
    phaseEndsAt: now + ROUND_DURATIONS[phase],
  };
}

/** Fresh per-round stats attached to a player state. */
export function createRoundStats() {
  return {
    cheeseCollected: 0,
    maxCarried: 0,
    mischiefScore: 0,
    mischiefCombo: 0,
    mischiefComboEndsAt: 0,
    mischiefEvents: 0,
    smacksLanded: 0,
    grabsInitiated: 0,
    throwsLanded: 0,
    maxChaseStreak: 0,
    totalChaseSeconds: 0,
    tasksCompleted: [],
    /** Final computed score at round end (populated by server). */
    finalScore: 0,
    /** XP awarded (finalScore * 1 if extracted, * 0.2 if failed). */
    xpAwarded: 0,
  };
}

export function resetRoundStats(stats) {
  stats.cheeseCollected = 0;
  stats.maxCarried = 0;
  stats.mischiefScore = 0;
  stats.mischiefCombo = 0;
  stats.mischiefComboEndsAt = 0;
  stats.mischiefEvents = 0;
  stats.smacksLanded = 0;
  stats.grabsInitiated = 0;
  stats.throwsLanded = 0;
  stats.maxChaseStreak = 0;
  stats.totalChaseSeconds = 0;
  stats.tasksCompleted = [];
  stats.finalScore = 0;
  stats.xpAwarded = 0;
}

/**
 * Compute round-end score breakdown for one player.
 * @param {{
 *   cheeseCarried?: number,
 *   extracted?: boolean,
 *   roundStats: ReturnType<typeof createRoundStats>,
 * }} playerState
 */
export function computePlayerRoundScore(playerState) {
  const rs = playerState.roundStats ?? createRoundStats();
  const cheese = playerState.extracted
    ? Math.max(0, Math.floor(playerState.cheeseCarried ?? 0))
    : 0;
  let taskBonus = 0;
  const completed = [];
  for (const task of TASK_DEFS) {
    const progress = rs[task.progressField] ?? 0;
    if (progress >= task.target) {
      taskBonus += task.bonusScore;
      completed.push(task.id);
    }
  }
  const mischief = Math.max(
    0,
    Math.floor(Number(rs.mischiefScore) || ((rs.smacksLanded * 30) + (rs.grabsInitiated * 10))),
  );
  const survival = Math.round(rs.maxChaseStreak);
  // finalScore = cheese * (1 + (tasks+mischief+survival) / 100), clamped so
  // zero-cheese extractions still award something small for effort.
  const bonusPct = (taskBonus + mischief + survival) / 100;
  const baseScore = cheese > 0 ? cheese * (1 + bonusPct) : taskBonus + mischief + survival;
  const finalScore = Math.round(baseScore);
  const xpAwarded = playerState.extracted ? finalScore : Math.round(finalScore * 0.2);
  return {
    cheese,
    taskBonus,
    mischief,
    survival,
    finalScore,
    xpAwarded,
    extracted: !!playerState.extracted,
    completedTaskIds: completed,
  };
}
