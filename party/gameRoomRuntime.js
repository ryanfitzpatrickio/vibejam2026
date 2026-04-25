import { applyWallHold, createPlayerState, findNearbyWallContact, simulateTick, respawnPlayer, PHYSICS } from '../shared/physics.js';
import { constrainAdversaryHumanToNavMesh } from '../shared/adversaryHumanNav.js';
import { createMouseBotBrain, buildMouseBotInput, resetMouseBotBrain } from '../shared/mouseBot.js';
import { createPredatorState } from '../shared/predator.js';
import {
  createRoombaState,
  getRoombaVacuumPullAcceleration,
} from '../shared/roomba.js';
import { buildPrimitiveAabb, buildRoomCollidersFromLayout } from '../shared/roomCollision.js';
import kitchenLayout from '../shared/kitchen-layout.generated.js';
import kitchenNavMesh from '../shared/kitchen-navmesh.generated.js';
import kitchenMouseNavMesh from '../shared/kitchen-mouse-navmesh.generated.js';
import kitchenRoombaNavMesh from '../shared/kitchen-roomba-navmesh.generated.js';
import kitchenAdversaryHumanNavMesh from '../shared/kitchen-adversary-human-navmesh.generated.js';
import { collectSpawnPointsFromLayout } from '../shared/spawnPoints.js';
import { collectVibePortalPlacementsFromLayout } from '../shared/vibePortal.js';
import { StatsTracker } from './stats.js';
import { createPushBallWorld } from './pushBallWorld.js';
import { createRoombaCannonWorld } from './roombaCannonWorld.js';
import { createMouseLaunchWorld } from './mouseLaunchWorld.js';
import { createRopeWorld } from './ropeWorld.js';
import { createFanWorld } from './fanWorld.js';
import { CheeseWorld } from './cheeseWorld.js';
import { createBenchMetrics } from './benchMetrics.js';
import { handleGameServerRequest } from './httpRoutes.js';
import { createRoomRegistryPublisher, getCurrentRoomId } from './roomRegistry.js';
import { handleGameMessage } from './messageRouter.js';
import { createWsTransport, utf8ByteLength } from './wsTransport.js';
import { emitNoise, handleSqueak, tickNoiseAggro } from './noiseSystem.js';
import { findRaidTaskById, handleTaskComplete } from './taskSystem.js';
import {
  currentAdversaryId,
  recordAdversaryScore,
  setAdversary,
  tickAdversaryScores,
} from './adversarySystem.js';
import { buildInitPayload, buildSnapshotPayload } from './snapshotSystem.js';
import {
  applyGrabCoupling,
  pinHeldBalls,
  processSmackRequests,
  processThrowRequests,
} from './combatSystem.js';
import { processGrabAcquisition } from './grabSystem.js';
import { stepWorldAndScore } from './worldStepSystem.js';
import {
  CHARGED_SMACK_MAX_HOLD_SECONDS,
  CHARGED_THROW_MIN_HOLD_SECONDS,
  GRAB_COOLDOWN,
  GRAB_RETRY_INTERVAL_SECONDS,
  MISCHIEF_POINTS,
  QUICK_TOSS_FULL_HOLD_SECONDS,
  THROW_SMACK_SUPPRESS_SECONDS,
} from './interactionTuning.js';
import { LEVEL_WORLD_BOUNDS_XZ } from '../shared/levelWorldBounds.js';
import {
  createRoundState,
  RESPAWN_SECONDS as RAID_RESPAWN_SECONDS,
} from '../shared/roundState.js';
import {
  advanceRoundPhase,
  finishRound,
  startNewRound,
} from './roundSystem.js';
import { collectExtractionPortalsFromLayout } from '../shared/extractionPortals.js';
import {
  endHeroMode,
  handleClaimHero,
  handleUnlockPickup,
  maybeElectHero,
  pickHeroAvatar,
  scatterUnlockItems,
  startHeroMode,
  tickHeroTimers,
} from './heroSystem.js';

