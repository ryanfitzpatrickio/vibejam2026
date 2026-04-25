import { PHYSICS } from '../shared/physics.js';
import { playerChaseRecordSeconds } from '../shared/chaseScore.js';
import { ROUND_DURATIONS } from '../shared/roundState.js';
import { UNLOCK_HERO_DEFS } from '../shared/heroUnlocks.js';
import { LEVEL_WORLD_BOUNDS_XZ } from '../shared/levelWorldBounds.js';
import { RAID_TASK_TYPES } from '../shared/raidLayout.js';
import { findRaidTaskById } from './taskSystem.js';

const HERO_AVATAR_KEYS = ['brain', 'jerry'];
const HERO_MODE_DURATION_SECONDS = 50;
const HERO_MODE_DURATION_BY_AVATAR = Object.freeze({
  jerry: 60,
  brain: 50,
  speedy: 44,
  gus: 55,
});

function getPartyEnv(room, key) {
  return room.env?.[key] ?? room.context?.env?.[key] ?? undefined;
}

function isDevLayoutSyncEnabled(room) {
  const v = getPartyEnv(room, 'DEV_LAYOUT_SYNC_ENABLED');
  return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';
}

export function pickHeroAvatar() {
  return HERO_AVATAR_KEYS[Math.floor(Math.random() * HERO_AVATAR_KEYS.length)];
}

