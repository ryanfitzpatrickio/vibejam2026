import { serializePredatorState } from '../shared/predator.js';
import { serializeRoombaState } from '../shared/roomba.js';
import { ADVERSARY_SAFE_RADIUS, currentAdversaryId } from './adversarySystem.js';

function serializePredators(predators) {
  return predators.map((p) => (p.type === 'roomba' ? serializeRoombaState(p) : serializePredatorState(p)));
}

function buildAdversaryPayload(runtime) {
  const playerId = currentAdversaryId(runtime.players);
  return {
    playerId,
    available: !playerId && runtime.round.phase !== 'intermission',
    safeRadius: ADVERSARY_SAFE_RADIUS,
  };
}

export function buildInitPayload(runtime, connectionId) {
  return {
    type: 'init',
    id: connectionId,
    players: Object.fromEntries(runtime.players),
    predators: serializePredators(runtime.predators),
    mounts: runtime.mountWorld?.getMountsState?.() ?? [],
    pushBalls: runtime.pushBallWorld.getBallsState(),
    cheesePickups: runtime.cheeseWorld.serializePickups(),
    ropes: runtime.ropeWorld.getRopesSnapshot(),
    fans: runtime.fanWorld.serialize(),
    round: runtime.round,
    adversary: buildAdversaryPayload(runtime),
    extractionPortals: runtime.round.phase === 'extract' ? runtime.extractionPortalDefs : [],
    heroClaims: { ...runtime.heroClaims },
    unlockItems: runtime.unlockItems.filter((it) => !it.consumed),
  };
}

export function buildSnapshotPayload(runtime, seqs, players = Object.fromEntries(runtime.players)) {
  return {
    type: 'snapshot',
    tick: Date.now(),
    seqs,
    players,
    predators: serializePredators(runtime.predators),
    mounts: runtime.mountWorld?.getMountsState?.() ?? [],
    pushBalls: runtime.pushBallWorld.getBallsState(),
    cheesePickups: runtime.cheeseWorld.serializePickups(),
    ropes: runtime.ropeWorld.getRopesSnapshot(),
    fans: runtime.fanWorld.serialize(),
    round: runtime.round,
    adversary: buildAdversaryPayload(runtime),
    extractionPortals: runtime.round.phase === 'extract' ? runtime.extractionPortalDefs : [],
  };
}
