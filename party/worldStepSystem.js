import { PHYSICS } from '../shared/physics.js';
import { simulatePredatorTick } from '../shared/predator.js';
import { simulateRoombaTick } from '../shared/roomba.js';
import { playerChaseRecordSeconds, tickPlayerChaseScores } from '../shared/chaseScore.js';
import { EXTRACT_HOLD_SECONDS, LIVES_PER_ROUND } from '../shared/roundState.js';
import { MISCHIEF_POINTS } from './interactionTuning.js';

const HOT_SURFACE_COOLDOWN_SECONDS = 0.85;
const HOT_SURFACE_BURN_SECONDS = 3.0;
const HOT_SURFACE_DOT_INTERVAL_SECONDS = 0.75;
const HOT_SURFACE_IMPACT_DAMAGE = 0.65;
const HOT_SURFACE_DOT_DAMAGE = 0.3;
const HOT_SURFACE_UP_VELOCITY = 5.8;
const HOT_SURFACE_AWAY_VELOCITY = 3.4;

function isNearExtractionPortal(px, pz, portals) {
  if (!Array.isArray(portals)) return false;
  for (const p of portals) {
    if (!p) continue;
    const dx = px - p.x;
    const dz = pz - p.z;
    const r = typeof p.radius === 'number' && p.radius > 0 ? p.radius : 1.15;
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}

function killPlayer(runtime, playerId, state) {
  state.deaths = (state.deaths ?? 0) + 1;
  state.livesRemaining = Math.max(0, (state.livesRemaining ?? LIVES_PER_ROUND) - 1);
  state.spectator = state.livesRemaining <= 0;
  state.alive = false;
  state.animState = 'death';
  runtime.cheeseWorld.onDeathDropCarried(state);
  runtime.stats?.recordDeath(playerId);
}

function clearPlayerDrivenAttachments(runtime, playerId, state) {
  state.roombaLaunch = null;
  state.ropeSwing = null;
  runtime.mouseLaunchWorld.removePlayer(playerId);
  runtime.ropeWorld.removePlayer(playerId);
  runtime.fanWorld.removePlayer(playerId);
}

function applyPlayerDamage(runtime, playerId, state, amount) {
  state.health = Math.max(0, (state.health ?? PHYSICS.maxHealth) - amount);
  if (state.health > 0) return false;
  killPlayer(runtime, playerId, state);
  state.burnTimer = 0;
  state.burnTickTimer = 0;
  clearPlayerDrivenAttachments(runtime, playerId, state);
  return true;
}

function stepPredators(runtime, dt, mousePlayersObj) {
  const catPredators = runtime.predators.filter((p) => p.type !== 'roomba');
  for (const pred of runtime.predators) {
    if (pred.type === 'roomba') {
      simulateRoombaTick(
        pred,
        mousePlayersObj,
        catPredators,
        dt,
        runtime.levelColliders,
        runtime.levelRoombaNavMesh,
        runtime.roombaCannonWorld,
        runtime.mouseLaunchWorld,
      );
      continue;
    }
    const hit = simulatePredatorTick(
      pred,
      mousePlayersObj,
      dt,
      runtime.levelColliders,
      runtime.levelNavMesh,
      runtime.pushBallWorld.getBallsForAi(),
    );
    if (!hit) continue;
    const target = runtime.players.get(hit.playerId);
    if (!target?.alive) continue;
    runtime.stats?.recordCatHit(hit.playerId);
    target.health -= hit.damage;
    if (target.health <= 0) {
      target.health = 0;
      killPlayer(runtime, hit.playerId, target);
    }
    target.velocity.x += hit.knockbackX;
    target.velocity.z += hit.knockbackZ;
    if (!target.alive) {
      clearPlayerDrivenAttachments(runtime, hit.playerId, target);
    }
  }
}

function updateCheeseAndRoundStats(runtime, dt, now) {
  tickPlayerChaseScores(
    new Map([...runtime.players].filter(([, p]) => !p?.isAdversary)),
    runtime.predators,
    dt,
  );

  const cheesePre = new Map();
  for (const [pid, st] of runtime.players) {
    cheesePre.set(pid, st.cheeseCarried ?? 0);
  }
  runtime.cheeseWorld.collectFromPlayers(new Map([...runtime.players].filter(([, p]) => !p?.isAdversary)));
  for (const [pid, state] of runtime.players) {
    const prev = cheesePre.get(pid) ?? 0;
    const gained = (state.cheeseCarried ?? 0) - prev;
    if (gained > 0 && state.roundStats) {
      state.roundStats.cheeseCollected += gained;
    }
    if (state.roundStats) {
      state.roundStats.maxCarried = Math.max(state.roundStats.maxCarried, state.cheeseCarried ?? 0);
      state.roundStats.maxChaseStreak = Math.max(
        state.roundStats.maxChaseStreak ?? 0,
        playerChaseRecordSeconds(state),
      );
      if ((Number(state.roundStats.mischiefComboEndsAt) || 0) <= now) {
        state.roundStats.mischiefCombo = 0;
      }
    }
  }
}

function applyHotSurfaces(runtime, dt) {
  for (const [pid, state] of runtime.players) {
    if (!state) continue;
    state.burnTimer = Math.max(0, (Number(state.burnTimer) || 0) - dt);
    state.burnTickTimer = Math.max(0, (Number(state.burnTickTimer) || 0) - dt);
    if (state.burnTimer > 0 && state.burnTickTimer <= 0 && state?.alive && !state.spectator && !state.extracted && !state.isAdversary) {
      state.burnTickTimer = HOT_SURFACE_DOT_INTERVAL_SECONDS;
      if (applyPlayerDamage(runtime, pid, state, HOT_SURFACE_DOT_DAMAGE)) continue;
    }
    if (!state?.alive || state.spectator || state.extracted || state.isAdversary) continue;
    state._hotSurfaceCooldown = Math.max(0, (Number(state._hotSurfaceCooldown) || 0) - dt);
    if (state._hotSurfaceCooldown > 0) continue;
    const px = state.position.x;
    const py = state.position.y;
    const pz = state.position.z;
    const hotSurface = runtime.hotSurfaceZones.find((zone) => (
      px >= zone.minX && px <= zone.maxX
      && py >= zone.minY && py <= zone.maxY
      && pz >= zone.minZ && pz <= zone.maxZ
    ));
    if (!hotSurface) continue;
    state._hotSurfaceCooldown = HOT_SURFACE_COOLDOWN_SECONDS;
    state.burnTimer = Math.max(state.burnTimer, HOT_SURFACE_BURN_SECONDS);
    state.burnTickTimer = HOT_SURFACE_DOT_INTERVAL_SECONDS;
    state.burnEffectSeq = (Number(state.burnEffectSeq) || 0) + 1;

    const awayX = px - (hotSurface.centerX ?? ((hotSurface.minX + hotSurface.maxX) * 0.5));
    const awayZ = pz - (hotSurface.centerZ ?? ((hotSurface.minZ + hotSurface.maxZ) * 0.5));
    const len = Math.hypot(awayX, awayZ) || 1;
    state.velocity.x += (awayX / len) * HOT_SURFACE_AWAY_VELOCITY;
    state.velocity.y = Math.max(state.velocity.y ?? 0, HOT_SURFACE_UP_VELOCITY);
    state.velocity.z += (awayZ / len) * HOT_SURFACE_AWAY_VELOCITY;

    applyPlayerDamage(runtime, pid, state, HOT_SURFACE_IMPACT_DAMAGE);
  }
}

function updateExtraction(runtime, dt, now) {
  if (runtime.round.phase === 'extract') {
    for (const [, state] of runtime.players) {
      if (!state.alive || state.spectator || state.extracted || state.isAdversary) {
        if (!state.extracted) state.extractProgress = 0;
        continue;
      }
      const held = !!state._interactHeld;
      const near = isNearExtractionPortal(state.position.x, state.position.z, runtime.extractionPortalDefs);
      if (held && near) {
        state.extractProgress = Math.min(1, (state.extractProgress ?? 0) + dt / EXTRACT_HOLD_SECONDS);
        if (state.extractProgress >= 1) {
          state.extracted = true;
          state.extractProgress = 1;
          state.animState = 'win';
          state.emote = null;
          state.velocity.x = 0;
          state.velocity.z = 0;
          runtime._awardMischief(state, MISCHIEF_POINTS.extract, now);
        }
      } else {
        state.extractProgress = Math.max(0, (state.extractProgress ?? 0) - dt * 1.15);
      }
    }
  } else {
    for (const state of runtime.players.values()) {
      if (!state.extracted) state.extractProgress = 0;
    }
  }
}

function recordPlayerBests(runtime) {
  for (const [id, state] of runtime.players) {
    if (!runtime.inputQueues.has(id)) continue;
    runtime.stats?.recordPlayerBests(id, {
      displayName: state.displayName,
      chaseSeconds: playerChaseRecordSeconds(state),
      cheeseHeld: state.cheeseCarried ?? 0,
    });
  }
}

export function stepWorldAndScore(runtime, dt, now) {
  runtime.pushBallWorld.syncPlayers(runtime.players);
  runtime.pushBallWorld.step(dt);

  const playersObj = Object.fromEntries(runtime.players);
  const mousePlayersObj = Object.fromEntries(
    [...runtime.players].filter(([, p]) => !p?.isAdversary),
  );

  stepPredators(runtime, dt, mousePlayersObj);
  runtime.mouseLaunchWorld.step(dt, (pid) => runtime.players.get(pid));
  runtime.ropeWorld.step(dt, (pid) => runtime.players.get(pid));
  runtime.fanWorld.step(dt, runtime.players);
  updateCheeseAndRoundStats(runtime, dt, now);
  applyHotSurfaces(runtime, dt);
  updateExtraction(runtime, dt, now);
  runtime._tickAdversaryScores(dt);
  recordPlayerBests(runtime);

  return playersObj;
}
