/**
 * Server-side mouse bot steering on the mouse navmesh (includes mouse-only areas).
 * Cats use the cat navmesh in predator.js; bots must use the mouse nav mesh only.
 */

import {
  findPath,
  createDefaultQueryFilter,
  findRandomPoint,
  findRandomPointAroundCircle,
  findNearestPoly,
  createFindNearestPolyResult,
} from 'navcat';
import { NAV_AGENT_CONFIGS } from './navConfig.js';

const MOUSE_NAV_FILTER = createDefaultQueryFilter();
const MOUSE_HALF_EXTENTS = NAV_AGENT_CONFIGS.mouse.queryHalfExtents;

const REPATH_INTERVAL = 0.35;
const WAYPOINT_REACH_DIST_SQ = 0.38 * 0.38;
const TARGET_REPATH_DIST_SQ = 0.7 * 0.7;
const WANDER_TIMER_MIN = 1.35;
const WANDER_TIMER_MAX = 3.8;
const FLEE_DURATION = 2.8;
const FLEE_TRIGGER_DIST = 8.2;
const FLEE_RUN_DISTANCE = 6;
const VERTICAL_ESCAPE_TRIGGER_DIST = 9.5;
const VERTICAL_ESCAPE_SAFE_DIST = 13.5;
const VERTICAL_ESCAPE_SAFE_TIME = 2.4;
const VERTICAL_ESCAPE_MIN_SURFACE_Y = 0.72;
const VERTICAL_ESCAPE_MAX_SURFACE_Y = 3.6;
const VERTICAL_ESCAPE_MIN_RISE = 0.62;
const VERTICAL_ESCAPE_PICK_ATTEMPTS = 36;
const VERTICAL_ESCAPE_GOAL_REFRESH = 1.2;
const VERTICAL_ESCAPE_REACHED_DIST_SQ = 1.25 * 1.25;
const VERTICAL_ESCAPE_PERCH_MIN_Y = 0.58;
const VERTICAL_CLIMB_JUMP_COOLDOWN = 0.38;
const VERTICAL_CLIMB_WALL_JUMP_COOLDOWN = 0.85;
const VERTICAL_PROGRESS_STALL_TIME = 1.45;
const CHEESE_TARGET_REFRESH_MIN = 0.65;
const CHEESE_TARGET_REFRESH_MAX = 1.25;
const CHEESE_CANDIDATE_LIMIT = 18;
const CHEESE_REACHED_DIST_SQ = 0.95 * 0.95;
const CHEESE_RESERVED_TARGET_PENALTY = 26;
const CHEESE_PEER_GOAL_PENALTY = 7.5;
const CHEESE_SCORE_JITTER = 8;
const VERTICAL_ESCAPE_SCORE_JITTER = 2.8;
const VERTICAL_ESCAPE_PEER_GOAL_PENALTY = 4.5;
const TEASE_PERCH_MIN_TIME = 2.4;
const TEASE_PERCH_MAX_TIME = 4.8;
const TEASE_EMOTE_MIN_INTERVAL = 3.4;
const TEASE_EMOTE_MAX_INTERVAL = 6.2;
const TEASE_EMOTE_DURATION = 0.75;
const TEASE_EMOTES = ['laugh', 'dance', 'wave', 'thumbsup', 'scream'];

/** Prefer goals at least this far from other alive players (reduces clumping). */
const PEER_GOAL_SEPARATION = 3.8;
const PEER_GOAL_SEPARATION_SQ = PEER_GOAL_SEPARATION * PEER_GOAL_SEPARATION;

const _nearestPolyScratch = createFindNearestPolyResult();
const _nearestCenterScratch = [0, 0, 0];

function distSqXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function createBotPersonality(rand = Math.random) {
  return {
    seed: rand(),
    cheeseGreed: 0.72 + rand() * 0.72,
    distancePatience: 0.72 + rand() * 0.65,
    catRiskAvoidance: 0.55 + rand() * 0.85,
    heightInterest: rand(),
    panicDistanceScale: 0.88 + rand() * 0.24,
    teaseDurationScale: 0.78 + rand() * 0.55,
    teaseFrequencyScale: 0.72 + rand() * 0.72,
  };
}

function ensureBotPersonality(brain) {
  if (!brain.personality) brain.personality = createBotPersonality();
  return brain.personality;
}

