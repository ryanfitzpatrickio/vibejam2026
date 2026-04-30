import { NAV_AREA_TYPES, normalizeNavArea } from '../../../shared/navConfig.js';
import { createSection, createCheckbox, createRangeField, createNumberField, styleField } from '../ui/fields.js';

export function installSelectionSection(editor) {
  const section = createSection(editor.panel, 'Selection');

  editor.primitiveSelect = document.createElement('select');
  styleField(editor.primitiveSelect);
  editor.primitiveSelect.addEventListener('change', () => {
    editor.selectedId = editor.primitiveSelect.value || null;
    editor._syncForm();
  });
  section.appendChild(editor.primitiveSelect);

  editor.nameInput = document.createElement('input');
  editor.nameInput.type = 'text';
  editor.nameInput.placeholder = 'Primitive name';
  styleField(editor.nameInput);
  editor.nameInput.style.marginTop = '8px';
  editor.nameInput.addEventListener('input', () => {
    editor._updateSelected((entry) => {
      entry.name = editor.nameInput.value
        || entry.type
        || (entry.lightType ? `${entry.lightType}-light` : null)
        || (entry.speciesId ? 'vegetation' : null)
        || (entry.portalType ? `${entry.portalType}-portal` : 'editable');
    });
  });
  section.appendChild(editor.nameInput);

  const toggles = document.createElement('div');
  Object.assign(toggles.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(toggles);

  editor.colliderToggle = createCheckbox('Collider', toggles, (checked) => {
    editor._updateSelected((primitive) => {
      primitive.collider = checked;
    });
  });
  editor.castShadowToggle = createCheckbox('Cast Shadow', toggles, (checked) => {
    editor._updateSelected((primitive) => {
      primitive.castShadow = checked;
    });
  });
  editor.receiveShadowToggle = createCheckbox('Recv Shadow', toggles, (checked) => {
    editor._updateSelected((primitive) => {
      primitive.receiveShadow = checked;
    });
  });
  editor.deviceScreenToggle = createCheckbox('Device Screen', toggles, (checked) => {
    editor._updateSelected((primitive) => {
      primitive.deviceScreen = checked && primitive.type === 'plane'
        ? { source: 'web_viewport', app: 'drone_shop' }
        : null;
      if (checked && primitive.type === 'plane') {
        primitive.collider = false;
        primitive.castShadow = false;
        primitive.receiveShadow = false;
      }
    });
  });

  editor.clearanceInput = createRangeField(section, 'Clearance', 0, 2, 0.05, (value) => {
    editor._updateSelected((primitive) => {
      primitive.colliderClearance = value;
    });
  });

  editor.planeZIndexInput = createNumberField(
    section,
    'Plane z-index (draw + collision; higher on top)',
    { step: 1, value: '0' },
    (value) => {
      editor._updateSelected((primitive) => {
        primitive.zIndex = value == null || Number.isNaN(value) ? 0 : Math.trunc(value);
      });
    },
  );

  const navAreaWrap = document.createElement('label');
  navAreaWrap.textContent = 'Nav Area';
  Object.assign(navAreaWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  editor.navAreaSelect = document.createElement('select');
  styleField(editor.navAreaSelect);
  [
    [NAV_AREA_TYPES.DEFAULT, 'Default'],
    [NAV_AREA_TYPES.MOUSE_ONLY, 'Mouse Only'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    editor.navAreaSelect.appendChild(option);
  });
  editor.navAreaSelect.addEventListener('change', () => {
    editor._updateSelected((primitive) => {
      primitive.navArea = normalizeNavArea(editor.navAreaSelect.value);
    });
  });
  navAreaWrap.appendChild(editor.navAreaSelect);
  editor.navAreaSelect._wrap = navAreaWrap;
  section.appendChild(navAreaWrap);
}
