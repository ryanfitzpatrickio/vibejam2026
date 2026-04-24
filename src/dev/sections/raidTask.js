import { RAID_TASK_TYPES, RAID_TASK_TYPE_LABELS } from '../../../shared/raidLayout.js';
import { addActionButton, createCheckbox, createSection, styleField } from '../ui/fields.js';

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function createSelectField(section, label) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  Object.assign(wrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
    marginTop: '8px',
  });
  const select = document.createElement('select');
  styleField(select);
  wrap.appendChild(select);
  section.appendChild(wrap);
  select._wrap = wrap;
  return select;
}

function createTaskPrefabPayload(prefab, current = null) {
  return {
    enabled: true,
    prefabId: prefab.id,
    name: prefab.name,
    position: current?.position ?? { x: 0, y: 0, z: 0 },
    rotation: current?.rotation ?? { x: 0, y: 0, z: 0 },
    scale: current?.scale ?? { x: 1, y: 1, z: 1 },
    primitives: deepClone(prefab.primitives ?? []),
  };
}

export function installRaidTaskSection(editor) {
  const section = createSection(editor.panel, 'Tasks');
  editor.raidTaskSection = section;

  const typeWrap = document.createElement('label');
  typeWrap.textContent = 'Task type';
  Object.assign(typeWrap.style, {
    display: 'grid',
    gap: '4px',
    color: '#d7c5a7',
  });
  editor.raidTaskTypeSelect = document.createElement('select');
  styleField(editor.raidTaskTypeSelect);
  Object.values(RAID_TASK_TYPES).forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = RAID_TASK_TYPE_LABELS[value] ?? value;
    editor.raidTaskTypeSelect.appendChild(option);
  });
  editor.raidTaskTypeSelect.addEventListener('change', () => {
    editor._updateSelected((task) => {
      task.taskType = editor.raidTaskTypeSelect.value;
    }, { snapPosition: false, snapScale: false });
  });
  typeWrap.appendChild(editor.raidTaskTypeSelect);
  section.appendChild(typeWrap);

  editor.raidTaskVisualTargetSelect = createSelectField(section, 'Transform target');
  [
    ['marker', 'Task marker'],
    ['before', 'Before prefab'],
    ['after', 'After prefab'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    editor.raidTaskVisualTargetSelect.appendChild(option);
  });
  editor.raidTaskVisualTargetSelect.addEventListener('change', () => {
    editor.activeRaidTaskVisualTarget = editor.raidTaskVisualTargetSelect.value;
    const task = editor._selectedRaidTask?.();
    if (task) {
      editor.app.room.setRaidTaskPrefabEditTarget(task.id, editor.activeRaidTaskVisualTarget);
      if (editor.activeRaidTaskVisualTarget === 'before' || editor.activeRaidTaskVisualTarget === 'after') {
        editor.activeRaidTaskVisualPreview = editor.activeRaidTaskVisualTarget;
        if (editor.raidTaskVisualPreviewSelect) {
          editor.raidTaskVisualPreviewSelect.value = editor.activeRaidTaskVisualPreview;
        }
        editor.app.room.setRaidTaskPrefabEditorPreview(task.id, editor.activeRaidTaskVisualPreview);
      }
      editor._attachTransformControls();
    }
  });

  editor.raidTaskVisualPreviewSelect = createSelectField(section, 'Preview state');
  [
    ['auto', 'Gameplay auto'],
    ['before', 'Before only'],
    ['after', 'After only'],
    ['both', 'Before + after'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    editor.raidTaskVisualPreviewSelect.appendChild(option);
  });
  editor.raidTaskVisualPreviewSelect.addEventListener('change', () => {
    editor.activeRaidTaskVisualPreview = editor.raidTaskVisualPreviewSelect.value;
    const task = editor._selectedRaidTask?.();
    if (task) {
      editor.app.room.setRaidTaskPrefabEditorPreview(task.id, editor.activeRaidTaskVisualPreview);
    }
  });

  const toggleWrap = document.createElement('div');
  Object.assign(toggleWrap.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(toggleWrap);
  editor.raidTaskBeforePrefabEnabledToggle = createCheckbox('Before on', toggleWrap, (checked) => {
    editor._updateSelected((task) => {
      task.beforePrefab = task.beforePrefab ?? {
        enabled: checked,
        prefabId: '',
        name: '',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        primitives: [],
      };
      task.beforePrefab.enabled = checked;
    }, { snapPosition: false, snapScale: false });
  });
  editor.raidTaskAfterPrefabEnabledToggle = createCheckbox('After on', toggleWrap, (checked) => {
    editor._updateSelected((task) => {
      task.afterPrefab = task.afterPrefab ?? {
        enabled: checked,
        prefabId: '',
        name: '',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        primitives: [],
      };
      task.afterPrefab.enabled = checked;
    }, { snapPosition: false, snapScale: false });
  });

  const prefabGrid = document.createElement('div');
  Object.assign(prefabGrid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(prefabGrid);

  editor.raidTaskBeforePrefabSelect = createSelectField(prefabGrid, 'Before prefab');
  editor.raidTaskAfterPrefabSelect = createSelectField(prefabGrid, 'After prefab');

  const buttonGrid = document.createElement('div');
  Object.assign(buttonGrid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(buttonGrid);

  const applyPrefab = (slot) => {
    const select = slot === 'after' ? editor.raidTaskAfterPrefabSelect : editor.raidTaskBeforePrefabSelect;
    const prefab = editor.prefabLibrary.prefabs.find((entry) => entry.id === select.value);
    if (!prefab) return;
    const key = slot === 'after' ? 'afterPrefab' : 'beforePrefab';
    editor._updateSelected((task) => {
      task[key] = createTaskPrefabPayload(prefab, task[key]);
    }, { snapPosition: false, snapScale: false });
    const task = editor._selectedRaidTask?.();
    if (task) {
      editor.app.room.setRaidTaskPrefabEditorPreview(task.id, editor.activeRaidTaskVisualPreview);
    }
  };
  addActionButton(buttonGrid, 'Use as before', () => applyPrefab('before'), '#4d3a1a');
  addActionButton(buttonGrid, 'Use as after', () => applyPrefab('after'), '#4d3a1a');

  editor._syncRaidTaskPrefabSection = () => {
    const currentBefore = editor.raidTaskBeforePrefabSelect?.value;
    const currentAfter = editor.raidTaskAfterPrefabSelect?.value;
    [editor.raidTaskBeforePrefabSelect, editor.raidTaskAfterPrefabSelect].forEach((select) => {
      if (!select) return;
      select.innerHTML = '';
      editor.prefabLibrary.prefabs.forEach((prefab) => {
        const option = document.createElement('option');
        option.value = prefab.id;
        option.textContent = prefab.name;
        select.appendChild(option);
      });
    });
    if (currentBefore) editor.raidTaskBeforePrefabSelect.value = currentBefore;
    if (currentAfter) editor.raidTaskAfterPrefabSelect.value = currentAfter;
  };
  editor._syncRaidTaskPrefabSection();
}
