import { getWavedashSDK } from './wavedashSdk.js';
import {
  fetchWavedashLeaderboards,
  submitWavedashRoundTotals,
  submitWavedashLeaderboardTotals,
} from './wavedashLeaderboards.js';

export { fetchWavedashLeaderboards };

export const WAVEDASH_STATS = Object.freeze({
  totalRounds: Object.freeze({
    id: 'MT_TOTAL_ROUNDS',
    displayName: 'Total Rounds',
  }),
  totalExtractions: Object.freeze({
    id: 'MT_TOTAL_EXTRACTIONS',
    displayName: 'Total Extractions',
  }),
  totalCheeseCollected: Object.freeze({
    id: 'MT_TOTAL_CHEESE_COLLECTED',
    displayName: 'Total Cheese Collected',
  }),
  totalMischief: Object.freeze({
    id: 'MT_TOTAL_MISCHIEF',
    displayName: 'Total Mischief',
  }),
  totalChaseSeconds: Object.freeze({
    id: 'MT_TOTAL_CHASE_SECONDS',
    displayName: 'Total Chase Seconds',
  }),
  totalSmacks: Object.freeze({
    id: 'MT_TOTAL_SMACKS',
    displayName: 'Total Smacks',
  }),
  totalGrabs: Object.freeze({
    id: 'MT_TOTAL_GRABS',
    displayName: 'Total Grabs',
  }),
  totalThrows: Object.freeze({
    id: 'MT_TOTAL_THROWS',
    displayName: 'Total Throws',
  }),
  totalDeaths: Object.freeze({
    id: 'MT_TOTAL_DEATHS',
    displayName: 'Total Deaths',
  }),
  perfectExtractRounds: Object.freeze({
    id: 'MT_PERFECT_EXTRACT_ROUNDS',
    displayName: 'Perfect Extract Rounds',
  }),
});

export const WAVEDASH_ACHIEVEMENTS = Object.freeze([
  Object.freeze({
    id: 'MT_FIRST_RAID',
    displayName: 'First Raid',
    description: 'Finish your first raid round.',
    statRequirement: { stat: WAVEDASH_STATS.totalRounds.id, threshold: 1 },
  }),
  Object.freeze({
    id: 'MT_FIRST_ESCAPE',
    displayName: 'Mouse Hole Rookie',
    description: 'Extract successfully once.',
    statRequirement: { stat: WAVEDASH_STATS.totalExtractions.id, threshold: 1 },
  }),
  Object.freeze({
    id: 'MT_FIRST_CHEESE',
    displayName: 'Tiny Nibble',
    description: 'Collect your first cheese.',
    statRequirement: { stat: WAVEDASH_STATS.totalCheeseCollected.id, threshold: 1 },
  }),
  Object.freeze({
    id: 'MT_FIRST_MISCHIEF',
    displayName: 'Little Menace',
    description: 'Earn your first mischief point.',
    statRequirement: { stat: WAVEDASH_STATS.totalMischief.id, threshold: 1 },
  }),
  Object.freeze({
    id: 'MT_FIRST_CHASE',
    displayName: 'Cat Noticed You',
    description: 'Spend 5 total seconds chased by the cat.',
    statRequirement: { stat: WAVEDASH_STATS.totalChaseSeconds.id, threshold: 5 },
  }),
  Object.freeze({
    id: 'MT_CHEESE_100',
    displayName: 'Cheese Gobbler',
    description: 'Collect 100 lifetime cheese.',
    statRequirement: { stat: WAVEDASH_STATS.totalCheeseCollected.id, threshold: 100 },
  }),
  Object.freeze({
    id: 'MT_MISCHIEF_1000',
    displayName: 'Kitchen Menace',
    description: 'Earn 1,000 lifetime mischief.',
    statRequirement: { stat: WAVEDASH_STATS.totalMischief.id, threshold: 1000 },
  }),
  Object.freeze({
    id: 'MT_CHASE_120',
    displayName: 'Tail Bait',
    description: 'Spend 120 lifetime seconds chased.',
    statRequirement: { stat: WAVEDASH_STATS.totalChaseSeconds.id, threshold: 120 },
  }),
  Object.freeze({
    id: 'MT_ESCAPE_10',
    displayName: 'Reliable Escape Artist',
    description: 'Extract 10 times.',
    statRequirement: { stat: WAVEDASH_STATS.totalExtractions.id, threshold: 10 },
  }),
  Object.freeze({
    id: 'MT_BRAWLER_25',
    displayName: 'Paw-To-Paw',
    description: 'Land 25 smacks.',
    statRequirement: { stat: WAVEDASH_STATS.totalSmacks.id, threshold: 25 },
  }),
  Object.freeze({
    id: 'MT_CHEESE_1000',
    displayName: 'Fromage Fortune',
    description: 'Collect 1,000 lifetime cheese.',
    statRequirement: { stat: WAVEDASH_STATS.totalCheeseCollected.id, threshold: 1000 },
  }),
  Object.freeze({
    id: 'MT_MISCHIEF_10000',
    displayName: 'Household Disaster',
    description: 'Earn 10,000 lifetime mischief.',
    statRequirement: { stat: WAVEDASH_STATS.totalMischief.id, threshold: 10000 },
  }),
  Object.freeze({
    id: 'MT_CHASE_900',
    displayName: 'Nine Lives Energy',
    description: 'Spend 900 lifetime seconds chased.',
    statRequirement: { stat: WAVEDASH_STATS.totalChaseSeconds.id, threshold: 900 },
  }),
  Object.freeze({
    id: 'MT_PERFECT_ESCAPE_5',
    displayName: 'Untouchable',
    description: 'Extract in 5 rounds with zero deaths.',
    statRequirement: { stat: WAVEDASH_STATS.perfectExtractRounds.id, threshold: 5 },
  }),
  Object.freeze({
    id: 'MT_LEGENDARY_FULL_PANTRY',
    displayName: 'Full Pantry Legend',
    description: 'Reach 10,000 cheese, 50,000 mischief, and 3,600 chase seconds lifetime.',
    statRequirement: null,
  }),
]);

