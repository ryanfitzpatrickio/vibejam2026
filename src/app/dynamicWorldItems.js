import * as THREE from 'three';

const DEFAULT_PUSH_BALL_RADIUS = 0.38;
const PUSH_BALL_MAX_INSTANCES = 128;
const CHEESE_PICKUP_MAX_INSTANCES = 256;

function cheesePickupVisualScale(amount) {
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  return Math.min(2.5, 0.58 + 0.022 * Math.min(n, 200));
}

export function createDynamicWorldItems(scene) {
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

  function clearPushBalls() {
    pushBallInstanced.count = 0;
    pushBallInstanced.visible = false;
    if (pushBallStates.size > 0) pushBallStates.clear();
  }

  function updatePushBalls({ connected, balls }) {
    if (!pushBallsVisible || !connected || !Array.isArray(balls) || balls.length <= 0) {
      clearPushBalls();
      return;
    }
    const seen = new Set();
    let count = 0;
    for (const ball of balls) {
      if (!ball?.id) continue;
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
    pushBallInstanced.count = count;
    pushBallInstanced.instanceMatrix.needsUpdate = true;
    if (pushBallInstanced.instanceColor) pushBallInstanced.instanceColor.needsUpdate = true;
    pushBallInstanced.visible = count > 0;
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
    updateCheesePickups,
    dispose,
  };
}
