import * as THREE from 'three';
import { FACE_TEXTURE_SLOTS } from '../dev/prefabRegistry.js';
import {
  DEFAULT_TEXTURE_ATLAS,
  TEXTURE_ATLASES,
} from '../dev/textureAtlasRegistry.js';
import { assetUrl } from '../utils/assetUrl.js';
import { VegetationSystem } from './VegetationSystem.js';
import {
  applySharedGlbSurfaceMaterial,
  applyTextureAtlas,
  bakeUvTransform,
  createAtlasTexture,
  createEditablePrimitiveMaterial,
  createSurfaceMaterial,
  disposeEditableMaterial,
  disposeEditableMaterialSet,
  getEditableGeometry,
  getFaceTextureRef,
  loadTextureAtlas,
  rebakeMeshUvs,
  shouldUseSharedGlbSurfaceMaterial,
} from './surfaceMaterialSystem.js';
import {
  buildFloorAndWalls as buildRoomFloorAndWalls,
  buildRoomBuiltIns,
} from './roomBuiltIns.js';
import {
  createCeilingFanObject,
  createExtractionPortalHelperObject,
  createLightHelperMesh,
  createPortalHelperObject,
  createRaidTaskHelperObject,
  createRopeHelperObject,
  EXTRACTION_HELPER_BASE_RADIUS,
} from './editableHelperObjects.js';
import {
  buildStaticMergedMeshes,
  clearStaticMergedMeshes,
} from './staticMergeSystem.js';
import {
  getBuildGridAnchorPosition,
  getBuildGridConfig,
  setBuildGridSnapSize,
  snapExtractionPortalToGrid,
  snapFanToGrid,
  snapLightToGrid,
  snapPortalToGrid,
  snapPrimitiveToGrid,
  snapRaidTaskToGrid,
  snapRopeToGrid,
  snapVegetationToGrid,
} from './buildGridSnap.js';
import {
  isGeneratedBakePrimitiveEnabled,
  loadGlbModelByAssetId,
  streamGlbModels,
} from './glbModelSystem.js';
import {
  cloneVectorLike,
  colorToHex,
  materialToEditableSurface,
  normalizeEditableExtractionPortal,
  normalizeEditableFan,
  normalizeEditableLight,
  normalizeEditablePortal,
  normalizeEditablePrimitive,
  normalizeEditableRaidTask,
  normalizeEditableRope,
  normalizeEditableVegetation,
  normalizeTextureSettings,
} from './editableLayoutNormalize.js';
import { installMeshBvhSupport } from '../physics/meshBvhSupport.js';
import { normalizeNavArea } from '../../shared/navConfig.js';
import {
  DEFAULT_ROPE_CARD_OPACITY,
  DEFAULT_ROPE_CARD_WIDTH,
  DEFAULT_ROPE_COLOR,
} from '../../shared/ropes.js';
import {
  LEVEL_BUILD_GRID_COLUMNS,
  LEVEL_BUILD_GRID_ROWS,
  LEVEL_ROOM_DEPTH,
  LEVEL_ROOM_WIDTH,
} from '../../shared/levelWorldBounds.js';
import { normalizeSpawnType } from '../../shared/spawnPoints.js';
import {
  cloneLayout,
  worldToLocalPrefabPosition,
} from './roomUtils.js';
import {
  checkRoomCollision,
  getRoomClimbables,
  getRoomCollisionColliders,
  getRoomRunnables,
  refreshRoomColliders,
  registerPrimitiveRoomCollider,
  registerRoomCollider,
} from './roomColliderSystem.js';
import {
  getRoomEditableLayout,
  getRoomEditableRopeDefinitions,
  getRoomVibePortalPlacements,
  isRoomPrimitiveVisible,
  setRoomEditableLayout,
  setRoomExtractionHelpersVisible,
  setRoomPortalHelpersVisible,
  setRoomRaidTaskHelpersVisible,
  setRoomRaidTaskPrefabEditorPreview,
  setRoomRaidTaskPrefabEditTarget,
  setRoomSpawnMarkersVisible,
} from './roomEditableLayoutState.js';
import {
  updateRoomEditableExtractionPortalTransform,
  updateRoomEditableFanTransform,
  updateRoomEditableLightTransform,
  updateRoomEditablePortalTransform,
  updateRoomEditablePrimitiveTransform,
  updateRoomEditableRaidTaskTransform,
  updateRoomEditableRopeTransform,
  updateRoomEditableVegetationTransform,
  updateRoomPrefabInstanceTransform,
} from './roomEditableTransforms.js';
import {
  applyRoomFanRuntimeStates,
  updateRoomRuntimeVisuals,
} from './roomRuntimeVisuals.js';
import {
  purgeRoomEditableExtractionPortal,
  purgeRoomEditableFan,
  purgeRoomEditableLight,
  purgeRoomEditablePortal,
  purgeRoomEditablePrimitive,
  purgeRoomEditableRaidTask,
  purgeRoomEditableRope,
  purgeRoomEditableVegetation,
  removeRoomEditableExtractionPortal,
  removeRoomEditableFan,
  removeRoomEditableLight,
  removeRoomEditablePortal,
  removeRoomEditablePrimitive,
  removeRoomEditableRaidTask,
  removeRoomEditableRope,
  replaceRoomEditablePrimitive,
  setRoomRopeHelpersVisible,
  setRoomVegetationLibrary,
  upsertRoomEditableExtractionPortal,
  upsertRoomEditableFan,
  upsertRoomEditableLight,
  upsertRoomEditablePortal,
  upsertRoomEditablePrimitive,
  upsertRoomEditableRaidTask,
  upsertRoomEditableRope,
  upsertRoomEditableVegetation,
} from './roomEditableMutations.js';
import {
  getRoomEditableObject,
  instantiateRoomPrefab,
} from './roomPrefabOperations.js';
import { rebuildRoomEditableLayout } from './roomEditableRebuild.js';

const BUILD_GRID_COLUMNS = LEVEL_BUILD_GRID_COLUMNS;
const BUILD_GRID_ROWS = LEVEL_BUILD_GRID_ROWS;
const BUILD_GRID_VERTICAL_STEP = 0.25;

const DEFAULT_EDITABLE_LAYOUT = Object.freeze({
  version: 1,
  primitives: [],
  lights: [],
  portals: [],
  ropes: [],
  fans: [],
  extractionPortals: [],
  raidTasks: [],
  vegetation: [],
});

/**
 * Room class: constructs a kitchen room with furniture, collision, and loot
 */
