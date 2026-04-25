import * as THREE from 'three';

export function applyAtmosphere(scene) {
  scene.background = new THREE.Color('#8e7a63');
  scene.fog = new THREE.Fog('#8d7964', 16, 68);
}

export function createWebGLRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function buildNavMeshOverlay(navMesh) {
  const group = new THREE.Group();
  group.name = 'navmesh-overlay';

  const fillPositions = [];
  const linePositions = [];

  for (const tile of Object.values(navMesh?.tiles ?? {})) {
    const vertices = tile?.vertices;
    const polys = tile?.polys;
    if (!Array.isArray(vertices) || !Array.isArray(polys)) continue;

    for (const poly of polys) {
      const indices = Array.isArray(poly?.vertices)
        ? poly.vertices.filter((index) => Number.isInteger(index) && index >= 0)
        : [];
      if (indices.length < 3) continue;

      const points = indices.map((index) => {
        const base = index * 3;
        return {
          x: vertices[base],
          y: (vertices[base + 1] ?? 0) + 0.03,
          z: vertices[base + 2],
        };
      });

      for (let i = 1; i < points.length - 1; i += 1) {
        const a = points[0];
        const b = points[i];
        const c = points[i + 1];
        fillPositions.push(
          a.x, a.y, a.z,
          b.x, b.y, b.z,
          c.x, c.y, c.z,
        );
      }

      for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        linePositions.push(
          current.x, current.y + 0.005, current.z,
          next.x, next.y + 0.005, next.z,
        );
      }
    }
  }

  if (fillPositions.length) {
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3));
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: '#6de2b5',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.renderOrder = 50;
    group.add(fillMesh);
  }

  if (linePositions.length) {
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const lineMaterial = new THREE.LineBasicMaterial({
      color: '#b7fff0',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
    lineSegments.renderOrder = 51;
    group.add(lineSegments);
  }

  group.visible = false;
  return group;
}
