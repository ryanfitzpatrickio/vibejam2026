import * as THREE from 'three';
import {
  DEFAULT_PREFAB_LIBRARY,
  FACE_TEXTURE_SLOTS,
  createPrefabId,
  createPrefabPartId,
  normalizePrefab,
  normalizePrefabLibrary,
  normalizePrefabPrimitive,
} from './prefabRegistry.js';
import { DEFAULT_TEXTURE_ATLAS, TEXTURE_ATLASES } from './textureAtlasRegistry.js';
import {
  clamp,
  createAtlasButtonStyle,
  deepClone,
  getStoredString,
  setStoredString,
  titleCase,
} from './editorShared.js';
import {
  createLocalPrimitive,
  createPrimitiveGeometry,
} from './prefabGeneration.js';
import { generatePrefabFromPrompt } from './prefabAIGenerator.js';
import { assetUrl } from '../utils/assetUrl.js';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export class PrefabEditorDialog {
  constructor({
    room,
    textureAtlases,
    OrbitControls,
    TransformControls,
    onSaveLibrary,
  }) {
    this.room = room;
    this.textureAtlases = textureAtlases ?? TEXTURE_ATLASES;
    this.activeTextureAtlasId = this.textureAtlases[0]?.id ?? DEFAULT_TEXTURE_ATLAS;
    this.OrbitControls = OrbitControls;
    this.TransformControls = TransformControls;
    this.onSaveLibrary = onSaveLibrary;
    this.library = normalizePrefabLibrary(DEFAULT_PREFAB_LIBRARY);
    this.prefabId = this.library.prefabs[0]?.id ?? null;
    this.selectedPartId = null;
    this.textureTarget = 'all';
    this.meshes = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this._pointerDown = null;
    this._raf = 0;
    this._suppressTransformSync = false;

    this.grid = this.room.getBuildGridConfig();
    this._createUI();
    this._createScene();
    this._renderPalette();
    this._syncPrefabOptions();
    this._syncForm();
  }

  open(library, prefabId = null) {
    this.library = normalizePrefabLibrary(library ?? DEFAULT_PREFAB_LIBRARY);
    this.prefabId = prefabId ?? this.library.prefabs[0]?.id ?? null;
    if (!this.prefabId) {
      const prefab = normalizePrefab({});
      this.library.prefabs.push(prefab);
      this.prefabId = prefab.id;
    }
    this.selectedPartId = this._selectedPrefab()?.primitives[0]?.id ?? null;
    this.overlay.style.display = 'grid';
    this._syncPrefabOptions();
    this._syncForm();
    this._rebuildScene();
    this._resizeRenderer();
    this._startLoop();
  }

  close() {
    this.overlay.style.display = 'none';
    this.transformControls.detach();
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _selectedPrefab() {
    return this.library.prefabs.find((prefab) => prefab.id === this.prefabId) ?? null;
  }

  _selectedPart() {
    return this._selectedPrefab()?.primitives.find((primitive) => primitive.id === this.selectedPartId) ?? null;
  }

  _activeTextureAtlas() {
    return this.textureAtlases.find((atlas) => atlas.id === this.activeTextureAtlasId)
      ?? this.textureAtlases[0]
      ?? TEXTURE_ATLASES[0];
  }

  _createUI() {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '160',
      display: 'none',
      gridTemplateColumns: '260px minmax(440px, 1fr) 380px',
      background: 'rgba(0,0,0,0.68)',
      backdropFilter: 'blur(8px)',
    });

    this.leftPanel = document.createElement('aside');
    Object.assign(this.leftPanel.style, {
      overflowY: 'auto',
      padding: '18px 14px',
      boxSizing: 'border-box',
      background: 'rgba(12,10,9,0.92)',
      color: '#f7efe5',
      fontFamily: 'monospace',
      borderRight: '1px solid rgba(255,255,255,0.08)',
    });
    this.overlay.appendChild(this.leftPanel);

    const treeTitle = document.createElement('div');
    treeTitle.textContent = 'PREFAB TREE';
    Object.assign(treeTitle.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      color: '#ffd7a4',
      marginBottom: '10px',
      fontSize: '12px',
    });
    this.leftPanel.appendChild(treeTitle);

    this.partTree = document.createElement('div');
    Object.assign(this.partTree.style, {
      display: 'grid',
      gap: '5px',
    });
    this.leftPanel.appendChild(this.partTree);

    this.viewportWrap = document.createElement('div');
    Object.assign(this.viewportWrap.style, {
      position: 'relative',
      minHeight: '100vh',
      padding: '20px',
      boxSizing: 'border-box',
    });
    this.overlay.appendChild(this.viewportWrap);

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      borderRadius: '18px',
      background: 'linear-gradient(180deg, rgba(42,52,63,1) 0%, rgba(20,18,16,1) 100%)',
      boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
    });
    this.viewportWrap.appendChild(this.canvas);

    const hint = document.createElement('div');
    hint.textContent = 'Prefab Designer: orbit with mouse, drag gizmo, build inside snapped cell bounds.';
    Object.assign(hint.style, {
      position: 'absolute',
      left: '32px',
      bottom: '28px',
      color: '#f6efe4',
      fontFamily: 'monospace',
      fontSize: '12px',
      padding: '8px 10px',
      borderRadius: '10px',
      background: 'rgba(12,10,9,0.72)',
      border: '1px solid rgba(255,255,255,0.12)',
    });
    this.viewportWrap.appendChild(hint);

    this.panel = document.createElement('aside');
    Object.assign(this.panel.style, {
      overflowY: 'auto',
      padding: '20px',
      boxSizing: 'border-box',
      background: 'rgba(12,10,9,0.95)',
      color: '#f7efe5',
      fontFamily: 'monospace',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
    });
    this.overlay.appendChild(this.panel);

    const title = document.createElement('div');
    title.textContent = 'PREFAB EDITOR';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      color: '#ffd7a4',
      marginBottom: '8px',
    });
    this.panel.appendChild(title);

    const note = document.createElement('div');
    note.textContent = `Cell ${this.grid.cellWidth.toFixed(3)} x ${this.grid.cellDepth.toFixed(3)} | vertical ${this.grid.verticalStep.toFixed(3)}`;
    Object.assign(note.style, {
      color: '#9ee8b2',
      marginBottom: '12px',
      fontSize: '11px',
    });
    this.panel.appendChild(note);

    this.actions = document.createElement('div');
    Object.assign(this.actions.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '8px',
      marginBottom: '12px',
    });
    this.panel.appendChild(this.actions);

    this._addActionButton('New Prefab', () => this._newPrefab());
    this._addActionButton('Clone', () => this._clonePrefab());
    this._addActionButton('Delete', () => this._deletePrefab(), '#5d221f');
    this._addActionButton('Add Box', () => this._addPart('box'));
    this._addActionButton('Add Plane', () => this._addPart('plane'));
    this._addActionButton('Add Cyl', () => this._addPart('cylinder'));
    this._addActionButton('Add Wedge', () => this._addPart('wedge'));
    this._addActionButton('Move', () => this._setTransformMode('translate'));
    this._addActionButton('Rotate', () => this._setTransformMode('rotate'));
    this._addActionButton('Scale', () => this._setTransformMode('scale'));
    this._addActionButton('Save', () => this._saveLibrary(), '#23472d');
    this._addActionButton('Close', () => this.close());

    this._createPrefabSection();
    this._createPartSection();
    this._createTransformSection();
    this._createSurfaceSection();
    this._createPaletteSection();

    this.status = document.createElement('div');
    Object.assign(this.status.style, {
      marginTop: '10px',
      minHeight: '18px',
      color: '#9ee8b2',
      fontSize: '11px',
      whiteSpace: 'pre-wrap',
    });
    this.panel.appendChild(this.status);

    document.body.appendChild(this.overlay);
  }

  _createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2e333a');
    this.scene.fog = new THREE.Fog('#2e333a', 7, 20);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(3.6, 3.4, 4.2);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.controls = new this.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.75, 0);

    this.transformControls = new this.TransformControls(this.camera, this.canvas);
    this.transformControls.setMode('translate');
    this.transformControls.size = 0.85;
    this.transformControls.setRotationSnap(Math.PI * 0.5);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControls.addEventListener('objectChange', () => this._onTransformObjectChange());
    this.scene.add(this.transformControls.getHelper());
    this._bindViewportSelection();

    this.previewRoot = new THREE.Group();
    this.scene.add(this.previewRoot);

    this.gridRoot = new THREE.Group();
    this.previewRoot.add(this.gridRoot);

    this.partsRoot = new THREE.Group();
    this.previewRoot.add(this.partsRoot);

    const ambient = new THREE.HemisphereLight('#dfe8f1', '#3b2f26', 1.2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight('#ffdcb3', 2.1);
    sun.position.set(5, 7, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 20;
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.scene.add(sun);

    window.addEventListener('resize', () => {
      if (this.overlay.style.display !== 'none') {
        this._resizeRenderer();
      }
    });
  }

  _bindViewportSelection() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this._pointerDown = { x: event.clientX, y: event.clientY };
    });

    this.canvas.addEventListener('pointerup', (event) => {
      if (event.button !== 0 || !this._pointerDown) return;
      const dx = event.clientX - this._pointerDown.x;
      const dy = event.clientY - this._pointerDown.y;
      this._pointerDown = null;
      if ((dx * dx + dy * dy) > 25) return;
      if (this.transformControls.dragging) return;

      const rect = this.canvas.getBoundingClientRect();
      this.pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObjects([...this.meshes.values()], false);
      const partId = hits[0]?.object?.userData?.prefabPartId;
      if (partId) {
        event.preventDefault();
        this._selectPart(partId, { source: 'viewport' });
      }
    });
  }

  _createPrefabSection() {
    const section = this._createSection('Prefab');

    this.prefabSelect = document.createElement('select');
    this._styleField(this.prefabSelect);
    this.prefabSelect.addEventListener('change', () => {
      this.prefabId = this.prefabSelect.value || null;
      this.selectedPartId = this._selectedPrefab()?.primitives[0]?.id ?? null;
      this._syncForm();
      this._rebuildScene();
    });
    section.appendChild(this.prefabSelect);

    this.prefabNameInput = document.createElement('input');
    this.prefabNameInput.type = 'text';
    this.prefabNameInput.placeholder = 'Prefab name';
    this._styleField(this.prefabNameInput);
    this.prefabNameInput.style.marginTop = '8px';
    this.prefabNameInput.addEventListener('input', () => {
      const prefab = this._selectedPrefab();
      if (!prefab) return;
      prefab.name = this.prefabNameInput.value || 'Prefab';
      this._syncPrefabOptions();
      this._syncPartTree();
    });
    section.appendChild(this.prefabNameInput);

    this.prefabSizeInputs = this._createVectorInputs(section, 'Cell Span (X/Y/Z)', {
      step: 1,
      min: 1,
    }, (axis, value) => {
      const prefab = this._selectedPrefab();
      if (!prefab) return;
      prefab.size[axis] = Math.max(1, Math.round(value || 1));
      this._rebuildScene();
      this._syncForm();
    });

    if (import.meta.env.DEV) {
      this._createAIGenerationSection(section);
    }
  }

  _createAIGenerationSection(parent) {
    const section = this._createSection('AI Generate');
    parent.appendChild(section);

    this.aiPromptInput = document.createElement('input');
    this.aiPromptInput.type = 'text';
    this.aiPromptInput.placeholder = 'chair';
    this._styleField(this.aiPromptInput);
    section.appendChild(this.aiPromptInput);

    this.aiKeyInput = document.createElement('input');
    this.aiKeyInput.type = 'password';
    this.aiKeyInput.placeholder = 'OpenRouter API key';
    this.aiKeyInput.value = getStoredString('mouse-trouble.openrouter.key', '');
    this._styleField(this.aiKeyInput);
    this.aiKeyInput.style.marginTop = '8px';
    this.aiKeyInput.addEventListener('input', () => {
      setStoredString('mouse-trouble.openrouter.key', this.aiKeyInput.value);
    });
    section.appendChild(this.aiKeyInput);

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '8px',
      marginTop: '8px',
    });
    section.appendChild(controls);

    this._addInlineButton(controls, 'Generate', () => this._generatePrefabFromPrompt(), '#23472d');
    this._addInlineButton(controls, 'Clear Key', () => {
      this.aiKeyInput.value = '';
      setStoredString('mouse-trouble.openrouter.key', '');
      this._setStatus('Cleared OpenRouter key.');
    }, '#5d221f');

    this.aiNote = document.createElement('div');
    this.aiNote.textContent = 'Dev only. Uses OpenRouter + Gemini Flash. Key stays in localStorage.';
    Object.assign(this.aiNote.style, {
      marginTop: '8px',
      color: '#9ee8b2',
      fontSize: '11px',
      lineHeight: '1.35',
      whiteSpace: 'pre-wrap',
    });
    section.appendChild(this.aiNote);
  }

  _createPartSection() {
    const section = this._createSection('Parts');

    this.partSelect = document.createElement('select');
    this._styleField(this.partSelect);
    this.partSelect.addEventListener('change', () => {
      this._selectPart(this.partSelect.value || null, { source: 'dropdown' });
    });
    section.appendChild(this.partSelect);

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '8px',
      marginTop: '8px',
    });
    section.appendChild(actions);

    this._addInlineButton(actions, 'Duplicate Part', () => this._duplicatePart());
    this._addInlineButton(actions, 'Delete Part', () => this._deletePart(), '#5d221f');

    this.partNameInput = document.createElement('input');
    this.partNameInput.type = 'text';
    this.partNameInput.placeholder = 'Part name';
    this._styleField(this.partNameInput);
    this.partNameInput.style.marginTop = '8px';
    this.partNameInput.addEventListener('input', () => {
      const part = this._selectedPart();
      if (!part) return;
      part.name = this.partNameInput.value || part.type;
      this._syncPartOptions();
      this._syncPartTree();
      this._rebuildScene();
    });
    section.appendChild(this.partNameInput);
  }

  _createTransformSection() {
    const section = this._createSection('Transform');

    this.positionInputs = this._createVectorInputs(section, 'Position', { step: 0.05 }, (axis, value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.position[axis] = value;
      this._applyPartSnap(part, { snapScale: false });
      this._rebuildScene();
    });
    this.rotationInputs = this._createVectorInputs(section, 'Rotation', { step: 1 }, (axis, value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.rotation[axis] = value * DEG_TO_RAD;
      this._rebuildScene();
    });
    this.scaleInputs = this._createVectorInputs(section, 'Scale', { step: 0.1, min: 0.1 }, (axis, value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.scale[axis] = Math.max(0.1, value);
      this._applyPartSnap(part, { snapScale: true });
      this._rebuildScene();
    });
  }

  _createSurfaceSection() {
    const section = this._createSection('Surface');

    const targetWrap = document.createElement('div');
    Object.assign(targetWrap.style, {
      marginTop: '8px',
    });
    section.appendChild(targetWrap);

    const targetLabel = document.createElement('div');
    targetLabel.textContent = 'Texture Target';
    targetLabel.style.color = '#d7c5a7';
    targetWrap.appendChild(targetLabel);

    this.textureTargetBar = document.createElement('div');
    Object.assign(this.textureTargetBar.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginTop: '6px',
    });
    targetWrap.appendChild(this.textureTargetBar);

    this.textureTargetHint = document.createElement('div');
    Object.assign(this.textureTargetHint.style, {
      marginTop: '6px',
      color: '#9ee8b2',
      fontSize: '11px',
      minHeight: '16px',
    });
    targetWrap.appendChild(this.textureTargetHint);

    this.textureCellInput = this._createNumberField(section, 'Texture Cell', {
      step: 1,
      min: 0,
      max: (this._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1,
    }, (value) => {
      const part = this._selectedPart();
      if (!part) return;
      this._setTextureCellValue(part, value);
      this._syncForm();
      this._rebuildScene();
      this._highlightPalette();
    });

    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this._styleField(this.colorInput);
    this.colorInput.addEventListener('input', () => {
      const part = this._selectedPart();
      if (!part) return;
      part.material.color = this.colorInput.value;
      this._rebuildScene();
    });
    const colorWrap = document.createElement('label');
    colorWrap.textContent = 'Tint';
    Object.assign(colorWrap.style, {
      display: 'grid',
      gap: '4px',
      color: '#d7c5a7',
      marginTop: '8px',
    });
    colorWrap.appendChild(this.colorInput);
    section.appendChild(colorWrap);

    this.repeatInputs = this._createVector2Inputs(section, 'Texture Repeat', { step: 0.1, min: 0.1 }, (axis, value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.texture.repeat[axis] = Math.max(0.1, value);
      this._rebuildScene();
    });

    this.textureRotationInput = this._createNumberField(section, 'Texture Rotation', { step: 1 }, (value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.texture.rotation = (Number.isFinite(value) ? value : 0) * DEG_TO_RAD;
      this._rebuildScene();
    });

    this.offsetInputs = this._createVector2Inputs(section, 'Texture Offset', { step: 0.01 }, (axis, value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.texture.offset ||= { x: 0, y: 0 };
      part.texture.offset[axis] = Number.isFinite(value) ? value : 0;
      this._rebuildScene();
    });

    this.roughnessInput = this._createRangeField(section, 'Roughness', 0, 1, 0.01, (value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.material.roughness = value;
      this._rebuildScene();
    });

    this.metalnessInput = this._createRangeField(section, 'Metalness', 0, 1, 0.01, (value) => {
      const part = this._selectedPart();
      if (!part) return;
      part.material.metalness = value;
      this._rebuildScene();
    });

    this._renderTextureAtlasTabs();
  }

  _createPaletteSection() {
    const section = this._createSection('Texture Palette');
    this.textureAtlasTabs = document.createElement('div');
    Object.assign(this.textureAtlasTabs.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginBottom: '8px',
    });
    section.appendChild(this.textureAtlasTabs);

    this.paletteGrid = document.createElement('div');
    Object.assign(this.paletteGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      gap: '6px',
    });
    section.appendChild(this.paletteGrid);
  }

  _renderPalette() {
    this._renderTextureAtlasTabs();
    this.paletteGrid.innerHTML = '';
    const activeAtlas = this._activeTextureAtlas();
    const columns = activeAtlas.manifest?.grid?.columns ?? 10;
    const rows = activeAtlas.manifest?.grid?.rows ?? 10;
    const cells = activeAtlas.manifest?.cells ?? [];

    cells.forEach((cell) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.cellIndex = String(cell.index);
      button.dataset.atlasId = activeAtlas.id;
      Object.assign(button.style, {
        position: 'relative',
        width: '100%',
        aspectRatio: '1',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.18)',
        cursor: 'pointer',
        overflow: 'hidden',
        ...createAtlasButtonStyle(cell.index, activeAtlas.imageUrl, columns, rows),
      });
      button.title = `${activeAtlas.label}: ${cell.description ?? `Cell ${cell.index}`}`;
      button.addEventListener('click', () => {
        const part = this._selectedPart();
        if (!part) return;
        this._setTextureCellValue(part, cell.index);
        this._syncForm({ syncAtlas: false });
        this._rebuildScene();
        this._highlightPalette();
      });

      const badge = document.createElement('span');
      badge.textContent = String(cell.index);
      Object.assign(badge.style, {
        position: 'absolute',
        left: '4px',
        bottom: '4px',
        fontSize: '10px',
        color: '#fff',
        background: 'rgba(0,0,0,0.55)',
        padding: '1px 4px',
        borderRadius: '999px',
      });
      button.appendChild(badge);
      this.paletteGrid.appendChild(button);
    });
  }

  _renderTextureAtlasTabs() {
    if (!this.textureAtlasTabs) return;
    this.textureAtlasTabs.innerHTML = '';
    this.textureAtlases.forEach((atlas) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = atlas.label;
      Object.assign(button.style, {
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.12)',
        background: this.activeTextureAtlasId === atlas.id ? '#6d4f2a' : 'rgba(255,255,255,0.06)',
        color: '#fff4e8',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '11px',
      });
      button.addEventListener('click', () => {
        this.activeTextureAtlasId = atlas.id;
        this._syncForm({ syncAtlas: false });
        this._renderPalette();
      });
      this.textureAtlasTabs.appendChild(button);
    });
  }

  _createSection(title) {
    const section = document.createElement('section');
    Object.assign(section.style, {
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
    });

    const heading = document.createElement('div');
    heading.textContent = title.toUpperCase();
    Object.assign(heading.style, {
      color: '#ffd7a4',
      marginBottom: '8px',
      fontWeight: '700',
      fontSize: '11px',
    });
    section.appendChild(heading);
    this.panel.appendChild(section);
    return section;
  }

  _styleField(field) {
    Object.assign(field.style, {
      width: '100%',
      padding: '6px 8px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.16)',
      background: 'rgba(255,255,255,0.06)',
      color: '#fff6ec',
      fontFamily: 'inherit',
      fontSize: '12px',
      boxSizing: 'border-box',
    });
  }

  _addActionButton(label, onClick, background = '#2f2c28') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      background,
      color: '#fff4e8',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: '11px',
    });
    button.addEventListener('click', onClick);
    this.actions.appendChild(button);
  }

  _addInlineButton(parent, label, onClick, background = '#2f2c28') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      background,
      color: '#fff4e8',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: '11px',
    });
    button.addEventListener('click', onClick);
    parent.appendChild(button);
  }

  _createVectorInputs(parent, label, attrs, onChange) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginTop: '6px' });
    parent.appendChild(wrap);

    const title = document.createElement('div');
    title.textContent = label;
    title.style.color = '#d7c5a7';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '6px',
      marginTop: '4px',
    });
    wrap.appendChild(grid);

    const inputs = {};
    ['x', 'y', 'z'].forEach((axis) => {
      const input = document.createElement('input');
      input.type = 'number';
      Object.assign(input, attrs);
      input.removeAttribute('max');
      input.removeAttribute('min');
      this._styleField(input);
      input.addEventListener('input', () => onChange(axis, Number(input.value || 0)));
      grid.appendChild(input);
      inputs[axis] = input;
    });
    return inputs;
  }

  _createVector2Inputs(parent, label, attrs, onChange) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginTop: '8px' });
    parent.appendChild(wrap);

    const title = document.createElement('div');
    title.textContent = label;
    title.style.color = '#d7c5a7';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '6px',
      marginTop: '4px',
    });
    wrap.appendChild(grid);

    const inputs = {};
    ['x', 'y'].forEach((axis) => {
      const input = document.createElement('input');
      input.type = 'number';
      Object.assign(input, attrs);
      input.removeAttribute('max');
      input.removeAttribute('min');
      this._styleField(input);
      input.addEventListener('input', () => onChange(axis, Number(input.value || 0)));
      grid.appendChild(input);
      inputs[axis] = input;
    });
    return inputs;
  }

  _createNumberField(parent, label, attrs, onChange) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    Object.assign(wrap.style, {
      display: 'grid',
      gap: '4px',
      color: '#d7c5a7',
      marginTop: '8px',
    });
    const input = document.createElement('input');
    input.type = 'number';
    Object.assign(input, attrs);
    input.removeAttribute('max');
    input.removeAttribute('min');
    this._styleField(input);
    input.addEventListener('input', () => onChange(input.value === '' ? null : Number(input.value)));
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }

  _createRangeField(parent, label, min, max, step, onChange) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    Object.assign(wrap.style, {
      display: 'grid',
      gap: '4px',
      color: '#d7c5a7',
      marginTop: '8px',
    });
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('input', () => {
      onChange(Number(input.value));
      output.textContent = Number(input.value).toFixed(2);
    });
    const output = document.createElement('div');
    output.style.color = '#f2e5cf';
    output.style.fontSize = '11px';
    wrap.append(input, output);
    parent.appendChild(wrap);
    input._output = output;
    return input;
  }

  _syncPrefabOptions() {
    this.prefabSelect.innerHTML = '';
    this.library.prefabs.forEach((prefab) => {
      const option = document.createElement('option');
      option.value = prefab.id;
      option.textContent = prefab.name;
      this.prefabSelect.appendChild(option);
    });
    if (this.prefabId) {
      this.prefabSelect.value = this.prefabId;
    }
  }

  _syncPartOptions() {
    const prefab = this._selectedPrefab();
    this.partSelect.innerHTML = '';
    if (!prefab?.primitives?.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No parts';
      this.partSelect.appendChild(option);
      this.selectedPartId = null;
      return;
    }

    if (!prefab.primitives.some((primitive) => primitive.id === this.selectedPartId)) {
      this.selectedPartId = prefab.primitives[0].id;
    }

    prefab.primitives.forEach((part) => {
      const option = document.createElement('option');
      option.value = part.id;
      option.textContent = `${part.name} (${part.type})`;
      this.partSelect.appendChild(option);
    });
    this.partSelect.value = this.selectedPartId;
  }

  _syncPartTree() {
    if (!this.partTree) return;
    this.partTree.innerHTML = '';
    const prefab = this._selectedPrefab();
    if (!prefab) {
      const empty = document.createElement('div');
      empty.textContent = 'No prefab selected';
      empty.style.color = 'rgba(255,255,255,0.55)';
      empty.style.fontSize = '11px';
      this.partTree.appendChild(empty);
      return;
    }

    const root = document.createElement('div');
    Object.assign(root.style, {
      padding: '8px 9px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      color: '#fff4e8',
      fontSize: '12px',
      fontWeight: '700',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    root.textContent = `▾ ${prefab.name}`;
    this.partTree.appendChild(root);

    if (!prefab.primitives.length) {
      const empty = document.createElement('div');
      empty.textContent = '  No parts';
      empty.style.color = 'rgba(255,255,255,0.55)';
      empty.style.fontSize = '11px';
      this.partTree.appendChild(empty);
      return;
    }

    prefab.primitives.forEach((part) => {
      const selected = part.id === this.selectedPartId;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `  ${selected ? '●' : '○'} ${part.name} (${part.type})`;
      Object.assign(button.style, {
        width: '100%',
        padding: '7px 8px',
        borderRadius: '8px',
        border: selected ? '1px solid rgba(255,215,164,0.7)' : '1px solid rgba(255,255,255,0.1)',
        background: selected ? 'rgba(109,79,42,0.72)' : 'rgba(255,255,255,0.035)',
        color: selected ? '#ffe6ba' : '#d9cbb9',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '11px',
        textAlign: 'left',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });
      button.addEventListener('click', () => this._selectPart(part.id, { source: 'tree' }));
      this.partTree.appendChild(button);
    });
  }

  _selectPart(partId, { source = 'ui' } = {}) {
    const prefab = this._selectedPrefab();
    const nextId = prefab?.primitives?.some((part) => part.id === partId) ? partId : null;
    if (this.selectedPartId === nextId) {
      this._attachTransformControls();
      return;
    }
    this.selectedPartId = nextId;
    this._syncForm();
    this._attachTransformControls();
    if (source === 'viewport') {
      const part = this._selectedPart();
      this._setStatus(part ? `Selected ${part.name}.` : 'No part selected.');
    }
  }

  _syncForm({ syncAtlas = true } = {}) {
    this._syncPrefabOptions();
    this._syncPartOptions();
    this._syncPartTree();

    const prefab = this._selectedPrefab();
    const part = this._selectedPart();
    this._ensureTextureTarget(part);
    if (syncAtlas) {
      this._syncActiveAtlasToSelectedTexture(part);
    }

    this.prefabNameInput.value = prefab?.name ?? '';
    this.prefabSizeInputs.x.value = prefab?.size?.x ?? 1;
    this.prefabSizeInputs.y.value = prefab?.size?.y ?? 1;
    this.prefabSizeInputs.z.value = prefab?.size?.z ?? 1;

    const disabled = !part;
    [
      this.partNameInput,
      ...Object.values(this.positionInputs),
      ...Object.values(this.rotationInputs),
      ...Object.values(this.scaleInputs),
      this.textureCellInput,
      this.colorInput,
      ...Object.values(this.repeatInputs),
      this.textureRotationInput,
      ...Object.values(this.offsetInputs),
      this.roughnessInput,
      this.metalnessInput,
    ].forEach((field) => {
      field.disabled = disabled;
    });

    if (!part) {
      this._syncTextureTargetButtons(null);
      this._highlightPalette();
      return;
    }

    this._syncTextureTargetButtons(part);
    this.partNameInput.value = part.name;
    this.positionInputs.x.value = part.position.x;
    this.positionInputs.y.value = part.position.y;
    this.positionInputs.z.value = part.position.z;
    this.rotationInputs.x.value = (part.rotation.x * RAD_TO_DEG).toFixed(1);
    this.rotationInputs.y.value = (part.rotation.y * RAD_TO_DEG).toFixed(1);
    this.rotationInputs.z.value = (part.rotation.z * RAD_TO_DEG).toFixed(1);
    this.scaleInputs.x.value = part.scale.x;
    this.scaleInputs.y.value = part.scale.y;
    this.scaleInputs.z.value = part.scale.z;
    this.textureCellInput.max = String((this._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1);
    this.textureCellInput.value = this._getTextureCellInputValue(part);
    this.colorInput.value = part.material.color;
    this.repeatInputs.x.value = part.texture.repeat.x;
    this.repeatInputs.y.value = part.texture.repeat.y;
    this.textureRotationInput.value = ((part.texture.rotation ?? 0) * RAD_TO_DEG).toFixed(1);
    this.offsetInputs.x.value = part.texture.offset?.x ?? 0;
    this.offsetInputs.y.value = part.texture.offset?.y ?? 0;
    this.roughnessInput.value = part.material.roughness;
    this.roughnessInput._output.textContent = Number(part.material.roughness).toFixed(2);
    this.metalnessInput.value = part.material.metalness;
    this.metalnessInput._output.textContent = Number(part.material.metalness).toFixed(2);
    this._highlightPalette();
    this._attachTransformControls();
  }

  _highlightPalette() {
    const part = this._selectedPart();
    const selectedCell = String(this._getPaletteSelectedCell(part)?.cell ?? '');
    const selectedAtlas = this._getPaletteSelectedCell(part)?.atlas ?? this.activeTextureAtlasId;
    this.paletteGrid.querySelectorAll('button').forEach((button) => {
      button.style.outline = button.dataset.cellIndex === selectedCell && button.dataset.atlasId === selectedAtlas
        ? '2px solid #ffe39d'
        : 'none';
    });
  }

  _getTextureTargets(part) {
    if (!part) return ['all'];
    return ['all', ...(FACE_TEXTURE_SLOTS[part.type] ?? [])];
  }

  _ensureTextureTarget(part) {
    const targets = this._getTextureTargets(part);
    if (!targets.includes(this.textureTarget)) {
      this.textureTarget = 'all';
    }
  }

  _getPaletteSelectedCell(part) {
    if (!part) return null;
    if (this.textureTarget === 'all') return part.texture ?? null;
    if (Object.prototype.hasOwnProperty.call(part.faceTextures ?? {}, this.textureTarget)) {
      return part.faceTextures[this.textureTarget];
    }
    return null;
  }

  _getEffectiveTextureCell(part, slot) {
    if (!part) return null;
    if (Object.prototype.hasOwnProperty.call(part.faceTextures ?? {}, slot)) {
      return part.faceTextures[slot];
    }
    return part.texture ?? null;
  }

  _getTextureRefForActiveTarget(part) {
    if (!part) return null;
    if (this.textureTarget === 'all') return part.texture ?? null;
    return this._getEffectiveTextureCell(part, this.textureTarget);
  }

  _syncActiveAtlasToSelectedTexture(part) {
    const textureRef = this._getTextureRefForActiveTarget(part);
    const atlasId = textureRef?.atlas ?? DEFAULT_TEXTURE_ATLAS;
    if (!this.textureAtlases.some((atlas) => atlas.id === atlasId)) return;
    if (this.activeTextureAtlasId === atlasId) return;
    this.activeTextureAtlasId = atlasId;
    this._renderPalette();
  }

  _getTextureCellInputValue(part) {
    const ref = this._getPaletteSelectedCell(part);
    if (!ref) return '';
    return ref.cell ?? '';
  }

  _setTextureCellValue(part, value) {
    const maxCell = (this._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1;
    const clampedValue = Number.isFinite(value) ? clamp(Math.round(value), 0, maxCell) : null;
    const atlasId = this.activeTextureAtlasId;
    const ref = clampedValue == null ? null : { atlas: atlasId, cell: clampedValue };

    if (this.textureTarget === 'all') {
      part.texture = {
        ...part.texture,
        atlas: atlasId,
        cell: clampedValue ?? 0,
      };
      return;
    }

    part.faceTextures ||= {};
    if (clampedValue == null) {
      delete part.faceTextures[this.textureTarget];
      return;
    }
    part.faceTextures[this.textureTarget] = ref;
  }

  _syncTextureTargetButtons(part) {
    this.textureTargetBar.innerHTML = '';
    const targets = this._getTextureTargets(part);

    targets.forEach((target) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = target === 'all' ? 'All' : titleCase(target);
      Object.assign(button.style, {
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.12)',
        background: this.textureTarget === target ? '#6d4f2a' : 'rgba(255,255,255,0.06)',
        color: '#fff4e8',
        cursor: part ? 'pointer' : 'default',
        fontFamily: 'inherit',
        fontSize: '11px',
        opacity: part ? '1' : '0.45',
      });
      button.disabled = !part;
      button.addEventListener('click', () => {
        this.textureTarget = target;
        this._syncForm();
      });
      this.textureTargetBar.appendChild(button);
    });

    if (!part) {
      this.textureTargetHint.textContent = 'Select a part to choose shared or per-face textures.';
      return;
    }

    if (this.textureTarget === 'all') {
      this.textureTargetHint.textContent = `All faces inherit atlas ${part.texture.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${part.texture.cell ?? 'none'} unless a face override is set.`;
      return;
    }

    const override = Object.prototype.hasOwnProperty.call(part.faceTextures ?? {}, this.textureTarget)
      ? part.faceTextures[this.textureTarget]
      : null;
    const effective = this._getEffectiveTextureCell(part, this.textureTarget);
    this.textureTargetHint.textContent = override == null
      ? `${titleCase(this.textureTarget)} inherits atlas ${effective?.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${effective?.cell ?? 'none'}. Clear stays on inherit.`
      : `${titleCase(this.textureTarget)} overrides to atlas ${override.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${override.cell ?? 'none'}. Clear to return to shared atlas ${part.texture.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${part.texture.cell ?? 'none'}.`;
  }

  _newPrefab() {
    const prefab = normalizePrefab({
      id: createPrefabId(),
      name: `Prefab ${this.library.prefabs.length + 1}`,
      size: { x: 1, y: 1, z: 1 },
      primitives: [],
    });
    this.library.prefabs.push(prefab);
    this.prefabId = prefab.id;
    this.selectedPartId = null;
    this._syncForm();
    this._rebuildScene();
    this._setStatus(`Created ${prefab.name}.`);
  }

  _clonePrefab() {
    const prefab = this._selectedPrefab();
    if (!prefab) return;
    const clone = normalizePrefab({
      ...deepClone(prefab),
      id: createPrefabId(),
      name: `${prefab.name} Copy`,
    });
    clone.primitives = clone.primitives.map((part) => normalizePrefabPrimitive({
      ...part,
      id: createPrefabPartId(),
    }));
    this.library.prefabs.push(clone);
    this.prefabId = clone.id;
    this.selectedPartId = clone.primitives[0]?.id ?? null;
    this._syncForm();
    this._rebuildScene();
    this._setStatus(`Cloned ${prefab.name}.`);
  }

  _deletePrefab() {
    if (!this.prefabId) return;
    const prefab = this._selectedPrefab();
    this.library.prefabs = this.library.prefabs.filter((entry) => entry.id !== this.prefabId);
    if (!this.library.prefabs.length) {
      this.library.prefabs.push(normalizePrefab({ id: createPrefabId(), name: 'Prefab 1' }));
    }
    this.prefabId = this.library.prefabs[0]?.id ?? null;
    this.selectedPartId = this._selectedPrefab()?.primitives[0]?.id ?? null;
    this._syncForm();
    this._rebuildScene();
    this._setStatus(`Deleted ${prefab?.name ?? 'prefab'}.`);
  }

  _addPart(type) {
    const prefab = this._selectedPrefab();
    if (!prefab) return;
    const primitive = createLocalPrimitive(type, this.grid);
    prefab.primitives.push(primitive);
    this.selectedPartId = primitive.id;
    this._syncForm();
    this._rebuildScene();
    this._setStatus(`Added ${primitive.name}.`);
  }

  _duplicatePart() {
    const prefab = this._selectedPrefab();
    const part = this._selectedPart();
    if (!prefab || !part) return;
    const copy = normalizePrefabPrimitive({
      ...deepClone(part),
      id: createPrefabPartId(),
      name: `${part.name}-copy`,
      position: {
        x: part.position.x + this.grid.cellWidth,
        y: part.position.y,
        z: part.position.z,
      },
    });
    this._applyPartSnap(copy, { snapScale: true });
    prefab.primitives.push(copy);
    this.selectedPartId = copy.id;
    this._syncForm();
    this._rebuildScene();
    this._setStatus(`Duplicated ${part.name}.`);
  }

  _deletePart() {
    const prefab = this._selectedPrefab();
    const part = this._selectedPart();
    if (!prefab || !part) return;
    prefab.primitives = prefab.primitives.filter((entry) => entry.id !== part.id);
    this.selectedPartId = prefab.primitives[0]?.id ?? null;
    this._syncForm();
    this._rebuildScene();
    this._setStatus(`Deleted ${part.name}.`);
  }

  async _generatePrefabFromPrompt() {
    const prompt = this.aiPromptInput?.value?.trim();
    if (!prompt) {
      this._setStatus('Enter a prompt first.', true);
      return;
    }

    const apiKey = this.aiKeyInput?.value?.trim() || getStoredString('mouse-trouble.openrouter.key', '');
    if (!apiKey) {
      this._setStatus('Add an OpenRouter API key first.', true);
      return;
    }

    setStoredString('mouse-trouble.openrouter.key', apiKey);
    this.aiNote.textContent = `Generating "${prompt}"...`;

    try {
      const prefab = await generatePrefabFromPrompt({
        prompt,
        apiKey,
        textureAtlases: this.textureAtlases,
      });

      if (!prefab.primitives.length) {
        throw new Error('Model returned no primitives.');
      }

      this.library.prefabs.push(prefab);
      this.prefabId = prefab.id;
      this.selectedPartId = prefab.primitives[0]?.id ?? null;
      this._syncPrefabOptions();
      this._syncForm();
      this._rebuildScene();
      this.aiNote.textContent = `Generated "${prefab.name}" with ${prefab.primitives.length} parts.`;
      this._setStatus(`Generated ${prefab.name}.`);
    } catch (error) {
      this.aiNote.textContent = `Generation failed: ${error.message}`;
      this._setStatus(`AI generation failed: ${error.message}`, true);
    }
  }

  _setTransformMode(mode) {
    this.transformControls.setMode(mode);
    this._setStatus(`Transform mode: ${mode}`);
  }

  _applyPartSnap(part, { snapScale = false, snapPosition = false } = {}) {
    if (!part) return;

    if (snapScale) {
      const minSize = this.grid.verticalStep;
      if (part.type === 'plane') {
        part.scale.x = Math.max(minSize, Math.round(part.scale.x / this.grid.verticalStep) * this.grid.verticalStep);
        part.scale.y = Math.max(minSize, Math.round(part.scale.y / this.grid.verticalStep) * this.grid.verticalStep);
      } else {
        part.scale.x = Math.max(minSize, Math.round(part.scale.x / this.grid.verticalStep) * this.grid.verticalStep);
        part.scale.z = Math.max(minSize, Math.round(part.scale.z / this.grid.verticalStep) * this.grid.verticalStep);
        part.scale.y = Math.max(minSize, Math.round(part.scale.y / this.grid.verticalStep) * this.grid.verticalStep);
      }
    }

    if (snapPosition) {
      part.position.x = Math.round(part.position.x / this.grid.cellWidth) * this.grid.cellWidth;
      part.position.z = Math.round(part.position.z / this.grid.cellDepth) * this.grid.cellDepth;
      part.position.y = Math.round(part.position.y / this.grid.verticalStep) * this.grid.verticalStep;
    }

    part.position.x = Number(part.position.x.toFixed(4));
    part.position.y = Number(part.position.y.toFixed(4));
    part.position.z = Number(part.position.z.toFixed(4));
    part.scale.x = Number(part.scale.x.toFixed(4));
    part.scale.y = Number(part.scale.y.toFixed(4));
    part.scale.z = Number(part.scale.z.toFixed(4));
  }

  _createMaterial(part) {
    const createMaterial = (textureRef, side = THREE.FrontSide) => {
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.material.color),
        roughness: part.material.roughness,
        metalness: part.material.metalness,
      });
      material.dithering = true;
      material.side = side;

      if (textureRef && Number.isFinite(textureRef.cell)) {
        const map = this.room._createAtlasTexture?.(
          textureRef.cell,
          textureRef.atlas ?? DEFAULT_TEXTURE_ATLAS,
          part.type === 'prop' ? part.chroma : null,
        );
        if (map) {
          material.map = map.clone();
          material.map.repeat.set(part.texture.repeat.x, part.texture.repeat.y);
          material.map.offset.set(part.texture.offset?.x ?? 0, part.texture.offset?.y ?? 0);
          material.map.rotation = part.texture.rotation ?? 0;
          material.map.center.set(0.5, 0.5);
          material.map.needsUpdate = true;
          material.addEventListener('dispose', () => material.map?.dispose?.());
        }
        material.userData.textureAtlas = textureRef.atlas ?? DEFAULT_TEXTURE_ATLAS;
        material.userData.textureCell = textureRef.cell;
      }

      return material;
    };

    const faceSlots = FACE_TEXTURE_SLOTS[part.type] ?? [];
    if (faceSlots.length > 0) {
      return faceSlots.map((slot) => createMaterial(this._getEffectiveTextureCell(part, slot)));
    }

    return createMaterial(part.texture, part.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide);
  }

  _rebuildGrid() {
    this.gridRoot.clear();
    const prefab = this._selectedPrefab();
    if (!prefab) return;

    const width = prefab.size.x * this.grid.cellWidth;
    const depth = prefab.size.z * this.grid.cellDepth;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({
        color: '#d9c2a1',
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = 0;
    this.gridRoot.add(floor);

    const gridSize = Math.max(width, depth);
    const divisions = Math.max(prefab.size.x, prefab.size.z);
    const gridHelper = new THREE.GridHelper(gridSize, divisions, '#ffe39d', '#7c6f61');
    gridHelper.position.y = 0.001;
    this.gridRoot.add(gridHelper);

    const bounds = new THREE.Box3(
      new THREE.Vector3(-width * 0.5, 0, -depth * 0.5),
      new THREE.Vector3(width * 0.5, prefab.size.y * this.grid.verticalStep, depth * 0.5),
    );
    const boxHelper = new THREE.Box3Helper(bounds, new THREE.Color('#9ed7ff'));
    this.gridRoot.add(boxHelper);
  }

  _rebuildScene() {
    this.partsRoot.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
    this.partsRoot.clear();
    this.meshes.clear();
    this._rebuildGrid();

    const prefab = this._selectedPrefab();
    if (!prefab) return;

    prefab.primitives.forEach((part) => {
      const mesh = new THREE.Mesh(createPrimitiveGeometry(part.type), this._createMaterial(part));
      mesh.name = part.name;
      mesh.position.set(part.position.x, part.position.y, part.position.z);
      mesh.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
      mesh.scale.set(part.scale.x, part.scale.y, part.scale.z);
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = part.receiveShadow;
      mesh.userData.prefabPartId = part.id;
      this.partsRoot.add(mesh);
      this.meshes.set(part.id, mesh);
    });

    this._attachTransformControls();
  }

  _attachTransformControls() {
    const mesh = this.meshes.get(this.selectedPartId);
    if (!mesh) {
      this.transformControls.detach();
      return;
    }
    this.transformControls.attach(mesh);
  }

  _onTransformObjectChange() {
    if (this._suppressTransformSync) return;
    const mesh = this.transformControls.object;
    const part = this._selectedPart();
    if (!mesh || !part) return;

    part.position = {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    };
    part.rotation = {
      x: mesh.rotation.x,
      y: mesh.rotation.y,
      z: mesh.rotation.z,
    };
    part.scale = {
      x: mesh.scale.x,
      y: mesh.scale.y,
      z: mesh.scale.z,
    };
    this._applyPartSnap(part, { snapScale: true });

    this._suppressTransformSync = true;
    mesh.position.set(part.position.x, part.position.y, part.position.z);
    mesh.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
    mesh.scale.set(part.scale.x, part.scale.y, part.scale.z);
    this._suppressTransformSync = false;
    this._syncForm();
  }

  async _saveLibrary() {
    const payload = normalizePrefabLibrary(this.library);
    const result = await this.onSaveLibrary?.(payload);
    if (result?.ok === false) {
      this._setStatus(`Save failed: ${result.error || 'Unknown error'}`, true);
      return;
    }
    this._setStatus('Saved /levels/prefabs.json');
    return payload;
  }

  _resizeRenderer() {
    const rect = this.viewportWrap.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width - 40));
    const height = Math.max(1, Math.floor(rect.height - 40));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _startLoop() {
    if (this._raf) return;
    const tick = () => {
      if (this.overlay.style.display === 'none') {
        this._raf = 0;
        return;
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  _setStatus(message, isError = false) {
    this.status.textContent = message;
    this.status.style.color = isError ? '#ffb089' : '#9ee8b2';
  }
}