export class Room {
  constructor(options = {}) {
    installMeshBvhSupport();
    this.group = new THREE.Group();
    this.group.name = 'Kitchen';

    this.colliders = []; // Array of { mesh, aabb, type }
    this.lootItems = []; // Array of loot meshes
    this.climbables = []; // Surfaces player can climb
    this.runnables = []; // Surfaces player can run on
    this.glbLoader = null;
    this.glbModelCache = new Map();
    this.glbRegistry = null;
    this.invalidGeneratedBakeAssetIds = new Set();

    // Room dimensions
    this.width = options.width ?? LEVEL_ROOM_WIDTH;
    this.depth = options.depth ?? LEVEL_ROOM_DEPTH;
    this.height = options.height ?? 4;
    this.scaleFactor = options.scale ?? 1;
    this.group.scale.setScalar(this.scaleFactor);
    this.textureAtlasUrls = Object.fromEntries(TEXTURE_ATLASES.map((atlas) => [
      atlas.id,
      atlas.imageUrl,
    ]));
    const defaultLevelLayoutUrl = assetUrl('levels/kitchen-layout.json');
    this.levelLayoutUrl = options.levelLayoutUrl
      ?? (import.meta.env.DEV
        ? `${defaultLevelLayoutUrl}?v=${Date.now()}`
        : defaultLevelLayoutUrl);
    this.useGeneratedBakes = options.useGeneratedBakes
      ?? (!import.meta.env.DEV || import.meta.env.VITE_DEV_USE_GENERATED_BAKES === '1');
    this.useHouseGeneratedBake = options.useHouseGeneratedBake
      ?? (import.meta.env.VITE_ENABLE_HOUSE_GENERATED_BAKE === '1');
    this.buildGrid = {
      columns: options.buildGridColumns ?? BUILD_GRID_COLUMNS,
      rows: options.buildGridRows ?? BUILD_GRID_ROWS,
      verticalStep: options.buildGridVerticalStep ?? BUILD_GRID_VERTICAL_STEP,
    };
    this.textureAtlasImage = null;
    this.textureAtlasImages = new Map();
    // Single base texture per (atlas, cell). Repeat/rotation is baked into geometry UVs
    // rather than cloned onto the texture, so every primitive sharing this cell also
    // shares one GPU texture + one material instance.
    this.textureCache = new Map();
    // BufferGeometry shared per (type, repeat.x, repeat.y, rotation, offset) — UV-transform is baked in.
    this._editableGeometryCache = new Map();
    this.surfaceMaterials = new Set();
    this.builtInEditableMeshes = new Map();
    this.deletedBuiltInPrimitives = new Set();
    this.loadedEditableLayout = cloneLayout(DEFAULT_EDITABLE_LAYOUT);
    this.editableGroup = new THREE.Group();
    this.editableGroup.name = 'EditableLayout';
    this._staticMergeEnabled = options.staticMergeEnabled !== false;
    this._staticMergedGroup = new THREE.Group();
    this._staticMergedGroup.name = 'StaticMerged';
    this.editableLayout = cloneLayout(DEFAULT_EDITABLE_LAYOUT);
    this.vegetationSystem = new VegetationSystem({ room: this });
    this.editableVegetationObjects = this.vegetationSystem.placementObjects;
    this.spawnMarkersVisible = false;
    this.lightHelpersVisible = false;
    this.portalHelpersVisible = false;
    this.ropeHelpersVisible = false;
    this.fanHelpersVisible = true;
    this.extractionHelpersVisible = false;
    this.raidTaskHelpersVisible = false;
    this.editableMeshes = new Map();
    this.editableLightObjects = new Map();
    this.editablePortalObjects = new Map();
    this.editableRopeObjects = new Map();
    this.editableFanObjects = new Map();
    this.fanRuntimeStates = new Map();
    this.editableExtractionPortalObjects = new Map();
    this.editableRaidTaskObjects = new Map();
    this.raidTaskPrefabEditTargets = new Map();
    this.prefabInstanceGroups = new Map();
    this.prefabInstanceIdByPrimitiveId = new Map();
    this.ready = Promise.all([
      this._loadTextureAtlas(),
      this._loadEditableLayout(),
    ]).then(() => {
      try {
        this._applyLoadedEditableLayout();
        if (import.meta.env.DEV) {
          console.info('[room] applied editable layout', {
            primitives: this.editableLayout.primitives.length,
            lights: this.editableLayout.lights.length,
            ropes: this.editableLayout.ropes.length,
            fans: this.editableLayout.fans.length,
            raidTasks: this.editableLayout.raidTasks.length,
          });
        }
        this._applyTextureAtlas();
        this._rebuildEditableLayout();
        this.streamGlbModels();
      } catch (error) {
        console.error('[room] failed to apply editable layout', error);
        throw error;
      }
      return this;
    }).catch((error) => {
      console.error('[room] ready failed', error);
      return this;
    });

    // Materials
    this.floorColor = options.floorColor ?? '#d4a574'; // Wood
    this.wallColor = options.wallColor ?? '#e8dcc8'; // Plaster
    this.furnitureColor = options.furnitureColor ?? '#8b6f47'; // Wood furniture

    this.buildRoom();
    this.group.add(this.editableGroup);
    this.group.add(this._staticMergedGroup);
    this.group.add(this.vegetationSystem.group);
  }

  _createSurfaceMaterial(baseColor, options = {}) {
    return createSurfaceMaterial(this, baseColor, options);
  }

  _disposeEditableMaterial(material) {
    return disposeEditableMaterial(this, material);
  }

  _disposeEditableMaterialSet(material) {
    return disposeEditableMaterialSet(this, material);
  }

  async _loadTextureAtlas() {
    return loadTextureAtlas(this);
  }

  _createAtlasTexture(cellIndex, atlas = DEFAULT_TEXTURE_ATLAS, chroma = null) {
    return createAtlasTexture(this, cellIndex, atlas, chroma);
  }

  _bakeUvTransform(geometry, settings) {
    return bakeUvTransform(geometry, settings);
  }

  _rebakeMeshUvs(mesh, settings) {
    return rebakeMeshUvs(mesh, settings);
  }

  _getEditableGeometry(primitive) {
    return getEditableGeometry(this, primitive);
  }

  _applyTextureAtlas() {
    return applyTextureAtlas(this);
  }

  _shouldUseSharedGlbSurfaceMaterial(primitive) {
    return shouldUseSharedGlbSurfaceMaterial(primitive);
  }

  _applySharedGlbSurfaceMaterial(scene, primitive) {
    return applySharedGlbSurfaceMaterial(this, scene, primitive);
  }

