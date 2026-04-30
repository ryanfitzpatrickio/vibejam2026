import * as THREE from 'three';
import {
  RAID_TASK_COMPLETE_EFFECTS,
  RAID_TASK_COMPLETION_MODES,
  RAID_TASK_TYPES,
  supportsPhysicalRaidTask,
} from '../../shared/raidLayout.js';
import { getTaskRuntime } from './taskRegistry.js';
import { CheeseBurst } from './CheeseBurst.js';
import { SmokeSparksEffect } from './SmokeSparksEffect.js';
import { actionLabel, subscribeInputSource } from '../input/inputSource.js';

const INTERACT_RADIUS = 1.6;

/**
 * Task interaction loop: finds the closest raid-task marker the player is
 * standing near, drives the interact prompt, opens the mini-game dialog on
 * interact, and bursts reward cheese on completion.
 */
export class TaskController {
  constructor({ scene, room, controller, getPlayer, promptElement = null, setControlsEnabled = null, net = null }) {
    this.scene = scene;
    this.room = room;
    this.controller = controller;
    this.getPlayer = getPlayer;
    this.promptElement = promptElement;
    this.setControlsEnabled = typeof setControlsEnabled === 'function' ? setControlsEnabled : null;
    this.net = net;

    this.cheeseBurst = new CheeseBurst(scene);
    this._activeTaskHandle = null;
    this._activeTaskId = null;
    this._promptTaskId = null;
    this._tmpVec = new THREE.Vector3();
    /** @type {Map<string, { effect: {update:(dt:number)=>void, dispose:()=>void}, group: THREE.Object3D }>} */
    this._completedEffects = new Map();
    this._completedTaskIds = new Set();
    this._lastRoundNumber = null;
    this._lastCompletedTaskRevision = -1;
    this._promptVerb = null;
    this._unsubInputSource = subscribeInputSource(() => {
      if (this._promptTaskId && this._promptVerb && this.promptElement) {
        this.promptElement.textContent = `Press ${actionLabel('interact')} to ${this._promptVerb}`;
      }
    });
  }

  /** Called each frame with elapsed seconds. */
  update(dt) {
    this.cheeseBurst.update(dt);

    for (const entry of this._completedEffects.values()) {
      entry.effect.update(dt);
    }

    const roundNumber = this.net?.round?.number ?? null;
    if (this._lastRoundNumber == null) {
      this._lastRoundNumber = roundNumber;
    } else if (roundNumber != null && roundNumber !== this._lastRoundNumber) {
      this._lastRoundNumber = roundNumber;
      this._resetCompletedEffects();
    }
    this._syncCompletedTasksFromServer();

    const player = this.getPlayer?.();
    if (!player?.position) {
      this._setPrompt(null);
      return;
    }

    if (this._activeTaskHandle) {
      this._setPrompt(null);
      return;
    }

    const nearby = this._findNearestTask(player.position);
    if (!nearby) {
      this._setPrompt(null);
      return;
    }
    this._setPrompt(nearby);
  }

  _resetCompletedEffects() {
    for (const entry of this._completedEffects.values()) {
      try { entry.effect.dispose(); } catch { /* ignore */ }
      if (entry.group) {
        entry.group.visible = true;
        entry.group.userData.setRaidTaskCompleted?.(false);
      }
    }
    this._completedEffects.clear();
    this._completedTaskIds.clear();
  }

