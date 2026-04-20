import { createPlayerState, simulateTick, respawnPlayer, PHYSICS } from '../shared/physics.js';
import { constrainAdversaryHumanToNavMesh } from '../shared/adversaryHumanNav.js';
import { createMouseBotBrain, buildMouseBotInput, resetMouseBotBrain } from '../shared/mouseBot.js';
import { createPredatorState, simulatePredatorTick, serializePredatorState } from '../shared/predator.js';
import {
  createRoombaState,
  getRoombaVacuumPullAcceleration,
  simulateRoombaTick,
  serializeRoombaState,
} from '../shared/roomba.js';
import { buildRoomCollidersFromLayout } from '../shared/roomCollision.js';
import kitchenLayout from '../shared/kitchen-layout.generated.js';
import kitchenNavMesh from '../shared/kitchen-navmesh.generated.js';
import kitchenMouseNavMesh from '../shared/kitchen-mouse-navmesh.generated.js';
import kitchenRoombaNavMesh from '../shared/kitchen-roomba-navmesh.generated.js';
import kitchenAdversaryHumanNavMesh from '../shared/kitchen-adversary-human-navmesh.generated.js';
import { collectSpawnPointsFromLayout } from '../shared/spawnPoints.js';
import { applyPortalArrivalToPlayerState, collectVibePortalPlacementsFromLayout, sanitizePortalArrivalPayload } from '../shared/vibePortal.js';
import { isValidDevSyncLayout } from '../shared/devLayoutValidation.js';
import { sanitizePlayerInputMessage } from '../shared/playerInputSanitize.js';
import { sanitizeDisplayName } from '../shared/displayName.js';
import { playerChaseRecordSeconds, tickPlayerChaseScores } from '../shared/chaseScore.js';
import { StatsTracker } from './stats.js';
import { createPushBallWorld } from './pushBallWorld.js';
import { createRoombaCannonWorld } from './roombaCannonWorld.js';
import { createMouseLaunchWorld } from './mouseLaunchWorld.js';
import { createRopeWorld } from './ropeWorld.js';
import { CheeseWorld } from './cheeseWorld.js';
import { LEVEL_WORLD_BOUNDS_XZ } from '../shared/levelWorldBounds.js';
import {
  createRoundState,
  ROUND_DURATIONS,
  LIVES_PER_ROUND,
  RESPAWN_SECONDS as RAID_RESPAWN_SECONDS,
  EXTRACT_HOLD_SECONDS,
  computePlayerRoundScore,
  createRoundStats,
  resetRoundStats,
} from '../shared/roundState.js';
import { collectExtractionPortalsFromLayout } from '../shared/extractionPortals.js';
import { UNLOCK_HERO_DEFS } from '../shared/heroUnlocks.js';
import { RAID_TASK_TYPES } from '../shared/raidLayout.js';

/**
 * PartyKit env (dashboard / project .env for `partykit dev`):
 * - STATS_ADMIN_TOKEN or STATS_COLLECTOR_TOKEN — required; GET …/stats returns 503 if both missing
 * - GET …/leaderboard returns public aggregate leaderboards
 * - ALLOWED_ORIGINS — comma-separated browser origins allowed to open WebSockets
 * - DEV_LAYOUT_SYNC_ENABLED — set "true" only in dev to accept dev-sync-layout
 * - DEV_LAYOUT_SYNC_TOKEN — must match Vite VITE_DEV_LAYOUT_SYNC_TOKEN when syncing layout from build mode
 * - BENCH_METRICS_TOKEN — optional; when set, exposes GET …/bench-metrics and POST …/bench-metrics/reset
 *   (Bearer same token) for load / bandwidth regression scripts (see scripts/bench-network.mjs).
 */

const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;
const ROOM_HARD_CAP = 16;
const BOT_FILL_TARGET = 8;
/** Max extra push-balls a human may spawn per connection (lifetime). */
const MAX_EXTRA_BALL_SPAWNS_PER_PLAYER = 10;
const GRAB_RANGE = 1.5;
const GRAB_COOLDOWN = 1.0;
const GRAB_PULL_STRENGTH = 6.0;
const GRAB_INITIATOR_ADVANTAGE = 0.65; // initiator controls 65% of direction
const SMACK_RANGE = 2.0;
const SMACK_COOLDOWN = 1.5;
const SMACK_STUN_DURATION = 1.0;
const SMACK_KNOCKBACK = 8.0;
const DEFAULT_ENEMY_SPAWNS = Object.freeze([{ x: -5, y: 0, z: -5 }]);
const DEFAULT_ALLOWED_ORIGINS = Object.freeze(['https://mouse.ryanfitzpatrick.io']);
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const CONNECT_RATE_WINDOW_MS = 60_000;
const MAX_CONNECT_ATTEMPTS_PER_WINDOW = 30;
const WS_MESSAGE_RATE_PER_SECOND = 90;
const WS_MESSAGE_BURST = 180;
const MAX_DROPPED_MESSAGES_BEFORE_CLOSE = 180;
const ADVERSARY_SAFE_RADIUS = 7.5;
const ADVERSARY_SAFE_RADIUS_SQ = ADVERSARY_SAFE_RADIUS * ADVERSARY_SAFE_RADIUS;
const ROOM_REGISTRY_PATH = '/api/rooms/event';

const BOUNDS = LEVEL_WORLD_BOUNDS_XZ;
function simulatePlayerTick(state, input, dt, bounds, colliders, vacuumPull) {
  const previousPosition = state?.position
    ? { x: state.position.x, y: state.position.y, z: state.position.z }
    : null;
  simulateTick(state, input, dt, bounds, colliders, vacuumPull);
  constrainAdversaryHumanToNavMesh(state, kitchenAdversaryHumanNavMesh, previousPosition);
}

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

/** Reject oversized WebSocket frames before JSON.parse (DoS). */
const MAX_WS_MESSAGE_CHARS = 256 * 1024;
const connectAttempts = new Map();

function getPartyEnv(room, key) {
  return room.env?.[key] ?? room.context?.env?.[key] ?? undefined;
}

function getCurrentRoomId(room) {
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

/** Hero avatar rotation. Add a key here when a new hero model ships. */
const HERO_AVATAR_KEYS = ['brain', 'jerry'];
const HERO_MODE_DURATION_SECONDS = 50;
function pickHeroAvatar() {
  return HERO_AVATAR_KEYS[Math.floor(Math.random() * HERO_AVATAR_KEYS.length)];
}

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function getAllowedOrigins(env) {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const key of ['ALLOWED_ORIGINS', 'GAME_ORIGIN', 'PUBLIC_GAME_ORIGIN']) {
    for (const origin of splitCsv(env?.[key])) {
      const normalized = normalizeOrigin(origin);
      if (normalized) origins.add(normalized);
    }
  }
  return origins;
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (LOCAL_ORIGIN_RE.test(normalized)) return true;
  return getAllowedOrigins(env).has(normalized);
}

function corsHeadersForRequest(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  if (!origin || !isAllowedOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': normalizeOrigin(origin),
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  };
}

/** UTF-8 wire size for WebSocket text frames. Uses TextEncoder only — PartyKit/Workers may expose a non-Node `Buffer` without `byteLength`. */
const _utf8Encoder = new TextEncoder();

function utf8ByteLength(str) {
  return _utf8Encoder.encode(String(str)).length;
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeadersForRequest(request, env),
    },
  });
}

function getClientRateKey(request) {
  const forwarded = request.headers.get('X-Forwarded-For') ?? '';
  const ip = request.headers.get('CF-Connecting-IP') ?? forwarded.split(',')[0]?.trim() ?? '';
  const origin = normalizeOrigin(request.headers.get('Origin') ?? '') || 'no-origin';
  return ip ? `${ip}:${origin}` : `unknown:${origin}`;
}

function consumeConnectAttempt(request, now = Date.now()) {
  const key = getClientRateKey(request);
  let bucket = connectAttempts.get(key);
  if (!bucket || now - bucket.windowStart >= CONNECT_RATE_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    connectAttempts.set(key, bucket);
  }

  bucket.count += 1;
  if (connectAttempts.size > 1000) {
    for (const [entryKey, entry] of connectAttempts) {
      if (now - entry.windowStart >= CONNECT_RATE_WINDOW_MS) {
        connectAttempts.delete(entryKey);
      }
    }
  }
  return bucket.count <= MAX_CONNECT_ATTEMPTS_PER_WINDOW;
}

function isDevLayoutSyncEnabled(room) {
  const v = getPartyEnv(room, 'DEV_LAYOUT_SYNC_ENABLED');
  return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';
}

function getDevLayoutSyncToken(room) {
  const t = getPartyEnv(room, 'DEV_LAYOUT_SYNC_TOKEN');
  return typeof t === 'string' ? t : '';
}