export function scatterUnlockItems(bounds = LEVEL_WORLD_BOUNDS_XZ) {
  const items = [];
  const minX = bounds?.minX ?? -18;
  const maxX = bounds?.maxX ?? 18;
  const minZ = bounds?.minZ ?? -18;
  const maxZ = bounds?.maxZ ?? 18;
  const make = (kind, count) => {
    for (let i = 0; i < count; i += 1) {
      items.push({
        id: `unlock-${kind}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        x: minX + Math.random() * (maxX - minX),
        y: 0.2,
        z: minZ + Math.random() * (maxZ - minZ),
        consumed: false,
      });
    }
  };
  make('sewing', UNLOCK_HERO_DEFS.gus.scatterCount);
  make('speed', UNLOCK_HERO_DEFS.speedy.scatterCount);
  return items;
}

export function maybeElectHero(runtime, wallNow) {
  if (runtime.round.phase !== 'forage') return;
  if (runtime.round.heroCandidateId) return;
  const forageElapsed = ROUND_DURATIONS.forage - (runtime.round.phaseEndsAt - wallNow);
  if (forageElapsed < 120) return;

  let cheeseId = null;
  let cheeseScore = 0;
  let chaseId = null;
  let chaseScore = 0;
  for (const [id, state] of runtime.players) {
    if (!state.alive || state.spectator || state.extracted || state.isAdversary) continue;
    const rs = state.roundStats ?? {};
    const cheese = (rs.cheeseCollected ?? 0) + (state.cheeseCarried ?? 0);
    if (cheese > cheeseScore) {
      cheeseScore = cheese;
      cheeseId = id;
    }
    const chase = playerChaseRecordSeconds(state);
    if (chase > chaseScore) {
      chaseScore = chase;
      chaseId = id;
    }
  }
  if (!cheeseId && !chaseId) return;
  runtime.round = { ...runtime.round, heroCandidateId: cheeseId ?? chaseId };
  if (cheeseId) {
    const leader = runtime.players.get(cheeseId);
    if (leader) {
      leader.heroAvailable = true;
      leader.heroAvatarAvailable = 'jerry';
    }
  }
  if (chaseId && chaseId !== cheeseId) {
    const leader = runtime.players.get(chaseId);
    if (leader) {
      leader.heroAvailable = true;
      leader.heroAvatarAvailable = 'brain';
    }
  }
}

export function handleUnlockPickup(runtime, senderId, data) {
  const player = runtime.players.get(senderId);
  if (!player?.alive) return;
  const itemId = typeof data?.itemId === 'string' ? data.itemId : null;
  if (!itemId) return;
  const now = Date.now();
  const last = runtime._unlockPickupCooldown.get(senderId) ?? 0;
  if (now - last < 120) return;
  runtime._unlockPickupCooldown.set(senderId, now);
  const item = runtime.unlockItems.find((it) => it.id === itemId && !it.consumed);
  if (!item) return;
  const dx = item.x - player.position.x;
  const dz = item.z - player.position.z;
  if (dx * dx + dz * dz > 4) return;
  item.consumed = true;
  if (item.kind === 'sewing') player.sewingCollected = (player.sewingCollected ?? 0) + 1;
  else if (item.kind === 'speed') player.speedTokensCollected = (player.speedTokensCollected ?? 0) + 1;
  runtime.broadcast(JSON.stringify({
    type: 'unlock-pickup-consumed',
    itemId,
    playerId: senderId,
    kind: item.kind,
  }));
}

export function handleClaimHero(runtime, senderId, data) {
  const player = runtime.players.get(senderId);
  if (!player?.alive || player.isAdversary || player.isHero) return;
  const heroKey = typeof data?.heroKey === 'string' ? data.heroKey : null;
  const def = UNLOCK_HERO_DEFS[heroKey];
  if (!def) return;
  const now = Date.now();
  const last = runtime._claimHeroCooldown.get(senderId) ?? 0;
  if (now - last < 600) return;
  runtime._claimHeroCooldown.set(senderId, now);

  if (runtime.heroClaims[heroKey]) return;

  const counterField = heroKey === 'gus' ? 'sewingCollected' : 'speedTokensCollected';
  const have = player[counterField] ?? 0;
  const devBypass = isDevLayoutSyncEnabled(runtime.room);
  if (!devBypass && have < def.requiredCount) return;

  const expectedTaskType = heroKey === 'gus' ? RAID_TASK_TYPES.UNLOCK_GUS : RAID_TASK_TYPES.UNLOCK_SPEEDY;
  const taskId = typeof data.taskId === 'string' ? data.taskId : null;
  if (taskId) {
    const task = findRaidTaskById(runtime._layout, taskId);
    if (!task || task.taskType !== expectedTaskType) return;
    const dx = (task.position?.x ?? 0) - player.position.x;
    const dz = (task.position?.z ?? 0) - player.position.z;
    if (dx * dx + dz * dz > 9) return;
  }

  player[counterField] = Math.max(0, have - def.requiredCount);
  runtime.heroClaims[heroKey] = senderId;
  startHeroMode(player, heroKey);

  runtime.broadcast(JSON.stringify({
    type: 'hero-claimed',
    playerId: senderId,
    heroKey,
    taskId: taskId ?? null,
  }));
}

export function endHeroMode(state) {
  state.isHero = false;
  state.heroAvatar = null;
  state.heroTimeRemaining = 0;
}

export function startHeroMode(state, heroAvatar = pickHeroAvatar()) {
  state.isHero = true;
  state.heroAvailable = false;
  state.health = heroAvatar === 'gus' ? PHYSICS.maxHealth + 1 : PHYSICS.maxHealth;
  state.stamina = PHYSICS.maxStamina;
  state.heroAvatar = heroAvatar;
  state.heroAvatarAvailable = null;
  state.heroTimeRemaining = HERO_MODE_DURATION_BY_AVATAR[heroAvatar] ?? HERO_MODE_DURATION_SECONDS;
}

export function tickHeroTimers(players, dt) {
  for (const state of players.values()) {
    if (!state.isHero) {
      state.heroTimeRemaining = 0;
      continue;
    }

    state.heroTimeRemaining = Math.max(0, (state.heroTimeRemaining ?? HERO_MODE_DURATION_SECONDS) - dt);
    if (state.heroTimeRemaining <= 0) {
      endHeroMode(state);
    }
  }
}
