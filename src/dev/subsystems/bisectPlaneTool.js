import * as THREE from 'three';
import { createPrimitiveId } from '../buildModeSupport.js';
import { deepClone } from '../editorShared.js';

function setBisectPreview(editor, start, end) {
  if (!editor.bisectLine) return;
  if (!start || !end) {
    editor.bisectLine.visible = false;
    return;
  }
  const position = editor.bisectLine.geometry.attributes.position;
  position.setXYZ(0, start.x, start.y, start.z);
  position.setXYZ(1, end.x, end.y, end.z);
  position.needsUpdate = true;
  editor.bisectLine.visible = true;
}

function updateBisectButton(editor) {
  if (!editor.bisectPlaneButton) return;
  const active = editor.activeTool === 'bisect-plane';
  editor.bisectPlaneButton.textContent = active ? 'Bisect: On' : 'Bisect Plane';
  editor.bisectPlaneButton.style.background = active ? '#1e5b63' : '#3a2a45';
  editor.bisectPlaneButton.style.borderColor = active ? 'rgba(140,247,255,0.5)' : 'rgba(255,255,255,0.12)';
}

function toggleBisectPlaneTool(editor) {
  if (editor.activeTool === 'bisect-plane') {
    cancelBisectPlaneTool(editor);
    return;
  }
  const primitive = editor._selectedPrimitive();
  if (!primitive || primitive.type !== 'plane') {
    editor._setStatus('Select a plane before using Bisect Plane.', true);
    return;
  }
  editor.activeTool = 'bisect-plane';
  editor.bisectState = {
    planeId: primitive.id,
    dragStartWorldPoint: null,
    dragStartLocalPoint: null,
    dragCurrentWorldPoint: null,
    dragCurrentLocalPoint: null,
    isDragging: false,
    controlsWereEnabled: false,
  };
  updateBisectButton(editor);
  editor._setStatus('Bisect mode: click and drag on the selected plane. Esc cancels.');
}

function cancelBisectPlaneTool(editor, { silent = false } = {}) {
  if (editor.activeTool !== 'bisect-plane') return;
  if (editor.bisectState?.isDragging) {
    editor.controls.enabled = editor.bisectState.controlsWereEnabled && editor.visible;
  }
  editor.activeTool = null;
  editor.bisectState = null;
  setBisectPreview(editor, null, null);
  updateBisectButton(editor);
  if (!silent) {
    editor._setStatus('Bisect cancelled.');
  }
}

function primitiveWorldTransform(primitive) {
  if (!primitive) return null;
  const localPosition = new THREE.Vector3(
    primitive.position?.x ?? 0,
    primitive.position?.y ?? 0,
    primitive.position?.z ?? 0,
  );
  const localQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    primitive.rotation?.x ?? 0,
    primitive.rotation?.y ?? 0,
    primitive.rotation?.z ?? 0,
  ));
  const localScale = new THREE.Vector3(
    primitive.scale?.x ?? 1,
    primitive.scale?.y ?? 1,
    primitive.scale?.z ?? 1,
  );

  const worldMatrix = new THREE.Matrix4().compose(localPosition, localQuaternion, localScale);
  if (primitive.prefabInstanceId) {
    const prefabOrigin = primitive.prefabInstanceOrigin ?? { x: 0, y: 0, z: 0 };
    const prefabRotation = primitive.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
    const prefabScale = primitive.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
    const prefabMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(prefabOrigin.x, prefabOrigin.y, prefabOrigin.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(prefabRotation.x, prefabRotation.y, prefabRotation.z)),
      new THREE.Vector3(prefabScale.x, prefabScale.y, prefabScale.z),
    );
    worldMatrix.premultiply(prefabMatrix);
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  worldMatrix.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return { matrix: worldMatrix, position, quaternion, scale, rotation };
}

function planeLocalPoint(primitive, worldPoint) {
  const transform = primitiveWorldTransform(primitive);
  if (!transform || !worldPoint) return null;
  const inverse = transform.matrix.clone().invert();
  return worldPoint.clone().applyMatrix4(inverse);
}

function intersectSelectedPlaneFromPointer(editor, primitive) {
  const transform = primitiveWorldTransform(primitive);
  if (!transform) return null;
  editor.raycaster.setFromCamera(editor.pointerNdc, editor.app.camera);
  const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion).normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, transform.position);
  const worldPoint = new THREE.Vector3();
  if (!editor.raycaster.ray.intersectPlane(plane, worldPoint)) return null;
  const localPoint = worldPoint.clone().applyMatrix4(transform.matrix.clone().invert());
  return { worldPoint, localPoint };
}

