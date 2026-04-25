import * as THREE from 'three';

export const LOCAL_CHARGED_THROW_ORBIT_SPEED = 25.5;
export const CHARGED_THROW_CAMERA_SIDE_OFFSET = 1.15;

const CHARGED_THROW_TRACER_POINTS = 30;
const CHARGED_THROW_TRACER_HORIZ_SPEED = 7.2 * 4.6;
const CHARGED_THROW_TRACER_UP_SPEED = 9.4 * Math.sqrt(4.6) * 1.35;
const CHARGED_THROW_TRACER_GRAVITY = 22;
const CHARGED_THROW_TRACER_STEP_SECONDS = 0.075;

export function createChargedThrowTracer(scene) {
  const positions = new Float32Array(CHARGED_THROW_TRACER_POINTS * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: '#63ff7a',
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.name = 'ChargedThrowTracer';
  line.frustumCulled = false;
  line.renderOrder = 3000;
  line.visible = false;
  scene.add(line);
  return {
    line,
    geometry,
    material,
    positions,
    aimDir: new THREE.Vector3(),
    arcStart: new THREE.Vector3(),
  };
}

export function getChargedThrowAimDirection(thirdPersonCamera, out) {
  out.set(-Math.sin(thirdPersonCamera.yaw), 0, -Math.cos(thirdPersonCamera.yaw));
  if (out.lengthSq() <= 0.0001) out.set(0, 0, 1);
  else out.normalize();
  return out;
}

export function updateChargedThrowTracer(tracer, {
  visible,
  thirdPersonCamera,
  predictionState,
  groundOffset,
}) {
  tracer.line.visible = !!visible;
  if (!visible) return;
  const aim = getChargedThrowAimDirection(thirdPersonCamera, tracer.aimDir);
  tracer.arcStart.set(
    predictionState.position.x + aim.x * 0.72,
    predictionState.position.y + groundOffset + 0.68,
    predictionState.position.z + aim.z * 0.72,
  );
  for (let i = 0; i < CHARGED_THROW_TRACER_POINTS; i += 1) {
    const t = i * CHARGED_THROW_TRACER_STEP_SECONDS;
    const px = tracer.arcStart.x + aim.x * CHARGED_THROW_TRACER_HORIZ_SPEED * t;
    const py = Math.max(
      0.04,
      tracer.arcStart.y
        + CHARGED_THROW_TRACER_UP_SPEED * t
        - 0.5 * CHARGED_THROW_TRACER_GRAVITY * t * t,
    );
    const pz = tracer.arcStart.z + aim.z * CHARGED_THROW_TRACER_HORIZ_SPEED * t;
    const base = i * 3;
    tracer.positions[base] = px;
    tracer.positions[base + 1] = py;
    tracer.positions[base + 2] = pz;
  }
  tracer.geometry.attributes.position.needsUpdate = true;
  tracer.geometry.computeBoundingSphere();
}

export function disposeChargedThrowTracer(scene, tracer) {
  scene.remove(tracer.line);
  tracer.geometry.dispose();
  tracer.material.dispose();
}
