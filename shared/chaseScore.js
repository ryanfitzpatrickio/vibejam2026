/**
 * Cat chase duration scoring (server tick). Uses the same hunt AI set as ambient audio.
 */

import { PREDATOR_AI } from './predator.js';

/** @type {ReadonlySet<string>} */
export const CHASE_METRIC_AI_STATES = new Set([
  PREDATOR_AI.ALERT,
  PREDATOR_AI.ROAR,
  PREDATOR_AI.CHASE,
  PREDATOR_AI.CHASE_BALL,
  PREDATOR_AI.ATTACK,
  PREDATOR_AI.COOLDOWN,
]);

/**
 * @param {Iterable<{ alive?: boolean, type?: string, chaseTargetId?: string | null, aiState?: string }>} predators
 * @param {string} playerId
 */
export function isPlayerChasedByCat(predators, playerId) {
  if (!playerId) return false;
  for (const p of predators) {
    if (!p?.alive) continue;
    if (p.type && p.type !== 'cat') continue;
    if (p.chaseTargetId !== playerId) continue;
    if (CHASE_METRIC_AI_STATES.has(p.aiState)) return true;
  }
  return false;
}

/**
 * Updates longestChaseSeconds when a streak ends; grows chaseStreakSeconds while chased.
 * Call once per tick after predator simulation.
 *
 * @param {Map<string, object>} players
 * @param {object[]} predators
 * @param {number} dt
 */
export function tickPlayerChaseScores(players, predators, dt) {
  for (const [id, state] of players) {
    if (!state.alive) {
      const streak = state.chaseStreakSeconds ?? 0;
      if (streak > 0) {
        state.longestChaseSeconds = Math.max(state.longestChaseSeconds ?? 0, streak);
        state.chaseStreakSeconds = 0;
      }
      continue;
    }

    const chased = isPlayerChasedByCat(predators, id);
    if (chased) {
      state.chaseStreakSeconds = (state.chaseStreakSeconds ?? 0) + dt;
    } else {
      const streak = state.chaseStreakSeconds ?? 0;
      if (streak > 0) {
        state.longestChaseSeconds = Math.max(state.longestChaseSeconds ?? 0, streak);
      }
      state.chaseStreakSeconds = 0;
    }
  }
}

/**
 * @param {{ longestChaseSeconds?: number, chaseStreakSeconds?: number } | null | undefined} p
 * @returns {number}
 */
export function playerChaseRecordSeconds(p) {
  if (!p) return 0;
  const longest = Math.max(0, Number(p.longestChaseSeconds) || 0);
  const streak = Math.max(0, Number(p.chaseStreakSeconds) || 0);
  return Math.max(longest, streak);
}
