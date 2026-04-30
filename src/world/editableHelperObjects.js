import * as THREE from 'three';
import { createPrimitiveGeometry } from './primitiveGeometry.js';
import { VIBE_PORTAL_TYPES } from '../../shared/vibePortal.js';
import { RAID_TASK_TYPES } from '../../shared/raidLayout.js';
import {
  DEFAULT_ROPE_CARD_OPACITY,
  DEFAULT_ROPE_CARD_WIDTH,
  ROPE_SEGMENT_RADIUS,
  DEFAULT_ROPE_COLOR,
} from '../../shared/ropes.js';
import { normalizeCeilingFan } from '../../shared/ceilingFans.js';

export const EXTRACTION_HELPER_BASE_RADIUS = 1.15;

export function createLightHelperMesh(definition) {
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

export function createPortalHelperObject(definition) {
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

export function createExtractionPortalHelperObject(definition) {
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

export function createRaidTaskHelperObject(definition, {
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
    if (task.taskType === RAID_TASK_TYPES.TOPPLE_TOWER && task.completionMode === 'physical') {
      if (slot === 'before') addDefaultMarker();
    } else if (task.taskType === RAID_TASK_TYPES.TOPPLE_TOWER) {
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

export function createCeilingFanObject(definition) {
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

export function createRopeHelperObject(definition, textureMap = null) {
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
