import * as THREE from 'three';
import { PrefabEditorDialog } from './PrefabEditorDialog.js';
import { VegetationEditorDialog } from './VegetationEditorDialog.js';
import { DEFAULT_PREFAB_LIBRARY, FACE_TEXTURE_SLOTS, normalizePrefabLibrary } from './prefabRegistry.js';
import { DEFAULT_VEGETATION_LIBRARY, normalizeVegetationLibrary } from './vegetationRegistry.js';
import { clamp, createAtlasButtonStyle, deepClone, titleCase } from './editorShared.js';
import {
  createDefaultPrimitive,
  createDefaultLight,
  createDefaultPortal,
  createDefaultRope,
  createDefaultFan,
  createDefaultExtractionPortal,
  createDefaultRaidTask,
  createPrimitiveId,
  createPortalId,
  createRopeId,
  createExtractionPortalId,
  createRaidTaskId,
  createSpawnMarkerPrimitive,
  loadPrefabLibraryFromAsset,
  createDefaultVegetation,
  loadVegetationLibraryFromAsset,
} from './buildModeSupport.js';
import {
  styleField,
  addActionButton,
  addInlineButton,
  createSection,
  createVectorInputs,
  createVector2Inputs,
  createNumberField,
  createRangeField,
  createCheckbox,
} from './ui/fields.js';
import { installSelectionSection } from './sections/selection.js';
import { installTransformSection } from './sections/transform.js';
import { installMaterialSection } from './sections/material.js';
import { installLightSection } from './sections/light.js';
import { installPortalSection } from './sections/portal.js';
import { installPrefabSection } from './sections/prefab.js';
import { installPaletteSection } from './sections/palette.js';
import { installGlbSection } from './sections/glb.js';
import { installRopeSection } from './sections/rope.js';
import { installFanSection } from './sections/fan.js';
import { installExtractionSection } from './sections/extraction.js';
import { installRaidTaskSection } from './sections/raidTask.js';
import { installVegetationSection } from './sections/vegetation.js';
import { installOrbitControls } from './subsystems/orbitControls.js';
import {
  installProbeVisuals,
  updateProbe,
  hideProbe,
  resolveEditableHitObject,
  editableIdFromObject,
} from './subsystems/probeVisuals.js';
import { bindCanvasEvents } from './subsystems/canvasInput.js';
import { installBuildCamera } from './subsystems/buildCamera.js';
import { installBisectPlaneTool } from './subsystems/bisectPlaneTool.js';
import { installObjectTree } from './subsystems/objectTree.js';
import { installSelectionHighlight } from './subsystems/selectionHighlight.js';
import {
  installTransformControls,
  attachTransformControls,
  setTransformMode,
} from './subsystems/transformGizmo.js';
import { DEFAULT_TEXTURE_ATLAS, loadTextureAtlases, TEXTURE_ATLASES } from './textureAtlasRegistry.js';
import { assetUrl } from '../utils/assetUrl.js';
import { SPAWN_TYPES, normalizeSpawnType } from '../../shared/spawnPoints.js';
import { NAV_AREA_TYPES, normalizeNavArea } from '../../shared/navConfig.js';
import { DEFAULT_ROPE_CARD_OPACITY, DEFAULT_ROPE_CARD_WIDTH, DEFAULT_ROPE_COLOR } from '../../shared/ropes.js';
import { VIBE_PORTAL_TYPES, normalizeVibePortalType } from '../../shared/vibePortal.js';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const SNAP_SIZE_OPTIONS = Object.freeze([2, 1, 0.5, 0.25, 0.1]);

class BuildModeEditor {
  constructor(app, textureAtlases, prefabLibrary, vegetationLibrary, OrbitControls, TransformControls) {
    this.app = app;
    this.textureAtlases = textureAtlases;
    this.activeTextureAtlasId = textureAtlases[0]?.id ?? TEXTURE_ATLASES[0].id;
    this.OrbitControls = OrbitControls;
    this.TransformControls = TransformControls;
    this.prefabLibrary = normalizePrefabLibrary(prefabLibrary ?? DEFAULT_PREFAB_LIBRARY);
    this.vegetationLibrary = normalizeVegetationLibrary(vegetationLibrary ?? DEFAULT_VEGETATION_LIBRARY);
    this.layout = app.room.getEditableLayout();
    this.activeRaidTaskVisualTarget = 'marker';
    this.activeRaidTaskVisualPreview = 'auto';
    this.selectedId = this.layout.primitives[0]?.id
      ?? this.layout.vegetation?.[0]?.id
      ?? this.layout.fans?.[0]?.id
      ?? this.layout.lights?.[0]?.id
      ?? this.layout.portals?.[0]?.id
      ?? this.layout.ropes?.[0]?.id
      ?? this.layout.extractionPortals?.[0]?.id
      ?? this.layout.raidTasks?.[0]?.id
      ?? null;
    this.visible = false;
    this.statusTimer = null;
    this.pointerNdc = new THREE.Vector2();
    this.pointerScreen = { x: 0, y: 0 };
    this.pointerInsideCanvas = false;
    this.raycaster = new THREE.Raycaster();
    this.currentHit = null;
    this.currentEditableHit = null;
    this._suppressTransformSync = false;
    this.transformMode = 'translate';
    this.cameraMode = 'follow';
    this.freeCameraKeys = new Set();
    this.freeCameraMoveSpeed = 8;
    this.freeCameraBoostMultiplier = 2.5;
    this._restoreStaticMergeOnExit = null;
    this.activeTool = null;
    this.bisectState = null;
    this.objectTreeQuery = '';
    this.selectionHighlightBindings = [];
    this.selectionHighlightTarget = null;
    this.glbRegistry = null;
    this._glbFileInput = null;
    this.textureTarget = 'all';

    installBuildCamera(this);
    installBisectPlaneTool(this);
    installObjectTree(this);
    installSelectionHighlight(this);
    this._createUI();
    this._createProbeVisuals();
    this._createSelectionHighlight();
    this._createOrbitControls();
    this._createTransformControls();
    this._bindCanvasEvents();
    this._bindHotkeys();
    this._createPrefabEditorDialog();
    this._createVegetationEditorDialog();
    this._renderPalette();
    this._refreshList();
    this._syncForm();
    void this._loadGlbRegistry();
  }

  isActive() {
    return this.visible;
  }

  _activeTextureAtlas() {
    return this.textureAtlases.find((atlas) => atlas.id === this.activeTextureAtlasId) ?? this.textureAtlases[0] ?? TEXTURE_ATLASES[0];
  }

  toggle() {
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
    if (this.objectTreePanel) {
      this.objectTreePanel.style.display = this.visible ? 'block' : 'none';
    }
    this.app.room.setSpawnMarkersVisible(this.visible);
    this.app.room.setLightHelpersVisible(this.visible);
    this.app.room.setPortalHelpersVisible(this.visible);
    this.app.room.setExtractionHelpersVisible?.(this.visible);
    this.app.room.setHotSurfaceHelpersVisible?.(this.visible);
    // Raid task helpers double as gameplay markers — keep them on.
    this.app.room.setRaidTaskHelpersVisible?.(true);
    this.app.room.setRopeHelpersVisible?.(this.visible);
    if (this.visible) {
      this._restoreStaticMergeOnExit = this.app.room.isStaticMergeEnabled?.() ?? null;
      if (this._restoreStaticMergeOnExit) {
        this.app.room.setStaticMergeEnabled(false);
      }
      this.app.thirdPersonCamera?.setEnabled(false);
      this._enterBuildCameraMode();
      this.controls.enabled = true;
      this.controls.update();
      this.transformControls.enabled = true;
      this._attachTransformControls();
      document.exitPointerLock?.();
    } else {
      this.controls.enabled = false;
      this.transformControls.enabled = false;
      this.transformControls.detach();
      this._hideProbe();
      this._cancelBisectPlaneTool({ silent: true });
      this._clearSelectionHighlight();
      this.freeCameraKeys.clear();
      if (this._restoreStaticMergeOnExit != null) {
        this.app.room.setStaticMergeEnabled(this._restoreStaticMergeOnExit);
        this._restoreStaticMergeOnExit = null;
      }
      this.app.thirdPersonCamera?.syncFromCamera(this.app.mouse.position);
      this.app.thirdPersonCamera?.setEnabled(true);
    }
  }

  update(deltaSeconds = 1 / 60) {
    if (!this.visible) return;

    this._updateBuildCamera(deltaSeconds);
    this.controls.update();
    this.app.thirdPersonCamera?.syncFromCamera(this.app.mouse.position);
    this._updateProbe();
    this._updateBisectPreview();
    this._updateSelectionHighlight();
  }

  _createUI() {
    this._createObjectTreePanel();

    this.panel = document.createElement('aside');
    Object.assign(this.panel.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      width: '360px',
      maxHeight: 'calc(100vh - 40px)',
      overflowY: 'auto',
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
    title.textContent = 'BUILD MODE';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      color: '#ffd7a4',
      marginBottom: '6px',
    });
    this.panel.appendChild(title);

    const note = document.createElement('div');
    note.textContent = 'DEV ONLY. B toggles this panel.';
    Object.assign(note.style, {
      color: '#d8c3a8',
      marginBottom: '12px',
      fontSize: '11px',
    });
    this.panel.appendChild(note);

    this.gridNote = document.createElement('div');
    Object.assign(this.gridNote.style, {
      color: '#9ee8b2',
      fontSize: '11px',
    });
    this.panel.appendChild(this.gridNote);

    const gridControls = document.createElement('label');
    gridControls.textContent = 'Snap Size';
    Object.assign(gridControls.style, {
      display: 'grid',
      gap: '4px',
      color: '#d7c5a7',
      marginTop: '8px',
      marginBottom: '12px',
      fontSize: '11px',
    });
    this.gridSizeSelect = document.createElement('select');
    this._styleField(this.gridSizeSelect);
    SNAP_SIZE_OPTIONS.forEach((size) => {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = size.toFixed(size < 1 ? (size < 0.2 ? 1 : 2) : 0);
      this.gridSizeSelect.appendChild(option);
    });
    const grid = this.app.room.getBuildGridConfig();
    this.gridSizeSelect.value = String(grid.cellWidth);
    this.gridSizeSelect.addEventListener('change', () => {
      const nextGrid = this.app.room.setBuildGridSnapSize(Number(this.gridSizeSelect.value));
      this._updateGridNote(nextGrid);
    });
    gridControls.appendChild(this.gridSizeSelect);
    this.panel.appendChild(gridControls);
    this._updateGridNote(grid);

