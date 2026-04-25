import { PREDATOR_AI } from '../shared/predator.js';

export function emitNoise(predators, player, radius = 10, threat = 180) {
  if (!player?.position || player.spectator || player.extracted || player.isAdversary) return;
  const hearingRadius = Math.max(0, Number(radius) || 0);
  if (hearingRadius <= 0) return;
  for (const predator of predators) {
    if (!predator || predator.type !== 'cat' || predator.alive === false) continue;
    const dx = predator.position.x - player.position.x;
    const dz = predator.position.z - player.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > hearingRadius * hearingRadius) continue;

    if (typeof predator._baseAggroRange !== 'number') {
      predator._baseAggroRange = predator.aggroRange;
    }
    predator._noiseAggroTimer = Math.max(Number(predator._noiseAggroTimer) || 0, 4.5);
    predator.aggroRange = Math.max(predator.aggroRange, hearingRadius);
    predator.chaseTargetId = player.id;
    predator.aggroTargetId = player.id;
    predator.aggroTargetThreat = Math.max(Number(predator.aggroTargetThreat) || 0, threat);
    if (
      predator.aiState !== PREDATOR_AI.CHASE
      && predator.aiState !== PREDATOR_AI.ATTACK
      && predator.aiState !== PREDATOR_AI.STUNNED
      && predator.aiState !== PREDATOR_AI.DEATH
    ) {
      predator.aiState = PREDATOR_AI.ALERT;
      predator.aiTimer = Math.max(predator.aiTimer ?? 0, predator.alertDuration ?? 0.5);
    }
  }
}

export function tickNoiseAggro(predators, dt) {
  for (const predator of predators) {
    if (!predator || typeof predator._noiseAggroTimer !== 'number') continue;
    predator._noiseAggroTimer = Math.max(0, predator._noiseAggroTimer - dt);
    if (predator._noiseAggroTimer <= 0) {
      if (typeof predator._baseAggroRange === 'number') {
        predator.aggroRange = predator._baseAggroRange;
      }
      delete predator._noiseAggroTimer;
      delete predator._baseAggroRange;
    }
  }
}

export function handleSqueak({
  players,
  predators,
  squeakCooldown,
  broadcast,
}, senderId) {
  const player = players.get(senderId);
  if (!player?.position) return;
  const now = Date.now();
  const last = squeakCooldown.get(senderId) ?? 0;
  if (now - last < 900) return;
  squeakCooldown.set(senderId, now);

  const isGhost = player.spectator || player.alive === false || player.extracted;
  if (!isGhost) emitNoise(predators, player, 8, 80);

  broadcast(JSON.stringify({
    type: isGhost ? 'ghost-squeak' : 'squeak',
    playerId: senderId,
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    },
  }));
}