/**
 * PartyKit env (dashboard / project .env for `partykit dev`):
 * - ENVIRONMENT — set "production" in deployed environments to fail closed on security-critical config
 * - STATS_ADMIN_TOKEN — required; GET …/stats returns 503 if missing
 * - GET …/leaderboard returns public aggregate leaderboards
 * - ALLOWED_ORIGINS — comma-separated browser origins allowed to open WebSockets
 * - TURNSTILE_SECRET — Cloudflare Turnstile secret key; when set, every WS
 *   upgrade must carry a valid single-use ?cfToken=… (client fetches via
 *   VITE_TURNSTILE_SITE_KEY). Leave unset to disable (dev default).
 * - ALLOW_EMPTY_ORIGIN — set "true" ONLY to debug non-browser clients; in prod
 *   empty Origin headers are rejected (scripts like node `ws` send none).
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
const BOT_THROW_GRAB_HOLD_MIN_SECONDS = 2.1;
const BOT_THROW_GRAB_HOLD_MAX_SECONDS = 3.4;
const BOT_THROW_WALL_HANG_SECONDS = 1.8;
const BOT_THROW_WALL_PROBE_DISTANCE = 0.38;
const DEFAULT_ENEMY_SPAWNS = Object.freeze([{ x: -5, y: 0, z: -5 }]);
const WS_MESSAGE_RATE_PER_SECOND = 90;
const WS_MESSAGE_BURST = 180;
const MAX_DROPPED_MESSAGES_BEFORE_CLOSE = 180;
const MISCHIEF_COMBO_WINDOW_SECONDS = 3.4;
const BOUNDS = LEVEL_WORLD_BOUNDS_XZ;
function simulatePlayerTick(state, input, dt, bounds, colliders, vacuumPull) {
  const previousPosition = state?.position
    ? { x: state.position.x, y: state.position.y, z: state.position.z }
    : null;
  simulateTick(state, input, dt, bounds, colliders, vacuumPull);
  constrainAdversaryHumanToNavMesh(state, kitchenAdversaryHumanNavMesh, previousPosition);
}

function yawDeltaAbs(a, b) {
  let diff = (Number(a) || 0) - (Number(b) || 0);
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff);
}

function hotSurfaceZoneFromAabb(aabb) {
  if (!aabb?.min || !aabb?.max) return null;
  const minX = aabb.min.x - 0.08;
  const maxX = aabb.max.x + 0.08;
  const minZ = aabb.min.z - 0.08;
  const maxZ = aabb.max.z + 0.08;
  return {
    minX,
    maxX,
    minY: aabb.min.y - 0.65,
    maxY: aabb.max.y + 0.75,
    minZ,
    maxZ,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
  };
}

function collectHotSurfaceZones(layout, colliders) {
  const zones = [];
  const primitives = Array.isArray(layout?.primitives) ? layout.primitives : [];
  for (const primitive of primitives) {
    if (!primitive || primitive.deleted === true) continue;
    if (primitive.gameplayType !== 'hot_surface' && primitive.hazardType !== 'hot_surface') continue;
    const zone = hotSurfaceZoneFromAabb(buildPrimitiveAabb(primitive, 1));
    if (zone) zones.push(zone);
  }

  if (!Array.isArray(colliders)) return zones;
  colliders
    .filter((collider) => {
      const name = String(collider?.metadata?.primitiveName ?? '').toLowerCase();
      return collider?.type === 'surface' && (
        name.includes('stove')
        || name.includes('toaster')
        || name.includes('burner')
        || name.includes('hot')
      );
    })
    .forEach((collider) => {
      const zone = hotSurfaceZoneFromAabb({
        min: { x: collider.aabb.min.x, y: collider.aabb.max.y - 0.25, z: collider.aabb.min.z },
        max: { x: collider.aabb.max.x, y: collider.aabb.max.y + 0.2, z: collider.aabb.max.z },
      });
      if (zone) zones.push(zone);
    });
  return zones;
}

/** Reject oversized WebSocket frames before JSON.parse (DoS). */
const MAX_WS_MESSAGE_CHARS = 256 * 1024;

function getPartyEnv(room, key) {
  return room.env?.[key] ?? room.context?.env?.[key] ?? undefined;
}

function isDevLayoutSyncEnabled(room) {
  const v = getPartyEnv(room, 'DEV_LAYOUT_SYNC_ENABLED');
  return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';
}

