import { createSection, createVectorInputs } from '../ui/fields.js';

const DEG_TO_RAD = Math.PI / 180;

export function installTransformSection(editor) {
  const section = createSection(editor.panel, 'Transform');

  editor.positionInputs = createVectorInputs(section, 'Position', { step: 0.05 }, (axis, value) => {
    editor._updateSelected((entry) => {
      if (entry.anchor && !entry.position) {
        entry.anchor[axis] = value;
      } else {
        entry.position[axis] = value;
      }
    }, { snapPosition: true, snapScale: false });
  });
  editor.rotationInputs = createVectorInputs(section, 'Rotation', { step: 1 }, (axis, value) => {
    editor._updateSelected((entry) => {
      if (!entry.rotation) return;
      entry.rotation[axis] = value * DEG_TO_RAD;
    }, { snapPosition: false, snapScale: false });
  });
  editor.scaleInputs = createVectorInputs(section, 'Scale', { step: 0.1, min: 0.1 }, (axis, value) => {
    const primitive = editor._selectedPrimitive();
    if (primitive?.prefabInstanceId) {
      editor._updateSelectedPrefabInstanceScale(axis, value);
      return;
    }
    if (editor._selectedRaidTaskPrefabScale?.()) {
      editor._updateSelectedRaidTaskPrefabScale(axis, value);
      return;
    }
    editor._updateSelected((primitive) => {
      primitive.scale[axis] = Math.max(0.1, value);
    }, { snapPosition: false, snapScale: true });
  });
}
