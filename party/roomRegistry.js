const ROOM_REGISTRY_PATH = '/api/rooms/event';

function getPartyEnv(room, key) {
  return room.env?.[key] ?? room.context?.env?.[key] ?? undefined;
}

export function getCurrentRoomId(room) {
  return String(room?.id ?? room?.name ?? 'default');
}

function inferRoomVisibility(roomId) {
  return roomId === 'default' || String(roomId).startsWith('pub-') ? 'public' : 'private';
}

function normalizeRoomRegistryUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value);
    url.pathname = ROOM_REGISTRY_PATH;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function createRoomRegistryPublisher({
  room,
  capacity,
  botFillTarget,
  getHumanCount,
  getOccupantCount,
  reportError,
}) {
  const url = normalizeRoomRegistryUrl(getPartyEnv(room, 'STATS_COLLECTOR_URL'));
  const token = String(getPartyEnv(room, 'STATS_COLLECTOR_TOKEN') ?? '').trim();
  const enabled = Boolean(url && token);
  let flushPending = false;
  let inFlight = null;

  const getPayload = () => {
    const roomId = getCurrentRoomId(room);
    const humans = Math.max(0, Number(getHumanCount?.()) || 0);
    const occupants = Math.max(0, Number(getOccupantCount?.()) || 0);
    const bots = Math.max(0, occupants - humans);
    return {
      type: 'room-state',
      version: 1,
      roomId,
      visibility: inferRoomVisibility(roomId),
      humans,
      bots,
      occupants,
      capacity,
      botFillTarget,
      updatedAt: Date.now(),
    };
  };

  const flush = async () => {
    if (!enabled) return;
    inFlight = fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(getPayload()),
    }).then(async (response) => {
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        reportError?.('roomRegistryPublish', new Error(`room registry returned ${response.status}`), {
          status: response.status,
          body: bodyText.slice(0, 240),
        });
      }
    }).catch((error) => {
      reportError?.('roomRegistryPublish', error, { url });
    }).finally(() => {
      inFlight = null;
      if (flushPending) {
        flushPending = false;
        void flush();
      }
    });
    await inFlight;
  };

  return {
    schedule() {
      if (!enabled) return;
      if (inFlight) {
        flushPending = true;
        return;
      }
      void flush();
    },
    getPayload,
  };
}
