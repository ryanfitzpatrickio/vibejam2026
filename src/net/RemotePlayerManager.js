/**
 * Manages spawning, interpolating, and removing remote player Mouse entities.
 */
import * as THREE from 'three';
import { Mouse } from '../entities/Mouse.js';
import { EmoteManager } from '../emote/EmoteManager.js';
import { HeroAvatar } from '../entities/HeroAvatar.js';
import { attachEdgeOutlines } from '../materials/index.js';
import { getAudioManager } from '../audio/AudioManager.js';
import { createPlayerNameplate, syncNameplateWorldPosition } from '../world/PlayerNameplate.js';
import { isNameplateOccluded } from '../utils/nameplateOcclusion.js';

const LERP_SPEED = 12;
const GRAB_ONE_SHOT_ANIM_SECONDS = 0.6;
const _nameplateWorldPos = new THREE.Vector3();

function shortestAngleDelta(target, current) {
  return THREE.MathUtils.euclideanModulo((target - current) + Math.PI, Math.PI * 2) - Math.PI;
}

// Distinct fur colors for remote players
const REMOTE_COLORS = [
  '#8ec8e8', '#e88e8e', '#8ee8a8', '#d8a8e8',
  '#e8d88e', '#8ed8d8', '#e8a88e', '#b8b8e8',
];

export class RemotePlayerManager {
  /** @type {Map<string, { mouse: Mouse, outlineMeshes?: THREE.Object3D[], nameplateAnchor: THREE.Object3D, nameplate: ReturnType<typeof createPlayerNameplate>, displayName: string, targetPos: THREE.Vector3, prevPos: THREE.Vector3, targetRot: number, animState: string, serverAlive: boolean, serverAnimState: string }>} */
  players = new Map();
  /** IDs currently being spawned (async) — prevents duplicate spawns */
  _spawning = new Set();

  /** Applied to new spawns and existing outline meshes. */
  edgeOutlinesVisible = true;
  playersVisible = true;
  nameplatesVisible = true;

  constructor({ scene }) {
    this.scene = scene;
    this._colorIndex = 0;
  }

  getEdgeOutlinesVisible() {
    return this.edgeOutlinesVisible;
  }

  /** Sync with latest snapshot from NetworkClient.remotePlayers */
  sync(remotePlayers) {
    // Spawn new players
    for (const [id, data] of remotePlayers) {
      if (!this.players.has(id) && !this._spawning.has(id)) {
        this._spawn(id, data);
      } else if (this.players.has(id)) {
        const entry = this.players.get(id);
        entry.targetPos.set(
          data.position?.x ?? 0,
          (data.position?.y ?? 0) + entry.mouse.groundOffset,
          data.position?.z ?? 0,
        );
        entry.targetRot = data.rotation ?? 0;
        entry.serverAlive = data.alive !== false;
        entry.serverAnimState = data.animState ?? 'idle';
        const nextGrabbedTarget = data.grabbedTarget ?? null;
        entry.serverGrabbedBy = data.grabbedBy ?? null;
        entry.serverGrabbedTarget = nextGrabbedTarget;
        entry.serverGrabbedBallId = data.grabbedBallId ?? null;
        entry.serverIsHero = !!data.isHero;
        entry.serverHeroAvatar = data.heroAvatar ?? null;
        entry.serverIsAdversary = !!data.isAdversary;
        entry.serverAdversaryRole = data.adversaryRole ?? null;
        if (
          (!!nextGrabbedTarget && !entry.prevGrabbedTarget)
          || (!!entry.serverGrabbedBy && !entry.prevGrabbedBy)
          || (!!entry.serverGrabbedBallId && !entry.prevGrabbedBallId)
        ) {
          entry.grabAnimTimer = GRAB_ONE_SHOT_ANIM_SECONDS;
        }
        entry.prevGrabbedTarget = nextGrabbedTarget;
        entry.prevGrabbedBy = entry.serverGrabbedBy;
        entry.prevGrabbedBallId = entry.serverGrabbedBallId;
        entry.mouse.visible = this.playersVisible && !entry.serverIsAdversary;
        entry.nameplate.setAlive(entry.serverAlive);
        if (typeof data.displayName === 'string' && data.displayName.trim()) {
          const next = data.displayName.trim();
          if (next !== entry.displayName) {
            entry.displayName = next;
            entry.nameplate.setText(next);
          }
        }
        if (data.emote && !entry.emoteManager.isPlaying) {
          entry.emoteManager.play(data.emote);
        } else if (!data.emote && entry.emoteManager.isPlaying) {
          entry.emoteManager.cancel();
        }
      }
    }

    // Remove disconnected players
    for (const [id, entry] of this.players) {
      if (!remotePlayers.has(id)) {
        entry.nameplate.dispose();
        entry.heroBrain?.dispose?.();
        this.scene.remove(entry.nameplateAnchor);
        this.scene.remove(entry.mouse);
        entry.mouse.dispose();
        this.players.delete(id);
      }
    }
    // Cancel pending spawns for disconnected players
    for (const id of this._spawning) {
      if (!remotePlayers.has(id)) {
        this._spawning.delete(id);
      }
    }
  }

