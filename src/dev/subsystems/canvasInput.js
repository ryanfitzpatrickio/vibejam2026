import { resolveEditableHitObject, editableIdFromObject, hideProbe, pickEditableHit } from './probeVisuals.js';

/** Max pixels the pointer may drift between down/up to still count as a click (vs. orbit drag). */
const CLICK_DRAG_PX = 5;
/** Max ms between down and up for a click. */
const CLICK_MAX_MS = 350;

export function bindCanvasEvents(editor) {
  const canvas = editor.app.renderer.domElement;

  canvas.addEventListener('pointermove', (event) => {
    editor.pointerInsideCanvas = true;
    const rect = canvas.getBoundingClientRect();
    editor.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    editor.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    editor.pointerScreen.x = event.clientX;
    editor.pointerScreen.y = event.clientY;
    editor._handleCanvasPointerMove?.({ event });
  });

  canvas.addEventListener('pointerleave', () => {
    editor.pointerInsideCanvas = false;
    hideProbe(editor);
  });

  canvas.addEventListener('contextmenu', (event) => {
    if (!editor.visible) return;
    event.preventDefault();
  });

  /** Tracks where the left-button pointerdown started so we can distinguish
   *  a click (select) from an orbit-drag. Right / middle buttons are left to
   *  OrbitControls / TransformControls. */
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let downActive = false;

  canvas.addEventListener('pointerdown', (event) => {
    if (!editor.visible) return;
    if (event.button !== 0) {
      downActive = false;
      return;
    }
    // If the TransformControls gizmo absorbed the press (axis drag), it
    // disables OrbitControls via the dragging-changed handler. Detect that
    // here so we don't also treat the gizmo grab as a selection click.
    if (editor.transformControls?.dragging) {
      downActive = false;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    editor.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    editor.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const { editableHit } = pickEditableHit(editor);
    const hitObject = resolveEditableHitObject(editableHit?.object);
    const editableId = editableIdFromObject(hitObject);
    editor._handleCanvasPointerDown?.({
      event,
      editableHit,
      hitObject,
      editableId,
    });
    downActive = true;
    downX = event.clientX;
    downY = event.clientY;
    downAt = performance.now();
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!downActive) return;
    downActive = false;
    if (!editor.visible) return;
    if (event.button !== 0) return;
    if (editor.transformControls?.dragging) return;
    const dx = event.clientX - downX;
    const dy = event.clientY - downY;
    const dragDistanceSq = (dx * dx) + (dy * dy);
    const dragDurationMs = performance.now() - downAt;

    // Resync the pointer NDC to where the user actually released so a tiny
    // drift doesn't pick a different object than the highlighted one.
    const rect = canvas.getBoundingClientRect();
    editor.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    editor.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const { editableHit } = pickEditableHit(editor);
    const hitObject = resolveEditableHitObject(editableHit?.object);
    const editableId = editableIdFromObject(hitObject);
    if (editor._handleCanvasPointerUp?.({
      event,
      editableHit,
      hitObject,
      editableId,
      dragDistanceSq,
      dragDurationMs,
    })) {
      return;
    }
    if (dragDistanceSq > CLICK_DRAG_PX * CLICK_DRAG_PX) return;
    if (dragDurationMs > CLICK_MAX_MS) return;
    if (editor._handleCanvasClick?.({
      event,
      editableHit,
      hitObject,
      editableId,
    })) {
      return;
    }
    if (!editableId) {
      editor._setStatus('No editable object under cursor.');
      return;
    }
    if (editor.selectedId === editableId) return;
    editor.selectedId = editableId;
    editor._syncForm();
    editor._setStatus(`Selected ${hitObject.name || 'object'}.`);
  });

  // Keep dblclick around as a no-op safety: some users will instinctively
  // double-click; just route it through the same single-click selection path
  // so it doesn't feel broken if their first click happened to land on a
  // non-editable surface.
  canvas.addEventListener('dblclick', (event) => {
    if (!editor.visible) return;
    event.preventDefault();
    const { editableHit } = pickEditableHit(editor);
    const hitObject = resolveEditableHitObject(editableHit?.object);
    const editableId = editableIdFromObject(hitObject);
    if (!editableId) return;
    editor.selectedId = editableId;
    editor._syncForm();
    editor._setStatus(`Selected ${hitObject.name || 'object'}.`);
  });
}
