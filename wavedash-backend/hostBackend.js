import GameRoomRuntime from '../party/gameRoomRuntime.js';
import { buildInitPayload } from '../party/snapshotSystem.js';
import { createMemoryStorage } from './memoryStorage.js';

/**
 * Browser-hosted backend adapter for Wavedash P2P.
 *
 * Wavedash does not provide a dedicated authoritative server. The intended
 * migration path is to let the Wavedash lobby host run the existing room
 * runtime locally, then relay the same JSON messages over Wavedash P2P.
 */

class WavedashHostConnection {
  constructor(id, sendMessage) {
    this.id = id;
    this.readyState = 1;
    this._sendMessage = sendMessage;
  }

  send(message) {
    if (this.readyState !== 1) {
      throw new Error('Cannot send after close');
    }
    this._sendMessage(this.id, message);
  }

  close() {
    this.readyState = 3;
  }
}

export function createWavedashHostBackend({
  roomId = 'wavedash-lobby',
  env = {},
  storage = createMemoryStorage(),
  onSend = () => {},
  onError = (path, error, extra = null) => {
    if (extra) console.error(`[wavedash-host] ${path}`, extra, error);
    else console.error(`[wavedash-host] ${path}`, error);
  },
} = {}) {
  const connections = new Map();
  const room = {
    id: roomId,
    name: roomId,
    env,
    context: { env, bindings: {} },
    storage,
    getConnections() {
      return [...connections.values()].filter((conn) => conn.readyState === 1);
    },
  };

  const runtime = new GameRoomRuntime(room);
  let started = false;

  function getConnection(userId) {
    return connections.get(userId) ?? null;
  }

  async function start() {
    if (started) return;
    started = true;
    await runtime.onStart();
  }

  function connect(userId) {
    const id = String(userId ?? '').trim();
    if (!id) throw new Error('connect requires a Wavedash user id');
    const existing = getConnection(id);
    if (existing) {
      runtime._sendToConnection?.(existing, JSON.stringify(buildInitPayload(runtime, id)));
      return existing;
    }

    const conn = new WavedashHostConnection(id, (targetUserId, message) => {
      onSend(targetUserId, message);
    });
    connections.set(id, conn);

    try {
      runtime.onConnect(conn);
    } catch (error) {
      connections.delete(id);
      conn.close();
      onError('connect', error, { userId: id });
      throw error;
    }

    if (conn.readyState !== 1) {
      connections.delete(id);
    }
    return conn;
  }

  async function receive(userId, message) {
    const conn = getConnection(String(userId ?? ''));
    if (!conn || conn.readyState !== 1) return false;
    await runtime.onMessage(message, conn);
    return true;
  }

  function disconnect(userId) {
    const id = String(userId ?? '');
    const conn = getConnection(id);
    if (!conn) return false;
    connections.delete(id);
    try {
      runtime.onClose(conn);
    } finally {
      conn.close();
    }
    return true;
  }

  async function stop() {
    if (runtime.tickInterval) {
      clearInterval(runtime.tickInterval);
      runtime.tickInterval = null;
    }
    for (const id of [...connections.keys()]) {
      disconnect(id);
    }
    await runtime.stats?.flush?.().catch((error) => {
      onError('statsFlush', error);
    });
    started = false;
  }

  return {
    room,
    runtime,
    start,
    connect,
    receive,
    disconnect,
    stop,
    getConnection,
    getConnections: () => room.getConnections(),
  };
}
