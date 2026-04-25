import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FACE_TEXTURE_SLOTS } from '../dev/prefabRegistry.js';
import { normalizeVegetationPlacement } from '../dev/vegetationRegistry.js';
import {
  DEFAULT_TEXTURE_ATLAS,
  PROP_TEXTURE_ATLAS,
  TEXTURE_ATLASES,
  isPropTextureAtlas,
  normalizeTextureAtlasId,
} from '../dev/textureAtlasRegistry.js';
import { assetUrl } from '../utils/assetUrl.js';
import { VegetationSystem } from './VegetationSystem.js';
import { createPrimitiveGeometry } from './primitiveGeometry.js';
import {
  collectBvhProxyColliderBoxes,
  ensureMeshGeometryBvh,
  installMeshBvhSupport,
  worldAabbFromLocalBox,
} from '../physics/meshBvhSupport.js';
import { normalizeSpawnType } from '../../shared/spawnPoints.js';
import { normalizeNavArea } from '../../shared/navConfig.js';
import { VIBE_PORTAL_TYPES, collectVibePortalPlacementsFromLayout, normalizeVibePortal } from '../../shared/vibePortal.js';
import {
  DEFAULT_ROPE_CARD_OPACITY,
  DEFAULT_ROPE_CARD_WIDTH,
  normalizeRope,
  ROPE_SEGMENT_RADIUS,
  DEFAULT_ROPE_COLOR,
} from '../../shared/ropes.js';
import { normalizeCeilingFan } from '../../shared/ceilingFans.js';
import {
  LEVEL_BUILD_GRID_COLUMNS,
  LEVEL_BUILD_GRID_ROWS,
  LEVEL_ROOM_DEPTH,
  LEVEL_ROOM_WIDTH,
} from '../../shared/levelWorldBounds.js';
import { RAID_TASK_TYPES, normalizeExtractionPortalEntry, normalizeRaidTaskEntry } from '../../shared/raidLayout.js';
import { sortCollidersForPlaneZIndex } from '../../shared/physics.js';
import { createWedgeLocalColliderBoxes } from '../../shared/wedgeCollision.js';

const ATLAS_GRID = 10;
const ATLAS_CELL_MARGIN_PX = 3;
const BUILD_GRID_COLUMNS = LEVEL_BUILD_GRID_COLUMNS;
const BUILD_GRID_ROWS = LEVEL_BUILD_GRID_ROWS;
const BUILD_GRID_VERTICAL_STEP = 0.25;
const ROOM_TEXTURE_CELLS = Object.freeze({
  floor: 0,
  wall: 3,
  cabinet: 55,
  cabinetDark: 21,
  counter: 89,
  backsplash: 27,
  appliance: 44,
  fridge: 45,
  fabric: 94,
  woodAlt: 19,
  woodDark: 21,
  tile: 45,
});

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

const EDITABLE_TYPE_DEFAULTS = Object.freeze({
  box: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  plane: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  cylinder: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  wedge: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
  prop: Object.freeze({
    scale: { x: 1, y: 1, z: 1 },
  }),
});

