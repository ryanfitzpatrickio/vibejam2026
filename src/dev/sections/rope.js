import {
  DEFAULT_ROPE_CARD_OPACITY,
  DEFAULT_ROPE_CARD_WIDTH,
  MAX_ROPE_CARD_WIDTH,
  MAX_ROPE_LENGTH,
  MAX_ROPE_SEGMENTS,
  MAX_SEGMENT_RADIUS,
  MIN_ROPE_CARD_WIDTH,
  MIN_ROPE_LENGTH,
  MIN_ROPE_SEGMENTS,
  MIN_SEGMENT_RADIUS,
  ROPE_VISUAL_MODES,
} from '../../../shared/ropes.js';
import { createSection, createRangeField, createNumberField, styleField, addInlineButton } from '../ui/fields.js';

const THICKNESS_MIN = MIN_SEGMENT_RADIUS * 2;
const THICKNESS_MAX = MAX_SEGMENT_RADIUS * 2;

export function installRopeSection(editor) {
  const section = createSection(editor.panel, 'Rope');
  editor.ropeSection = section;

  editor.ropeLengthInput = createRangeField(section, 'Length', MIN_ROPE_LENGTH, MAX_ROPE_LENGTH, 0.05, (value) => {
    editor._updateSelected((rope) => {
      rope.length = value;
    }, { snapPosition: false, snapScale: false });
  });

  editor.ropeSegmentsInput = createNumberField(section, 'Segments', {
    min: MIN_ROPE_SEGMENTS,
    max: MAX_ROPE_SEGMENTS,
    step: 1,
  }, (value) => {
    editor._updateSelected((rope) => {
      rope.segmentCount = Math.round(value);
    }, { snapPosition: false, snapScale: false });
  });

  editor.ropeThicknessInput = createRangeField(
    section,
    'Thickness (diameter)',
    THICKNESS_MIN,
    THICKNESS_MAX,
    0.005,
    (value) => {
      editor._updateSelected((rope) => {
        rope.segmentRadius = value * 0.5;
      }, { snapPosition: false, snapScale: false });
    },
  );

  const colorWrap = document.createElement('label');
  colorWrap.textContent = 'Color';
  Object.assign(colorWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  editor.ropeColorInput = document.createElement('input');
  editor.ropeColorInput.type = 'color';
  Object.assign(editor.ropeColorInput.style, {
    width: '100%',
    height: '32px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  });
  editor.ropeColorInput.addEventListener('input', () => {
    editor._updateSelected((rope) => {
      rope.color = editor.ropeColorInput.value;
    }, { snapPosition: false, snapScale: false });
  });
  colorWrap.appendChild(editor.ropeColorInput);
  section.appendChild(colorWrap);

  const visualModeWrap = document.createElement('label');
  visualModeWrap.textContent = 'Visual';
  Object.assign(visualModeWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  editor.ropeVisualModeSelect = document.createElement('select');
  styleField(editor.ropeVisualModeSelect);
  [
    ['rope', 'Rope strand only'],
    ['rope-cards', 'Rope + hanging cards'],
    ['cards', 'Cards only'],
  ].forEach(([value, label]) => {
    if (!ROPE_VISUAL_MODES.includes(value)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    editor.ropeVisualModeSelect.appendChild(option);
  });
  editor.ropeVisualModeSelect.addEventListener('change', () => {
    editor._updateSelected((rope) => {
      rope.visualMode = editor.ropeVisualModeSelect.value;
      rope.cards = {
        ...(rope.cards ?? {}),
        enabled: rope.visualMode !== 'rope',
      };
    }, { snapPosition: false, snapScale: false });
  });
  visualModeWrap.appendChild(editor.ropeVisualModeSelect);
  section.appendChild(visualModeWrap);

  editor.ropeCardWidthInput = createRangeField(
    section,
    'Card width',
    MIN_ROPE_CARD_WIDTH,
    MAX_ROPE_CARD_WIDTH,
    0.02,
    (value) => {
      editor._updateSelected((rope) => {
        rope.cards = {
          ...(rope.cards ?? {}),
          width: value,
        };
      }, { snapPosition: false, snapScale: false });
    },
  );
  editor.ropeCardWidthInput.value = DEFAULT_ROPE_CARD_WIDTH;
  editor.ropeCardWidthInput._output.textContent = DEFAULT_ROPE_CARD_WIDTH.toFixed(2);

  editor.ropeCardOpacityInput = createRangeField(section, 'Card opacity', 0.05, 1, 0.01, (value) => {
    editor._updateSelected((rope) => {
      rope.cards = {
        ...(rope.cards ?? {}),
        opacity: value,
      };
    }, { snapPosition: false, snapScale: false });
  });
  editor.ropeCardOpacityInput.value = DEFAULT_ROPE_CARD_OPACITY;
  editor.ropeCardOpacityInput._output.textContent = DEFAULT_ROPE_CARD_OPACITY.toFixed(2);

  const texWrap = document.createElement('div');
  texWrap.textContent = 'Texture (strand/cards optional)';
  Object.assign(texWrap.style, {
    color: '#d7c5a7',
    marginTop: '8px',
    fontSize: '11px',
  });
  section.appendChild(texWrap);

  const atlasLabel = document.createElement('label');
  atlasLabel.textContent = 'Atlas';
  Object.assign(atlasLabel.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '4px',
  });
  editor.ropeTextureAtlasSelect = document.createElement('select');
  styleField(editor.ropeTextureAtlasSelect);
  (editor.textureAtlases ?? []).forEach((atlas) => {
    const option = document.createElement('option');
    option.value = atlas.id;
    option.textContent = atlas.label;
    editor.ropeTextureAtlasSelect.appendChild(option);
  });
  editor.ropeTextureAtlasSelect.addEventListener('change', () => {
    editor._syncRopeTextureFromFields();
  });
  atlasLabel.appendChild(editor.ropeTextureAtlasSelect);
  section.appendChild(atlasLabel);

  editor.ropeTextureCellInput = createNumberField(section, 'Texture cell', {
    min: 0,
    max: 999,
    step: 1,
  }, () => {
    editor._syncRopeTextureFromFields();
  });

  addInlineButton(section, 'Clear texture', () => {
    editor.ropeTextureCellInput.value = '';
    editor._syncRopeTextureFromFields();
  }, '#3a3028');
}