function resolvePlaneBisectSpec(primitive, startLocalPoint, endLocalPoint) {
  const transform = primitiveWorldTransform(primitive);
  if (!transform || !startLocalPoint || !endLocalPoint) return null;

  const deltaX = endLocalPoint.x - startLocalPoint.x;
  const deltaY = endLocalPoint.y - startLocalPoint.y;
  if ((deltaX * deltaX) + (deltaY * deltaY) < 0.0004) return null;

  const axis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'y' : 'x';
  const averageCoord = axis === 'x'
    ? (startLocalPoint.x + endLocalPoint.x) * 0.5
    : (startLocalPoint.y + endLocalPoint.y) * 0.5;
  const axisWorldSpan = Math.max(0.0001, transform.scale[axis]);
  const minNormalizedSpan = Math.min(0.49, 0.08 / axisWorldSpan);
  const cutCoord = THREE.MathUtils.clamp(averageCoord, -0.5 + minNormalizedSpan, 0.5 - minNormalizedSpan);
  const spanA = cutCoord + 0.5;
  const spanB = 0.5 - cutCoord;

  if (spanA <= minNormalizedSpan || spanB <= minNormalizedSpan) return null;

  const previewStartLocal = axis === 'x'
    ? new THREE.Vector3(cutCoord, -0.5, 0)
    : new THREE.Vector3(-0.5, cutCoord, 0);
  const previewEndLocal = axis === 'x'
    ? new THREE.Vector3(cutCoord, 0.5, 0)
    : new THREE.Vector3(0.5, cutCoord, 0);
  const previewStartWorld = previewStartLocal.clone().applyMatrix4(transform.matrix);
  const previewEndWorld = previewEndLocal.clone().applyMatrix4(transform.matrix);

  return {
    axis,
    cutCoord,
    spanA,
    spanB,
    transform,
    previewStartWorld,
    previewEndWorld,
  };
}

function updateBisectPreview(editor) {
  if (editor.activeTool !== 'bisect-plane') {
    setBisectPreview(editor, null, null);
    return;
  }
  const state = editor.bisectState;
  const primitive = editor._selectedPrimitive();
  if (!state || !primitive || primitive.type !== 'plane') {
    cancelBisectPlaneTool(editor, { silent: true });
    return;
  }
  if (!state.isDragging || !state.dragStartLocalPoint || !state.dragCurrentLocalPoint) {
    setBisectPreview(editor, null, null);
    return;
  }
  const spec = resolvePlaneBisectSpec(primitive, state.dragStartLocalPoint, state.dragCurrentLocalPoint);
  if (!spec) {
    setBisectPreview(editor, null, null);
    return;
  }
  setBisectPreview(editor, spec.previewStartWorld, spec.previewEndWorld);
}

function handleCanvasPointerDown(editor, { editableHit, editableId }) {
  if (editor.activeTool !== 'bisect-plane') return false;
  const primitive = editor._selectedPrimitive();
  if (!primitive || primitive.type !== 'plane') {
    cancelBisectPlaneTool(editor, { silent: true });
    editor._setStatus('Bisect mode needs a selected plane.', true);
    return false;
  }
  if (!editableHit || editableId !== primitive.id) {
    editor._setStatus('Bisect drag must start on the selected plane.', true);
    return true;
  }

  const localPoint = planeLocalPoint(primitive, editableHit.point);
  if (!localPoint) {
    editor._setStatus('Could not resolve the bisect point on that plane.', true);
    return true;
  }

  editor.bisectState = {
    planeId: primitive.id,
    dragStartWorldPoint: editableHit.point.clone(),
    dragStartLocalPoint: localPoint.clone(),
    dragCurrentWorldPoint: editableHit.point.clone(),
    dragCurrentLocalPoint: localPoint.clone(),
    isDragging: true,
    controlsWereEnabled: editor.controls.enabled,
  };
  editor.controls.enabled = false;
  editor._setStatus('Bisect mode: drag to place the cut, release to apply.');
  return true;
}

function handleCanvasPointerMove(editor) {
  if (editor.activeTool !== 'bisect-plane' || !editor.bisectState?.isDragging) return false;
  const primitive = editor._selectedPrimitive();
  if (!primitive || primitive.type !== 'plane') {
    cancelBisectPlaneTool(editor, { silent: true });
    return false;
  }
  const hit = intersectSelectedPlaneFromPointer(editor, primitive);
  if (!hit) return true;
  editor.bisectState.dragCurrentWorldPoint = hit.worldPoint;
  editor.bisectState.dragCurrentLocalPoint = hit.localPoint;
  return true;
}