  /**
   * @param {number} dt
   * @param {import('three').PerspectiveCamera} camera
   */
  update(dt, camera, occlusionFrameIndex = 0) {
    const t = Math.min(1, dt * LERP_SPEED);
    const doOcclusionCheck = (occlusionFrameIndex % 3) === 0;
    for (const entry of this.players.values()) {
      entry.prevPos.copy(entry.mouse.position);
      entry.mouse.position.lerp(entry.targetPos, t);

      // Smooth rotation
      const diff = shortestAngleDelta(entry.targetRot, entry.mouse.getYaw());
      entry.mouse.rotateYaw(diff * t);

      // Flip grabbed players upside-down so they look carried above the grabber.
      const beingCarried = !!entry.serverGrabbedBy && entry.serverAlive;
      entry.mouse.rotation.x = beingCarried ? Math.PI : 0;

      // Derive animation from actual interpolated movement speed
      const dx = entry.mouse.position.x - entry.prevPos.x;
      const dz = entry.mouse.position.z - entry.prevPos.z;
      const speed = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
      entry.grabAnimTimer = Math.max(0, (entry.grabAnimTimer ?? 0) - dt);

      let animState;
      if (!entry.serverAlive || entry.serverAnimState === 'death') {
        animState = 'death';
      } else if ((entry.grabAnimTimer ?? 0) > 0) {
        animState = 'grab';
      } else if (entry.serverAnimState === 'win') {
        entry.emoteManager.cancel();
        animState = 'win';
      } else if (entry.emoteManager.isPlaying) {
        animState = entry.animState;
      } else if (speed > 5) {
        animState = 'run';
      } else if (speed > 0.5) {
        animState = 'walk';
      } else {
        animState = 'idle';
      }

      if (animState !== entry.animState) {
        entry.animState = animState;
        entry.mouse.setAnimationState(animState);
      }

      entry.emoteManager.update(dt);
      entry.mouse.update(dt);

      const isAdversary = !!entry.serverIsAdversary;

      // Hero avatar overlay: swap the mouse body for the chosen hero model.
      // If the server changed which hero model the player is riding, dispose
      // and re-spawn so visuals follow.
      const desiredHeroKey = entry.serverHeroAvatar || 'brain';
      if (entry.heroBrain && entry.heroBrain.modelKey !== desiredHeroKey) {
        entry.mouse.remove(entry.heroBrain);
        entry.heroBrain.dispose();
        entry.heroBrain = null;
      }
      if (!isAdversary && entry.serverIsHero && !entry.heroBrain) {
        entry.heroBrain = new HeroAvatar(desiredHeroKey);
        entry.mouse.add(entry.heroBrain);
        if (entry.mouse.bodyPivot) entry.mouse.bodyPivot.visible = false;
      } else if ((isAdversary || !entry.serverIsHero) && entry.heroBrain) {
        entry.mouse.remove(entry.heroBrain);
        entry.heroBrain.dispose();
        entry.heroBrain = null;
        if (entry.mouse.bodyPivot) entry.mouse.bodyPivot.visible = true;
      }
      if (entry.heroBrain) {
        entry.heroBrain.setState(animState);
        entry.heroBrain.update(dt);
      }
      syncNameplateWorldPosition(entry.nameplateAnchor, entry.mouse);
      if (this.nameplatesVisible) {
        entry.nameplateAnchor.getWorldPosition(_nameplateWorldPos);
        const farFromCamera = camera
          ? _nameplateWorldPos.distanceToSquared(camera.position) > 28 * 28
          : false;
        if (farFromCamera) {
          entry.nameplate.setOccluded(true);
        } else if (doOcclusionCheck) {
          entry.nameplate.setOccluded(
            camera
              ? isNameplateOccluded(this.scene, camera, _nameplateWorldPos, entry.mouse, occlusionFrameIndex)
              : false,
          );
        }
      } else {
        entry.nameplate.setOccluded(true);
      }
    }
  }

