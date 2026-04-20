import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 4) {
  return Number(Number(value || 0).toFixed(decimals));
}

function clampInt(value, min, max, fallback) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

function normalizeHexColor(value, fallback = '#70523a') {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function createSeededRandom(seed) {
  let state = (Math.trunc(Number(seed)) || 1) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleTrunkCenter(builder, y) {
  const safeHeight = Math.max(builder.trunk.height, 0.0001);
  const yNorm = clamp(y / safeHeight, 0, 1);
  const bend = yNorm * yNorm;
  return new THREE.Vector3(
    builder.trunk.leanX * bend,
    y,
    builder.trunk.leanZ * bend,
  );
}

function makeBranchBasis(direction) {
  const tangent = direction.clone().normalize();
  const fallbackUp = Math.abs(tangent.y) > 0.94
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(fallbackUp, tangent).normalize();
  const lift = new THREE.Vector3().crossVectors(tangent, side).normalize();
  return { tangent, side, lift };
}

function sampleBranchPoint(branch, along) {
  return branch.origin.clone().lerp(branch.tip, clamp(along, 0, 1));
}

export function normalizeTreeBuilder(entry = {}) {
  const trunkHeight = clamp(Number(entry.trunk?.height ?? 2.2), 0.4, 12);
  const trunkRadiusBase = clamp(Number(entry.trunk?.radiusBase ?? 0.24), 0.03, 4);
  const trunkRadiusTop = clamp(Number(entry.trunk?.radiusTop ?? (trunkRadiusBase * 0.58)), 0.01, trunkRadiusBase);
  const branchStart = clamp(Number(entry.branches?.startY ?? (trunkHeight * 0.66)), 0.05, Math.max(0.05, trunkHeight - 0.05));
  const branchZoneHeight = clamp(Number(entry.branches?.zoneHeight ?? Math.max(0.18, trunkHeight * 0.22)), 0.05, Math.max(0.05, trunkHeight - branchStart));
  const branchLengthMin = clamp(Number(entry.branches?.lengthMin ?? 0.55), 0.05, 12);
  const branchLengthMax = Math.max(branchLengthMin, clamp(Number(entry.branches?.lengthMax ?? 1.1), branchLengthMin, 16));
  const childrenMin = clampInt(entry.branches?.childrenMin, 1, 4, 1);
  const childrenMax = Math.max(childrenMin, clampInt(entry.branches?.childrenMax, 1, 5, 2));
  const leafWidthMin = clamp(Number(entry.leaves?.widthMin ?? 0.35), 0.02, 4);
  const leafWidthMax = Math.max(leafWidthMin, clamp(Number(entry.leaves?.widthMax ?? 0.65), leafWidthMin, 4));
  const leafHeightMin = clamp(Number(entry.leaves?.heightMin ?? 0.45), 0.02, 6);
  const leafHeightMax = Math.max(leafHeightMin, clamp(Number(entry.leaves?.heightMax ?? 0.85), leafHeightMin, 6));

  return {
    trunkAssetName: typeof entry.trunkAssetName === 'string' && entry.trunkAssetName.trim()
      ? entry.trunkAssetName.trim()
      : 'tree-trunk',
    trunk: {
      height: round(trunkHeight),
      radiusBase: round(trunkRadiusBase),
      radiusTop: round(trunkRadiusTop),
      radialSegments: clampInt(entry.trunk?.radialSegments, 3, 16, 6),
      heightSegments: clampInt(entry.trunk?.heightSegments, 1, 12, 4),
      leanX: round(clamp(Number(entry.trunk?.leanX ?? 0), -1.5, 1.5)),
      leanZ: round(clamp(Number(entry.trunk?.leanZ ?? 0), -1.5, 1.5)),
      color: normalizeHexColor(entry.trunk?.color, '#70523a'),
      roughness: round(clamp(Number(entry.trunk?.roughness ?? 0.94), 0, 1)),
      metalness: round(clamp(Number(entry.trunk?.metalness ?? 0.02), 0, 1)),
    },
    branches: {
      startY: round(branchStart),
      zoneHeight: round(branchZoneHeight),
      count: clampInt(entry.branches?.count, 1, 24, 7),
      levels: clampInt(entry.branches?.levels, 1, 5, 3),
      childrenMin,
      childrenMax,
      lengthMin: round(branchLengthMin),
      lengthMax: round(branchLengthMax),
      pitch: round(clamp(Number(entry.branches?.pitch ?? 0.48), -0.6, 1.2)),
      droop: round(clamp(Number(entry.branches?.droop ?? 0.16), -0.4, 0.9)),
      radiusScale: round(clamp(Number(entry.branches?.radiusScale ?? 0.28), 0.05, 0.95)),
      tipScale: round(clamp(Number(entry.branches?.tipScale ?? 0.34), 0.05, 1)),
      childLengthScale: round(clamp(Number(entry.branches?.childLengthScale ?? 0.62), 0.2, 0.95)),
      childRadiusScale: round(clamp(Number(entry.branches?.childRadiusScale ?? 0.72), 0.2, 0.98)),
      forkStart: round(clamp(Number(entry.branches?.forkStart ?? 0.42), 0.05, 0.95)),
      spread: round(clamp(Number(entry.branches?.spread ?? 0.72), 0.05, 1.8)),
      twist: round(clamp(Number(entry.branches?.twist ?? 0.38), 0, Math.PI), 3),
    },
    canopy: {
      radius: round(clamp(Number(entry.canopy?.radius ?? 1.2), 0.1, 12)),
      height: round(clamp(Number(entry.canopy?.height ?? 1.6), 0.1, 12)),
      offsetY: round(clamp(Number(entry.canopy?.offsetY ?? (trunkHeight * 0.92)), 0, 24)),
    },
    leaves: {
      count: clampInt(entry.leaves?.count, 1, 128, 28),
      widthMin: round(leafWidthMin),
      widthMax: round(leafWidthMax),
      heightMin: round(leafHeightMin),
      heightMax: round(leafHeightMax),
      pitchJitter: round(clamp(Number(entry.leaves?.pitchJitter ?? 0.35), 0, Math.PI * 0.5)),
      tiltJitter: round(clamp(Number(entry.leaves?.tiltJitter ?? 0.18), 0, Math.PI * 0.5)),
      brightnessMin: round(clamp(Number(entry.leaves?.brightnessMin ?? 0.88), 0.2, 2)),
      brightnessMax: round(clamp(Number(entry.leaves?.brightnessMax ?? 1.08), 0.2, 2)),
    },
  };
}

export function buildTreeTrunkMesh(treeBuilder, { material = null } = {}) {
  const builder = normalizeTreeBuilder(treeBuilder);
  const { trunk } = builder;
  const sharedMaterial = material ?? new THREE.MeshStandardMaterial({
    color: trunk.color,
    roughness: trunk.roughness,
    metalness: trunk.metalness,
  });
  const root = new THREE.Group();
  root.name = 'ProceduralTreeTrunk';

  const geometry = new THREE.CylinderGeometry(
    trunk.radiusTop,
    trunk.radiusBase,
    trunk.height,
    trunk.radialSegments,
    trunk.heightSegments,
    false,
  );
  geometry.translate(0, trunk.height * 0.5, 0);

  const positions = geometry.getAttribute('position');
  const temp = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    temp.fromBufferAttribute(positions, index);
    const yNorm = trunk.height > 0.0001 ? clamp(temp.y / trunk.height, 0, 1) : 0;
    const bend = yNorm * yNorm;
    temp.x += trunk.leanX * bend;
    temp.z += trunk.leanZ * bend;
    positions.setXYZ(index, temp.x, temp.y, temp.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const trunkMesh = new THREE.Mesh(geometry, sharedMaterial);
  trunkMesh.name = 'ProceduralTreeTrunkStem';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  root.add(trunkMesh);

  createTreeBranchLayout({ treeBuilder: builder, seed: 1 }).forEach((branch, index) => {
    const branchGeometry = new THREE.CylinderGeometry(
      branch.radiusTip,
      branch.radiusBase,
      branch.length,
      Math.max(3, trunk.radialSegments - 1),
      1,
      false,
    );
    branchGeometry.translate(0, branch.length * 0.5, 0);
    const branchMesh = new THREE.Mesh(branchGeometry, sharedMaterial);
    branchMesh.name = `ProceduralTreeBranch${index + 1}`;
    branchMesh.position.copy(branch.origin);
    branchMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      branch.direction.clone().normalize(),
    );
    branchMesh.castShadow = true;
    branchMesh.receiveShadow = true;
    root.add(branchMesh);
  });

  return root;
}

export function createTreeBranchLayout({
  treeBuilder,
  seed = 1,
}) {
  const builder = normalizeTreeBuilder(treeBuilder);
  const { trunk, branches, canopy } = builder;
  const rand = createSeededRandom(seed);
  const branchList = [];
  const safeCount = Math.max(1, branches.count);
  const maxBranches = 160;

  for (let index = 0; index < safeCount; index += 1) {
    const spreadT = safeCount === 1 ? 0.5 : index / (safeCount - 1);
    const yJitter = (rand() - 0.5) * Math.min(branches.zoneHeight * 0.22, 0.24);
    const baseY = clamp(
      branches.startY + (spreadT * branches.zoneHeight) + yJitter,
      0.05,
      trunk.height,
    );
    const origin = sampleTrunkCenter(builder, baseY);
    const azimuth = ((index / safeCount) * Math.PI * 2) + ((rand() - 0.5) * branches.twist);
    const pitch = branches.pitch + ((rand() - 0.5) * 0.24);
    const branchLength = branches.lengthMin + (rand() * Math.max(0.001, branches.lengthMax - branches.lengthMin));
    const horizontalLength = Math.max(0.02, Math.cos(pitch) * branchLength);
    const verticalRise = Math.sin(pitch) * branchLength;
    const tip = origin.clone().add(new THREE.Vector3(
      Math.cos(azimuth) * horizontalLength,
      verticalRise - (branches.droop * branchLength * (0.15 + (rand() * 0.2))),
      Math.sin(azimuth) * horizontalLength,
    ));
    const direction = tip.clone().sub(origin);
    const length = Math.max(direction.length(), 0.05);
    const thicknessT = 1 - (spreadT * 0.45);
    const radiusBase = Math.max(
      0.01,
      ((trunk.radiusTop * 0.85) + (trunk.radiusBase * 0.15 * thicknessT)) * branches.radiusScale * (0.9 + (rand() * 0.2)),
    );
    const radiusTip = Math.max(0.006, radiusBase * branches.tipScale);
    branchList.push({
      id: `branch-0-${index}`,
      depth: 0,
      parentId: null,
      origin,
      tip,
      direction,
      length,
      radiusBase,
      radiusTip,
      canopyRadius: canopy.radius,
      canopyHeight: canopy.height,
      lift: canopy.offsetY,
    });
  }

  for (let depth = 1; depth < branches.levels; depth += 1) {
    const parents = branchList.filter((branch) => branch.depth === (depth - 1));
    const childReduction = Math.max(0, depth - 1);
    parents.forEach((parent, parentIndex) => {
      if (branchList.length >= maxBranches) return;
      const childMin = Math.max(1, Math.min(branches.childrenMin, branches.childrenMax));
      const childMax = Math.max(childMin, branches.childrenMax - childReduction);
      const childCount = childMin + Math.floor(rand() * ((childMax - childMin) + 1));
      const parentBasis = makeBranchBasis(parent.direction);
      for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
        if (branchList.length >= maxBranches) break;
        const forkAlong = branches.forkStart + (rand() * Math.max(0.02, 0.96 - branches.forkStart));
        const origin = sampleBranchPoint(parent, forkAlong);
        const fanBase = childCount === 1 ? 0 : ((childIndex / (childCount - 1 || 1)) - 0.5);
        const sideAmount = (fanBase * branches.spread) + ((rand() - 0.5) * branches.spread * 0.55);
        const liftAmount = (0.15 + (rand() * 0.55)) - (branches.droop * 0.22) + (depth * 0.04);
        const axialAmount = 1 + (rand() * 0.2);
        const direction = parentBasis.tangent.clone()
          .multiplyScalar(axialAmount)
          .addScaledVector(parentBasis.side, sideAmount)
          .addScaledVector(parentBasis.lift, liftAmount)
          .normalize();
        const length = Math.max(
          0.05,
          parent.length * branches.childLengthScale * (0.82 + (rand() * 0.3)),
        );
        const tip = origin.clone().addScaledVector(direction, length);
        const radiusBase = Math.max(
          0.005,
          parent.radiusTip * branches.childRadiusScale * (0.88 + (rand() * 0.2)),
        );
        const radiusTip = Math.max(0.003, radiusBase * (branches.tipScale * 0.95));
        branchList.push({
          id: `branch-${depth}-${parentIndex}-${childIndex}`,
          depth,
          parentId: parent.id,
          origin,
          tip,
          direction: tip.clone().sub(origin),
          length,
          radiusBase,
          radiusTip,
          canopyRadius: canopy.radius,
          canopyHeight: canopy.height,
          lift: canopy.offsetY,
        });
      }
    });
  }

  return branchList;
}

export function estimateTreeBuilderBounds(treeBuilder) {
  const builder = normalizeTreeBuilder(treeBuilder);
  const branches = createTreeBranchLayout({ treeBuilder: builder, seed: 1 });
  let radius = builder.trunk.radiusBase;
  let height = builder.trunk.height;
  branches.forEach((branch) => {
    radius = Math.max(
      radius,
      Math.hypot(branch.tip.x, branch.tip.z) + (builder.canopy.radius * 0.35),
    );
    height = Math.max(
      height,
      branch.tip.y + (builder.canopy.height * 0.35) + (builder.canopy.offsetY * 0.04),
    );
  });
  return {
    radius,
    height,
  };
}

export function createTreeLeafInstanceData({
  treeBuilder,
  cells = [0],
  seed = 1,
}) {
  const builder = normalizeTreeBuilder(treeBuilder);
  const cellList = Array.isArray(cells) && cells.length ? cells : [0];
  const branches = createTreeBranchLayout({ treeBuilder: builder, seed });
  const matrices = [];
  const params = new Float32Array(builder.leaves.count * 4);
  const rand = createSeededRandom(seed);

  const temp = new THREE.Object3D();
  for (let index = 0; index < builder.leaves.count; index += 1) {
    const weightedIndex = Math.floor(Math.pow(rand(), 0.45) * branches.length);
    const branch = branches[Math.min(branches.length - 1, weightedIndex)] ?? branches[0];
    const branchBasis = makeBranchBasis(branch.direction);
    const tipBias = rand() < (0.4 + (branch.depth * 0.14));
    const along = tipBias
      ? 0.68 + (Math.pow(rand(), 0.45) * 0.32)
      : 0.18 + (rand() * 0.62);
    const point = branch.origin.clone().lerp(branch.tip, along);
    const radialSpread = builder.canopy.radius * (tipBias ? 0.24 + (rand() * 0.2) : 0.08 + (rand() * 0.1));
    const verticalSpread = builder.canopy.height * (tipBias ? 0.16 + (rand() * 0.14) : 0.05 + (rand() * 0.09));
    const axialJitter = branch.length * ((rand() - 0.5) * (tipBias ? 0.16 : 0.1));
    const sideOffset = (rand() - 0.5) * radialSpread;
    const liftOffset = (rand() - 0.5) * verticalSpread;
    const crownLift = builder.canopy.offsetY * 0.04;
    const leafPosition = point
      .clone()
      .addScaledVector(branchBasis.tangent, axialJitter)
      .addScaledVector(branchBasis.side, sideOffset)
      .addScaledVector(branchBasis.lift, liftOffset)
      .addScaledVector(new THREE.Vector3(0, 1, 0), crownLift);
    const width = builder.leaves.widthMin + rand() * Math.max(0.001, builder.leaves.widthMax - builder.leaves.widthMin);
    const height = builder.leaves.heightMin + rand() * Math.max(0.001, builder.leaves.heightMax - builder.leaves.heightMin);
    const yaw = Math.atan2(branchBasis.tangent.x, branchBasis.tangent.z) + ((rand() - 0.5) * 0.85);

    temp.position.copy(leafPosition);
    temp.rotation.set(
      (rand() - 0.5) * builder.leaves.pitchJitter + (branchBasis.tangent.y * 0.35),
      yaw,
      (rand() - 0.5) * builder.leaves.tiltJitter,
    );
    temp.scale.set(width, height, width);
    temp.updateMatrix();
    matrices.push(temp.matrix.clone());

    params[(index * 4) + 0] = rand() * Math.PI * 2;
    params[(index * 4) + 1] = 0.55 + rand() * 0.55;
    params[(index * 4) + 2] = cellList[index % cellList.length] ?? 0;
    params[(index * 4) + 3] = builder.leaves.brightnessMin
      + rand() * Math.max(0.001, builder.leaves.brightnessMax - builder.leaves.brightnessMin);
  }

  return { matrices, params };
}