  async _loadEditableLayout() {
    try {
      const response = await fetch(this.levelLayoutUrl, { cache: 'no-store' });
      if (!response.ok) {
        console.warn(`[room] failed to load editable layout ${this.levelLayoutUrl}: ${response.status}`);
        return this.loadedEditableLayout;
      }
      const layout = await response.json();
      const houseRefs = JSON.stringify(layout).includes('asset-house-kitchen-layout');
      if (import.meta.env.DEV) {
        console.info('[room] loaded editable layout', {
          url: this.levelLayoutUrl,
          primitives: Array.isArray(layout?.primitives) ? layout.primitives.length : 0,
          glbs: Array.isArray(layout?.primitives)
            ? layout.primitives
              .filter((entry) => entry?.type === 'glb')
              .map((entry) => ({
                id: entry.id,
                name: entry.name,
                asset: entry.glbAssetId,
                kind: entry.generatedBakeKind ?? null,
              }))
            : [],
          houseRefs,
        });
      }
      this.loadedEditableLayout = {
        version: layout?.version ?? 1,
        primitives: Array.isArray(layout?.primitives) ? layout.primitives.map((entry) => normalizeEditablePrimitive(entry)) : [],
        lights: Array.isArray(layout?.lights) ? layout.lights.map((entry) => normalizeEditableLight(entry)) : [],
        portals: Array.isArray(layout?.portals) ? layout.portals.map((entry) => normalizeEditablePortal(entry)) : [],
        ropes: Array.isArray(layout?.ropes) ? layout.ropes.map((entry) => normalizeEditableRope(entry)) : [],
        fans: Array.isArray(layout?.fans) ? layout.fans.map((entry) => normalizeEditableFan(entry)) : [],
        extractionPortals: Array.isArray(layout?.extractionPortals)
          ? layout.extractionPortals.map((entry) => normalizeEditableExtractionPortal(entry))
          : [],
        raidTasks: Array.isArray(layout?.raidTasks)
          ? layout.raidTasks.map((entry) => normalizeEditableRaidTask(entry))
          : [],
        vegetation: Array.isArray(layout?.vegetation)
          ? layout.vegetation.map((entry) => normalizeEditableVegetation(entry))
          : [],
      };
    } catch (error) {
      console.warn(`[room] failed to load editable layout ${this.levelLayoutUrl}`, error);
      this.loadedEditableLayout = cloneLayout(DEFAULT_EDITABLE_LAYOUT);
    }

    return this.loadedEditableLayout;
  }

  async loadGlbModel(assetId) {
    return loadGlbModelByAssetId(this, assetId);
  }

  streamGlbModels() {
    return streamGlbModels(this);
  }

  /** When set on a primitive, syncs userData.cameraOccluder on all descendant meshes (see ThirdPersonCamera / OcclusionFader). */
  _syncCameraOccluderUserData(root, primitive) {
    if (!root || typeof primitive?.cameraOccluder !== 'boolean') return;
    if (primitive.cameraOccluder === false) {
      root.traverse((c) => {
        if (c.isMesh) c.userData.cameraOccluder = false;
      });
    } else {
      root.traverse((c) => {
        if (c.isMesh) delete c.userData.cameraOccluder;
      });
    }
  }

  _createEditableRopeObject(definition) {
    const rope = normalizeEditableRope(definition);
    let textureMap = null;
    if (rope.texture?.cell != null && Number.isFinite(rope.texture.cell)) {
      textureMap = this._createAtlasTexture(rope.texture.cell, rope.texture.atlas ?? DEFAULT_TEXTURE_ATLAS);
    }
    const group = createRopeHelperObject(rope, textureMap);
    group.position.set(rope.anchor.x, rope.anchor.y, rope.anchor.z);
    group.visible = this.ropeHelpersVisible && !rope.deleted;
    return { definition: rope, group };
  }

  _createEditableFanObject(definition) {
    const entry = createCeilingFanObject(definition);
    this._applyFanToObject(entry.definition, entry);
    return entry;
  }

  _applyRopeToObject(definition, entry) {
    const rope = normalizeEditableRope(definition);
    entry.definition = rope;
    entry.group.name = `${rope.name || rope.id}-rope-helper`;
    entry.group.position.set(rope.anchor.x, rope.anchor.y, rope.anchor.z);
    entry.group.rotation.set(0, 0, 0);
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = this.ropeHelpersVisible && !rope.deleted;
    entry.group.userData.ropeId = rope.id;

    const tint = new THREE.Color(rope.color ?? DEFAULT_ROPE_COLOR);
    let textureMap = null;
    if (rope.texture?.cell != null && Number.isFinite(rope.texture.cell)) {
      textureMap = this._createAtlasTexture(rope.texture.cell, rope.texture.atlas ?? DEFAULT_TEXTURE_ATLAS);
    }

    entry.group.traverse((child) => {
      if (child.userData?.ropePreviewStrand && child.isMesh) {
        child.position.y = -rope.length * 0.5;
        child.scale.y = rope.length;
        child.material.map = textureMap ?? null;
        child.material.color.set(textureMap ? 0xffffff : tint);
        child.material.needsUpdate = true;
        child.visible = rope.visualMode !== 'cards';
      } else if (child.userData?.ropePreviewCard && child.isMesh) {
        const cardWidth = rope.cards?.width ?? DEFAULT_ROPE_CARD_WIDTH;
        const cardOpacity = rope.cards?.opacity ?? DEFAULT_ROPE_CARD_OPACITY;
        child.position.y = -rope.length * 0.5;
        child.scale.set(cardWidth, rope.length, 1);
        child.material.map = textureMap ?? null;
        child.material.color.set(textureMap ? 0xffffff : tint);
        child.material.opacity = cardOpacity * 0.68;
        child.material.needsUpdate = true;
        child.visible = rope.visualMode === 'cards' || rope.visualMode === 'rope-cards' || rope.cards?.enabled === true;
      } else if (child.userData?.ropePreviewTip && child.isMesh) {
        child.position.y = -rope.length;
        child.material.color.copy(tint);
      } else if (child.userData?.ropePreviewAnchor && child.isMesh) {
        child.material.color.copy(tint).lerp(new THREE.Color('#ffb347'), 0.35);
      }
    });
    return rope;
  }

  _applyFanToObject(definition, entry) {
    const fan = normalizeEditableFan(definition);
    entry.definition = fan;
    entry.group.name = `${fan.name || fan.id}-fan`;
    entry.group.position.set(fan.position.x, fan.position.y, fan.position.z);
    entry.group.rotation.set(fan.rotation.x, fan.rotation.y, fan.rotation.z);
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = !fan.deleted;
    entry.group.userData.fanId = fan.id;
    entry.group.userData.fanSpinSpeed = fan.spinSpeed;
    entry.group.userData.fanBladeLength = fan.bladeLength;
    entry.group.userData.fanBladeWidth = fan.bladeWidth;
    entry.group.userData.fanHubRadius = fan.hubRadius;
    entry.group.userData.fanGripRingCount = fan.gripRingCount;
    if (entry.spinRoot) {
      entry.spinRoot.rotation.y = 0;
    }
    if (entry.cheeseGroup) {
      entry.cheeseGroup.visible = fan.cheeseAmount > 0;
      entry.cheeseGroup.userData.cheeseAmount = fan.cheeseAmount;
    }
    return fan;
  }

