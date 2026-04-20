import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DEFAULT_VEGETATION_LIBRARY,
  VEGETATION_COLLISION_MODES,
  VEGETATION_KINDS,
  VEGETATION_RENDER_MODES,
  VEGETATION_SHADOW_MODES,
  createVegetationSpeciesId,
  normalizeVegetationLibrary,
  normalizeVegetationSpecies,
} from './vegetationRegistry.js';
import { TEXTURE_ATLASES } from './textureAtlasRegistry.js';
import { createAtlasButtonStyle, deepClone } from './editorShared.js';
import {
  buildTreeTrunkMesh,
  createTreeLeafInstanceData,
  normalizeTreeBuilder,
} from '../world/VegetationTreeBuilder.js';
import {
  addInlineButton,
  createNumberField,
  createSection,
  styleField,
} from './ui/fields.js';

function disposeMaterial(material) {
  if (!material) return;
  material.dispose?.();
  material.customDepthMaterial?.dispose?.();
  material.customDistanceMaterial?.dispose?.();
}

function disposeObject3D(root) {
  root?.traverse((child) => {
    if (child.geometry && !child.geometry.userData?.isVegetationPreviewCachedGeometry) {
      child.geometry.dispose?.();
    }
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => disposeMaterial(material));
    } else {
      disposeMaterial(child.material);
    }
  });
}

function createPreviewClumpGeometry(cardCount = 3) {
  const cards = [];
  const safeCount = Math.max(1, Math.trunc(cardCount) || 1);
  for (let index = 0; index < safeCount; index += 1) {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    geometry.translate(0, 0.5, 0);
    geometry.rotateY((index / safeCount) * Math.PI);
    cards.push(geometry);
  }
  const merged = mergeGeometries(cards, false);
  cards.forEach((geometry) => geometry.dispose());
  merged.computeVertexNormals();
  merged.userData.isVegetationPreviewCachedGeometry = true;
  return merged;
}

function createPreviewSeed(value) {
  const input = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneGlbMaterials(root) {
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material?.clone())
      : child.material.clone();
  });
}

export class VegetationEditorDialog {
  constructor({
    room,
    textureAtlases,
    OrbitControls,
    getGlbAssets,
    onUploadGlb,
    onSaveLibrary,
  }) {
    this.room = room;
    this.textureAtlases = textureAtlases ?? TEXTURE_ATLASES;
    this.OrbitControls = OrbitControls;
    this.getGlbAssets = getGlbAssets ?? (() => []);
    this.onUploadGlb = onUploadGlb;
    this.onSaveLibrary = onSaveLibrary;
    this.library = normalizeVegetationLibrary(DEFAULT_VEGETATION_LIBRARY);
    this.speciesId = this.library.species[0]?.id ?? null;
    this.activeTextureAtlasId = this.textureAtlases[0]?.id ?? TEXTURE_ATLASES[0]?.id ?? 'textures';
    this.geometryCache = new Map();
    this._previewToken = 0;
    this._raf = 0;

    this._createUI();
    this._createScene();
  }

  open(library, speciesId = null) {
    this.library = normalizeVegetationLibrary(library ?? DEFAULT_VEGETATION_LIBRARY);
    if (!this.library.species.length) {
      this.library.species.push(normalizeVegetationSpecies({
        id: createVegetationSpeciesId(),
        name: 'Vegetation Species',
      }));
    }
    this.speciesId = speciesId ?? this.library.species[0]?.id ?? null;
    this.overlay.style.display = 'grid';
    this._syncSpeciesOptions();
    this._syncForm();
    this._resizeRenderer();
    this._startLoop();
  }

