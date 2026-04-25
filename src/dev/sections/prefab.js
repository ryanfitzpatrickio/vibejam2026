import { addInlineButton, createSection, createVectorInputs, styleField } from '../ui/fields.js';

export function installPrefabSection(editor) {
  const section = createSection(editor.panel, 'Prefabs');

  editor.prefabSelect = document.createElement('select');
  styleField(editor.prefabSelect);
  editor.prefabSelect.addEventListener('change', () => {
    editor._syncPrefabSection();
  });

  section.appendChild(editor.prefabSelect);

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(actions);

  addInlineButton(actions, 'New / Edit', () => editor._openPrefabEditor());
  addInlineButton(actions, 'Place', () => editor._placeSelectedPrefab(), '#23472d');
  addInlineButton(actions, 'Delete', () => editor._deleteSelectedPrefab(), '#5d221f');
  addInlineButton(actions, 'Save Lib', () => editor._savePrefabLibrary());

  editor.prefabInstanceScaleInputs = createVectorInputs(section, 'Selected Group Scale', { step: 0.1, min: 0.05 }, (axis, value) => {
    editor._updateSelectedPrefabInstanceScale(axis, value);
  });

  editor.prefabMeta = document.createElement('div');
  Object.assign(editor.prefabMeta.style, {
    color: '#d8c3a8',
    marginTop: '8px',
    fontSize: '11px',
    lineHeight: '1.35',
    whiteSpace: 'pre-wrap',
  });
  section.appendChild(editor.prefabMeta);
}
