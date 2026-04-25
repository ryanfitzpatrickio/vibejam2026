import * as THREE from 'three';

const FREE_CAMERA_KEYS = Object.freeze(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);

function isTypingInField() {
  const active = document.activeElement;
  return active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || active instanceof HTMLSelectElement
    || active?.isContentEditable === true;
}

function updateFreeCameraButton(editor) {
  if (!editor.freeCameraButton) return;
  const active = editor.cameraMode === 'free';
  editor.freeCameraButton.textContent = active ? 'Free Cam: On' : 'Free Cam: Off';
  editor.freeCameraButton.style.background = active ? '#1d5b6c' : '#243742';
  editor.freeCameraButton.style.borderColor = active ? 'rgba(120,220,255,0.55)' : 'rgba(255,255,255,0.12)';
}

function enterBuildCameraMode(editor) {
  if (editor.cameraMode === 'free') {
    const currentOffset = new THREE.Vector3().subVectors(editor.app.camera.position, editor.controls.target);
    if (!Number.isFinite(currentOffset.lengthSq()) || currentOffset.lengthSq() < 0.25) {
      const anchor = editor.app.mouse.position.clone();
      anchor.y += 0.6;
      editor.controls.target.copy(anchor);
      editor.app.camera.position.copy(anchor).add(new THREE.Vector3(6, 5.5, 6));
      editor.app.camera.lookAt(editor.controls.target);
      editor.app.camera.updateMatrixWorld();
    }
    return;
  }
  editor.controls.target.copy(editor.app.mouse.position);
  editor.controls.target.y += 0.6;
  const cameraOffset = new THREE.Vector3().subVectors(editor.app.camera.position, editor.controls.target);
  if (!Number.isFinite(cameraOffset.lengthSq()) || cameraOffset.lengthSq() < 2.25) {
    editor.app.camera.position.copy(editor.controls.target).add(new THREE.Vector3(6, 5.5, 6));
    editor.app.camera.lookAt(editor.controls.target);
    editor.app.camera.updateMatrixWorld();
  }
}

function updateFreeCameraMotion(editor, deltaSeconds) {
  if (!editor.freeCameraKeys.size) return;
  const move = new THREE.Vector3();
  if (editor.freeCameraKeys.has('KeyW')) move.z -= 1;
  if (editor.freeCameraKeys.has('KeyS')) move.z += 1;
  if (editor.freeCameraKeys.has('KeyA')) move.x -= 1;
  if (editor.freeCameraKeys.has('KeyD')) move.x += 1;
  if (move.lengthSq() <= 0) return;

  move.normalize();
  const forward = new THREE.Vector3();
  editor.app.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  } else {
    forward.normalize();
  }
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const delta = new THREE.Vector3()
    .addScaledVector(right, move.x)
    .addScaledVector(forward, -move.z)
    .multiplyScalar(
      editor.freeCameraMoveSpeed
      * (editor.freeCameraKeys.has('ShiftLeft') || editor.freeCameraKeys.has('ShiftRight')
        ? editor.freeCameraBoostMultiplier
        : 1)
      * deltaSeconds,
    );
  editor.app.camera.position.add(delta);
  editor.controls.target.add(delta);
}

function updateBuildCamera(editor, deltaSeconds) {
  if (editor.cameraMode === 'free') {
    updateFreeCameraMotion(editor, deltaSeconds);
    return;
  }
  const desiredTarget = editor.app.mouse.position.clone();
  desiredTarget.y += 0.6;
  editor.controls.target.lerp(desiredTarget, 1 - Math.exp(-6 * deltaSeconds));
}

function toggleFreeCameraMode(editor) {
  editor.cameraMode = editor.cameraMode === 'free' ? 'follow' : 'free';
  editor.freeCameraKeys.clear();
  enterBuildCameraMode(editor);
  updateFreeCameraButton(editor);
  editor._setStatus(editor.cameraMode === 'free'
    ? 'Free camera enabled. Left drag orbit, right drag pan, scroll zoom, WASD move.'
    : 'Build camera following player again.');
}

function handleFreeCameraKeyDown(editor, event) {
  if (!editor.visible || editor.cameraMode !== 'free') return false;
  if (isTypingInField()) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  if (!FREE_CAMERA_KEYS.includes(event.code)) return false;
  editor.freeCameraKeys.add(event.code);
  event.preventDefault();
  return true;
}

function handleFreeCameraKeyUp(editor, event) {
  if (editor.cameraMode !== 'free') return false;
  if (!FREE_CAMERA_KEYS.includes(event.code)) return false;
  editor.freeCameraKeys.delete(event.code);
  return true;
}

export function installBuildCamera(editor) {
  editor._updateFreeCameraButton = () => updateFreeCameraButton(editor);
  editor._toggleFreeCameraMode = () => toggleFreeCameraMode(editor);
  editor._enterBuildCameraMode = () => enterBuildCameraMode(editor);
  editor._updateBuildCamera = (deltaSeconds) => updateBuildCamera(editor, deltaSeconds);
  editor._handleFreeCameraKeyDown = (event) => handleFreeCameraKeyDown(editor, event);
  editor._handleFreeCameraKeyUp = (event) => handleFreeCameraKeyUp(editor, event);
}
