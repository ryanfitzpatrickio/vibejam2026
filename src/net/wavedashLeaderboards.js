import { getWavedashSDK } from './wavedashSdk.js';

export const WAVEDASH_LEADERBOARDS = Object.freeze({
  mischief: Object.freeze({
    key: 'mischief',
    name: 'mouse-trouble-total-mischief',
    label: 'Most Mischief',
    displayType: 'NUMERIC',
  }),
  chaseSeconds: Object.freeze({
    key: 'chaseSeconds',
    name: 'mouse-trouble-total-chase-seconds',
    label: 'Total Cat Chase',
    displayType: 'TIME_SECONDS',
  }),
  cheeseCollected: Object.freeze({
    key: 'cheeseCollected',
    name: 'mouse-trouble-total-cheese-collected',
    label: 'Most Cheese Collected',
    displayType: 'NUMERIC',
  }),
});

const leaderboardIdPromises = new Map();

function successData(response) {
  if (response?.success === false) return null;
  return response?.data ?? response ?? null;
}

function sortOrderValue(sdk) {
  return sdk?.LeaderboardSortOrder?.DESC
    ?? sdk?.LeaderboardSortMethod?.DESCENDING
    ?? sdk?.LeaderboardSortMethod?.DESC
    ?? 1;
}

function displayTypeValue(sdk, displayType) {
  return sdk?.LeaderboardDisplayType?.[displayType] ?? (displayType === 'TIME_SECONDS' ? 1 : 0);
}

function sdkMethod(sdk, names) {
  for (const name of names) {
    if (typeof sdk?.[name] === 'function') return sdk[name].bind(sdk);
  }
  return null;
}

async function resolveLeaderboardId(board) {
  const sdk = getWavedashSDK();
  const getLeaderboard = sdkMethod(sdk, ['getLeaderboard', 'GetLeaderboard', 'get_leaderboard']);
  const getOrCreateLeaderboard = sdkMethod(sdk, [
    'getOrCreateLeaderboard',
    'GetOrCreateLeaderboard',
    'get_or_create_leaderboard',
  ]);
  if (!getLeaderboard && !getOrCreateLeaderboard) return null;
  if (!leaderboardIdPromises.has(board.name)) {
    leaderboardIdPromises.set(board.name, (async () => {
      const existing = getLeaderboard ? successData(await getLeaderboard(board.name)) : null;
      if (existing?.id) return existing.id;
      if (!getOrCreateLeaderboard) return null;
      const response = await getOrCreateLeaderboard(
        board.name,
        sortOrderValue(sdk),
        displayTypeValue(sdk, board.displayType),
      );
      return successData(response)?.id ?? null;
    })().catch((error) => {
      leaderboardIdPromises.delete(board.name);
      console.warn('[wavedash-leaderboards] failed to resolve leaderboard:', board.name, error);
      return null;
    }));
  }
  return leaderboardIdPromises.get(board.name);
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    displayName: String(entry.username || entry.displayName || 'Mouse'),
    value: Math.max(0, Number(entry.score) || 0),
    rank: Math.max(0, Math.floor(Number(entry.globalRank) || Number(entry.rank) || 0)),
    userId: entry.userId ?? null,
    avatarUrl: entry.userAvatarUrl ?? null,
  };
}

async function listEntries(board, limit) {
  const sdk = getWavedashSDK();
  if (!sdk?.listLeaderboardEntries) return [];
  const leaderboardId = await resolveLeaderboardId(board);
  if (!leaderboardId) return [];
  const response = await sdk.listLeaderboardEntries(leaderboardId, 0, limit, false);
  const entries = successData(response);
  return Array.isArray(entries) ? entries.map(normalizeEntry).filter(Boolean) : [];
}

