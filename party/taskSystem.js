import { PREDATOR_AI } from '../shared/predator.js';
import { ROOMBA_PHASE } from '../shared/roomba.js';
import { RAID_TASK_COMPLETION_MODES, RAID_TASK_TYPES, supportsPhysicalRaidTask } from '../shared/raidLayout.js';

const TASK_COMPLETION_RADIUS = 3;
const TASK_COMPLETION_RADIUS_SQ = TASK_COMPLETION_RADIUS * TASK_COMPLETION_RADIUS;

const TASK_REWARD_AMOUNTS = Object.freeze({
  [RAID_TASK_TYPES.CHEW_WIRES]: 8,
  [RAID_TASK_TYPES.TOPPLE_TOWER]: 16,
  [RAID_TASK_TYPES.FRIDGE_RAID]: 22,
  [RAID_TASK_TYPES.CUT_LIGHTS]: 10,
  [RAID_TASK_TYPES.KNIFE_DRAWER]: 18,
  [RAID_TASK_TYPES.SABOTAGE_ROOMBA]: 12,
  [RAID_TASK_TYPES.WINDOW]: 14,
});

const TASK_NOISE_RADIUS = Object.freeze({
  [RAID_TASK_TYPES.CHEW_WIRES]: 10,
  [RAID_TASK_TYPES.TOPPLE_TOWER]: 22,
  [RAID_TASK_TYPES.FRIDGE_RAID]: 16,
  [RAID_TASK_TYPES.CUT_LIGHTS]: 14,
  [RAID_TASK_TYPES.KNIFE_DRAWER]: 18,
  [RAID_TASK_TYPES.SABOTAGE_ROOMBA]: 12,
  [RAID_TASK_TYPES.WINDOW]: 12,
});

export function findRaidTaskById(layout, taskId) {
  const tasks = layout?.raidTasks;
  if (!Array.isArray(tasks)) return null;
  for (const task of tasks) {
    if (task?.id === taskId && task.deleted !== true) return task;
  }
  return null;
}

function getTaskCompletionClaims(taskCompletionClaims, playerId) {
  let claims = taskCompletionClaims.get(playerId);
  if (!claims) {
    claims = new Set();
    taskCompletionClaims.set(playerId, claims);
  }
  return claims;
}

function spawnTaskRewardCheese(cheeseWorld, taskX, taskY, taskZ, amount) {
  const pieces = Math.min(amount, 6);
  const per = Math.max(1, Math.floor(amount / pieces));
  let remaining = amount;
  for (let i = 0; i < pieces && remaining > 0; i += 1) {
    const theta = (i / pieces) * Math.PI * 2 + Math.random() * 0.4;
    const radius = 0.45 + Math.random() * 0.6;
    const give = i === pieces - 1 ? remaining : per;
    remaining -= give;
    cheeseWorld.mergeOrAddDrop({
      x: taskX + Math.cos(theta) * radius,
      y: taskY,
      z: taskZ + Math.sin(theta) * radius,
    }, give);
  }
}

function applyTaskSideEffects(predators, taskType) {
  if (taskType === RAID_TASK_TYPES.CUT_LIGHTS) {
    for (const predator of predators) {
      if (predator?.type !== 'cat' || predator.alive === false) continue;
      predator.aiState = PREDATOR_AI.STUNNED;
      predator.aiTimer = Math.max(predator.aiTimer ?? 0, 1.15);
    }
  }
  if (taskType === RAID_TASK_TYPES.SABOTAGE_ROOMBA) {
    const roomba = predators.find((predator) => predator?.type === 'roomba');
    if (roomba) {
      roomba.phase = ROOMBA_PHASE.CHARGING;
      roomba.phaseTimer = Math.max(Number(roomba.phaseTimer) || 0, 7.5);
      roomba.vacuumTimer = 0;
      roomba.velocity.x = 0;
      roomba.velocity.z = 0;
    }
  }
}

export function completeRaidTask(runtime, senderId, task, {
  mischiefPoints,
  bypassPlayerDistance = false,
} = {}) {
  const player = runtime.players.get(senderId);
  if (!player?.alive || player.spectator || player.extracted || player.isAdversary) return;
  const now = Date.now();
  const last = runtime._taskCompleteCooldown.get(senderId) ?? 0;
  if (now - last < 600) return;

  if (!task) return;
  const taskId = task.id;

  const amount = TASK_REWARD_AMOUNTS[task.taskType] ?? 0;
  if (amount <= 0) return;

  const taskX = Number(task.position?.x);
  const taskY = Number(task.position?.y);
  const taskZ = Number(task.position?.z);
  if (!Number.isFinite(taskX) || !Number.isFinite(taskY) || !Number.isFinite(taskZ)) return;

  const dx = taskX - player.position.x;
  const dz = taskZ - player.position.z;
  if (!bypassPlayerDistance && dx * dx + dz * dz > TASK_COMPLETION_RADIUS_SQ) return;

  const claims = getTaskCompletionClaims(runtime._taskCompletionClaims, '__global__');
  if (claims.has(taskId)) return;
  claims.add(taskId);
  runtime._refreshLevelColliders();
  runtime._taskCompleteCooldown.set(senderId, now);
  runtime._awardMischief(player, mischiefPoints?.taskComplete ?? 0, now / 1000);
  runtime._emitNoise(player, TASK_NOISE_RADIUS[task.taskType] ?? 10, 220);
  applyTaskSideEffects(runtime.predators, task.taskType);
  spawnTaskRewardCheese(runtime.cheeseWorld, taskX, player.position.y, taskZ, amount);
  runtime.broadcast(JSON.stringify({
    type: 'task-completed',
    taskId,
    taskType: task.taskType,
    playerId: senderId,
  }));
}

export function handleTaskComplete(runtime, senderId, data, {
  mischiefPoints,
} = {}) {
  const taskId = typeof data?.taskId === 'string' ? data.taskId : '';
  const task = taskId ? findRaidTaskById(runtime._layout, taskId) : null;
  if (!task) return;
  if (task.completionMode === RAID_TASK_COMPLETION_MODES.PHYSICAL
    && supportsPhysicalRaidTask(task.taskType)) return;
  if (typeof data?.taskType === 'string' && data.taskType !== task.taskType) return;
  completeRaidTask(runtime, senderId, task, { mischiefPoints });
}