  _syncCompletedTasksFromServer() {
    const serverIds = this.net?.completedTaskIds;
    if (!Array.isArray(serverIds)) return;
    const next = new Set(serverIds.filter((id) => typeof id === 'string'));
    const revision = Number(this.net?.completedTaskRevision) || 0;
    let changed = next.size !== this._completedTaskIds.size;
    if (!changed) {
      for (const id of next) {
        if (!this._completedTaskIds.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) this._completedTaskIds = next;
    const entries = this.room?.editableRaidTaskObjects;
    if (entries) {
      for (const entry of entries.values()) {
        const id = entry?.definition?.id;
        if (!id || !entry.group) continue;
        entry.group.userData.setRaidTaskCompleted?.(this._completedTaskIds.has(id));
      }
    }

    if (changed || revision !== this._lastCompletedTaskRevision) {
      this._lastCompletedTaskRevision = revision;
      for (const [id, effectEntry] of Array.from(this._completedEffects.entries())) {
        if (this._completedTaskIds.has(id)) continue;
        try { effectEntry.effect?.dispose?.(); } catch { /* ignore */ }
        this._completedEffects.delete(id);
      }
    }
  }

  markTaskCompleted(taskId) {
    if (!taskId) return;
    this._completedTaskIds.add(taskId);
    const entry = this.room?.editableRaidTaskObjects?.get(taskId);
    if (!entry?.group) return;
    entry.group.userData.setRaidTaskCompleted?.(true);
  }

  /** Called when the interact key is pressed. Returns true if a task dialog opened. */
  tryInteract() {
    if (this._activeTaskHandle) return false;
    const player = this.getPlayer?.();
    if (!player?.position) return false;
    const nearby = this._findNearestTask(player.position);
    if (!nearby) return false;
    const runtime = getTaskRuntime(nearby.definition.taskType);
    if (!runtime) return false;
    if (this._usesPhysicalCompletion(nearby.definition)) {
      return true;
    }
    this._openTask(nearby, runtime);
    return true;
  }

  _openTask(nearby, runtime) {
    this._activeTaskId = nearby.definition.id;
    this.setControlsEnabled?.(false);
    const taskWorld = new THREE.Vector3();
    nearby.group.getWorldPosition(taskWorld);
    const definition = nearby.definition;
    const markerGroup = nearby.group;
    this._activeTaskHandle = runtime.open({
      onComplete: () => {
        this._handleComplete(definition, taskWorld, runtime.rewardAmount ?? 6, runtime, markerGroup);
      },
      onCancel: () => {
        this._handleClose();
      },
    });
    this._setPrompt(null);
  }

  _handleComplete(definition, taskWorld, rewardAmount, runtime, markerGroup) {
    this._handleClose();
    const player = this.getPlayer?.();
    if (!player?.position) return;
    this._completedTaskIds.add(definition.id);
    const aim = this._tmpVec.copy(player.position);
    // Aim a little in front of the player so the cheese lands where they can scoop it up.
    const forwardY = player.rotation?.y ?? 0;
    aim.x -= Math.sin(forwardY) * 1.2;
    aim.z -= Math.cos(forwardY) * 1.2;
    if (runtime?.unlockHeroKey) {
      this.net?.sendClaimHero?.({
        heroKey: runtime.unlockHeroKey,
        taskId: definition.id,
      });
    } else {
      this.cheeseBurst.spawn(taskWorld, aim, Math.max(4, rewardAmount | 0));
      this.net?.sendTaskComplete?.({
        taskId: definition.id,
        taskType: definition.taskType,
        position: { x: aim.x, y: player.position.y, z: aim.z },
        amount: rewardAmount,
      });
    }

    const configuredEffect = definition.completeEffect ?? RAID_TASK_COMPLETE_EFFECTS.DEFAULT;
    const completeEffect = configuredEffect === RAID_TASK_COMPLETE_EFFECTS.DEFAULT
      ? runtime?.completeEffect
      : configuredEffect;
    const createEffect = completeEffect === RAID_TASK_COMPLETE_EFFECTS.SMOKE_SPARKS
      ? (scene, worldPos) => new SmokeSparksEffect(scene, worldPos)
      : null;
    if (createEffect && markerGroup && !this._completedEffects.has(definition.id)) {
      try {
        const effect = createEffect(this.scene, taskWorld);
        if (effect) {
          markerGroup.userData.setRaidTaskCompleted?.(true);
          this._completedEffects.set(definition.id, { effect, group: markerGroup });
        }
      } catch (err) {
        console.warn('[TaskController] failed to spawn completion effect', err);
      }
    }
  }

  _handleClose() {
    this._activeTaskHandle = null;
    this._activeTaskId = null;
    this.setControlsEnabled?.(true);
  }

  _findNearestTask(playerPos) {
    const entries = this.room?.editableRaidTaskObjects;
    if (!entries || entries.size === 0) return null;
    let best = null;
    let bestDistSq = INTERACT_RADIUS * INTERACT_RADIUS;
    for (const entry of entries.values()) {
      if (!entry?.definition || entry.definition.deleted) continue;
      if (!getTaskRuntime(entry.definition.taskType)) continue;
      if (this._completedTaskIds.has(entry.definition.id)) continue;
      const pos = entry.group.position;
      const dx = pos.x - playerPos.x;
      const dz = pos.z - playerPos.z;
      const dy = (pos.y ?? 0) - playerPos.y;
      const d2 = dx * dx + dz * dz + dy * dy * 0.25;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        best = entry;
      }
    }
    return best;
  }

  _setPrompt(nearby) {
    if (!this.promptElement) return;
    const id = nearby?.definition?.id ?? null;
    const previousId = this._promptTaskId;
    this._promptTaskId = id;
    if (!nearby) {
      this._promptVerb = null;
      this.promptElement.style.display = 'none';
      return;
    }
    if (this._usesPhysicalCompletion(nearby.definition)) {
      const state = this._physicalTaskState(nearby.definition.id);
      this._promptVerb = null;
      this.promptElement.textContent = this._physicalPrompt(nearby.definition, state);
      this.promptElement.style.display = 'block';
      return;
    }
    if (id === previousId && this._promptVerb) return;
    const runtime = getTaskRuntime(nearby.definition.taskType);
    const verb = runtime?.promptVerb ?? 'start task';
    this._promptVerb = verb;
    this.promptElement.textContent = `Press ${actionLabel('interact')} to ${verb}`;
    this.promptElement.style.display = 'block';
  }

  _physicalTaskState(taskId) {
    const states = this.net?.physicalTasks;
    if (!Array.isArray(states)) return null;
    return states.find((entry) => entry?.id === taskId) ?? null;
  }

  _usesPhysicalCompletion(definition) {
    return definition?.completionMode === RAID_TASK_COMPLETION_MODES.PHYSICAL
      && supportsPhysicalRaidTask(definition.taskType);
  }

  _physicalPrompt(definition, state) {
    if (definition.taskType === RAID_TASK_TYPES.FRIDGE_RAID) {
      const pct = Math.round(Math.max(0, Math.min(1, Number(state?.progress) || 0)) * 100);
      const helpers = Math.max(0, Math.floor(Number(state?.helpers) || 0));
      return helpers > 1
        ? `Hold ${actionLabel('grab')} on handle, push right - ${pct}% (${helpers} mice)`
        : `Hold ${actionLabel('grab')} on handle, push right - ${pct}%`;
    }
    if (definition.taskType === RAID_TASK_TYPES.TOPPLE_TOWER) {
      const knocked = Math.max(0, Math.floor(Number(state?.knocked) || 0));
      const total = Math.max(3, Math.floor(Number(state?.total) || 3));
      return `Smack the cans to topple tower - ${knocked}/${total}`;
    }
    return `Use the world to complete task`;
  }

  dispose() {
    if (this._activeTaskHandle) {
      try { this._activeTaskHandle.close(); } catch { /* ignore */ }
      this._activeTaskHandle = null;
    }
    this._resetCompletedEffects();
    this.cheeseBurst.dispose();
    this._unsubInputSource?.();
  }
}
