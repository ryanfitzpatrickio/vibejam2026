export function createOfflineNetClient(roomId = 'offline') {
  return {
    ws: null,
    roomId,
    localId: 'offline-local',
    connected: false,
    remotePlayers: new Map(),
    remotePredators: new Map(),
    pushBalls: [],
    ropes: [],
    cheesePickups: [],
    round: null,
    extractionPortals: [],
    adversary: { playerId: null, available: false, safeRadius: 0 },
    serverState: null,
    serverSeq: -1,
    ping: 0,
    heroClaims: {},
    unlockItems: [],
    _listeners: new Set(),
    connect() {},
    disconnect() {},
    on(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },
    sendInput() { return 0; },
    sendSpawnExtraBall() {},
    sendTaskComplete() {},
    sendSqueak() {},
    sendUnlockPickup() {},
    sendClaimHero() {},
    sendDisplayName() {},
    async fetchLeaderboard() { return null; },
  };
}
