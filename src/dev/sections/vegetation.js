import {
  addInlineButton,
  createNumberField,
  createSection,
  styleField,
} from '../ui/fields.js';

export function installVegetationSection(editor) {
  const section = createSection(editor.panel, 'Vegetation');
  editor.vegetationSection = section;

  editor.vegetationSpeciesSelect = document.createElement('select');
  styleField(editor.vegetationSpeciesSelect);
  editor.vegetationSpeciesSelect.addEventListener('change', () => {
    if (editor._selectedVegetation()) {
      editor._updateSelected((entry) => {
        entry.speciesId = editor.vegetationSpeciesSelect.value || null;
      }, { snapPosition: true, snapScale: false, snapY: true });
    }
    editor._syncVegetationSection();
  });
  section.appendChild(editor.vegetationSpeciesSelect);

  const modeWrap = document.createElement('label');
  modeWrap.textContent = 'Placement Mode';
  Object.assign(modeWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  editor.vegetationModeSelect = document.createElement('select');
  styleField(editor.vegetationModeSelect);
  ['single', 'patch', 'line'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    editor.vegetationModeSelect.appendChild(option);
  });
  editor.vegetationModeSelect.addEventListener('change', () => {
    if (editor._selectedVegetation()) {
      editor._updateSelected((entry) => {
        entry.mode = editor.vegetationModeSelect.value;
      }, { snapPosition: true, snapScale: false, snapY: true });
    }
    editor._syncVegetationSection();
  });
  modeWrap.appendChild(editor.vegetationModeSelect);
  editor.vegetationModeSelect._wrap = modeWrap;
  section.appendChild(modeWrap);

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(actions);

  addInlineButton(actions, 'Edit Lib', () => editor._openVegetationEditor());
  addInlineButton(actions, 'Place', () => editor._placeSelectedVegetation(), '#23472d');
  addInlineButton(actions, 'Delete', () => editor._deleteSelectedVegetation(), '#5d221f');
  addInlineButton(actions, 'Save Lib', () => editor._saveVegetationLibrary());

  editor.vegetationMeta = document.createElement('div');
  Object.assign(editor.vegetationMeta.style, {
    color: '#d8c3a8',
    marginTop: '8px',
    fontSize: '11px',
    lineHeight: '1.35',
    whiteSpace: 'pre-wrap',
  });
  section.appendChild(editor.vegetationMeta);

  editor.vegetationDensityInput = createNumberField(section, 'Patch Density / Count', { step: 1, min: 1, value: '24' }, (value) => {
    editor._updateSelected((entry) => {
      entry.density = value ?? 1;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });

  editor.vegetationSeedInput = createNumberField(section, 'Seed', { step: 1, value: '1' }, (value) => {
    editor._updateSelected((entry) => {
      entry.seed = value ?? 1;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });

  const shapeWrap = document.createElement('label');
  shapeWrap.textContent = 'Patch Shape';
  Object.assign(shapeWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  editor.vegetationAreaShapeSelect = document.createElement('select');
  styleField(editor.vegetationAreaShapeSelect);
  ['rect', 'circle'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    editor.vegetationAreaShapeSelect.appendChild(option);
  });
  editor.vegetationAreaShapeSelect.addEventListener('change', () => {
    editor._updateSelected((entry) => {
      entry.area.shape = editor.vegetationAreaShapeSelect.value;
    }, { snapPosition: true, snapScale: false, snapY: true });
    editor._syncVegetationSection();
  });
  shapeWrap.appendChild(editor.vegetationAreaShapeSelect);
  editor.vegetationAreaShapeSelect._wrap = shapeWrap;
  section.appendChild(shapeWrap);

  editor.vegetationAreaWidthInput = createNumberField(section, 'Patch Width', { step: 0.1, min: 0.1, value: '3' }, (value) => {
    editor._updateSelected((entry) => {
      entry.area.width = value ?? 3;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });

  editor.vegetationAreaDepthInput = createNumberField(section, 'Patch Depth', { step: 0.1, min: 0.1, value: '2' }, (value) => {
    editor._updateSelected((entry) => {
      entry.area.depth = value ?? 2;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });

  editor.vegetationAreaRadiusInput = createNumberField(section, 'Patch Radius', { step: 0.1, min: 0.1, value: '1.5' }, (value) => {
    editor._updateSelected((entry) => {
      entry.area.radius = value ?? 1.5;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });

  editor.vegetationLineLengthInput = createNumberField(section, 'Line Length', { step: 0.1, min: 0.1, value: '4' }, (value) => {
    editor._updateSelected((entry) => {
      entry.line.length = value ?? 4;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });

  editor.vegetationLineWidthInput = createNumberField(section, 'Line Width', { step: 0.1, min: 0.1, value: '0.8' }, (value) => {
    editor._updateSelected((entry) => {
      entry.line.width = value ?? 0.8;
    }, { snapPosition: true, snapScale: false, snapY: true });
  }, { topLevel: true });
}