export default class GameServer {
  static onBeforeConnect(request, lobby) {
    if (!isAllowedOrigin(request.headers.get('Origin') ?? '', lobby.env)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    if (!consumeConnectAttempt(request)) {
      return new Response('Too many connection attempts', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }

    return request;
  }

  players = new Map();
  inputQueues = new Map();
  tickInterval = null;
  levelColliders = buildRoomCollidersFromLayout(kitchenLayout, { scaleFactor: 1 });
  levelNavMesh = kitchenNavMesh;
  /** Walk mesh for mice (mouse-only nav polys); cats use levelNavMesh. */
  levelMouseNavMesh = kitchenMouseNavMesh;
  /** Wide agent mesh for roomba pathing (matches disk radius in nav bake). */
  levelRoombaNavMesh = kitchenRoombaNavMesh;
  spawnPoints = collectSpawnPointsFromLayout(kitchenLayout);
  portalPlacements = collectVibePortalPlacementsFromLayout(kitchenLayout);
  stats = null;
  portalArrivals = new Set();
  botBrains = new Map();
  _nextBotId = 0;
  /** @type {Map<string, number>} last spawn-extra-ball ms by connection id */
  _spawnBallCooldown = new Map();
  /** @type {Map<string, number>} successful extra-ball spawns this connection */
  _playerExtraBallSpawnCount = new Map();
  /** @type {Map<string, {tokens: number, lastRefill: number, dropped: number}>} */
  _messageBuckets = new Map();
  /** @type {Map<string, number>} last task-complete ms by connection id */
  _taskCompleteCooldown = new Map();

  /** Cumulative WebSocket + tick metrics for scripts/bench-network.mjs (reset via HTTP). */
  _benchBytesIn = 0;
  _benchBytesOut = 0;
  _benchMsgsIn = 0;
  _benchMsgsOut = 0;
  _benchTickCount = 0;
  _benchTickMsSum = 0;
  _benchTickMsMax = 0;
  /** @type {number[]} capped ring for percentile export */
  _benchTickSamples = [];
  _roomRegistryUrl = '';
  _roomRegistryToken = '';
  _roomRegistryEnabled = false;
  _roomRegistryFlushPending = false;
  _roomRegistryInFlight = null;

  constructor(room) {
    this.room = room;
    this.stats = new StatsTracker(room);
    this._roomRegistryUrl = normalizeRoomRegistryUrl(getPartyEnv(room, 'STATS_COLLECTOR_URL'));
    this._roomRegistryToken = String(getPartyEnv(room, 'STATS_COLLECTOR_TOKEN') ?? '').trim();
    this._roomRegistryEnabled = Boolean(this._roomRegistryUrl && this._roomRegistryToken);
    this.predators = [];
    this.pushBallWorld = createPushBallWorld();
    this.roombaCannonWorld = createRoombaCannonWorld();
    this.mouseLaunchWorld = createMouseLaunchWorld();
    this.ropeWorld = createRopeWorld({ ropes: Array.isArray(kitchenLayout?.ropes) ? kitchenLayout.ropes : null });
    this._lastRopeGrab = new Map();
    this._lastRopeJump = new Map();
    this.cheeseWorld = new CheeseWorld();
    this._applyLayout(kitchenLayout, { resetPredators: true });
    this.round = createRoundState({ number: 1, now: Date.now() / 1000 });
    /** Session-lifetime global first-to-claim for collection-unlock heroes. */
    this.heroClaims = { gus: null, speedy: null };
    this._claimHeroCooldown = new Map();
    /** Scattered collectibles for hero unlocks; session-lifetime. */
    this.unlockItems = this._scatterUnlockItems();
    this._unlockPickupCooldown = new Map();
  }

  _getRoomStatePayload() {
    const roomId = getCurrentRoomId(this.room);
    const humans = this.inputQueues.size;
    const occupants = this.players.size;
    const bots = Math.max(0, occupants - humans);
    return {
      type: 'room-state',
      version: 1,
      roomId,
      visibility: inferRoomVisibility(roomId),
      humans,
      bots,
      occupants,
      capacity: ROOM_HARD_CAP,
      botFillTarget: BOT_FILL_TARGET,
      updatedAt: Date.now(),
    };
  }

  async _flushRoomRegistryUpdate() {
    if (!this._roomRegistryEnabled) return;
    this._roomRegistryInFlight = fetch(this._roomRegistryUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this._roomRegistryToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this._getRoomStatePayload()),
    }).then(async (response) => {
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        this._reportUnhandledError('roomRegistryPublish', new Error(`room registry returned ${response.status}`), {
          status: response.status,
          body: bodyText.slice(0, 240),
        });
      }
    }).catch((error) => {
      this._reportUnhandledError('roomRegistryPublish', error, {
        url: this._roomRegistryUrl,
      });
    }).finally(() => {
      this._roomRegistryInFlight = null;
      if (this._roomRegistryFlushPending) {
        this._roomRegistryFlushPending = false;
        void this._flushRoomRegistryUpdate();
      }
    });
    await this._roomRegistryInFlight;
  }

  _scheduleRoomRegistryUpdate() {
    if (!this._roomRegistryEnabled) return;
    if (this._roomRegistryInFlight) {
      this._roomRegistryFlushPending = true;
      return;
    }
    void this._flushRoomRegistryUpdate();
  }

  _sendToConnection(conn, message, byteLen = utf8ByteLength(message)) {
    if (!conn) return false;
    try {
      conn.send(message);
      this._benchBytesOut += byteLen;
      this._benchMsgsOut += 1;
      return true;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (!/after close/i.test(messageText)) {
        this._reportUnhandledError('wsSend', new Error(messageText), {
          connectionId: conn?.id ?? null,
        });
      }
      return false;
    }
  }

  _reportUnhandledError(path, error, extra = null) {
    const roomId = getCurrentRoomId(this.room);
    const label = `[room-error] room=${roomId} path=${path}`;
    if (extra && typeof extra === 'object') {
      console.error(label, extra, error);
      return;
    }
    console.error(label, error);
  }

  _scatterUnlockItems() {
    const items = [];
    const bounds = LEVEL_WORLD_BOUNDS_XZ;
    const minX = bounds?.minX ?? -18;
    const maxX = bounds?.maxX ?? 18;
    const minZ = bounds?.minZ ?? -18;
    const maxZ = bounds?.maxZ ?? 18;
    const make = (kind, count) => {
      for (let i = 0; i < count; i += 1) {
        items.push({
          id: `unlock-${kind}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          x: minX + Math.random() * (maxX - minX),
          y: 0.2,
          z: minZ + Math.random() * (maxZ - minZ),
          consumed: false,
        });
      }
    };
    make('sewing', UNLOCK_HERO_DEFS.gus.scatterCount);
    make('speed', UNLOCK_HERO_DEFS.speedy.scatterCount);
    return items;
  }

  _applyLayout(layout, { resetPredators = false } = {}) {
    this._layout = layout;
    this.levelColliders = buildRoomCollidersFromLayout(layout, { scaleFactor: 1 });
    this.spawnPoints = collectSpawnPointsFromLayout(layout);
    this.portalPlacements = collectVibePortalPlacementsFromLayout(layout);
    this.extractionPortalDefs = collectExtractionPortalsFromLayout(layout, this.spawnPoints);
    this.pushBallWorld?.setLevelColliders?.(this.levelColliders);
    this.roombaCannonWorld?.setLevelColliders?.(this.levelColliders);
    this.mouseLaunchWorld?.setLevelColliders?.(this.levelColliders);
    this.ropeWorld?.setLevelColliders?.(this.levelColliders);
    if (Array.isArray(layout?.ropes)) {
      this.ropeWorld?.setRopes?.(layout.ropes);
    }
    this.cheeseWorld.setNavMesh(this.levelMouseNavMesh);
    if (resetPredators) {
      this.predators = [];
      this._initPredators();
      this.cheeseWorld.seedScatter();
    }
  }

  _pickRoombaDock() {
    const roombaDocks = this.spawnPoints.roomba ?? [];
    if (!roombaDocks.length) return null;

    const dock = roombaDocks[0];
    return {
      x: dock.x ?? 0,
      y: dock.y ?? 0,
      z: dock.z ?? 0,
    };
  }

  _initPredators() {
    const enemySpawns = this.spawnPoints.enemy.length ? this.spawnPoints.enemy : DEFAULT_ENEMY_SPAWNS;
    enemySpawns.forEach((spawn, index) => {
      this.predators.push(createPredatorState({
        id: `cat-${index}`,
        type: 'cat',
        spawnX: spawn.x,
        spawnY: spawn.y,
        spawnZ: spawn.z,
      }));
    });
    const dock = this._pickRoombaDock();
    if (dock) {
      this.predators.push(createRoombaState({
        id: 'roomba-0',
        dockX: dock.x,
        dockY: dock.y,
        dockZ: dock.z,
      }));
    }
    this.roombaCannonWorld?.resetBody?.();
  }

  _pickPlayerSpawn(joinIndex = 0) {
    const spawns = this.spawnPoints.player;
    if (spawns.length) {
      return spawns[joinIndex % spawns.length];
    }

    const angle = joinIndex * (Math.PI * 2 / ROOM_HARD_CAP);
    return {
      x: Math.cos(angle) * 2,
      y: 0,
      z: Math.sin(angle) * 2,
    };
  }

  _pickRespawnPoint() {
    const spawns = this.spawnPoints.player;
    if (spawns.length) {
      return spawns[Math.floor(Math.random() * spawns.length)];
    }

    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 8;
    return {
      x: Math.cos(angle) * dist,
      y: 0,
      z: Math.sin(angle) * dist,
    };
  }

  _pickHumanSpawn() {
    const spawns = this.spawnPoints.human;
    if (spawns?.length) {
      return spawns[Math.floor(Math.random() * spawns.length)];
    }

    return this._pickRespawnPoint();
  }

  _listBotIdsSorted() {
    return [...this.players.keys()]
      .filter((id) => !this.inputQueues.has(id))
      .sort((a, b) => {
        const na = Number(String(a).replace(/^bot-/, '')) || 0;
        const nb = Number(String(b).replace(/^bot-/, '')) || 0;
        return na - nb;
      });
  }

  /**
   * Keeps bot fill at BOT_FILL_TARGET while humans can continue up to ROOM_HARD_CAP.
   */
  _syncBots() {
    const humanCount = this.inputQueues.size;
    const desiredBots = Math.max(0, BOT_FILL_TARGET - humanCount);
    const botIds = this._listBotIdsSorted();

    while (botIds.length > desiredBots) {
      const id = botIds.pop();
      if (!id) break;
      const botState = this.players.get(id);
      if (botState) this.cheeseWorld.onDeathDropCarried(botState);
      this.mouseLaunchWorld?.removePlayer?.(id);
      this.ropeWorld?.removePlayer?.(id);
      this._lastRopeGrab?.delete(id);
      this._lastRopeJump?.delete(id);
      this.players.delete(id);
      this.botBrains.delete(id);
      this._lastSeq?.delete(id);
      this.broadcast(JSON.stringify({ type: 'player-left', id }));
    }

    while (botIds.length < desiredBots) {
      const id = `bot-${this._nextBotId++}`;
      const spawn = this._pickPlayerSpawn(this.inputQueues.size + botIds.length);
      const state = createPlayerState(id);
      state.isBot = true;
      state.displayName = `Bot ${id.replace(/^bot-/, '')}`;
      state.position.x = spawn.x;
      state.position.y = spawn.y;
      state.position.z = spawn.z;
      state.grounded = spawn.y <= 0.001;
      this.players.set(id, state);
      this.botBrains.set(id, createMouseBotBrain());
      botIds.push(id);
      this.broadcast(JSON.stringify({ type: 'player-joined', player: state }));
    }
  }

  _currentAdversaryId() {
    for (const [id, state] of this.players) {
      if (state?.isAdversary) return id;
    }
    return null;
  }

  _recordAdversaryScore(connectionId, state) {
    if (!connectionId || !state) return;
    const safeSeconds = Math.max(0, Number(state.adversarySafeSeconds) || 0);
    if (safeSeconds <= 0) return;
    this.stats?.recordAdversaryScore(connectionId, {
      displayName: state.displayName,
      safeSeconds,
    });
  }

  _setAdversary(state, active, connectionId = null) {
    if (!state) return;
    if (state.isAdversary && !active) {
      this._recordAdversaryScore(connectionId ?? state.id, state);
    }
    state.isAdversary = !!active;
    state.adversaryRole = active ? 'human' : null;
    state.cheeseCarried = 0;
    state.extractProgress = 0;
    state.extracted = false;
    state.grabbedBy = null;
    state.grabbedTarget = null;
    state.grabbedBallId = null;
    state.heroAvailable = false;
    state.isHero = false;
    state.heroAvatar = null;
    state.heroTimeRemaining = 0;
    state.heroAvatarAvailable = null;
    if (!active) state.adversarySafeStreakSeconds = 0;
    if (active) {
      const spawn = this._pickHumanSpawn();
      respawnPlayer(state, spawn.x, spawn.z, spawn.y);
      this.mouseLaunchWorld?.removePlayer?.(state.id);
      this.ropeWorld?.removePlayer?.(state.id);
      this._lastRopeGrab.delete(state.id);
      this._lastRopeJump?.delete(state.id);
    }
  }

  _tickAdversaryScores(dt) {
    for (const [, state] of this.players) {
      if (!state?.isAdversary || !state.alive || state.spectator || this.round.phase === 'intermission') {
        if (state?.isAdversary) state.adversarySafeStreakSeconds = 0;
        continue;
      }

      let nearestMouseDistSq = Infinity;
      for (const [, other] of this.players) {
        if (!other || other === state || other.isAdversary || !other.alive || other.spectator || other.extracted) continue;
        const dx = other.position.x - state.position.x;
        const dz = other.position.z - state.position.z;
        nearestMouseDistSq = Math.min(nearestMouseDistSq, dx * dx + dz * dz);
      }

      if (nearestMouseDistSq > ADVERSARY_SAFE_RADIUS_SQ) {
        state.adversarySafeSeconds = (state.adversarySafeSeconds ?? 0) + dt;
        state.adversarySafeStreakSeconds = (state.adversarySafeStreakSeconds ?? 0) + dt;
      } else {
        state.adversarySafeStreakSeconds = 0;
      }
    }
  }

  async onStart() {
    try {
      await this.stats?.ready;
    } catch (error) {
      this._reportUnhandledError('onStart:statsReady', error);
    }
    this.tickInterval = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        this._reportUnhandledError('tickInterval', error);
      }
    }, TICK_MS);
    try {
      this._scheduleRoomRegistryUpdate();
    } catch (error) {
      this._reportUnhandledError('onStart:roomRegistrySchedule', error);
    }
  }

  onConnect(conn) {
    try {
      if (this.inputQueues.size >= ROOM_HARD_CAP) {
        const errPayload = JSON.stringify({ type: 'error', message: 'Room full' });
        this._sendToConnection(conn, errPayload);
        conn.close();
        return;
      }

      const state = createPlayerState(conn.id);
      const spawn = this._pickPlayerSpawn(this.inputQueues.size);
      state.position.x = spawn.x;
      state.position.y = spawn.y;
      state.position.z = spawn.z;
      state.grounded = spawn.y <= 0.001;

      this.players.set(conn.id, state);
      this.inputQueues.set(conn.id, []);
      this._messageBuckets.set(conn.id, {
        tokens: WS_MESSAGE_BURST,
        lastRefill: Date.now(),
        dropped: 0,
      });
      this._syncBots();
      this.stats?.recordConnect(conn.id, this.inputQueues.size);

      const initPayload = JSON.stringify({
        type: 'init',
        id: conn.id,
        players: Object.fromEntries(this.players),
        predators: this.predators.map((p) => (p.type === 'roomba' ? serializeRoombaState(p) : serializePredatorState(p))),
        pushBalls: this.pushBallWorld.getBallsState(),
        cheesePickups: this.cheeseWorld.serializePickups(),
        ropes: this.ropeWorld.getRopesSnapshot(),
        round: this.round,
        adversary: {
          playerId: this._currentAdversaryId(),
          available: !this._currentAdversaryId() && this.round.phase !== 'intermission',
          safeRadius: ADVERSARY_SAFE_RADIUS,
        },
        extractionPortals: this.round.phase === 'extract' ? this.extractionPortalDefs : [],
        heroClaims: { ...this.heroClaims },
        unlockItems: this.unlockItems.filter((it) => !it.consumed),
      });
      this._sendToConnection(conn, initPayload);

      this.broadcast(JSON.stringify({
        type: 'player-joined',
        player: state,
      }), [conn.id]);
      this._scheduleRoomRegistryUpdate();
    } catch (error) {
      this._reportUnhandledError('onConnect', error, {
        connectionId: conn?.id ?? null,
      });
      try {
        conn?.close?.();
      } catch {}
    }
  }

  _consumeMessageToken(connectionId, now = Date.now()) {
    let bucket = this._messageBuckets.get(connectionId);
    if (!bucket) {
      bucket = {
        tokens: WS_MESSAGE_BURST,
        lastRefill: now,
        dropped: 0,
      };
      this._messageBuckets.set(connectionId, bucket);
    }

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(
      WS_MESSAGE_BURST,
      bucket.tokens + elapsedSeconds * WS_MESSAGE_RATE_PER_SECOND,
    );
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      bucket.dropped += 1;
      return false;
    }

    bucket.tokens -= 1;
    bucket.dropped = 0;
    return true;
  }

  async onMessage(message, sender) {
    let messagePath = 'unknown';
    try {
      if (typeof message === 'string') {
        this._benchBytesIn += utf8ByteLength(message);
        this._benchMsgsIn += 1;
      } else if (message instanceof ArrayBuffer) {
        this._benchBytesIn += message.byteLength;
        this._benchMsgsIn += 1;
      } else if (ArrayBuffer.isView(message)) {
        this._benchBytesIn += message.byteLength;
        this._benchMsgsIn += 1;
      }

      if (!this._consumeMessageToken(sender.id)) {
        const bucket = this._messageBuckets.get(sender.id);
        if (bucket?.dropped >= MAX_DROPPED_MESSAGES_BEFORE_CLOSE) {
          sender.close();
        }
        return;
      }

      if (typeof message === 'string' && message.length > MAX_WS_MESSAGE_CHARS) {
        return;
      }

      let data;
      try {
        data = JSON.parse(/** @type {string} */ (message));
      } catch {
        return;
      }
      messagePath = typeof data?.type === 'string' ? data.type : 'unknown';

      if (data.type === 'hello') {
        const playerHello = this.players.get(sender.id);
        if (playerHello && typeof data.displayName === 'string') {
          playerHello.displayName = sanitizeDisplayName(data.displayName);
          this.stats?.recordDisplayName(sender.id, playerHello.displayName);
        }

        const portalArrival = sanitizePortalArrivalPayload(data.portal);
        if (portalArrival.active && !this.portalArrivals.has(sender.id)) {
          const player = this.players.get(sender.id);
          if (applyPortalArrivalToPlayerState(player, portalArrival, this.portalPlacements)) {
            this.portalArrivals.add(sender.id);
            const portalPayload = JSON.stringify({
              type: 'portal-spawn',
              player,
            });
            this._sendToConnection(sender, portalPayload);
            this.broadcast(JSON.stringify({
              type: 'player-joined',
              player,
            }), [sender.id]);
          }
        }

        try {
          await this.stats?.identifyConnection(sender.id, data.playerKey, playerHello?.displayName);
        } catch (error) {
          console.warn('[stats] failed to identify player:', error);
        }
        return;
      }

      if (data.type === 'input') {
        const queue = this.inputQueues.get(sender.id);
        if (queue) {
          if (queue.length < 8) {
            queue.push(sanitizePlayerInputMessage(data));
          }
        }
        return;
      }

      if (data.type === 'task-complete') {
        const player = this.players.get(sender.id);
        if (!player?.alive) return;
        const now = Date.now();
        const last = this._taskCompleteCooldown.get(sender.id) ?? 0;
        if (now - last < 600) return;
        const px = Number(data.position?.x);
        const py = Number(data.position?.y);
        const pz = Number(data.position?.z);
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
        const dx = px - player.position.x;
        const dz = pz - player.position.z;
        if (dx * dx + dz * dz > 25) return; // must be within ~5m of the player
        const amount = Math.max(1, Math.min(24, Math.floor(Number(data.amount) || 6)));
        this._taskCompleteCooldown.set(sender.id, now);
        // Scatter a few merged piles around the player so they feel like a reward.
        const pieces = Math.min(amount, 6);
        const per = Math.max(1, Math.floor(amount / pieces));
        let remaining = amount;
        for (let i = 0; i < pieces && remaining > 0; i += 1) {
          const theta = (i / pieces) * Math.PI * 2 + Math.random() * 0.4;
          const radius = 0.45 + Math.random() * 0.6;
          const give = i === pieces - 1 ? remaining : per;
          remaining -= give;
          this.cheeseWorld.mergeOrAddDrop({
            x: player.position.x + Math.cos(theta) * radius,
            y: player.position.y,
            z: player.position.z + Math.sin(theta) * radius,
          }, give);
        }
        return;
      }

      if (data.type === 'spawn-extra-ball') {
        const player = this.players.get(sender.id);
        if (!player?.alive) return;
        const used = this._playerExtraBallSpawnCount.get(sender.id) ?? 0;
        if (used >= MAX_EXTRA_BALL_SPAWNS_PER_PLAYER) return;
        const now = Date.now();
        const last = this._spawnBallCooldown.get(sender.id) ?? 0;
        if (now - last < 240) return;
        this._spawnBallCooldown.set(sender.id, now);
        const ok = this.pushBallWorld.spawnExtraBallNear(player.position, player.rotation);
        if (ok) {
          this._playerExtraBallSpawnCount.set(sender.id, used + 1);
        }
        return;
      }

      if (data.type === 'unlock-pickup') {
        this._handleUnlockPickup(sender.id, data);
        return;
      }

      if (data.type === 'claim-hero') {
        this._handleClaimHero(sender.id, data);
        return;
      }

      if (data.type === 'dev-sync-layout') {
        if (!isDevLayoutSyncEnabled(this.room)) {
          return;
        }
        const expected = getDevLayoutSyncToken(this.room);
        if (!expected || typeof data.syncToken !== 'string' || data.syncToken !== expected) {
          return;
        }
        if (!isValidDevSyncLayout(data.layout)) {
          return;
        }
        this._applyLayout(data.layout, { resetPredators: true });
      }
    } catch (error) {
      this._reportUnhandledError(`onMessage:${messagePath}`, error, {
        connectionId: sender?.id ?? null,
      });
    }
  }

  onClose(conn) {
    try {
      this.stats?.recordDisconnect(conn.id);
      this._spawnBallCooldown.delete(conn.id);
      this._playerExtraBallSpawnCount.delete(conn.id);
      this._messageBuckets.delete(conn.id);
      this._taskCompleteCooldown.delete(conn.id);
      this._claimHeroCooldown.delete(conn.id);
      this._unlockPickupCooldown.delete(conn.id);
      this.portalArrivals.delete(conn.id);
      const leaving = this.players.get(conn.id);
      if (leaving?.isAdversary) this._recordAdversaryScore(conn.id, leaving);
      if (leaving) this.cheeseWorld.onDeathDropCarried(leaving);
      this.mouseLaunchWorld?.removePlayer?.(conn.id);
      this.ropeWorld?.removePlayer?.(conn.id);
      this._lastRopeGrab?.delete(conn.id);
      this._lastRopeJump?.delete(conn.id);
      this.players.delete(conn.id);
      this.inputQueues.delete(conn.id);
      this.broadcast(JSON.stringify({
        type: 'player-left',
        id: conn.id,
      }));
      this._syncBots();
      this._scheduleRoomRegistryUpdate();
    } catch (error) {
      this._reportUnhandledError('onClose', error, {
        connectionId: conn?.id ?? null,
      });
    }
  }

  _advanceRoundPhase(wallNow) {
    if (wallNow < this.round.phaseEndsAt) return;
    const phase = this.round.phase;
    if (phase === 'forage') {
      this.round = {
        ...this.round,
        phase: 'extract',
        phaseEndsAt: wallNow + ROUND_DURATIONS.extract,
      };
      this.broadcast(JSON.stringify({
        type: 'round-phase',
        phase: 'extract',
        phaseEndsAt: this.round.phaseEndsAt,
        number: this.round.number,
        message: 'HUMAN COMING HOME! Mouse holes opening — hold E to extract!',
      }));
      return;
    }
    if (phase === 'extract') {
      this._finishRound(wallNow);
      this.round = {
        ...this.round,
        phase: 'intermission',
        phaseEndsAt: wallNow + ROUND_DURATIONS.intermission,
      };
      return;
    }
    if (phase === 'intermission') {
      this._startNewRound(wallNow);
      this.round = {
        number: this.round.number + 1,
        phase: 'forage',
        phaseEndsAt: wallNow + ROUND_DURATIONS.forage,
        heroCandidateId: null,
      };
    }
  }

  /**
   * Two minutes into the forage phase, pick two leaders:
   *   - Cheese leader (most cheese collected) → Jerry
   *   - Cat chase leader (longest time survived being chased) → Brain
   * Each gets their own hero respawn offer. Runs once per round.
   */
  _maybeElectHero(wallNow) {
    if (this.round.phase !== 'forage') return;
    if (this.round.heroCandidateId) return;
    const forageElapsed = ROUND_DURATIONS.forage - (this.round.phaseEndsAt - wallNow);
    if (forageElapsed < 120) return;

    let cheeseId = null;
    let cheeseScore = 0;
    let chaseId = null;
    let chaseScore = 0;
    for (const [id, state] of this.players) {
      if (!state.alive || state.spectator || state.extracted || state.isAdversary) continue;
      const rs = state.roundStats ?? {};
      const cheese = (rs.cheeseCollected ?? 0) + (state.cheeseCarried ?? 0);
      if (cheese > cheeseScore) {
        cheeseScore = cheese;
        cheeseId = id;
      }
      const chase = playerChaseRecordSeconds(state);
      if (chase > chaseScore) {
        chaseScore = chase;
        chaseId = id;
      }
    }
    if (!cheeseId && !chaseId) return;
    this.round = { ...this.round, heroCandidateId: cheeseId ?? chaseId };
    if (cheeseId) {
      const leader = this.players.get(cheeseId);
      if (leader) {
        leader.heroAvailable = true;
        leader.heroAvatarAvailable = 'jerry';
      }
    }
    if (chaseId && chaseId !== cheeseId) {
      const leader = this.players.get(chaseId);
      if (leader) {
        leader.heroAvailable = true;
        leader.heroAvatarAvailable = 'brain';
      }
    }
  }

  _findRaidTaskById(taskId) {
    const tasks = this._layout?.raidTasks;
    if (!Array.isArray(tasks)) return null;
    for (const task of tasks) {
      if (task?.id === taskId) return task;
    }
    return null;
  }

  _handleUnlockPickup(senderId, data) {
    const player = this.players.get(senderId);
    if (!player?.alive) return;
    const itemId = typeof data?.itemId === 'string' ? data.itemId : null;
    if (!itemId) return;
    const now = Date.now();
    const last = this._unlockPickupCooldown.get(senderId) ?? 0;
    if (now - last < 120) return;
    this._unlockPickupCooldown.set(senderId, now);
    const item = this.unlockItems.find((it) => it.id === itemId && !it.consumed);
    if (!item) return;
    const dx = item.x - player.position.x;
    const dz = item.z - player.position.z;
    if (dx * dx + dz * dz > 4) return; // within ~2m
    item.consumed = true;
    if (item.kind === 'sewing') player.sewingCollected = (player.sewingCollected ?? 0) + 1;
    else if (item.kind === 'speed') player.speedTokensCollected = (player.speedTokensCollected ?? 0) + 1;
    this.broadcast(JSON.stringify({
      type: 'unlock-pickup-consumed',
      itemId,
      playerId: senderId,
      kind: item.kind,
    }));
  }

  _handleClaimHero(senderId, data) {
    const player = this.players.get(senderId);
    if (!player?.alive || player.isAdversary || player.isHero) return;
    const heroKey = typeof data?.heroKey === 'string' ? data.heroKey : null;
    const def = UNLOCK_HERO_DEFS[heroKey];
    if (!def) return;
    const now = Date.now();
    const last = this._claimHeroCooldown.get(senderId) ?? 0;
    if (now - last < 600) return;
    this._claimHeroCooldown.set(senderId, now);

    if (this.heroClaims[heroKey]) return;

    const counterField = heroKey === 'gus' ? 'sewingCollected' : 'speedTokensCollected';
    const have = player[counterField] ?? 0;
    const devBypass = isDevLayoutSyncEnabled(this.room);
    if (!devBypass && have < def.requiredCount) return;

    const expectedTaskType = heroKey === 'gus' ? RAID_TASK_TYPES.UNLOCK_GUS : RAID_TASK_TYPES.UNLOCK_SPEEDY;
    const taskId = typeof data.taskId === 'string' ? data.taskId : null;
    if (taskId) {
      const task = this._findRaidTaskById(taskId);
      if (!task || task.taskType !== expectedTaskType) return;
      const dx = (task.position?.x ?? 0) - player.position.x;
      const dz = (task.position?.z ?? 0) - player.position.z;
      if (dx * dx + dz * dz > 9) return; // must be within ~3m of the marker
    }

    player[counterField] = Math.max(0, have - def.requiredCount);
    this.heroClaims[heroKey] = senderId;
    this._startHeroMode(player, heroKey);

    this.broadcast(JSON.stringify({
      type: 'hero-claimed',
      playerId: senderId,
      heroKey,
      taskId: taskId ?? null,
    }));
  }

  _endHeroMode(state) {
    state.isHero = false;
    state.heroAvatar = null;
    state.heroTimeRemaining = 0;
  }

  _startHeroMode(state, heroAvatar = pickHeroAvatar()) {
    state.isHero = true;
    state.heroAvailable = false;
    state.health = PHYSICS.maxHealth;
    state.stamina = PHYSICS.maxStamina;
    state.heroAvatar = heroAvatar;
    state.heroAvatarAvailable = null;
    state.heroTimeRemaining = HERO_MODE_DURATION_SECONDS;
  }

  _tickHeroTimers(dt) {
    for (const state of this.players.values()) {
      if (!state.isHero) {
        state.heroTimeRemaining = 0;
        continue;
      }

      state.heroTimeRemaining = Math.max(0, (state.heroTimeRemaining ?? HERO_MODE_DURATION_SECONDS) - dt);
      if (state.heroTimeRemaining <= 0) {
        this._endHeroMode(state);
      }
    }
  }

  _finishRound() {
    const results = [];
    const adversaryResults = [];
    for (const [id, state] of this.players) {
      const br = computePlayerRoundScore(state);
      state.roundStats.finalScore = br.finalScore;
      state.roundStats.xpAwarded = br.xpAwarded;
      state.roundStats.tasksCompleted = br.completedTaskIds;
      results.push({
        id,
        displayName: state.displayName,
        isBot: !!state.isBot,
        ...br,
        adversarySafeSeconds: Math.round(Math.max(0, Number(state.adversarySafeSeconds) || 0) * 10) / 10,
      });
      if (state.isAdversary || (state.adversarySafeSeconds ?? 0) > 0) {
        const safeSeconds = Math.round(Math.max(0, Number(state.adversarySafeSeconds) || 0) * 10) / 10;
        adversaryResults.push({
          id,
          displayName: state.displayName,
          isBot: !!state.isBot,
          safeSeconds,
        });
        if (this.inputQueues.has(id)) {
          this.stats?.recordAdversaryScore(id, {
            displayName: state.displayName,
            safeSeconds,
          });
        }
      }
      if (this.inputQueues.has(id)) {
        this.stats?.recordExtractionRaid(id, {
          xpGained: br.xpAwarded,
          roundScore: br.finalScore,
          extracted: br.extracted,
          displayName: state.displayName,
        });
      }
      if (state.isAdversary) this._setAdversary(state, false, id);
    }
    results.sort((a, b) => b.finalScore - a.finalScore);
    adversaryResults.sort((a, b) => b.safeSeconds - a.safeSeconds);
    this.broadcast(JSON.stringify({
      type: 'round-end',
      roundNumber: this.round.number,
      results,
      adversaryResults,
    }));
  }

  _startNewRound() {
    this.cheeseWorld.seedScatter();
    // Hero-unlock resets: clear claims, re-scatter collectibles, clear cooldowns.
    // Player session counters (sewingCollected/speedTokensCollected) persist across rounds.
    this.heroClaims = { gus: null, speedy: null };
    this.unlockItems = this._scatterUnlockItems();
    this._claimHeroCooldown.clear();
    this._unlockPickupCooldown.clear();
    this.broadcast(JSON.stringify({
      type: 'unlock-reset',
      heroClaims: { ...this.heroClaims },
      unlockItems: this.unlockItems,
    }));
    let idx = 0;
    for (const [id, state] of this.players) {
      if (!state.roundStats) state.roundStats = createRoundStats();
      else resetRoundStats(state.roundStats);
      state.livesRemaining = LIVES_PER_ROUND;
      state.spectator = false;
      state.extracted = false;
      state.extractProgress = 0;
      state.cheeseCarried = 0;
      state.isAdversary = false;
      state.adversaryRole = null;
      state.adversarySafeSeconds = 0;
      state.adversarySafeStreakSeconds = 0;
      state.health = PHYSICS.maxHealth;
      state.heroAvailable = false;
      state.isHero = false;
      state.heroAvatar = null;
      state.heroTimeRemaining = 0;
      state.heroAvatarAvailable = null;
      state.deaths = 0;
      state.alive = true;
      state.deathTime = 0;
      state.animState = 'idle';
      state.smackStunTimer = 0;
      state.roombaLaunch = null;
      state.ropeSwing = null;
      const spawn = this._pickPlayerSpawn(idx);
      idx += 1;
      respawnPlayer(state, spawn.x, spawn.z, spawn.y);
      this.mouseLaunchWorld?.removePlayer?.(id);
      this.ropeWorld?.removePlayer?.(id);
      this._lastRopeGrab.delete(id);
      this._lastRopeJump?.delete(id);
      if (!this.inputQueues.has(id)) {
        resetMouseBotBrain(this.botBrains.get(id));
      }
    }
    this.predators = [];
    this._initPredators();
  }

  _resetBenchMetrics() {
    this._benchBytesIn = 0;
    this._benchBytesOut = 0;
    this._benchMsgsIn = 0;
    this._benchMsgsOut = 0;
    this._benchTickCount = 0;
    this._benchTickMsSum = 0;
    this._benchTickMsMax = 0;
    this._benchTickSamples.length = 0;
  }

  _recordBenchTickMs(ms) {
    this._benchTickCount += 1;
    this._benchTickMsSum += ms;
    this._benchTickMsMax = Math.max(this._benchTickMsMax, ms);
    const cap = 3600;
    const arr = this._benchTickSamples;
    if (arr.length < cap) {
      arr.push(ms);
    } else {
      arr[this._benchTickCount % cap] = ms;
    }
  }

  _benchTickPercentiles() {
    const arr = [...this._benchTickSamples].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!arr.length) {
      return { p50: 0, p95: 0, samples: 0 };
    }
    const pick = (q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];
    return { p50: pick(0.5), p95: pick(0.95), samples: arr.length };
  }

  getBenchMetricsPayload() {
    const pct = this._benchTickPercentiles();
    const ticks = this._benchTickCount || 1;
    const durationSec = ticks / TICK_RATE;
    return {
      tickRate: TICK_RATE,
      ticks: this._benchTickCount,
      durationSecApprox: Math.round(durationSec * 1000) / 1000,
      tickMsMean: Math.round((this._benchTickMsSum / ticks) * 10000) / 10000,
      tickMsMax: Math.round(this._benchTickMsMax * 10000) / 10000,
      tickMsP50: Math.round(pct.p50 * 10000) / 10000,
      tickMsP95: Math.round(pct.p95 * 10000) / 10000,
      tickSampleCount: pct.samples,
      bytesIn: this._benchBytesIn,
      bytesOut: this._benchBytesOut,
      msgsIn: this._benchMsgsIn,
      msgsOut: this._benchMsgsOut,
      bytesInPerSecApprox: Math.round(this._benchBytesIn / durationSec),
      bytesOutPerSecApprox: Math.round(this._benchBytesOut / durationSec),
      connections: Array.isArray(this.room.getConnections?.())
        ? this.room.getConnections().length
        : 0,
    };
  }

  tick() {
    const t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    try {
      this._syncBots();

      if (this.players.size === 0 && this.predators.length === 0) return;

    const dt = TICK_MS / 1000;
    const wallNow = Date.now() / 1000;
    this._advanceRoundPhase(wallNow);
    this._maybeElectHero(wallNow);
    this._tickHeroTimers(dt);

    const seqs = {};
    const now = Date.now() / 1000;
    const roombaForVacuum = this.predators.find((p) => p.type === 'roomba') ?? null;
    /** Collect interaction requests from this tick's inputs. */
    const grabHeld = new Set();
    const smackRequests = [];
    /** Player ids that pressed throw (RB / G) this tick. */
    const throwRequests = new Set();
    for (const [id, state] of this.players) {
      const isHuman = this.inputQueues.has(id);
      state._interactHeld = false;

      if (this.round.phase === 'intermission') {
        state.emote = null;
        if (state.extracted && state.alive && !state.isAdversary) {
          state.animState = 'win';
        }
        state.velocity.x = 0;
        state.velocity.z = 0;
        if (isHuman) {
          const queue = this.inputQueues.get(id);
          if (queue?.length) {
            seqs[id] = queue[queue.length - 1].seq;
            if (!this._lastSeq) this._lastSeq = new Map();
            this._lastSeq.set(id, seqs[id]);
            queue.length = 0;
          } else {
            seqs[id] = this._lastSeq?.get(id) ?? 0;
          }
        } else {
          seqs[id] = 0;
        }
        continue;
      }

      if (state.extracted && state.alive) {
        state.emote = null;
        state.animState = 'win';
        state.velocity.x = 0;
        state.velocity.z = 0;
        if (isHuman) {
          const queue = this.inputQueues.get(id);
          if (queue?.length) {
            seqs[id] = queue[queue.length - 1].seq;
            if (!this._lastSeq) this._lastSeq = new Map();
            this._lastSeq.set(id, seqs[id]);
            queue.length = 0;
          } else {
            seqs[id] = this._lastSeq?.get(id) ?? 0;
          }
        } else {
          seqs[id] = 0;
        }
        continue;
      }

      // --- Tick cooldowns ---
      if (state.grabCooldown > 0) state.grabCooldown = Math.max(0, state.grabCooldown - dt);
      if (state.smackCooldown > 0) state.smackCooldown = Math.max(0, state.smackCooldown - dt);

      // --- Smack stun recovery ---
      if (state.smackStunTimer > 0) {
        state.smackStunTimer = Math.max(0, state.smackStunTimer - dt);
        if (state.smackStunTimer <= 0) {
          // Recover from smack stun
          state.alive = true;
          state.animState = 'idle';
          state.deathTime = 0;
          state.health = Math.max(state.health, 1);
        } else {
          // Still stunned — skip physics for this player
          seqs[id] = this._lastSeq?.get(id) ?? 0;
          if (isHuman) {
            const queue = this.inputQueues.get(id);
            if (queue?.length) {
              seqs[id] = queue[queue.length - 1].seq;
              if (!this._lastSeq) this._lastSeq = new Map();
              this._lastSeq.set(id, seqs[id]);
              queue.length = 0;
            }
          }
          continue;
        }
      }

      if (!state.alive) {
        if (state.spectator) {
          seqs[id] = this._lastSeq?.get(id) ?? 0;
          if (isHuman) {
            const q = this.inputQueues.get(id);
            if (q?.length) {
              seqs[id] = q[q.length - 1].seq;
              if (!this._lastSeq) this._lastSeq = new Map();
              this._lastSeq.set(id, seqs[id]);
              q.length = 0;
            }
          }
          continue;
        }
        if (state.deathTime <= 0) {
          state.deathTime = now;
        } else if (now - state.deathTime >= RAID_RESPAWN_SECONDS) {
          this.mouseLaunchWorld.removePlayer(id);
          this.ropeWorld.removePlayer(id);
          this._lastRopeGrab.delete(id);
          this._lastRopeJump.delete(id);
          const spawn = this._pickRespawnPoint();
          respawnPlayer(state, spawn.x, spawn.z, spawn.y);
          this.stats?.recordRespawn(id);
          if (!isHuman) {
            resetMouseBotBrain(this.botBrains.get(id));
          }
          seqs[id] = this._lastSeq?.get(id) ?? 0;
          continue;
        }
        seqs[id] = this._lastSeq?.get(id) ?? 0;
        continue;
      }

      if (this.mouseLaunchWorld.isFlying(id)) {
        // Ack + discard inputs captured during flight so we don't replay a
        // burst of queued walk inputs the instant the launch ends.
        if (isHuman) {
          const queue = this.inputQueues.get(id);
          if (queue && queue.length) {
            const latest = queue[queue.length - 1];
            seqs[id] = latest.seq;
            if (this._lastSeq) this._lastSeq.set(id, latest.seq);
            queue.length = 0;
          } else {
            seqs[id] = this._lastSeq?.get(id) ?? 0;
          }
        } else {
          seqs[id] = 0;
        }
        continue;
      }
      if (state.roombaLaunch?.phase === 'suck') {
        seqs[id] = isHuman ? (this._lastSeq?.get(id) ?? 0) : 0;
        continue;
      }
      if (this.ropeWorld.isSwinging(id)) {
        if (isHuman) {
          const queue = this.inputQueues.get(id);
          if (queue && queue.length) {
            let latest = null;
            let anyRelease = false;
            let scootUp = false;
            let runningGrab = this._lastRopeGrab.get(id) ?? false;
            let runningJump = this._lastRopeJump?.get(id) ?? false;
            if (!this._lastRopeJump) this._lastRopeJump = new Map();
            for (const input of queue) {
              latest = input;
              if (runningGrab && !input.ropeGrab) anyRelease = true;
              runningGrab = !!input.ropeGrab;
              // Rising edge of jump while swinging = scoot up one segment.
              const jumpNow = !!(input.jumpPressed ?? input.jump);
              if (!runningJump && jumpNow) scootUp = true;
              runningJump = jumpNow;
              seqs[id] = input.seq;
            }
            state._interactHeld = !!(latest?.interactHeld);
            this._lastRopeGrab.set(id, runningGrab);
            this._lastRopeJump.set(id, runningJump);
            state._ropeInput = {
              moveX: latest?.moveX ?? 0,
              moveZ: latest?.moveZ ?? 0,
              scootUp,
              releasePressed: anyRelease,
            };
            // When release fires this tick, clear edge trackers so the next
            // grab session starts clean (no phantom scoot from a stale held
            // jump, no immediate re-release from a stale grab bit).
            if (anyRelease) {
              this._lastRopeGrab.set(id, false);
              this._lastRopeJump.set(id, false);
            }
            queue.length = 0;
            if (!this._lastSeq) this._lastSeq = new Map();
            this._lastSeq.set(id, seqs[id]);
          } else {
            seqs[id] = this._lastSeq?.get(id) ?? 0;
            state._ropeInput = { moveX: 0, moveZ: 0, scootUp: false, releasePressed: false };
          }
        } else {
          state._ropeInput = { moveX: 0, moveZ: 0, scootUp: false, releasePressed: true };
          seqs[id] = 0;
        }
        continue;
      }

      if (isHuman) {
        const queue = this.inputQueues.get(id);
        if (!queue || queue.length === 0) {
          const vacuumPull = roombaForVacuum?.phase === 'vacuuming'
            ? getRoombaVacuumPullAcceleration(roombaForVacuum, state)
            : null;
          simulatePlayerTick(state, {
            moveX: 0,
            moveZ: 0,
            sprint: false,
            jump: false,
            jumpPressed: false,
            jumpHeld: false,
            crouch: false,
            rotation: state.rotation,
          }, dt, BOUNDS, this.levelColliders, vacuumPull);
          state.emote = null;
          seqs[id] = this._lastSeq?.get(id) ?? 0;
        } else {
          let didSmack = false;
          let didThrow = false;
          let lastGrab = false;
          let heroActivateReq = false;
          let adversaryToggleReq = false;
          let ropeGrabPress = false;
          const prevRopeGrab = this._lastRopeGrab.get(id) ?? false;
          let lastRopeGrab = prevRopeGrab;
          // Track jump edges here too so a space press that occurs on the
          // same tick we grab the rope triggers a scoot (otherwise that
          // rising edge gets eaten by simulateTick and the swing branch
          // starts with jumpPressed already false).
          if (!this._lastRopeJump) this._lastRopeJump = new Map();
          let runningJump = this._lastRopeJump.get(id) ?? false;
          let grabTickJumpPress = false;
          let latestInput = null;
          for (const input of queue) {
            latestInput = input;
            const vacuumPull = roombaForVacuum?.phase === 'vacuuming'
              ? getRoombaVacuumPullAcceleration(roombaForVacuum, state)
              : null;
            simulatePlayerTick(state, input, dt, BOUNDS, this.levelColliders, vacuumPull);
            state.emote = input.emote ?? null;
            seqs[id] = input.seq;
            lastGrab = !!input.grab;
            if (input.smack) didSmack = true;
            if (input.throw) didThrow = true;
            if (input.heroActivate) heroActivateReq = true;
            if (input.adversaryToggle) adversaryToggleReq = true;
            if (!lastRopeGrab && input.ropeGrab) ropeGrabPress = true;
            lastRopeGrab = !!input.ropeGrab;
            const jumpNow = !!(input.jumpPressed ?? input.jump);
            if (!runningJump && jumpNow) grabTickJumpPress = true;
            runningJump = jumpNow;
          }
          state._interactHeld = !!(latestInput?.interactHeld);
          this._lastRopeGrab.set(id, lastRopeGrab);
          this._lastRopeJump.set(id, runningJump);
          // Press-and-hold grapple: while R is held we keep trying to grab each
          // tick so walking into a rope with R already down latches on.
          if (lastRopeGrab && state.alive && !state.ropeSwing) {
            const grabbed = this.ropeWorld.tryGrab(id, state);
            if (grabbed && grabTickJumpPress) {
              this.ropeWorld.scootUp?.(id, state);
            }
          }
          if (lastGrab) grabHeld.add(id);
          if (didSmack) smackRequests.push(id);
          if (didThrow) throwRequests.add(id);
          if (adversaryToggleReq && this.round.phase !== 'intermission' && !state.spectator) {
            if (state.isAdversary) {
              this._setAdversary(state, false, id);
            } else if (!this._currentAdversaryId()) {
              this._setAdversary(state, true, id);
            }
          }
          // In dev (DEV_LAYOUT_SYNC_ENABLED), let H instantly toggle hero mode
          // for fast iteration. Production still requires election eligibility.
          const devHeroBypass = isDevLayoutSyncEnabled(this.room);
          if (heroActivateReq && devHeroBypass) {
            if (state.isHero) {
              this._endHeroMode(state);
            } else {
              this._startHeroMode(state);
            }
          } else if (heroActivateReq && state.heroAvailable && !state.isHero) {
            this._startHeroMode(state, state.heroAvatarAvailable ?? pickHeroAvatar());
          }
          if (!this._lastSeq) this._lastSeq = new Map();
          this._lastSeq.set(id, seqs[id]);
          queue.length = 0;
        }
      } else {
        const brain = this.botBrains.get(id);
        if (!brain) {
          seqs[id] = 0;
          continue;
        }
        const peerPositions = [];
        const reservedCheeseIds = new Set();
        const reservedGoalPositions = [];
        for (const [otherId, otherState] of this.players) {
          if (otherId === id || !otherState?.alive) continue;
          peerPositions.push({
            x: otherState.position.x,
            z: otherState.position.z,
          });
        }
        for (const [otherId, otherBrain] of this.botBrains) {
          if (otherId === id || !otherBrain) continue;
          const otherBotState = this.players.get(otherId);
          if (!otherBotState?.alive) continue;
          if (otherBrain.cheeseTargetId) reservedCheeseIds.add(otherBrain.cheeseTargetId);
          if (otherBrain.goal) {
            reservedGoalPositions.push({
              x: otherBrain.goal.x,
              z: otherBrain.goal.z,
            });
          }
        }
        const input = buildMouseBotInput(
          state,
          brain,
          this.levelMouseNavMesh,
          this.predators,
          dt,
          this.spawnPoints,
          BOUNDS,
          now,
          {
            peerPositions,
            colliders: this.levelColliders,
            cheesePickups: this.cheeseWorld.pickups,
            reservedCheeseIds,
            reservedGoalPositions,
            roundPhase: this.round.phase,
            extractionPortals: this.extractionPortalDefs,
          },
        );
        const vacuumPull = roombaForVacuum?.phase === 'vacuuming'
          ? getRoombaVacuumPullAcceleration(roombaForVacuum, state)
          : null;
        simulatePlayerTick(state, input, dt, BOUNDS, this.levelColliders, vacuumPull);
        state.emote = input.emote ?? null;
        state._interactHeld = !!input.interactHeld;
        seqs[id] = 0;
      }
    }

    // --- Process smack interactions ---
    for (const attackerId of smackRequests) {
      const attacker = this.players.get(attackerId);
      if (!attacker?.alive || attacker.smackCooldown > 0 || attacker.extracted || attacker.spectator || attacker.isAdversary) continue;
      // A smack also boots any ball in front of the attacker, regardless of whether it lands on a player.
      const smackRot = attacker.rotation ?? 0;
      const smackFx = Math.sin(smackRot);
      const smackFz = Math.cos(smackRot);
      const ballsHit = this.pushBallWorld.smackBallsInFront(
        attacker.position,
        smackFx,
        smackFz,
        { range: SMACK_RANGE, speed: 12, upSpeed: 3.8 },
      );
      if (ballsHit > 0) {
        attacker.smackCooldown = SMACK_COOLDOWN;
      }
      // Find nearest alive player in range
      let bestId = null;
      let bestDist = SMACK_RANGE;
      for (const [otherId, other] of this.players) {
        if (otherId === attackerId || !other.alive || other.smackStunTimer > 0) continue;
        if (other.extracted || other.spectator || other.isAdversary) continue;
        const dx = other.position.x - attacker.position.x;
        const dz = other.position.z - attacker.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = otherId;
        }
      }
      if (bestId) {
        const target = this.players.get(bestId);
        if (attacker.roundStats) {
          attacker.roundStats.smacksLanded = (attacker.roundStats.smacksLanded ?? 0) + 1;
        }
        attacker.smackCooldown = SMACK_COOLDOWN;
        target.smackStunTimer = SMACK_STUN_DURATION;
        target.alive = false;
        target.animState = 'death';
        target.deathTime = 0; // prevent respawn timer — smackStunTimer handles recovery
        this.cheeseWorld.onDeathDropCarried(target);
        // Knockback away from attacker
        const dx = target.position.x - attacker.position.x;
        const dz = target.position.z - attacker.position.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        target.velocity.x += (dx / len) * SMACK_KNOCKBACK;
        target.velocity.y += 3; // pop them up
        target.velocity.z += (dz / len) * SMACK_KNOCKBACK;
        // Break any grab involving this target
        if (target.grabbedBy) {
          const grabber = this.players.get(target.grabbedBy);
          if (grabber) grabber.grabbedTarget = null;
          target.grabbedBy = null;
        }
        if (target.grabbedTarget) {
          const grabbed = this.players.get(target.grabbedTarget);
          if (grabbed) grabbed.grabbedBy = null;
          target.grabbedTarget = null;
        }
        if (target.grabbedBallId) {
          target.grabbedBallId = null;
        }
      }
    }

    // --- Process grab interactions (hold-based) ---
    // Release grabs for anyone who stopped holding Q (mice + balls).
    for (const [id, state] of this.players) {
      if (state.grabbedTarget && !grabHeld.has(id)) {
        const target = this.players.get(state.grabbedTarget);
        if (target) target.grabbedBy = null;
        state.grabbedTarget = null;
      }
      if (state.grabbedBallId && !grabHeld.has(id)) {
        // Drop the ball gently in front of the grabber so it doesn't snap
        // back through the player capsule.
        state.grabbedBallId = null;
      }
    }
    // Track which balls are already claimed so we don't double-grab one.
    const claimedBalls = new Set();
    for (const [, state] of this.players) {
      if (state.grabbedBallId) claimedBalls.add(state.grabbedBallId);
    }
    // Initiate new grabs for players holding Q without an active grab. Mice
    // are preferred; balls are a fallback when no player is in range.
    for (const grabberId of grabHeld) {
      const grabber = this.players.get(grabberId);
      if (!grabber?.alive || grabber.grabCooldown > 0 || grabber.grabbedTarget || grabber.grabbedBallId || grabber.extracted || grabber.spectator || grabber.isAdversary) continue;
      // Find nearest alive player in range
      let bestId = null;
      let bestDist = GRAB_RANGE;
      for (const [otherId, other] of this.players) {
        if (otherId === grabberId || !other.alive || other.smackStunTimer > 0) continue;
        if (other.extracted || other.spectator || other.isAdversary) continue;
        const dx = other.position.x - grabber.position.x;
        const dz = other.position.z - grabber.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = otherId;
        }
      }
      if (bestId) {
        const target = this.players.get(bestId);
        // Break any existing grabs on the target
        if (target.grabbedBy) {
          const oldGrabber = this.players.get(target.grabbedBy);
          if (oldGrabber) oldGrabber.grabbedTarget = null;
        }
        grabber.grabbedTarget = bestId;
        target.grabbedBy = grabberId;
        // One-shot grab pose window: both players play the grab anim briefly
        // at the moment of capture, then resume their normal anims.
        grabber.grabAnimTimer = 0.6;
        target.grabAnimTimer = 0.6;
        if (grabber.roundStats) {
          grabber.roundStats.grabsInitiated = (grabber.roundStats.grabsInitiated ?? 0) + 1;
        }
        continue;
      }
      // No mouse in range — try the nearest ball.
      let bestBall = null;
      let bestBallDist = GRAB_RANGE;
      for (const entry of this.pushBallWorld.getBallEntries()) {
        if (claimedBalls.has(entry.id)) continue;
        const dx = entry.body.position.x - grabber.position.x;
        const dz = entry.body.position.z - grabber.position.z;
        const dy = entry.body.position.y - (grabber.position.y + 0.5);
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        // Use ball radius as a small slack so we can scoop the bigger push-ball.
        if (distXZ - entry.radius > bestBallDist) continue;
        if (Math.abs(dy) > 1.4 + entry.radius) continue;
        const effective = distXZ - entry.radius;
        if (effective < bestBallDist) {
          bestBallDist = effective;
          bestBall = entry;
        }
      }
      if (bestBall) {
        grabber.grabbedBallId = bestBall.id;
        grabber.grabAnimTimer = 0.6;
        claimedBalls.add(bestBall.id);
      }
    }

    // --- Apply grab movement coupling ---
    const processedGrabs = new Set();
    for (const [id, state] of this.players) {
      if (!state.grabbedTarget || processedGrabs.has(id)) continue;
      const target = this.players.get(state.grabbedTarget);
      if (!target || !target.alive || !state.alive) {
        // Grab broken — target dead or gone
        if (target) target.grabbedBy = null;
        state.grabbedTarget = null;
        continue;
      }
      processedGrabs.add(id);
      processedGrabs.add(state.grabbedTarget);

      // Blend velocities: initiator has advantage
      const gVx = state.velocity.x;
      const gVz = state.velocity.z;
      const tVx = target.velocity.x;
      const tVz = target.velocity.z;
      const adv = GRAB_INITIATOR_ADVANTAGE;
      const blendVx = gVx * adv + tVx * (1 - adv);
      const blendVz = gVz * adv + tVz * (1 - adv);
      state.velocity.x = blendVx;
      state.velocity.z = blendVz;
      target.velocity.x = blendVx;
      target.velocity.z = blendVz;

      // Snap target above the grabber's head each tick so they look carried
      // upside-down. Slight forward offset avoids clipping into the grabber.
      const GRAB_HOLD_FORWARD = 0.15;
      const GRAB_HOLD_UP = 1.0;
      const rot = state.rotation ?? 0;
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      target.position.x = state.position.x + fx * GRAB_HOLD_FORWARD;
      target.position.z = state.position.z + fz * GRAB_HOLD_FORWARD;
      target.position.y = state.position.y + GRAB_HOLD_UP;
      target.rotation = rot;

      // Only play the grab animation briefly at the start of the grab so it
      // reads as a gesture; afterwards the normal physics-driven anim resumes.
      if ((state.grabAnimTimer ?? 0) > 0) {
        state.grabAnimTimer = Math.max(0, state.grabAnimTimer - dt);
        state.animState = 'grab';
      }
      if ((target.grabAnimTimer ?? 0) > 0) {
        target.grabAnimTimer = Math.max(0, target.grabAnimTimer - dt);
        target.animState = 'grab';
      }
    }

    // --- Pin held balls above the grabber's head each tick ---
    // Done before pushBallWorld.step so the proxy capsule doesn't immediately
    // shove the ball away from its hold position.
    const BALL_HOLD_FORWARD = 0.0;
    const BALL_HOLD_UP = 1.05;
    for (const [, state] of this.players) {
      if (!state.grabbedBallId || !state.alive) {
        if (state.grabbedBallId && !state.alive) state.grabbedBallId = null;
        continue;
      }
      const entry = this.pushBallWorld.getBallEntry(state.grabbedBallId);
      if (!entry) {
        state.grabbedBallId = null;
        continue;
      }
      const rot = state.rotation ?? 0;
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      const hx = state.position.x + fx * BALL_HOLD_FORWARD;
      const hz = state.position.z + fz * BALL_HOLD_FORWARD;
      const hy = state.position.y + BALL_HOLD_UP + entry.radius;
      this.pushBallWorld.pinBall(state.grabbedBallId, hx, hy, hz);
      if ((state.grabAnimTimer ?? 0) > 0) state.animState = 'grab';
    }

    // --- Throw: release any held mouse / ball with a forward + up impulse ---
    // Mice are tossed via the same cannon-es flight world the roomba uses, so
    // they actually arc through walls/floors instead of being short-circuited
    // by the smack-stun gate that skips physics for downed players.
    const THROW_BALL_SPEED = 14;
    const THROW_BALL_UP = 5.5;
    const THROW_BALL_SPIN = 8;
    for (const throwerId of throwRequests) {
      const thrower = this.players.get(throwerId);
      if (!thrower?.alive || thrower.spectator || thrower.extracted) continue;
      const rot = thrower.rotation ?? 0;
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      if (thrower.grabbedTarget) {
        const target = this.players.get(thrower.grabbedTarget);
        if (target) {
          // Pop the target slightly forward of the thrower so the launch
          // sphere doesn't spawn inside their capsule and immediately collide.
          target.position.x = thrower.position.x + fx * 0.6;
          target.position.z = thrower.position.z + fz * 0.6;
          target.position.y = thrower.position.y + 0.9;
          target.grabbedBy = null;
          target.grabCooldown = GRAB_COOLDOWN;
          this.mouseLaunchWorld.startFlight(target.id ?? thrower.grabbedTarget, target, fx, fz);
          if (thrower.roundStats) {
            thrower.roundStats.throwsLanded = (thrower.roundStats.throwsLanded ?? 0) + 1;
          }
        }
        thrower.grabbedTarget = null;
        thrower.grabCooldown = GRAB_COOLDOWN;
      }
      if (thrower.grabbedBallId) {
        this.pushBallWorld.applyBallImpulse(
          thrower.grabbedBallId,
          fx * THROW_BALL_SPEED,
          THROW_BALL_UP,
          fz * THROW_BALL_SPEED,
          THROW_BALL_SPIN,
        );
        thrower.grabbedBallId = null;
        thrower.grabCooldown = GRAB_COOLDOWN;
      }
    }

    this.pushBallWorld.syncPlayers(this.players);
    this.pushBallWorld.step(dt);

    const playersObj = Object.fromEntries(this.players);
    const mousePlayersObj = Object.fromEntries(
      [...this.players].filter(([, p]) => !p?.isAdversary),
    );
    const catPredators = this.predators.filter((p) => p.type !== 'roomba');
    for (const pred of this.predators) {
      if (pred.type === 'roomba') {
        simulateRoombaTick(
          pred,
          mousePlayersObj,
          catPredators,
          dt,
          this.levelColliders,
          this.levelRoombaNavMesh,
          this.roombaCannonWorld,
          this.mouseLaunchWorld,
        );
        continue;
      }
      const hit = simulatePredatorTick(
        pred,
        mousePlayersObj,
        dt,
        this.levelColliders,
        this.levelNavMesh,
        this.pushBallWorld.getBallsForAi(),
      );
      if (hit) {
        const target = this.players.get(hit.playerId);
        if (target && target.alive) {
          this.stats?.recordCatHit(hit.playerId);
          target.health -= hit.damage;
          if (target.health <= 0) {
            target.health = 0;
            target.deaths = (target.deaths ?? 0) + 1;
            target.livesRemaining = Math.max(0, (target.livesRemaining ?? LIVES_PER_ROUND) - 1);
            target.spectator = target.livesRemaining <= 0;
            target.alive = false;
            target.animState = 'death';
            this.cheeseWorld.onDeathDropCarried(target);
            this.stats?.recordDeath(hit.playerId);
          }
          target.velocity.x += hit.knockbackX;
          target.velocity.z += hit.knockbackZ;
          if (!target.alive) {
            target.roombaLaunch = null;
            target.ropeSwing = null;
            this.mouseLaunchWorld.removePlayer(hit.playerId);
            this.ropeWorld.removePlayer(hit.playerId);
          }
        }
      }
    }

    this.mouseLaunchWorld.step(dt, (pid) => this.players.get(pid));
    this.ropeWorld.step(dt, (pid) => this.players.get(pid));

    tickPlayerChaseScores(new Map([...this.players].filter(([, p]) => !p?.isAdversary)), this.predators, dt);

    const cheesePre = new Map();
    for (const [pid, st] of this.players) {
      cheesePre.set(pid, st.cheeseCarried ?? 0);
    }
    this.cheeseWorld.collectFromPlayers(new Map([...this.players].filter(([, p]) => !p?.isAdversary)));
    for (const [pid, state] of this.players) {
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
      }
    }

    if (this.round.phase === 'extract') {
      for (const [, state] of this.players) {
        if (!state.alive || state.spectator || state.extracted || state.isAdversary) {
          if (!state.extracted) state.extractProgress = 0;
          continue;
        }
        const held = !!state._interactHeld;
        const near = isNearExtractionPortal(state.position.x, state.position.z, this.extractionPortalDefs);
        if (held && near) {
          state.extractProgress = Math.min(1, (state.extractProgress ?? 0) + dt / EXTRACT_HOLD_SECONDS);
          if (state.extractProgress >= 1) {
            state.extracted = true;
            state.extractProgress = 1;
            state.animState = 'win';
            state.emote = null;
            state.velocity.x = 0;
            state.velocity.z = 0;
          }
        } else {
          state.extractProgress = Math.max(0, (state.extractProgress ?? 0) - dt * 1.15);
        }
      }
    } else {
      for (const state of this.players.values()) {
        if (!state.extracted) state.extractProgress = 0;
      }
    }
    this._tickAdversaryScores(dt);
    for (const [id, state] of this.players) {
      if (!this.inputQueues.has(id)) continue;
      this.stats?.recordPlayerBests(id, {
        displayName: state.displayName,
        chaseSeconds: playerChaseRecordSeconds(state),
        cheeseHeld: state.cheeseCarried ?? 0,
      });
    }

      const snapshot = {
        type: 'snapshot',
        tick: Date.now(),
      seqs,
      players: playersObj,
      predators: this.predators.map((p) => (p.type === 'roomba' ? serializeRoombaState(p) : serializePredatorState(p))),
      pushBalls: this.pushBallWorld.getBallsState(),
      cheesePickups: this.cheeseWorld.serializePickups(),
      ropes: this.ropeWorld.getRopesSnapshot(),
      round: this.round,
      adversary: {
        playerId: this._currentAdversaryId(),
        available: !this._currentAdversaryId() && this.round.phase !== 'intermission',
        safeRadius: ADVERSARY_SAFE_RADIUS,
      },
        extractionPortals: this.round.phase === 'extract' ? this.extractionPortalDefs : [],
      };
      this.broadcast(JSON.stringify(snapshot));
    } catch (error) {
      this._reportUnhandledError('tick', error, {
        players: this.players.size,
        humans: this.inputQueues.size,
        predators: this.predators.length,
      });
    } finally {
      const t1 = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      this._recordBenchTickMs(t1 - t0);
    }
  }

  broadcast(message, exclude = []) {
    const byteLen = utf8ByteLength(message);
    for (const conn of this.room.getConnections()) {
      if (!exclude.includes(conn.id)) {
        this._sendToConnection(conn, message, byteLen);
      }
    }
  }

  async onRequest(request) {
    const url = new URL(request.url);
    const env = this.room.env ?? this.room.context?.env ?? {};
    try {
      const isLeaderboardRequest = url.pathname.endsWith('/leaderboard');
      const isStatsRequest = url.pathname.endsWith('/stats');
      const isBenchReset = url.pathname.endsWith('/bench-metrics/reset');
      const isBenchMetrics = url.pathname.endsWith('/bench-metrics') && !isBenchReset;

      if (request.method === 'OPTIONS' && (isLeaderboardRequest || isStatsRequest || isBenchMetrics || isBenchReset)) {
        return new Response(null, {
          status: 204,
          headers: corsHeadersForRequest(request, env),
        });
      }

      if (isLeaderboardRequest) {
        return jsonResponse(request, env, await this.stats.getLeaderboards());
      }

      if (isBenchMetrics || isBenchReset) {
        const benchTok = getPartyEnv(this.room, 'BENCH_METRICS_TOKEN');
        const expected = typeof benchTok === 'string' ? benchTok.trim() : '';
        if (!expected) {
          return jsonResponse(request, env, {
            error: 'Set BENCH_METRICS_TOKEN in PartyKit env to enable bench-metrics',
          }, 503);
        }
        const authHeader = request.headers.get('Authorization') ?? '';
        const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (bearerToken !== expected) {
          return new Response('Unauthorized', { status: 401 });
        }
        if (request.method === 'POST' && isBenchReset) {
          this._resetBenchMetrics();
          return jsonResponse(request, env, { ok: true, reset: true });
        }
        if (request.method === 'GET' && isBenchMetrics) {
          return jsonResponse(request, env, this.getBenchMetricsPayload());
        }
        return new Response('Method not allowed', { status: 405 });
      }

      if (!isStatsRequest) {
        return new Response('Not found', { status: 404 });
      }

      const adminTok = getPartyEnv(this.room, 'STATS_ADMIN_TOKEN');
      const collectorTok = getPartyEnv(this.room, 'STATS_COLLECTOR_TOKEN');
      const expectedToken = (typeof adminTok === 'string' && adminTok.trim() !== '')
        ? adminTok
        : (typeof collectorTok === 'string' && collectorTok.trim() !== '' ? collectorTok : '');

      if (!expectedToken) {
        return jsonResponse(request, env, {
          error: 'Set STATS_ADMIN_TOKEN or STATS_COLLECTOR_TOKEN for /stats',
        }, 503);
      }

      const authHeader = request.headers.get('Authorization') ?? '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearerToken !== expectedToken) {
        return new Response('Unauthorized', { status: 401 });
      }

      const summary = await this.stats.getSummary();
      return jsonResponse(request, env, summary);
    } catch (error) {
      this._reportUnhandledError(`onRequest:${request.method} ${url.pathname}`, error);
      return jsonResponse(request, env, { error: 'Internal error' }, 500);
    }
  }
}
