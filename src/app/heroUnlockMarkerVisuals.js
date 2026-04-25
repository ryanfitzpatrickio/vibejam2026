import * as THREE from 'three';

function clearGroupChildren(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.traverse?.((node) => {
      node.geometry?.dispose?.();
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material.dispose?.());
      }
    });
  }
}

function buildDefaultMarkerVisuals(group, id) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1.1, 12),
    new THREE.MeshBasicMaterial({
      color: '#e8b84a',
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  pole.position.y = 0.55;
  pole.userData.raidTaskId = id;
  pole.userData.skipOutline = true;
  group.add(pole);

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
  top.userData.raidTaskId = id;
  top.userData.skipOutline = true;
  group.add(top);
}

function buildPileVisuals(group, heroKey) {
  const color = heroKey === 'gus' ? 0xd486a8 : 0x6fb4ff;
  for (let i = 0; i < 5; i += 1) {
    const size = 0.13 + Math.random() * 0.08;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
    );
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 0.25;
    mesh.position.set(Math.cos(angle) * radius, size, Math.sin(angle) * radius);
    group.add(mesh);
  }
}

function forEachUnlockMarker(room, fn) {
  const entries = room?.editableRaidTaskObjects;
  if (!entries) return;
  for (const entry of entries.values()) {
    const taskType = entry?.definition?.taskType;
    if (taskType === 'unlock_gus' || taskType === 'unlock_speedy') fn(entry);
  }
}

export function handleHeroUnlockMarkerMessage(room, data) {
  if (data?.type === 'hero-claimed') {
    const expectedType = data.heroKey === 'gus' ? 'unlock_gus' : 'unlock_speedy';
    forEachUnlockMarker(room, (entry) => {
      if (entry.definition.taskType !== expectedType) return;
      clearGroupChildren(entry.group);
      buildPileVisuals(entry.group, data.heroKey);
    });
    return true;
  }

  if (data?.type === 'unlock-reset') {
    forEachUnlockMarker(room, (entry) => {
      clearGroupChildren(entry.group);
      buildDefaultMarkerVisuals(entry.group, entry.definition.id);
    });
    return true;
  }

  return false;
}
