import * as THREE from 'three';

const COPLANAR_EDITABLE_EPSILON = 0.03;

export function installProbeVisuals(editor) {
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: '#ffdf8a',
    transparent: true,
    opacity: 0.9,
  });
  editor.pointerLine = new THREE.Line(geometry, material);
  editor.pointerLine.visible = false;
  editor.pointerLine.renderOrder = 999;
  editor.pointerLine.userData.editorHelper = true;
  editor.app.scene.add(editor.pointerLine);

  const bisectGeometry = new THREE.BufferGeometry();
  bisectGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  editor.bisectLine = new THREE.Line(
    bisectGeometry,
    new THREE.LineBasicMaterial({
      color: '#ff8a1f',
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  editor.bisectLine.visible = false;
  editor.bisectLine.renderOrder = 1000;
  editor.bisectLine.userData.editorHelper = true;
  editor.app.scene.add(editor.bisectLine);

  editor.hitTooltip = document.createElement('div');
  Object.assign(editor.hitTooltip.style, {
    position: 'fixed',
    zIndex: '141',
    pointerEvents: 'none',
    padding: '6px 8px',
    borderRadius: '8px',
    background: 'rgba(12, 10, 9, 0.9)',
    color: '#fff6ec',
    border: '1px solid rgba(255,255,255,0.12)',
    fontFamily: 'monospace',
    fontSize: '11px',
    whiteSpace: 'pre',
    display: 'none',
  });
  document.body.appendChild(editor.hitTooltip);
}

export function resolveEditableHitObject(object) {
  let current = object ?? null;
  while (
    current
    && !current.userData?.primitiveId
    && !current.userData?.prefabInstanceId
    && !current.userData?.lightId
    && !current.userData?.portalId
    && !current.userData?.extractionPortalId
    && !current.userData?.raidTaskId
    && !current.userData?.ropeId
    && !current.userData?.vegetationId
  ) {
    current = current.parent;
  }
  return current;
}

export function editableIdFromObject(object) {
  return object?.userData?.primitiveId
    ?? object?.userData?.prefabInstanceId
    ?? object?.userData?.lightId
    ?? object?.userData?.portalId
    ?? object?.userData?.extractionPortalId
    ?? object?.userData?.raidTaskId
    ?? object?.userData?.ropeId
    ?? object?.userData?.vegetationId
    ?? null;
}

function isBuiltInEditable(editor, object) {
  const id = editableIdFromObject(object);
  return !!id && editor.app.room.builtInEditableMeshes?.has(id) === true;
}

function planeZIndexForEditable(editor, object) {
  const primitiveId = object?.userData?.primitiveId;
  if (!primitiveId) return null;

  const builtIn = editor.app.room.builtInEditableMeshes?.get(primitiveId)?.primitive;
  const primitive = builtIn
    ?? editor.layout?.primitives?.find((entry) => entry.id === primitiveId)
    ?? null;
  if (primitive?.type !== 'plane') return null;

  return Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
}

function layoutOrderForEditable(editor, object) {
  const primitiveId = object?.userData?.primitiveId;
  if (!primitiveId) return -1;
  return editor.layout?.primitives?.findIndex((entry) => entry.id === primitiveId) ?? -1;
}

function compareEditableCandidates(a, b) {
  const zA = a.planeZIndex ?? Number.NEGATIVE_INFINITY;
  const zB = b.planeZIndex ?? Number.NEGATIVE_INFINITY;
  if (zA !== zB) return zB - zA;
  if (a.builtIn !== b.builtIn) return a.builtIn ? 1 : -1;
  if (a.layoutOrder !== b.layoutOrder) return b.layoutOrder - a.layoutOrder;
  return a.hit.distance - b.hit.distance;
}

/**
 * Raycast against the scene and return both the closest hit overall (for the
 * pointer line / tooltip) and the closest hit that resolves to an editable
 * primitive / light / portal / rope etc. The split is important: the raw
 * first hit is often a non-editable floor or decoration mesh that shadows the
 * plane the user is actually aiming at. Walking the full sorted list lets a
 * click cut through those to the editable thing behind them.
 */
export function pickEditableHit(editor) {
  editor.raycaster.setFromCamera(editor.pointerNdc, editor.app.camera);
  const hits = editor.raycaster.intersectObjects(editor.app.scene.children, true)
    .filter((hit) => {
      const obj = hit.object;
      if (!obj || obj.visible === false) return false;
      if (obj.userData?.editorHelper === true) return false;
      // Skip line / sprite helpers that have no real surface to grab.
      if (obj.isLine || obj.isLineSegments || obj.isLine2 || obj.isSprite) return false;
      return true;
    });

  const editableRoots = (editor._editorEntries?.() ?? [])
    .map((entry) => editor.app.room.getEditableObject?.(entry.id))
    .filter((object, index, list) => object && list.indexOf(object) === index);
  const editableHits = editableRoots.length
    ? editor.raycaster.intersectObjects(editableRoots, true).filter((hit) => {
      const obj = hit.object;
      if (!obj || obj.visible === false) return false;
      if (obj.userData?.editorHelper === true) return false;
      if (obj.isLine || obj.isLineSegments || obj.isLine2 || obj.isSprite) return false;
      const editableObject = resolveEditableHitObject(obj);
      return !!editableIdFromObject(editableObject);
    })
    : [];

  const editableCandidates = [];
  for (const hit of editableHits) {
    const editableObject = resolveEditableHitObject(hit.object);
    const editableId = editableIdFromObject(editableObject);
    if (!editableObject || !editableId) continue;
    editableCandidates.push({
      hit,
      object: editableObject,
      builtIn: isBuiltInEditable(editor, editableObject),
      planeZIndex: planeZIndexForEditable(editor, editableObject),
      layoutOrder: layoutOrderForEditable(editor, editableObject),
    });
  }

  const firstEditable = editableCandidates[0] ?? null;
  const coplanarCandidates = firstEditable
    ? editableCandidates.filter((candidate) => (
      Math.abs(candidate.hit.distance - firstEditable.hit.distance) <= COPLANAR_EDITABLE_EPSILON
    ))
    : [];
  coplanarCandidates.sort(compareEditableCandidates);
  const editableHit = coplanarCandidates[0]?.hit ?? null;

  return { closestHit: hits[0] ?? null, editableHit };
}

export function updateProbe(editor) {
  if (!editor.pointerInsideCanvas) {
    hideProbe(editor);
    return;
  }

  const { closestHit, editableHit } = pickEditableHit(editor);
  // Prefer the editable hit for the highlight + click target; fall back to
  // the closest raw hit so the tooltip still shows surface info on hovers
  // over plain geometry.
  const hit = editableHit ?? closestHit;
  editor.currentHit = hit;
  editor.currentEditableHit = editableHit;
  if (!hit) {
    hideProbe(editor);
    return;
  }

  const position = editor.pointerLine.geometry.attributes.position;
  position.setXYZ(0, editor.app.camera.position.x, editor.app.camera.position.y, editor.app.camera.position.z);
  position.setXYZ(1, hit.point.x, hit.point.y, hit.point.z);
  position.needsUpdate = true;
  editor.pointerLine.visible = true;

  const hitObject = resolveEditableHitObject(hit.object);
  const editableId = editableIdFromObject(hitObject);
  const primitive = editableId
    ? editor.layout.primitives.find((entry) => entry.id === editableId)
    : null;
  const light = editableId
    ? (editor.layout.lights ?? []).find((entry) => entry.id === editableId)
    : null;
  const portal = editableId
    ? (editor.layout.portals ?? []).find((entry) => entry.id === editableId)
    : null;
  const rope = editableId
    ? (editor.layout.ropes ?? []).find((entry) => entry.id === editableId)
    : null;
  const extraction = editableId
    ? (editor.layout.extractionPortals ?? []).find((entry) => entry.id === editableId)
    : null;
  const raidTask = editableId
    ? (editor.layout.raidTasks ?? []).find((entry) => entry.id === editableId)
    : null;
  const vegetation = editableId
    ? (editor.layout.vegetation ?? []).find((entry) => entry.id === editableId)
    : null;
  const gridCell = editor._getGridCellFromPoint(hit.point);
  editor.hitTooltip.style.display = 'block';
  editor.hitTooltip.style.left = `${editor.pointerScreen.x + 14}px`;
  editor.hitTooltip.style.top = `${editor.pointerScreen.y + 14}px`;
  editor.hitTooltip.textContent = [
    hitObject?.name || hit.object.name || 'unnamed',
    gridCell ? `grid ${gridCell.col + 1}, ${gridCell.row + 1}` : '',
    primitive ? `cell ${primitive.texture.cell ?? 'none'}` : '',
    light ? `${light.lightType} light` : '',
    portal ? `${portal.portalType} portal` : '',
    extraction ? `extraction (r ${Number(extraction.radius).toFixed(2)})` : '',
    raidTask ? `raid task (${raidTask.taskType})` : '',
    rope ? `rope (${rope.segmentCount} seg · ${rope.length.toFixed(2)}m)` : '',
    vegetation ? `vegetation (${vegetation.mode})` : '',
    `x ${hit.point.x.toFixed(2)} y ${hit.point.y.toFixed(2)} z ${hit.point.z.toFixed(2)}`,
  ].filter(Boolean).join('\n');
}

export function hideProbe(editor) {
  editor.currentHit = null;
  editor.currentEditableHit = null;
  if (editor.pointerLine) {
    editor.pointerLine.visible = false;
  }
  if (editor.hitTooltip) {
    editor.hitTooltip.style.display = 'none';
  }
}