  async _spawn(id, data) {
    this._spawning.add(id);

    const color = REMOTE_COLORS[this._colorIndex % REMOTE_COLORS.length];
    this._colorIndex++;

    const mouse = new Mouse({
      furColor: color,
    });
    mouse.name = `RemoteMouse_${id}`;
    mouse.visible = this.playersVisible && !data.isAdversary;

    await mouse.ready;

    // Player may have disconnected while we were loading
    if (!this._spawning.has(id)) {
      mouse.dispose();
      return;
    }
    this._spawning.delete(id);

    const groundY = (data.position?.y ?? 0) + mouse.groundOffset;
    mouse.position.set(
      data.position?.x ?? 0,
      groundY,
      data.position?.z ?? 0,
    );
    const outlineMeshes = attachEdgeOutlines(mouse, {
      color: '#090909',
      thresholdAngle: 24,
      opacity: 0.95,
      batch: false,
    });
    for (const m of outlineMeshes) {
      if (m) m.visible = this.edgeOutlinesVisible;
    }
    this.scene.add(mouse);

    const nameplateAnchor = new THREE.Object3D();
    nameplateAnchor.name = `NameplateAnchor_${id}`;
    this.scene.add(nameplateAnchor);

    const displayName = typeof data.displayName === 'string' && data.displayName.trim()
      ? data.displayName.trim()
      : `Mouse ${id.slice(0, 4)}`;
    const nameplate = createPlayerNameplate(nameplateAnchor, displayName);
    nameplate.setAlive(data.alive !== false);
    nameplate.setVisible(this.nameplatesVisible);
    syncNameplateWorldPosition(nameplateAnchor, mouse);

    const audioManager = getAudioManager();
    const players = this.players;
    const emoteManager = new EmoteManager({
      mouse,
      audioManager,
      scene: this.scene,
      isHumanEmoter: () => !!players.get(id)?.serverIsAdversary,
    });

    this.players.set(id, {
      mouse,
      outlineMeshes,
      nameplateAnchor,
      nameplate,
      displayName,
      emoteManager,
      targetPos: new THREE.Vector3(
        data.position?.x ?? 0,
        groundY,
        data.position?.z ?? 0,
      ),
      prevPos: new THREE.Vector3(
        data.position?.x ?? 0,
        groundY,
        data.position?.z ?? 0,
      ),
      targetRot: data.rotation ?? 0,
      animState: 'idle',
      serverAlive: data.alive !== false,
      serverAnimState: data.animState ?? 'idle',
      serverGrabbedBy: data.grabbedBy ?? null,
      serverGrabbedTarget: data.grabbedTarget ?? null,
      serverGrabbedBallId: data.grabbedBallId ?? null,
      prevGrabbedBy: data.grabbedBy ?? null,
      prevGrabbedTarget: data.grabbedTarget ?? null,
      prevGrabbedBallId: data.grabbedBallId ?? null,
      grabAnimTimer: 0,
      serverIsHero: !!data.isHero,
      serverHeroAvatar: data.heroAvatar ?? null,
      serverIsAdversary: !!data.isAdversary,
      serverAdversaryRole: data.adversaryRole ?? null,
      heroBrain: null,
    });
  }

  getPlayersVisible() {
    return this.playersVisible;
  }

  setPlayersVisible(visible) {
    this.playersVisible = !!visible;
    for (const entry of this.players.values()) {
      entry.mouse.visible = this.playersVisible && !entry.serverIsAdversary;
    }
  }

  getNameplatesVisible() {
    return this.nameplatesVisible;
  }

  setNameplatesVisible(visible) {
    this.nameplatesVisible = !!visible;
    for (const entry of this.players.values()) {
      entry.nameplate.setVisible(this.nameplatesVisible);
    }
  }

  setEdgeOutlinesVisible(visible) {
    this.edgeOutlinesVisible = !!visible;
    const v = this.edgeOutlinesVisible;
    for (const entry of this.players.values()) {
      const meshes = entry.outlineMeshes;
      if (!Array.isArray(meshes)) continue;
      for (const m of meshes) {
        if (m) m.visible = v;
      }
    }
  }

  playEyeOneShot(id, expression, options) {
    const entry = this.players.get(id);
    return entry?.mouse?.playEyeOneShot?.(expression, options) ?? false;
  }

  dispose() {
    for (const entry of this.players.values()) {
      entry.nameplate.dispose();
      entry.heroBrain?.dispose?.();
      this.scene.remove(entry.nameplateAnchor);
      this.scene.remove(entry.mouse);
      entry.mouse.dispose();
    }
    this.players.clear();
    this._spawning.clear();
  }
}