async function getMyEntry(board) {
  const sdk = getWavedashSDK();
  if (!sdk?.getMyLeaderboardEntries) return null;
  const leaderboardId = await resolveLeaderboardId(board);
  if (!leaderboardId) return null;
  const response = await sdk.getMyLeaderboardEntries(leaderboardId);
  const entries = successData(response);
  if (!Array.isArray(entries)) return null;
  return entries.map(normalizeEntry).filter(Boolean).sort((a, b) => b.value - a.value)[0] ?? null;
}

async function getMyScore(board) {
  return getMyEntry(board).then((entry) => Math.max(0, Number(entry?.value) || 0));
}

export async function fetchWavedashLeaderboards({ limit = 5 } = {}) {
  const sdk = getWavedashSDK();
  if (!sdk?.listLeaderboardEntries) return null;
  try {
    const boardData = await Promise.all(
      Object.values(WAVEDASH_LEADERBOARDS).map(async (board) => {
        const [entries, myEntry] = await Promise.all([
          listEntries(board, limit),
          getMyEntry(board),
        ]);
        return [board.key, { entries, myEntry }];
      }),
    );
    return {
      leaderboards: Object.fromEntries(boardData.map(([key, value]) => [key, value.entries])),
      myEntries: Object.fromEntries(boardData.map(([key, value]) => [key, value.myEntry])),
    };
  } catch (error) {
    console.warn('[wavedash-leaderboards] failed to fetch leaderboards:', error);
    return null;
  }
}

export async function submitWavedashRoundTotals({
  mischief = 0,
  chaseSeconds = 0,
  cheeseCollected = 0,
} = {}) {
  const sdk = getWavedashSDK();
  if (!sdk?.getOrCreateLeaderboard || !sdk?.getMyLeaderboardEntries || !sdk?.uploadLeaderboardScore) return null;
  const deltas = {
    mischief: Math.max(0, Math.floor(Number(mischief) || 0)),
    chaseSeconds: Math.max(0, Math.round(Number(chaseSeconds) || 0)),
    cheeseCollected: Math.max(0, Math.floor(Number(cheeseCollected) || 0)),
  };
  try {
    const results = {};
    for (const board of Object.values(WAVEDASH_LEADERBOARDS)) {
      const delta = deltas[board.key];
      if (delta <= 0) continue;
      try {
        const leaderboardId = await resolveLeaderboardId(board);
        if (!leaderboardId) continue;
        const current = await getMyScore(board);
        const response = await sdk.uploadLeaderboardScore(leaderboardId, current + delta, true);
        results[board.key] = successData(response);
      } catch (error) {
        console.warn('[wavedash-leaderboards] failed to submit leaderboard:', board.name, error);
      }
    }
    return results;
  } catch (error) {
    console.warn('[wavedash-leaderboards] failed to submit round totals:', error);
    return null;
  }
}

export async function submitWavedashLeaderboardTotals({
  mischief = 0,
  chaseSeconds = 0,
  cheeseCollected = 0,
} = {}) {
  const sdk = getWavedashSDK();
  if (!sdk?.getOrCreateLeaderboard || !sdk?.uploadLeaderboardScore) return null;
  const totals = {
    mischief: Math.max(0, Math.floor(Number(mischief) || 0)),
    chaseSeconds: Math.max(0, Math.round(Number(chaseSeconds) || 0)),
    cheeseCollected: Math.max(0, Math.floor(Number(cheeseCollected) || 0)),
  };
  try {
    const results = {};
    for (const board of Object.values(WAVEDASH_LEADERBOARDS)) {
      if (totals[board.key] <= 0) continue;
      try {
        const leaderboardId = await resolveLeaderboardId(board);
        if (!leaderboardId) continue;
        const response = await sdk.uploadLeaderboardScore(leaderboardId, totals[board.key], true);
        results[board.key] = successData(response);
      } catch (error) {
        console.warn('[wavedash-leaderboards] failed to submit leaderboard:', board.name, error);
      }
    }
    return results;
  } catch (error) {
    console.warn('[wavedash-leaderboards] failed to submit cumulative totals:', error);
    return null;
  }
}
