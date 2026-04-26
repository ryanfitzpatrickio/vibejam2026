import { addInlineButton, createSection, styleField } from '../ui/fields.js';

export function installGlbSection(editor) {
  const section = createSection(editor.panel, 'GLB Models');

  editor._glbFileInput = document.createElement('input');
  editor._glbFileInput.type = 'file';
  editor._glbFileInput.accept = '.glb';
  editor._glbFileInput.style.display = 'none';
  editor._glbFileInput.addEventListener('change', () => editor._handleGlbUpload());
  document.body.appendChild(editor._glbFileInput);

  const uploadRow = document.createElement('div');
  Object.assign(uploadRow.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '8px',
  });
  section.appendChild(uploadRow);

  addInlineButton(uploadRow, 'Upload GLB', () => editor._glbFileInput.click());
  addInlineButton(uploadRow, 'Refresh', () => editor._loadGlbRegistry());

  editor.glbSelect = document.createElement('select');
  styleField(editor.glbSelect);
  editor.glbSelect.style.marginTop = '8px';
  section.appendChild(editor.glbSelect);

  const placeRow = document.createElement('div');
  Object.assign(placeRow.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px',
    marginTop: '8px',
  });
  section.appendChild(placeRow);
  addInlineButton(placeRow, 'Place GLB', () => editor._placeSelectedGlb(), '#23472d');
  addInlineButton(placeRow, 'Place GLB Prop', () => editor._placeSelectedGlbProp(), '#2d4d23');
  addInlineButton(placeRow, 'Place Mount', () => editor._placeSelectedMount(), '#27475c');
  addInlineButton(section, 'Delete Asset', () => editor._deleteSelectedGlb(), '#5d221f');

  editor.glbStatus = document.createElement('div');
  Object.assign(editor.glbStatus.style, {
    color: '#d8c3a8',
    marginTop: '8px',
    fontSize: '11px',
    lineHeight: '1.35',
    whiteSpace: 'pre-wrap',
  });
  section.appendChild(editor.glbStatus);

  editor._loadGlbRegistry();
}
