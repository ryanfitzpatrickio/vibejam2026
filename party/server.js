import { gateWebSocketConnection } from './httpSecurity.js';
import GameRoomRuntime from './gameRoomRuntime.js';

export default class GameServer {
  static async onBeforeConnect(request, lobby) {
    return gateWebSocketConnection(request, lobby);
  }

  constructor(room) {
    this.runtime = new GameRoomRuntime(room);
  }

  onStart() {
    return this.runtime.onStart();
  }

  onConnect(conn) {
    return this.runtime.onConnect(conn);
  }

  onMessage(message, sender) {
    return this.runtime.onMessage(message, sender);
  }

  onClose(conn) {
    return this.runtime.onClose(conn);
  }

  onRequest(request) {
    return this.runtime.onRequest(request);
  }
}
