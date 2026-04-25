import * as THREE from 'three';

function createSelectionHighlight(editor) {
  editor.selectionHighlightGroup = new THREE.Group();
  editor.selectionHighlightGroup.visible = false;
  editor.selectionHighlightGroup.userData.editorHelper = true;
  editor.selectionHighlightMaterial = new THREE.LineBasicMaterial({
    color: '#ff8a1f',
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  editor.app.scene.add(editor.selectionHighlightGroup);
}

function clearSelectionHighlight(editor) {
  if (!editor.selectionHighlightGroup) return;
  editor.selectionHighlightBindings.forEach((binding) => {
    binding.helper.geometry?.dispose?.();
    if (binding.kind === 'box') {
      binding.helper.material?.dispose?.();
    }
  });
  editor.selectionHighlightBindings = [];
  editor.selectionHighlightTarget = null;
  editor.selectionHighlightGroup.clear();
  editor.selectionHighlightGroup.visible = false;
}

function rebuildSelectionHighlight(editor) {
  clearSelectionHighlight(editor);
  if (!editor.visible || !editor.selectedId) return;
  const target = editor.app.room.getEditableObject(editor.selectedId);
  if (!target || target.visible === false) return;

  editor.selectionHighlightTarget = target;
  const meshSources = [];
  target.traverse((child) => {
    if (!child || child.visible === false) return;
    if (child.userData?.editorHelper === true) return;
    if (child.isMesh && child.geometry) {
      meshSources.push(child);
    }
  });

  if (meshSources.length) {
    meshSources.forEach((source) => {
      const helper = new THREE.LineSegments(
        new THREE.EdgesGeometry(source.geometry),
        editor.selectionHighlightMaterial,
      );
      helper.matrixAutoUpdate = false;
      helper.renderOrder = 1200;
      helper.userData.editorHelper = true;
      editor.selectionHighlightGroup.add(helper);
      editor.selectionHighlightBindings.push({ kind: 'edges', source, helper });
    });
  } else {
    const box = new THREE.Box3().setFromObject(target);
    if (!box.isEmpty()) {
      const helper = new THREE.Box3Helper(box, '#ff8a1f');
      helper.material.depthTest = false;
      helper.material.depthWrite = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.98;
      helper.material.toneMapped = false;
      helper.renderOrder = 1200;
      helper.userData.editorHelper = true;
      editor.selectionHighlightGroup.add(helper);
      editor.selectionHighlightBindings.push({ kind: 'box', source: target, helper, box });
    }
  }

  updateSelectionHighlight(editor);
}

function updateSelectionHighlight(editor) {
  if (!editor.selectionHighlightGroup) return;
  if (!editor.visible || !editor.selectedId) {
    editor.selectionHighlightGroup.visible = false;
    return;
  }
  const target = editor.app.room.getEditableObject(editor.selectedId);
  if (!target || target.visible === false) {
    editor.selectionHighlightGroup.visible = false;
    return;
  }
  if (target !== editor.selectionHighlightTarget) {
    rebuildSelectionHighlight(editor);
    return;
  }

  target.updateWorldMatrix(true, true);
  let hasVisibleBinding = false;
  editor.selectionHighlightBindings.forEach((binding) => {
    if (binding.kind === 'edges') {
      if (!binding.source?.parent || binding.source.visible === false) {
        binding.helper.visible = false;
        return;
      }
      binding.source.updateWorldMatrix(true, false);
      binding.helper.matrix.copy(binding.source.matrixWorld);
      binding.helper.visible = true;
      hasVisibleBinding = true;
      return;
    }
    binding.box.setFromObject(binding.source);
    const empty = binding.box.isEmpty();
    binding.helper.visible = !empty;
    if (!empty) {
      hasVisibleBinding = true;
    }
  });
  editor.selectionHighlightGroup.visible = hasVisibleBinding;
}

export function installSelectionHighlight(editor) {
  editor._createSelectionHighlight = () => createSelectionHighlight(editor);
  editor._clearSelectionHighlight = () => clearSelectionHighlight(editor);
  editor._rebuildSelectionHighlight = () => rebuildSelectionHighlight(editor);
  editor._updateSelectionHighlight = () => updateSelectionHighlight(editor);
}