export const WAVEDASH_PORTAL_IMPORT = Object.freeze({
  achievements: WAVEDASH_ACHIEVEMENTS.map((achievement) => Object.freeze({
    identifier: achievement.id,
    display_name: achievement.displayName,
    description: achievement.description,
    stat_requirement: achievement.statRequirement
      ? {
        stat: achievement.statRequirement.stat,
        threshold: achievement.statRequirement.threshold,
      }
      : null,
  })),
  stats: Object.values(WAVEDASH_STATS).map((stat) => Object.freeze({
    identifier: stat.id,
    display_name: stat.displayName,
  })),
});

const LEGENDARY_FULL_PANTRY_REQUIREMENTS = Object.freeze({
  cheeseCollected: 10000,
  mischief: 50000,
  chaseSeconds: 3600,
});

function statDeltasFromRound(localResult) {
  const extracted = !!localResult?.extracted;
  const deaths = wholeNumber(localResult?.deaths);
  return {
    [WAVEDASH_STATS.totalRounds.id]: 1,
    [WAVEDASH_STATS.totalExtractions.id]: extracted ? 1 : 0,
    [WAVEDASH_STATS.totalCheeseCollected.id]: wholeNumber(
      localResult?.cheeseCollected ?? localResult?.cheese,
    ),
    [WAVEDASH_STATS.totalMischief.id]: wholeNumber(localResult?.mischief),
    [WAVEDASH_STATS.totalChaseSeconds.id]: wholeNumber(localResult?.chaseSeconds),
    [WAVEDASH_STATS.totalSmacks.id]: wholeNumber(localResult?.smacksLanded),
    [WAVEDASH_STATS.totalGrabs.id]: wholeNumber(localResult?.grabsInitiated),
    [WAVEDASH_STATS.totalThrows.id]: wholeNumber(localResult?.throwsLanded),
    [WAVEDASH_STATS.totalDeaths.id]: deaths,
    [WAVEDASH_STATS.perfectExtractRounds.id]: extracted && deaths === 0 ? 1 : 0,
  };
}

function leaderboardDeltasFromRound(localResult) {
  return {
    mischief: wholeNumber(localResult?.mischief),
    chaseSeconds: wholeNumber(localResult?.chaseSeconds),
    cheeseCollected: wholeNumber(localResult?.cheeseCollected ?? localResult?.cheese),
  };
}

function wholeNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function responseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number(value) || 0;
  if (value && typeof value === 'object') {
    return responseNumber(value.value ?? value.data ?? value.stat ?? value.amount);
  }
  return 0;
}

function getSdkMethod(sdk, names) {
  for (const name of names) {
    if (typeof sdk?.[name] === 'function') return sdk[name].bind(sdk);
  }
  return null;
}

function getStatValue(sdk, statId) {
  const getStat = getSdkMethod(sdk, ['getStat', 'GetStat', 'get_stat']);
  if (getStat) return responseNumber(getStat(statId));
  const getStatInt = getSdkMethod(sdk, ['getStatInt', 'GetStatInt', 'get_stat_int']);
  if (getStatInt) return responseNumber(getStatInt(statId));
  return 0;
}

function setStatValue(sdk, statId, value, storeNow = false) {
  const setStat = getSdkMethod(sdk, ['setStat', 'SetStat', 'set_stat']);
  if (setStat) return setStat(statId, value, storeNow);
  const setStatInt = getSdkMethod(sdk, ['setStatInt', 'SetStatInt', 'set_stat_int']);
  if (setStatInt) return setStatInt(statId, value, storeNow);
  return null;
}

function setAchievementValue(sdk, achievementId, storeNow = false) {
  const setAchievement = getSdkMethod(sdk, ['setAchievement', 'SetAchievement', 'set_achievement']);
  if (!setAchievement) return null;
  return setAchievement(achievementId, storeNow);
}

async function storeStats(sdk) {
  const store = getSdkMethod(sdk, ['storeStats', 'StoreStats', 'store_stats']);
  if (!store) return null;
  return store();
}

async function requestStats(sdk) {
  const request = getSdkMethod(sdk, ['requestStats', 'RequestStats', 'request_stats']);
  if (!request) return null;
  return request();
}

function hasStatsApi(sdk) {
  return !!(
    getSdkMethod(sdk, ['requestStats', 'RequestStats', 'request_stats'])
    && getSdkMethod(sdk, ['getStat', 'GetStat', 'get_stat', 'getStatInt', 'GetStatInt', 'get_stat_int'])
    && getSdkMethod(sdk, ['setStat', 'SetStat', 'set_stat', 'setStatInt', 'SetStatInt', 'set_stat_int'])
    && getSdkMethod(sdk, ['storeStats', 'StoreStats', 'store_stats'])
  );
}

function shouldUnlockFullPantry(totals) {
  return totals[WAVEDASH_STATS.totalCheeseCollected.id] >= LEGENDARY_FULL_PANTRY_REQUIREMENTS.cheeseCollected
    && totals[WAVEDASH_STATS.totalMischief.id] >= LEGENDARY_FULL_PANTRY_REQUIREMENTS.mischief
    && totals[WAVEDASH_STATS.totalChaseSeconds.id] >= LEGENDARY_FULL_PANTRY_REQUIREMENTS.chaseSeconds;
}

export async function submitWavedashProgressFromRound(localResult) {
  const sdk = getWavedashSDK();
  const fallbackLeaderboardSubmit = () => submitWavedashRoundTotals(leaderboardDeltasFromRound(localResult));
  if (!sdk) return null;
  if (!hasStatsApi(sdk)) return fallbackLeaderboardSubmit();

  try {
    await requestStats(sdk);
    const deltas = statDeltasFromRound(localResult);
    const totals = {};
    for (const [statId, delta] of Object.entries(deltas)) {
      const current = getStatValue(sdk, statId);
      const next = Math.max(0, current + delta);
      totals[statId] = next;
      setStatValue(sdk, statId, next, false);
    }

    if (shouldUnlockFullPantry(totals)) {
      setAchievementValue(sdk, 'MT_LEGENDARY_FULL_PANTRY', false);
    }

    await storeStats(sdk);

    void submitWavedashLeaderboardTotals({
      mischief: totals[WAVEDASH_STATS.totalMischief.id],
      chaseSeconds: totals[WAVEDASH_STATS.totalChaseSeconds.id],
      cheeseCollected: totals[WAVEDASH_STATS.totalCheeseCollected.id],
    });

    return { deltas, totals };
  } catch (error) {
    console.warn('[wavedash-progress] failed to submit progress:', error);
    return fallbackLeaderboardSubmit();
  }
}
