import { clamp } from '../editorShared.js';
import {
  createSection,
  createCheckbox,
  createNumberField,
  createRangeField,
  createVectorInputs,
  createVector2Inputs,
  styleField,
} from '../ui/fields.js';

const DEG_TO_RAD = Math.PI / 180;

export function installMaterialSection(editor) {
  const section = createSection(editor.panel, 'Surface');
  editor.surfaceSection = section;

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px',
  });
  section.appendChild(grid);

  editor.textureCellInput = createNumberField(grid, 'Texture Cell', {
    step: 1,
    min: 0,
    max: (editor._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1,
  }, (value) => {
    editor._updateSelected((primitive) => {
      if (typeof editor._setTextureCellValue === 'function') {
        editor._setTextureCellValue(primitive, value);
        return;
      }
      primitive.texture.cell = Number.isFinite(value)
        ? clamp(Math.round(value), 0, (editor._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1)
        : null;
      primitive.texture.atlas = editor.activeTextureAtlasId;
    });
    editor._highlightPalette();
  });

  editor.textureTargetWrap = document.createElement('div');
  Object.assign(editor.textureTargetWrap.style, {
    display: 'grid',
    gap: '6px',
    marginTop: '10px',
    marginBottom: '10px',
  });
  section.appendChild(editor.textureTargetWrap);

  const targetLabel = document.createElement('div');
  targetLabel.textContent = 'Texture Target';
  Object.assign(targetLabel.style, {
    color: '#d7c5a7',
    fontSize: '11px',
  });
  editor.textureTargetWrap.appendChild(targetLabel);

  editor.textureTargetBar = document.createElement('div');
  Object.assign(editor.textureTargetBar.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  });
  editor.textureTargetWrap.appendChild(editor.textureTargetBar);

  editor.textureTargetHint = document.createElement('div');
  Object.assign(editor.textureTargetHint.style, {
    color: '#a99b8a',
    fontSize: '11px',
    lineHeight: '1.4',
  });
  editor.textureTargetWrap.appendChild(editor.textureTargetHint);

  editor.clearTextureOverrideButton = document.createElement('button');
  editor.clearTextureOverrideButton.type = 'button';
  editor.clearTextureOverrideButton.textContent = 'Clear Face Override';
  styleField(editor.clearTextureOverrideButton);
  Object.assign(editor.clearTextureOverrideButton.style, {
    cursor: 'pointer',
    background: '#3d2a20',
    color: '#ffe6d1',
  });
  editor.clearTextureOverrideButton.addEventListener('click', () => {
    editor._updateSelected((primitive) => {
      if (typeof editor._clearTextureOverride === 'function') {
        editor._clearTextureOverride(primitive);
      }
    });
    editor._highlightPalette();
  });
  editor.textureTargetWrap.appendChild(editor.clearTextureOverrideButton);

  editor.colorInput = document.createElement('input');
  editor.colorInput.type = 'color';
  styleField(editor.colorInput);
  editor.colorInput.addEventListener('input', () => {
    editor._updateSelected((primitive) => {
      primitive.material.color = editor.colorInput.value;
    });
  });
  const colorWrap = document.createElement('label');
  colorWrap.textContent = 'Tint';
  Object.assign(colorWrap.style, { display: 'grid', gap: '4px', color: '#d7c5a7' });
  colorWrap.appendChild(editor.colorInput);
  grid.appendChild(colorWrap);

  editor.repeatInputs = createVector2Inputs(section, 'Texture Repeat', { step: 0.1, min: 0.1 }, (axis, value) => {
    editor._updateSelected((primitive) => {
      primitive.texture.repeat[axis] = Math.max(0.1, value);
    });
  });

  editor.textureRotationInput = createNumberField(section, 'Texture Rotation', {
    step: 1,
  }, (value) => {
    editor._updateSelected((primitive) => {
      primitive.texture.rotation = value * DEG_TO_RAD;
    });
  });

  editor.chromaSimilarityInput = createRangeField(section, 'Chroma Similarity', 0, 1, 0.01, (value) => {
    editor._updateSelected((primitive) => {
      primitive.chroma = primitive.chroma ?? {};
      primitive.chroma.similarity = value;
    });
  });

  editor.chromaFeatherInput = createRangeField(section, 'Chroma Feather', 0, 1, 0.01, (value) => {
    editor._updateSelected((primitive) => {
      primitive.chroma = primitive.chroma ?? {};
      primitive.chroma.feather = value;
    });
  });

  editor.roughnessInput = createRangeField(section, 'Roughness', 0, 1, 0.01, (value) => {
    editor._updateSelected((primitive) => {
      primitive.material.roughness = value;
    });
  });

  editor.metalnessInput = createRangeField(section, 'Metalness', 0, 1, 0.01, (value) => {
    editor._updateSelected((primitive) => {
      primitive.material.metalness = value;
    });
  });

  editor.glbPropPhysicsRadiusInput = createNumberField(section, 'Physics Radius', {
    step: 0.05,
    min: 0.12,
    max: 2.5,
  }, (value) => {
    editor._updateSelected((primitive) => {
      primitive.physicsRadius = Number.isFinite(value) ? Math.max(0.12, Math.min(2.5, value)) : primitive.physicsRadius;
    }, { snapPosition: false, snapScale: false });
  });

  const shapeWrap = document.createElement('label');
  shapeWrap.textContent = 'Physics Shape';
  Object.assign(shapeWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  editor.glbPropPhysicsShapeSelect = document.createElement('select');
  styleField(editor.glbPropPhysicsShapeSelect);
  [
    ['sphere', 'Sphere'],
    ['box', 'Box / square'],
    ['openBox', 'Open box / bag'],
    ['cylinder', 'Cylinder / polygon'],
  ].forEach(([value, labelText]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labelText;
    editor.glbPropPhysicsShapeSelect.appendChild(option);
  });
  editor.glbPropPhysicsShapeSelect.addEventListener('change', () => {
    editor._updateSelected((primitive) => {
      primitive.physicsShape = editor.glbPropPhysicsShapeSelect.value;
    }, { snapPosition: false, snapScale: false });
  });
  shapeWrap.appendChild(editor.glbPropPhysicsShapeSelect);
  section.appendChild(shapeWrap);
  editor.glbPropPhysicsShapeSelect._wrap = shapeWrap;

  editor.glbPropPhysicsSizeInputs = createVectorInputs(section, 'Physics Size', {
    step: 0.05,
    min: 0.05,
    max: 5,
  }, (axis, value) => {
    editor._updateSelected((primitive) => {
      primitive.physicsSize = primitive.physicsSize ?? { x: 1, y: 1, z: 1 };
      primitive.physicsSize[axis] = Number.isFinite(value) ? Math.max(0.05, Math.min(5, value)) : primitive.physicsSize[axis];
    }, { snapPosition: false, snapScale: false });
  });

  editor.glbPropPhysicsMassInput = createNumberField(section, 'Physics Mass', {
    step: 0.25,
    min: 0.2,
    max: 80,
  }, (value) => {
    editor._updateSelected((primitive) => {
      primitive.physicsMass = Number.isFinite(value) ? Math.max(0.2, Math.min(80, value)) : primitive.physicsMass;
    }, { snapPosition: false, snapScale: false });
  });

  editor.glbPropCatFavoriteToyToggle = createCheckbox('Cat favorite toy', section, (checked) => {
    editor._updateSelected((primitive) => {
      primitive.catFavoriteToy = checked === true;
    }, { snapPosition: false, snapScale: false });
  });
}