    this.actions = document.createElement('div');
    Object.assign(this.actions.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '8px',
      marginBottom: '12px',
    });
    this.panel.appendChild(this.actions);

    this._addActionButton('Add Box', () => this._addPrimitive('box'));
    this._addActionButton('Add Plane', () => this._addPrimitive('plane'));
    this.bisectPlaneButton = this._addActionButton('Bisect Plane', () => this._toggleBisectPlaneTool(), '#3a2a45');
    this._addActionButton('Add Cyl', () => this._addPrimitive('cylinder'));
    this._addActionButton('Add Wedge', () => this._addPrimitive('wedge'));
    this._addActionButton('Add Prop', () => this._addPrimitive('prop'), '#284423');
    this._addActionButton('Player Spawn', () => this._addSpawnMarker(SPAWN_TYPES.PLAYER), '#1b4450');
    this._addActionButton('Enemy Spawn', () => this._addSpawnMarker(SPAWN_TYPES.ENEMY), '#5a2b1f');
    this._addActionButton('Human Spawn', () => this._addSpawnMarker(SPAWN_TYPES.HUMAN), '#5a4c20');
    this._addActionButton('Roomba Base', () => this._addSpawnMarker(SPAWN_TYPES.ROOMBA), '#303b43');
    this._addActionButton('Point Light', () => this._addLight('point'), '#5a4120');
    this._addActionButton('Spot Light', () => this._addLight('spot'), '#5a3a20');
    this._addActionButton('Sun Light', () => this._addLight('directional'), '#5a4c20');
    this._addActionButton('Vibe Portal', () => this._addPortal(VIBE_PORTAL_TYPES.EXIT), '#125341');
    this._addActionButton('Return Portal', () => this._addPortal(VIBE_PORTAL_TYPES.RETURN), '#5b241c');
    this._addActionButton('Rope', () => this._addRope(), '#5e4322');
    this._addActionButton('Ceiling Fan', () => this._addFan(), '#4a3b24');
    this._addActionButton('Extract hole', () => this._addExtractionPortal(), '#1a4d42');
    this._addActionButton('Task marker', () => this._addRaidTask(), '#4d3a1a');
    this._addActionButton('Hot Surface', () => this._addHotSurface(), '#6a1f1f');
    this._addActionButton('Move', () => this._setTransformMode('translate'));
    this._addActionButton('Rotate', () => this._setTransformMode('rotate'));
    this._addActionButton('Scale', () => this._setTransformMode('scale'));
    this.freeCameraButton = this._addActionButton('Free Cam: Off', () => this._toggleFreeCameraMode(), '#243742');
    this._addActionButton('Duplicate', () => this._duplicateSelected());
    this._addActionButton('Delete', () => this._deleteSelected(), '#5d221f');
    this._addActionButton('Save', () => this.save(), '#23472d');
    this._addActionButton('Export', () => this.exportBackup());

    this._createSelectionSection();
    this._createTransformSection();
    this._createMaterialSection();
    this._createLightSection();
    this._createPortalSection();
    this._createRopeSection();
    this._createFanSection();
    this._createExtractionSection();
    this._createRaidTaskSection();
    this._createPrefabSection();
    this._createVegetationSection();
    this._createGlbSection();
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

    document.body.appendChild(this.panel);
  }

  _updateGridNote(grid = this.app.room.getBuildGridConfig()) {
    if (!this.gridNote) return;
    this.gridNote.textContent = `Grid: ${grid.columns}x${grid.rows} | cell ${grid.cellWidth.toFixed(3)} x ${grid.cellDepth.toFixed(3)} | y step ${grid.verticalStep.toFixed(3)}`;
  }

  _createOrbitControls() {
    installOrbitControls(this);
  }

  _createProbeVisuals() {
    installProbeVisuals(this);
  }

  _bindHotkeys() {
    window.addEventListener('keydown', (event) => {
      if (!this.visible) return;
      if (this._handleFreeCameraKeyDown(event)) return;
      if (event.key === 'Escape' && this.activeTool === 'bisect-plane') {
        event.preventDefault();
        this._cancelBisectPlaneTool();
      }
    });
    window.addEventListener('keyup', (event) => {
      this._handleFreeCameraKeyUp(event);
    });
  }

  _createPrefabEditorDialog() {
    this.prefabEditor = new PrefabEditorDialog({
      room: this.app.room,
      textureAtlases: this.textureAtlases,
      OrbitControls: this.OrbitControls,
      TransformControls: this.TransformControls,
      onSaveLibrary: async (library) => {
        const result = await this._savePrefabLibrary(library);
        if (result?.ok) {
          this.prefabLibrary = normalizePrefabLibrary(library);
          this._syncPrefabSection();
        }
        return result;
      },
    });
  }

  _createVegetationEditorDialog() {
    this.vegetationEditor = new VegetationEditorDialog({
      room: this.app.room,
      textureAtlases: this.textureAtlases,
      OrbitControls: this.OrbitControls,
      getGlbAssets: () => this.glbRegistry?.assets ?? [],
      onUploadGlb: async ({ filename, buffer }) => {
        const response = await fetch(`/__dev/upload-glb?name=${encodeURIComponent(filename)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buffer,
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          return { ok: false, error: result.error || response.statusText };
        }
        this.app.room.glbRegistry = null;
        this.app.room.glbModelCache.delete(result.entry.id);
        await this.app.room.loadGlbModel(result.entry.id);
        await this._loadGlbRegistry();
        return result;
      },
      onSaveLibrary: async (library) => {
        const result = await this._saveVegetationLibrary(library);
        if (result?.ok) {
          this.vegetationLibrary = normalizeVegetationLibrary(library);
          await this.app.room.setVegetationLibrary(this.vegetationLibrary);
          this._syncVegetationSection();
        }
        return result;
      },
    });
  }

  _createTransformControls() {
    installTransformControls(this);
  }

  _bindCanvasEvents() {
    bindCanvasEvents(this);
  }

  _resolveEditableHitObject(object) {
    return resolveEditableHitObject(object);
  }

  _editableIdFromObject(object) {
    return editableIdFromObject(object);
  }

  _syncRopeTextureFromFields() {
    this._updateSelected((rope) => {
      const raw = this.ropeTextureCellInput?.value;
      const cell = raw === '' || raw == null ? NaN : Number(raw);
      if (!Number.isFinite(cell) || cell < 0) {
        rope.texture = null;
      } else {
        rope.texture = {
          atlas: this.ropeTextureAtlasSelect?.value ?? 'textures',
          cell: Math.round(cell),
        };
      }
    }, { snapPosition: false, snapScale: false });
  }

  _updateProbe() {
    updateProbe(this);
  }

  _hideProbe() {
    hideProbe(this);
  }

  _setTransformMode(mode) {
    setTransformMode(this, mode);
  }

  _attachTransformControls() {
    attachTransformControls(this);
  }


  _createSelectionSection() {
    installSelectionSection(this);
  }

  _createTransformSection() {
    installTransformSection(this);
  }

  _createMaterialSection() {
    installMaterialSection(this);
  }

  _createLightSection() {
    installLightSection(this);
  }

  _createPortalSection() {
    installPortalSection(this);
  }

  _createRopeSection() {
    installRopeSection(this);
  }

  _createFanSection() {
    installFanSection(this);
  }

  _createExtractionSection() {
    installExtractionSection(this);
  }

  _createRaidTaskSection() {
    installRaidTaskSection(this);
  }

  _createPrefabSection() {
    installPrefabSection(this);
  }

  _createVegetationSection() {
    installVegetationSection(this);
  }

  _createPaletteSection() {
    installPaletteSection(this);
  }

  _createGlbSection() {
    installGlbSection(this);
  }

  async _loadGlbRegistry() {
    try {
      const response = await fetch(assetUrl('levels/glb-registry.json'), { cache: 'no-store' });
      if (!response.ok) {
        this.glbRegistry = { assets: [] };
      } else {
        this.glbRegistry = await response.json();
      }
    } catch {
      this.glbRegistry = { assets: [] };
    }
    this._syncGlbSection();
  }

  _syncGlbSection() {
    if (!this.glbSelect) return;
    const currentValue = this.glbSelect.value;
    this.glbSelect.innerHTML = '';
    const assets = this.glbRegistry?.assets ?? [];
    if (!assets.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No GLB models uploaded';
      this.glbSelect.appendChild(option);
    } else {
      assets.forEach((asset) => {
        const option = document.createElement('option');
        option.value = asset.id;
        option.textContent = `${asset.name} (${(asset.size / 1024).toFixed(0)} KB)`;
        this.glbSelect.appendChild(option);
      });
      if (currentValue && assets.some((a) => a.id === currentValue)) {
        this.glbSelect.value = currentValue;
      }
    }

    const selected = this._selectedGlbAsset();
    if (this.glbStatus) {
      if (!selected) {
        this.glbStatus.textContent = 'Upload a .glb file to add custom models.';
      } else {
        this.glbStatus.textContent = [
          `File: ${selected.filename}`,
          `Size: ${(selected.size / 1024).toFixed(0)} KB`,
          `Uploaded: ${selected.uploadedAt ? new Date(selected.uploadedAt).toLocaleString() : 'unknown'}`,
        ].join('\n');
      }
    }
  }

  _selectedGlbAsset() {
    const id = this.glbSelect?.value;
    if (!id) return null;
    return (this.glbRegistry?.assets ?? []).find((a) => a.id === id) ?? null;
  }

  async _handleGlbUpload() {
    const file = this._glbFileInput?.files?.[0];
    if (!file) return;
    this._setStatus(`Uploading ${file.name}...`);

    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch(`/__dev/upload-glb?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        this._setStatus(`Upload failed: ${result.error || response.statusText}`, true);
        return;
      }

      this.app.room.glbRegistry = null;
      const preloaded = await this.app.room.loadGlbModel(result.entry.id);
      if (!preloaded) {
        this._setStatus(`Uploaded ${result.entry.name} but model preload failed.`, true);
      } else {
        this._setStatus(`Uploaded ${result.entry.name}.`);
      }
    } catch (err) {
      this._setStatus(`Upload error: ${err.message}`, true);
    }

    await this._loadGlbRegistry();
    this._glbFileInput.value = '';
  }

  async _placeSelectedGlb() {
    const asset = this._selectedGlbAsset();
    if (!asset) return;
    this._setStatus(`Loading ${asset.name}...`);

    const model = await this.app.room.loadGlbModel(asset.id);
    if (!model) {
      this._setStatus(`Failed to load GLB: ${asset.name}`, true);
      return;
    }

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const autoScale = 1 / maxDim;

    const grid = this.app.room.getBuildGridConfig();
    const forward = new THREE.Vector3();
    this.app.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const spawn = this.app.mouse.position.clone().add(forward.multiplyScalar(2.25));
    spawn.y = Math.max(this.app.mouse.position.y, 0);

    const primitive = {
      id: createPrimitiveId(),
      name: asset.name,
      type: 'glb',
      glbAssetId: asset.id,
      position: {
        x: Number(spawn.x.toFixed(4)),
        y: Number(spawn.y.toFixed(4)),
        z: Number(spawn.z.toFixed(4)),
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: autoScale, y: autoScale, z: autoScale },
      texture: {
        atlas: 'textures',
        cell: null,
        repeat: { x: 1, y: 1 },
        rotation: 0,
        offset: { x: 0, y: 0 },
      },
      material: { color: '#ffffff', roughness: 0.88, metalness: 0.04 },
      collider: true,
      colliderClearance: 0,
      castShadow: true,
      receiveShadow: true,
    };

    this.app.room.upsertEditablePrimitive(primitive);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = primitive.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Placed ${asset.name} (auto-scaled ${autoScale.toFixed(3)}x).`);
  }

  async _deleteSelectedGlb() {
    const asset = this._selectedGlbAsset();
    if (!asset) return;
    this.glbRegistry.assets = this.glbRegistry.assets.filter((a) => a.id !== asset.id);
    try {
      await fetch('/__dev/save-glb-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.glbRegistry),
      });
    } catch {}
    this.app.room.glbRegistry = null;
    this._syncGlbSection();
    this._setStatus(`Removed ${asset.name} from registry. File still on disk.`);
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
        this.textureCellInput.value = String(cell.index);
        this._updateSelected((primitive) => {
          primitive.texture.atlas = activeAtlas.id;
          primitive.texture.cell = cell.index;
        });
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
        this._renderPalette();
        this._syncForm();
      });
      this.textureAtlasTabs.appendChild(button);
    });
  }

  _addActionButton(label, onClick, background = '#2f2c28') {
    return addActionButton(this.actions, label, onClick, background);
  }

  _addInlineButton(parent, label, onClick, background = '#2f2c28') {
    return addInlineButton(parent, label, onClick, background);
  }

  _createSection(title) {
    return createSection(this.panel, title);
  }

  _createVectorInputs(parent, label, attrs, onChange) {
    return createVectorInputs(parent, label, attrs, onChange);
  }

  _createVector2Inputs(parent, label, attrs, onChange) {
    return createVector2Inputs(parent, label, attrs, onChange);
  }

  _createNumberField(parent, label, attrs, onChange) {
    return createNumberField(parent, label, attrs, onChange, { topLevel: parent === this.panel });
  }

  _createRangeField(parent, label, min, max, step, onChange) {
    return createRangeField(parent, label, min, max, step, onChange);
  }

  _createCheckbox(label, parent, onChange) {
    return createCheckbox(label, parent, onChange);
  }

  _styleField(field) {
    styleField(field);
  }

  _selectedPrimitive() {
    return this._editorPrimitives().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _getTextureTargets(primitive) {
    if (!primitive) return ['all'];
    return ['all', ...(FACE_TEXTURE_SLOTS[primitive.type] ?? [])];
  }

  _ensureTextureTarget(primitive) {
    const targets = this._getTextureTargets(primitive);
    if (!targets.includes(this.textureTarget)) {
      this.textureTarget = 'all';
    }
  }

  _getPaletteSelectedTextureRef(primitive) {
    if (!primitive) return null;
    if (this.textureTarget === 'all') return primitive.texture ?? null;
    if (Object.prototype.hasOwnProperty.call(primitive.faceTextures ?? {}, this.textureTarget)) {
      return primitive.faceTextures[this.textureTarget];
    }
    return null;
  }

  _getEffectiveTextureRef(primitive, slot) {
    if (!primitive) return null;
    if (Object.prototype.hasOwnProperty.call(primitive.faceTextures ?? {}, slot)) {
      return primitive.faceTextures[slot];
    }
    return primitive.texture ?? null;
  }

  _getTextureCellInputValue(primitive) {
    const ref = this._getPaletteSelectedTextureRef(primitive);
    return ref?.cell ?? '';
  }

  _setTextureCellValue(primitive, value) {
    if (!primitive) return;
    const maxCell = (this._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1;
    const clampedValue = Number.isFinite(value) ? clamp(Math.round(value), 0, maxCell) : null;
    const atlasId = this.activeTextureAtlasId;

    if (this.textureTarget === 'all') {
      primitive.texture.atlas = atlasId;
      primitive.texture.cell = clampedValue;
      return;
    }

    primitive.faceTextures ||= {};
    if (clampedValue == null) {
      delete primitive.faceTextures[this.textureTarget];
      return;
    }
    primitive.faceTextures[this.textureTarget] = {
      atlas: atlasId,
      cell: clampedValue,
    };
  }

  _clearTextureOverride(primitive) {
    if (!primitive || this.textureTarget === 'all') return;
    if (!primitive.faceTextures) return;
    delete primitive.faceTextures[this.textureTarget];
  }

  _syncTextureTargetButtons(primitive) {
    if (!this.textureTargetWrap || !this.textureTargetBar || !this.textureTargetHint) return;

    const targets = this._getTextureTargets(primitive);
    const hasFaceTargets = !!primitive && targets.length > 1;
    this.textureTargetWrap.style.display = primitive ? 'grid' : 'none';
    this.textureTargetBar.innerHTML = '';

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
        cursor: primitive ? 'pointer' : 'default',
        fontFamily: 'inherit',
        fontSize: '11px',
        opacity: primitive ? '1' : '0.45',
      });
      button.disabled = !primitive;
      button.addEventListener('click', () => {
        this.textureTarget = target;
        this._syncForm();
      });
      this.textureTargetBar.appendChild(button);
    });

    if (this.clearTextureOverrideButton) {
      const hasOverride = primitive
        && this.textureTarget !== 'all'
        && Object.prototype.hasOwnProperty.call(primitive.faceTextures ?? {}, this.textureTarget);
      this.clearTextureOverrideButton.style.display = hasFaceTargets ? 'inline-flex' : 'none';
      this.clearTextureOverrideButton.disabled = !hasOverride;
    }

    if (!primitive) {
      this.textureTargetHint.textContent = 'Select a primitive to choose shared or per-face textures.';
      return;
    }

    if (!hasFaceTargets) {
      this.textureTargetHint.textContent = 'This primitive uses one shared texture for all faces.';
      return;
    }

    if (this.textureTarget === 'all') {
      this.textureTargetHint.textContent = `All faces inherit atlas ${primitive.texture.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${primitive.texture.cell ?? 'none'} unless a face override is set.`;
      return;
    }

    const override = Object.prototype.hasOwnProperty.call(primitive.faceTextures ?? {}, this.textureTarget)
      ? primitive.faceTextures[this.textureTarget]
      : null;
    const effective = this._getEffectiveTextureRef(primitive, this.textureTarget);
    this.textureTargetHint.textContent = override == null
      ? `${titleCase(this.textureTarget)} inherits atlas ${effective?.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${effective?.cell ?? 'none'}.`
      : `${titleCase(this.textureTarget)} overrides to atlas ${override.atlas ?? DEFAULT_TEXTURE_ATLAS}, cell ${override.cell ?? 'none'}.`;
  }

  _selectedLight() {
    return this._editorLights().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedPortal() {
    return this._editorPortals().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedRope() {
    return this._editorRopes().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedExtractionPortal() {
    return this._editorExtractionPortals().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedRaidTask() {
    return this._editorRaidTasks().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedFan() {
    return (this.layout.fans ?? []).find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedVegetation() {
    return this._editorVegetation().find((entry) => entry.id === this.selectedId) ?? null;
  }

  _selectedEntry() {
    return this._selectedPrimitive()
      ?? this._selectedLight()
      ?? this._selectedPortal()
      ?? this._selectedExtractionPortal()
      ?? this._selectedRaidTask()
      ?? this._selectedFan()
      ?? this._selectedVegetation()
      ?? this._selectedRope();
  }

  _entryTypeLabel(entry) {
    if (!entry) return 'object';
    if (entry.lightType) return `${entry.lightType} light`;
    if (entry.portalType) return `${normalizeVibePortalType(entry.portalType)} portal`;
    if (entry.segmentCount != null && entry.anchor) return 'rope';
    if (entry.taskType != null) return `task · ${entry.taskType}`;
    if (entry.speciesId) return `vegetation · ${entry.mode}`;
    if (entry.bladeCount != null && entry.spinSpeed != null) return 'ceiling fan';
    if (entry.radius != null && entry.portalType == null) return `extraction · r ${Number(entry.radius).toFixed(2)}`;
    const spawnLabel = this._spawnLabel(normalizeSpawnType(entry.spawnType));
    return spawnLabel || entry.type || 'object';
  }

  _entryOptionLabel(entry) {
    return `${entry.name} (${this._entryTypeLabel(entry)})`;
  }

  _spawnLabel(spawnType) {
    if (spawnType === SPAWN_TYPES.PLAYER) return 'player spawn';
    if (spawnType === SPAWN_TYPES.ENEMY) return 'enemy spawn';
    if (spawnType === SPAWN_TYPES.HUMAN) return 'human spawn';
    if (spawnType === SPAWN_TYPES.ROOMBA) return 'roomba base';
    return null;
  }

  _editorPrimitives() {
    return this.layout.primitives.filter((entry) => entry.deleted !== true);
  }

  _editorLights() {
    return (this.layout.lights ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorPortals() {
    return (this.layout.portals ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorRopes() {
    return (this.layout.ropes ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorFans() {
    return (this.layout.fans ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorExtractionPortals() {
    return (this.layout.extractionPortals ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorRaidTasks() {
    return (this.layout.raidTasks ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorVegetation() {
    return (this.layout.vegetation ?? []).filter((entry) => entry.deleted !== true);
  }

  _editorEntries() {
    return [
      ...this._editorPrimitives(),
      ...this._editorLights(),
      ...this._editorPortals(),
      ...this._editorRopes(),
      ...this._editorFans(),
      ...this._editorExtractionPortals(),
      ...this._editorRaidTasks(),
      ...this._editorVegetation(),
    ];
  }

  _refreshList() {
    this.layout = this.app.room.getEditableLayout();
    this.primitiveSelect.innerHTML = '';
    const editorEntries = this._editorEntries();
    if (!editorEntries.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No editable objects';
      this.primitiveSelect.appendChild(option);
      this.selectedId = null;
      return;
    }

    if (!editorEntries.some((entry) => entry.id === this.selectedId)) {
      this.selectedId = editorEntries[0].id;
    }

    editorEntries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = this._entryOptionLabel(entry);
      this.primitiveSelect.appendChild(option);
    });
    this.primitiveSelect.value = this.selectedId;
    this._attachTransformControls();
  }

  _syncForm() {
    this._refreshList();
    this._refreshObjectTree();
    this._rebuildSelectionHighlight();
    this._syncPrefabSection();
    this._syncVegetationSection();
    const primitive = this._selectedPrimitive();
    const light = this._selectedLight();
    const portal = this._selectedPortal();
    const rope = this._selectedRope();
    const fan = this._selectedFan();
    const extraction = this._selectedExtractionPortal();
    const raidTask = this._selectedRaidTask();
    const vegetation = this._selectedVegetation();
    const entry = primitive ?? light ?? portal ?? rope ?? fan ?? extraction ?? raidTask ?? vegetation;
    if (this.activeTool === 'bisect-plane') {
      if (!primitive || primitive.type !== 'plane') {
        this._cancelBisectPlaneTool({ silent: true });
      } else if (this.bisectState?.planeId !== primitive.id) {
        this.bisectState = {
          planeId: primitive.id,
          firstWorldPoint: null,
          firstLocalPoint: null,
        };
        this._setBisectPreview(null, null);
        this._updateBisectButton();
        this._setStatus('Bisect target changed. Click the first point on the new plane.');
      }
    } else {
      this._updateBisectButton();
    }
    const disabled = !entry;
    const primitiveDisabled = !primitive;
    const propSelected = primitive?.type === 'prop';
    const lightDisabled = !light;
    const portalDisabled = !portal;
    const ropeDisabled = !rope;
    const fanDisabled = !fan;
    const extractionDisabled = !extraction;
    const raidTaskDisabled = !raidTask;
    const vegetationDisabled = !vegetation;

    [
      this.nameInput,
      ...Object.values(this.positionInputs),
    ].forEach((field) => {
      field.disabled = disabled;
    });

    Object.values(this.rotationInputs).forEach((field) => {
      field.disabled = disabled || !!rope;
    });

    [
      ...Object.values(this.scaleInputs),
      this.textureCellInput,
      this.colorInput,
      ...Object.values(this.repeatInputs),
      this.textureRotationInput,
      this.chromaSimilarityInput,
      this.chromaFeatherInput,
      this.roughnessInput,
      this.metalnessInput,
      this.receiveShadowToggle,
      this.clearanceInput,
      this.planeZIndexInput,
      this.navAreaSelect,
      this.prefabSelect,
      ...Object.values(this.prefabInstanceScaleInputs ?? {}),
    ].forEach((field) => {
      field.disabled = primitiveDisabled;
    });
    const prefabInstanceScale = this._selectedPrefabInstanceScale();
    const raidTaskPrefabScale = this._selectedRaidTaskPrefabScale();
    if (this.prefabInstanceScaleInputs?._wrap) {
      this.prefabInstanceScaleInputs._wrap.style.display = prefabInstanceScale ? 'block' : 'none';
    }
    if (vegetation || raidTaskPrefabScale) {
      Object.values(this.scaleInputs).forEach((field) => {
        field.disabled = false;
      });
    }
    this.colliderToggle.disabled = primitiveDisabled || propSelected;
    this.castShadowToggle.disabled = (!primitive && !light) || propSelected;
    this.receiveShadowToggle.disabled = primitiveDisabled || propSelected;

    [
      this.lightColorInput,
      this.lightTypeSelect,
      this.lightIntensityInput,
      this.lightDistanceInput,
      this.lightDecayInput,
      this.lightAngleInput,
      this.lightPenumbraInput,
    ].forEach((field) => {
      field.disabled = lightDisabled;
    });

    [
      this.portalTypeSelect,
      this.portalTriggerRadiusInput,
    ].forEach((field) => {
      field.disabled = portalDisabled;
    });

    [
      this.extractionRadiusInput,
    ].forEach((field) => {
      if (field) field.disabled = extractionDisabled;
    });

    [
      this.raidTaskTypeSelect,
      this.raidTaskCompleteEffectSelect,
      this.raidTaskVisualTargetSelect,
      this.raidTaskVisualPreviewSelect,
      this.raidTaskBeforePrefabEnabledToggle,
      this.raidTaskAfterPrefabEnabledToggle,
      this.raidTaskBeforePrefabSelect,
      this.raidTaskAfterPrefabSelect,
    ].forEach((field) => {
      if (field) field.disabled = raidTaskDisabled;
    });

    [
      this.ropeLengthInput,
      this.ropeSegmentsInput,
      this.ropeThicknessInput,
      this.ropeColorInput,
      this.ropeVisualModeSelect,
      this.ropeCardWidthInput,
      this.ropeCardOpacityInput,
      this.ropeTextureAtlasSelect,
      this.ropeTextureCellInput,
    ].forEach((field) => {
      if (field) field.disabled = ropeDisabled;
    });

    [
      this.fanBladeCountInput,
      this.fanBladeLengthInput,
      this.fanBladeWidthInput,
      this.fanHubRadiusInput,
      this.fanRodLengthInput,
      this.fanSpinSpeedInput,
      this.fanCheeseAmountInput,
    ].forEach((field) => {
      if (field) field.disabled = fanDisabled;
    });

    [
      this.vegetationDensityInput,
      this.vegetationSeedInput,
      this.vegetationAreaShapeSelect,
      this.vegetationAreaWidthInput,
      this.vegetationAreaDepthInput,
      this.vegetationAreaRadiusInput,
      this.vegetationLineLengthInput,
      this.vegetationLineWidthInput,
      this.vegetationModeSelect,
    ].forEach((field) => {
      if (field) field.disabled = vegetationDisabled;
    });

    this.surfaceSection.style.display = primitive ? 'block' : 'none';
    this.lightSection.style.display = light ? 'block' : 'none';
    this.portalSection.style.display = portal ? 'block' : 'none';
    if (this.ropeSection) this.ropeSection.style.display = rope ? 'block' : 'none';
    if (this.fanSection) this.fanSection.style.display = fan ? 'block' : 'none';
    if (this.extractionSection) this.extractionSection.style.display = extraction ? 'block' : 'none';
    if (this.raidTaskSection) this.raidTaskSection.style.display = raidTask ? 'block' : 'none';
    this.scaleInputs._wrap.style.display = primitive || vegetation || raidTaskPrefabScale ? 'block' : 'none';
    this.colliderToggle._wrap.style.display = primitive && !propSelected ? 'flex' : 'none';
    this.castShadowToggle._wrap.style.display = (primitive && !propSelected) || light ? 'flex' : 'none';
    this.receiveShadowToggle._wrap.style.display = primitive && !propSelected ? 'flex' : 'none';
    this.clearanceInput._wrap.style.display = primitive && !propSelected ? 'grid' : 'none';
    this.chromaSimilarityInput._wrap.style.display = propSelected ? 'grid' : 'none';
    this.chromaFeatherInput._wrap.style.display = propSelected ? 'grid' : 'none';
    if (this.planeZIndexInput?._wrap) {
      this.planeZIndexInput._wrap.style.display = primitive?.type === 'plane' ? 'grid' : 'none';
    }
    this.navAreaSelect._wrap.style.display = primitive && !propSelected ? 'grid' : 'none';
    this.prefabSelect.disabled = primitiveDisabled;
    this._ensureTextureTarget(primitive);
    this._syncTextureTargetButtons(primitive);

    if (!entry) {
      this.textureCellInput.value = '';
      this._highlightPalette();
      return;
    }

    this.nameInput.value = entry.name;
    const entryPosition = entry.position ?? entry.anchor ?? { x: 0, y: 0, z: 0 };
    this.positionInputs.x.value = entryPosition.x;
    this.positionInputs.y.value = entryPosition.y;
    this.positionInputs.z.value = entryPosition.z;
    const entryRotation = entry.rotation ?? { x: 0, y: 0, z: 0 };
    this.rotationInputs.x.value = (entryRotation.x * RAD_TO_DEG).toFixed(1);
    this.rotationInputs.y.value = (entryRotation.y * RAD_TO_DEG).toFixed(1);
    this.rotationInputs.z.value = (entryRotation.z * RAD_TO_DEG).toFixed(1);
    this.castShadowToggle.checked = entry.castShadow === true;

    if (primitive) {
      const scale = prefabInstanceScale ?? primitive.scale;
      this.scaleInputs.x.value = scale.x;
      this.scaleInputs.y.value = scale.y;
      this.scaleInputs.z.value = scale.z;
      if (this.prefabInstanceScaleInputs && prefabInstanceScale) {
        this.prefabInstanceScaleInputs.x.value = prefabInstanceScale.x;
        this.prefabInstanceScaleInputs.y.value = prefabInstanceScale.y;
        this.prefabInstanceScaleInputs.z.value = prefabInstanceScale.z;
      }
      const paletteRef = this._getPaletteSelectedTextureRef(primitive)
        ?? (this.textureTarget === 'all' ? primitive.texture : null)
        ?? this._getEffectiveTextureRef(primitive, this.textureTarget);
      this.activeTextureAtlasId = paletteRef?.atlas ?? primitive.texture.atlas ?? this.activeTextureAtlasId;
      this.textureCellInput.value = this._getTextureCellInputValue(primitive);
      this.textureCellInput.max = String((this._activeTextureAtlas().manifest?.cells?.length ?? 100) - 1);
      this.colorInput.value = primitive.material.color;
      this.repeatInputs.x.value = primitive.texture.repeat.x;
      this.repeatInputs.y.value = primitive.texture.repeat.y;
      this.textureRotationInput.value = (primitive.texture.rotation * RAD_TO_DEG).toFixed(1);
      if (primitive.type === 'prop') {
        const similarity = Number(primitive.chroma?.similarity ?? 0.32);
        const feather = Number(primitive.chroma?.feather ?? 0.08);
        this.chromaSimilarityInput.value = similarity;
        this.chromaSimilarityInput._output.textContent = similarity.toFixed(2);
        this.chromaFeatherInput.value = feather;
        this.chromaFeatherInput._output.textContent = feather.toFixed(2);
      }
      this.roughnessInput.value = primitive.material.roughness;
      this.roughnessInput._output.textContent = Number(primitive.material.roughness).toFixed(2);
      this.metalnessInput.value = primitive.material.metalness;
      this.metalnessInput._output.textContent = Number(primitive.material.metalness).toFixed(2);
      this.colliderToggle.checked = primitive.collider;
      this.receiveShadowToggle.checked = primitive.receiveShadow;
      this.clearanceInput.value = primitive.colliderClearance ?? 0;
      this.clearanceInput._output.textContent = (primitive.colliderClearance ?? 0).toFixed(2);
      this.planeZIndexInput.value = primitive.type === 'plane' ? String(primitive.zIndex ?? 0) : '0';
      this.planeZIndexInput.disabled = primitiveDisabled || primitive.type !== 'plane';
      this.navAreaSelect.value = normalizeNavArea(primitive.navArea);
      this.prefabSelect.value = primitive.prefabId ?? '';
    }

    if (raidTaskPrefabScale) {
      this.scaleInputs.x.value = raidTaskPrefabScale.x;
      this.scaleInputs.y.value = raidTaskPrefabScale.y;
      this.scaleInputs.z.value = raidTaskPrefabScale.z;
    }

    if (light) {
      this.lightTypeSelect.value = light.lightType;
      this.lightColorInput.value = light.color;
      this.lightIntensityInput.value = light.intensity;
      this.lightIntensityInput._output.textContent = Number(light.intensity).toFixed(2);
      this.lightDistanceInput.value = light.distance;
      this.lightDecayInput.value = light.decay;
      this.lightAngleInput.value = (light.angle * RAD_TO_DEG).toFixed(1);
      this.lightAngleInput._output.textContent = (light.angle * RAD_TO_DEG).toFixed(2);
      this.lightPenumbraInput.value = light.penumbra;
      this.lightPenumbraInput._output.textContent = Number(light.penumbra).toFixed(2);
    }

    if (portal) {
      this.portalTypeSelect.value = normalizeVibePortalType(portal.portalType);
      this.portalTriggerRadiusInput.value = portal.triggerRadius;
      this.portalTriggerRadiusInput._output.textContent = Number(portal.triggerRadius).toFixed(2);
    }

    if (extraction && this.extractionRadiusInput) {
      this.extractionRadiusInput.value = extraction.radius;
      if (this.extractionRadiusInput._output) {
        this.extractionRadiusInput._output.textContent = Number(extraction.radius).toFixed(2);
      }
    }

    if (raidTask && this.raidTaskTypeSelect) {
      this.raidTaskTypeSelect.value = raidTask.taskType;
      if (this.raidTaskCompleteEffectSelect) {
        this.raidTaskCompleteEffectSelect.value = raidTask.completeEffect ?? 'default';
      }
      if (this.raidTaskVisualTargetSelect) {
        this.raidTaskVisualTargetSelect.value = this.activeRaidTaskVisualTarget;
        this.app.room.setRaidTaskPrefabEditTarget(raidTask.id, this.activeRaidTaskVisualTarget);
      }
      if (this.raidTaskVisualPreviewSelect) {
        this.raidTaskVisualPreviewSelect.value = this.activeRaidTaskVisualPreview;
        this.app.room.setRaidTaskPrefabEditorPreview(raidTask.id, this.activeRaidTaskVisualPreview);
      }
      if (this.raidTaskBeforePrefabEnabledToggle) {
        this.raidTaskBeforePrefabEnabledToggle.checked = raidTask.beforePrefab?.enabled === true;
      }
      if (this.raidTaskAfterPrefabEnabledToggle) {
        this.raidTaskAfterPrefabEnabledToggle.checked = raidTask.afterPrefab?.enabled === true;
      }
      if (this.raidTaskBeforePrefabSelect && raidTask.beforePrefab?.prefabId) {
        this.raidTaskBeforePrefabSelect.value = raidTask.beforePrefab.prefabId;
      }
      if (this.raidTaskAfterPrefabSelect && raidTask.afterPrefab?.prefabId) {
        this.raidTaskAfterPrefabSelect.value = raidTask.afterPrefab.prefabId;
      }
    }

    if (rope && this.ropeLengthInput) {
      this.ropeLengthInput.value = rope.length;
      if (this.ropeLengthInput._output) {
        this.ropeLengthInput._output.textContent = Number(rope.length).toFixed(2);
      }
      this.ropeSegmentsInput.value = rope.segmentCount;
      if (this.ropeThicknessInput) {
        const d = Number(rope.segmentRadius ?? 0) * 2;
        this.ropeThicknessInput.value = d;
        if (this.ropeThicknessInput._output) {
          this.ropeThicknessInput._output.textContent = d.toFixed(3);
        }
      }
      if (this.ropeColorInput) {
        this.ropeColorInput.value = rope.color ?? DEFAULT_ROPE_COLOR;
      }
      if (this.ropeVisualModeSelect) {
        this.ropeVisualModeSelect.value = rope.visualMode ?? 'rope';
      }
      if (this.ropeCardWidthInput) {
        const width = Number(rope.cards?.width ?? DEFAULT_ROPE_CARD_WIDTH);
        this.ropeCardWidthInput.value = width;
        this.ropeCardWidthInput._output.textContent = width.toFixed(2);
      }
      if (this.ropeCardOpacityInput) {
        const opacity = Number(rope.cards?.opacity ?? DEFAULT_ROPE_CARD_OPACITY);
        this.ropeCardOpacityInput.value = opacity;
        this.ropeCardOpacityInput._output.textContent = opacity.toFixed(2);
      }
      if (this.ropeTextureAtlasSelect && rope.texture?.atlas) {
        this.ropeTextureAtlasSelect.value = rope.texture.atlas;
      } else if (this.ropeTextureAtlasSelect) {
        this.ropeTextureAtlasSelect.value = this.activeTextureAtlasId;
      }
      if (this.ropeTextureCellInput) {
        this.ropeTextureCellInput.value = rope.texture?.cell != null ? String(rope.texture.cell) : '';
      }
    }

    if (fan) {
      if (this.fanBladeCountInput) this.fanBladeCountInput.value = fan.bladeCount;
      if (this.fanBladeLengthInput) {
        this.fanBladeLengthInput.value = fan.bladeLength;
        this.fanBladeLengthInput._output.textContent = Number(fan.bladeLength).toFixed(2);
      }
      if (this.fanBladeWidthInput) {
        this.fanBladeWidthInput.value = fan.bladeWidth;
        this.fanBladeWidthInput._output.textContent = Number(fan.bladeWidth).toFixed(2);
      }
      if (this.fanHubRadiusInput) {
        this.fanHubRadiusInput.value = fan.hubRadius;
        this.fanHubRadiusInput._output.textContent = Number(fan.hubRadius).toFixed(2);
      }
      if (this.fanRodLengthInput) {
        this.fanRodLengthInput.value = fan.rodLength;
        this.fanRodLengthInput._output.textContent = Number(fan.rodLength).toFixed(2);
      }
      if (this.fanSpinSpeedInput) {
        this.fanSpinSpeedInput.value = fan.spinSpeed;
        this.fanSpinSpeedInput._output.textContent = Number(fan.spinSpeed).toFixed(2);
      }
      if (this.fanCheeseAmountInput) this.fanCheeseAmountInput.value = fan.cheeseAmount;
    }

    if (vegetation) {
      this.scaleInputs.x.value = vegetation.scale.x;
      this.scaleInputs.y.value = vegetation.scale.y;
      this.scaleInputs.z.value = vegetation.scale.z;
      if (this.vegetationModeSelect) this.vegetationModeSelect.value = vegetation.mode;
      if (this.vegetationDensityInput) this.vegetationDensityInput.value = vegetation.density;
      if (this.vegetationSeedInput) this.vegetationSeedInput.value = vegetation.seed;
      if (this.vegetationAreaShapeSelect) this.vegetationAreaShapeSelect.value = vegetation.area?.shape ?? 'rect';
      if (this.vegetationAreaWidthInput) this.vegetationAreaWidthInput.value = vegetation.area?.width ?? 3;
      if (this.vegetationAreaDepthInput) this.vegetationAreaDepthInput.value = vegetation.area?.depth ?? 2;
      if (this.vegetationAreaRadiusInput) this.vegetationAreaRadiusInput.value = vegetation.area?.radius ?? 1.5;
      if (this.vegetationLineLengthInput) this.vegetationLineLengthInput.value = vegetation.line?.length ?? 4;
      if (this.vegetationLineWidthInput) this.vegetationLineWidthInput.value = vegetation.line?.width ?? 0.8;
    }

    this._highlightPalette();
  }

  _highlightPalette() {
    const primitive = this._selectedPrimitive();
    const selectedRef = this._getPaletteSelectedTextureRef(primitive)
      ?? (this.textureTarget === 'all' ? primitive?.texture : null);
    const selectedCell = String(selectedRef?.cell ?? '');
    const selectedAtlas = selectedRef?.atlas ?? this.activeTextureAtlasId;
    this.paletteGrid.querySelectorAll('button').forEach((button) => {
      button.style.outline = button.dataset.cellIndex === selectedCell && button.dataset.atlasId === selectedAtlas
        ? '2px solid #ffe39d'
        : 'none';
    });
  }

  _selectedPrefab() {
    return this.prefabLibrary.prefabs.find((prefab) => prefab.id === this.prefabSelect.value) ?? null;
  }

  _selectedPrefabInstanceScale() {
    const primitive = this._selectedPrimitive();
    if (!primitive?.prefabInstanceId) return null;
    return primitive.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
  }

  _updateSelectedPrefabInstanceScale(axis, value) {
    if (!['x', 'y', 'z'].includes(axis)) return;
    const primitive = this._selectedPrimitive();
    if (!primitive?.prefabInstanceId) return;
    const current = primitive.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
    const nextScale = {
      x: current.x,
      y: current.y,
      z: current.z,
      [axis]: Math.max(0.05, Number.isFinite(value) ? value : current[axis]),
    };
    this.app.room.updatePrefabInstanceTransform(primitive.prefabInstanceId, { scale: nextScale });
    this.layout = this.app.room.getEditableLayout();
    this._syncForm();
    this._attachTransformControls();
  }

  _selectedRaidTaskPrefabScale() {
    const task = this._selectedRaidTask();
    const slot = this.activeRaidTaskVisualTarget;
    if (!task || (slot !== 'before' && slot !== 'after')) return null;
    const prefab = slot === 'after' ? task.afterPrefab : task.beforePrefab;
    return prefab?.scale ?? { x: 1, y: 1, z: 1 };
  }

  _updateSelectedRaidTaskPrefabScale(axis, value) {
    if (!['x', 'y', 'z'].includes(axis)) return;
    const task = this._selectedRaidTask();
    const slot = this.activeRaidTaskVisualTarget;
    if (!task || (slot !== 'before' && slot !== 'after')) return;
    const current = this._selectedRaidTaskPrefabScale() ?? { x: 1, y: 1, z: 1 };
    const nextScale = {
      x: current.x,
      y: current.y,
      z: current.z,
      [axis]: Math.max(0.05, Number.isFinite(value) ? value : current[axis]),
    };
    this.app.room.updateEditableRaidTaskTransform(task.id, {
      scale: nextScale,
      prefabSlot: slot,
    });
    this.layout = this.app.room.getEditableLayout();
    this._syncForm();
    this._attachTransformControls();
  }

  _selectedVegetationSpecies() {
    return this.vegetationLibrary.species.find((species) => species.id === this.vegetationSpeciesSelect?.value) ?? null;
  }

  _syncPrefabSection() {
    const currentValue = this.prefabSelect?.value;
    if (this.prefabSelect) {
      this.prefabSelect.innerHTML = '';
      this.prefabLibrary.prefabs.forEach((prefab) => {
        const option = document.createElement('option');
        option.value = prefab.id;
        option.textContent = prefab.name;
        this.prefabSelect.appendChild(option);
      });
      if (currentValue && this.prefabLibrary.prefabs.some((prefab) => prefab.id === currentValue)) {
        this.prefabSelect.value = currentValue;
      } else if (this.prefabLibrary.prefabs[0]) {
        this.prefabSelect.value = this.prefabLibrary.prefabs[0].id;
      }
    }
    this._syncRaidTaskPrefabSection?.();

    const instanceInfo = this._selectedPrefabInstanceInfo();
    if (this.prefabEditButton) {
      this.prefabEditButton.textContent = instanceInfo ? 'Edit Local' : 'New / Edit';
      this.prefabEditButton.style.background = instanceInfo ? '#31513a' : '#2f2c28';
      this.prefabEditButton.title = instanceInfo
        ? 'Edit only this placed prefab instance; group position/rotation/scale stay applied.'
        : 'Edit the shared prefab library.';
    }

    const prefab = this._selectedPrefab();
    if (!this.prefabMeta) return;
    if (!prefab) {
      this.prefabMeta.textContent = 'No prefabs in library.';
      return;
    }

    const lines = [
      `Size: ${prefab.size.x} x ${prefab.size.y} x ${prefab.size.z} cells`,
      `Parts: ${prefab.primitives.length}`,
    ];
    if (instanceInfo) {
      lines.push('');
      lines.push(`Selected local instance: ${instanceInfo.instanceId}`);
      lines.push(`Local parts: ${instanceInfo.parts.length}`);
      lines.push('Edit Local applies to this placed copy only.');
    }
    this.prefabMeta.textContent = lines.join('\n');
  }

  _syncVegetationSection() {
    const vegetation = this._selectedVegetation();
    const currentValue = this.vegetationSpeciesSelect?.value;
    if (this.vegetationSpeciesSelect) {
      this.vegetationSpeciesSelect.innerHTML = '';
      this.vegetationLibrary.species.forEach((species) => {
        const option = document.createElement('option');
        option.value = species.id;
        option.textContent = species.name;
        this.vegetationSpeciesSelect.appendChild(option);
      });
      if (currentValue && this.vegetationLibrary.species.some((species) => species.id === currentValue)) {
        this.vegetationSpeciesSelect.value = currentValue;
      } else if (this.vegetationLibrary.species[0]) {
        this.vegetationSpeciesSelect.value = this.vegetationLibrary.species[0].id;
      }
      if (vegetation?.speciesId && this.vegetationLibrary.species.some((species) => species.id === vegetation.speciesId)) {
        this.vegetationSpeciesSelect.value = vegetation.speciesId;
      }
    }

    const species = this._selectedVegetationSpecies();
    if (!this.vegetationMeta) return;
    if (!species) {
      this.vegetationMeta.textContent = 'No vegetation species in library.';
      return;
    }

    this.vegetationMeta.textContent = [
      `${species.kind} · ${species.renderMode}`,
      species.renderMode === 'instancedCards'
        ? `Atlas ${species.atlas} · cells ${species.cells.join(', ')}`
        : `Asset ${species.assetId || 'unset'}`,
      vegetation
        ? `Selected ${vegetation.mode} · density ${vegetation.density}`
        : 'Place mode uses current species + mode above.',
    ].join('\n');

    const mode = vegetation?.mode ?? (this.vegetationModeSelect?.value || 'single');
    if (this.vegetationModeSelect) {
      this.vegetationModeSelect.value = mode;
    }
    const showPatch = mode === 'patch';
    const showLine = mode === 'line';
    if (this.vegetationDensityInput?._wrap) this.vegetationDensityInput._wrap.style.display = showPatch ? 'grid' : 'none';
    if (this.vegetationAreaShapeSelect?._wrap) this.vegetationAreaShapeSelect._wrap.style.display = showPatch ? 'grid' : 'none';
    if (this.vegetationAreaWidthInput?._wrap) this.vegetationAreaWidthInput._wrap.style.display = showPatch && (vegetation?.area?.shape ?? 'rect') === 'rect' ? 'grid' : 'none';
    if (this.vegetationAreaDepthInput?._wrap) this.vegetationAreaDepthInput._wrap.style.display = showPatch && (vegetation?.area?.shape ?? 'rect') === 'rect' ? 'grid' : 'none';
    if (this.vegetationAreaRadiusInput?._wrap) this.vegetationAreaRadiusInput._wrap.style.display = showPatch && (vegetation?.area?.shape ?? 'rect') === 'circle' ? 'grid' : 'none';
    if (this.vegetationLineLengthInput?._wrap) this.vegetationLineLengthInput._wrap.style.display = showLine ? 'grid' : 'none';
    if (this.vegetationLineWidthInput?._wrap) this.vegetationLineWidthInput._wrap.style.display = showLine ? 'grid' : 'none';
    if (this.vegetationSeedInput?._wrap) this.vegetationSeedInput._wrap.style.display = mode === 'single' ? 'none' : 'grid';
  }

  _openPrefabEditor() {
    const instanceInfo = this._selectedPrefabInstanceInfo();
    if (instanceInfo) {
      this._openLocalPrefabEditor(instanceInfo);
      return;
    }
    this.prefabEditor.open(this.prefabLibrary, this.prefabSelect.value || null);
  }

  _selectedPrefabInstanceInfo() {
    const primitive = this._selectedPrimitive();
    const instanceId = primitive?.prefabInstanceId ?? null;
    if (!instanceId) return null;
    const parts = this._editorPrimitives().filter((entry) => entry.prefabInstanceId === instanceId);
    if (!parts.length) return null;
    const sourcePrefab = this.prefabLibrary.prefabs.find((prefab) => prefab.id === (parts[0].prefabId ?? primitive.prefabId)) ?? null;
    return {
      instanceId,
      parts,
      sourcePrefab,
      anchor: parts[0],
    };
  }

  _inferPrefabSizeFromParts(parts) {
    if (!parts?.length) return { x: 1, y: 1, z: 1 };
    const bounds = new THREE.Box3();
    parts.forEach((part) => {
      const halfX = Math.max(0.01, Math.abs(part.scale?.x ?? 1) * 0.5);
      const halfY = Math.max(0.01, Math.abs(part.scale?.y ?? 1) * 0.5);
      const halfZ = Math.max(0.01, Math.abs(part.scale?.z ?? 1) * 0.5);
      const center = new THREE.Vector3(part.position?.x ?? 0, part.position?.y ?? 0, part.position?.z ?? 0);
      bounds.expandByPoint(center.clone().add(new THREE.Vector3(-halfX, -halfY, -halfZ)));
      bounds.expandByPoint(center.clone().add(new THREE.Vector3(halfX, halfY, halfZ)));
    });
    const size = bounds.getSize(new THREE.Vector3());
    return {
      x: Math.max(1, Math.ceil(size.x / Math.max(0.001, this.grid.cellWidth))),
      y: Math.max(1, Math.ceil(size.y / Math.max(0.001, this.grid.verticalStep))),
      z: Math.max(1, Math.ceil(size.z / Math.max(0.001, this.grid.cellDepth))),
    };
  }

  _openLocalPrefabEditor(instanceInfo) {
    const localPrefabId = `local-${instanceInfo.instanceId}`;
    const sourceName = instanceInfo.sourcePrefab?.name ?? instanceInfo.anchor?.prefabId ?? 'Prefab';
    const localPrefab = {
      id: localPrefabId,
      name: `${sourceName} Local`,
      size: deepClone(instanceInfo.sourcePrefab?.size ?? this._inferPrefabSizeFromParts(instanceInfo.parts)),
      primitives: instanceInfo.parts.map((part) => {
        const copy = deepClone(part);
        delete copy.prefabId;
        delete copy.prefabInstanceId;
        delete copy.prefabInstanceOrigin;
        delete copy.prefabInstanceRotation;
        delete copy.prefabInstanceScale;
        return copy;
      }),
    };
    const localLibrary = {
      version: 1,
      prefabs: [localPrefab],
    };
    this.prefabEditor.openLocal(localLibrary, localPrefabId, {
      onSave: (_library, prefab) => this._applyLocalPrefabEdits(instanceInfo.instanceId, prefab),
    });
  }

  _applyLocalPrefabEdits(instanceId, prefab) {
    if (!instanceId || !prefab) {
      return { ok: false, error: 'Missing local prefab instance.' };
    }

    const layout = this.app.room.getEditableLayout();
    const currentParts = (layout.primitives ?? []).filter((entry) => entry.prefabInstanceId === instanceId);
    if (!currentParts.length) {
      return { ok: false, error: 'Placed prefab instance no longer exists.' };
    }

    const anchor = currentParts[0];
    const prefabId = anchor.prefabId ?? prefab.id;
    const prefabInstanceOrigin = deepClone(anchor.prefabInstanceOrigin ?? anchor.position ?? { x: 0, y: 0, z: 0 });
    const prefabInstanceRotation = deepClone(anchor.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 });
    const prefabInstanceScale = deepClone(anchor.prefabInstanceScale ?? { x: 1, y: 1, z: 1 });
    const previousById = new Map(currentParts.map((part) => [part.id, part]));
    const outsideIds = new Set((layout.primitives ?? [])
      .filter((entry) => entry.prefabInstanceId !== instanceId)
      .map((entry) => entry.id));
    const usedIds = new Set();
    const idSuffix = Date.now().toString(36);

    const replacements = (prefab.primitives ?? []).map((part, index) => {
      let id = part.id;
      if (!id || outsideIds.has(id) || usedIds.has(id)) {
        id = `${instanceId}-part-${index + 1}-${idSuffix}`;
      }
      usedIds.add(id);

      const previous = previousById.get(part.id) ?? {};
      return {
        ...deepClone(previous),
        ...deepClone(part),
        id,
        prefabId,
        prefabInstanceId: instanceId,
        prefabInstanceOrigin: deepClone(prefabInstanceOrigin),
        prefabInstanceRotation: deepClone(prefabInstanceRotation),
        prefabInstanceScale: deepClone(prefabInstanceScale),
        deleted: false,
      };
    });

    const nextLayout = {
      ...layout,
      primitives: [
        ...(layout.primitives ?? []).filter((entry) => entry.prefabInstanceId !== instanceId),
        ...replacements,
      ],
    };

    this.app.room.setEditableLayout(nextLayout);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = replacements.find((part) => part.id === this.selectedId)?.id
      ?? replacements[0]?.id
      ?? this.selectedId;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Applied local prefab edits to ${instanceId}.`);

    return {
      ok: true,
      message: `Applied ${replacements.length} local part${replacements.length === 1 ? '' : 's'} to world instance.`,
    };
  }

  _openVegetationEditor() {
    this.vegetationEditor.open(this.vegetationLibrary, this.vegetationSpeciesSelect.value || null);
  }

  _getFallbackGridCell(spanX = 1, spanZ = 1) {
    const grid = this.app.room.getBuildGridConfig();
    const point = this.app.mouse.position.clone();
    const col = clamp(
      Math.floor(((point.x + grid.roomWidth * 0.5) / grid.roomWidth) * grid.columns),
      0,
      Math.max(0, grid.columns - spanX),
    );
    const row = clamp(
      Math.floor(((point.z + grid.roomDepth * 0.5) / grid.roomDepth) * grid.rows),
      0,
      Math.max(0, grid.rows - spanZ),
    );
    return { col, row };
  }

  _placeSelectedPrefab() {
    const prefab = this._selectedPrefab();
    if (!prefab) return;

    const spanX = Math.max(1, prefab.size?.x ?? 1);
    const spanZ = Math.max(1, prefab.size?.z ?? 1);
    const cell = this.currentHit
      ? this._getGridCellFromPoint(this.currentHit.point)
      : this._getFallbackGridCell(spanX, spanZ);
    const targetCell = cell ?? this._getFallbackGridCell(spanX, spanZ);
    const ids = this.app.room.instantiatePrefab(prefab, {
      col: targetCell.col,
      row: targetCell.row,
    });
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = ids[0] ?? this.selectedId;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Placed ${prefab.name}.`);
  }

  _placeSelectedVegetation() {
    const species = this._selectedVegetationSpecies();
    if (!species) return;
    const mode = this.vegetationModeSelect?.value || 'single';
    const vegetation = this.app.room.snapVegetationToGrid(
      createDefaultVegetation(species, mode, this.app),
      { snapY: true, snapPosition: true, snapScale: false, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditableVegetation(vegetation);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = vegetation.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Placed ${species.name}.`);
  }

  async _savePrefabLibrary(library = this.prefabLibrary) {
    const payload = normalizePrefabLibrary(library);
    const response = await fetch('/__dev/save-prefabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      this._setStatus(`Prefab save failed: ${result.error || response.statusText}`, true);
      return { ok: false, error: result.error || response.statusText };
    }
    this.prefabLibrary = payload;
    this._syncPrefabSection();
    this._setStatus('Saved /levels/prefabs.json');
    return { ok: true };
  }

  async _saveVegetationLibrary(library = this.vegetationLibrary) {
    const payload = normalizeVegetationLibrary(library);
    const response = await fetch('/__dev/save-vegetation-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      this._setStatus(`Vegetation save failed: ${result.error || response.statusText}`, true);
      return { ok: false, error: result.error || response.statusText };
    }
    this.vegetationLibrary = payload;
    await this.app.room.setVegetationLibrary(payload);
    this._syncVegetationSection();
    this._setStatus('Saved /levels/vegetation-library.json');
    return { ok: true };
  }

  _deleteSelectedPrefab() {
    const prefab = this._selectedPrefab();
    if (!prefab) return;
    this.prefabLibrary.prefabs = this.prefabLibrary.prefabs.filter((entry) => entry.id !== prefab.id);
    this._syncPrefabSection();
    this._setStatus(`Deleted ${prefab.name}.`);
  }

  _deleteSelectedVegetation() {
    const vegetation = this._selectedVegetation();
    if (!vegetation) return;
    this.app.room.purgeEditableVegetation(vegetation.id);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = this.layout.primitives[0]?.id
      ?? this.layout.vegetation?.[0]?.id
      ?? this.layout.fans?.[0]?.id
      ?? this.layout.lights?.[0]?.id
      ?? this.layout.portals?.[0]?.id
      ?? this.layout.ropes?.[0]?.id
      ?? this.layout.extractionPortals?.[0]?.id
      ?? this.layout.raidTasks?.[0]?.id
      ?? null;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Deleted ${vegetation.name}.`);
  }

  _getGridCellFromPoint(point) {
    if (!point) return null;
    const grid = this.app.room.getBuildGridConfig();
    const localPoint = this.app.room.getGroup().worldToLocal(point.clone());
    const col = Math.floor(((localPoint.x + grid.roomWidth * 0.5) / grid.roomWidth) * grid.columns);
    const row = Math.floor(((localPoint.z + grid.roomDepth * 0.5) / grid.roomDepth) * grid.rows);

    if (col < 0 || col >= grid.columns || row < 0 || row >= grid.rows) {
      return null;
    }

    return { col, row };
  }

  _updateSelected(mutator, { snapPosition = true, snapScale = false, snapY = true } = {}) {
    const primitive = this._selectedPrimitive();
    if (primitive) {
      const next = deepClone(primitive);
      mutator(next);
      const snapped = this.app.room.snapPrimitiveToGrid(next, {
        snapY,
        snapPosition,
        snapScale,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditablePrimitive(snapped);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const light = this._selectedLight();
    if (light) {
      const next = deepClone(light);
      mutator(next);
      const snapped = this.app.room.snapLightToGrid(next, {
        snapY,
        snapPosition,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditableLight(snapped);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const portal = this._selectedPortal();
    if (portal) {
      const nextPortal = deepClone(portal);
      mutator(nextPortal);
      const snappedPortal = this.app.room.snapPortalToGrid(nextPortal, {
        snapY,
        snapPosition,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditablePortal(snappedPortal);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const extraction = this._selectedExtractionPortal();
    if (extraction) {
      const next = deepClone(extraction);
      mutator(next);
      const snapped = this.app.room.snapExtractionPortalToGrid(next, {
        snapY,
        snapPosition,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditableExtractionPortal(snapped);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const raidTask = this._selectedRaidTask();
    if (raidTask) {
      const next = deepClone(raidTask);
      mutator(next);
      const snapped = this.app.room.snapRaidTaskToGrid(next, {
        snapY,
        snapPosition,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditableRaidTask(snapped);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const vegetation = this._selectedVegetation();
    if (vegetation) {
      const next = deepClone(vegetation);
      mutator(next);
      const snapped = this.app.room.snapVegetationToGrid(next, {
        snapY,
        snapPosition,
        snapScale,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditableVegetation(snapped);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const fan = this._selectedFan();
    if (fan) {
      const next = deepClone(fan);
      mutator(next);
      const snapped = this.app.room.snapFanToGrid(next, {
        snapY,
        snapPosition,
        allowEdgeOverflow: true,
      });
      this.app.room.upsertEditableFan(snapped);
      this.layout = this.app.room.getEditableLayout();
      this._syncForm();
      this._attachTransformControls();
      return;
    }

    const rope = this._selectedRope();
    if (!rope) {
      return;
    }
    const nextRope = deepClone(rope);
    mutator(nextRope);
    const snappedRope = this.app.room.snapRopeToGrid(nextRope, {
      snapY,
      snapPosition,
      allowEdgeOverflow: true,
    });
    this.app.room.upsertEditableRope(snappedRope);
    this.layout = this.app.room.getEditableLayout();
    this._syncForm();
    this._attachTransformControls();
  }

  _addPrimitive(type) {
    const primitive = createDefaultPrimitive(type, this.app);
    this.app.room.upsertEditablePrimitive(primitive);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = primitive.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${primitive.name}.`);
  }

  _addHotSurface() {
    const base = createDefaultPrimitive('box', this.app);
    const primitive = this.app.room.snapPrimitiveToGrid({
      ...base,
      name: `hot-surface-${Math.random().toString(36).slice(2, 5)}`,
      position: { ...base.position, y: 0.125 },
      scale: { x: 1.5, y: 0.25, z: 1.1 },
      texture: {
        atlas: base.texture?.atlas ?? 'textures',
        cell: null,
        repeat: { x: 1, y: 1 },
        rotation: 0,
        offset: { x: 0, y: 0 },
      },
      material: {
        color: '#ff2a1f',
        roughness: 0.72,
        metalness: 0.02,
      },
      gameplayType: 'hot_surface',
      collider: false,
      castShadow: false,
      receiveShadow: false,
      cameraOccluder: false,
    }, { snapY: false, snapPosition: true, snapScale: false, allowEdgeOverflow: true });
    this.app.room.upsertEditablePrimitive(primitive);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = primitive.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus('Added hot surface hazard.');
  }

  _addSpawnMarker(spawnType) {
    const primitive = this.app.room.snapPrimitiveToGrid(
      createSpawnMarkerPrimitive(spawnType, this.app),
      { snapY: true, snapPosition: true, snapScale: false, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditablePrimitive(primitive);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = primitive.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${this._spawnLabel(spawnType)}.`);
  }

  _addLight(lightType) {
    const light = this.app.room.snapLightToGrid(
      createDefaultLight(lightType, this.app),
      { snapY: true, snapPosition: true, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditableLight(light);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = light.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${light.name}.`);
  }

  _addPortal(portalType) {
    const portal = this.app.room.snapPortalToGrid(
      createDefaultPortal(portalType, this.app),
      { snapY: true, snapPosition: true, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditablePortal(portal);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = portal.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${portal.name}.`);
  }

  _addRope() {
    const rope = this.app.room.snapRopeToGrid(
      createDefaultRope(this.app),
      { snapY: true, snapPosition: true, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditableRope(rope);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = rope.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${rope.name}.`);
  }

  _addFan() {
    const fan = this.app.room.snapFanToGrid(
      createDefaultFan(this.app),
      { snapY: true, snapPosition: true, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditableFan(fan);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = fan.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${fan.name}.`);
  }

  _addExtractionPortal() {
    const ep = this.app.room.snapExtractionPortalToGrid(
      createDefaultExtractionPortal(this.app),
      { snapY: true, snapPosition: true, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditableExtractionPortal(ep);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = ep.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${ep.name}.`);
  }

  _addRaidTask() {
    const task = this.app.room.snapRaidTaskToGrid(
      createDefaultRaidTask(this.app),
      { snapY: true, snapPosition: true, allowEdgeOverflow: true },
    );
    this.app.room.upsertEditableRaidTask(task);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = task.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Added ${task.name}.`);
  }

  _planeWorldBox(primitive) {
    const halfWidth = Math.max(0.0001, Number(primitive?.scale?.x ?? 1)) * 0.5;
    const halfHeight = Math.max(0.0001, Number(primitive?.scale?.y ?? 1)) * 0.5;
    const position = new THREE.Vector3(
      primitive?.position?.x ?? 0,
      primitive?.position?.y ?? 0,
      primitive?.position?.z ?? 0,
    );
    const rotation = new THREE.Euler(
      primitive?.rotation?.x ?? 0,
      primitive?.rotation?.y ?? 0,
      primitive?.rotation?.z ?? 0,
    );
    const corners = [
      new THREE.Vector3(-halfWidth, -halfHeight, 0),
      new THREE.Vector3(halfWidth, -halfHeight, 0),
      new THREE.Vector3(halfWidth, halfHeight, 0),
      new THREE.Vector3(-halfWidth, halfHeight, 0),
    ].map((point) => point.applyEuler(rotation).add(position));
    return new THREE.Box3().setFromPoints(corners).expandByScalar(0.03);
  }

  _nextDuplicatePlaneZIndex(plane) {
    const box = this._planeWorldBox(plane);
    let maxZIndex = Number.isFinite(plane.zIndex) ? Math.trunc(plane.zIndex) : 0;

    for (const candidate of this._editorPrimitives()) {
      if (candidate.id === plane.id || candidate.type !== 'plane') continue;
      if (!box.intersectsBox(this._planeWorldBox(candidate))) continue;
      maxZIndex = Math.max(
        maxZIndex,
        Number.isFinite(candidate.zIndex) ? Math.trunc(candidate.zIndex) : 0,
      );
    }

    return maxZIndex + 1;
  }

  _detachPrimitiveCopyFromPrefab(copy) {
    copy.prefabInstanceId = null;
    copy.prefabInstanceOrigin = null;
    copy.prefabInstanceRotation = null;
    copy.prefabInstanceScale = null;
    return copy;
  }

  _duplicateSelected() {
    const primitive = this._selectedPrimitive();
    const light = this._selectedLight();
    const portal = this._selectedPortal();
    const grid = this.app.room.getBuildGridConfig();
    if (primitive) {
      const copy = this._detachPrimitiveCopyFromPrefab(deepClone(primitive));
      copy.id = createPrimitiveId();
      copy.name = `${primitive.name}-copy`;
      copy.position.x += grid.cellWidth;
      copy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapPrimitiveToGrid(copy, { snapY: true, allowEdgeOverflow: true });
      if (snapped.type === 'plane') {
        snapped.zIndex = this._nextDuplicatePlaneZIndex(snapped);
      }
      this.app.room.upsertEditablePrimitive(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${primitive.name}.`);
      return;
    }
    if (light) {
      const copy = deepClone(light);
      copy.id = `light-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      copy.name = `${light.name}-copy`;
      copy.position.x += grid.cellWidth;
      copy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapLightToGrid(copy, { snapY: true, allowEdgeOverflow: true });
      this.app.room.upsertEditableLight(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${light.name}.`);
      return;
    }
    if (portal) {
      const portalCopy = deepClone(portal);
      portalCopy.id = createPortalId();
      portalCopy.name = `${portal.name}-copy`;
      portalCopy.position.x += grid.cellWidth;
      portalCopy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapPortalToGrid(portalCopy, { snapY: true, allowEdgeOverflow: true });
      this.app.room.upsertEditablePortal(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${portal.name}.`);
      return;
    }
    const extraction = this._selectedExtractionPortal();
    if (extraction) {
      const copy = deepClone(extraction);
      copy.id = createExtractionPortalId();
      copy.name = `${extraction.name}-copy`;
      copy.position.x += grid.cellWidth;
      copy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapExtractionPortalToGrid(copy, { snapY: true, allowEdgeOverflow: true });
      this.app.room.upsertEditableExtractionPortal(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${extraction.name}.`);
      return;
    }
    const raidTask = this._selectedRaidTask();
    if (raidTask) {
      const copy = deepClone(raidTask);
      copy.id = createRaidTaskId();
      copy.name = `${raidTask.name}-copy`;
      copy.position.x += grid.cellWidth;
      copy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapRaidTaskToGrid(copy, { snapY: true, allowEdgeOverflow: true });
      this.app.room.upsertEditableRaidTask(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${raidTask.name}.`);
      return;
    }
    const fan = this._selectedFan();
    if (fan) {
      const copy = deepClone(fan);
      copy.id = `fan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      copy.name = `${fan.name}-copy`;
      copy.position.x += grid.cellWidth;
      copy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapFanToGrid(copy, { snapY: true, allowEdgeOverflow: true });
      this.app.room.upsertEditableFan(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${fan.name}.`);
      return;
    }
    const vegetation = this._selectedVegetation();
    if (vegetation) {
      const copy = deepClone(vegetation);
      copy.id = `veg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      copy.name = `${vegetation.name}-copy`;
      copy.position.x += grid.cellWidth;
      copy.position.z += grid.cellDepth;
      const snapped = this.app.room.snapVegetationToGrid(copy, { snapY: true, allowEdgeOverflow: true });
      this.app.room.upsertEditableVegetation(snapped);
      this.layout = this.app.room.getEditableLayout();
      this.selectedId = snapped.id;
      this._syncForm();
      this._attachTransformControls();
      this._setStatus(`Duplicated ${vegetation.name}.`);
      return;
    }
    const rope = this._selectedRope();
    if (!rope) return;
    const ropeCopy = deepClone(rope);
    ropeCopy.id = createRopeId();
    ropeCopy.name = `${rope.name}-copy`;
    ropeCopy.anchor.x += grid.cellWidth;
    ropeCopy.anchor.z += grid.cellDepth;
    const snappedRope = this.app.room.snapRopeToGrid(ropeCopy, { snapY: true, allowEdgeOverflow: true });
    this.app.room.upsertEditableRope(snappedRope);
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = snappedRope.id;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Duplicated ${rope.name}.`);
  }

  _deleteSelected() {
    if (!this.selectedId) return;
    const primitive = this._selectedPrimitive();
    const light = this._selectedLight();
    const portal = this._selectedPortal();
    const rope = this._selectedRope();
    const fan = this._selectedFan();
    const extraction = this._selectedExtractionPortal();
    const raidTask = this._selectedRaidTask();
    const vegetation = this._selectedVegetation();
    const currentName = primitive?.name ?? light?.name ?? portal?.name ?? rope?.name ?? fan?.name
      ?? extraction?.name ?? raidTask?.name ?? vegetation?.name ?? 'object';
    if (light) {
      this.app.room.purgeEditableLight(this.selectedId);
    } else if (portal) {
      this.app.room.purgeEditablePortal(this.selectedId);
    } else if (extraction) {
      this.app.room.purgeEditableExtractionPortal(this.selectedId);
    } else if (raidTask) {
      this.app.room.purgeEditableRaidTask(this.selectedId);
    } else if (fan) {
      this.app.room.purgeEditableFan(this.selectedId);
    } else if (vegetation) {
      this.app.room.purgeEditableVegetation(this.selectedId);
    } else if (rope) {
      this.app.room.purgeEditableRope(this.selectedId);
    } else {
      this.app.room.purgeEditablePrimitive(this.selectedId);
    }
    this.layout = this.app.room.getEditableLayout();
    this.selectedId = this.layout.primitives[0]?.id
      ?? this.layout.vegetation?.[0]?.id
      ?? this.layout.lights?.[0]?.id
      ?? this.layout.portals?.[0]?.id
      ?? this.layout.ropes?.[0]?.id
      ?? this.layout.fans?.[0]?.id
      ?? this.layout.extractionPortals?.[0]?.id
      ?? this.layout.raidTasks?.[0]?.id
      ?? null;
    this._syncForm();
    this._attachTransformControls();
    this._setStatus(`Deleted ${currentName}.`);
  }

  async save() {
    const payload = this.app.room.getEditableLayout();
    const response = await fetch('/__dev/save-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      this._setStatus(`Save failed: ${result.error || response.statusText}`, true);
      return;
    }

    const socket = this.app.net?.ws;
    if (socket?.readyState === WebSocket.OPEN) {
      const syncToken = import.meta.env.VITE_DEV_LAYOUT_SYNC_TOKEN ?? '';
      if (!syncToken) {
        this._setStatus(
          'Saved level (file only). Set VITE_DEV_LAYOUT_SYNC_TOKEN and PartyKit DEV_LAYOUT_SYNC_ENABLED + DEV_LAYOUT_SYNC_TOKEN to push colliders to the server.',
          true,
        );
        return;
      }
      socket.send(JSON.stringify({
        type: 'dev-sync-layout',
        syncToken,
        layout: payload,
      }));
      this._setStatus('Saved level and synced server layout.');
      return;
    }

    this._setStatus('Saved /levels/kitchen-layout.json');
  }

  exportBackup() {
    const payload = JSON.stringify(this.app.room.getEditableLayout(), null, 2);
    const blob = new Blob([`${payload}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kitchen-layout-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this._setStatus('Exported backup JSON.');
  }

  _setStatus(message, isError = false) {
    this.status.textContent = message;
    this.status.style.color = isError ? '#ffb089' : '#9ee8b2';
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    this.statusTimer = setTimeout(() => {
      this.status.textContent = '';
    }, 3000);
  }
}

export async function installBuildMode(app) {
  const textureAtlases = await loadTextureAtlases();
  const prefabLibrary = normalizePrefabLibrary(
    await loadPrefabLibraryFromAsset(assetUrl('levels/prefabs.json')) ?? DEFAULT_PREFAB_LIBRARY,
  );
  const vegetationLibrary = normalizeVegetationLibrary(
    await loadVegetationLibraryFromAsset(assetUrl('levels/vegetation-library.json')) ?? DEFAULT_VEGETATION_LIBRARY,
  );
  await app.room.setVegetationLibrary(vegetationLibrary);
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { TransformControls } = await import('three/addons/controls/TransformControls.js');
  return new BuildModeEditor(
    app,
    textureAtlases,
    prefabLibrary,
    vegetationLibrary,
    OrbitControls,
    TransformControls,
  );
}
