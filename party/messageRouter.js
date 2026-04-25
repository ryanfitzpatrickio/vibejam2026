import { applyPortalArrivalToPlayerState, sanitizePortalArrivalPayload } from '../shared/vibePortal.js';
import { isValidDevSyncLayout } from '../shared/devLayoutValidation.js';
import { sanitizePlayerInputMessage } from '../shared/playerInputSanitize.js';
import { sanitizeDisplayName } from '../shared/displayName.js';

function getPartyEnv(room, key) {
  return room.env?.[key] ?? room.context?.env?.[key] ?? undefined;
}

function isDevLayoutSyncEnabled(room) {
  const v = getPartyEnv(room, 'DEV_LAYOUT_SYNC_ENABLED');
  return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';
}

function getDevLayoutSyncToken(room) {
  const t = getPartyEnv(room, 'DEV_LAYOUT_SYNC_TOKEN');
  return typeof t === 'string' ? t : '';
}

async function handleHello(runtime, sender, data) {
  const playerHello = runtime.players.get(sender.id);
  if (playerHello && typeof data.displayName === 'string') {
    playerHello.displayName = sanitizeDisplayName(data.displayName);
    runtime.stats?.recordDisplayName(sender.id, playerHello.displayName);
  }

  const portalArrival = sanitizePortalArrivalPayload(data.portal);
  if (portalArrival.active && !runtime.portalArrivals.has(sender.id)) {
    const player = runtime.players.get(sender.id);
    if (applyPortalArrivalToPlayerState(player, portalArrival, runtime.portalPlacements)) {
      runtime.portalArrivals.add(sender.id);
      runtime._sendToConnection(sender, JSON.stringify({
        type: 'portal-spawn',
        player,
      }));
      runtime.broadcast(JSON.stringify({
        type: 'player-joined',
        player,
      }), [sender.id]);
    }
  }

  try {
    await runtime.stats?.identifyConnection(sender.id, data.playerKey, playerHello?.displayName);
  } catch (error) {
    console.warn('[stats] failed to identify player:', error);
  }
}

function handleInput(runtime, sender, data) {
  const queue = runtime.inputQueues.get(sender.id);
  if (queue && queue.length < 8) {
    queue.push(sanitizePlayerInputMessage(data));
  }
}

function handleSpawnExtraBall(runtime, sender, { maxExtraBallSpawns }) {
  const player = runtime.players.get(sender.id);
  if (!player?.alive) return;
  const used = runtime._playerExtraBallSpawnCount.get(sender.id) ?? 0;
  if (used >= maxExtraBallSpawns) return;
  const now = Date.now();
  const last = runtime._spawnBallCooldown.get(sender.id) ?? 0;
  if (now - last < 240) return;
  runtime._spawnBallCooldown.set(sender.id, now);
  const ok = runtime.pushBallWorld.spawnExtraBallNear(player.position, player.rotation);
  if (ok) {
    runtime._playerExtraBallSpawnCount.set(sender.id, used + 1);
  }
}

function handleDevSyncLayout(runtime, data) {
  if (!isDevLayoutSyncEnabled(runtime.room)) return;
  const expected = getDevLayoutSyncToken(runtime.room);
  if (!expected || typeof data.syncToken !== 'string' || data.syncToken !== expected) return;
  if (!isValidDevSyncLayout(data.layout)) return;
  runtime._applyLayout(data.layout, { resetPredators: true });
}

export async function handleGameMessage(runtime, sender, data, options = {}) {
  if (data.type === 'hello') {
    await handleHello(runtime, sender, data);
    return;
  }

  if (data.type === 'input') {
    handleInput(runtime, sender, data);
    return;
  }

  if (data.type === 'task-complete') {
    runtime._handleTaskComplete(sender.id, data);
    return;
  }

  if (data.type === 'squeak') {
    runtime._handleSqueak(sender.id);
    return;
  }

  if (data.type === 'spawn-extra-ball') {
    handleSpawnExtraBall(runtime, sender, options);
    return;
  }

  if (data.type === 'unlock-pickup') {
    runtime._handleUnlockPickup(sender.id, data);
    return;
  }

  if (data.type === 'claim-hero') {
    runtime._handleClaimHero(sender.id, data);
    return;
  }

  if (data.type === 'dev-sync-layout') {
    handleDevSyncLayout(runtime, data);
  }
}
