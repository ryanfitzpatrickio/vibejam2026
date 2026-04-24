import * as THREE from 'three';
import { getTaskRuntime } from './taskRegistry.js';
import { CheeseBurst } from './CheeseBurst.js';
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

    if (runtime?.onCompleteEffect && markerGroup && !this._completedEffects.has(definition.id)) {
      try {
        const effect = runtime.onCompleteEffect(this.scene, taskWorld);
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
    if (id === this._promptTaskId) return;
    this._promptTaskId = id;
    if (!nearby) {
      this._promptVerb = null;
      this.promptElement.style.display = 'none';
      return;
    }
    const runtime = getTaskRuntime(nearby.definition.taskType);
    const verb = runtime?.promptVerb ?? 'start task';
    this._promptVerb = verb;
    this.promptElement.textContent = `Press ${actionLabel('interact')} to ${verb}`;
    this.promptElement.style.display = 'block';
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
