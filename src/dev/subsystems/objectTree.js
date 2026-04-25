import { styleField } from '../ui/fields.js';

function createObjectTreePanel(editor) {
  editor.objectTreePanel = document.createElement('aside');
  Object.assign(editor.objectTreePanel.style, {
    position: 'fixed',
    top: '20px',
    left: '20px',
    width: '320px',
    maxHeight: 'calc(100vh - 40px)',
    overflow: 'hidden',
    zIndex: '140',
    padding: '14px',
    borderRadius: '14px',
    background: 'rgba(12, 10, 9, 0.92)',
    color: '#f7efe5',
    border: '1px solid rgba(255,255,255,0.12)',
    boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(10px)',
    fontFamily: 'monospace',
    display: 'none',
  });

  const title = document.createElement('div');
  title.textContent = 'Object Tree';
  Object.assign(title.style, {
    fontSize: '13px',
    fontWeight: '700',
    marginBottom: '10px',
    color: '#ffd7a4',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  });
  editor.objectTreePanel.appendChild(title);

  editor.objectTreeSearchInput = document.createElement('input');
  editor.objectTreeSearchInput.type = 'search';
  editor.objectTreeSearchInput.placeholder = 'Search objects';
  styleField(editor.objectTreeSearchInput);
  editor.objectTreeSearchInput.addEventListener('input', () => {
    editor.objectTreeQuery = editor.objectTreeSearchInput.value.trim().toLowerCase();
    editor._refreshObjectTree();
  });
  editor.objectTreePanel.appendChild(editor.objectTreeSearchInput);

  editor.objectTreeMeta = document.createElement('div');
  Object.assign(editor.objectTreeMeta.style, {
    marginTop: '8px',
    fontSize: '11px',
    color: '#c9b79d',
  });
  editor.objectTreePanel.appendChild(editor.objectTreeMeta);

  editor.objectTreeContainer = document.createElement('div');
  Object.assign(editor.objectTreeContainer.style, {
    marginTop: '10px',
    maxHeight: 'calc(100vh - 150px)',
    overflowY: 'auto',
    paddingRight: '4px',
  });
  editor.objectTreePanel.appendChild(editor.objectTreeContainer);

  document.body.appendChild(editor.objectTreePanel);
}

function objectTreeGroups(editor) {
  return [
    { key: 'primitives', label: 'Primitives', entries: editor._editorPrimitives() },
    { key: 'lights', label: 'Lights', entries: editor._editorLights() },
    { key: 'portals', label: 'Portals', entries: editor._editorPortals() },
    { key: 'ropes', label: 'Ropes', entries: editor._editorRopes() },
    { key: 'fans', label: 'Fans', entries: editor._editorFans() },
    { key: 'extraction', label: 'Extraction', entries: editor._editorExtractionPortals() },
    { key: 'tasks', label: 'Tasks', entries: editor._editorRaidTasks() },
    { key: 'vegetation', label: 'Vegetation', entries: editor._editorVegetation() },
  ];
}

function entryMatchesTreeSearch(editor, entry, groupLabel) {
  const query = editor.objectTreeQuery;
  if (!query) return true;
  const haystack = [
    entry.name,
    entry.id,
    editor._entryTypeLabel(entry),
    groupLabel,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function createObjectTreeButton(editor, entry) {
  const button = document.createElement('button');
  button.type = 'button';
  Object.assign(button.style, {
    display: 'grid',
    gap: '2px',
    width: '100%',
    padding: '8px 10px',
    borderRadius: '8px',
    border: entry.id === editor.selectedId
      ? '1px solid rgba(255,138,31,0.75)'
      : '1px solid rgba(255,255,255,0.08)',
    background: entry.id === editor.selectedId
      ? 'rgba(255,138,31,0.16)'
      : 'rgba(255,255,255,0.03)',
    color: '#fff6ec',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  });
  button.addEventListener('click', () => {
    editor.selectedId = entry.id;
    editor._syncForm();
    editor._setStatus(`Selected ${entry.name}.`);
  });

  const name = document.createElement('div');
  name.textContent = entry.name;
  Object.assign(name.style, {
    fontSize: '12px',
    fontWeight: entry.id === editor.selectedId ? '700' : '500',
  });
  button.appendChild(name);

  const meta = document.createElement('div');
  meta.textContent = `${editor._entryTypeLabel(entry)} · ${entry.id}`;
  Object.assign(meta.style, {
    fontSize: '10px',
    color: entry.id === editor.selectedId ? '#ffd7a4' : '#c9b79d',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
  button.appendChild(meta);

  return button;
}

function appendObjectTreeGroup(editor, group) {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, {
    marginBottom: '8px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.03)',
  });

  const summary = document.createElement('summary');
  summary.textContent = `${group.label} (${group.entries.length})`;
  Object.assign(summary.style, {
    padding: '8px 10px',
    cursor: 'pointer',
    color: '#ffd7a4',
    fontSize: '11px',
    userSelect: 'none',
  });
  details.appendChild(summary);

  const list = document.createElement('div');
  Object.assign(list.style, {
    display: 'grid',
    gap: '4px',
    padding: '6px',
  });

  group.entries.forEach((entry) => {
    list.appendChild(createObjectTreeButton(editor, entry));
  });

  details.appendChild(list);
  editor.objectTreeContainer.appendChild(details);
}

function refreshObjectTree(editor) {
  if (!editor.objectTreeContainer) return;
  const groups = objectTreeGroups(editor)
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => entryMatchesTreeSearch(editor, entry, group.label)),
    }))
    .filter((group) => group.entries.length > 0);

  const totalEntries = groups.reduce((sum, group) => sum + group.entries.length, 0);
  editor.objectTreeMeta.textContent = totalEntries
    ? `${totalEntries} visible object${totalEntries === 1 ? '' : 's'}`
    : 'No objects match the current search.';

  editor.objectTreeContainer.innerHTML = '';
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No editable objects';
    Object.assign(empty.style, {
      padding: '8px 6px',
      color: '#c9b79d',
      fontSize: '11px',
    });
    editor.objectTreeContainer.appendChild(empty);
    return;
  }

  groups.forEach((group) => appendObjectTreeGroup(editor, group));
}

export function installObjectTree(editor) {
  editor._createObjectTreePanel = () => createObjectTreePanel(editor);
  editor._refreshObjectTree = () => refreshObjectTree(editor);
}