function handleCanvasPointerUp(editor) {
  if (editor.activeTool !== 'bisect-plane' || !editor.bisectState?.isDragging) return false;
  const primitive = editor._selectedPrimitive();
  const state = editor.bisectState;
  const hit = primitive ? intersectSelectedPlaneFromPointer(editor, primitive) : null;
  if (hit) {
    state.dragCurrentWorldPoint = hit.worldPoint;
    state.dragCurrentLocalPoint = hit.localPoint;
  }
  state.isDragging = false;
  editor.controls.enabled = state.controlsWereEnabled && editor.visible;
  const applied = primitive
    ? applyPlaneBisect(editor, primitive, state.dragStartLocalPoint, state.dragCurrentLocalPoint)
    : false;
  cancelBisectPlaneTool(editor, { silent: true });
  if (!applied) {
    editor._setStatus('Bisect cancelled.', true);
  }
  return true;
}

function applyPlaneBisect(editor, primitive, startLocalPoint, endLocalPoint) {
  const spec = resolvePlaneBisectSpec(primitive, startLocalPoint, endLocalPoint);
  if (!spec) {
    editor._setStatus('Bisect needs a real drag across the plane, away from the edges.', true);
    return false;
  }

  const {
    axis,
    cutCoord,
    spanA,
    spanB,
    transform,
  } = spec;

  const centerNormA = (-0.5 + cutCoord) * 0.5;
  const centerNormB = (cutCoord + 0.5) * 0.5;
  const offsetA = new THREE.Vector3(
    axis === 'x' ? centerNormA * transform.scale.x : 0,
    axis === 'y' ? centerNormA * transform.scale.y : 0,
    0,
  ).applyQuaternion(transform.quaternion);
  const offsetB = new THREE.Vector3(
    axis === 'x' ? centerNormB * transform.scale.x : 0,
    axis === 'y' ? centerNormB * transform.scale.y : 0,
    0,
  ).applyQuaternion(transform.quaternion);

  const pieceA = editor._detachPrimitiveCopyFromPrefab(deepClone(primitive));
  const pieceB = editor._detachPrimitiveCopyFromPrefab(deepClone(primitive));
  pieceA.id = createPrimitiveId();
  pieceB.id = createPrimitiveId();
  pieceA.name = `${primitive.name}-a`;
  pieceB.name = `${primitive.name}-b`;
  pieceA.position = {
    x: Number((transform.position.x + offsetA.x).toFixed(4)),
    y: Number((transform.position.y + offsetA.y).toFixed(4)),
    z: Number((transform.position.z + offsetA.z).toFixed(4)),
  };
  pieceB.position = {
    x: Number((transform.position.x + offsetB.x).toFixed(4)),
    y: Number((transform.position.y + offsetB.y).toFixed(4)),
    z: Number((transform.position.z + offsetB.z).toFixed(4)),
  };
  pieceA.rotation = {
    x: Number(transform.rotation.x.toFixed(6)),
    y: Number(transform.rotation.y.toFixed(6)),
    z: Number(transform.rotation.z.toFixed(6)),
  };
  pieceB.rotation = {
    x: Number(transform.rotation.x.toFixed(6)),
    y: Number(transform.rotation.y.toFixed(6)),
    z: Number(transform.rotation.z.toFixed(6)),
  };
  pieceA.scale = {
    x: Number((axis === 'x' ? transform.scale.x * spanA : transform.scale.x).toFixed(4)),
    y: Number((axis === 'y' ? transform.scale.y * spanA : transform.scale.y).toFixed(4)),
    z: Number(transform.scale.z.toFixed(4)),
  };
  pieceB.scale = {
    x: Number((axis === 'x' ? transform.scale.x * spanB : transform.scale.x).toFixed(4)),
    y: Number((axis === 'y' ? transform.scale.y * spanB : transform.scale.y).toFixed(4)),
    z: Number(transform.scale.z.toFixed(4)),
  };
  applyBisectTextureAdjustments(primitive, pieceA, pieceB, axis, spanA, spanB, centerNormA, centerNormB);
  pieceA.deleted = false;
  pieceB.deleted = false;

  const nextLayout = editor.app.room.getEditableLayout();
  const sourceIsBuiltIn = editor.app.room.builtInEditableMeshes?.has(primitive.id) === true;
  nextLayout.primitives = (nextLayout.primitives ?? []).flatMap((entry) => {
    if (entry.id !== primitive.id) return [entry];
    if (!sourceIsBuiltIn) {
      return [pieceA, pieceB];
    }
    return [
      {
        ...deepClone(entry),
        deleted: true,
      },
      pieceA,
      pieceB,
    ];
  });
  editor.layout = editor.app.room.setEditableLayout(nextLayout);
  editor.selectedId = pieceA.id;
  editor._syncForm();
  editor._attachTransformControls();
  editor._setStatus(`Bisected ${primitive.name} into 2 planes.`);
  return true;
}