const EDITABLE_LIGHT_DEFAULTS = Object.freeze({
  point: Object.freeze({
    intensity: 18,
    distance: 14,
    decay: 2,
    angle: Math.PI / 4,
    penumbra: 0,
    castShadow: false,
    color: '#ffc47a',
  }),
  spot: Object.freeze({
    intensity: 24,
    distance: 18,
    decay: 2,
    angle: Math.PI / 5,
    penumbra: 0.28,
    castShadow: true,
    color: '#ffd89f',
  }),
  directional: Object.freeze({
    intensity: 1.7,
    distance: 0,
    decay: 2,
    angle: Math.PI / 4,
    penumbra: 0,
    castShadow: true,
    color: '#ffe1b8',
  }),
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

function getCellBounds(index, size) {
  const start = Math.round((index / ATLAS_GRID) * size);
  const end = Math.round(((index + 1) / ATLAS_GRID) * size);
  return {
    start,
    end,
    size: Math.max(1, end - start),
  };
}

function normalizeLightType(value) {
  return value === 'spot' || value === 'directional' ? value : 'point';
}

function createLightHelperMesh(definition) {
  let geometry;
  switch (definition.lightType) {
    case 'spot':
      geometry = new THREE.ConeGeometry(0.18, 0.38, 18);
      geometry.rotateX(Math.PI * 0.5);
      break;
    case 'directional':
      geometry = new THREE.ConeGeometry(0.16, 0.34, 18);
      geometry.rotateX(Math.PI * 0.5);
      break;
    case 'point':
    default:
      geometry = new THREE.SphereGeometry(0.16, 16, 16);
      break;
  }

  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(definition.color ?? '#ffffff'),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${definition.name || definition.lightType}-helper`;
  mesh.userData.skipOutline = true;
  return mesh;
}

function createPortalHelperObject(definition) {
  const color = definition.portalType === VIBE_PORTAL_TYPES.RETURN ? '#ff5a48' : '#24f0b4';
  const group = new THREE.Group();
  group.name = `${definition.name || definition.portalType}-helper`;
  group.userData.portalId = definition.id;
  group.userData.editablePortal = true;
  group.userData.skipOutline = true;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.055, 14, 72),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  ring.position.y = 1;
  ring.userData.portalId = definition.id;
  ring.userData.skipOutline = true;
  group.add(ring);

  const trigger = new THREE.Mesh(
    new THREE.CylinderGeometry(definition.triggerRadius, definition.triggerRadius, 0.08, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  trigger.position.y = 0.04;
  trigger.userData.portalId = definition.id;
  trigger.userData.skipOutline = true;
  group.add(trigger);

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.38, 18),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  arrow.rotation.x = Math.PI * 0.5;
  arrow.position.set(0, 1, 0.82);
  arrow.userData.portalId = definition.id;
  arrow.userData.skipOutline = true;
  group.add(arrow);

  return group;
}

const EXTRACTION_HELPER_BASE_RADIUS = 1.15;

function createExtractionPortalHelperObject(definition) {
  const color = '#5af0c8';
  const group = new THREE.Group();
  group.name = `${definition.name || 'extraction'}-helper`;
  group.userData.extractionPortalId = definition.id;
  group.userData.editableExtractionPortal = true;
  group.userData.skipOutline = true;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.055, 14, 72),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  ring.position.y = 1;
  ring.userData.extractionPortalId = definition.id;
  ring.userData.skipOutline = true;
  group.add(ring);

  const r = definition.radius ?? EXTRACTION_HELPER_BASE_RADIUS;
  const trigger = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.08, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  trigger.position.y = 0.04;
  trigger.userData.extractionPortalId = definition.id;
  trigger.userData.skipOutline = true;
  group.add(trigger);

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.38, 18),
    new THREE.MeshBasicMaterial({
      color: '#b8fff0',
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  arrow.rotation.x = Math.PI * 0.5;
  arrow.position.set(0, 1, 0.82);
  arrow.userData.extractionPortalId = definition.id;
  arrow.userData.skipOutline = true;
  group.add(arrow);

  return group;
}

function createRaidTaskHelperObject(definition, {
  createPrefabObject = null,
} = {}) {
  const color = '#e8b84a';
  const group = new THREE.Group();
  group.name = `${definition.name || 'task'}-helper`;
  group.userData.raidTaskId = definition.id;
  group.userData.editableRaidTask = true;
  group.userData.skipOutline = true;

  const before = new THREE.Group();
  before.name = 'task-before';
  const after = new THREE.Group();
  after.name = 'task-after';
  after.visible = false;
  group.add(before, after);

  const disposeChildren = (root) => {
    root.traverse((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
    root.clear();
  };

  const markTaskVisual = (object, slot) => {
    object.userData.raidTaskId = definition.id;
    object.userData.raidTaskPrefabSlot = slot;
    object.userData.skipOutline = true;
    return object;
  };

  const applyPrefabTransform = (root, prefab, slot) => {
    root.userData.raidTaskId = definition.id;
    root.userData.raidTaskPrefabSlot = slot;
    root.userData.editableRaidTaskPrefab = true;
    root.userData.skipOutline = true;
    root.position.set(prefab?.position?.x ?? 0, prefab?.position?.y ?? 0, prefab?.position?.z ?? 0);
    root.rotation.set(prefab?.rotation?.x ?? 0, prefab?.rotation?.y ?? 0, prefab?.rotation?.z ?? 0);
    root.scale.set(prefab?.scale?.x ?? 1, prefab?.scale?.y ?? 1, prefab?.scale?.z ?? 1);
  };

  const addPrefabPrimitive = (root, part, slot) => {
    if (typeof createPrefabObject === 'function') {
      const object = createPrefabObject(part, slot, definition.id);
      if (object) {
        markTaskVisual(object, slot);
        root.add(object);
        return object;
      }
    }
    const mesh = new THREE.Mesh(
      createPrimitiveGeometry(part.type),
      new THREE.MeshStandardMaterial({
        color: part.material?.color ?? '#ffffff',
        roughness: part.material?.roughness ?? 0.82,
        metalness: part.material?.metalness ?? 0.04,
      }),
    );
    mesh.name = part.name ?? `${slot}-part`;
    mesh.position.set(part.position?.x ?? 0, part.position?.y ?? 0, part.position?.z ?? 0);
    mesh.rotation.set(part.rotation?.x ?? 0, part.rotation?.y ?? 0, part.rotation?.z ?? 0);
    mesh.scale.set(part.scale?.x ?? 1, part.scale?.y ?? 1, part.scale?.z ?? 1);
    mesh.castShadow = part.castShadow !== false;
    mesh.receiveShadow = part.receiveShadow !== false;
    mesh.userData.colliderEnabled = part.collider !== false;
    mesh.userData.colliderClearance = part.colliderClearance ?? 0;
    markTaskVisual(mesh, slot);
    root.add(mesh);
    return mesh;
  };

  const addBox = (root, name, colorHex, position, scale, rotation = {}) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(scale.x, scale.y, scale.z),
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = name;
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    markTaskVisual(mesh, root === before ? 'before' : 'after');
    root.add(mesh);
    return mesh;
  };

  const addDefaultMarker = () => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.1, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    pole.position.y = 0.55;
    markTaskVisual(pole, 'before');
    before.add(pole);

    const top = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshBasicMaterial({
        color: '#ffd27a',
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    top.position.y = 1.22;
    markTaskVisual(top, 'before');
    before.add(top);
  };

  const buildFallbackVisuals = (task, slot) => {
    if (task.taskType === RAID_TASK_TYPES.TOPPLE_TOWER) {
      if (slot === 'before') {
        addBox(before, 'can-stack-1', '#ff9eb8', { x: -0.22, y: 0.2, z: 0 }, { x: 0.22, y: 0.4, z: 0.22 });
        addBox(before, 'can-stack-2', '#8be9ff', { x: 0, y: 0.62, z: 0 }, { x: 0.24, y: 0.42, z: 0.24 });
        addBox(before, 'can-stack-3', '#ffe080', { x: 0.22, y: 1.05, z: 0 }, { x: 0.22, y: 0.4, z: 0.22 });
      } else {
        addBox(after, 'knocked-can-1', '#ff9eb8', { x: -0.46, y: 0.12, z: -0.14 }, { x: 0.46, y: 0.18, z: 0.22 }, { z: 0.5 });
        addBox(after, 'knocked-can-2', '#8be9ff', { x: 0.12, y: 0.14, z: 0.28 }, { x: 0.42, y: 0.18, z: 0.24 }, { y: 0.8, z: -0.25 });
        addBox(after, 'knocked-can-3', '#ffe080', { x: 0.48, y: 0.13, z: -0.22 }, { x: 0.42, y: 0.18, z: 0.22 }, { y: -0.5, z: 0.35 });
      }
    } else if (task.taskType === RAID_TASK_TYPES.KNIFE_DRAWER) {
      if (slot === 'before') {
        addBox(before, 'closed-drawer', '#8b5a2b', { x: 0, y: 0.42, z: 0 }, { x: 0.9, y: 0.34, z: 0.52 });
        addBox(before, 'drawer-handle', '#facc15', { x: 0, y: 0.42, z: -0.29 }, { x: 0.42, y: 0.06, z: 0.06 });
      } else {
        addBox(after, 'open-drawer', '#8b5a2b', { x: 0, y: 0.42, z: -0.3 }, { x: 0.9, y: 0.34, z: 0.52 });
        addBox(after, 'knife-glint-1', '#e5e7eb', { x: -0.22, y: 0.66, z: -0.58 }, { x: 0.08, y: 0.04, z: 0.58 }, { y: 0.2 });
        addBox(after, 'knife-glint-2', '#e5e7eb', { x: 0.2, y: 0.64, z: -0.52 }, { x: 0.08, y: 0.04, z: 0.5 }, { y: -0.18 });
      }
    } else if (task.taskType === RAID_TASK_TYPES.SABOTAGE_ROOMBA) {
      if (slot === 'before') {
        addBox(before, 'roomba-mini', '#64748b', { x: 0, y: 0.22, z: 0 }, { x: 0.75, y: 0.22, z: 0.75 });
      } else {
        addBox(after, 'roomba-mini-jammed', '#64748b', { x: 0, y: 0.22, z: 0 }, { x: 0.75, y: 0.22, z: 0.75 });
        addBox(after, 'jammed-crumbs', '#ffe080', { x: 0.18, y: 0.38, z: -0.12 }, { x: 0.28, y: 0.12, z: 0.28 }, { y: 0.4 });
      }
    } else if (slot === 'before') {
      addDefaultMarker();
    }
  };

  const rebuildVisuals = (task) => {
    disposeChildren(before);
    disposeChildren(after);
    applyPrefabTransform(before, task.beforePrefab, 'before');
    applyPrefabTransform(after, task.afterPrefab, 'after');

    const hasBeforePrefab = task.beforePrefab?.enabled && task.beforePrefab.primitives?.length;
    const hasAfterPrefab = task.afterPrefab?.enabled && task.afterPrefab.primitives?.length;
    if (hasBeforePrefab) {
      task.beforePrefab.primitives.forEach((part) => addPrefabPrimitive(before, part, 'before'));
    }
    if (hasAfterPrefab) {
      task.afterPrefab.primitives.forEach((part) => addPrefabPrimitive(after, part, 'after'));
    }
    if (!hasBeforePrefab && !task.beforePrefab) buildFallbackVisuals(task, 'before');
    if (!hasAfterPrefab && !task.afterPrefab) buildFallbackVisuals(task, 'after');
  };

  rebuildVisuals(definition);

  group.userData.setRaidTaskCompleted = (completed) => {
    before.visible = !completed;
    after.visible = !!completed;
  };
  group.userData.setRaidTaskEditorPreview = (slot = 'auto', completed = false) => {
    if (slot === 'both') {
      before.visible = true;
      after.visible = true;
      return;
    }
    if (slot === 'before') {
      before.visible = true;
      after.visible = false;
      return;
    }
    if (slot === 'after') {
      before.visible = false;
      after.visible = true;
      return;
    }
    group.userData.setRaidTaskCompleted(completed);
  };
  group.userData.getRaidTaskPrefabObject = (slot) => (slot === 'after' ? after : before);
  group.userData.rebuildRaidTaskVisuals = rebuildVisuals;

  return group;
}

function createCeilingFanObject(definition) {
  const fan = normalizeCeilingFan(definition);
  const group = new THREE.Group();
  group.name = `${fan.name || fan.id}-fan`;
  group.userData.fanId = fan.id;
  group.userData.editableFan = true;
  group.userData.skipOutline = false;

  const metalMaterial = new THREE.MeshStandardMaterial({
    color: '#d2c4af',
    roughness: 0.46,
    metalness: 0.28,
  });
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: '#6c4c2f',
    roughness: 0.9,
    metalness: 0.04,
  });

  const canopy = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.13, 0.1, 18),
    metalMaterial,
  );
  canopy.position.y = -0.05;
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  canopy.userData.fanId = fan.id;
  group.add(canopy);

  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, fan.rodLength, 16),
    metalMaterial,
  );
  rod.position.y = -fan.rodLength * 0.5;
  rod.castShadow = true;
  rod.receiveShadow = true;
  rod.userData.fanId = fan.id;
  group.add(rod);

  const spinRoot = new THREE.Group();
  spinRoot.name = 'fan-spin-root';
  spinRoot.position.y = -fan.rodLength;
  spinRoot.userData.fanId = fan.id;
  group.add(spinRoot);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(fan.hubRadius * 1.18, fan.hubRadius * 1.24, 0.2, 24),
    metalMaterial,
  );
  hub.castShadow = true;
  hub.receiveShadow = true;
  hub.userData.fanId = fan.id;
  spinRoot.add(hub);

  const bladeGeometry = new THREE.BoxGeometry(fan.bladeLength, 0.035, fan.bladeWidth);
  bladeGeometry.translate((fan.bladeLength * 0.5) + fan.hubRadius * 0.42, 0, 0);
  for (let index = 0; index < fan.bladeCount; index += 1) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.rotation.y = (index / fan.bladeCount) * Math.PI * 2;
    blade.castShadow = true;
    blade.receiveShadow = true;
    blade.userData.fanId = fan.id;
    spinRoot.add(blade);
  }

  const cheeseGroup = new THREE.Group();
  cheeseGroup.name = 'fan-center-cheese';
  cheeseGroup.position.y = 0.22;
  cheeseGroup.userData.fanId = fan.id;
  cheeseGroup.userData.fanCheese = true;
  spinRoot.add(cheeseGroup);

  const cheeseBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.12, 24),
    new THREE.MeshStandardMaterial({
      color: '#f7c94a',
      roughness: 0.75,
      metalness: 0.02,
      emissive: new THREE.Color('#774b08'),
      emissiveIntensity: 0.14,
    }),
  );
  cheeseBody.rotation.z = Math.PI * 0.5;
  cheeseBody.castShadow = true;
  cheeseBody.receiveShadow = true;
  cheeseBody.userData.fanId = fan.id;
  cheeseGroup.add(cheeseBody);

  for (const holeDef of [
    { x: 0.04, y: 0.02, z: 0.03, r: 0.026 },
    { x: -0.03, y: -0.015, z: -0.02, r: 0.018 },
    { x: -0.015, y: 0.03, z: -0.05, r: 0.016 },
  ]) {
    const hole = new THREE.Mesh(
      new THREE.SphereGeometry(holeDef.r, 10, 8),
      new THREE.MeshStandardMaterial({
        color: '#d39d29',
        roughness: 1,
        metalness: 0,
      }),
    );
    hole.position.set(holeDef.x, holeDef.y, holeDef.z);
    hole.userData.fanId = fan.id;
    cheeseGroup.add(hole);
  }

  return { definition: fan, group, spinRoot, cheeseGroup };
}

function createRopeHelperObject(definition, textureMap = null) {
  const r = definition.segmentRadius ?? ROPE_SEGMENT_RADIUS;
  const tint = definition.color ?? DEFAULT_ROPE_COLOR;
  const group = new THREE.Group();
  group.name = `${definition.name || definition.id}-rope-helper`;
  group.userData.ropeId = definition.id;
  group.userData.editableRope = true;
  group.userData.skipOutline = true;

  const anchor = new THREE.Mesh(
    new THREE.SphereGeometry(r * 2.4, 16, 12),
    new THREE.MeshBasicMaterial({
      color: '#ffb347',
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  anchor.userData.ropeId = definition.id;
  anchor.userData.ropePreviewAnchor = true;
  anchor.userData.skipOutline = true;
  group.add(anchor);

  const strandMat = new THREE.MeshBasicMaterial({
    map: textureMap ?? undefined,
    color: textureMap ? 0xffffff : new THREE.Color(tint),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
  });
  const strand = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.6, r * 0.6, 1, 10, 1, true),
    strandMat,
  );
  strand.name = 'rope-preview-strand';
  strand.userData.skipOutline = true;
  strand.userData.ropePreviewStrand = true;
  strand.userData.editorHelper = true;
  strand.raycast = () => {};
  strand.position.y = -definition.length * 0.5;
  strand.scale.y = definition.length;
  group.add(strand);

  const cardWidth = definition.cards?.width ?? DEFAULT_ROPE_CARD_WIDTH;
  const cardOpacity = definition.cards?.opacity ?? DEFAULT_ROPE_CARD_OPACITY;
  const cardMat = new THREE.MeshBasicMaterial({
    map: textureMap ?? undefined,
    color: textureMap ? 0xffffff : new THREE.Color(tint),
    transparent: true,
    opacity: cardOpacity * 0.68,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    cardMat,
  );
  card.name = 'rope-preview-card';
  card.userData.skipOutline = true;
  card.userData.ropePreviewCard = true;
  card.userData.editorHelper = true;
  card.raycast = () => {};
  card.position.y = -definition.length * 0.5;
  card.scale.set(cardWidth, definition.length, 1);
  card.visible = definition.visualMode === 'cards' || definition.visualMode === 'rope-cards';
  group.add(card);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.6, 12, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(tint),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  tip.name = 'rope-preview-tip';
  tip.userData.skipOutline = true;
  tip.userData.ropePreviewTip = true;
  tip.userData.editorHelper = true;
  tip.raycast = () => {};
  tip.position.y = -definition.length;
  group.add(tip);

  return group;
}

function normalizeTextureSettings(texture = {}) {
  if (typeof texture === 'number') {
    return {
      x: texture,
      y: texture,
      rotation: 0,
      offset: { x: 0, y: 0 },
    };
  }

  return {
    x: texture?.x ?? 1,
    y: texture?.y ?? texture?.x ?? 1,
    rotation: texture?.rotation ?? 0,
    offset: {
      x: texture?.offset?.x ?? 0,
      y: texture?.offset?.y ?? 0,
    },
  };
}

function cloneVectorLike(source, fallback) {
  return {
    x: source?.x ?? fallback.x,
    y: source?.y ?? fallback.y,
    z: source?.z ?? fallback.z,
  };
}

function roundVectorLike(source, fallback) {
  return {
    x: Number((source?.x ?? fallback.x).toFixed(4)),
    y: Number((source?.y ?? fallback.y).toFixed(4)),
    z: Number((source?.z ?? fallback.z).toFixed(4)),
  };
}

function isObjectVisibleInHierarchy(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function worldToLocalPrefabPosition(position, origin, rotation, scale) {
  const local = new THREE.Vector3(
    position.x - origin.x,
    position.y - origin.y,
    position.z - origin.z,
  );
  const inverseRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0),
  ).invert();
  local.applyQuaternion(inverseRotation);
  local.divide(new THREE.Vector3(
    Math.abs(scale.x) > 1e-6 ? scale.x : 1,
    Math.abs(scale.y) > 1e-6 ? scale.y : 1,
    Math.abs(scale.z) > 1e-6 ? scale.z : 1,
  ));
  return roundVectorLike(local, { x: 0, y: 0, z: 0 });
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout ?? DEFAULT_EDITABLE_LAYOUT));
}

function normalizeFaceTextures(type, value = {}) {
  const slots = FACE_TEXTURE_SLOTS[type] ?? [];
  const result = {};

  slots.forEach((slot) => {
    const ref = value?.[slot];
    if (ref == null) return;
    if (ref === null) {
      result[slot] = null;
      return;
    }
    if (typeof ref === 'number') {
      result[slot] = {
        atlas: DEFAULT_TEXTURE_ATLAS,
        cell: ref,
      };
      return;
    }
    result[slot] = {
      atlas: normalizeTextureAtlasId(ref.atlas),
      cell: Number.isFinite(ref.cell) ? ref.cell : 0,
    };
  });

  return result;
}

function getFaceTextureCell(definition, slot) {
  const ref = getFaceTextureRef(definition, slot);
  return ref?.cell ?? null;
}

function getFaceTextureAtlas(definition, slot) {
  const ref = getFaceTextureRef(definition, slot);
  return ref?.atlas ?? DEFAULT_TEXTURE_ATLAS;
}

function getFaceTextureRef(definition, slot) {
  if (Object.prototype.hasOwnProperty.call(definition.faceTextures ?? {}, slot)) {
    const value = definition.faceTextures[slot];
    if (value == null) return value;
    if (typeof value === 'number') {
      return {
        atlas: DEFAULT_TEXTURE_ATLAS,
        cell: value,
      };
    }
    return {
      atlas: normalizeTextureAtlasId(value.atlas),
      cell: Number.isFinite(value.cell) ? value.cell : null,
    };
  }

  return definition.texture;
}

function snapToStep(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function colorToHex(color, fallback = '#ffffff') {
  if (typeof color === 'string') return color;
  if (color?.isColor) return `#${color.getHexString()}`;
  return fallback;
}

function materialToEditableSurface(material, fallbackColor = '#ffffff') {
  return {
    color: colorToHex(material?.color, fallbackColor),
    roughness: material?.roughness ?? 0.88,
    metalness: material?.metalness ?? 0.04,
  };
}

/**
 * AABB (Axis-Aligned Bounding Box) for collision detection
 */
class AABB {
  constructor(min = new THREE.Vector3(), max = new THREE.Vector3()) {
    this.min = min;
    this.max = max;
  }

  static fromMesh(mesh) {
    const box = new THREE.Box3();
    box.setFromObject(mesh);
    return new AABB(box.min.clone(), box.max.clone());
  }

  intersects(other) {
    return (
      this.min.x <= other.max.x &&
      this.max.x >= other.min.x &&
      this.min.y <= other.max.y &&
      this.max.y >= other.min.y &&
      this.min.z <= other.max.z &&
      this.max.z >= other.min.z
    );
  }
}

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
    this.levelLayoutUrl = options.levelLayoutUrl ?? assetUrl('levels/kitchen-layout.json');
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
      this._applyLoadedEditableLayout();
      this._applyTextureAtlas();
      this._rebuildEditableLayout();
      this.streamGlbModels();
      return this;
    }).catch(() => this);

    // Materials
    this.floorColor = options.floorColor ?? '#d4a574'; // Wood
    this.wallColor = options.wallColor ?? '#e8dcc8'; // Plaster
    this.furnitureColor = options.furnitureColor ?? '#8b6f47'; // Wood furniture

    this.buildRoom();
    this.group.add(this.editableGroup);
    this.group.add(this._staticMergedGroup);
    this.group.add(this.vegetationSystem.group);
  }

  _createSurfaceMaterial(baseColor, {
    textureCell = null,
    textureAtlas = DEFAULT_TEXTURE_ATLAS,
    // textureRepeat is intentionally NOT part of the cache key — it's baked into
    // per-mesh UVs via _bakeUvTransform so a single material can serve any repeat
    // or rotation value, which is what lets later batching (instanced groups,
    // mergeGeometries) actually collapse draw calls.
    roughness = 0.92,
    metalness = 0.04,
    side = THREE.FrontSide,
    alphaTest = 0,
    transparent = false,
    depthWrite = true,
    /** When set (plane primitives only), breaks GPU z-fighting vs other coplanar planes. */
    planeZIndex = null,
    } = {}) {
    const zKey = planeZIndex != null && Number.isFinite(planeZIndex)
      ? `|pz=${Math.trunc(planeZIndex)}`
      : '';
    const cacheKey = `${baseColor}|${textureCell}|${textureAtlas}|${roughness}|${metalness}|${side}|${alphaTest}|${transparent ? 1 : 0}|${depthWrite ? 1 : 0}${zKey}`;

    if (!this._materialCache) this._materialCache = new Map();
    const cached = this._materialCache.get(cacheKey);
    if (cached) return cached;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseColor),
      roughness,
      metalness,
      side,
      alphaTest,
      transparent,
      depthWrite,
    });

    material.dithering = true;
    material.userData.textureAtlas = textureAtlas;
    material.userData.textureCell = textureCell;
    if (planeZIndex != null && Number.isFinite(planeZIndex)) {
      const zi = Math.trunc(planeZIndex);
      material.userData.planeZIndex = zi;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -(1 + zi);
    }
    this.surfaceMaterials.add(material);
    this._materialCache.set(cacheKey, material);
    return material;
  }

  _disposeEditableMaterial(material) {
    if (!material || this.surfaceMaterials.has(material)) return;
    material.customDepthMaterial?.dispose?.();
    material.customDistanceMaterial?.dispose?.();
    material.dispose?.();
  }

  _disposeEditableMaterialSet(material) {
    if (Array.isArray(material)) {
      material.forEach((entry) => this._disposeEditableMaterial(entry));
      return;
    }
    this._disposeEditableMaterial(material);
  }

  async _loadTextureAtlas() {
    const entries = Object.entries(this.textureAtlasUrls);
    const results = await Promise.all(entries.map(async ([atlas, url]) => {
      try {
        return [atlas, await loadImage(url)];
      } catch (error) {
        if (atlas === DEFAULT_TEXTURE_ATLAS) throw error;
        return null;
      }
    }));
    this.textureAtlasImages = new Map(results.filter(Boolean));
    this.textureAtlasImage = this.textureAtlasImages.get(DEFAULT_TEXTURE_ATLAS) ?? null;
    return this.textureAtlasImage;
  }

  _createAtlasTexture(cellIndex, atlas = DEFAULT_TEXTURE_ATLAS, chroma = null) {
    const atlasId = atlas ?? DEFAULT_TEXTURE_ATLAS;
    const image = this.textureAtlasImages.get(atlasId) ?? this.textureAtlasImage;
    if (!image) return null;
    // One base texture per (atlas, cell). Repeat/rotation is baked into mesh UVs,
    // so a single texture serves every variant.
    const similarity = THREE.MathUtils.clamp(Number(chroma?.similarity ?? 0.32), 0, 1);
    const feather = THREE.MathUtils.clamp(Number(chroma?.feather ?? 0.08), 0, 1);
    const chromaKey = isPropTextureAtlas(atlasId)
      ? `|ck=${similarity.toFixed(3)}:${feather.toFixed(3)}`
      : '';
    const cacheKey = `${atlasId}:${cellIndex}${chromaKey}`;
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;

    const col = cellIndex % ATLAS_GRID;
    const row = Math.floor(cellIndex / ATLAS_GRID);
    const xBounds = getCellBounds(col, image.width);
    const yBounds = getCellBounds(row, image.height);
    const cropMarginX = Math.min(ATLAS_CELL_MARGIN_PX, Math.floor((xBounds.size - 1) * 0.25));
    const cropMarginY = Math.min(ATLAS_CELL_MARGIN_PX, Math.floor((yBounds.size - 1) * 0.25));
    const sourceX = xBounds.start + cropMarginX;
    const sourceY = yBounds.start + cropMarginY;
    const sourceWidth = Math.max(1, xBounds.size - cropMarginX * 2);
    const sourceHeight = Math.max(1, yBounds.size - cropMarginY * 2);
    const canvas = document.createElement('canvas');
    canvas.width = xBounds.size;
    canvas.height = yBounds.size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      xBounds.size,
      yBounds.size,
    );

    if (isPropTextureAtlas(atlasId)) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const greenDistance = Math.hypot(r, g - 1, b) / Math.sqrt(3);
        const edge = Math.max(0.0001, feather);
        const alpha = THREE.MathUtils.smoothstep(greenDistance, similarity, similarity + edge);
        data[i + 3] = Math.round(data[i + 3] * alpha);
      }
      ctx.putImageData(imageData, 0, 0);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.center.set(0.5, 0.5);
    texture.needsUpdate = true;
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  _bakeUvTransform(geometry, settings) {
    const uv = geometry.getAttribute('uv');
    if (!uv) return geometry;
    const rx = settings?.x ?? 1;
    const ry = settings?.y ?? rx;
    const rot = settings?.rotation ?? 0;
    const offsetX = settings?.offset?.x ?? 0;
    const offsetY = settings?.offset?.y ?? 0;
    if (rx === 1 && ry === 1 && rot === 0 && offsetX === 0 && offsetY === 0) return geometry;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const array = uv.array;
    for (let i = 0; i < array.length; i += 2) {
      // Rotate around (0.5, 0.5), then scale by repeat from the same pivot.
      const u = array[i] - 0.5;
      const v = array[i + 1] - 0.5;
      const ru = (cos * u - sin * v) * rx + 0.5 + offsetX;
      const rv = (sin * u + cos * v) * ry + 0.5 + offsetY;
      array[i] = ru;
      array[i + 1] = rv;
    }
    uv.needsUpdate = true;
    return geometry;
  }

  _rebakeMeshUvs(mesh, settings) {
    const geometry = mesh?.geometry;
    const uv = geometry?.getAttribute?.('uv');
    if (!uv) return;
    let base = mesh.userData?._baseUvs;
    if (!base) {
      // First rebake: snapshot the original UVs so subsequent changes start clean.
      base = new Float32Array(uv.array);
      if (!mesh.userData) mesh.userData = {};
      mesh.userData._baseUvs = base;
    }
    uv.array.set(base);
    this._bakeUvTransform(geometry, normalizeTextureSettings(settings));
    uv.needsUpdate = true;
  }

  _getEditableGeometry(primitive) {
    const settings = normalizeTextureSettings({
      x: primitive.texture?.repeat?.x ?? 1,
      y: primitive.texture?.repeat?.y ?? 1,
      rotation: primitive.texture?.rotation ?? 0,
      offset: primitive.texture?.offset,
    });
    const rxKey = Number(settings.x.toFixed(4));
    const ryKey = Number(settings.y.toFixed(4));
    const rotKey = Number(settings.rotation.toFixed(4));
    const offsetXKey = Number((settings.offset?.x ?? 0).toFixed(4));
    const offsetYKey = Number((settings.offset?.y ?? 0).toFixed(4));
    const key = `${primitive.type}|${rxKey}|${ryKey}|${rotKey}|${offsetXKey}|${offsetYKey}`;
    const cached = this._editableGeometryCache.get(key);
    if (cached) return cached;
    const geometry = createPrimitiveGeometry(primitive.type);
    this._bakeUvTransform(geometry, settings);
    // Marker so _rebuildEditableLayout doesn't dispose a geometry that's still
    // being reused by other meshes (and by the next rebuild).
    geometry.userData = geometry.userData || {};
    geometry.userData.isCachedEditableGeometry = true;
    this._editableGeometryCache.set(key, geometry);
    return geometry;
  }

  _applyTextureAtlas() {
    if (!this.textureAtlasImages.size) return;

    this.surfaceMaterials.forEach((material) => {
      const cellIndex = material.userData?.textureCell;
      if (cellIndex == null) {
        material.map = null;
        material.needsUpdate = true;
        return;
      }

      const texture = this._createAtlasTexture(
        cellIndex,
        material.userData.textureAtlas ?? DEFAULT_TEXTURE_ATLAS,
      );
      if (!texture) return;
      material.map = texture;
      material.needsUpdate = true;
    });
  }

  _shouldUseSharedGlbSurfaceMaterial(primitive) {
    return Number.isFinite(primitive?.texture?.cell);
  }

  _applySharedGlbSurfaceMaterial(scene, primitive) {
    if (!scene || !this._shouldUseSharedGlbSurfaceMaterial(primitive)) return false;

    const material = this._createSurfaceMaterial(primitive.material.color, {
      textureCell: primitive.texture.cell,
      textureAtlas: primitive.texture.atlas ?? DEFAULT_TEXTURE_ATLAS,
      roughness: primitive.material.roughness,
      metalness: primitive.material.metalness,
      // Generated house bakes and editor-authored GLBs may contain plane-derived
      // surfaces; keep the override double-sided so we don't cull interior faces.
      side: THREE.DoubleSide,
      alphaTest: isPropTextureAtlas(primitive.texture.atlas) ? 0.45 : 0,
    });

    let hasMesh = false;
    scene.traverse((child) => {
      if (!child.isMesh) return;
      child.material = material;
      child.userData.usesSharedSurfaceMaterial = true;
      hasMesh = true;
    });

    if (!hasMesh) return false;

    // After every submesh shares one cached material, flatten again so a baked
    // house GLB collapses from "one draw per imported material" to one/few draws.
    this._flattenGlbScene(scene);
    scene.traverse((child) => {
      if (child.isMesh) child.userData.usesSharedSurfaceMaterial = true;
    });
    return true;
  }

  async _loadEditableLayout() {
    try {
      const response = await fetch(this.levelLayoutUrl, { cache: 'no-store' });
      if (!response.ok) return this.loadedEditableLayout;
      const layout = await response.json();
      this.loadedEditableLayout = {
        version: layout?.version ?? 1,
        primitives: Array.isArray(layout?.primitives) ? layout.primitives.map((entry) => this._normalizePrimitive(entry)) : [],
        lights: Array.isArray(layout?.lights) ? layout.lights.map((entry) => this._normalizeLight(entry)) : [],
        portals: Array.isArray(layout?.portals) ? layout.portals.map((entry) => this._normalizePortal(entry)) : [],
        ropes: Array.isArray(layout?.ropes) ? layout.ropes.map((entry) => this._normalizeRope(entry)) : [],
        fans: Array.isArray(layout?.fans) ? layout.fans.map((entry) => this._normalizeFan(entry)) : [],
        extractionPortals: Array.isArray(layout?.extractionPortals)
          ? layout.extractionPortals.map((entry) => this._normalizeExtractionPortal(entry))
          : [],
        raidTasks: Array.isArray(layout?.raidTasks)
          ? layout.raidTasks.map((entry) => this._normalizeRaidTask(entry))
          : [],
        vegetation: Array.isArray(layout?.vegetation)
          ? layout.vegetation.map((entry) => this._normalizeVegetation(entry))
          : [],
      };
    } catch {
      this.loadedEditableLayout = cloneLayout(DEFAULT_EDITABLE_LAYOUT);
    }

    return this.loadedEditableLayout;
  }

  async _loadGlbRegistry() {
    if (this.glbRegistry) return this.glbRegistry;
    try {
      const response = await fetch(assetUrl('levels/glb-registry.json'), { cache: 'no-store' });
      if (!response.ok) return { assets: [] };
      this.glbRegistry = await response.json();
      return this.glbRegistry;
    } catch {
      return { assets: [] };
    }
  }

  async _initGlbLoader() {
    if (this.glbLoader) return;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    this.glbLoader = new GLTFLoader();
    this.glbLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  _applyGlbChromaKey(scene, assetEntry = null) {
    if (assetEntry?.chromaKey !== true) return;
    const processed = new Set();
    scene.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material?.map || processed.has(material.map)) return;
        const texture = material.map;
        const image = texture.image;
        if (!image || processed.has(image)) return;

        const canvas = document.createElement('canvas');
        canvas.width = image.width || image.videoWidth || 1;
        canvas.height = image.height || image.videoHeight || 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        let changed = false;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (g > 200 && r < 80 && b < 80) {
            data[i + 3] = 0;
            changed = true;
          }
        }

        if (changed) {
          ctx.putImageData(imageData, 0, 0);
          texture.image = canvas;
          texture.needsUpdate = true;
          material.transparent = true;
          material.alphaTest = 0.1;
          material.needsUpdate = true;
        }

        processed.add(texture);
        processed.add(image);
      });
    });
  }

  async _loadGlbModelByAssetId(assetId) {
    if (this.glbModelCache.has(assetId)) return this.glbModelCache.get(assetId);
    const registry = await this._loadGlbRegistry();
    const entry = registry.assets?.find((a) => a.id === assetId);
    if (!entry) return null;
    await this._initGlbLoader();
    const url = assetUrl(entry.publicPath);
    try {
      const gltf = await this.glbLoader.loadAsync(url);
      const scene = gltf.scene;
      this._applyGlbChromaKey(scene, entry);
      scene.updateMatrixWorld(true);
      this._flattenGlbScene(scene);
      if (!this._validateGeneratedBakeScene(assetId, scene)) {
        this.invalidGeneratedBakeAssetIds.add(assetId);
        return null;
      }
      scene.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        child.geometry.userData.isSharedGlbGeometry = true;
        // Precompute BVH for raycasts and optional proxy-collider extraction. Exact
        // triangle gameplay collision is not used for editable GLB assets.
        ensureMeshGeometryBvh(child.geometry);
      });
      this.glbModelCache.set(assetId, scene);
      return scene;
    } catch (err) {
      console.warn(`Failed to load GLB asset ${assetId}:`, err);
      return null;
    }
  }

  _getGeneratedBakeSourceBounds(assetId) {
    const sourcePrimitives = (this.loadedEditableLayout?.primitives ?? []).filter((primitive) => (
      primitive?.bakedAssetId === assetId
      && !primitive?.deleted
      && primitive?.type !== 'prop'
      && primitive?.type !== 'glb'
    ));
    if (!sourcePrimitives.length) return null;

    const combined = new THREE.Box3();
    let hasAny = false;
    const localPosition = new THREE.Vector3();
    const localScale = new THREE.Vector3();
    const prefabOrigin = new THREE.Vector3();
    const prefabScale = new THREE.Vector3();
    const localEuler = new THREE.Euler();
    const prefabEuler = new THREE.Euler();
    const localQuat = new THREE.Quaternion();
    const prefabQuat = new THREE.Quaternion();
    const localMatrix = new THREE.Matrix4();
    const prefabMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();

    for (const primitive of sourcePrimitives) {
      const geometry = createPrimitiveGeometry(primitive.type);
      localPosition.set(primitive.position.x, primitive.position.y, primitive.position.z);
      localEuler.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      localQuat.setFromEuler(localEuler);
      localScale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
      localMatrix.compose(localPosition, localQuat, localScale);
      worldMatrix.copy(localMatrix);

      if (primitive.prefabInstanceId) {
        const origin = primitive.prefabInstanceOrigin ?? { x: 0, y: 0, z: 0 };
        const rotation = primitive.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
        const scale = primitive.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
        prefabOrigin.set(origin.x, origin.y, origin.z);
        prefabEuler.set(rotation.x, rotation.y, rotation.z);
        prefabQuat.setFromEuler(prefabEuler);
        prefabScale.set(scale.x, scale.y, scale.z);
        prefabMatrix.compose(prefabOrigin, prefabQuat, prefabScale);
        worldMatrix.premultiply(prefabMatrix);
      }

      geometry.applyMatrix4(worldMatrix);
      geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        if (!hasAny) {
          combined.copy(geometry.boundingBox);
          hasAny = true;
        } else {
          combined.union(geometry.boundingBox);
        }
      }
      geometry.dispose();
    }

    return hasAny ? combined : null;
  }

  _validateGeneratedBakeScene(assetId, scene) {
    const expectedBounds = this._getGeneratedBakeSourceBounds(assetId);
    if (!expectedBounds) return true;

    scene.updateMatrixWorld(true);
    const actualBounds = new THREE.Box3().setFromObject(scene);
    const expectedSize = expectedBounds.getSize(new THREE.Vector3());
    const actualSize = actualBounds.getSize(new THREE.Vector3());
    const expectedMax = Math.max(expectedSize.x, expectedSize.y, expectedSize.z, 0.0001);
    const actualMax = Math.max(actualSize.x, actualSize.y, actualSize.z, 0.0001);
    const ratio = actualMax / expectedMax;

    if (ratio < 0.6 || ratio > 1.67) {
      console.warn(
        `[generated-bake] rejecting ${assetId}: loaded size ratio ${ratio.toFixed(3)} expected=${expectedSize.toArray().map((n) => n.toFixed(3)).join(',')} actual=${actualSize.toArray().map((n) => n.toFixed(3)).join(',')}`,
      );
      return false;
    }

    return true;
  }

  _flattenGlbScene(scene) {
    // Collapse a GLB's mesh tree down to one mesh per material. Each prefab
    // instance still clones + clones materials for independent state, but at
    // runtime it draws as (materials.length) calls instead of (nodes.length).
    //
    // Bail-outs: anything skinned/morphed/animated keeps its original hierarchy
    // because the merged geometry wouldn't respect bone transforms.
    let hasSkinned = false;
    let hasMorphs = false;
    const meshes = [];
    scene.traverse((child) => {
      if (child.isSkinnedMesh || child.isBone) {
        hasSkinned = true;
        return;
      }
      if (!child.isMesh) return;
      if (child.geometry?.morphAttributes && Object.keys(child.geometry.morphAttributes).length) {
        hasMorphs = true;
      }
      meshes.push(child);
    });
    if (hasSkinned || hasMorphs) return;
    if (meshes.length < 2) return;

    const groups = new Map();
    let unflattenable = false;
    for (const mesh of meshes) {
      const material = Array.isArray(mesh.material) ? null : mesh.material;
      if (!material) {
        // Multi-material submeshes would need per-material splitting; not worth
        // it for our prefabs, so abort flattening for this scene.
        unflattenable = true;
        break;
      }
      const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = {
          material,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          meshes: [],
        };
        groups.set(key, bucket);
      }
      bucket.meshes.push(mesh);
    }
    if (unflattenable) return;

    // Preserve any userData from the root before we rebuild.
    const rootUserData = scene.userData;
    const rootName = scene.name;
    const flatGroup = new THREE.Group();
    flatGroup.name = rootName;
    flatGroup.userData = rootUserData;

    // Keep only (position, normal, uv) so siblings from different source meshes
    // can merge cleanly. mergeGeometries fails silently when attribute sets differ.
    const ALLOWED_ATTRS = new Set(['position', 'normal', 'uv']);

    let flattenedAny = false;
    scene.updateMatrixWorld(true);

    for (const bucket of groups.values()) {
      const baked = [];
      for (const mesh of bucket.meshes) {
        const source = mesh.geometry;
        if (!source?.attributes?.position) continue;
        const clone = source.clone();
        if (clone.groups?.length) clone.clearGroups();
        if (clone.index && bucket.meshes.length > 1) {
          // Strip index if siblings vary in indexed-ness; mergeGeometries needs uniformity.
        }
        for (const name of Object.keys(clone.attributes)) {
          if (!ALLOWED_ATTRS.has(name)) clone.deleteAttribute(name);
        }
        clone.applyMatrix4(mesh.matrixWorld);
        baked.push(clone);
      }

      if (!baked.length) continue;

      let outGeometry;
      let outMaterial = bucket.material;
      if (baked.length === 1) {
        outGeometry = baked[0];
      } else {
        const merged = mergeGeometries(baked, false);
        baked.forEach((g) => g.dispose());
        if (!merged) continue;
        outGeometry = merged;
      }
      const outMesh = new THREE.Mesh(outGeometry, outMaterial);
      outMesh.castShadow = bucket.castShadow;
      outMesh.receiveShadow = bucket.receiveShadow;
      flatGroup.add(outMesh);
      flattenedAny = true;
    }

    if (!flattenedAny) return;

    // Drop the original tree wholesale and replace with the flat group's children.
    // We mutate `scene` in place so the cache / clone paths keep working unchanged.
    while (scene.children.length) scene.remove(scene.children[0]);
    while (flatGroup.children.length) scene.add(flatGroup.children[0]);
    scene.updateMatrixWorld(true);
  }

  async loadGlbModel(assetId) {
    return this._loadGlbModelByAssetId(assetId);
  }

  _isGeneratedBakePrimitiveEnabled(primitive) {
    if (!primitive?.generatedBakeKind || primitive?.deleted) return false;
    if (!this.useGeneratedBakes) return false;
    if (this.invalidGeneratedBakeAssetIds.has(primitive.glbAssetId)) return false;
    if (primitive.generatedBakeKind === 'house') return this.useHouseGeneratedBake;
    return true;
  }

  async _loadGlbModels() {
    const glbPrimitives = this.loadedEditableLayout.primitives.filter((p) => (
      p.type === 'glb'
      && p.glbAssetId
      && (!p.generatedBakeKind || this._isGeneratedBakePrimitiveEnabled(p))
    ));
    if (!glbPrimitives.length) return;
    const assetIds = [...new Set(glbPrimitives.map((p) => p.glbAssetId))];
    await Promise.all(assetIds.map((id) => this._loadGlbModelByAssetId(id)));
  }

  streamGlbModels() {
    const glbPrimitives = this.loadedEditableLayout.primitives.filter((p) => (
      p.type === 'glb'
      && p.glbAssetId
      && (!p.generatedBakeKind || this._isGeneratedBakePrimitiveEnabled(p))
    ));
    if (!glbPrimitives.length) return;
    const assetIds = [...new Set(glbPrimitives.map((p) => p.glbAssetId))];
    Promise.all(assetIds.map(async (id) => {
      await this._loadGlbModelByAssetId(id);
      this._applyLoadedEditableLayout();
      this._rebuildEditableLayout();
    }));
  }

  _normalizePrimitive(entry = {}) {
    const type = entry.type === 'plane'
      || entry.type === 'cylinder'
      || entry.type === 'wedge'
      || entry.type === 'glb'
      || entry.type === 'prop'
      ? entry.type
      : 'box';
    const defaults = EDITABLE_TYPE_DEFAULTS[type] ?? EDITABLE_TYPE_DEFAULTS.box;
    const texture = typeof entry.texture === 'number' ? { cell: entry.texture } : (entry.texture ?? {});
    const atlas = normalizeTextureAtlasId(texture.atlas);

    return {
      id: entry.id ?? `primitive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: entry.name ?? `${type}-${(entry.id ?? 'item').slice(0, 4)}`,
      type,
      spawnType: normalizeSpawnType(entry.spawnType),
      position: cloneVectorLike(entry.position, { x: 0, y: 0.5, z: 0 }),
      rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
      scale: cloneVectorLike(entry.scale, defaults.scale),
      texture: {
        atlas,
        cell: Number.isFinite(texture.cell) ? texture.cell : (texture.cell === null ? null : ROOM_TEXTURE_CELLS.tile),
        repeat: {
          x: texture.repeat?.x ?? 1,
          y: texture.repeat?.y ?? 1,
        },
        rotation: texture.rotation ?? 0,
        offset: {
          x: texture.offset?.x ?? 0,
          y: texture.offset?.y ?? 0,
        },
      },
      faceTextures: normalizeFaceTextures(type, entry.faceTextures),
      material: {
        color: entry.material?.color ?? '#c9b391',
        roughness: entry.material?.roughness ?? 0.88,
        metalness: entry.material?.metalness ?? 0.04,
      },
      ...(type === 'prop' ? {
        chroma: {
          similarity: THREE.MathUtils.clamp(Number(entry.chroma?.similarity ?? 0.32), 0, 1),
          feather: THREE.MathUtils.clamp(Number(entry.chroma?.feather ?? 0.08), 0, 1),
        },
      } : {}),
      glbAssetId: entry.glbAssetId ?? null,
      prefabId: entry.prefabId ?? null,
      navArea: normalizeNavArea(entry.navArea),
      prefabInstanceId: entry.prefabInstanceId ?? null,
      prefabInstanceOrigin: entry.prefabInstanceOrigin ? cloneVectorLike(entry.prefabInstanceOrigin, { x: 0, y: 0, z: 0 }) : null,
      prefabInstanceRotation: entry.prefabInstanceRotation ? cloneVectorLike(entry.prefabInstanceRotation, { x: 0, y: 0, z: 0 }) : null,
      prefabInstanceScale: entry.prefabInstanceScale ? cloneVectorLike(entry.prefabInstanceScale, { x: 1, y: 1, z: 1 }) : null,
      collider: type === 'prop' ? entry.collider === true : entry.collider !== false,
      colliderClearance: entry.colliderClearance ?? 0,
      castShadow: type === 'prop' ? entry.castShadow === true : entry.castShadow !== false,
      receiveShadow: type === 'prop' ? entry.receiveShadow === true : entry.receiveShadow !== false,
      deleted: entry.deleted === true,
      ...(type === 'plane' ? {
        zIndex: Number.isFinite(entry.zIndex) ? Math.trunc(entry.zIndex) : 0,
      } : {}),
      bakedAssetId: entry.bakedAssetId ?? null,
      generatedBakeKind: typeof entry.generatedBakeKind === 'string' ? entry.generatedBakeKind : null,
      hiddenByGeneratedBake: entry.hiddenByGeneratedBake === true,
      ...(typeof entry.cameraOccluder === 'boolean' ? { cameraOccluder: entry.cameraOccluder } : {}),
    };
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

  _normalizeLight(entry = {}) {
    const lightType = normalizeLightType(entry.lightType);
    const defaults = EDITABLE_LIGHT_DEFAULTS[lightType] ?? EDITABLE_LIGHT_DEFAULTS.point;
    return {
      id: entry.id ?? `light-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: entry.name ?? `${lightType}-light`,
      lightType,
      position: cloneVectorLike(entry.position, { x: 0, y: 2, z: 0 }),
      rotation: cloneVectorLike(entry.rotation, { x: 0, y: 0, z: 0 }),
      color: colorToHex(entry.color, defaults.color),
      intensity: Number.isFinite(entry.intensity) ? entry.intensity : defaults.intensity,
      distance: Number.isFinite(entry.distance) ? entry.distance : defaults.distance,
      decay: Number.isFinite(entry.decay) ? entry.decay : defaults.decay,
      angle: Number.isFinite(entry.angle) ? entry.angle : defaults.angle,
      penumbra: Number.isFinite(entry.penumbra) ? entry.penumbra : defaults.penumbra,
      castShadow: entry.castShadow ?? defaults.castShadow,
      deleted: entry.deleted === true,
    };
  }

  _normalizePortal(entry = {}) {
    return normalizeVibePortal(entry);
  }

  _normalizeExtractionPortal(entry = {}) {
    return normalizeExtractionPortalEntry(entry);
  }

  _normalizeRaidTask(entry = {}) {
    return normalizeRaidTaskEntry(entry);
  }

  _normalizeRope(entry = {}) {
    return normalizeRope(entry);
  }

  _normalizeFan(entry = {}) {
    return normalizeCeilingFan(entry);
  }

  _normalizeVegetation(entry = {}) {
    return normalizeVegetationPlacement(entry);
  }

  _createEditableRopeObject(definition) {
    const rope = this._normalizeRope(definition);
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
    const rope = this._normalizeRope(definition);
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
    const fan = this._normalizeFan(definition);
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

    const primitive = this._normalizePrimitive(definition);
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
          .filter((primitive) => this._isGeneratedBakePrimitiveEnabled(primitive))
          .map((primitive) => primitive.glbAssetId),
      )
      : new Set();

    for (const primitive of this.loadedEditableLayout.primitives) {
      if (primitive?.generatedBakeKind && !this._isGeneratedBakePrimitiveEnabled(primitive)) {
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
    if (definition.type === 'prop') {
      const texture = this._createAtlasTexture(
        definition.texture.cell ?? 0,
        definition.texture.atlas ?? PROP_TEXTURE_ATLAS,
        definition.chroma,
      );
      return new THREE.SpriteMaterial({
        map: texture ?? null,
        color: new THREE.Color(definition.material.color ?? '#ffffff'),
        transparent: true,
        alphaTest: 0.12,
        depthTest: true,
        depthWrite: false,
        sizeAttenuation: true,
      });
    }

    // Note: texture.repeat/rotation intentionally isn't passed to the material —
    // it's baked into the mesh's cloned-and-cached geometry via _getEditableGeometry,
    // which lets one material instance serve every repeat/rotation variant.
    const materialOptions = {
      roughness: definition.material.roughness,
      metalness: definition.material.metalness,
    };
    const faceSlots = FACE_TEXTURE_SLOTS[definition.type] ?? [];

    if (faceSlots.length > 0) {
      const planeZ = definition.type === 'plane' ? (definition.zIndex ?? 0) : null;
      const materials = faceSlots.map((slot) => this._createSurfaceMaterial(definition.material.color, {
        ...materialOptions,
        textureCell: getFaceTextureCell(definition, slot),
        textureAtlas: getFaceTextureAtlas(definition, slot),
        alphaTest: isPropTextureAtlas(getFaceTextureAtlas(definition, slot)) ? 0.45 : 0,
        ...(planeZ != null ? { planeZIndex: planeZ } : {}),
      }));
      // _createSurfaceMaterial dedupes by cache key, so identical face refs share one instance.
      // When every face resolves to the same material, return it as a single non-array material so
      // Three.js ignores the geometry's face groups and draws the primitive in one call instead of N.
      const first = materials[0];
      if (first && materials.every((material) => material === first)) {
        return first;
      }
      return materials;
    }

    const planeZ = definition.type === 'plane' ? (definition.zIndex ?? 0) : null;
    const material = this._createSurfaceMaterial(definition.material.color, {
      ...materialOptions,
      textureCell: definition.texture.cell,
      textureAtlas: definition.texture.atlas ?? DEFAULT_TEXTURE_ATLAS,
      side: definition.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: isPropTextureAtlas(definition.texture.atlas) ? 0.45 : 0,
      ...(planeZ != null ? { planeZIndex: planeZ } : {}),
    });

    return material;
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
    const light = this._normalizeLight(definition);
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
    const portal = this._normalizePortal(definition);
    const group = createPortalHelperObject(portal);
    group.position.set(portal.position.x, portal.position.y, portal.position.z);
    group.rotation.set(portal.rotation.x, portal.rotation.y, portal.rotation.z);
    group.visible = this.portalHelpersVisible && !portal.deleted;
    return { definition: portal, group };
  }

  _applyPortalToObject(definition, entry) {
    const portal = this._normalizePortal(definition);
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
    const ep = this._normalizeExtractionPortal(definition);
    const group = createExtractionPortalHelperObject(ep);
    group.position.set(ep.position.x, ep.position.y, ep.position.z);
    group.rotation.set(ep.rotation.x, ep.rotation.y, ep.rotation.z);
    group.visible = this.extractionHelpersVisible && !ep.deleted;
    return { definition: ep, group };
  }

  _applyExtractionPortalToObject(definition, entry) {
    const ep = this._normalizeExtractionPortal(definition);
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
    const task = this._normalizeRaidTask(definition);
    const group = createRaidTaskHelperObject(task, {
      createPrefabObject: (part, slot, taskId) => this._createRaidTaskPrefabObject(part, slot, taskId),
    });
    group.position.set(task.position.x, task.position.y, task.position.z);
    group.rotation.set(task.rotation.x, task.rotation.y, task.rotation.z);
    group.visible = this.raidTaskHelpersVisible && !task.deleted;
    return { definition: task, group };
  }

  _createRaidTaskPrefabObject(part, slot, taskId) {
    const primitive = this._normalizePrimitive({
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
    const task = this._normalizeRaidTask(definition);
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
    const light = this._normalizeLight(definition);
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
    this._removeEditableColliders();

    this.editableGroup.traverse((child) => {
      if (child.userData?.isGlbClone) {
        this._disposeEditableMaterialSet(child.material);
        return;
      }
      if (child.geometry && !child.geometry.userData?.isCachedEditableGeometry) child.geometry.dispose();
      this._disposeEditableMaterialSet(child.material);
    });
    this.editableGroup.clear();
    this.editableMeshes.clear();
    this.editableLightObjects.clear();
    this.editablePortalObjects.clear();
    this.editableRopeObjects.clear();
    this.editableFanObjects.clear();
    this.editableExtractionPortalObjects.clear();
    this.editableRaidTaskObjects.clear();
    this.prefabInstanceGroups.clear();
    this.prefabInstanceIdByPrimitiveId.clear();

    const groupedPrimitives = new Map();

    for (const primitive of this.editableLayout.primitives) {
      if (primitive.prefabInstanceId) {
        const bucket = groupedPrimitives.get(primitive.prefabInstanceId) ?? [];
        bucket.push(primitive);
        groupedPrimitives.set(primitive.prefabInstanceId, bucket);
        this.prefabInstanceIdByPrimitiveId.set(primitive.id, primitive.prefabInstanceId);
        continue;
      }

      if (primitive.type === 'glb') {
        const cachedModel = this.glbModelCache.get(primitive.glbAssetId);
        if (!cachedModel) continue;
        const clone = cachedModel.clone(true);
        const rematerialized = this._applySharedGlbSurfaceMaterial(clone, primitive);
        if (!rematerialized) {
          clone.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material = Array.isArray(child.material)
                ? child.material.map((m) => m.clone())
                : child.material.clone();
            }
          });
        }
        clone.name = primitive.name;
        clone.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
        clone.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
        clone.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
        clone.castShadow = primitive.castShadow;
        clone.receiveShadow = primitive.receiveShadow;
        clone.visible = this._isPrimitiveVisible(primitive);
        clone.userData.editablePrimitive = true;
        clone.userData.primitiveId = primitive.id;
        clone.userData.colliderEnabled = primitive.collider;
        clone.userData.colliderClearance = primitive.colliderClearance ?? 0;
        clone.userData.spawnType = primitive.spawnType;
        clone.userData.skipOutline = primitive.spawnType != null;
        clone.userData.isGlbClone = true;
        clone.traverse((child) => { child.userData.isGlbClone = true; });
        this._syncCameraOccluderUserData(clone, primitive);
        this.editableGroup.add(clone);
        this.editableMeshes.set(primitive.id, clone);

        const collisionMode = this._getEditableGlbCollisionMode(primitive);
        if (collisionMode === 'bvh-proxy') {
          this._registerCollider(clone, {
            type: 'furniture',
            metadata: {
              source: 'editable',
              primitiveId: primitive.id,
              colliderClearance: primitive.colliderClearance,
              collisionMode,
            },
            useBvh: true,
            bvhOptions: {
              maxDepth: 3,
              maxLeafSize: 18,
              maxBoxes: 48,
            },
          });
        }
        continue;
      }

      if (primitive.type === 'prop') {
        const material = this._createEditablePrimitiveMaterial(primitive);
        const sprite = new THREE.Sprite(material);
        sprite.name = primitive.name;
        sprite.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
        sprite.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
        sprite.scale.set(primitive.scale.x, primitive.scale.y, 1);
        sprite.castShadow = false;
        sprite.receiveShadow = false;
        sprite.visible = this._isPrimitiveVisible(primitive);
        sprite.userData.editablePrimitive = true;
        sprite.userData.primitiveId = primitive.id;
        sprite.userData.colliderEnabled = false;
        sprite.userData.spawnType = primitive.spawnType;
        sprite.userData.skipOutline = true;
        this._syncCameraOccluderUserData(sprite, primitive);
        this.editableGroup.add(sprite);
        this.editableMeshes.set(primitive.id, sprite);
        continue;
      }

      const geometry = this._getEditableGeometry(primitive);
      const material = this._createEditablePrimitiveMaterial(primitive);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = primitive.name;
      mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
      mesh.castShadow = primitive.castShadow;
      mesh.receiveShadow = primitive.receiveShadow;
      mesh.visible = this._isPrimitiveVisible(primitive);
      mesh.userData.editablePrimitive = true;
      mesh.userData.primitiveId = primitive.id;
      mesh.userData.colliderEnabled = primitive.collider;
      mesh.userData.spawnType = primitive.spawnType;
      mesh.userData.skipOutline = primitive.spawnType != null;
      if (primitive.type === 'plane') {
        mesh.renderOrder = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
      }
      this._syncCameraOccluderUserData(mesh, primitive);
      this.editableGroup.add(mesh);
      this.editableMeshes.set(primitive.id, mesh);

      if (primitive.collider) {
        const isPlane = primitive.type === 'plane';
        this._registerPrimitiveCollider(mesh, primitive, {
          type: isPlane ? 'surface' : 'furniture',
          metadata: {
            source: 'editable',
            primitiveId: primitive.id,
            collisionMode: 'primitive',
            ...(isPlane ? { plane: true, zIndex: primitive.zIndex ?? 0 } : {}),
          },
        });
      }
    }

    for (const [instanceId, primitives] of groupedPrimitives.entries()) {
      const anchor = primitives[0];
      if (!anchor) continue;
      const origin = anchor.prefabInstanceOrigin ?? anchor.position;
      const rotation = anchor.prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
      const scale = anchor.prefabInstanceScale ?? { x: 1, y: 1, z: 1 };

      const group = new THREE.Group();
      group.name = `PrefabInstance-${instanceId}`;
      group.position.set(origin.x, origin.y, origin.z);
      group.rotation.set(rotation.x, rotation.y, rotation.z);
      group.scale.set(scale.x, scale.y, scale.z);
      group.userData.editablePrimitive = true;
      group.userData.prefabInstanceId = instanceId;
      this.editableGroup.add(group);
      this.prefabInstanceGroups.set(instanceId, {
        group,
        origin,
        rotation,
        scale,
        primitiveIds: primitives.map((primitive) => primitive.id),
      });

      primitives.forEach((primitive) => {
        if (primitive.type === 'prop') {
          const material = this._createEditablePrimitiveMaterial(primitive);
          const sprite = new THREE.Sprite(material);
          sprite.name = primitive.name;
          sprite.position.set(
            primitive.position.x,
            primitive.position.y,
            primitive.position.z,
          );
          sprite.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
          sprite.scale.set(primitive.scale.x, primitive.scale.y, 1);
          sprite.castShadow = false;
          sprite.receiveShadow = false;
          sprite.visible = this._isPrimitiveVisible(primitive);
          sprite.userData.editablePrimitive = true;
          sprite.userData.primitiveId = primitive.id;
          sprite.userData.prefabInstanceId = instanceId;
          sprite.userData.spawnType = primitive.spawnType;
          sprite.userData.skipOutline = true;
          sprite.userData.colliderEnabled = false;
          this._syncCameraOccluderUserData(sprite, primitive);
          group.add(sprite);
          this.editableMeshes.set(primitive.id, sprite);
          this.prefabInstanceIdByPrimitiveId.set(primitive.id, instanceId);
          return;
        }

        const geometry = this._getEditableGeometry(primitive);
        const material = this._createEditablePrimitiveMaterial(primitive);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = primitive.name;
        mesh.position.set(
          primitive.position.x,
          primitive.position.y,
          primitive.position.z,
        );
        mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
        mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
        mesh.castShadow = primitive.castShadow;
        mesh.receiveShadow = primitive.receiveShadow;
        mesh.visible = this._isPrimitiveVisible(primitive);
        mesh.userData.editablePrimitive = true;
        mesh.userData.primitiveId = primitive.id;
        mesh.userData.prefabInstanceId = instanceId;
        mesh.userData.spawnType = primitive.spawnType;
        mesh.userData.skipOutline = primitive.spawnType != null;
        if (primitive.type === 'plane') {
          mesh.renderOrder = Number.isFinite(primitive.zIndex) ? Math.trunc(primitive.zIndex) : 0;
        }
        this._syncCameraOccluderUserData(mesh, primitive);
        group.add(mesh);
        this.editableMeshes.set(primitive.id, mesh);
        this.prefabInstanceIdByPrimitiveId.set(primitive.id, instanceId);

        if (primitive.collider) {
          const isPlane = primitive.type === 'plane';
          this._registerPrimitiveCollider(mesh, primitive, {
            type: isPlane ? 'surface' : 'furniture',
            metadata: {
              source: 'editable',
              primitiveId: primitive.id,
              prefabInstanceId: instanceId,
              ...(isPlane ? { plane: true, zIndex: primitive.zIndex ?? 0 } : {}),
            },
          });
        }
      });
    }

    for (const definition of this.editableLayout.lights ?? []) {
      const entry = this._createEditableLightObject(definition);
      this.editableGroup.add(entry.group);
      this.editableLightObjects.set(entry.definition.id, entry);
    }

    for (const definition of this.editableLayout.portals ?? []) {
      const entry = this._createEditablePortalObject(definition);
      this.editableGroup.add(entry.group);
      this.editablePortalObjects.set(entry.definition.id, entry);
    }

    for (const definition of this.editableLayout.ropes ?? []) {
      const entry = this._createEditableRopeObject(definition);
      this.editableGroup.add(entry.group);
      this.editableRopeObjects.set(entry.definition.id, entry);
    }

    for (const definition of this.editableLayout.fans ?? []) {
      const entry = this._createEditableFanObject(definition);
      this.editableGroup.add(entry.group);
      this.editableFanObjects.set(entry.definition.id, entry);
    }

    for (const definition of this.editableLayout.extractionPortals ?? []) {
      const entry = this._createEditableExtractionPortalObject(definition);
      this.editableGroup.add(entry.group);
      this.editableExtractionPortalObjects.set(entry.definition.id, entry);
    }

    for (const definition of this.editableLayout.raidTasks ?? []) {
      const entry = this._createEditableRaidTaskObject(definition);
      this.editableGroup.add(entry.group);
      this.editableRaidTaskObjects.set(entry.definition.id, entry);
      this._registerRaidTaskPrefabColliders(entry);
    }

    this._applyTextureAtlas();
    this.refreshColliders();
    void this.vegetationSystem.rebuild(this.editableLayout.vegetation ?? []);

    if (this._staticMergeEnabled) {
      this._buildStaticMergedMeshes();
    }
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
    // Unhide originals that were merged. Materials on merged meshes are shared
    // references to the originals, so do NOT dispose them. Only dispose
    // geometries we created (the merged path); instanced path reuses the
    // primitive's cached geometry and must not be disposed.
    this._staticMergedGroup.traverse((child) => {
      if (!child.isMesh) return;
      if (child.isInstancedMesh) {
        child.dispose?.();
        return;
      }
      if (child.userData?.staticInstanceKind === 'merged' && child.geometry) {
        child.geometry.dispose();
      }
    });
    this._staticMergedGroup.clear();
    for (const mesh of this.editableMeshes.values()) {
      if (mesh?.userData?.mergedIntoStatic) {
        mesh.userData.mergedIntoStatic = false;
        mesh.visible = this._isPrimitiveVisible(
          this.editableLayout.primitives.find((p) => p.id === mesh.userData.primitiveId) ?? {},
        );
      }
    }
  }

  getStaticBakeStats() {
    return this._staticBakeStats ?? null;
  }

  _buildStaticMergedMeshes() {
    this._clearStaticMergedMeshes();
    const stats = {
      instancedGroups: 0,
      instancedPrimitives: 0,
      mergedGroups: 0,
      mergedPrimitives: 0,
      skippedPrimitives: 0,
      totalEligible: 0,
      // One draw call per instanced group + one per merged group, replacing
      // `instancedPrimitives + mergedPrimitives` original per-mesh calls.
      bakedDrawCalls: 0,
      replacedDrawCalls: 0,
    };

    // Two-pass bake:
    //   Pass A — INSTANCE groups: meshes that share geometry AND material are
    //            drawn through a single InstancedMesh (one draw call for the
    //            group, plus one shadow pass). This is strictly better than
    //            mergeGeometries when the same geometry repeats, because we
    //            keep one small buffer instead of baking N copies.
    //   Pass B — MERGE groups: remaining meshes (unique geometry but shared
    //            material) fall back to mergeGeometries so we still collapse
    //            mixed-sized primitives that happen to share a material.
    //
    // Skip meshes we can't safely bake: GLB clones (their own tree), spawn
    // markers, invisible meshes, and array materials (unmerged face textures).
    const instanceGroups = new Map();
    const mergeCandidates = [];

    for (const [primitiveId, mesh] of this.editableMeshes.entries()) {
      if (!mesh?.isMesh) continue;
      if (mesh.userData?.isGlbClone) { stats.skippedPrimitives += 1; continue; }
      if (mesh.userData?.spawnType) { stats.skippedPrimitives += 1; continue; }
      if (!mesh.visible) { stats.skippedPrimitives += 1; continue; }
      if (!mesh.geometry || !mesh.material) { stats.skippedPrimitives += 1; continue; }
      if (Array.isArray(mesh.material)) { stats.skippedPrimitives += 1; continue; }
      stats.totalEligible += 1;

      const castShadow = mesh.castShadow ? 1 : 0;
      const receiveShadow = mesh.receiveShadow ? 1 : 0;
      const instanceKey = `${mesh.geometry.uuid}|${mesh.material.uuid}|${castShadow}|${receiveShadow}`;
      let bucket = instanceGroups.get(instanceKey);
      if (!bucket) {
        bucket = {
          geometry: mesh.geometry,
          material: mesh.material,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          meshes: [],
        };
        instanceGroups.set(instanceKey, bucket);
      }
      bucket.meshes.push({ mesh, primitiveId });
    }

    this.editableGroup.updateMatrixWorld(true);
    const parentInv = new THREE.Matrix4().copy(this._staticMergedGroup.matrixWorld).invert();
    const localMatrix = new THREE.Matrix4();

    // Pass A: instanced groups.
    for (const bucket of instanceGroups.values()) {
      if (bucket.meshes.length < 2) {
        // Single mesh — let the merge pass try to pair it by material instead.
        for (const entry of bucket.meshes) mergeCandidates.push(entry);
        continue;
      }

      const instanced = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.meshes.length);
      instanced.castShadow = bucket.castShadow;
      instanced.receiveShadow = bucket.receiveShadow;
      instanced.userData.isStaticMerged = true;
      instanced.userData.staticInstanceKind = 'instanced';
      instanced.userData.skipOutline = true;
      // Static bake — matrices never change after build, so hint Three.js to skip upload work.
      instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      bucket.meshes.forEach((entry, i) => {
        entry.mesh.updateMatrixWorld(true);
        localMatrix.multiplyMatrices(parentInv, entry.mesh.matrixWorld);
        instanced.setMatrixAt(i, localMatrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      this._staticMergedGroup.add(instanced);

      for (const entry of bucket.meshes) {
        entry.mesh.visible = false;
        entry.mesh.userData.mergedIntoStatic = true;
      }
      stats.instancedGroups += 1;
      stats.instancedPrimitives += bucket.meshes.length;
    }

    // Pass B: merge remaining meshes by (material, shadow flags).
    const mergeGroups = new Map();
    for (const entry of mergeCandidates) {
      const { mesh } = entry;
      const key = `${mesh.material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
      let bucket = mergeGroups.get(key);
      if (!bucket) {
        bucket = {
          material: mesh.material,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          meshes: [],
        };
        mergeGroups.set(key, bucket);
      }
      bucket.meshes.push(entry);
    }

    for (const bucket of mergeGroups.values()) {
      if (bucket.meshes.length < 2) continue;

      const geometries = [];
      const merged = [];
      for (const entry of bucket.meshes) {
        const { mesh } = entry;
        const source = mesh.geometry;
        if (!source.attributes?.position) continue;
        const baked = source.clone();
        if (baked.groups?.length) baked.clearGroups();
        mesh.updateMatrixWorld(true);
        localMatrix.multiplyMatrices(parentInv, mesh.matrixWorld);
        baked.applyMatrix4(localMatrix);
        geometries.push(baked);
        merged.push(entry);
      }

      if (geometries.length < 2) {
        geometries.forEach((g) => g.dispose());
        continue;
      }

      const mergedGeometry = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      if (!mergedGeometry) continue;

      const mergedMesh = new THREE.Mesh(mergedGeometry, bucket.material);
      mergedMesh.castShadow = bucket.castShadow;
      mergedMesh.receiveShadow = bucket.receiveShadow;
      mergedMesh.userData.isStaticMerged = true;
      mergedMesh.userData.staticInstanceKind = 'merged';
      mergedMesh.userData.skipOutline = true;
      this._staticMergedGroup.add(mergedMesh);

      for (const entry of merged) {
        entry.mesh.visible = false;
        entry.mesh.userData.mergedIntoStatic = true;
      }
      stats.mergedGroups += 1;
      stats.mergedPrimitives += merged.length;
    }

    stats.bakedDrawCalls = stats.instancedGroups + stats.mergedGroups;
    stats.replacedDrawCalls = stats.instancedPrimitives + stats.mergedPrimitives;
    this._staticBakeStats = stats;
  }

  _isPrimitiveVisible(primitive) {
    if (primitive?.deleted) return false;
    if (primitive?.hiddenByGeneratedBake) return false;
    if (primitive?.spawnType) return this.spawnMarkersVisible;
    return true;
  }

  setSpawnMarkersVisible(visible) {
    this.spawnMarkersVisible = visible === true;

    for (const primitive of this.editableLayout.primitives) {
      if (!primitive?.spawnType) continue;
      const mesh = this.editableMeshes.get(primitive.id);
      if (mesh) {
        mesh.visible = this._isPrimitiveVisible(primitive);
      }
    }
  }

  setPortalHelpersVisible(visible) {
    this.portalHelpersVisible = visible === true;
    for (const entry of this.editablePortalObjects.values()) {
      entry.group.visible = this.portalHelpersVisible && !entry.definition.deleted;
    }
  }

  setExtractionHelpersVisible(visible) {
    this.extractionHelpersVisible = visible === true;
    for (const entry of this.editableExtractionPortalObjects.values()) {
      entry.group.visible = this.extractionHelpersVisible && !entry.definition.deleted;
    }
  }

  setRaidTaskHelpersVisible(visible) {
    this.raidTaskHelpersVisible = visible === true;
    for (const entry of this.editableRaidTaskObjects.values()) {
      entry.group.visible = this.raidTaskHelpersVisible && !entry.definition.deleted;
    }
  }

  setRaidTaskPrefabEditorPreview(taskId, slot = 'auto') {
    if (!taskId) return;
    const entry = this.editableRaidTaskObjects.get(taskId);
    entry?.group.userData.setRaidTaskEditorPreview?.(slot);
  }

  setRaidTaskPrefabEditTarget(taskId, slot = 'marker') {
    if (!taskId) return;
    const normalized = slot === 'before' || slot === 'after' ? slot : 'marker';
    if (normalized === 'marker') {
      this.raidTaskPrefabEditTargets.delete(taskId);
    } else {
      this.raidTaskPrefabEditTargets.set(taskId, normalized);
    }
  }

  getVibePortalPlacements() {
    return collectVibePortalPlacementsFromLayout(this.getEditableLayout());
  }

  getEditableLayout() {
    const builtIns = Array.from(this.builtInEditableMeshes.values()).map((entry) => this._serializeBuiltInPrimitive(entry));
    const customs = this.editableLayout.primitives.map((entry) => this._normalizePrimitive(entry));
    const lights = (this.editableLayout.lights ?? []).map((entry) => this._normalizeLight(entry));
    const portals = (this.editableLayout.portals ?? []).map((entry) => this._normalizePortal(entry));
    const ropes = (this.editableLayout.ropes ?? []).map((entry) => this._normalizeRope(entry));
    const fans = (this.editableLayout.fans ?? []).map((entry) => this._normalizeFan(entry));
    const extractionPortals = (this.editableLayout.extractionPortals ?? []).map((entry) => this._normalizeExtractionPortal(entry));
    const raidTasks = (this.editableLayout.raidTasks ?? []).map((entry) => this._normalizeRaidTask(entry));
    const vegetation = (this.editableLayout.vegetation ?? []).map((entry) => this._normalizeVegetation(entry));
    return {
      version: Math.max(this.loadedEditableLayout.version ?? 1, this.editableLayout.version ?? 1, 1),
      primitives: [...builtIns, ...customs],
      lights,
      portals,
      ropes,
      fans,
      extractionPortals,
      raidTasks,
      vegetation,
    };
  }

  setEditableLayout(layout) {
    this.loadedEditableLayout = {
      version: layout?.version ?? 1,
      primitives: Array.isArray(layout?.primitives) ? layout.primitives.map((entry) => this._normalizePrimitive(entry)) : [],
      lights: Array.isArray(layout?.lights) ? layout.lights.map((entry) => this._normalizeLight(entry)) : [],
      portals: Array.isArray(layout?.portals) ? layout.portals.map((entry) => this._normalizePortal(entry)) : [],
      ropes: Array.isArray(layout?.ropes) ? layout.ropes.map((entry) => this._normalizeRope(entry)) : [],
      fans: Array.isArray(layout?.fans) ? layout.fans.map((entry) => this._normalizeFan(entry)) : [],
      extractionPortals: Array.isArray(layout?.extractionPortals)
        ? layout.extractionPortals.map((entry) => this._normalizeExtractionPortal(entry))
        : [],
      raidTasks: Array.isArray(layout?.raidTasks)
        ? layout.raidTasks.map((entry) => this._normalizeRaidTask(entry))
        : [],
      vegetation: Array.isArray(layout?.vegetation)
        ? layout.vegetation.map((entry) => this._normalizeVegetation(entry))
        : [],
    };
    this._applyLoadedEditableLayout();
    this._rebuildEditableLayout();
    return this.getEditableLayout();
  }

  getEditableRopeDefinitions() {
    return (this.editableLayout.ropes ?? [])
      .map((entry) => this._normalizeRope(entry))
      .filter((entry) => !entry.deleted)
      .map(({ id, anchor, length, segmentCount }) => ({ id, anchor, length, segmentCount }));
  }

  upsertEditablePrimitive(definition) {
    const primitive = this._normalizePrimitive(definition);
    if (this.builtInEditableMeshes.has(primitive.id)) {
      const entry = this.builtInEditableMeshes.get(primitive.id);
      this.deletedBuiltInPrimitives.delete(primitive.id);
      primitive.deleted = false;
      entry.primitive = primitive;
      this._applyPrimitiveToMesh(primitive, entry.mesh);
      this.refreshColliders();
      this._applyTextureAtlas();
      return primitive;
    }
    const index = this.editableLayout.primitives.findIndex((entry) => entry.id === primitive.id);
    if (index >= 0) {
      this.editableLayout.primitives[index] = primitive;
    } else {
      this.editableLayout.primitives.push(primitive);
    }
    this._rebuildEditableLayout();
    return primitive;
  }

  replaceEditablePrimitive(id, definitions = []) {
    const replacements = Array.isArray(definitions)
      ? definitions.map((entry) => this._normalizePrimitive(entry))
      : [];

    if (this.builtInEditableMeshes.has(id)) {
      const entry = this.builtInEditableMeshes.get(id);
      this.deletedBuiltInPrimitives.add(id);
      entry.mesh.visible = false;
      entry.mesh.userData.colliderEnabled = false;
    }

    this.editableLayout.primitives = this.editableLayout.primitives.filter((entry) => entry.id !== id);
    this.loadedEditableLayout.primitives = (this.loadedEditableLayout.primitives ?? []).filter((entry) => entry.id !== id);

    this.editableLayout.primitives.push(...replacements.map((entry) => this._normalizePrimitive(entry)));
    this.loadedEditableLayout.primitives.push(...replacements.map((entry) => this._normalizePrimitive(entry)));

    this._rebuildEditableLayout();
    return replacements;
  }

  upsertEditableLight(definition) {
    const light = this._normalizeLight(definition);
    const index = this.editableLayout.lights.findIndex((entry) => entry.id === light.id);
    if (index >= 0) {
      const current = this.editableLightObjects.get(light.id);
      const currentType = current?.definition?.lightType ?? this.editableLayout.lights[index]?.lightType;
      if (currentType !== light.lightType) {
        this.editableLayout.lights[index] = light;
        this._rebuildEditableLayout();
        return light;
      }
      this.editableLayout.lights[index] = light;
      if (current) {
        this._applyLightToObject(light, current);
      }
      return light;
    }

    this.editableLayout.lights.push(light);
    this._rebuildEditableLayout();
    return light;
  }

  upsertEditablePortal(definition) {
    const portal = this._normalizePortal(definition);
    const index = this.editableLayout.portals.findIndex((entry) => entry.id === portal.id);
    if (index >= 0) {
      const previous = this._normalizePortal(this.editableLayout.portals[index]);
      this.editableLayout.portals[index] = portal;
      if (
        previous.portalType !== portal.portalType
        || Math.abs((previous.triggerRadius ?? 0) - (portal.triggerRadius ?? 0)) > 0.0001
      ) {
        this._rebuildEditableLayout();
        return portal;
      }
      const current = this.editablePortalObjects.get(portal.id);
      if (current) {
        this._applyPortalToObject(portal, current);
      }
      return portal;
    }

    this.editableLayout.portals.push(portal);
    this._rebuildEditableLayout();
    return portal;
  }

  removeEditablePrimitive(id) {
    if (this.builtInEditableMeshes.has(id)) {
      const entry = this.builtInEditableMeshes.get(id);
      this.deletedBuiltInPrimitives.add(id);
      entry.mesh.visible = false;
      entry.mesh.userData.colliderEnabled = false;
      this.refreshColliders();
      return;
    }
    this.editableLayout.primitives = this.editableLayout.primitives.filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  removeEditableLight(id) {
    this.editableLayout.lights = this.editableLayout.lights.filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  removeEditablePortal(id) {
    this.editableLayout.portals = this.editableLayout.portals.filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditablePrimitive(id) {
    if (this.builtInEditableMeshes.has(id)) {
      const entry = this.builtInEditableMeshes.get(id);
      this.deletedBuiltInPrimitives.add(id);
      entry.mesh.visible = false;
      entry.mesh.userData.colliderEnabled = false;
      this.refreshColliders();
      return;
    }

    const prefabInstanceId = this.prefabInstanceIdByPrimitiveId.get(id);
    if (prefabInstanceId) {
      this.editableLayout.primitives = this.editableLayout.primitives.filter((entry) => entry.prefabInstanceId !== prefabInstanceId);
      this.loadedEditableLayout.primitives = this.loadedEditableLayout.primitives.filter((entry) => entry.prefabInstanceId !== prefabInstanceId);
      this._rebuildEditableLayout();
      return;
    }

    this.editableLayout.primitives = this.editableLayout.primitives.filter((entry) => entry.id !== id);
    this.loadedEditableLayout.primitives = this.loadedEditableLayout.primitives.filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditableLight(id) {
    this.editableLayout.lights = this.editableLayout.lights.filter((entry) => entry.id !== id);
    this.loadedEditableLayout.lights = (this.loadedEditableLayout.lights ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditablePortal(id) {
    this.editableLayout.portals = this.editableLayout.portals.filter((entry) => entry.id !== id);
    this.loadedEditableLayout.portals = (this.loadedEditableLayout.portals ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  upsertEditableExtractionPortal(definition) {
    const ep = this._normalizeExtractionPortal(definition);
    const list = this.editableLayout.extractionPortals ?? (this.editableLayout.extractionPortals = []);
    const index = list.findIndex((entry) => entry.id === ep.id);
    if (index >= 0) {
      const previous = this._normalizeExtractionPortal(list[index]);
      list[index] = ep;
      if (Math.abs((previous.radius ?? 0) - (ep.radius ?? 0)) > 0.0001) {
        this._rebuildEditableLayout();
        return ep;
      }
      const current = this.editableExtractionPortalObjects.get(ep.id);
      if (current) {
        this._applyExtractionPortalToObject(ep, current);
      }
      return ep;
    }

    list.push(ep);
    this._rebuildEditableLayout();
    return ep;
  }

  removeEditableExtractionPortal(id) {
    const list = this.editableLayout.extractionPortals ?? [];
    this.editableLayout.extractionPortals = list.filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditableExtractionPortal(id) {
    const list = this.editableLayout.extractionPortals ?? [];
    this.editableLayout.extractionPortals = list.filter((entry) => entry.id !== id);
    this.loadedEditableLayout.extractionPortals = (this.loadedEditableLayout.extractionPortals ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  upsertEditableRaidTask(definition) {
    const task = this._normalizeRaidTask(definition);
    const list = this.editableLayout.raidTasks ?? (this.editableLayout.raidTasks = []);
    const index = list.findIndex((entry) => entry.id === task.id);
    if (index >= 0) {
      list[index] = task;
      const current = this.editableRaidTaskObjects.get(task.id);
      if (current) {
        this._applyRaidTaskToObject(task, current);
      }
      return task;
    }

    list.push(task);
    this._rebuildEditableLayout();
    return task;
  }

  removeEditableRaidTask(id) {
    const list = this.editableLayout.raidTasks ?? [];
    this.editableLayout.raidTasks = list.filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditableRaidTask(id) {
    const list = this.editableLayout.raidTasks ?? [];
    this.editableLayout.raidTasks = list.filter((entry) => entry.id !== id);
    this.loadedEditableLayout.raidTasks = (this.loadedEditableLayout.raidTasks ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  upsertEditableRope(definition) {
    const rope = this._normalizeRope(definition);
    const ropes = this.editableLayout.ropes ?? (this.editableLayout.ropes = []);
    const index = ropes.findIndex((entry) => entry.id === rope.id);
    if (index >= 0) {
      const previous = this._normalizeRope(ropes[index]);
      ropes[index] = rope;
      if (
        Math.abs(previous.length - rope.length) > 0.0001
        || previous.segmentCount !== rope.segmentCount
        || Math.abs((previous.segmentRadius ?? 0) - (rope.segmentRadius ?? 0)) > 0.0001
      ) {
        this._rebuildEditableLayout();
        return rope;
      }
      const current = this.editableRopeObjects.get(rope.id);
      if (current) {
        this._applyRopeToObject(rope, current);
      }
      return rope;
    }

    ropes.push(rope);
    this._rebuildEditableLayout();
    return rope;
  }

  upsertEditableFan(definition) {
    const fan = this._normalizeFan(definition);
    const fans = this.editableLayout.fans ?? (this.editableLayout.fans = []);
    const index = fans.findIndex((entry) => entry.id === fan.id);
    if (index >= 0) {
      const previous = this._normalizeFan(fans[index]);
      fans[index] = fan;
      if (
        previous.bladeCount !== fan.bladeCount
        || Math.abs(previous.bladeLength - fan.bladeLength) > 0.0001
        || Math.abs(previous.bladeWidth - fan.bladeWidth) > 0.0001
        || Math.abs(previous.hubRadius - fan.hubRadius) > 0.0001
        || Math.abs(previous.rodLength - fan.rodLength) > 0.0001
      ) {
        this._rebuildEditableLayout();
        return fan;
      }
      const current = this.editableFanObjects.get(fan.id);
      if (current) {
        this._applyFanToObject(fan, current);
      }
      return fan;
    }

    fans.push(fan);
    this._rebuildEditableLayout();
    return fan;
  }

  removeEditableRope(id) {
    this.editableLayout.ropes = (this.editableLayout.ropes ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditableRope(id) {
    this.editableLayout.ropes = (this.editableLayout.ropes ?? []).filter((entry) => entry.id !== id);
    this.loadedEditableLayout.ropes = (this.loadedEditableLayout.ropes ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  removeEditableFan(id) {
    this.editableLayout.fans = (this.editableLayout.fans ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  purgeEditableFan(id) {
    this.editableLayout.fans = (this.editableLayout.fans ?? []).filter((entry) => entry.id !== id);
    this.loadedEditableLayout.fans = (this.loadedEditableLayout.fans ?? []).filter((entry) => entry.id !== id);
    this._rebuildEditableLayout();
  }

  updateEditableRopeTransform(id, transform = {}) {
    const ropes = this.editableLayout.ropes ?? [];
    const index = ropes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const rope = this._normalizeRope(ropes[index]);
    if (transform.position) {
      rope.anchor = cloneVectorLike(transform.position, rope.anchor);
    } else if (transform.anchor) {
      rope.anchor = cloneVectorLike(transform.anchor, rope.anchor);
    }

    ropes[index] = rope;
    const current = this.editableRopeObjects.get(id);
    if (current) {
      this._applyRopeToObject(rope, current);
    }
    return rope;
  }

  updateEditableFanTransform(id, transform = {}) {
    const fans = this.editableLayout.fans ?? [];
    const index = fans.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const fan = this._normalizeFan(fans[index]);
    if (transform.position) {
      fan.position = cloneVectorLike(transform.position, fan.position);
    }
    if (transform.rotation) {
      fan.rotation = cloneVectorLike(transform.rotation, fan.rotation);
    }
    fans[index] = fan;
    const current = this.editableFanObjects.get(id);
    if (current) {
      this._applyFanToObject(fan, current);
    }
    return fan;
  }

  snapRopeToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const rope = this._normalizeRope(definition);
    const grid = this.getBuildGridConfig();

    if (snapPosition) {
      rope.anchor.x = this._snapGridAxisPosition(
        rope.anchor.x,
        0.3,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      rope.anchor.z = this._snapGridAxisPosition(
        rope.anchor.z,
        0.3,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      rope.anchor.y = snapToStep(rope.anchor.y, grid.verticalStep);
    }

    rope.anchor = roundVectorLike(rope.anchor, { x: 0, y: 0, z: 0 });
    rope.length = Number(rope.length.toFixed(4));
    return rope;
  }

  snapFanToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const fan = this._normalizeFan(definition);
    const grid = this.getBuildGridConfig();

    if (snapPosition) {
      fan.position.x = this._snapGridAxisPosition(
        fan.position.x,
        0.5,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      fan.position.z = this._snapGridAxisPosition(
        fan.position.z,
        0.5,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      fan.position.y = snapToStep(fan.position.y, grid.verticalStep);
    }

    fan.position = roundVectorLike(fan.position, { x: 0, y: 3.35, z: 0 });
    fan.rotation = roundVectorLike(fan.rotation, { x: 0, y: 0, z: 0 });
    return fan;
  }

  setRopeHelpersVisible(visible) {
    this.ropeHelpersVisible = visible === true;
    this.editableRopeObjects.forEach((entry) => {
      if (entry?.group) {
        entry.group.visible = this.ropeHelpersVisible && !entry.definition?.deleted;
      }
    });
  }

  setVegetationLibrary(library) {
    return this.vegetationSystem.setLibrary(library);
  }

  upsertEditableVegetation(definition) {
    const vegetation = this._normalizeVegetation(definition);
    const list = this.editableLayout.vegetation ?? (this.editableLayout.vegetation = []);
    const index = list.findIndex((entry) => entry.id === vegetation.id);
    if (index >= 0) {
      list[index] = vegetation;
    } else {
      list.push(vegetation);
    }
    void this.vegetationSystem.rebuild(list);
    return vegetation;
  }

  purgeEditableVegetation(id) {
    this.editableLayout.vegetation = (this.editableLayout.vegetation ?? []).filter((entry) => entry.id !== id);
    this.loadedEditableLayout.vegetation = (this.loadedEditableLayout.vegetation ?? []).filter((entry) => entry.id !== id);
    void this.vegetationSystem.rebuild(this.editableLayout.vegetation ?? []);
  }

  updateEditableVegetationTransform(id, transform = {}) {
    const list = this.editableLayout.vegetation ?? [];
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const vegetation = this._normalizeVegetation(list[index]);
    if (transform.position) {
      vegetation.position = cloneVectorLike(transform.position, vegetation.position);
    }
    if (transform.rotation) {
      vegetation.rotation = cloneVectorLike(transform.rotation, vegetation.rotation);
    }
    if (transform.scale) {
      vegetation.scale = cloneVectorLike(transform.scale, vegetation.scale);
    }

    list[index] = vegetation;
    const current = this.vegetationSystem.getEditableObject(id);
    if (current) {
      current.position.set(vegetation.position.x, vegetation.position.y, vegetation.position.z);
      current.rotation.set(vegetation.rotation.x, vegetation.rotation.y, vegetation.rotation.z);
      current.scale.set(vegetation.scale.x, vegetation.scale.y, vegetation.scale.z);
      current.updateMatrixWorld(true);
      this.refreshColliders();
    }
    return vegetation;
  }

  snapVegetationToGrid(definition, {
    snapY = false,
    snapPosition = true,
    snapScale = false,
    allowEdgeOverflow = false,
  } = {}) {
    const vegetation = this._normalizeVegetation(definition);
    const grid = this.getBuildGridConfig();

    if (snapPosition) {
      vegetation.position.x = this._snapGridAxisPosition(
        vegetation.position.x,
        0.4,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      vegetation.position.z = this._snapGridAxisPosition(
        vegetation.position.z,
        0.4,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      vegetation.position.y = snapToStep(vegetation.position.y, grid.verticalStep);
    }

    if (snapScale) {
      vegetation.scale.x = snapToStep(vegetation.scale.x, 0.1);
      vegetation.scale.y = snapToStep(vegetation.scale.y, 0.1);
      vegetation.scale.z = snapToStep(vegetation.scale.z, 0.1);
    }

    vegetation.position = roundVectorLike(vegetation.position, { x: 0, y: 0, z: 0 });
    vegetation.scale = roundVectorLike(vegetation.scale, { x: 1, y: 1, z: 1 });
    vegetation.area = normalizeVegetationPlacement(vegetation).area;
    vegetation.line = normalizeVegetationPlacement(vegetation).line;
    return vegetation;
  }

  getEditableMesh(id) {
    return this.getEditableObject(id);
  }

  getEditableObject(id) {
    const vegetationObject = this.vegetationSystem.getEditableObject(id);
    if (vegetationObject) {
      return vegetationObject;
    }
    if (this.editableLightObjects.has(id)) {
      return this.editableLightObjects.get(id)?.group ?? null;
    }
    if (this.editablePortalObjects.has(id)) {
      return this.editablePortalObjects.get(id)?.group ?? null;
    }
    if (this.editableExtractionPortalObjects.has(id)) {
      return this.editableExtractionPortalObjects.get(id)?.group ?? null;
    }
    if (this.editableRaidTaskObjects.has(id)) {
      const entry = this.editableRaidTaskObjects.get(id);
      const slot = this.raidTaskPrefabEditTargets.get(id);
      if (slot === 'before' || slot === 'after') {
        return entry?.group.userData.getRaidTaskPrefabObject?.(slot) ?? entry?.group ?? null;
      }
      return entry?.group ?? null;
    }
    if (this.editableFanObjects.has(id)) {
      return this.editableFanObjects.get(id)?.group ?? null;
    }
    if (this.editableRopeObjects.has(id)) {
      return this.editableRopeObjects.get(id)?.group ?? null;
    }
    const prefabInstanceId = this.prefabInstanceIdByPrimitiveId.get(id);
    if (prefabInstanceId) {
      return this.prefabInstanceGroups.get(prefabInstanceId)?.group ?? null;
    }
    if (this.builtInEditableMeshes.has(id)) {
      return this.builtInEditableMeshes.get(id)?.mesh ?? null;
    }

    return this.editableMeshes.get(id) ?? null;
  }

  updateEditablePrimitiveTransform(id, transform = {}) {
    if (!id) return null;

    const prefabInstanceId = this.prefabInstanceIdByPrimitiveId.get(id);
    if (prefabInstanceId) {
      return this.updatePrefabInstanceTransform(prefabInstanceId, transform);
    }

    if (this.prefabInstanceGroups.has(id)) {
      return this.updatePrefabInstanceTransform(id, transform);
    }

    if (this.builtInEditableMeshes.has(id)) {
      const entry = this.builtInEditableMeshes.get(id);
      const next = this._serializeBuiltInPrimitive(entry);

      if (transform.position) {
        next.position = cloneVectorLike(transform.position, next.position);
      }
      if (transform.rotation) {
        next.rotation = cloneVectorLike(transform.rotation, next.rotation);
      }
      if (transform.scale) {
        next.scale = cloneVectorLike(transform.scale, next.scale);
      }

      return this.upsertEditablePrimitive(next);
    }

    const index = this.editableLayout.primitives.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const primitive = this._normalizePrimitive(this.editableLayout.primitives[index]);
    if (transform.position) {
      primitive.position = cloneVectorLike(transform.position, primitive.position);
    }
    if (transform.rotation) {
      primitive.rotation = cloneVectorLike(transform.rotation, primitive.rotation);
    }
    if (transform.scale) {
      primitive.scale = cloneVectorLike(transform.scale, primitive.scale);
    }

    this.editableLayout.primitives[index] = primitive;
    const mesh = this.editableMeshes.get(id);
    if (mesh) {
      mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
      mesh.rotation.set(primitive.rotation.x, primitive.rotation.y, primitive.rotation.z);
      mesh.scale.set(primitive.scale.x, primitive.scale.y, primitive.scale.z);
      mesh.updateMatrixWorld(true);
    }
    this.refreshColliders();
    return primitive;
  }

  updateEditableLightTransform(id, transform = {}) {
    const index = this.editableLayout.lights.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const light = this._normalizeLight(this.editableLayout.lights[index]);
    if (transform.position) {
      light.position = cloneVectorLike(transform.position, light.position);
    }
    if (transform.rotation) {
      light.rotation = cloneVectorLike(transform.rotation, light.rotation);
    }

    this.editableLayout.lights[index] = light;
    const current = this.editableLightObjects.get(id);
    if (current) {
      this._applyLightToObject(light, current);
    }
    return light;
  }

  updateEditablePortalTransform(id, transform = {}) {
    const index = this.editableLayout.portals.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const portal = this._normalizePortal(this.editableLayout.portals[index]);
    if (transform.position) {
      portal.position = cloneVectorLike(transform.position, portal.position);
    }
    if (transform.rotation) {
      portal.rotation = cloneVectorLike(transform.rotation, portal.rotation);
    }
    if (Number.isFinite(transform.triggerRadius)) {
      portal.triggerRadius = Math.max(0.1, transform.triggerRadius);
    }

    this.editableLayout.portals[index] = portal;
    const current = this.editablePortalObjects.get(id);
    if (current) {
      this._applyPortalToObject(portal, current);
    }
    return portal;
  }

  updateEditableExtractionPortalTransform(id, transform = {}) {
    const list = this.editableLayout.extractionPortals ?? [];
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const ep = this._normalizeExtractionPortal(list[index]);
    if (transform.position) {
      ep.position = cloneVectorLike(transform.position, ep.position);
    }
    if (transform.rotation) {
      ep.rotation = cloneVectorLike(transform.rotation, ep.rotation);
    }
    if (Number.isFinite(transform.radius)) {
      ep.radius = Math.max(0.35, Math.min(4, transform.radius));
    }

    list[index] = ep;
    const current = this.editableExtractionPortalObjects.get(id);
    if (current) {
      this._applyExtractionPortalToObject(ep, current);
    }
    return ep;
  }

  updateEditableRaidTaskTransform(id, transform = {}) {
    const list = this.editableLayout.raidTasks ?? [];
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const task = this._normalizeRaidTask(list[index]);
    const prefabSlot = transform.prefabSlot === 'before' || transform.prefabSlot === 'after'
      ? transform.prefabSlot
      : null;
    if (prefabSlot) {
      const key = prefabSlot === 'after' ? 'afterPrefab' : 'beforePrefab';
      const currentPrefab = task[key] ?? {
        enabled: true,
        prefabId: '',
        name: '',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        primitives: [],
      };
      task[key] = {
        ...currentPrefab,
        enabled: currentPrefab.enabled !== false,
        position: transform.position ? cloneVectorLike(transform.position, currentPrefab.position) : currentPrefab.position,
        rotation: transform.rotation ? cloneVectorLike(transform.rotation, currentPrefab.rotation) : currentPrefab.rotation,
        scale: transform.scale ? cloneVectorLike(transform.scale, currentPrefab.scale) : currentPrefab.scale,
      };
      list[index] = this._normalizeRaidTask(task);
      const current = this.editableRaidTaskObjects.get(id);
      if (current) {
        this._applyRaidTaskToObject(list[index], current);
      }
      return list[index];
    }

    if (transform.position) {
      task.position = cloneVectorLike(transform.position, task.position);
    }
    if (transform.rotation) {
      task.rotation = cloneVectorLike(transform.rotation, task.rotation);
    }

    list[index] = task;
    const current = this.editableRaidTaskObjects.get(id);
    if (current) {
      this._applyRaidTaskToObject(task, current);
    }
    return task;
  }

  updatePrefabInstanceTransform(instanceId, transform = {}) {
    const primitives = this.editableLayout.primitives.filter((entry) => entry.prefabInstanceId === instanceId);
    if (!primitives.length) return null;

    if (!transform.position && !transform.rotation && !transform.scale) {
      return primitives[0];
    }

    const anchor = primitives[0].prefabInstanceOrigin ?? primitives[0].position;
    const nextAnchor = transform.position ? cloneVectorLike(transform.position, anchor) : cloneVectorLike(anchor, { x: 0, y: 0, z: 0 });
    const nextRotation = transform.rotation
      ? cloneVectorLike(transform.rotation, primitives[0].prefabInstanceRotation ?? { x: 0, y: 0, z: 0 })
      : cloneVectorLike(primitives[0].prefabInstanceRotation ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const nextScale = transform.scale
      ? cloneVectorLike(transform.scale, primitives[0].prefabInstanceScale ?? { x: 1, y: 1, z: 1 })
      : cloneVectorLike(primitives[0].prefabInstanceScale ?? { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });

    primitives.forEach((primitive) => {
      primitive.prefabInstanceOrigin = roundVectorLike(nextAnchor, { x: 0, y: 0, z: 0 });
      primitive.prefabInstanceRotation = roundVectorLike(nextRotation, { x: 0, y: 0, z: 0 });
      primitive.prefabInstanceScale = roundVectorLike(nextScale, { x: 1, y: 1, z: 1 });
    });

    this.editableLayout.primitives = this.editableLayout.primitives.map((entry) => (
      entry.prefabInstanceId === instanceId
        ? primitives.find((primitive) => primitive.id === entry.id) ?? entry
        : entry
    ));

    const instanceEntry = this.prefabInstanceGroups.get(instanceId);
    if (instanceEntry) {
      const newOrigin = primitives[0].prefabInstanceOrigin ?? primitives[0].position;
      const newRotation = primitives[0].prefabInstanceRotation ?? { x: 0, y: 0, z: 0 };
      const newScale = primitives[0].prefabInstanceScale ?? { x: 1, y: 1, z: 1 };
      instanceEntry.group.position.set(newOrigin.x, newOrigin.y, newOrigin.z);
      instanceEntry.group.rotation.set(newRotation.x, newRotation.y, newRotation.z);
      instanceEntry.group.scale.set(newScale.x, newScale.y, newScale.z);
      instanceEntry.origin = cloneVectorLike(newOrigin, { x: 0, y: 0, z: 0 });
      instanceEntry.rotation = cloneVectorLike(newRotation, { x: 0, y: 0, z: 0 });
      instanceEntry.scale = cloneVectorLike(newScale, { x: 1, y: 1, z: 1 });

      primitives.forEach((primitive) => {
        const mesh = this.editableMeshes.get(primitive.id);
        if (mesh) {
          mesh.position.set(primitive.position.x, primitive.position.y, primitive.position.z);
        }
      });

      instanceEntry.group.updateMatrixWorld(true);
    }

    this.refreshColliders();
    return primitives[0];
  }

  refreshColliders() {
    this.group.updateMatrixWorld(true);
    const active = [];
    this.colliders.forEach((collider) => {
      const mesh = collider.mesh;
      const mergedHidden = mesh?.userData?.mergedIntoStatic === true;
      const alwaysActive = mesh?.userData?.colliderAlwaysActive === true;
      const visible = mesh && (mergedHidden || isObjectVisibleInHierarchy(mesh));
      if ((!visible && !alwaysActive) || mesh?.userData?.colliderEnabled === false) {
        return;
      }
      if (collider.metadata?.localBox) {
        collider.aabb = worldAabbFromLocalBox(collider.metadata.localBox, collider.mesh.matrixWorld);
      } else {
        collider.aabb = AABB.fromMesh(collider.mesh);
      }
      const clearance = collider.metadata?.colliderClearance ?? collider.mesh?.userData?.colliderClearance ?? 0;
      if (clearance > 0) {
        collider.aabb.min.y += clearance;
      }
      active.push(collider);
    });
    return active;
  }

  _registerCollider(mesh, {
    type = 'furniture',
    metadata = {},
    useBvh = false,
    bvhOptions = null,
  } = {}) {
    if (!mesh) return;
    if (useBvh) {
      const localBoxes = collectBvhProxyColliderBoxes(mesh, {
        maxDepth: bvhOptions?.maxDepth ?? 3,
        maxLeafSize: bvhOptions?.maxLeafSize ?? 16,
        maxBoxes: bvhOptions?.maxBoxes ?? 48,
        minSize: bvhOptions?.minSize ?? 0.04,
        exclude: bvhOptions?.exclude ?? null,
      });
      if (localBoxes.length) {
        localBoxes.forEach((localBox, index) => {
          this.colliders.push({
            mesh,
            aabb: worldAabbFromLocalBox(localBox, mesh.matrixWorld),
            type,
            metadata: {
              ...metadata,
              localBox,
              bvhProxy: true,
              bvhProxyIndex: index,
            },
          });
        });
        return;
      }
    }

    this.colliders.push({
      mesh,
      aabb: AABB.fromMesh(mesh),
      type,
      metadata,
    });
  }

  _registerPrimitiveCollider(mesh, primitive, {
    type = primitive?.type === 'plane' ? 'surface' : 'furniture',
    metadata = {},
  } = {}) {
    if (!mesh || !primitive?.collider) return;

    if (primitive.type === 'wedge') {
      const localBoxes = createWedgeLocalColliderBoxes().map((box) => new THREE.Box3(
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
      ));
      localBoxes.forEach((localBox, index) => {
        this.colliders.push({
          mesh,
          aabb: worldAabbFromLocalBox(localBox, mesh.matrixWorld),
          type,
          metadata: {
            ...metadata,
            localBox,
            wedgeProxy: true,
            wedgeProxyIndex: index,
          },
        });
      });
      return;
    }

    this._registerCollider(mesh, { type, metadata });
  }

  getBuildGridConfig() {
    const columns = Math.max(1, this.buildGrid.columns);
    const rows = Math.max(1, this.buildGrid.rows);
    return {
      columns,
      rows,
      cellWidth: this.width / columns,
      cellDepth: this.depth / rows,
      verticalStep: this.buildGrid.verticalStep,
      roomWidth: this.width,
      roomDepth: this.depth,
    };
  }

  setBuildGridSnapSize(size) {
    if (!Number.isFinite(size) || size <= 0) return this.getBuildGridConfig();

    this.buildGrid.columns = Math.max(1, Math.round(this.width / size));
    this.buildGrid.rows = Math.max(1, Math.round(this.depth / size));
    this.buildGrid.verticalStep = Math.min(BUILD_GRID_VERTICAL_STEP, size);
    return this.getBuildGridConfig();
  }

  getBuildGridAnchorPosition(col, row, spanX = 1, spanZ = 1) {
    const grid = this.getBuildGridConfig();
    const safeSpanX = Math.max(1, Math.round(spanX));
    const safeSpanZ = Math.max(1, Math.round(spanZ));
    const clampedCol = THREE.MathUtils.clamp(col, 0, grid.columns - safeSpanX);
    const clampedRow = THREE.MathUtils.clamp(row, 0, grid.rows - safeSpanZ);
    return new THREE.Vector3(
      -grid.roomWidth * 0.5 + (clampedCol + safeSpanX * 0.5) * grid.cellWidth,
      0,
      -grid.roomDepth * 0.5 + (clampedRow + safeSpanZ * 0.5) * grid.cellDepth,
    );
  }

  _getPrimitiveFootprint(primitive) {
    if (primitive.type === 'plane') {
      return {
        width: Math.max(0.0001, primitive.scale.x),
        depth: Math.max(0.0001, primitive.scale.y),
      };
    }
    if (primitive.type === 'prop') {
      return {
        width: Math.max(0.0001, primitive.scale.x),
        depth: Math.max(0.0001, primitive.scale.x),
      };
    }

    return {
      width: Math.max(0.0001, primitive.scale.x),
      depth: Math.max(0.0001, primitive.scale.z),
    };
  }

  _snapGridScale(value, cellSize) {
    if (!Number.isFinite(value)) return cellSize;
    return Math.max(cellSize, Math.round(value / cellSize) * cellSize);
  }

  _snapGridAxisPosition(value, footprint, totalSize, cellSize, allowOverflow = false) {
    const halfRoom = totalSize * 0.5;
    const min = allowOverflow ? -halfRoom : -halfRoom + (Math.min(Math.max(footprint, cellSize), totalSize) * 0.5);
    const max = allowOverflow ? halfRoom : halfRoom - (Math.min(Math.max(footprint, cellSize), totalSize) * 0.5);

    if (max <= min) {
      return 0;
    }

    const snapped = min + Math.round((value - min) / cellSize) * cellSize;
    return THREE.MathUtils.clamp(snapped, min, max);
  }

  snapPrimitiveToGrid(definition, {
    snapY = false,
    snapScale = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const primitive = this._normalizePrimitive(definition);
    const grid = this.getBuildGridConfig();

    if (snapScale) {
      if (primitive.type === 'plane' || primitive.type === 'prop') {
        primitive.scale.x = this._snapGridScale(primitive.scale.x, grid.cellWidth);
        primitive.scale.y = this._snapGridScale(primitive.scale.y, grid.cellDepth);
      } else {
        primitive.scale.x = this._snapGridScale(primitive.scale.x, grid.cellWidth);
        primitive.scale.z = this._snapGridScale(primitive.scale.z, grid.cellDepth);
      }
    }

    if (snapPosition) {
      const footprint = this._getPrimitiveFootprint(primitive);
      primitive.position.x = this._snapGridAxisPosition(
        primitive.position.x,
        footprint.width,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      primitive.position.z = this._snapGridAxisPosition(
        primitive.position.z,
        footprint.depth,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      primitive.position.y = snapToStep(primitive.position.y, grid.verticalStep);
    }

    primitive.position.x = Number(primitive.position.x.toFixed(4));
    primitive.position.y = Number(primitive.position.y.toFixed(4));
    primitive.position.z = Number(primitive.position.z.toFixed(4));
    primitive.scale.x = Number(primitive.scale.x.toFixed(4));
    primitive.scale.y = Number(primitive.scale.y.toFixed(4));
    primitive.scale.z = Number(primitive.scale.z.toFixed(4));
    return primitive;
  }

  snapLightToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const light = this._normalizeLight(definition);
    const grid = this.getBuildGridConfig();

    if (snapPosition) {
      light.position.x = this._snapGridAxisPosition(
        light.position.x,
        grid.cellWidth,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      light.position.z = this._snapGridAxisPosition(
        light.position.z,
        grid.cellDepth,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      light.position.y = snapToStep(light.position.y, grid.verticalStep);
    }

    light.position = roundVectorLike(light.position, { x: 0, y: 0, z: 0 });
    light.rotation = roundVectorLike(light.rotation, { x: 0, y: 0, z: 0 });
    return light;
  }

  snapPortalToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const portal = this._normalizePortal(definition);
    const grid = this.getBuildGridConfig();

    if (snapPosition) {
      portal.position.x = this._snapGridAxisPosition(
        portal.position.x,
        portal.triggerRadius * 2,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      portal.position.z = this._snapGridAxisPosition(
        portal.position.z,
        portal.triggerRadius * 2,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      portal.position.y = snapToStep(portal.position.y, grid.verticalStep);
    }

    portal.position = roundVectorLike(portal.position, { x: 0, y: 0, z: 0 });
    portal.rotation = roundVectorLike(portal.rotation, { x: 0, y: 0, z: 0 });
    portal.triggerRadius = Number(portal.triggerRadius.toFixed(4));
    return portal;
  }

  snapExtractionPortalToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const ep = this._normalizeExtractionPortal(definition);
    const grid = this.getBuildGridConfig();
    const footprint = (ep.radius ?? EXTRACTION_HELPER_BASE_RADIUS) * 2;

    if (snapPosition) {
      ep.position.x = this._snapGridAxisPosition(
        ep.position.x,
        footprint,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      ep.position.z = this._snapGridAxisPosition(
        ep.position.z,
        footprint,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      ep.position.y = snapToStep(ep.position.y, grid.verticalStep);
    }

    ep.position = roundVectorLike(ep.position, { x: 0, y: 0, z: 0 });
    ep.rotation = roundVectorLike(ep.rotation, { x: 0, y: 0, z: 0 });
    ep.radius = Number((ep.radius ?? EXTRACTION_HELPER_BASE_RADIUS).toFixed(4));
    return ep;
  }

  snapRaidTaskToGrid(definition, {
    snapY = false,
    snapPosition = true,
    allowEdgeOverflow = false,
  } = {}) {
    const task = this._normalizeRaidTask(definition);
    const grid = this.getBuildGridConfig();
    const footprint = 0.6;

    if (snapPosition) {
      task.position.x = this._snapGridAxisPosition(
        task.position.x,
        footprint,
        grid.roomWidth,
        grid.cellWidth,
        allowEdgeOverflow,
      );
      task.position.z = this._snapGridAxisPosition(
        task.position.z,
        footprint,
        grid.roomDepth,
        grid.cellDepth,
        allowEdgeOverflow,
      );
    }

    if (snapY) {
      task.position.y = snapToStep(task.position.y, grid.verticalStep);
    }

    task.position = roundVectorLike(task.position, { x: 0, y: 0, z: 0 });
    task.rotation = roundVectorLike(task.rotation, { x: 0, y: 0, z: 0 });
    return task;
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
    if (!prefab?.id || !Array.isArray(prefab.primitives)) {
      return [];
    }

    const size = {
      x: Math.max(1, Math.round(prefab.size?.x ?? 1)),
      y: Math.max(1, Math.round(prefab.size?.y ?? 1)),
      z: Math.max(1, Math.round(prefab.size?.z ?? 1)),
    };
    const anchor = this.getBuildGridAnchorPosition(col, row, size.x, size.z);
    const created = [];

    prefab.primitives.forEach((part, index) => {
      const primitive = this._normalizePrimitive({
        ...part,
        id: `${instanceId}-part-${index + 1}`,
        name: `${prefab.name}-${part.name ?? `part-${index + 1}`}`,
        position: {
          x: (part.position?.x ?? 0) * placeScale,
          y: (part.position?.y ?? 0) * placeScale,
          z: (part.position?.z ?? 0) * placeScale,
        },
        scale: {
          x: (part.scale?.x ?? 1) * placeScale,
          y: (part.scale?.y ?? 1) * placeScale,
          z: (part.scale?.z ?? 1) * placeScale,
        },
        prefabInstanceOrigin: {
          x: anchor.x,
          y: anchor.y,
          z: anchor.z,
        },
        prefabInstanceRotation: {
          x: 0,
          y: 0,
          z: 0,
        },
        prefabInstanceScale: {
          x: 1,
          y: 1,
          z: 1,
        },
        prefabId: prefab.id,
        prefabInstanceId: instanceId,
      });
      this.upsertEditablePrimitive(primitive);
      created.push(primitive.id);
    });

    return created;
  }

  buildRoom() {
    this.buildFloorAndWalls();
  }

  buildFloorAndWalls() {
    const floorMat = this._createSurfaceMaterial(this.floorColor, {
      textureCell: ROOM_TEXTURE_CELLS.floor,
      roughness: 0.98,
      metalness: 0.02,
      planeZIndex: 0,
    });

    // Floor
    const floorGeo = new THREE.PlaneGeometry(this.width, this.depth);
    const floorRepeat = { x: 6, y: 6, rotation: 0 };
    // Snapshot the pristine 0-1 UVs before baking so _rebakeMeshUvs can replay any
    // future repeat/rotation change against the original.
    const floorBaseUvs = new Float32Array(floorGeo.getAttribute('uv').array);
    this._bakeUvTransform(floorGeo, floorRepeat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = 0;
    floor.name = 'Floor';
    floor.renderOrder = 0;
    floor.receiveShadow = true;
    floor.userData.surfaceType = 'floor';
    floor.userData.cameraOccluder = false;
    floor.userData.textureRepeat = floorRepeat;
    floor.userData._baseUvs = floorBaseUvs;
    this.group.add(floor);
    const floorCollider = {
      mesh: floor,
      aabb: AABB.fromMesh(floor),
      type: 'surface',
      metadata: { runnable: true, plane: true, zIndex: 0 },
    };
    this.colliders.push(floorCollider);
    this.runnables.push(floor);
    this._registerBuiltInPrimitive(floor, {
      id: 'builtin-floor',
      name: floor.name,
      type: 'plane',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: floor.rotation.x, y: floor.rotation.y, z: floor.rotation.z },
      scale: { x: this.width, y: this.depth, z: 1 },
      texture: {
        cell: floorMat.userData.textureCell,
        repeat: {
          x: floorRepeat.x,
          y: floorRepeat.y,
        },
        rotation: floorRepeat.rotation,
        offset: { x: 0, y: 0 },
      },
      material: materialToEditableSurface(floorMat, this.floorColor),
      collider: true,
      castShadow: false,
      receiveShadow: true,
    }, floorCollider);
  }

  /**
   * Check collision between a player AABB and room colliders
   */
  checkCollision(playerAABB) {
    this.refreshColliders();
    return this.colliders.filter((col) => playerAABB.intersects(col.aabb));
  }

  getCollisionColliders() {
    return sortCollidersForPlaneZIndex(this.refreshColliders());
  }

  /**
   * Get all climbable surfaces
   */
  getClimbables() {
    return this.climbables.filter((mesh) => (mesh.visible !== false || mesh.userData?.mergedIntoStatic === true) && mesh.userData?.colliderEnabled !== false);
  }

  /**
   * Get all runnable surfaces
   */
  getRunnables() {
    return this.runnables.filter((mesh) => (mesh.visible !== false || mesh.userData?.mergedIntoStatic === true) && mesh.userData?.colliderEnabled !== false);
  }

  /**
   * Animate loot items (bobbing, rotation)
   */
  updateLoot(timeMs) {
    const t = timeMs * 0.001;

    this.lootItems.forEach((item) => {
      const baseY = item.userData.baseY ?? item.position.y;

      // Gentle bobbing (absolute position, no drift)
      item.position.y = baseY + Math.sin(t * 2) * 0.1;

      // Slow rotation
      item.rotation.x += 0.005;
      item.rotation.y += 0.008;

      // Sparkle animation
      if (item.userData.sparkle) {
        const scale = 1 + Math.sin(t * 3) * 0.15;
        item.userData.sparkle.scale.set(scale, scale, scale);
        item.userData.sparkle.position.y = item.position.y;
      }
    });

    this.editableFanObjects.forEach((entry) => {
      if (!entry?.group || entry.group.visible === false) return;
      const runtime = this.fanRuntimeStates.get(entry.definition?.id) ?? null;
      if (entry.spinRoot) {
        entry.spinRoot.rotation.y = Number.isFinite(runtime?.angle)
          ? runtime.angle
          : t * (entry.definition?.spinSpeed ?? 0);
      }
      if (entry.cheeseGroup) {
        entry.cheeseGroup.visible = runtime?.cheeseAvailable ?? ((entry.definition?.cheeseAmount ?? 0) > 0);
      }
      if (entry.cheeseGroup?.visible) {
        const pulse = 1 + Math.sin((t * 4.6) + (entry.group.position.x * 0.17)) * 0.08;
        entry.cheeseGroup.scale.setScalar(pulse);
      }
    });
  }

  applyFanRuntimeStates(states = null) {
    this.fanRuntimeStates.clear();
    if (!Array.isArray(states)) return;
    for (const state of states) {
      if (!state?.id) continue;
      this.fanRuntimeStates.set(state.id, {
        angle: Number.isFinite(state.angle) ? state.angle : 0,
        cheeseAvailable: state.cheeseAvailable !== false,
      });
    }
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
