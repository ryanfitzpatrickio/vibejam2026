import { playerChaseRecordSeconds } from '../../shared/chaseScore.js';

function scoreboardLabel(id, localId) {
  if (id === localId) return 'You';
  if (typeof id === 'string' && id.startsWith('bot-')) return `Bot ${id.slice(4)}`;
  if (typeof id === 'string' && id.length > 12) return id.slice(0, 8);
  return String(id);
}

function scoreboardRowLabel(id, localId, playerState) {
  const dn = typeof playerState?.displayName === 'string' && playerState.displayName.trim()
    ? playerState.displayName.trim()
    : '';
  if (dn) return id === localId ? `${dn} (you)` : dn;
  return scoreboardLabel(id, localId);
}

export function buildScoreboardRows(net, predictionState) {
  const localId = net.localId;
  if (!localId) return [];
  if (!net.connected) {
    const selfName = predictionState.displayName?.trim() || 'You';
    return [{
      label: `${selfName} (you)`,
      deaths: predictionState.deaths ?? 0,
      chaseSec: playerChaseRecordSeconds(predictionState),
      cheese: Math.max(0, Math.floor(predictionState.cheeseCarried ?? 0)),
    }];
  }
  const byId = new Map();
  byId.set(localId, net.serverState ?? predictionState);
  for (const [id, playerState] of net.remotePlayers) byId.set(id, playerState);
  const rows = [...byId.entries()].map(([id, playerState]) => ({
    label: scoreboardRowLabel(id, localId, playerState),
    deaths: playerState.deaths ?? 0,
    chaseSec: playerChaseRecordSeconds(playerState),
    cheese: Math.max(0, Math.floor(playerState.cheeseCarried ?? 0)),
    role: playerState.isAdversary ? 'Human' : 'Mouse',
    adversarySafeSeconds: playerState.adversarySafeSeconds ?? 0,
  }));
  rows.sort(
    (a, b) => b.chaseSec - a.chaseSec
      || b.cheese - a.cheese
      || b.deaths - a.deaths
      || a.label.localeCompare(b.label),
  );
  return rows.slice(0, 10);
}
