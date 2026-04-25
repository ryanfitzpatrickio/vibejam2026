const utf8Encoder = new TextEncoder();

export function utf8ByteLength(str) {
  return utf8Encoder.encode(String(str)).length;
}

export function createWsTransport({
  room,
  benchMetrics,
  reportError,
  messageRatePerSecond,
  messageBurst,
  maxDroppedMessagesBeforeClose,
}) {
  const messageBuckets = new Map();

  return {
    resetConnection(connectionId, now = Date.now()) {
      messageBuckets.set(connectionId, {
        tokens: messageBurst,
        lastRefill: now,
        dropped: 0,
      });
    },
    deleteConnection(connectionId) {
      messageBuckets.delete(connectionId);
    },
    acceptMessage(connectionId, now = Date.now()) {
      let bucket = messageBuckets.get(connectionId);
      if (!bucket) {
        bucket = {
          tokens: messageBurst,
          lastRefill: now,
          dropped: 0,
        };
        messageBuckets.set(connectionId, bucket);
      }

      const elapsedSeconds = Math.max(0, (now - bucket.lastRefill) / 1000);
      bucket.tokens = Math.min(
        messageBurst,
        bucket.tokens + elapsedSeconds * messageRatePerSecond,
      );
      bucket.lastRefill = now;

      if (bucket.tokens < 1) {
        bucket.dropped += 1;
        return {
          accepted: false,
          shouldClose: bucket.dropped >= maxDroppedMessagesBeforeClose,
        };
      }

      bucket.tokens -= 1;
      bucket.dropped = 0;
      return { accepted: true, shouldClose: false };
    },
    send(conn, message, byteLen = utf8ByteLength(message)) {
      if (!conn) return false;
      try {
        conn.send(message);
        benchMetrics?.recordOut(byteLen);
        return true;
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        if (!/after close/i.test(messageText)) {
          reportError?.('wsSend', new Error(messageText), {
            connectionId: conn?.id ?? null,
          });
        }
        return false;
      }
    },
    broadcast(message, exclude = []) {
      const byteLen = utf8ByteLength(message);
      for (const conn of room.getConnections()) {
        if (!exclude.includes(conn.id)) {
          this.send(conn, message, byteLen);
        }
      }
    },
  };
}
