import * as THREE from 'three';

export function createExtractionPortalMarkers(scene) {
  const group = new THREE.Group();
  group.name = 'ExtractionPortals';
  scene.add(group);

  const ringGeometry = new THREE.RingGeometry(0.55, 0.88, 28);
  const outerRingGeometry = new THREE.RingGeometry(0.95, 1.08, 36);
  const beamGeometry = new THREE.CylinderGeometry(0.18, 0.74, 3.4, 28, 1, true);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#facc15',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  const outerRingMaterial = new THREE.MeshBasicMaterial({
    color: '#ff7a3d',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: '#fff176',
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  function addMarker() {
    const portal = new THREE.Group();
    portal.name = 'ExtractionPortalMarker';
    const ring = new THREE.Mesh(ringGeometry, ringMaterial.clone());
    const outerRing = new THREE.Mesh(outerRingGeometry, outerRingMaterial.clone());
    const beam = new THREE.Mesh(beamGeometry, beamMaterial.clone());
    ring.rotation.x = -Math.PI / 2;
    outerRing.rotation.x = -Math.PI / 2;
    beam.position.y = 1.7;
    beam.renderOrder = 9;
    ring.renderOrder = 10;
    outerRing.renderOrder = 9;
    portal.add(beam, outerRing, ring);
    portal.userData.parts = { ring, outerRing, beam };
    group.add(portal);
  }

  function update({ portals, visible, nowSeconds }) {
    if (!Array.isArray(portals) || portals.length <= 0) {
      group.visible = false;
      return false;
    }
    while (group.children.length < portals.length) {
      addMarker();
    }
    group.visible = !!visible;
    portals.forEach((placement, index) => {
      const marker = group.children[index];
      if (!marker) return;
      marker.visible = true;
      marker.position.set(placement.x ?? 0, (placement.y ?? 0) + 0.03, placement.z ?? 0);
      const pulse = 0.5 + 0.5 * Math.sin(nowSeconds * 7.5 + index);
      marker.scale.setScalar(1 + pulse * 0.16);
      const parts = marker.userData.parts ?? {};
      if (parts.ring) {
        parts.ring.rotation.z = nowSeconds * 1.8;
        parts.ring.material.opacity = 0.72 + pulse * 0.24;
      }
      if (parts.outerRing) {
        parts.outerRing.rotation.z = -nowSeconds * 1.15;
        parts.outerRing.material.opacity = 0.22 + pulse * 0.28;
      }
      if (parts.beam) {
        parts.beam.material.opacity = 0.12 + pulse * 0.18;
      }
    });
    for (let i = portals.length; i < group.children.length; i += 1) {
      group.children[i].visible = false;
    }
    return true;
  }

  function dispose() {
    group.traverse((child) => {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
    scene.remove(group);
    ringGeometry.dispose();
    outerRingGeometry.dispose();
    beamGeometry.dispose();
    ringMaterial.dispose();
    outerRingMaterial.dispose();
    beamMaterial.dispose();
  }

  return { group, update, dispose };
}
