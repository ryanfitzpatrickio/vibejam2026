import { RAID_TASK_COMPLETION_MODES, RAID_TASK_TYPES, supportsPhysicalRaidTask } from '../shared/raidLayout.js';
import { completeRaidTask } from './taskSystem.js';

const PHYSICAL_TASK_RADIUS = 1.8;
const PHYSICAL_TASK_RADIUS_SQ = PHYSICAL_TASK_RADIUS * PHYSICAL_TASK_RADIUS;
const FRIDGE_OPEN_DISTANCE = 1.55;
const FRIDGE_PUSH_GAIN = 0.18;
const FRIDGE_LATCH_PULLBACK = 0.08;
const FRIDGE_LATCH_MAX_TRACK_SPEED = 0.42;

function isPlayerEligible(player) {
  return !!player?.alive && !player.spectator && !player.extracted && !player.isAdversary;
}

function taskPosition(task) {
  return {
    x: Number(task?.position?.x) || 0,
    y: Number(task?.position?.y) || 0,
    z: Number(task?.position?.z) || 0,
  };
}

function taskBasis(task) {
  const yaw = Number(task?.rotation?.y) || 0;
  return {
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
    forwardX: Math.sin(yaw),
    forwardZ: Math.cos(yaw),
  };
}

function isNearTask(player, task) {
  const pos = taskPosition(task);
  const dx = pos.x - player.position.x;
  const dz = pos.z - player.position.z;
  const dy = pos.y - player.position.y;
  return dx * dx + dz * dz + dy * dy * 0.18 <= PHYSICAL_TASK_RADIUS_SQ;
}

function nearestEligiblePlayerId(runtime, task) {
  const pos = taskPosition(task);
  let bestId = null;
  let bestD2 = Infinity;
  for (const [id, player] of runtime.players) {
    if (!isPlayerEligible(player)) continue;
    const dx = pos.x - player.position.x;
    const dz = pos.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestId = id;
    }
  }
  return bestId;
}

function canIsKnockedOver(entry) {
  const body = entry?.body;
  if (!body?.quaternion) return false;
  const q = body.quaternion;
  const localUpWorldY = 1 - (2 * ((q.x * q.x) + (q.z * q.z)));
  const dx = body.position.x - (Number(entry.spawn?.x) || 0);
  const dz = body.position.z - (Number(entry.spawn?.z) || 0);
  return localUpWorldY < 0.62 || (dx * dx + dz * dz) > 0.32 * 0.32;
}

function physicalTasks(runtime) {
  return (Array.isArray(runtime._layout?.raidTasks) ? runtime._layout.raidTasks : [])
    .filter((task) => task?.deleted !== true
      && task.completionMode === RAID_TASK_COMPLETION_MODES.PHYSICAL
      && supportsPhysicalRaidTask(task.taskType));
}

function stepFridgeRaid(runtime, task, dt, mischiefPoints) {
  const claims = runtime._taskCompletionClaims.get('__global__');
  if (claims?.has(task.id)) return;

  const state = runtime._physicalTaskStates.get(task.id) ?? {
    id: task.id,
    taskType: task.taskType,
    mode: task.completionMode,
    progress: 0,
    helpers: 0,
    latches: new Map(),
  };
  if (!(state.latches instanceof Map)) state.latches = new Map();

  const basis = taskBasis(task);
  const active = [];
  for (const [id, player] of runtime.players) {
    const latched = state.latches.get(id);
    const shouldLatch = isPlayerEligible(player)
      && !!player._grabHeldInput
      && isNearTask(player, task);
    if (!shouldLatch) {
      if (latched) state.latches.delete(id);
      continue;
    }
    if (player.grabbedTarget || player.grabbedBallId || player.grabbedBy) {
      runtime._breakPlayerGrabLinks?.(id, player);
    }
    const coord = player.position.x * basis.rightX + player.position.z * basis.rightZ;
    const forwardCoord = player.position.x * basis.forwardX + player.position.z * basis.forwardZ;
    const latch = latched ?? {
      lastCoord: coord,
      forwardCoord,
      lastX: player.position.x,
      lastZ: player.position.z,
    };
    const rawDelta = coord - latch.lastCoord;
    const maxDelta = FRIDGE_LATCH_MAX_TRACK_SPEED * Math.max(0.001, dt);
    const delta = Math.max(-maxDelta, Math.min(maxDelta, rawDelta));
    const constrainedCoord = latch.lastCoord + delta;
    if (delta > 0) {
      state.progress = Math.min(1, state.progress + (delta / FRIDGE_OPEN_DISTANCE) * FRIDGE_PUSH_GAIN);
    } else if (delta < -0.015) {
      state.progress = Math.max(0, state.progress + (delta / FRIDGE_OPEN_DISTANCE) * FRIDGE_LATCH_PULLBACK);
    }
    latch.lastCoord = constrainedCoord;
    latch.lastX = player.position.x;
    latch.lastZ = player.position.z;
    state.latches.set(id, latch);
    player.position.x = basis.rightX * constrainedCoord + basis.forwardX * latch.forwardCoord;
    player.position.z = basis.rightZ * constrainedCoord + basis.forwardZ * latch.forwardCoord;
    const velocityRight = delta / Math.max(0.001, dt);
    if (player.velocity) {
      player.velocity.x = basis.rightX * velocityRight;
      player.velocity.z = basis.rightZ * velocityRight;
    }
    active.push([id, player]);
  }

  state.helpers = active.length;
  runtime._physicalTaskStates.set(task.id, state);

  if (state.progress >= 1) {
    completeRaidTask(runtime, active[0]?.[0], task, {
      mischiefPoints,
      bypassPlayerDistance: true,
    });
  }
}

function stepToppleTower(runtime, task, mischiefPoints) {
  const claims = runtime._taskCompletionClaims.get('__global__');
  if (claims?.has(task.id)) return;
  const cans = runtime.pushBallWorld
    ?.getBallEntries?.()
    ?.filter((entry) => entry.taskId === task.id && entry.part?.startsWith?.('can-')) ?? [];
  if (cans.length < 3) return;
  const knocked = cans.filter(canIsKnockedOver).length;
  runtime._physicalTaskStates.set(task.id, {
    id: task.id,
    taskType: task.taskType,
    mode: task.completionMode,
    progress: knocked / cans.length,
    knocked,
    total: cans.length,
  });
  if (knocked >= cans.length) {
    const playerId = nearestEligiblePlayerId(runtime, task);
    completeRaidTask(runtime, playerId, task, {
      mischiefPoints,
      bypassPlayerDistance: true,
    });
  }
}

export function stepPhysicalTasks(runtime, dt, nowSeconds, { mischiefPoints } = {}) {
  void nowSeconds;
  for (const task of physicalTasks(runtime)) {
    if (task.taskType === RAID_TASK_TYPES.FRIDGE_RAID) {
      stepFridgeRaid(runtime, task, dt, mischiefPoints);
    } else if (task.taskType === RAID_TASK_TYPES.TOPPLE_TOWER) {
      stepToppleTower(runtime, task, mischiefPoints);
    }
  }
}

export function serializePhysicalTaskStates(runtime) {
  return [...(runtime._physicalTaskStates?.values?.() ?? [])].map((state) => ({
    id: state.id,
    taskType: state.taskType,
    mode: state.mode,
    progress: Math.max(0, Math.min(1, Number(state.progress) || 0)),
    helpers: Math.max(0, Math.floor(Number(state.helpers) || 0)),
    knocked: Math.max(0, Math.floor(Number(state.knocked) || 0)),
    total: Math.max(0, Math.floor(Number(state.total) || 0)),
  }));
}
