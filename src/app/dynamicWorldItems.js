import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MouseEyeAtlasAnimator } from '../animation/MouseEyeAtlasAnimator.js';
import { attachEyesToModel } from '../data/attachEyes.js';

const DEFAULT_PUSH_BALL_RADIUS = 0.38;
const PUSH_BALL_MAX_INSTANCES = 128;
const CHEESE_PICKUP_MAX_INSTANCES = 256;
const MOUNT_SMOOTH_RATE = 18;
const MOUNT_SNAP_DISTANCE = 4;
const MOUNT_ANIMATION_FADE_SECONDS = 0.22;
const MOUNT_ANIMATION_MIN_HOLD_SECONDS = 0.16;

function cheesePickupVisualScale(amount) {
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  return Math.min(2.5, 0.58 + 0.022 * Math.min(n, 200));
}

export function createDynamicWorldItems(scene, { room = null } = {}) {
  const pushBallUnitGeometry = new THREE.SphereGeometry(1, 20, 14);
  const pushBallSharedMaterial = new THREE.MeshStandardMaterial({ metalness: 0.16, roughness: 0.52 });
  const pushBallInstanced = new THREE.InstancedMesh(
    pushBallUnitGeometry,
    pushBallSharedMaterial,
    PUSH_BALL_MAX_INSTANCES,
  );
  pushBallInstanced.name = 'PushBallsInstanced';
  pushBallInstanced.castShadow = true;
  pushBallInstanced.receiveShadow = true;
  pushBallInstanced.count = 0;
  pushBallInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pushBallInstanced.frustumCulled = false;
  scene.add(pushBallInstanced);

  const pushBallStates = new Map();
  const glbPropStates = new Map();
  const mountStates = new Map();
  const pushBallMatrix = new THREE.Matrix4();
  const pushBallScale = new THREE.Vector3();
  const pushBallColor = new THREE.Color();
  let pushBallsVisible = true;

  const cheesePickupGroup = new THREE.Group();
  cheesePickupGroup.name = 'WorldCheesePickups';
  scene.add(cheesePickupGroup);
  const cheesePickupGeometry = new THREE.ConeGeometry(0.24, 0.38, 6);
  cheesePickupGeometry.rotateX(Math.PI);
  const cheesePickupMaterial = new THREE.MeshStandardMaterial({
    color: '#f2d046',
    emissive: '#806018',
    emissiveIntensity: 0.22,
    roughness: 0.42,
    metalness: 0.06,
  });
  const cheesePickupInstanced = new THREE.InstancedMesh(
    cheesePickupGeometry,
    cheesePickupMaterial,
    CHEESE_PICKUP_MAX_INSTANCES,
  );
  cheesePickupInstanced.name = 'CheesePickupsInstanced';
  cheesePickupInstanced.castShadow = true;
  cheesePickupInstanced.receiveShadow = true;
  cheesePickupInstanced.count = 0;
  cheesePickupInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cheesePickupInstanced.frustumCulled = false;
  cheesePickupInstanced.visible = false;
  cheesePickupGroup.add(cheesePickupInstanced);
  const cheesePickupStates = new Map();
  const cheeseMatrix = new THREE.Matrix4();
  const cheesePos = new THREE.Vector3();
  const cheeseQuat = new THREE.Quaternion();
  const cheeseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const cheeseScale = new THREE.Vector3();

  function smoothingAlpha(rate, deltaSeconds) {
    return 1 - Math.exp(-rate * Math.max(0, deltaSeconds));
  }

  function clearPushBalls() {
    pushBallInstanced.count = 0;
    pushBallInstanced.visible = false;
    if (pushBallStates.size > 0) pushBallStates.clear();
    for (const state of glbPropStates.values()) {
      if (state.object) scene.remove(state.object);
    }
    glbPropStates.clear();
  }

  function clearMounts() {
    for (const state of mountStates.values()) {
      if (state.object) scene.remove(state.object);
      state.mixer?.stopAllAction?.();
      state.eyeUnsub?.();
      state.eyeAnimator?.dispose?.();
    }
    mountStates.clear();
  }

  function syncGlbPropObject(ball, state) {
    if (!room?.loadGlbModel || state.object || state.loading || state.failed) return;
    state.loading = true;
    const assetId = ball.glbAssetId;
    room.loadGlbModel(assetId)
      .then((model) => {
        state.loading = false;
        if (!model || glbPropStates.get(ball.id) !== state) return;
        const clone = model.clone(true);
        clone.name = `DynamicGlbProp-${ball.id}`;
        clone.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = false;
          child.userData.cameraOccluder = false;
          child.userData.skipOutline = true;
        });
        state.object = clone;
        scene.add(clone);
      })
      .catch(() => {
        state.loading = false;
        state.failed = true;
      });
  }

  function updateGlbProp(ball, seen) {
    if (!ball?.id || !ball.glbAssetId) return;
    seen.add(ball.id);
    let state = glbPropStates.get(ball.id);
    if (!state) {
      state = {
        smoothPos: new THREE.Vector3(ball.x, ball.y, ball.z),
        smoothQuat: new THREE.Quaternion(ball.qx, ball.qy, ball.qz, ball.qw),
        targetPos: new THREE.Vector3(ball.x, ball.y, ball.z),
        targetQuat: new THREE.Quaternion(ball.qx, ball.qy, ball.qz, ball.qw),
        object: null,
        loading: false,
        failed: false,
      };
      glbPropStates.set(ball.id, state);
    }

    state.targetPos.set(ball.x, ball.y, ball.z);
    state.targetQuat.set(ball.qx, ball.qy, ball.qz, ball.qw);
    state.smoothPos.lerp(state.targetPos, 0.42);
    state.smoothQuat.slerp(state.targetQuat, 0.42);
    syncGlbPropObject(ball, state);

    if (!state.object) return;
    state.object.position.copy(state.smoothPos);
    state.object.quaternion.copy(state.smoothQuat);
    state.object.scale.set(
      Number.isFinite(ball.sx) ? ball.sx : Math.max(0.1, ball.r ?? DEFAULT_PUSH_BALL_RADIUS),
      Number.isFinite(ball.sy) ? ball.sy : Math.max(0.1, ball.r ?? DEFAULT_PUSH_BALL_RADIUS),
      Number.isFinite(ball.sz) ? ball.sz : Math.max(0.1, ball.r ?? DEFAULT_PUSH_BALL_RADIUS),
    );
    state.object.visible = pushBallsVisible;
  }

  function updatePushBalls({ connected, balls }) {
    if (!pushBallsVisible || !connected || !Array.isArray(balls) || balls.length <= 0) {
      clearPushBalls();
      return;
    }
    const seen = new Set();
    const seenGlbProps = new Set();
    let count = 0;
    for (const ball of balls) {
      if (!ball?.id) continue;
      if (ball.kind === 'glb-prop' || ball.glbAssetId) {
        updateGlbProp(ball, seenGlbProps);
        continue;
      }
      if (count >= PUSH_BALL_MAX_INSTANCES) break;
      seen.add(ball.id);
      const radius = typeof ball.r === 'number' && ball.r > 0 ? ball.r : DEFAULT_PUSH_BALL_RADIUS;
      let state = pushBallStates.get(ball.id);
      if (!state) {
        state = {
          smoothPos: new THREE.Vector3(ball.x, ball.y, ball.z),
          smoothQuat: new THREE.Quaternion(ball.qx, ball.qy, ball.qz, ball.qw),
          targetPos: new THREE.Vector3(ball.x, ball.y, ball.z),
          targetQuat: new THREE.Quaternion(ball.qx, ball.qy, ball.qz, ball.qw),
          radius,
        };
        pushBallStates.set(ball.id, state);
      }
      state.targetPos.set(ball.x, ball.y, ball.z);
      state.targetQuat.set(ball.qx, ball.qy, ball.qz, ball.qw);
      state.smoothPos.lerp(state.targetPos, 0.42);
      state.smoothQuat.slerp(state.targetQuat, 0.42);
      state.radius = radius;

      pushBallScale.setScalar(radius);
      pushBallMatrix.compose(state.smoothPos, state.smoothQuat, pushBallScale);
      pushBallInstanced.setMatrixAt(count, pushBallMatrix);
      pushBallColor.set(typeof ball.color === 'string' && ball.color ? ball.color : '#e8945c');
      pushBallInstanced.setColorAt(count, pushBallColor);
      count++;
    }
    for (const id of Array.from(pushBallStates.keys())) {
      if (!seen.has(id)) pushBallStates.delete(id);
    }
    for (const [id, state] of Array.from(glbPropStates.entries())) {
      if (!seenGlbProps.has(id)) {
        if (state.object) scene.remove(state.object);
        glbPropStates.delete(id);
      }
    }
    pushBallInstanced.count = count;
    pushBallInstanced.instanceMatrix.needsUpdate = true;
    if (pushBallInstanced.instanceColor) pushBallInstanced.instanceColor.needsUpdate = true;
    pushBallInstanced.visible = count > 0;
  }

  function findActionName(actions, desired) {
    const wanted = String(desired ?? 'idle').toLowerCase();
    const fallbacks = {
      flap: ['flap', 'fly', 'flying'],
      glide: ['glide', 'fly', 'flap', 'idle'],
      walk: ['walk', 'idle'],
      idle: ['idle', 'rest pose', 'rest'],
    };
    const candidates = fallbacks[wanted] ?? [wanted, 'idle'];
    for (const candidate of candidates) {
      for (const name of actions.keys()) {
        if (name.toLowerCase() === candidate) return name;
      }
    }
    for (const candidate of candidates) {
      for (const name of actions.keys()) {
        if (name.toLowerCase().includes(candidate)) return name;
      }
    }
    return actions.keys().next().value ?? null;
  }

  function playMountAnimation(state, animState, deltaSeconds = 1 / 60) {
    if (!state.actions?.size) return;
    state.currentActionAge = (state.currentActionAge ?? 0) + deltaSeconds;
    const nextName = findActionName(state.actions, animState);
    if (!nextName || nextName === state.currentActionName) return;
    if (state.currentActionName && state.currentActionAge < MOUNT_ANIMATION_MIN_HOLD_SECONDS) return;
    const next = state.actions.get(nextName);
    if (!next) return;
    const previous = state.currentActionName ? state.actions.get(state.currentActionName) : null;
    next.enabled = true;
    if (!state.startedActions?.has(nextName)) {
      next.reset();
      state.startedActions?.add(nextName);
    }
    next.setEffectiveWeight(1);
    next.play();
    if (previous && previous !== next) {
      previous.fadeOut(MOUNT_ANIMATION_FADE_SECONDS);
      next.crossFadeFrom(previous, MOUNT_ANIMATION_FADE_SECONDS, false);
    }
    state.currentActionName = nextName;
    state.currentActionAge = 0;
  }

  function syncMountObject(mount, state) {
    if ((!room?.loadGlbAsset && !room?.loadGlbModel) || state.object || state.loading || state.failed) return;
    state.loading = true;
    const assetId = mount.glbAssetId;
    const load = room.loadGlbAsset
      ? room.loadGlbAsset(assetId)
      : room.loadGlbModel(assetId).then((scene) => ({ scene, animations: [] }));
    load
      .then(async (asset) => {
        state.loading = false;
        if (!asset?.scene || mountStates.get(mount.id) !== state) return;
        const clone = cloneSkeleton(asset.scene);
        clone.name = `Mount-${mount.id}`;
        clone.traverse((child) => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          child.userData.skipOutline = true;
        });
        state.object = clone;
        state.mixer = new THREE.AnimationMixer(clone);
        state.actions = new Map();
        state.startedActions = new Set();
        for (const clip of asset.animations ?? []) {
          state.actions.set(clip.name, state.mixer.clipAction(clip));
        }
        state.eyeAnimator = new MouseEyeAtlasAnimator();
        await state.eyeAnimator.load();
        if (mountStates.get(mount.id) !== state) {
          state.eyeAnimator.dispose?.();
          return;
        }
        state.eyeUnsub = attachEyesToModel('bird', state.eyeAnimator, clone);
        state.eyeAnimator.setState('idle', { immediate: true });
        scene.add(clone);
        playMountAnimation(state, mount.animState, 1 / 60);
      })
      .catch(() => {
        state.loading = false;
        state.failed = true;
      });
  }

  function updateMounts({ connected, mounts, deltaSeconds = 1 / 60 }) {
    const mountList = connected && Array.isArray(mounts) ? mounts : [];
    if (!mountList.length) {
      clearMounts();
      return;
    }
    const seen = new Set();
    for (const mount of mountList) {
      if (!mount?.id || !mount.glbAssetId) continue;
      seen.add(mount.id);
      let state = mountStates.get(mount.id);
      if (!state) {
        state = {
          smoothPos: new THREE.Vector3(mount.x, mount.y, mount.z),
          smoothQuat: new THREE.Quaternion(mount.qx, mount.qy, mount.qz, mount.qw),
          targetPos: new THREE.Vector3(mount.x, mount.y, mount.z),
          targetQuat: new THREE.Quaternion(mount.qx, mount.qy, mount.qz, mount.qw),
          object: null,
          mixer: null,
          actions: new Map(),
          startedActions: new Set(),
          currentActionName: null,
          currentActionAge: 0,
          loading: false,
          failed: false,
        };
        mountStates.set(mount.id, state);
      }
      state.targetPos.set(mount.x, mount.y, mount.z);
      state.targetQuat.set(mount.qx, mount.qy, mount.qz, mount.qw);
      const distanceSq = state.smoothPos.distanceToSquared(state.targetPos);
      if (distanceSq > MOUNT_SNAP_DISTANCE * MOUNT_SNAP_DISTANCE) {
        state.smoothPos.copy(state.targetPos);
        state.smoothQuat.copy(state.targetQuat);
      } else {
        const alpha = smoothingAlpha(MOUNT_SMOOTH_RATE, deltaSeconds);
        state.smoothPos.lerp(state.targetPos, alpha);
        state.smoothQuat.slerp(state.targetQuat, alpha);
      }
      syncMountObject(mount, state);
      state.mixer?.update?.(deltaSeconds);
      state.eyeAnimator?.setState?.(mount.animState ?? 'idle');
      state.eyeAnimator?.update?.(deltaSeconds);
      playMountAnimation(state, mount.animState, deltaSeconds);
      if (!state.object) continue;
      state.object.position.copy(state.smoothPos);
      state.object.quaternion.copy(state.smoothQuat);
      state.object.scale.set(
        Number.isFinite(mount.sx) ? mount.sx : 1,
        Number.isFinite(mount.sy) ? mount.sy : 1,
        Number.isFinite(mount.sz) ? mount.sz : 1,
      );
      state.object.visible = true;
    }
    for (const [id, state] of Array.from(mountStates.entries())) {
      if (!seen.has(id)) {
        if (state.object) scene.remove(state.object);
        state.mixer?.stopAllAction?.();
        state.eyeUnsub?.();
        state.eyeAnimator?.dispose?.();
        mountStates.delete(id);
      }
    }
  }

  function getMountSocketWorldPosition(mountId, socketName = 'spine') {
    const state = mountStates.get(mountId);
    if (!state?.object) return null;
    const wanted = String(socketName || 'spine').toLowerCase();
    let socket = null;
    state.object.traverse((child) => {
      if (socket) return;
      const name = String(child.name || '').toLowerCase();
      if (name === wanted || name.includes(wanted)) socket = child;
    });
    if (!socket) return state.smoothPos.clone().add(new THREE.Vector3(0, 0.72, -0.08));
    return socket.getWorldPosition(new THREE.Vector3());
  }

  function getMountRenderState(mountId) {
    const state = mountStates.get(mountId);
    if (!state) return null;
    return {
      position: state.smoothPos,
      quaternion: state.smoothQuat,
      targetPosition: state.targetPos,
      object: state.object,
    };
  }

  function clearCheesePickups() {
    cheesePickupInstanced.count = 0;
    cheesePickupInstanced.visible = false;
    if (cheesePickupStates.size > 0) cheesePickupStates.clear();
  }

  function updateCheesePickups({ connected, cheesePickups, nowSeconds, deltaSeconds }) {
    const cheeseList = connected ? cheesePickups : [];
    if (!Array.isArray(cheeseList) || cheeseList.length <= 0) {
      clearCheesePickups();
      return;
    }
    const seenCheese = new Set();
    let cheeseCount = 0;
    for (const cheese of cheeseList) {
      if (!cheese?.id || cheeseCount >= CHEESE_PICKUP_MAX_INSTANCES) continue;
      seenCheese.add(cheese.id);
      let state = cheesePickupStates.get(cheese.id);
      if (!state) {
        state = { phase: Math.random() * Math.PI * 2, spinY: 0 };
        cheesePickupStates.set(cheese.id, state);
      }
      state.spinY += deltaSeconds * 0.65;
      const baseY = (typeof cheese.y === 'number' ? cheese.y : 0) + 0.14;
      const bob = Math.sin(nowSeconds * 4.2 + state.phase) * 0.07;
      cheesePos.set(
        typeof cheese.x === 'number' ? cheese.x : 0,
        baseY + bob,
        typeof cheese.z === 'number' ? cheese.z : 0,
      );
      cheeseEuler.set(0, state.spinY, 0);
      cheeseQuat.setFromEuler(cheeseEuler);
      cheeseScale.setScalar(cheesePickupVisualScale(cheese.amount));
      cheeseMatrix.compose(cheesePos, cheeseQuat, cheeseScale);
      cheesePickupInstanced.setMatrixAt(cheeseCount, cheeseMatrix);
      cheeseCount++;
    }
    for (const id of Array.from(cheesePickupStates.keys())) {
      if (!seenCheese.has(id)) cheesePickupStates.delete(id);
    }
    cheesePickupInstanced.count = cheeseCount;
    cheesePickupInstanced.instanceMatrix.needsUpdate = true;
    cheesePickupInstanced.visible = cheeseCount > 0;
  }

  function dispose() {
    scene.remove(pushBallInstanced);
    pushBallInstanced.dispose?.();
    pushBallUnitGeometry.dispose();
    pushBallSharedMaterial.dispose();
    pushBallStates.clear();
    for (const state of glbPropStates.values()) {
      if (state.object) scene.remove(state.object);
    }
    glbPropStates.clear();
    clearMounts();
    cheesePickupGroup.remove(cheesePickupInstanced);
    cheesePickupInstanced.dispose?.();
    cheesePickupGeometry.dispose();
    cheesePickupMaterial.dispose();
    cheesePickupStates.clear();
    scene.remove(cheesePickupGroup);
  }

  return {
    cheesePickupGroup,
    getPushBallsVisible: () => pushBallsVisible,
    setPushBallsVisible(visible) {
      pushBallsVisible = !!visible;
      if (!pushBallsVisible) clearPushBalls();
    },
    updatePushBalls,
    updateMounts,
    updateCheesePickups,
    getMountRenderState,
    getMountSocketWorldPosition,
    dispose,
  };
}