function stableNoise(seed, key) {
  let h = Math.floor((seed || 0.5) * 2147483647) >>> 0;
  const s = String(key ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967295;
}

function isReservedCheese(goal, reservedCheeseIds) {
  if (!goal?.id || !reservedCheeseIds) return false;
  if (typeof reservedCheeseIds.has === 'function') return reservedCheeseIds.has(goal.id);
  return Array.isArray(reservedCheeseIds) && reservedCheeseIds.includes(goal.id);
}

function isGoalTooCloseToReservedGoals(goal, reservedGoalPositions) {
  if (!reservedGoalPositions?.length) return false;
  for (const p of reservedGoalPositions) {
    if (!p) continue;
    if (distSqXZ(goal, p) < PEER_GOAL_SEPARATION_SQ) return true;
  }
  return false;
}

function normalizeXZ(x, z) {
  const len = Math.sqrt(x * x + z * z);
  if (len < 1e-4) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

function clampXZ(x, z, bounds, pad) {
  const r = pad ?? 0.35;
  return {
    x: Math.min(bounds.maxX - r, Math.max(bounds.minX + r, x)),
    y: 0,
    z: Math.min(bounds.maxZ - r, Math.max(bounds.minZ + r, z)),
  };
}

function idleInput(rotation, emote = null) {
  return {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jump: false,
    jumpPressed: false,
    jumpHeld: false,
    crouch: false,
    rotation,
    emote,
  };
}

function clearBotPath(brain) {
  brain.navRepathTimer = 0;
  brain.navPath = [];
  brain.navPathIndex = 0;
  brain.navTarget = null;
}

function clearBotGoal(brain) {
  brain.goal = null;
  brain.goalKind = 'none';
  brain.cheeseTargetId = null;
  clearBotPath(brain);
}

function rebuildBotPath(brain, from, to, navMesh) {
  const result = findPath(
    navMesh,
    [from.x, from.y, from.z],
    [to.x, to.y, to.z],
    MOUSE_HALF_EXTENTS,
    MOUSE_NAV_FILTER,
  );
  brain.navTarget = { x: to.x, y: to.y, z: to.z };
  brain.navRepathTimer = REPATH_INTERVAL;

  if (!result.success || !Array.isArray(result.path) || result.path.length === 0) {
    brain.navPath = [];
    brain.navPathIndex = 0;
    return false;
  }

  brain.navPath = result.path.map((p) => ({
    x: p.position[0],
    y: p.position[1],
    z: p.position[2],
  }));
  brain.navPathIndex = brain.navPath.length > 1 ? 1 : 0;
  return true;
}

function shouldRepath(brain, target) {
  if (brain.navRepathTimer <= 0) return true;
  if (!brain.navPath?.length) return true;
  if (brain.navPathIndex >= brain.navPath.length) return true;
  if (!brain.navTarget || !target) return true;
  return distSqXZ(brain.navTarget, target) >= TARGET_REPATH_DIST_SQ;
}

function isGoalTooCloseToPeers(goal, peerPositions) {
  if (!peerPositions?.length) return false;
  for (const p of peerPositions) {
    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    if (dx * dx + dz * dz < PEER_GOAL_SEPARATION_SQ) return true;
  }
  return false;
}

function randomMouseNavPointNear(state, navMesh, rand) {
  _nearestCenterScratch[0] = state.position.x;
  _nearestCenterScratch[1] = state.position.y;
  _nearestCenterScratch[2] = state.position.z;
  findNearestPoly(
    _nearestPolyScratch,
    navMesh,
    _nearestCenterScratch,
    MOUSE_HALF_EXTENTS,
    MOUSE_NAV_FILTER,
  );
  if (!_nearestPolyScratch.success) return null;

  const local = findRandomPointAroundCircle(
    navMesh,
    _nearestPolyScratch.nodeRef,
    _nearestPolyScratch.position,
    4 + rand() * 8,
    MOUSE_NAV_FILTER,
    rand,
  );
  if (!local.success) return null;
  return {
    x: local.position[0],
    y: local.position[1],
    z: local.position[2],
  };
}

function randomMouseNavPoint(navMesh, rand) {
  const g = findRandomPoint(navMesh, MOUSE_NAV_FILTER, rand);
  if (!g.success) return null;
  return {
    x: g.position[0],
    y: g.position[1],
    z: g.position[2],
  };
}

function canPathToGoal(state, goal, navMesh) {
  const result = findPath(
    navMesh,
    [state.position.x, state.position.y, state.position.z],
    [goal.x, goal.y, goal.z],
    MOUSE_HALF_EXTENTS,
    MOUSE_NAV_FILTER,
  );
  return result.success && Array.isArray(result.path) && result.path.length > 0;
}

function asGoalFromCheese(cheese) {
  if (!cheese) return null;
  return {
    id: cheese.id,
    x: cheese.x,
    y: cheese.y,
    z: cheese.z,
    amount: cheese.amount ?? 1,
  };
}

function chooseWeightedScored(scored, rand = Math.random) {
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, Math.min(5, scored.length));
  const best = pool[0].score;
  let total = 0;
  for (const item of pool) {
    item.weight = Math.max(0.04, Math.exp((item.score - best) / 7));
    total += item.weight;
  }
  let r = rand() * total;
  for (const item of pool) {
    r -= item.weight;
    if (r <= 0) return item.goal;
  }
  return pool[0].goal;
}

function pickCheeseGoal(
  state,
  brain,
  navMesh,
  cheesePickups,
  nearestCat,
  peerPositions,
  reservedCheeseIds,
  reservedGoalPositions,
) {
  if (!Array.isArray(cheesePickups) || cheesePickups.length === 0) return null;

  const personality = ensureBotPersonality(brain);
  const catPos = nearestCat?.position;
  const candidates = cheesePickups
    .map((cheese) => {
      const goal = asGoalFromCheese(cheese);
      if (!goal) return null;
      const selfDistSq = distSqXZ(state.position, goal);
      const catDist = catPos ? Math.sqrt(distSqXZ(goal, catPos)) : 10;
      const noise = (stableNoise(personality.seed, goal.id ?? `${goal.x},${goal.y},${goal.z}`) - 0.5)
        * CHEESE_SCORE_JITTER;
      return {
        goal,
        selfDistSq,
        catDist,
        roughScore: (goal.amount ?? 1) * 8 * personality.cheeseGreed
          - Math.sqrt(selfDistSq) * (0.42 + personality.distancePatience * 0.42)
          + Math.min(catDist, 16) * (0.12 + personality.catRiskAvoidance * 0.22)
          + Math.max(0, goal.y - state.position.y) * (0.2 + personality.heightInterest * 0.7)
          + noise,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.roughScore - a.roughScore)
    .slice(0, CHEESE_CANDIDATE_LIMIT);

  const scored = [];
  for (const candidate of candidates) {
    const goal = candidate.goal;
    if (!canPathToGoal(state, goal, navMesh)) continue;
    const peerPenalty = isGoalTooCloseToPeers(goal, peerPositions) ? CHEESE_PEER_GOAL_PENALTY : 0;
    const reservedGoalPenalty = isGoalTooCloseToReservedGoals(goal, reservedGoalPositions)
      ? CHEESE_PEER_GOAL_PENALTY
      : 0;
    const reservedPenalty = isReservedCheese(goal, reservedCheeseIds) ? CHEESE_RESERVED_TARGET_PENALTY : 0;
    const catTooClosePenalty = candidate.catDist < 3.2 ? 8 * personality.catRiskAvoidance : 0;
    const score = candidate.roughScore - peerPenalty - catTooClosePenalty;
    scored.push({ goal, score: score - reservedPenalty - reservedGoalPenalty });
  }
  return chooseWeightedScored(scored, Math.random);
}

function snapCandidateToMouseNav(candidate, navMesh) {
  findNearestPoly(
    _nearestPolyScratch,
    navMesh,
    [candidate.x, candidate.y, candidate.z],
    MOUSE_HALF_EXTENTS,
    MOUSE_NAV_FILTER,
  );
  if (!_nearestPolyScratch.success) return null;
  const snapped = {
    x: _nearestPolyScratch.position[0],
    y: _nearestPolyScratch.position[1],
    z: _nearestPolyScratch.position[2],
  };
  if (Math.abs(snapped.y - candidate.y) > 0.45) return null;
  if (distSqXZ(snapped, candidate) > 1.4 * 1.4) return null;
  return snapped;
}

function addSupportColliderCandidates(out, state, navMesh, colliders) {
  if (!colliders?.length) return;

  for (const collider of colliders) {
    if (collider?.type === 'wall' || collider?.type === 'loot') continue;
    const box = collider?.aabb;
    if (!box) continue;

    const width = box.max.x - box.min.x;
    const depth = box.max.z - box.min.z;
    if (width < 0.7 || depth < 0.7) continue;
    if (box.max.y < VERTICAL_ESCAPE_MIN_SURFACE_Y || box.max.y > VERTICAL_ESCAPE_MAX_SURFACE_Y) continue;
    if (box.max.y - state.position.y < VERTICAL_ESCAPE_MIN_RISE * 0.55) continue;

    const inset = Math.min(0.55, Math.max(0.12, Math.min(width, depth) * 0.22));
    const candidate = {
      x: Math.min(box.max.x - inset, Math.max(box.min.x + inset, state.position.x)),
      y: box.max.y,
      z: Math.min(box.max.z - inset, Math.max(box.min.z + inset, state.position.z)),
    };
    const distSelfSq = distSqXZ(state.position, candidate);
    if (distSelfSq < 1.0 || distSelfSq > 14 * 14) continue;

    const snapped = snapCandidateToMouseNav(candidate, navMesh);
    if (snapped) out.push(snapped);
  }
}

function isSupportedVerticalEscapeGoal(candidate, colliders) {
  if (!colliders?.length) return true;

  for (const collider of colliders) {
    if (collider?.type === 'wall' || collider?.type === 'loot') continue;
    const box = collider?.aabb;
    if (!box) continue;

    const width = box.max.x - box.min.x;
    const depth = box.max.z - box.min.z;
    if (width < 0.7 || depth < 0.7) continue;

    const withinX = candidate.x >= box.min.x - 0.28 && candidate.x <= box.max.x + 0.28;
    const withinZ = candidate.z >= box.min.z - 0.28 && candidate.z <= box.max.z + 0.28;
    if (!withinX || !withinZ) continue;

    if (Math.abs(candidate.y - box.max.y) <= 0.38) {
      return true;
    }
  }

  return false;
}

function pickVerticalEscapeGoal(state, brain, navMesh, nearestCat, rand, colliders, reservedGoalPositions) {
  let best = null;
  let bestScore = -Infinity;
  const personality = ensureBotPersonality(brain);
  const catPos = nearestCat?.position;
  const candidates = [];
  addSupportColliderCandidates(candidates, state, navMesh, colliders);

  for (let attempt = 0; attempt < VERTICAL_ESCAPE_PICK_ATTEMPTS; attempt += 1) {
    const sampled = (attempt < VERTICAL_ESCAPE_PICK_ATTEMPTS * 0.65)
      ? randomMouseNavPointNear(state, navMesh, rand)
      : randomMouseNavPoint(navMesh, rand);
    if (sampled) candidates.push(sampled);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;

    const rise = candidate.y - state.position.y;
    if (candidate.y > VERTICAL_ESCAPE_MAX_SURFACE_Y) continue;
    if (candidate.y < VERTICAL_ESCAPE_MIN_SURFACE_Y && rise < VERTICAL_ESCAPE_MIN_RISE) continue;
    if (rise < 0.18 && state.position.y < VERTICAL_ESCAPE_PERCH_MIN_Y) continue;
    if (!isSupportedVerticalEscapeGoal(candidate, colliders)) continue;

    const distSelfSq = distSqXZ(state.position, candidate);
    if (distSelfSq < 1.0 || distSelfSq > 14 * 14) continue;

    const pathOk = canPathToGoal(state, candidate, navMesh);
    if (!pathOk) continue;
    const catDist = catPos ? Math.sqrt(distSqXZ(candidate, catPos)) : 0;
    const selfDist = Math.sqrt(distSelfSq);
    const practicalRise = Math.min(Math.max(0, rise), 2.4);
    const key = `${candidate.x.toFixed(1)},${candidate.y.toFixed(1)},${candidate.z.toFixed(1)}`;
    const jitter = (stableNoise(personality.seed, key) - 0.5) * VERTICAL_ESCAPE_SCORE_JITTER;
    const peerGoalPenalty = isGoalTooCloseToReservedGoals(candidate, reservedGoalPositions)
      ? VERTICAL_ESCAPE_PEER_GOAL_PENALTY
      : 0;
    const score = candidate.y * 1.4
      + practicalRise * (2.4 + personality.heightInterest * 1.2)
      + catDist * (0.28 + personality.catRiskAvoidance * 0.28)
      - selfDist * (0.68 + personality.distancePatience * 0.35)
      + jitter
      - peerGoalPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function enterVerticalPerch(brain, now, rand = Math.random) {
  const personality = ensureBotPersonality(brain);
  brain.verticalEscapeMode = 'perch';
  brain.verticalEscapeSafeSince = 0;
  const baseDuration = TEASE_PERCH_MIN_TIME + rand() * (TEASE_PERCH_MAX_TIME - TEASE_PERCH_MIN_TIME);
  brain.teaseUntil = now + baseDuration * personality.teaseDurationScale;
  brain.nextTeaseEmoteAt = now + 0.75 + rand() * 1.25;
  brain.activeEmote = null;
  brain.emoteUntil = 0;
  clearBotPath(brain);
}

function nextTeaseEmote(brain, now, rand = Math.random) {
  const personality = ensureBotPersonality(brain);
  if (brain.activeEmote && now < brain.emoteUntil) return brain.activeEmote;
  brain.activeEmote = null;
  brain.emoteUntil = 0;

  if (now < brain.nextTeaseEmoteAt) return null;

  const emote = TEASE_EMOTES[Math.floor(rand() * TEASE_EMOTES.length)] ?? 'laugh';
  brain.activeEmote = emote;
  brain.emoteUntil = now + TEASE_EMOTE_DURATION;
  brain.nextTeaseEmoteAt = brain.emoteUntil
    + (TEASE_EMOTE_MIN_INTERVAL + rand() * (TEASE_EMOTE_MAX_INTERVAL - TEASE_EMOTE_MIN_INTERVAL))
      * personality.teaseFrequencyScale;
  return emote;
}

/**
 * Pick a walkable exploration point spread across the navmesh, with mild separation from peers.
 */
function pickExploreGoal(state, navMesh, bounds, spawnPoints, peerPositions, rand) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    let pos = null;

    if (navMesh) {
      const tryRegional = rand() < 0.4;
      if (tryRegional) {
        _nearestCenterScratch[0] = state.position.x;
        _nearestCenterScratch[1] = state.position.y;
        _nearestCenterScratch[2] = state.position.z;
        findNearestPoly(
          _nearestPolyScratch,
          navMesh,
          _nearestCenterScratch,
          MOUSE_HALF_EXTENTS,
          MOUSE_NAV_FILTER,
        );
        if (_nearestPolyScratch.success) {
          const maxRadius = 11 + rand() * 13;
          const local = findRandomPointAroundCircle(
            navMesh,
            _nearestPolyScratch.nodeRef,
            _nearestPolyScratch.position,
            maxRadius,
            MOUSE_NAV_FILTER,
            rand,
          );
          if (local.success) {
            pos = {
              x: local.position[0],
              y: local.position[1],
              z: local.position[2],
            };
          }
        }
      }
      if (!pos) {
        const g = findRandomPoint(navMesh, MOUSE_NAV_FILTER, rand);
        if (g.success) {
          pos = {
            x: g.position[0],
            y: g.position[1],
            z: g.position[2],
          };
        }
      }
    }

    if (!pos && spawnPoints?.player?.length) {
      const s = spawnPoints.player[Math.floor(rand() * spawnPoints.player.length)];
      pos = clampXZ(
        s.x + (rand() - 0.5) * 16,
        s.z + (rand() - 0.5) * 16,
        bounds,
        0.5,
      );
      pos.y = s.y;
    }

    if (!pos) {
      const angle = rand() * Math.PI * 2;
      const t = 7 + rand() * 17;
      pos = clampXZ(Math.cos(angle) * t, Math.sin(angle) * t, bounds, 1);
      pos.y = state.position.y;
    }

    if (!isGoalTooCloseToPeers(pos, peerPositions)) return pos;
  }

  const g = navMesh && findRandomPoint(navMesh, MOUSE_NAV_FILTER, rand);
  if (g?.success) {
    return {
      x: g.position[0],
      y: g.position[1],
      z: g.position[2],
    };
  }

  const sp = spawnPoints?.player?.[0];
  if (sp) {
    return {
      x: sp.x,
      y: sp.y,
      z: sp.z,
    };
  }

  return clampXZ(0, 0, bounds, 1);
}

export function createMouseBotBrain() {
  return {
    personality: createBotPersonality(),
    navPath: [],
    navPathIndex: 0,
    navTarget: null,
    navRepathTimer: 0,
    wanderTimer: 0,
    fleeUntil: 0,
    goal: null,
    goalKind: 'none',
    cheeseTargetId: null,
    verticalEscapeActive: false,
    verticalEscapeMode: 'none',
    verticalEscapeSafeSince: 0,
    verticalEscapeGoalRefresh: 0,
    verticalJumpCooldown: 0,
    verticalProgressBestY: 0,
    verticalProgressTimer: 0,
    teaseUntil: 0,
    nextTeaseEmoteAt: 0,
    activeEmote: null,
    emoteUntil: 0,
    throwGrabReleaseAt: 0,
    throwWallHangUntil: 0,
  };
}

export function resetMouseBotBrain(brain) {
  if (!brain) return;
  ensureBotPersonality(brain);
  brain.navPath = [];
  brain.navPathIndex = 0;
  brain.navTarget = null;
  brain.navRepathTimer = 0;
  brain.wanderTimer = 0;
  brain.fleeUntil = 0;
  brain.goal = null;
  brain.goalKind = 'none';
  brain.cheeseTargetId = null;
  brain.verticalEscapeActive = false;
  brain.verticalEscapeMode = 'none';
  brain.verticalEscapeSafeSince = 0;
  brain.verticalEscapeGoalRefresh = 0;
  brain.verticalJumpCooldown = 0;
  brain.verticalProgressBestY = 0;
  brain.verticalProgressTimer = 0;
  brain.teaseUntil = 0;
  brain.nextTeaseEmoteAt = 0;
  brain.activeEmote = null;
  brain.emoteUntil = 0;
  brain.throwGrabReleaseAt = 0;
  brain.throwWallHangUntil = 0;
}

/**
 * @param {object} state Player physics state
 * @param {object} brain Bot brain from createMouseBotBrain
 * @param {object} navMesh Mouse nav mesh JSON
 * @param {object[]} predators Server predator states
 * @param {number} dt Tick delta seconds
 * @param {{ player?: { x: number, y: number, z: number }[] }} spawnPoints
 * @param {object} bounds { minX, maxX, minZ, maxZ }
 * @param {number} now Wall-clock seconds
 * @param {{ peerPositions?: { x: number, z: number }[], cheesePickups?: object[], reservedCheeseIds?: Set<string> | string[], reservedGoalPositions?: { x: number, z: number }[] }} [options] Other alive players and cheese pickups
 */
export function buildMouseBotInput(state, brain, navMesh, predators, dt, spawnPoints, bounds, now, options = {}) {
  const personality = ensureBotPersonality(brain);
  const peerPositions = options.peerPositions;
  const colliders = options.colliders;
  const cheesePickups = options.cheesePickups;
  const reservedCheeseIds = options.reservedCheeseIds;
  const reservedGoalPositions = options.reservedGoalPositions;
  if (!navMesh) {
    return idleInput(state.rotation);
  }

  brain.navRepathTimer -= dt;
  brain.wanderTimer -= dt;
  brain.verticalEscapeGoalRefresh -= dt;
  brain.verticalJumpCooldown = Math.max(0, brain.verticalJumpCooldown - dt);

  let nearestCat = null;
  let nearestCatDistSq = Infinity;
  for (const p of predators) {
    if (!p?.alive) continue;
    const d = distSqXZ(state.position, p.position);
    if (d < nearestCatDistSq) {
      nearestCatDistSq = d;
      nearestCat = p;
    }
  }

  const fleeTriggerDist = FLEE_TRIGGER_DIST * personality.panicDistanceScale;
  const verticalDangerDist = VERTICAL_ESCAPE_TRIGGER_DIST * personality.panicDistanceScale;
  const fleeDistSq = fleeTriggerDist * fleeTriggerDist;
  const verticalDangerDistSq = verticalDangerDist * verticalDangerDist;
  const verticalSafeDistSq = VERTICAL_ESCAPE_SAFE_DIST * VERTICAL_ESCAPE_SAFE_DIST;
  let goal = brain.goal;

  const portals = options.extractionPortals;
  const extractMode = options.roundPhase === 'extract'
    && Array.isArray(portals)
    && portals.length > 0
    && state.alive
    && !state.extracted
    && !state.spectator;

  if (extractMode) {
    let nearestP = portals[0];
    let bestD = distSqXZ(state.position, nearestP);
    for (let i = 1; i < portals.length; i += 1) {
      const ep = portals[i];
      const d = distSqXZ(state.position, ep);
      if (d < bestD) {
        bestD = d;
        nearestP = ep;
      }
    }
    brain.verticalEscapeActive = false;
    brain.cheeseTargetId = null;
    brain.goal = { x: nearestP.x, y: nearestP.y ?? 0, z: nearestP.z };
    brain.goalKind = 'extract_portal';
    goal = brain.goal;
    clearBotPath(brain);
  }

  const alreadyOnHighSurface = state.grounded && state.position.y >= VERTICAL_ESCAPE_PERCH_MIN_Y;
  const perchedHigh = state.grounded
    && state.position.y >= VERTICAL_ESCAPE_PERCH_MIN_Y
    && brain.verticalEscapeActive;

  if (!extractMode && brain.verticalEscapeActive && perchedHigh) {
    if (brain.verticalEscapeMode !== 'perch') enterVerticalPerch(brain, now, Math.random);
  }

  if (!extractMode && brain.verticalEscapeActive && brain.verticalEscapeMode === 'perch') {
    const safe = !nearestCat || nearestCatDistSq > verticalSafeDistSq;
    if (safe) {
      if (!brain.verticalEscapeSafeSince) brain.verticalEscapeSafeSince = now;
      if (now - brain.verticalEscapeSafeSince >= VERTICAL_ESCAPE_SAFE_TIME) {
        brain.verticalEscapeActive = false;
        brain.verticalEscapeMode = 'none';
        brain.verticalEscapeSafeSince = 0;
        brain.teaseUntil = 0;
        brain.activeEmote = null;
        brain.emoteUntil = 0;
        clearBotGoal(brain);
        goal = null;
      }
    } else {
      brain.verticalEscapeSafeSince = 0;
    }

    if (brain.verticalEscapeActive) {
      if (now < brain.teaseUntil) {
        const rotation = nearestCat
          ? Math.atan2(nearestCat.position.x - state.position.x, nearestCat.position.z - state.position.z)
          : state.rotation;
        return idleInput(rotation, nextTeaseEmote(brain, now, Math.random));
      }

      brain.verticalEscapeActive = false;
      brain.verticalEscapeMode = 'none';
      brain.verticalEscapeSafeSince = 0;
      brain.teaseUntil = 0;
      brain.activeEmote = null;
      brain.emoteUntil = 0;
      clearBotGoal(brain);
      goal = null;
    }
  }

  if (!extractMode && nearestCat && nearestCatDistSq < verticalDangerDistSq && !alreadyOnHighSurface) {
    if (
      !brain.verticalEscapeActive
      || !brain.goal
      || brain.verticalEscapeGoalRefresh <= 0
      || brain.goal.y < state.position.y + 0.15
    ) {
      const verticalGoal = pickVerticalEscapeGoal(
        state,
        brain,
        navMesh,
        nearestCat,
        Math.random,
        colliders,
        reservedGoalPositions,
      );
      if (verticalGoal) {
        brain.verticalEscapeActive = true;
        brain.verticalEscapeMode = 'climb';
        brain.verticalEscapeSafeSince = 0;
        brain.verticalEscapeGoalRefresh = VERTICAL_ESCAPE_GOAL_REFRESH;
        brain.verticalProgressBestY = state.position.y;
        brain.verticalProgressTimer = 0;
        brain.goal = verticalGoal;
        brain.goalKind = 'vertical_escape';
        brain.cheeseTargetId = null;
        goal = verticalGoal;
        clearBotPath(brain);
      }
    }
  }

  if (!extractMode && brain.verticalEscapeActive && brain.verticalEscapeMode === 'climb' && brain.goal) {
    goal = brain.goal;
    brain.fleeUntil = now + FLEE_DURATION;
    brain.wanderTimer = WANDER_TIMER_MIN + Math.random() * (WANDER_TIMER_MAX - WANDER_TIMER_MIN);
    if (state.position.y > brain.verticalProgressBestY + 0.12) {
      brain.verticalProgressBestY = state.position.y;
      brain.verticalProgressTimer = 0;
    } else {
      brain.verticalProgressTimer += dt;
    }
    if (brain.verticalProgressTimer > VERTICAL_PROGRESS_STALL_TIME) {
      const verticalGoal = nearestCat
        ? pickVerticalEscapeGoal(
          state,
          brain,
          navMesh,
          nearestCat,
          Math.random,
          colliders,
          reservedGoalPositions,
        )
        : null;
      if (verticalGoal) {
        brain.goal = verticalGoal;
        brain.goalKind = 'vertical_escape';
        brain.cheeseTargetId = null;
        goal = verticalGoal;
        brain.verticalEscapeGoalRefresh = VERTICAL_ESCAPE_GOAL_REFRESH;
        brain.verticalProgressBestY = state.position.y;
        brain.verticalProgressTimer = 0;
        clearBotPath(brain);
      } else {
        brain.verticalEscapeActive = false;
        brain.verticalEscapeMode = 'none';
        brain.verticalProgressTimer = 0;
        brain.verticalProgressBestY = 0;
        clearBotGoal(brain);
        goal = null;
      }
    }
  } else if (!extractMode && nearestCat && nearestCatDistSq < fleeDistSq) {
    brain.fleeUntil = now + FLEE_DURATION;
    const away = normalizeXZ(
      state.position.x - nearestCat.position.x,
      state.position.z - nearestCat.position.z,
    );
    goal = clampXZ(
      state.position.x + away.x * FLEE_RUN_DISTANCE,
      state.position.z + away.z * FLEE_RUN_DISTANCE,
      bounds,
      0.35,
    );
    goal.y = state.position.y;
    brain.goal = goal;
    brain.goalKind = 'flee';
    brain.cheeseTargetId = null;
    clearBotPath(brain);
    brain.wanderTimer = WANDER_TIMER_MIN + Math.random() * (WANDER_TIMER_MAX - WANDER_TIMER_MIN);
  } else if (!extractMode && now < brain.fleeUntil && brain.goal) {
    goal = brain.goal;
  } else if (!extractMode) {
    brain.fleeUntil = 0;
    const currentCheese = brain.cheeseTargetId
      ? cheesePickups?.find((c) => c?.id === brain.cheeseTargetId)
      : null;
    if (
      brain.goalKind === 'cheese'
      && brain.goal
      && distSqXZ(state.position, brain.goal) <= CHEESE_REACHED_DIST_SQ
      && Math.abs((brain.goal.y ?? state.position.y) - state.position.y) < 0.95
    ) {
      brain.wanderTimer = Math.min(brain.wanderTimer, 0.15);
    }

    if (currentCheese && brain.goalKind === 'cheese' && brain.wanderTimer > 0) {
      brain.goal = asGoalFromCheese(currentCheese);
      goal = brain.goal;
    } else if (brain.wanderTimer <= 0 || !brain.goal || brain.goalKind !== 'cheese') {
      const cheeseGoal = pickCheeseGoal(
        state,
        brain,
        navMesh,
        cheesePickups,
        nearestCat,
        peerPositions,
        reservedCheeseIds,
        reservedGoalPositions,
      );
      if (cheeseGoal) {
        brain.wanderTimer = CHEESE_TARGET_REFRESH_MIN
          + Math.random() * (CHEESE_TARGET_REFRESH_MAX - CHEESE_TARGET_REFRESH_MIN);
        brain.goal = cheeseGoal;
        brain.goalKind = 'cheese';
        brain.cheeseTargetId = cheeseGoal.id ?? null;
        goal = brain.goal;
        clearBotPath(brain);
      } else if (brain.wanderTimer <= 0 || !brain.goal) {
        brain.wanderTimer = WANDER_TIMER_MIN + Math.random() * (WANDER_TIMER_MAX - WANDER_TIMER_MIN);
        const rand = Math.random;
        brain.goal = pickExploreGoal(state, navMesh, bounds, spawnPoints, peerPositions, rand);
        brain.goalKind = 'explore';
        brain.cheeseTargetId = null;
        goal = brain.goal;
        clearBotPath(brain);
      } else {
        goal = brain.goal;
      }
    } else {
      goal = brain.goal;
    }
  }

  if (extractMode && brain.goalKind === 'extract_portal' && goal) {
    const dx = state.position.x - goal.x;
    const dz = state.position.z - goal.z;
    if (dx * dx + dz * dz <= 1.12 * 1.12) {
      return {
        moveX: 0,
        moveZ: 0,
        sprint: false,
        jump: false,
        jumpPressed: false,
        jumpHeld: false,
        crouch: false,
        rotation: state.rotation,
        interactHeld: true,
      };
    }
  }

  if (!goal) {
    return idleInput(state.rotation);
  }

  if (shouldRepath(brain, goal)) {
    rebuildBotPath(brain, state.position, goal, navMesh);
  }

  let steer = goal;
  while (brain.navPathIndex < brain.navPath.length) {
    const w = brain.navPath[brain.navPathIndex];
    if (distSqXZ(state.position, w) <= WAYPOINT_REACH_DIST_SQ) {
      brain.navPathIndex += 1;
      continue;
    }
    steer = w;
    break;
  }

  if (
    brain.verticalEscapeActive
    && brain.verticalEscapeMode === 'climb'
    && state.grounded
    && state.position.y >= Math.min(goal.y - 0.22, VERTICAL_ESCAPE_PERCH_MIN_Y)
    && distSqXZ(state.position, goal) <= VERTICAL_ESCAPE_REACHED_DIST_SQ
  ) {
    enterVerticalPerch(brain, now, Math.random);
    return idleInput(state.rotation);
  }

  const dx = steer.x - state.position.x;
  const dz = steer.z - state.position.z;
  const len = Math.sqrt(dx * dx + dz * dz);

  const fleeing = now < brain.fleeUntil && nearestCat && nearestCatDistSq < (fleeTriggerDist + 3) ** 2;
  const sprint = fleeing || len > 5.5;
  const verticalClimb = brain.verticalEscapeActive && brain.verticalEscapeMode === 'climb';
  const targetY = Math.max(goal.y ?? state.position.y, steer.y ?? state.position.y);
  const heightToGain = targetY - state.position.y;
  const shouldClimb = verticalClimb && (heightToGain > 0.18 || !state.grounded || state.wallHolding);

  if (len < 0.06) {
    let jumpPressed = Math.random() < 0.004 && state.grounded;
    let jumpHeld = false;
    if (shouldClimb) {
      jumpHeld = true;
      if (brain.verticalJumpCooldown <= 0) {
        if (state.grounded) {
          jumpPressed = true;
          brain.verticalJumpCooldown = VERTICAL_CLIMB_JUMP_COOLDOWN;
        } else if (state.wallHolding) {
          jumpPressed = true;
          brain.verticalJumpCooldown = VERTICAL_CLIMB_WALL_JUMP_COOLDOWN;
        } else if (state.canDoubleJump && !state.hasDoubleJumped && heightToGain > 0.05) {
          jumpPressed = true;
          brain.verticalJumpCooldown = VERTICAL_CLIMB_JUMP_COOLDOWN;
        }
      }
    }
    return {
      moveX: 0,
      moveZ: 0,
      sprint: verticalClimb,
      jump: jumpPressed,
      jumpPressed,
      jumpHeld,
      crouch: false,
      rotation: state.rotation,
    };
  }

  const mx = dx / len;
  const mz = dz / len;
  const rotation = Math.atan2(mx, mz);
  let jumpPressed = Math.random() < 0.0025 && state.grounded;
  let jumpHeld = false;

  if (shouldClimb) {
    jumpHeld = true;
    const closeToTransition = len < 3.2 || targetY > state.position.y + 0.42;
    if (brain.verticalJumpCooldown <= 0 && closeToTransition) {
      if (state.grounded) {
        jumpPressed = true;
        brain.verticalJumpCooldown = VERTICAL_CLIMB_JUMP_COOLDOWN;
      } else if (state.wallHolding) {
        jumpPressed = true;
        brain.verticalJumpCooldown = VERTICAL_CLIMB_WALL_JUMP_COOLDOWN;
      } else if (state.canDoubleJump && !state.hasDoubleJumped && heightToGain > 0.05) {
        jumpPressed = true;
        brain.verticalJumpCooldown = VERTICAL_CLIMB_JUMP_COOLDOWN;
      }
    }
  }

  return {
    moveX: mx,
    moveZ: mz,
    sprint: sprint || verticalClimb,
    jump: jumpPressed,
    jumpPressed,
    jumpHeld,
    crouch: false,
    rotation,
  };
}