function applyBisectTextureAdjustments(primitive, pieceA, pieceB, axis, spanA, spanB, centerNormA, centerNormB) {
  if (!pieceA.texture?.repeat || !pieceB.texture?.repeat) return;
  pieceA.texture.offset = {
    x: pieceA.texture.offset?.x ?? 0,
    y: pieceA.texture.offset?.y ?? 0,
  };
  pieceB.texture.offset = {
    x: pieceB.texture.offset?.x ?? 0,
    y: pieceB.texture.offset?.y ?? 0,
  };
  const rotation = primitive.texture?.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  if (axis === 'x') {
    const repeatX = primitive.texture?.repeat?.x ?? pieceA.texture.repeat.x ?? 1;
    pieceA.texture.repeat.x = Number((repeatX * spanA).toFixed(4));
    pieceB.texture.repeat.x = Number((repeatX * spanB).toFixed(4));
    const offsetDeltaA = repeatX * centerNormA;
    const offsetDeltaB = repeatX * centerNormB;
    pieceA.texture.offset.x = Number((pieceA.texture.offset.x + (cos * offsetDeltaA)).toFixed(4));
    pieceA.texture.offset.y = Number((pieceA.texture.offset.y + (sin * offsetDeltaA)).toFixed(4));
    pieceB.texture.offset.x = Number((pieceB.texture.offset.x + (cos * offsetDeltaB)).toFixed(4));
    pieceB.texture.offset.y = Number((pieceB.texture.offset.y + (sin * offsetDeltaB)).toFixed(4));
    return;
  }

  const repeatY = primitive.texture?.repeat?.y ?? pieceA.texture.repeat.y ?? 1;
  pieceA.texture.repeat.y = Number((repeatY * spanA).toFixed(4));
  pieceB.texture.repeat.y = Number((repeatY * spanB).toFixed(4));
  const offsetDeltaA = repeatY * centerNormA;
  const offsetDeltaB = repeatY * centerNormB;
  pieceA.texture.offset.x = Number((pieceA.texture.offset.x - (sin * offsetDeltaA)).toFixed(4));
  pieceA.texture.offset.y = Number((pieceA.texture.offset.y + (cos * offsetDeltaA)).toFixed(4));
  pieceB.texture.offset.x = Number((pieceB.texture.offset.x - (sin * offsetDeltaB)).toFixed(4));
  pieceB.texture.offset.y = Number((pieceB.texture.offset.y + (cos * offsetDeltaB)).toFixed(4));
}

export function installBisectPlaneTool(editor) {
  editor._setBisectPreview = (start, end) => setBisectPreview(editor, start, end);
  editor._updateBisectButton = () => updateBisectButton(editor);
  editor._toggleBisectPlaneTool = () => toggleBisectPlaneTool(editor);
  editor._cancelBisectPlaneTool = (options) => cancelBisectPlaneTool(editor, options);
  editor._updateBisectPreview = () => updateBisectPreview(editor);
  editor._handleCanvasPointerDown = (payload) => handleCanvasPointerDown(editor, payload);
  editor._handleCanvasPointerMove = () => handleCanvasPointerMove(editor);
  editor._handleCanvasPointerUp = () => handleCanvasPointerUp(editor);
  editor._handleCanvasClick = () => (
    editor.activeTool === 'bisect-plane'
      ? !!editor.bisectState?.isDragging
      : false
  );
  editor._primitiveWorldTransform = (primitive) => primitiveWorldTransform(primitive);
  editor._planeLocalPoint = (primitive, worldPoint) => planeLocalPoint(primitive, worldPoint);
  editor._intersectSelectedPlaneFromPointer = (primitive) => intersectSelectedPlaneFromPointer(editor, primitive);
  editor._resolvePlaneBisectSpec = (primitive, start, end) => resolvePlaneBisectSpec(primitive, start, end);
  editor._applyPlaneBisect = (primitive, start, end) => applyPlaneBisect(editor, primitive, start, end);
}