export default class GameRoomRuntime {
  players = new Map();
  inputQueues = new Map();
  tickInterval = null;
  levelColliders = buildRoomCollidersFromLayout(kitchenLayout, { scaleFactor: 1 });
  hotSurfaceZones = collectHotSurfaceZones(kitchenLayout, this.levelColliders);
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
  /** @type {Map<string, number>} last task-complete ms by connection id */
  _taskCompleteCooldown = new Map();
  /** @type {Map<string, Set<string>>} per-player task reward claims for the current round */
  _taskCompletionClaims = new Map();
  /** @type {Map<string, number>} last squeak ms by connection id */
  _squeakCooldown = new Map();

  constructor(room) {
    this.room = room;
    this.stats = new StatsTracker(room);
    this.benchMetrics = createBenchMetrics({ tickRate: TICK_RATE });
    this.transport = createWsTransport({
      room,
      benchMetrics: this.benchMetrics,
      messageRatePerSecond: WS_MESSAGE_RATE_PER_SECOND,
      messageBurst: WS_MESSAGE_BURST,
      maxDroppedMessagesBeforeClose: MAX_DROPPED_MESSAGES_BEFORE_CLOSE,
      reportError: (...args) => this._reportUnhandledError(...args),
    });
    this.roomRegistry = createRoomRegistryPublisher({
      room,
      capacity: ROOM_HARD_CAP,
      botFillTarget: BOT_FILL_TARGET,
      getHumanCount: () => this.inputQueues.size,
      getOccupantCount: () => this.players.size,
      reportError: (...args) => this._reportUnhandledError(...args),
    });
    this.predators = [];
    this.pushBallWorld = createPushBallWorld();
    this.roombaCannonWorld = createRoombaCannonWorld();
    this.mouseLaunchWorld = createMouseLaunchWorld();
    this.ropeWorld = createRopeWorld({ ropes: Array.isArray(kitchenLayout?.ropes) ? kitchenLayout.ropes : null });
    this.fanWorld = createFanWorld({ fans: Array.isArray(kitchenLayout?.fans) ? kitchenLayout.fans : null });
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

  _scheduleRoomRegistryUpdate() {
    this.roomRegistry.schedule();
  }

  _sendToConnection(conn, message, byteLen = utf8ByteLength(message)) {
    return this.transport.send(conn, message, byteLen);
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
    return scatterUnlockItems(LEVEL_WORLD_BOUNDS_XZ);
  }

  _applyLayout(layout, { resetPredators = false } = {}) {
    this._layout = layout;
    this._refreshLevelColliders();
    this.spawnPoints = collectSpawnPointsFromLayout(layout);
    this.portalPlacements = collectVibePortalPlacementsFromLayout(layout);
    this.extractionPortalDefs = collectExtractionPortalsFromLayout(layout, this.spawnPoints);
    if (Array.isArray(layout?.ropes)) {
      this.ropeWorld?.setRopes?.(layout.ropes);
    }
    this.fanWorld?.setFans?.(layout?.fans);
    this.cheeseWorld.setNavMesh(this.levelMouseNavMesh);
    if (resetPredators) {
      this.predators = [];
      this._initPredators();
      this.cheeseWorld.seedScatter();
    }
  }

  _completedRaidTaskIds() {
    return this._taskCompletionClaims.get('__global__') ?? new Set();
  }

  _refreshLevelColliders() {
    const layout = this._layout ?? kitchenLayout;
    this.levelColliders = buildRoomCollidersFromLayout(layout, {
      scaleFactor: 1,
      completedTaskIds: this._completedRaidTaskIds(),
    });
    this.hotSurfaceZones = collectHotSurfaceZones(layout, this.levelColliders);
    this.pushBallWorld?.setLevelColliders?.(this.levelColliders);
    this.roombaCannonWorld?.setLevelColliders?.(this.levelColliders);
    this.mouseLaunchWorld?.setLevelColliders?.(this.levelColliders);
    this.ropeWorld?.setLevelColliders?.(this.levelColliders);
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
      this.fanWorld?.removePlayer?.(id);
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
    return currentAdversaryId(this.players);
  }

  _recordAdversaryScore(connectionId, state) {
    recordAdversaryScore(this.stats, connectionId, state);
  }

  _setAdversary(state, active, connectionId = null) {
    setAdversary(this, state, active, connectionId);
  }

  _tickAdversaryScores(dt) {
    tickAdversaryScores(this, dt);
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
      this.transport.resetConnection(conn.id);
      this._syncBots();
      this.stats?.recordConnect(conn.id, this.inputQueues.size);

      const initPayload = JSON.stringify(buildInitPayload(this, conn.id));
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

  async onMessage(message, sender) {
    let messagePath = 'unknown';
    try {
      if (typeof message === 'string') {
        this.benchMetrics.recordIn(utf8ByteLength(message));
      } else if (message instanceof ArrayBuffer) {
        this.benchMetrics.recordIn(message.byteLength);
      } else if (ArrayBuffer.isView(message)) {
        this.benchMetrics.recordIn(message.byteLength);
      }

      const tokenResult = this.transport.acceptMessage(sender.id);
      if (!tokenResult.accepted) {
        if (tokenResult.shouldClose) sender.close();
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

      await handleGameMessage(this, sender, data, {
        maxExtraBallSpawns: MAX_EXTRA_BALL_SPAWNS_PER_PLAYER,
      });
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
      this.transport.deleteConnection(conn.id);
      this._taskCompleteCooldown.delete(conn.id);
      this._taskCompletionClaims.delete(conn.id);
      this._squeakCooldown.delete(conn.id);
      this._claimHeroCooldown.delete(conn.id);
      this._unlockPickupCooldown.delete(conn.id);
      this.portalArrivals.delete(conn.id);
      const leaving = this.players.get(conn.id);
      if (leaving?.isAdversary) this._recordAdversaryScore(conn.id, leaving);
      if (leaving) this.cheeseWorld.onDeathDropCarried(leaving);
      this.mouseLaunchWorld?.removePlayer?.(conn.id);
      this.ropeWorld?.removePlayer?.(conn.id);
      this.fanWorld?.removePlayer?.(conn.id);
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
    advanceRoundPhase(this, wallNow);
  }

  /**
   * Two minutes into the forage phase, pick two leaders:
   *   - Cheese leader (most cheese collected) → Jerry
   *   - Cat chase leader (longest time survived being chased) → Brain
   * Each gets their own hero respawn offer. Runs once per round.
   */
  _maybeElectHero(wallNow) {
    maybeElectHero(this, wallNow);
  }

  _findRaidTaskById(taskId) {
    return findRaidTaskById(this._layout, taskId);
  }

  _awardMischief(player, amount, nowSeconds = Date.now() / 1000) {
    if (!player?.roundStats) return;
    const points = Math.max(0, Math.floor(Number(amount) || 0));
    if (points <= 0) return;
    const rs = player.roundStats;
    const previousComboEndsAt = Number(rs.mischiefComboEndsAt) || 0;
    const previousCombo = Math.max(0, Math.floor(Number(rs.mischiefCombo) || 0));
    rs.mischiefScore = Math.max(0, Math.floor(Number(rs.mischiefScore) || 0)) + points;
    rs.mischiefEvents = Math.max(0, Math.floor(Number(rs.mischiefEvents) || 0)) + 1;
    rs.mischiefCombo = nowSeconds <= previousComboEndsAt ? previousCombo + 1 : 1;
    rs.mischiefComboEndsAt = nowSeconds + MISCHIEF_COMBO_WINDOW_SECONDS;
  }

  _emitNoise(player, radius = 10, threat = 180) {
    emitNoise(this.predators, player, radius, threat);
  }

  _breakPlayerGrabLinks(playerId, state) {
    if (!state) return;
    if (state.grabbedBy) {
      const grabber = this.players.get(state.grabbedBy);
      if (grabber) grabber.grabbedTarget = null;
      state.grabbedBy = null;
    }
    if (state.grabbedTarget) {
      const grabbed = this.players.get(state.grabbedTarget);
      if (grabbed) grabbed.grabbedBy = null;
      state.grabbedTarget = null;
    }
    if (state.grabbedBallId) state.grabbedBallId = null;
    this.ropeWorld?.removePlayer?.(playerId);
    this.fanWorld?.removePlayer?.(playerId);
  }

  _tickNoiseAggro(dt) {
    tickNoiseAggro(this.predators, dt);
  }

  _handleSqueak(senderId) {
    handleSqueak({
      players: this.players,
      predators: this.predators,
      squeakCooldown: this._squeakCooldown,
      broadcast: (message) => this.broadcast(message),
    }, senderId);
  }

  _handleTaskComplete(senderId, data) {
    handleTaskComplete(this, senderId, data, {
      mischiefPoints: MISCHIEF_POINTS,
    });
  }

  _handleUnlockPickup(senderId, data) {
    handleUnlockPickup(this, senderId, data);
  }

  _handleClaimHero(senderId, data) {
    handleClaimHero(this, senderId, data);
  }

  _endHeroMode(state) {
    endHeroMode(state);
  }

  _startHeroMode(state, heroAvatar = pickHeroAvatar()) {
    startHeroMode(state, heroAvatar);
  }

  _tickHeroTimers(dt) {
    tickHeroTimers(this.players, dt);
  }

  _finishRound() {
    finishRound(this);
  }

  _startNewRound() {
    startNewRound(this);
  }

  _resetBenchMetrics() {
    this.benchMetrics.reset();
  }

  _recordBenchTickMs(ms) {
    this.benchMetrics.recordTickMs(ms);
  }

  getBenchMetricsPayload() {
    return this.benchMetrics.payload({
      connectionCount: Array.isArray(this.room.getConnections?.())
        ? this.room.getConnections().length
        : 0,
    });
  }

  _botThrowCatchDuration() {
    return BOT_THROW_GRAB_HOLD_MIN_SECONDS
      + Math.random() * (BOT_THROW_GRAB_HOLD_MAX_SECONDS - BOT_THROW_GRAB_HOLD_MIN_SECONDS);
  }

  _tryBotThrownRecovery(id, state, brain, now) {
    if (!brain || !state?.alive || state.grounded || state.spectator || state.extracted) return false;
    const speed = Math.hypot(state.velocity?.x ?? 0, state.velocity?.y ?? 0, state.velocity?.z ?? 0);
    if (speed < 2.2) return false;

    if (!state.ropeSwing) {
      const grabbedRope = this.ropeWorld?.tryGrab?.(id, state);
      if (grabbedRope) {
        this.mouseLaunchWorld?.removePlayer?.(id);
        state.roombaLaunch = null;
        brain.throwGrabReleaseAt = now + this._botThrowCatchDuration();
        brain.throwWallHangUntil = 0;
        this._lastRopeGrab.set(id, true);
        this._lastRopeJump.set(id, false);
        state._ropeInput = { moveX: 0, moveZ: 0, scootUp: false, releasePressed: false };
        return true;
      }

      const grabbedFan = this.fanWorld?.tryGrab?.(id, state);
      if (grabbedFan) {
        this.mouseLaunchWorld?.removePlayer?.(id);
        state.roombaLaunch = null;
        brain.throwGrabReleaseAt = now + this._botThrowCatchDuration();
        brain.throwWallHangUntil = 0;
        this._lastRopeGrab.set(id, true);
        this._lastRopeJump.set(id, false);
        state._ropeInput = { moveX: 0, moveZ: 0, scootUp: false, releasePressed: false };
        return true;
      }
    }

    const contact = findNearbyWallContact(
      state,
      this.levelColliders,
      PHYSICS.playerRadius,
      PHYSICS.playerHeight,
      BOT_THROW_WALL_PROBE_DISTANCE,
    );
    if (!contact) return false;

    this.mouseLaunchWorld?.removePlayer?.(id);
    state.roombaLaunch = null;
    applyWallHold(state, contact);
    brain.throwWallHangUntil = now + BOT_THROW_WALL_HANG_SECONDS;
    brain.throwGrabReleaseAt = 0;
    return true;
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
    this._tickNoiseAggro(dt);

    const seqs = {};
    const now = Date.now() / 1000;
    const roombaForVacuum = this.predators.find((p) => p.type === 'roomba') ?? null;
    /** Collect interaction requests from this tick's inputs. */
    const grabHeld = new Set();
    const grabAttempts = new Set();
    const quickTossAttempts = new Set();
    const quickTossReleaseIds = new Set();
    const smackRequests = [];
    const chargedSmackRequests = [];
    const chargedThrowRequests = [];
    const quickTossRequests = [];
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
          this.fanWorld.removePlayer(id);
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
          const brain = this.botBrains.get(id);
          if (brain && this._tryBotThrownRecovery(id, state, brain, now)) {
            seqs[id] = 0;
            continue;
          }
          seqs[id] = 0;
        }
        continue;
      }
      if (state.roombaLaunch?.phase === 'suck') {
        seqs[id] = isHuman ? (this._lastSeq?.get(id) ?? 0) : 0;
        continue;
      }
      if (this.ropeWorld.isSwinging(id) || this.fanWorld.isAttached(id)) {
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
          const brain = this.botBrains.get(id);
          const release = !brain?.throwGrabReleaseAt || now >= brain.throwGrabReleaseAt;
          state._ropeInput = { moveX: 0, moveZ: 0, scootUp: false, releasePressed: release };
          if (release && brain) {
            brain.throwGrabReleaseAt = 0;
            this._lastRopeGrab.set(id, false);
            this._lastRopeJump.set(id, false);
          }
          seqs[id] = 0;
        }
        continue;
      }

      if (isHuman) {
        const queue = this.inputQueues.get(id);
        if (!queue || queue.length === 0) {
          if (state._grabHeldInput) {
            grabHeld.add(id);
            const retryAt = Number(state._nextGrabAttemptAt) || 0;
            if (!state.grabbedTarget && !state.grabbedBallId && retryAt <= now) {
              grabAttempts.add(id);
              state._nextGrabAttemptAt = now + GRAB_RETRY_INTERVAL_SECONDS;
            }
          }
          if (state._quickTossHeldInput) {
            grabHeld.add(id);
            const retryAt = Number(state._nextQuickTossAttemptAt) || 0;
            if (!state.grabbedTarget && !state.grabbedBallId && retryAt <= now) {
              quickTossAttempts.add(id);
              state._nextQuickTossAttemptAt = now + GRAB_RETRY_INTERVAL_SECONDS;
            }
            if (state.grabbedTarget && state._quickTossActive) {
              state._quickTossHoldSeconds = Math.min(
                QUICK_TOSS_FULL_HOLD_SECONDS,
                (Number(state._quickTossHoldSeconds) || 0) + dt,
              );
            }
          }
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
          state._chargedJumpHoldSeconds = 0;
          state.emote = null;
          seqs[id] = this._lastSeq?.get(id) ?? 0;
        } else {
          let didSmack = false;
          let didThrow = false;
          let chargedSmackReleaseReq = false;
          let chargedThrowReleaseReq = false;
          let quickTossReleaseReq = false;
          let lastGrab = false;
          let lastQuickToss = !!state._quickTossHeldInput;
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
          const wasGrabHeldInput = !!state._grabHeldInput;
          for (const input of queue) {
            latestInput = input;
            const rotBefore = state.rotation ?? 0;
            const vacuumPull = roombaForVacuum?.phase === 'vacuuming'
              ? getRoombaVacuumPullAcceleration(roombaForVacuum, state)
              : null;
            if (input.jumpPressed || input.jump) {
              input.jumpCharge = Math.max(0, Math.min(1, Number(input.jumpCharge) || 0));
              state._chargedJumpHoldSeconds = 0;
            } else if (input.jumpHeld && state.alive) {
              state._chargedJumpHoldSeconds = Math.min(
                PHYSICS.chargedJumpFullHoldSeconds,
                (Number(state._chargedJumpHoldSeconds) || 0) + dt,
              );
              input.jumpCharge = 0;
            } else {
              state._chargedJumpHoldSeconds = 0;
              input.jumpCharge = 0;
            }
            simulatePlayerTick(state, input, dt, BOUNDS, this.levelColliders, vacuumPull);
            if ((state.grabbedTarget || state.grabbedBallId) && !state.ropeSwing) {
              const spinGain = Math.max(0, yawDeltaAbs(state.rotation, rotBefore) - 0.035);
              state._throwSpinCharge = Math.min(1.5, Math.max(0, Number(state._throwSpinCharge) || 0) + spinGain * 2.6);
            } else {
              state._throwSpinCharge = Math.max(0, (Number(state._throwSpinCharge) || 0) - dt * 2.2);
            }
            state.emote = input.emote ?? null;
            seqs[id] = input.seq;
            lastGrab = !!input.grab;
            if (input.smack) didSmack = true;
            if (input.chargedSmackRelease) chargedSmackReleaseReq = true;
            if (input.chargedThrowRelease) chargedThrowReleaseReq = true;
            if (input.quickTossRelease) quickTossReleaseReq = true;
            if (input.throw) didThrow = true;
            if (input.heroActivate) heroActivateReq = true;
            if (input.adversaryToggle) adversaryToggleReq = true;
            lastQuickToss = !!input.quickTossHeld;
            if (!lastRopeGrab && input.ropeGrab) ropeGrabPress = true;
            lastRopeGrab = !!input.ropeGrab;
            const jumpNow = !!(input.jumpPressed ?? input.jump);
            if (!runningJump && jumpNow) grabTickJumpPress = true;
            runningJump = jumpNow;
          }
          state._interactHeld = !!(latestInput?.interactHeld);
          const suppressSmackForExtract = this.round.phase === 'extract' && state._interactHeld;
          if (suppressSmackForExtract) {
            state._chargedSmackHoldSeconds = 0;
          } else if (chargedSmackReleaseReq) {
            chargedSmackRequests.push({ id, chargeSeconds: Number(state._chargedSmackHoldSeconds) || 0 });
            state._chargedSmackHoldSeconds = 0;
          } else if (latestInput?.smackHeld && state.alive) {
            state._chargedSmackHoldSeconds = Math.min(
              CHARGED_SMACK_MAX_HOLD_SECONDS,
              (Number(state._chargedSmackHoldSeconds) || 0) + dt,
            );
          } else {
            state._chargedSmackHoldSeconds = 0;
          }
          const canChargeThrow = !!(state.grabbedTarget || state.grabbedBallId);
          if (canChargeThrow && (latestInput?.chargedThrowHeld || chargedThrowReleaseReq)) {
            const aimX = Number(latestInput?.chargedThrowAimX) || 0;
            const aimZ = Number(latestInput?.chargedThrowAimZ) || 0;
            const aimLen = Math.hypot(aimX, aimZ);
            if (aimLen > 0.001) {
              state._chargedThrowAimX = aimX / aimLen;
              state._chargedThrowAimZ = aimZ / aimLen;
            }
          }
          if (canChargeThrow && (latestInput?.chargedThrowHeld || chargedThrowReleaseReq || didThrow)) {
            state._suppressSmackUntil = Math.max(
              Number(state._suppressSmackUntil) || 0,
              now + THROW_SMACK_SUPPRESS_SECONDS,
            );
          }
          if (chargedThrowReleaseReq && canChargeThrow) {
            chargedThrowRequests.push({ id, chargeSeconds: Number(state._chargedThrowHoldSeconds) || 0 });
            state._chargedThrowHoldSeconds = 0;
          } else if (latestInput?.chargedThrowHeld && state.alive && canChargeThrow) {
            state._chargedThrowHoldSeconds = Math.min(
              CHARGED_THROW_MIN_HOLD_SECONDS,
              (Number(state._chargedThrowHoldSeconds) || 0) + dt,
            );
          } else {
            state._chargedThrowHoldSeconds = 0;
          }
          const quickTossInputActive = !!(latestInput?.quickTossHeld);
          if (quickTossInputActive || quickTossReleaseReq) {
            const aimX = Number(latestInput?.quickTossAimX) || 0;
            const aimZ = Number(latestInput?.quickTossAimZ) || 0;
            const aimLen = Math.hypot(aimX, aimZ);
            if (aimLen > 0.001) {
              state._quickTossAimX = aimX / aimLen;
              state._quickTossAimZ = aimZ / aimLen;
            }
            state._suppressSmackUntil = Math.max(
              Number(state._suppressSmackUntil) || 0,
              now + THROW_SMACK_SUPPRESS_SECONDS,
            );
          }
          if (quickTossReleaseReq) {
            quickTossReleaseIds.add(id);
            quickTossRequests.push({ id, chargeSeconds: Number(state._quickTossHoldSeconds) || 0 });
            state._quickTossHoldSeconds = 0;
            state._quickTossHeldInput = false;
          } else if (quickTossInputActive && state.alive) {
            if (state.grabbedTarget && state._quickTossActive) {
              state._quickTossHoldSeconds = Math.min(
                QUICK_TOSS_FULL_HOLD_SECONDS,
                (Number(state._quickTossHoldSeconds) || 0) + dt,
              );
            }
          } else {
            state._quickTossHoldSeconds = 0;
            state._quickTossHeldInput = false;
            state._quickTossActive = false;
          }
          this._lastRopeGrab.set(id, lastRopeGrab);
          this._lastRopeJump.set(id, runningJump);
          // Press-and-hold grapple: while R is held we keep trying to grab each
          // tick so walking into a rope with R already down latches on.
          if (lastRopeGrab && state.alive && !state.ropeSwing) {
            const grabbedRope = this.ropeWorld.tryGrab(id, state);
            if (grabbedRope) {
              if (grabTickJumpPress) {
                this.ropeWorld.scootUp?.(id, state);
              }
            } else {
              const grabbedFan = this.fanWorld.tryGrab(id, state);
              if (grabbedFan && grabTickJumpPress) {
                this.fanWorld.scootUp?.(id, state);
              }
            }
          }
          state._grabHeldInput = lastGrab;
          state._quickTossHeldInput = lastQuickToss;
          if (lastGrab) {
            grabHeld.add(id);
            const retryAt = Number(state._nextGrabAttemptAt) || 0;
            if (!wasGrabHeldInput || retryAt <= now) {
              grabAttempts.add(id);
              state._nextGrabAttemptAt = now + GRAB_RETRY_INTERVAL_SECONDS;
            }
          } else {
            state._nextGrabAttemptAt = 0;
          }
          if (lastQuickToss) {
            grabHeld.add(id);
            const retryAt = Number(state._nextQuickTossAttemptAt) || 0;
            if (!state.grabbedTarget && !state.grabbedBallId && retryAt <= now) {
              quickTossAttempts.add(id);
              state._nextQuickTossAttemptAt = now + GRAB_RETRY_INTERVAL_SECONDS;
            }
          } else {
            state._nextQuickTossAttemptAt = 0;
          }
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
        if (brain.throwWallHangUntil && state.wallHolding) {
          const hold = now < brain.throwWallHangUntil;
          const input = {
            moveX: 0,
            moveZ: 0,
            sprint: false,
            jump: false,
            jumpPressed: false,
            jumpHeld: hold,
            crouch: false,
            rotation: state.rotation,
          };
          const vacuumPull = roombaForVacuum?.phase === 'vacuuming'
            ? getRoombaVacuumPullAcceleration(roombaForVacuum, state)
            : null;
          simulatePlayerTick(state, input, dt, BOUNDS, this.levelColliders, vacuumPull);
          state.emote = null;
          state._interactHeld = false;
          if (!hold) brain.throwWallHangUntil = 0;
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
        if (this.round.phase === 'extract' && state._interactHeld) {
          state._chargedSmackHoldSeconds = 0;
        }
        seqs[id] = 0;
      }
    }

    processSmackRequests(this, { chargedSmackRequests, smackRequests, now });

    processGrabAcquisition(this, {
      grabHeld,
      quickTossReleaseIds,
      quickTossAttempts,
      grabAttempts,
    });

    applyGrabCoupling(this, dt);
    pinHeldBalls(this, dt);

    processThrowRequests(this, {
      quickTossRequests,
      chargedThrowRequests,
      throwRequests,
      now,
    });

    const playersObj = stepWorldAndScore(this, dt, now);

      const snapshot = buildSnapshotPayload(this, seqs, playersObj);
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
    this.transport.broadcast(message, exclude);
  }

  async onRequest(request) {
    return handleGameServerRequest(this, request);
  }
}