  _registerBuiltInPrimitive(mesh, definition, collider = null) {
    this._ensureUniqueEditableMaterials(mesh);

    const primitive = normalizeEditablePrimitive(definition);
    mesh.userData.editablePrimitive = true;
    mesh.userData.primitiveId = primitive.id;
    mesh.userData.colliderEnabled = primitive.collider;
    mesh.userData.spawnType = primitive.spawnType;

    this.builtInEditableMeshes.set(primitive.id, {
      mesh,
      collider,
      primitive,
    });
    return primitive;
  }

  _ensureUniqueEditableMaterials(mesh) {
    if (!mesh?.material) return;

    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const clonedMaterials = sourceMaterials.map((material) => {
      if (!material) return material;
      const clone = material.clone();
      if (clone.userData?.textureCell != null) {
        this.surfaceMaterials.add(clone);
      }
      return clone;
    });

    mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0];
  }

  _serializeBuiltInPrimitive(entry) {
    const { mesh } = entry;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const material = materials[0];
    // textureRepeat used to live on the material; now it's per-mesh since materials
    // are shared across repeat variants.
    const textureRepeat = normalizeTextureSettings(mesh.userData?.textureRepeat ?? 1);
    const faceTextures = {};

    (FACE_TEXTURE_SLOTS[entry.primitive.type] ?? []).forEach((slot, index) => {
      const faceMaterial = materials[index];
      if (!faceMaterial) return;
      const cell = faceMaterial.userData?.textureCell;
      if (Number.isFinite(cell) || cell === null) {
        faceTextures[slot] = {
          atlas: faceMaterial.userData?.textureAtlas ?? DEFAULT_TEXTURE_ATLAS,
          cell,
        };
      }
    });

    return {
      id: entry.primitive.id,
      name: mesh.name || entry.primitive.name,
      type: entry.primitive.type,
      spawnType: normalizeSpawnType(entry.primitive.spawnType),
      position: {
        x: Number(mesh.position.x.toFixed(4)),
        y: Number(mesh.position.y.toFixed(4)),
        z: Number(mesh.position.z.toFixed(4)),
      },
      rotation: {
        x: Number(mesh.rotation.x.toFixed(4)),
        y: Number(mesh.rotation.y.toFixed(4)),
        z: Number(mesh.rotation.z.toFixed(4)),
      },
      scale: {
        x: Number(mesh.scale.x.toFixed(4)),
        y: Number(mesh.scale.y.toFixed(4)),
        z: Number(mesh.scale.z.toFixed(4)),
      },
      texture: {
        atlas: material?.userData?.textureAtlas ?? DEFAULT_TEXTURE_ATLAS,
        cell: material?.userData?.textureCell ?? null,
        repeat: {
          x: Number(textureRepeat.x.toFixed(4)),
          y: Number(textureRepeat.y.toFixed(4)),
        },
        rotation: Number(textureRepeat.rotation.toFixed(4)),
        offset: {
          x: Number((textureRepeat.offset?.x ?? 0).toFixed(4)),
          y: Number((textureRepeat.offset?.y ?? 0).toFixed(4)),
        },
      },
      material: materialToEditableSurface(material, entry.primitive.material.color),
      faceTextures,
      prefabId: entry.primitive.prefabId ?? null,
      navArea: normalizeNavArea(entry.primitive.navArea),
      prefabInstanceId: entry.primitive.prefabInstanceId ?? null,
      prefabInstanceOrigin: entry.primitive.prefabInstanceOrigin ?? null,
      prefabInstanceRotation: entry.primitive.prefabInstanceRotation ?? null,
      prefabInstanceScale: entry.primitive.prefabInstanceScale ?? null,
      collider: mesh.userData.colliderEnabled !== false,
      colliderClearance: entry.primitive.colliderClearance ?? 0,
      castShadow: mesh.castShadow !== false,
      receiveShadow: mesh.receiveShadow !== false,
      deleted: this.deletedBuiltInPrimitives.has(entry.primitive.id),
      ...(typeof entry.primitive.cameraOccluder === 'boolean'
        ? { cameraOccluder: entry.primitive.cameraOccluder }
        : {}),
    };
  }

  _applyPrimitiveToMesh(primitive, mesh) {
    mesh.name = primitive.name;
    mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
    mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
    mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
    mesh.castShadow = primitive.castShadow;
    mesh.receiveShadow = primitive.receiveShadow;
    mesh.visible = this._isPrimitiveVisible(primitive);
    mesh.userData.colliderEnabled = primitive.collider;
    mesh.userData.spawnType = primitive.spawnType;
    mesh.userData.skipOutline = primitive.spawnType != null;
    this._syncCameraOccluderUserData(mesh, primitive);

    // Built-in meshes own their geometry. Rebake UVs when repeat/rotation/offset changes
    // so the (shared) material stays stable. mesh.userData.textureRepeat is the
    // source of truth for serialization on built-ins.
    const nextRepeat = {
      x: primitive.texture.repeat.x,
      y: primitive.texture.repeat.y,
      rotation: primitive.texture.rotation,
      offset: {
        x: primitive.texture.offset?.x ?? 0,
        y: primitive.texture.offset?.y ?? 0,
      },
    };
    this._rebakeMeshUvs(mesh, nextRepeat);
    mesh.userData.textureRepeat = nextRepeat;

    const nextMaterial = this._createEditablePrimitiveMaterial(primitive);
    const materialShapeChanged = Array.isArray(mesh.material) !== Array.isArray(nextMaterial)
      || (Array.isArray(mesh.material) && Array.isArray(nextMaterial) && mesh.material.length !== nextMaterial.length);
    if (primitive.type === 'plane' || materialShapeChanged) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material?.dispose?.());
      } else {
        mesh.material?.dispose?.();
      }
      mesh.material = nextMaterial;
    }

    if (primitive.type === 'plane') {
      const zi = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
      mesh.renderOrder = zi;
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const faceSlots = FACE_TEXTURE_SLOTS[primitive.type] ?? [];
    materials.forEach((material, index) => {
      if (!material) return;
      if (material.color) {
        material.color.set(primitive.material.color);
      }
      if ('roughness' in material) {
        material.roughness = primitive.material.roughness;
      }
      if ('metalness' in material) {
        material.metalness = primitive.material.metalness;
      }
      const slot = faceSlots[index];
      const ref = slot ? getFaceTextureRef(primitive, slot) : primitive.texture;
      material.userData.textureCell = ref?.cell ?? null;
      material.userData.textureAtlas = ref?.atlas ?? DEFAULT_TEXTURE_ATLAS;
      material.side = primitive.type === 'plane' ? THREE.DoubleSide : material.side;
      material.needsUpdate = true;
    });
  }

  _applyLoadedEditableLayout() {
    const builtInIds = new Set(this.builtInEditableMeshes.keys());
    const customPrimitives = [];
    const customLights = [];
    const customPortals = [];
    const customRopes = [];
    const customFans = [];
    const customExtractionPortals = [];
    const customRaidTasks = [];
    const customVegetation = [];

    this.deletedBuiltInPrimitives.clear();

    const activeGeneratedBakeAssetIds = this.useGeneratedBakes
      ? new Set(
        (this.loadedEditableLayout.primitives ?? [])
          .filter((primitive) => isGeneratedBakePrimitiveEnabled(this, primitive))
          .map((primitive) => primitive.glbAssetId),
      )
      : new Set();

    for (const primitive of this.loadedEditableLayout.primitives) {
      if (primitive?.generatedBakeKind && !isGeneratedBakePrimitiveEnabled(this, primitive)) {
        continue;
      }
      if (primitive?.bakedAssetId && activeGeneratedBakeAssetIds.has(primitive.bakedAssetId)) {
        customPrimitives.push({
          ...primitive,
          hiddenByGeneratedBake: true,
        });
        continue;
      }
      if (builtInIds.has(primitive.id)) {
        const entry = this.builtInEditableMeshes.get(primitive.id);
        if (!entry) continue;
        this._applyPrimitiveToMesh(primitive, entry.mesh);
        if (primitive.deleted) {
          this.deletedBuiltInPrimitives.add(primitive.id);
        }
      } else if (!primitive.deleted) {
        customPrimitives.push(primitive);
      }
    }

    for (const light of this.loadedEditableLayout.lights ?? []) {
      if (!light?.deleted) {
        customLights.push(light);
      }
    }

    for (const portal of this.loadedEditableLayout.portals ?? []) {
      if (!portal?.deleted) {
        customPortals.push(portal);
      }
    }

    for (const rope of this.loadedEditableLayout.ropes ?? []) {
      if (!rope?.deleted) {
        customRopes.push(rope);
      }
    }

    for (const fan of this.loadedEditableLayout.fans ?? []) {
      if (!fan?.deleted) {
        customFans.push(fan);
      }
    }

    for (const ep of this.loadedEditableLayout.extractionPortals ?? []) {
      if (!ep?.deleted) {
        customExtractionPortals.push(ep);
      }
    }

    for (const task of this.loadedEditableLayout.raidTasks ?? []) {
      if (!task?.deleted) {
        customRaidTasks.push(task);
      }
    }

    for (const vegetation of this.loadedEditableLayout.vegetation ?? []) {
      if (!vegetation?.deleted) {
        customVegetation.push(vegetation);
      }
    }

    this.editableLayout = {
      version: this.loadedEditableLayout.version ?? 1,
      primitives: customPrimitives,
      lights: customLights,
      portals: customPortals,
      ropes: customRopes,
      fans: customFans,
      extractionPortals: customExtractionPortals,
      raidTasks: customRaidTasks,
      vegetation: customVegetation,
    };

    this._normalizePrefabInstanceTransforms();
  }

  _createEditablePrimitiveMaterial(definition) {
    return createEditablePrimitiveMaterial(this, definition);
  }

  _normalizePrefabInstanceTransforms() {
    const groupedPrimitives = new Map();

    for (const primitive of this.editableLayout.primitives) {
      if (!primitive.prefabInstanceId) continue;
      const bucket = groupedPrimitives.get(primitive.prefabInstanceId) ?? [];
      bucket.push(primitive);
      groupedPrimitives.set(primitive.prefabInstanceId, bucket);
    }

    groupedPrimitives.forEach((primitives) => {
      const anchor = primitives[0];
      if (!anchor) return;

      const origin = cloneVectorLike(anchor.prefabInstanceOrigin ?? anchor.position, { x: 0, y: 0, z: 0 });
      const rotation = cloneVectorLike(anchor.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
      const scale = cloneVectorLike(anchor.prefabInstanceScale ?? { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });
      const needsMigration = primitives.some((primitive) => !primitive.prefabInstanceOrigin || !primitive.prefabInstanceRotation || !primitive.prefabInstanceScale);

      if (needsMigration) {
        primitives.forEach((primitive) => {
          primitive.position = worldToLocalPrefabPosition(primitive.position, origin, rotation, scale);
          primitive.prefabInstanceOrigin = cloneVectorLike(origin, { x: 0, y: 0, z: 0 });
          primitive.prefabInstanceRotation = cloneVectorLike(rotation, { x: 0, y: 0, z: 0 });
          primitive.prefabInstanceScale = cloneVectorLike(scale, { x: 1, y: 1, z: 1 });
        });
        return;
      }

      primitives.forEach((primitive) => {
        primitive.prefabInstanceOrigin = cloneVectorLike(origin, { x: 0, y: 0, z: 0 });
        primitive.prefabInstanceRotation = cloneVectorLike(rotation, { x: 0, y: 0, z: 0 });
        primitive.prefabInstanceScale = cloneVectorLike(scale, { x: 1, y: 1, z: 1 });
      });
    });
  }

  _configureEditableLightShadow(light, definition) {
    if (!('castShadow' in light)) return;
    light.castShadow = definition.castShadow === true;
    if (!light.castShadow || !light.shadow) return;
    const size = this.shadowMapSize ?? 512;
    light.shadow.mapSize.set(size, size);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.02;
    if (light.isDirectionalLight) {
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 48;
      light.shadow.camera.left = -18;
      light.shadow.camera.right = 18;
      light.shadow.camera.top = 18;
      light.shadow.camera.bottom = -18;
    } else if (light.isSpotLight) {
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = Math.max(8, definition.distance || 18);
      light.shadow.focus = 1;
    }
  }

  setShadowMapSize(size) {
    const next = Math.max(128, Math.min(2048, Math.round(size) || 512));
    if (next === this.shadowMapSize) return;
    this.shadowMapSize = next;
    for (const entry of this.editableLightObjects.values()) {
      if (entry?.light) {
        this._configureEditableLightShadow(entry.light, entry.definition);
      }
    }
  }

  _createEditableLightObject(definition) {
    const light = normalizeEditableLight(definition);
    const group = new THREE.Group();
    group.name = light.name;
    group.position.set(light.position.x, light.position.y, light.position.z);
    group.rotation.set(light.rotation.x, light.rotation.y, light.rotation.z);
    group.userData.lightId = light.id;
    group.userData.editableLight = true;

    const helper = createLightHelperMesh(light);
    helper.visible = this.lightHelpersVisible && !light.deleted;
    helper.userData.lightId = light.id;
    group.add(helper);

    const target = new THREE.Object3D();
    target.position.set(0, 0, 1);
    target.userData.lightId = light.id;
    group.add(target);

    let lightObject;
    if (light.lightType === 'spot') {
      lightObject = new THREE.SpotLight(
        light.color,
        light.intensity,
        light.distance,
        light.angle,
        light.penumbra,
        light.decay,
      );
      lightObject.target = target;
    } else if (light.lightType === 'directional') {
      lightObject = new THREE.DirectionalLight(light.color, light.intensity);
      lightObject.target = target;
    } else {
      lightObject = new THREE.PointLight(light.color, light.intensity, light.distance, light.decay);
    }

    lightObject.name = `${light.name}-source`;
    lightObject.userData.lightId = light.id;
    lightObject.userData.skipOutline = true;
    group.add(lightObject);
    if (lightObject.target && lightObject.target.parent !== group) {
      group.add(lightObject.target);
    }

    this._configureEditableLightShadow(lightObject, light);
    return { definition: light, group, helper, light: lightObject, target };
  }

  _createEditablePortalObject(definition) {
    const portal = normalizeEditablePortal(definition);
    const group = createPortalHelperObject(portal);
    group.position.set(portal.position.x, portal.position.y, portal.position.z);
    group.rotation.set(portal.rotation.x, portal.rotation.y, portal.rotation.z);
    group.visible = this.portalHelpersVisible && !portal.deleted;
    return { definition: portal, group };
  }

  _applyPortalToObject(definition, entry) {
    const portal = normalizeEditablePortal(definition);
    entry.definition = portal;
    entry.group.name = `${portal.name || portal.portalType}-helper`;
    entry.group.position.set(portal.position.x, portal.position.y, portal.position.z);
    entry.group.rotation.set(portal.rotation.x, portal.rotation.y, portal.rotation.z);
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = this.portalHelpersVisible && !portal.deleted;
    entry.group.userData.portalId = portal.id;
    return portal;
  }

  _createEditableExtractionPortalObject(definition) {
    const ep = normalizeEditableExtractionPortal(definition);
    const group = createExtractionPortalHelperObject(ep);
    group.position.set(ep.position.x, ep.position.y, ep.position.z);
    group.rotation.set(ep.rotation.x, ep.rotation.y, ep.rotation.z);
    group.visible = this.extractionHelpersVisible && !ep.deleted;
    return { definition: ep, group };
  }

  _applyExtractionPortalToObject(definition, entry) {
    const ep = normalizeEditableExtractionPortal(definition);
    entry.definition = ep;
    entry.group.name = `${ep.name || 'extraction'}-helper`;
    entry.group.position.set(ep.position.x, ep.position.y, ep.position.z);
    entry.group.rotation.set(ep.rotation.x, ep.rotation.y, ep.rotation.z);
    entry.group.visible = this.extractionHelpersVisible && !ep.deleted;
    entry.group.userData.extractionPortalId = ep.id;

    const trigger = entry.group.children.find((c) => c.isMesh && c.geometry?.type === 'CylinderGeometry');
    if (trigger?.geometry) {
      const old = trigger.geometry;
      const r = ep.radius ?? EXTRACTION_HELPER_BASE_RADIUS;
      trigger.geometry = new THREE.CylinderGeometry(r, r, 0.08, 48);
      old.dispose?.();
    }
    return ep;
  }

  _createEditableRaidTaskObject(definition) {
    const task = normalizeEditableRaidTask(definition);
    const group = createRaidTaskHelperObject(task, {
      createPrefabObject: (part, slot, taskId) => this._createRaidTaskPrefabObject(part, slot, taskId),
    });
    group.position.set(task.position.x, task.position.y, task.position.z);
    group.rotation.set(task.rotation.x, task.rotation.y, task.rotation.z);
    group.visible = this.raidTaskHelpersVisible && !task.deleted;
    return { definition: task, group };
  }

  _createRaidTaskPrefabObject(part, slot, taskId) {
    const primitive = normalizeEditablePrimitive({
      ...part,
      id: part.id ?? `task-prefab-part-${Math.random().toString(36).slice(2, 8)}`,
      collider: part.type === 'prop' ? part.collider === true : part.collider !== false,
    });

    if (primitive.type === 'prop') {
      const sprite = new THREE.Sprite(this._createEditablePrimitiveMaterial(primitive));
      sprite.name = primitive.name;
      sprite.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      sprite.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      sprite.scale.set(primitive.scale.x, primitive.scale.y, 1);
      sprite.castShadow = false;
      sprite.receiveShadow = false;
      sprite.userData.colliderEnabled = false;
      sprite.userData.raidTaskPrimitive = primitive;
      sprite.userData.raidTaskId = taskId;
      sprite.userData.raidTaskPrefabSlot = slot;
      sprite.userData.editableRaidTaskPrefab = true;
      sprite.userData.skipOutline = true;
      return sprite;
    }

    const mesh = new THREE.Mesh(
      this._getEditableGeometry(primitive),
      this._createEditablePrimitiveMaterial(primitive),
    );
    mesh.name = primitive.name;
    mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
    mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
    mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
    mesh.castShadow = primitive.castShadow;
    mesh.receiveShadow = primitive.receiveShadow;
    mesh.userData.colliderEnabled = primitive.collider;
    mesh.userData.colliderClearance = primitive.colliderClearance ?? 0;
    mesh.userData.raidTaskPrimitive = primitive;
    mesh.userData.raidTaskId = taskId;
    mesh.userData.raidTaskPrefabSlot = slot;
    mesh.userData.editableRaidTaskPrefab = true;
    mesh.userData.skipOutline = true;
    if (primitive.type === 'plane') {
      mesh.renderOrder = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
    }
    return mesh;
  }

  _applyRaidTaskToObject(definition, entry) {
    const task = normalizeEditableRaidTask(definition);
    this._removeRaidTaskColliders(task.id);
    entry.definition = task;
    entry.group.name = `${task.name || 'task'}-helper`;
    entry.group.position.set(task.position.x, task.position.y, task.position.z);
    entry.group.rotation.set(task.rotation.x, task.rotation.y, task.rotation.z);
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = this.raidTaskHelpersVisible && !task.deleted;
    entry.group.userData.raidTaskId = task.id;
    entry.group.userData.rebuildRaidTaskVisuals?.(task);
    const editTarget = this.raidTaskPrefabEditTargets.get(task.id);
    if (editTarget === 'before' || editTarget === 'after') {
      entry.group.userData.setRaidTaskEditorPreview?.(editTarget, false);
    } else {
      entry.group.userData.setRaidTaskCompleted?.(false);
    }
    this._registerRaidTaskPrefabColliders(entry);
    this._applyTextureAtlas();
    return task;
  }

  _applyLightToObject(definition, entry) {
    const light = normalizeEditableLight(definition);
    entry.definition = light;
    entry.group.name = light.name;
    entry.group.position.set(light.position.x, light.position.y, light.position.z);
    entry.group.rotation.set(light.rotation.x, light.rotation.y, light.rotation.z);
    entry.group.scale.set(1, 1, 1);
    entry.group.visible = !light.deleted;
    entry.helper.visible = this.lightHelpersVisible && !light.deleted;
    if (entry.helper.material?.color) {
      entry.helper.material.color.set(light.color);
    }
    entry.light.name = `${light.name}-source`;
    entry.light.color.set(light.color);
    entry.light.intensity = light.intensity;
    if ('distance' in entry.light) {
      entry.light.distance = light.distance;
    }
    if ('decay' in entry.light) {
      entry.light.decay = light.decay;
    }
    if ('angle' in entry.light) {
      entry.light.angle = light.angle;
    }
    if ('penumbra' in entry.light) {
      entry.light.penumbra = light.penumbra;
    }
    this._configureEditableLightShadow(entry.light, light);
    entry.group.updateMatrixWorld(true);
    return light;
  }

  _removeEditableColliders() {
    this.colliders = this.colliders.filter((entry) => entry.metadata?.source !== 'editable');
    this.runnables = this.runnables.filter((mesh) => mesh.userData?.editablePrimitive !== true);
    this.climbables = this.climbables.filter((mesh) => mesh.userData?.editablePrimitive !== true);
  }

  _removeRaidTaskColliders(taskId) {
    if (!taskId) return;
    this.colliders = this.colliders.filter((entry) => entry.metadata?.raidTaskId !== taskId);
  }

  _registerRaidTaskPrefabColliders(entry) {
    const taskId = entry?.definition?.id;
    if (!taskId || !entry?.group) return;
    this._removeRaidTaskColliders(taskId);
    entry.group.updateMatrixWorld(true);
    entry.group.traverse((child) => {
      const primitive = child.userData?.raidTaskPrimitive;
      if (!child.isMesh || !primitive?.collider || child.userData?.colliderEnabled === false) return;
      child.updateWorldMatrix(true, false);
      const isPlane = primitive.type === 'plane';
      this._registerPrimitiveCollider(child, primitive, {
        type: isPlane ? 'surface' : 'furniture',
        metadata: {
          source: 'editable',
          raidTaskId: taskId,
          raidTaskPrefabSlot: child.userData?.raidTaskPrefabSlot,
          primitiveId: primitive.id,
          collisionMode: 'task-prefab',
          ...(isPlane ? { plane: true, zIndex: primitive.zIndex ?? 0 } : {}),
        },
      });
    });
  }

  _getEditableGlbCollisionMode(primitive) {
    if (!primitive?.collider) return 'none';
    // Generated house bakes are visual-only. Their source primitives remain
    // authoritative for collision so traversal stays stable.
    if (primitive.generatedBakeKind === 'house') return 'none';
    if (primitive.generatedBakeKind) return 'none';
    return 'bvh-proxy';
  }

  _rebuildEditableLayout() {
    return rebuildRoomEditableLayout(this);
  }

  setStaticMergeEnabled(enabled) {
    const next = !!enabled;
    if (next === this._staticMergeEnabled) return;
    this._staticMergeEnabled = next;
    if (next) {
      this._buildStaticMergedMeshes();
    } else {
      this._clearStaticMergedMeshes();
      this._staticBakeStats = null;
    }
  }

  isStaticMergeEnabled() {
    return this._staticMergeEnabled;
  }

  _clearStaticMergedMeshes() {
    clearStaticMergedMeshes(this);
  }

  getStaticBakeStats() {
    return this._staticBakeStats ?? null;
  }

  _buildStaticMergedMeshes() {
    buildStaticMergedMeshes(this);
  }

  _isPrimitiveVisible(primitive) {
    return isRoomPrimitiveVisible(this, primitive);
  }

  setSpawnMarkersVisible(visible) {
    return setRoomSpawnMarkersVisible(this, visible);
  }

  setPortalHelpersVisible(visible) {
    return setRoomPortalHelpersVisible(this, visible);
  }

  setExtractionHelpersVisible(visible) {
    return setRoomExtractionHelpersVisible(this, visible);
  }

  setRaidTaskHelpersVisible(visible) {
    return setRoomRaidTaskHelpersVisible(this, visible);
  }

  setRaidTaskPrefabEditorPreview(taskId, slot = 'auto') {
    return setRoomRaidTaskPrefabEditorPreview(this, taskId, slot);
  }

  setRaidTaskPrefabEditTarget(taskId, slot = 'marker') {
    return setRoomRaidTaskPrefabEditTarget(this, taskId, slot);
  }

  getVibePortalPlacements() {
    return getRoomVibePortalPlacements(this);
  }

  getEditableLayout() {
    return getRoomEditableLayout(this);
  }

  setEditableLayout(layout) {
    return setRoomEditableLayout(this, layout);
  }

  getEditableRopeDefinitions() {
    return getRoomEditableRopeDefinitions(this);
  }

  upsertEditablePrimitive(definition) {
    return upsertRoomEditablePrimitive(this, definition);
  }

  replaceEditablePrimitive(id, definitions = []) {
    return replaceRoomEditablePrimitive(this, id, definitions);
  }

  upsertEditableLight(definition) {
    return upsertRoomEditableLight(this, definition);
  }

  upsertEditablePortal(definition) {
    return upsertRoomEditablePortal(this, definition);
  }

  removeEditablePrimitive(id) {
    return removeRoomEditablePrimitive(this, id);
  }

  removeEditableLight(id) {
    return removeRoomEditableLight(this, id);
  }

  removeEditablePortal(id) {
    return removeRoomEditablePortal(this, id);
  }

  purgeEditablePrimitive(id) {
    return purgeRoomEditablePrimitive(this, id);
  }

  purgeEditableLight(id) {
    return purgeRoomEditableLight(this, id);
  }

  purgeEditablePortal(id) {
    return purgeRoomEditablePortal(this, id);
  }

  upsertEditableExtractionPortal(definition) {
    return upsertRoomEditableExtractionPortal(this, definition);
  }

  removeEditableExtractionPortal(id) {
    return removeRoomEditableExtractionPortal(this, id);
  }

  purgeEditableExtractionPortal(id) {
    return purgeRoomEditableExtractionPortal(this, id);
  }

  upsertEditableRaidTask(definition) {
    return upsertRoomEditableRaidTask(this, definition);
  }

  removeEditableRaidTask(id) {
    return removeRoomEditableRaidTask(this, id);
  }

  purgeEditableRaidTask(id) {
    return purgeRoomEditableRaidTask(this, id);
  }

  upsertEditableRope(definition) {
    return upsertRoomEditableRope(this, definition);
  }

  upsertEditableFan(definition) {
    return upsertRoomEditableFan(this, definition);
  }

  removeEditableRope(id) {
    return removeRoomEditableRope(this, id);
  }

  purgeEditableRope(id) {
    return purgeRoomEditableRope(this, id);
  }

  removeEditableFan(id) {
    return removeRoomEditableFan(this, id);
  }

  purgeEditableFan(id) {
    return purgeRoomEditableFan(this, id);
  }

  updateEditableRopeTransform(id, transform = {}) {
    return updateRoomEditableRopeTransform(this, id, transform);
  }

  updateEditableFanTransform(id, transform = {}) {
    return updateRoomEditableFanTransform(this, id, transform);
  }

  snapRopeToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapRopeToGrid(this, definition, { snapY, snapPosition, allowEdgeOverflow });
  }

  snapFanToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapFanToGrid(this, definition, { snapY, snapPosition, allowEdgeOverflow });
  }

  setRopeHelpersVisible(visible) {
    return setRoomRopeHelpersVisible(this, visible);
  }

  setVegetationLibrary(library) {
    return setRoomVegetationLibrary(this, library);
  }

  upsertEditableVegetation(definition) {
    return upsertRoomEditableVegetation(this, definition);
  }

  purgeEditableVegetation(id) {
    return purgeRoomEditableVegetation(this, id);
  }

  updateEditableVegetationTransform(id, transform = {}) {
    return updateRoomEditableVegetationTransform(this, id, transform);
  }

  snapVegetationToGrid(definition, {
    snapY = false,
    snapPosition = true,
    snapScale = false,
    allowEdgeOverflow = false,
  } = {}) {
    return snapVegetationToGrid(this, definition, { snapY, snapPosition, snapScale, allowEdgeOverflow });
  }

  getEditableMesh(id) {
    return this.getEditableObject(id);
  }

  getEditableObject(id) {
    return getRoomEditableObject(this, id);
  }

  updateEditablePrimitiveTransform(id, transform = {}) {
    return updateRoomEditablePrimitiveTransform(this, id, transform);
  }

  updateEditableLightTransform(id, transform = {}) {
    return updateRoomEditableLightTransform(this, id, transform);
  }

  updateEditablePortalTransform(id, transform = {}) {
    return updateRoomEditablePortalTransform(this, id, transform);
  }

  updateEditableExtractionPortalTransform(id, transform = {}) {
    return updateRoomEditableExtractionPortalTransform(this, id, transform);
  }

  updateEditableRaidTaskTransform(id, transform = {}) {
    return updateRoomEditableRaidTaskTransform(this, id, transform);
  }

  updatePrefabInstanceTransform(instanceId, transform = {}) {
    return updateRoomPrefabInstanceTransform(this, instanceId, transform);
  }

  refreshColliders() {
    return refreshRoomColliders(this);
  }

  _registerCollider(mesh, {
    type = 'furniture',
    metadata = {},
    useBvh = false,
    bvhOptions = null,
  } = {}) {
    return registerRoomCollider(this, mesh, { type, metadata, useBvh, bvhOptions });
  }

  _registerPrimitiveCollider(mesh, primitive, {
    type = primitive?.type === 'plane' ? 'surface' : 'furniture',
    metadata = {},
  } = {}) {
    return registerPrimitiveRoomCollider(this, mesh, primitive, { type, metadata });
  }

  getBuildGridConfig() {
    return getBuildGridConfig(this);
  }

  setBuildGridSnapSize(size) {
    return setBuildGridSnapSize(this, size);
  }

  getBuildGridAnchorPosition(col, row, spanX = 1, spanZ = 1) {
    return getBuildGridAnchorPosition(this, col, row, spanX, spanZ);
  }

  snapPrimitiveToGrid(definition, {
    snapY = false,
    snapScale = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapPrimitiveToGrid(this, definition, {
      snapY,
      snapScale,
      snapPosition,
      allowEdgeOverflow,
    });
  }

  snapLightToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapLightToGrid(this, definition, {
      snapY,
      snapPosition,
      allowEdgeOverflow,
    });
  }

  snapPortalToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapPortalToGrid(this, definition, {
      snapY,
      snapPosition,
      allowEdgeOverflow,
    });
  }

  snapExtractionPortalToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapExtractionPortalToGrid(this, definition, {
      snapY,
      snapPosition,
      allowEdgeOverflow,
    });
  }

  snapRaidTaskToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    return snapRaidTaskToGrid(this, definition, {
      snapY,
      snapPosition,
      allowEdgeOverflow,
    });
  }

  setLightHelpersVisible(visible) {
    this.lightHelpersVisible = visible === true;
    this.editableLightObjects.forEach((entry) => {
      if (entry?.helper) {
        entry.helper.visible = this.lightHelpersVisible && entry.group.visible !== false;
      }
    });
  }

  instantiatePrefab(prefab, {
    col = 0,
    row = 0,
    scale: placeScale = 2,
    instanceId = `prefab-instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  } = {}) {
    return instantiateRoomPrefab(this, prefab, { col, row, scale: placeScale, instanceId });
  }

  buildRoom() {
    buildRoomBuiltIns(this);
  }

  buildFloorAndWalls() {
    return buildRoomFloorAndWalls(this);
  }

  /**
   * Check collision between a player AABB and room colliders
   */
  checkCollision(playerAABB) {
    return checkRoomCollision(this, playerAABB);
  }

  getCollisionColliders() {
    return getRoomCollisionColliders(this);
  }

  /**
   * Get all climbable surfaces
   */
  getClimbables() {
    return getRoomClimbables(this);
  }

  /**
   * Get all runnable surfaces
   */
  getRunnables() {
    return getRoomRunnables(this);
  }

  /**
   * Animate loot items (bobbing, rotation)
   */
  updateLoot(timeMs) {
    return updateRoomRuntimeVisuals(this, timeMs);
  }

  applyFanRuntimeStates(states = null) {
    return applyRoomFanRuntimeStates(this, states);
  }

  /**
   * Dispose resources
   */
  dispose() {
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this.textureCache.forEach((texture) => texture.dispose?.());
    this.textureCache.clear();
    this._editableGeometryCache.forEach((geometry) => geometry.dispose?.());
    this._editableGeometryCache.clear();
    this.surfaceMaterials.clear();
  }

  /**
   * Get the THREE.Group for adding to scene
   */
  getGroup() {
    return this.group;
  }
}