  close() {
    this.overlay.style.display = 'none';
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _createUI() {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '165',
      display: 'none',
      gridTemplateColumns: 'minmax(440px, 1fr) 380px',
      background: 'rgba(0,0,0,0.68)',
      backdropFilter: 'blur(8px)',
    });

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
      background: 'linear-gradient(180deg, rgba(41,56,44,1) 0%, rgba(18,18,15,1) 100%)',
      boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
    });
    this.viewportWrap.appendChild(this.canvas);

    const hint = document.createElement('div');
    hint.textContent = 'Vegetation Preview: orbit to inspect crossed cards, GLBs, scale, and silhouette.';
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
      background: 'rgba(12, 10, 9, 0.95)',
      color: '#f7efe5',
      fontFamily: 'monospace',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
    });
    this.overlay.appendChild(this.panel);

    const title = document.createElement('div');
    title.textContent = 'VEGETATION LIBRARY';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      color: '#c8f3a4',
      marginBottom: '10px',
    });
    this.panel.appendChild(title);

    this.speciesSelect = document.createElement('select');
    styleField(this.speciesSelect);
    this.speciesSelect.addEventListener('change', () => {
      this.speciesId = this.speciesSelect.value || null;
      this._syncForm();
    });
    this.panel.appendChild(this.speciesSelect);

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      gap: '8px',
      marginTop: '10px',
    });
    this.panel.appendChild(actions);

    addInlineButton(actions, 'New', () => this._newSpecies());
    addInlineButton(actions, 'Clone', () => this._cloneSpecies());
    addInlineButton(actions, 'Delete', () => this._deleteSpecies(), '#5d221f');
    addInlineButton(actions, 'Save', () => this._saveLibrary(), '#23472d');
    addInlineButton(actions, 'Close', () => this.close());

    const basics = createSection(this.panel, 'Species');
    this.nameInput = this._createTextField(basics, 'Name', (value) => {
      this._updateSpecies((species) => {
        species.name = value || 'Vegetation Species';
      });
    });
    this.kindSelect = this._createSelectField(basics, 'Kind', VEGETATION_KINDS, (value) => {
      this._updateSpecies((species) => {
        species.kind = value;
      });
    });
    this.renderModeSelect = this._createSelectField(basics, 'Render Mode', VEGETATION_RENDER_MODES, (value) => {
      this._updateSpecies((species) => {
        species.renderMode = value;
      });
    });
    this.assetSelect = this._createSelectField(basics, 'GLB Asset', [], (value) => {
      this._updateSpecies((species) => {
        species.assetId = value || null;
      });
    }, { placeholder: 'None' });

    const cards = createSection(this.panel, 'Cards');
    this.atlasSelect = this._createSelectField(
      cards,
      'Atlas',
      this.textureAtlases.map((atlas) => atlas.id),
      (value) => {
        this._updateSpecies((species) => {
          species.atlas = value;
        });
      },
    );
    this.textureAtlasTabs = document.createElement('div');
    Object.assign(this.textureAtlasTabs.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginTop: '8px',
    });
    cards.appendChild(this.textureAtlasTabs);

    this.paletteGrid = document.createElement('div');
    Object.assign(this.paletteGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      gap: '6px',
      marginTop: '8px',
    });
    cards.appendChild(this.paletteGrid);

    this.paletteHint = document.createElement('div');
    Object.assign(this.paletteHint.style, {
      marginTop: '8px',
      color: '#c9d8b5',
      fontSize: '11px',
      lineHeight: '1.4',
      whiteSpace: 'pre-wrap',
    });
    cards.appendChild(this.paletteHint);

    this.cellsInput = this._createTextField(cards, 'Cells (comma-separated)', (value) => {
      this._updateSpecies((species) => {
        species.cells = value.split(',').map((entry) => Number(entry.trim())).filter(Number.isFinite);
      });
    });
    this.cardCountInput = createNumberField(cards, 'Card Count', { step: 1, min: 1, max: 8, value: '3' }, (value) => {
      this._updateSpecies((species) => {
        species.cardCount = value ?? 3;
      });
    }, { topLevel: true });
    this.lineSpacingInput = createNumberField(cards, 'Line Spacing', { step: 0.05, min: 0.05, value: '0.45' }, (value) => {
      this._updateSpecies((species) => {
        species.lineSpacing = value ?? 0.45;
      });
    }, { topLevel: true });

    this.treeSection = createSection(this.panel, 'Tree Builder');
    this.treeActions = document.createElement('div');
    Object.assign(this.treeActions.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '8px',
      marginBottom: '8px',
    });
    this.treeSection.appendChild(this.treeActions);
    addInlineButton(this.treeActions, 'Save Trunk GLB', () => {
      void this._saveTreeTrunkGlb();
    }, '#4a3321');
    addInlineButton(this.treeActions, 'Reset Tree', () => {
      this._updateSpecies((species) => {
        species.treeBuilder = normalizeTreeBuilder({});
      });
    });

    this.treeAssetNameInput = this._createTextField(this.treeSection, 'Trunk Asset Name', (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunkAssetName = value || 'tree-trunk';
      });
    });
    this.treeTrunkHeightInput = createNumberField(this.treeSection, 'Trunk Height', { step: 0.05, min: 0.2, value: '2.2' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.height = value ?? 2.2;
      });
    }, { topLevel: true });
    this.treeTrunkBaseRadiusInput = createNumberField(this.treeSection, 'Base Radius', { step: 0.01, min: 0.02, value: '0.24' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.radiusBase = value ?? 0.24;
      });
    }, { topLevel: true });
    this.treeTrunkTopRadiusInput = createNumberField(this.treeSection, 'Top Radius', { step: 0.01, min: 0.01, value: '0.14' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.radiusTop = value ?? 0.14;
      });
    }, { topLevel: true });
    this.treeTrunkSidesInput = createNumberField(this.treeSection, 'Trunk Sides', { step: 1, min: 3, max: 16, value: '6' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.radialSegments = value ?? 6;
      });
    }, { topLevel: true });
    this.treeTrunkCutsInput = createNumberField(this.treeSection, 'Trunk Cuts', { step: 1, min: 1, max: 12, value: '4' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.heightSegments = value ?? 4;
      });
    }, { topLevel: true });
    this.treeLeanXInput = createNumberField(this.treeSection, 'Lean X', { step: 0.01, min: -1.5, max: 1.5, value: '0' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.leanX = value ?? 0;
      });
    }, { topLevel: true });
    this.treeLeanZInput = createNumberField(this.treeSection, 'Lean Z', { step: 0.01, min: -1.5, max: 1.5, value: '0' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.leanZ = value ?? 0;
      });
    }, { topLevel: true });
    this.treeTrunkColorInput = this._createColorField(this.treeSection, 'Trunk Color', (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.trunk.color = value;
      });
    });
    this.treeBranchSection = createSection(this.treeSection, 'Branch Crown');
    this.treeBranchStartInput = createNumberField(this.treeBranchSection, 'Branch Start', { step: 0.05, min: 0.05, value: '1.45' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.startY = value ?? 1.45;
      });
    }, { topLevel: true });
    this.treeBranchZoneHeightInput = createNumberField(this.treeBranchSection, 'Branch Zone', { step: 0.05, min: 0.05, value: '0.5' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.zoneHeight = value ?? 0.5;
      });
    }, { topLevel: true });
    this.treeBranchCountInput = createNumberField(this.treeBranchSection, 'Branch Count', { step: 1, min: 1, max: 24, value: '7' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.count = value ?? 7;
      });
    }, { topLevel: true });
    this.treeBranchLevelsInput = createNumberField(this.treeBranchSection, 'Branch Levels', { step: 1, min: 1, max: 5, value: '3' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.levels = value ?? 3;
      });
    }, { topLevel: true });
    this.treeBranchChildrenMinInput = createNumberField(this.treeBranchSection, 'Children Min', { step: 1, min: 1, max: 4, value: '1' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.childrenMin = value ?? 1;
      });
    }, { topLevel: true });
    this.treeBranchChildrenMaxInput = createNumberField(this.treeBranchSection, 'Children Max', { step: 1, min: 1, max: 5, value: '2' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.childrenMax = value ?? 2;
      });
    }, { topLevel: true });
    this.treeBranchLengthMinInput = createNumberField(this.treeBranchSection, 'Branch Length Min', { step: 0.05, min: 0.05, value: '0.55' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.lengthMin = value ?? 0.55;
      });
    }, { topLevel: true });
    this.treeBranchLengthMaxInput = createNumberField(this.treeBranchSection, 'Branch Length Max', { step: 0.05, min: 0.05, value: '1.1' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.lengthMax = value ?? 1.1;
      });
    }, { topLevel: true });
    this.treeBranchPitchInput = createNumberField(this.treeBranchSection, 'Branch Pitch', { step: 0.01, min: -0.6, max: 1.2, value: '0.48' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.pitch = value ?? 0.48;
      });
    }, { topLevel: true });
    this.treeBranchDroopInput = createNumberField(this.treeBranchSection, 'Branch Droop', { step: 0.01, min: -0.4, max: 0.9, value: '0.16' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.droop = value ?? 0.16;
      });
    }, { topLevel: true });
    this.treeBranchRadiusScaleInput = createNumberField(this.treeBranchSection, 'Branch Thickness', { step: 0.01, min: 0.05, max: 0.95, value: '0.28' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.radiusScale = value ?? 0.28;
      });
    }, { topLevel: true });
    this.treeBranchChildLengthScaleInput = createNumberField(this.treeBranchSection, 'Child Length', { step: 0.01, min: 0.2, max: 0.95, value: '0.62' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.childLengthScale = value ?? 0.62;
      });
    }, { topLevel: true });
    this.treeBranchChildRadiusScaleInput = createNumberField(this.treeBranchSection, 'Child Thickness', { step: 0.01, min: 0.2, max: 0.98, value: '0.72' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.childRadiusScale = value ?? 0.72;
      });
    }, { topLevel: true });
    this.treeBranchForkStartInput = createNumberField(this.treeBranchSection, 'Fork Start', { step: 0.01, min: 0.05, max: 0.95, value: '0.42' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.forkStart = value ?? 0.42;
      });
    }, { topLevel: true });
    this.treeBranchSpreadInput = createNumberField(this.treeBranchSection, 'Branch Spread', { step: 0.01, min: 0.05, max: 1.8, value: '0.72' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.branches ||= normalizeTreeBuilder({}).branches;
        species.treeBuilder.branches.spread = value ?? 0.72;
      });
    }, { topLevel: true });
    this.treeCanopyRadiusInput = createNumberField(this.treeSection, 'Canopy Radius', { step: 0.05, min: 0.1, value: '1.2' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.canopy.radius = value ?? 1.2;
      });
    }, { topLevel: true });
    this.treeCanopyHeightInput = createNumberField(this.treeSection, 'Canopy Height', { step: 0.05, min: 0.1, value: '1.6' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.canopy.height = value ?? 1.6;
      });
    }, { topLevel: true });
    this.treeCanopyOffsetInput = createNumberField(this.treeSection, 'Canopy Lift', { step: 0.05, min: 0, value: '2' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.canopy.offsetY = value ?? 2;
      });
    }, { topLevel: true });
    this.treeLeafCountInput = createNumberField(this.treeSection, 'Leaf Clumps', { step: 1, min: 1, max: 128, value: '28' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.leaves.count = value ?? 28;
      });
    }, { topLevel: true });
    this.treeLeafWidthMinInput = createNumberField(this.treeSection, 'Leaf Width Min', { step: 0.01, min: 0.02, value: '0.35' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.leaves.widthMin = value ?? 0.35;
      });
    }, { topLevel: true });
    this.treeLeafWidthMaxInput = createNumberField(this.treeSection, 'Leaf Width Max', { step: 0.01, min: 0.02, value: '0.65' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.leaves.widthMax = value ?? 0.65;
      });
    }, { topLevel: true });
    this.treeLeafHeightMinInput = createNumberField(this.treeSection, 'Leaf Height Min', { step: 0.01, min: 0.02, value: '0.45' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.leaves.heightMin = value ?? 0.45;
      });
    }, { topLevel: true });
    this.treeLeafHeightMaxInput = createNumberField(this.treeSection, 'Leaf Height Max', { step: 0.01, min: 0.02, value: '0.85' }, (value) => {
      this._updateSpecies((species) => {
        species.treeBuilder ||= normalizeTreeBuilder({});
        species.treeBuilder.leaves.heightMax = value ?? 0.85;
      });
    }, { topLevel: true });

    const size = createSection(this.panel, 'Size');
    this.widthMinInput = createNumberField(size, 'Width Min', { step: 0.01, min: 0.01, value: '0.18' }, (value) => {
      this._updateSpecies((species) => {
        species.size.widthMin = value ?? 0.18;
      });
    }, { topLevel: true });
    this.widthMaxInput = createNumberField(size, 'Width Max', { step: 0.01, min: 0.01, value: '0.28' }, (value) => {
      this._updateSpecies((species) => {
        species.size.widthMax = value ?? 0.28;
      });
    }, { topLevel: true });
    this.heightMinInput = createNumberField(size, 'Height Min', { step: 0.01, min: 0.01, value: '0.35' }, (value) => {
      this._updateSpecies((species) => {
        species.size.heightMin = value ?? 0.35;
      });
    }, { topLevel: true });
    this.heightMaxInput = createNumberField(size, 'Height Max', { step: 0.01, min: 0.01, value: '0.6' }, (value) => {
      this._updateSpecies((species) => {
        species.size.heightMax = value ?? 0.6;
      });
    }, { topLevel: true });

    const wind = createSection(this.panel, 'Wind');
    this.windAmpInput = createNumberField(wind, 'Amplitude', { step: 0.01, min: 0, value: '0.08' }, (value) => {
      this._updateSpecies((species) => {
        species.wind.amp = value ?? 0;
      });
    }, { topLevel: true });
    this.windFreqInput = createNumberField(wind, 'Frequency', { step: 0.05, min: 0, value: '1.4' }, (value) => {
      this._updateSpecies((species) => {
        species.wind.freq = value ?? 1.4;
      });
    }, { topLevel: true });
    this.windStiffnessInput = createNumberField(wind, 'Stiffness', { step: 0.05, min: 0, value: '0.8' }, (value) => {
      this._updateSpecies((species) => {
        species.wind.stiffness = value ?? 0.8;
      });
    }, { topLevel: true });

    const rendering = createSection(this.panel, 'Rendering');
    this.shadowSelect = this._createSelectField(rendering, 'Shadow', VEGETATION_SHADOW_MODES, (value) => {
      this._updateSpecies((species) => {
        species.shadow = value;
      });
    });
    this.collisionSelect = this._createSelectField(rendering, 'Collision', VEGETATION_COLLISION_MODES, (value) => {
      this._updateSpecies((species) => {
        species.collision = value;
      });
    });

    this.status = document.createElement('div');
    Object.assign(this.status.style, {
      marginTop: '12px',
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
    this.scene.background = new THREE.Color('#243126');
    this.scene.fog = new THREE.Fog('#243126', 6, 18);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(3.8, 3.1, 4.2);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.controls = new this.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.8, 0);

    const ambient = new THREE.HemisphereLight('#e8f3db', '#34291f', 1.1);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight('#ffe0b8', 2.0);
    sun.position.set(5, 7, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 24;
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    this.scene.add(sun);

    this.previewRoot = new THREE.Group();
    this.scene.add(this.previewRoot);

    window.addEventListener('resize', () => {
      if (this.overlay.style.display !== 'none') {
        this._resizeRenderer();
      }
    });
  }

  _createTextField(parent, label, onChange) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    Object.assign(wrap.style, {
      display: 'grid',
      gap: '4px',
      color: '#d7c5a7',
      marginTop: '8px',
    });
    const input = document.createElement('input');
    input.type = 'text';
    styleField(input);
    input.addEventListener('input', () => onChange(input.value));
    wrap.appendChild(input);
    parent.appendChild(wrap);
    input._wrap = wrap;
    return input;
  }

  _createColorField(parent, label, onChange) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    Object.assign(wrap.style, {
      display: 'grid',
      gap: '4px',
      color: '#d7c5a7',
      marginTop: '8px',
    });
    const input = document.createElement('input');
    input.type = 'color';
    styleField(input);
    input.addEventListener('input', () => onChange(input.value));
    wrap.appendChild(input);
    parent.appendChild(wrap);
    input._wrap = wrap;
    return input;
  }

  _createSelectField(parent, label, values, onChange, { placeholder = null } = {}) {
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
    if (placeholder != null) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.appendChild(option);
    }
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    parent.appendChild(wrap);
    select._wrap = wrap;
    return select;
  }

  _selectedSpecies() {
    return this.library.species.find((species) => species.id === this.speciesId) ?? null;
  }

  _setStatus(message, isError = false) {
    this.status.textContent = message;
    this.status.style.color = isError ? '#ffb4a6' : '#9ee8b2';
  }

  _syncSpeciesOptions() {
    const previous = this.speciesId;
    this.speciesSelect.innerHTML = '';
    this.library.species.forEach((species) => {
      const option = document.createElement('option');
      option.value = species.id;
      option.textContent = species.name;
      this.speciesSelect.appendChild(option);
    });
    this.speciesId = this.library.species.some((species) => species.id === previous)
      ? previous
      : this.library.species[0]?.id ?? null;
    if (this.speciesId) {
      this.speciesSelect.value = this.speciesId;
    }
  }

  _syncAssetOptions(selectedId = this._selectedSpecies()?.assetId ?? '') {
    const assets = this.getGlbAssets() ?? [];
    this.assetSelect.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'None';
    this.assetSelect.appendChild(empty);
    assets.forEach((asset) => {
      const option = document.createElement('option');
      option.value = asset.id;
      option.textContent = asset.name;
      this.assetSelect.appendChild(option);
    });
    this.assetSelect.value = selectedId || '';
  }

  _activeTextureAtlas() {
    return this.textureAtlases.find((atlas) => atlas.id === this.activeTextureAtlasId)
      ?? this.textureAtlases[0]
      ?? TEXTURE_ATLASES[0];
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
        this._updateSpecies((species) => {
          species.atlas = atlas.id;
        });
      });
      this.textureAtlasTabs.appendChild(button);
    });
  }

  _renderPalette() {
    if (!this.paletteGrid) return;
    this.paletteGrid.innerHTML = '';
    const species = this._selectedSpecies();
    const isCards = species?.renderMode === 'instancedCards' || species?.kind === 'tree';
    const activeAtlas = this._activeTextureAtlas();
    const columns = activeAtlas.manifest?.grid?.columns ?? 10;
    const rows = activeAtlas.manifest?.grid?.rows ?? 10;
    const cells = activeAtlas.manifest?.cells ?? [];

    this.textureAtlasTabs.style.display = isCards ? 'flex' : 'none';
    this.paletteGrid.style.display = isCards ? 'grid' : 'none';
    this.paletteHint.style.display = isCards ? 'block' : 'none';

    if (!isCards) {
      this.paletteHint.textContent = '';
      return;
    }

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
        this._toggleSpeciesCell(cell.index, activeAtlas.id);
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

    this._highlightPalette();
  }

  _highlightPalette() {
    const species = this._selectedSpecies();
    const isCards = species?.renderMode === 'instancedCards' || species?.kind === 'tree';
    const selectedCells = new Set((species?.cells ?? []).map((cell) => String(cell)));
    this.paletteGrid?.querySelectorAll('button').forEach((button) => {
      const isSelected = button.dataset.atlasId === (species?.atlas ?? this.activeTextureAtlasId)
        && selectedCells.has(button.dataset.cellIndex);
      button.style.outline = isSelected ? '2px solid #ffe39d' : 'none';
    });
    if (this.paletteHint) {
      const activeAtlas = this._activeTextureAtlas();
      this.paletteHint.textContent = isCards
        ? `${species?.kind === 'tree' ? 'Leaf' : 'Card'} atlas ${activeAtlas.label} | click tiles to toggle them into this species.\nSelected: ${(species?.cells ?? []).join(', ')}`
        : '';
    }
  }

  _toggleSpeciesCell(cellIndex, atlasId) {
    this._updateSpecies((species) => {
      species.atlas = atlasId;
      const nextCells = Array.isArray(species.cells) ? [...species.cells] : [];
      const currentIndex = nextCells.indexOf(cellIndex);
      if (currentIndex >= 0) {
        if (nextCells.length > 1) {
          nextCells.splice(currentIndex, 1);
        }
      } else {
        nextCells.push(cellIndex);
        nextCells.sort((a, b) => a - b);
      }
      species.cells = nextCells;
    });
  }

  _syncForm() {
    this._syncSpeciesOptions();
    const species = this._selectedSpecies();
    if (!species) return;

    this._syncAssetOptions(species.assetId ?? '');
    this.activeTextureAtlasId = species.atlas ?? this.activeTextureAtlasId;

    this.nameInput.value = species.name;
    this.kindSelect.value = species.kind;
    this.renderModeSelect.value = species.renderMode;
    this.atlasSelect.value = species.atlas;
    this.cellsInput.value = species.cells.join(', ');
    this.cardCountInput.value = String(species.cardCount);
    this.lineSpacingInput.value = String(species.lineSpacing ?? 0.45);
    this.widthMinInput.value = String(species.size.widthMin);
    this.widthMaxInput.value = String(species.size.widthMax);
    this.heightMinInput.value = String(species.size.heightMin);
    this.heightMaxInput.value = String(species.size.heightMax);
    this.windAmpInput.value = String(species.wind.amp);
    this.windFreqInput.value = String(species.wind.freq);
    this.windStiffnessInput.value = String(species.wind.stiffness);
    this.shadowSelect.value = species.shadow;
    this.collisionSelect.value = species.collision;
    this.assetSelect.value = species.assetId ?? '';

    const treeBuilder = normalizeTreeBuilder(species.treeBuilder);
    const cardsVisible = species.renderMode === 'instancedCards' || species.kind === 'tree';
    [
      this.atlasSelect,
      this.cellsInput,
      this.cardCountInput,
    ].forEach((field) => {
      field._wrap.style.display = cardsVisible ? 'grid' : 'none';
    });
    this.lineSpacingInput._wrap.style.display = 'grid';
    this.assetSelect._wrap.style.display = species.renderMode === 'instancedCards' ? 'none' : 'grid';
    this.treeSection.style.display = species.kind === 'tree' ? 'block' : 'none';
    this.treeAssetNameInput.value = treeBuilder.trunkAssetName;
    this.treeTrunkHeightInput.value = String(treeBuilder.trunk.height);
    this.treeTrunkBaseRadiusInput.value = String(treeBuilder.trunk.radiusBase);
    this.treeTrunkTopRadiusInput.value = String(treeBuilder.trunk.radiusTop);
    this.treeTrunkSidesInput.value = String(treeBuilder.trunk.radialSegments);
    this.treeTrunkCutsInput.value = String(treeBuilder.trunk.heightSegments);
    this.treeLeanXInput.value = String(treeBuilder.trunk.leanX);
    this.treeLeanZInput.value = String(treeBuilder.trunk.leanZ);
    this.treeTrunkColorInput.value = treeBuilder.trunk.color;
    this.treeBranchStartInput.value = String(treeBuilder.branches.startY);
    this.treeBranchZoneHeightInput.value = String(treeBuilder.branches.zoneHeight);
    this.treeBranchCountInput.value = String(treeBuilder.branches.count);
    this.treeBranchLevelsInput.value = String(treeBuilder.branches.levels);
    this.treeBranchChildrenMinInput.value = String(treeBuilder.branches.childrenMin);
    this.treeBranchChildrenMaxInput.value = String(treeBuilder.branches.childrenMax);
    this.treeBranchLengthMinInput.value = String(treeBuilder.branches.lengthMin);
    this.treeBranchLengthMaxInput.value = String(treeBuilder.branches.lengthMax);
    this.treeBranchPitchInput.value = String(treeBuilder.branches.pitch);
    this.treeBranchDroopInput.value = String(treeBuilder.branches.droop);
    this.treeBranchRadiusScaleInput.value = String(treeBuilder.branches.radiusScale);
    this.treeBranchChildLengthScaleInput.value = String(treeBuilder.branches.childLengthScale);
    this.treeBranchChildRadiusScaleInput.value = String(treeBuilder.branches.childRadiusScale);
    this.treeBranchForkStartInput.value = String(treeBuilder.branches.forkStart);
    this.treeBranchSpreadInput.value = String(treeBuilder.branches.spread);
    this.treeCanopyRadiusInput.value = String(treeBuilder.canopy.radius);
    this.treeCanopyHeightInput.value = String(treeBuilder.canopy.height);
    this.treeCanopyOffsetInput.value = String(treeBuilder.canopy.offsetY);
    this.treeLeafCountInput.value = String(treeBuilder.leaves.count);
    this.treeLeafWidthMinInput.value = String(treeBuilder.leaves.widthMin);
    this.treeLeafWidthMaxInput.value = String(treeBuilder.leaves.widthMax);
    this.treeLeafHeightMinInput.value = String(treeBuilder.leaves.heightMin);
    this.treeLeafHeightMaxInput.value = String(treeBuilder.leaves.heightMax);
    this._renderTextureAtlasTabs();
    this._renderPalette();

    void this._rebuildPreview();
  }

  _updateSpecies(mutator) {
    const species = this._selectedSpecies();
    if (!species) return;
    const next = deepClone(species);
    mutator(next);
    const normalized = normalizeVegetationSpecies(next);
    const index = this.library.species.findIndex((entry) => entry.id === species.id);
    if (index < 0) return;
    this.library.species[index] = normalized;
    this.speciesId = normalized.id;
    this._syncForm();
  }

  _newSpecies() {
    const species = normalizeVegetationSpecies({
      id: createVegetationSpeciesId(),
      name: 'Vegetation Species',
    });
    this.library.species.push(species);
    this.speciesId = species.id;
    this._syncForm();
    this._setStatus(`Created ${species.name}.`);
  }

  _cloneSpecies() {
    const species = this._selectedSpecies();
    if (!species) return;
    const clone = normalizeVegetationSpecies({
      ...deepClone(species),
      id: createVegetationSpeciesId(),
      name: `${species.name} Copy`,
    });
    this.library.species.push(clone);
    this.speciesId = clone.id;
    this._syncForm();
    this._setStatus(`Cloned ${species.name}.`);
  }

  _deleteSpecies() {
    const species = this._selectedSpecies();
    if (!species) return;
    this.library.species = this.library.species.filter((entry) => entry.id !== species.id);
    if (!this.library.species.length) {
      this.library.species.push(normalizeVegetationSpecies({
        id: createVegetationSpeciesId(),
        name: 'Vegetation Species',
      }));
    }
    this.speciesId = this.library.species[0]?.id ?? null;
    this._syncForm();
    this._setStatus(`Deleted ${species.name}.`);
  }

  async _saveLibrary() {
    const payload = normalizeVegetationLibrary(this.library);
    const result = await this.onSaveLibrary?.(payload);
    if (!result?.ok) {
      this._setStatus(`Vegetation save failed: ${result?.error || 'unknown error'}`, true);
      return;
    }
    this.library = payload;
    this._syncForm();
    this._setStatus('Saved /levels/vegetation-library.json');
  }

  async _saveTreeTrunkGlb() {
    const species = this._selectedSpecies();
    if (!species || species.kind !== 'tree') return;
    if (!this.onUploadGlb) {
      this._setStatus('Tree GLB upload is unavailable in this environment.', true);
      return;
    }

    const treeBuilder = normalizeTreeBuilder(species.treeBuilder);
    const trunk = buildTreeTrunkMesh(treeBuilder);
    const root = new THREE.Group();
    root.name = `${species.name || 'tree'}_trunk`;
    root.add(trunk);

    try {
      this._setStatus(`Saving trunk GLB for ${species.name}...`);
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      const binary = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
      const safeBase = (treeBuilder.trunkAssetName || species.name || 'tree-trunk')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'tree-trunk';
      const result = await this.onUploadGlb({
        filename: `${safeBase}.glb`,
        buffer: binary,
      });
      if (!result?.ok) {
        this._setStatus(`Tree trunk upload failed: ${result?.error || 'unknown error'}`, true);
        return;
      }
      this._updateSpecies((next) => {
        next.assetId = result.entry.id;
        next.renderMode = 'glb';
      });
      this._setStatus(`Saved tree trunk GLB as ${result.entry.name}.`);
    } catch (error) {
      this._setStatus(`Tree trunk export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      disposeObject3D(root);
    }
  }

  _buildTreePreview(species) {
    const root = new THREE.Group();
    const treeBuilder = normalizeTreeBuilder(species.treeBuilder);
    const trunk = buildTreeTrunkMesh(treeBuilder);
    trunk.castShadow = species.shadow !== 'none';
    trunk.receiveShadow = true;
    root.add(trunk);

    const { matrices, params } = createTreeLeafInstanceData({
      treeBuilder,
      cells: species.cells,
      seed: createPreviewSeed(species.id),
    });
    matrices.forEach((matrix, index) => {
      const cell = Math.round(params[(index * 4) + 2]) || 0;
      const clump = new THREE.Mesh(
        this._getSharedClumpGeometry(species.cardCount ?? 2),
        this._createCardMaterial(species, cell),
      );
      clump.applyMatrix4(matrix);
      clump.matrix.decompose(clump.position, clump.quaternion, clump.scale);
      clump.rotation.order = 'YXZ';
      clump.castShadow = species.shadow !== 'none';
      clump.receiveShadow = true;
      clump.userData.previewWind = {
        baseX: clump.rotation.x,
        baseZ: clump.rotation.z,
        phase: params[(index * 4) + 0],
        amp: (species.wind?.amp ?? 0.02) * params[(index * 4) + 1] * 0.4,
        freq: species.wind?.freq ?? 0.5,
      };
      root.add(clump);
    });
    return root;
  }

  _clearPreview() {
    this.previewRoot.children.forEach((child) => disposeObject3D(child));
    this.previewRoot.clear();
  }

  _getSharedClumpGeometry(cardCount) {
    const key = Math.max(1, Math.trunc(cardCount) || 1);
    if (!this.geometryCache.has(key)) {
      this.geometryCache.set(key, createPreviewClumpGeometry(key));
    }
    return this.geometryCache.get(key);
  }

  _buildPreviewFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 48),
      new THREE.MeshStandardMaterial({
        color: '#708260',
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.receiveShadow = true;
    this.previewRoot.add(floor);

    const grid = new THREE.GridHelper(6.2, 12, '#c7d8a8', '#55634d');
    grid.position.y = 0.002;
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    this.previewRoot.add(grid);
  }

  _createCardMaterial(species, cell) {
    const texture = this.room?._createAtlasTexture?.(cell ?? 0, species.atlas);
    const material = new THREE.MeshStandardMaterial({
      map: texture ?? null,
      color: '#ffffff',
      side: THREE.DoubleSide,
      alphaTest: 0.45,
      transparent: false,
      roughness: 0.9,
      metalness: 0.02,
    });
    material.alphaToCoverage = true;
    return material;
  }

  _buildCardsPreview(species) {
    const root = new THREE.Group();
    const rng = mulberry32(createPreviewSeed(species.id));
    const count = species.kind === 'tree' ? 3 : species.kind === 'hedge' ? 6 : 8;

    for (let index = 0; index < count; index += 1) {
      const cell = species.cells[index % Math.max(1, species.cells.length)] ?? 0;
      const clump = new THREE.Mesh(
        this._getSharedClumpGeometry(species.cardCount ?? 3),
        this._createCardMaterial(species, cell),
      );
      const width = species.size.widthMin + rng() * Math.max(0.001, species.size.widthMax - species.size.widthMin);
      const height = species.size.heightMin + rng() * Math.max(0.001, species.size.heightMax - species.size.heightMin);
      const radius = species.kind === 'hedge' ? 1.4 : 1 + rng() * 0.75;
      const angle = species.kind === 'hedge'
        ? -1.1 + (index / Math.max(1, count - 1)) * 2.2
        : (index / count) * Math.PI * 2;
      clump.position.set(
        species.kind === 'hedge' ? angle * 1.1 : Math.cos(angle) * radius,
        0,
        species.kind === 'hedge' ? (rng() - 0.5) * 0.25 : Math.sin(angle) * radius,
      );
      clump.rotation.set(0, rng() * Math.PI, 0);
      clump.scale.set(width, height, width);
      clump.castShadow = species.shadow !== 'none';
      clump.receiveShadow = true;
      clump.userData.previewWind = {
        baseX: (rng() - 0.5) * 0.1,
        baseZ: (rng() - 0.5) * 0.1,
        phase: rng() * Math.PI * 2,
        amp: (species.wind?.amp ?? 0.08) * (0.45 + rng() * 0.35),
        freq: species.wind?.freq ?? 1.4,
      };
      root.add(clump);
    }

    return root;
  }

  _buildFallbackTree(species) {
    const root = new THREE.Group();

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 1.4, 12),
      new THREE.MeshStandardMaterial({
        color: '#70523a',
        roughness: 0.95,
        metalness: 0,
      }),
    );
    trunk.position.y = 0.7;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    root.add(trunk);

    const canopy = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.95, 1),
      new THREE.MeshStandardMaterial({
        color: '#7aa35a',
        roughness: 0.92,
        metalness: 0,
      }),
    );
    canopy.position.y = 1.8;
    canopy.castShadow = species.shadow !== 'none';
    canopy.receiveShadow = true;
    canopy.scale.set(
      species.size.widthMin + species.size.widthMax,
      species.size.heightMin * 0.4 + species.size.heightMax * 0.25,
      species.size.widthMin + species.size.widthMax,
    );
    canopy.userData.previewWind = {
      baseX: 0,
      baseZ: 0,
      phase: 0,
      amp: (species.wind?.amp ?? 0.02) * 0.18,
      freq: species.wind?.freq ?? 0.5,
    };
    root.add(canopy);
    return root;
  }

  async _buildGlbPreview(species) {
    if (!species.assetId) {
      this._setStatus('Previewing placeholder tree until a GLB asset is assigned.');
      return this._buildFallbackTree(species);
    }

    const source = await this.room.loadGlbModel(species.assetId);
    if (!source) {
      this._setStatus(`Failed to load ${species.assetId}; showing placeholder instead.`, true);
      return this._buildFallbackTree(species);
    }

    const root = new THREE.Group();
    const clone = source.clone(true);
    cloneGlbMaterials(clone);
    clone.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = species.shadow !== 'none';
      child.receiveShadow = true;
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    clone.position.sub(center);
    clone.position.y -= box.min.y;
    const targetHeight = (species.size.heightMin + species.size.heightMax) * 0.5;
    const scalar = targetHeight / Math.max(0.001, size.y);
    clone.scale.setScalar(scalar);
    root.add(clone);
    return root;
  }

  _framePreview(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z, 1);
    this.controls.target.set(center.x, Math.max(0.4, center.y * 0.65), center.z);
    this.camera.position.set(
      center.x + radius * 1.4,
      center.y + radius * 1.05,
      center.z + radius * 1.55,
    );
    this.camera.lookAt(this.controls.target);
  }

  async _rebuildPreview() {
    const species = this._selectedSpecies();
    const token = ++this._previewToken;
    this._clearPreview();
    if (!species) return;

    this._buildPreviewFloor();

    const preview = species.kind === 'tree'
      ? this._buildTreePreview(species)
      : species.renderMode === 'instancedCards'
        ? this._buildCardsPreview(species)
        : await this._buildGlbPreview(species);
    if (token !== this._previewToken) {
      disposeObject3D(preview);
      return;
    }

    this.previewRoot.add(preview);
    this._framePreview(preview);
    this._setStatus(`Previewing ${species.name}.`);
  }

  _resizeRenderer() {
    const rect = this.viewportWrap.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  _animatePreview(timeSeconds) {
    this.previewRoot.traverse((child) => {
      const sway = child.userData?.previewWind;
      if (!sway) return;
      child.rotation.x = sway.baseX + Math.sin(timeSeconds * sway.freq + sway.phase) * sway.amp;
      child.rotation.z = sway.baseZ + Math.cos(timeSeconds * sway.freq * 0.8 + sway.phase * 0.7) * sway.amp * 0.6;
    });
  }

  _startLoop() {
    if (this._raf) return;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this.controls.update();
      this._animatePreview(performance.now() * 0.001);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }
}
