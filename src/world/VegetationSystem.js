import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assetUrl } from '../utils/assetUrl.js';
import {
  DEFAULT_VEGETATION_LIBRARY,
  normalizeVegetationLibrary,
  normalizeVegetationPlacement,
} from '../dev/vegetationRegistry.js';
import { isPropTextureAtlas } from '../dev/textureAtlasRegistry.js';
import {
  buildTreeTrunkMesh,
  estimateTreeBuilderBounds,
  createTreeLeafInstanceData,
  normalizeTreeBuilder,
} from './VegetationTreeBuilder.js';

const ATLAS_COLUMNS = 10;
const ATLAS_ROWS = 10;

function hashSeed(value) {
  const input = String(value ?? '');
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return (hash >>> 0) || 1;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function disposeMaterial(material) {
  if (!material) return;
  material.dispose?.();
  material.customDepthMaterial?.dispose?.();
  material.customDistanceMaterial?.dispose?.();
}

function disposeObject3D(root) {
  root?.traverse((child) => {
    if (
      child.geometry
      && !child.geometry.userData?.isVegetationCachedGeometry
      && !child.geometry.userData?.isSharedGlbGeometry
    ) {
      child.geometry.disposeBoundsTree?.();
      child.geometry.dispose?.();
    }
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => disposeMaterial(material));
    } else {
      disposeMaterial(child.material);
    }
  });
}

function applyPropsChromaKey(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width || 1;
  canvas.height = image.height || 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const similarity = 0.32;
  const feather = 0.08;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    const greenDistance = Math.hypot(r, g - 1, b) / Math.sqrt(3);
    const alpha = THREE.MathUtils.smoothstep(greenDistance, similarity, similarity + feather);
    data[index + 3] = Math.round(data[index + 3] * alpha);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function setVegetationUserData(root, vegetationId) {
  root.userData.vegetationId = vegetationId;
  root.traverse((child) => {
    child.userData.vegetationId = vegetationId;
  });
}

function setSkipFullscreenOutline(root, enabled) {
  root.userData.skipFullscreenOutline = enabled;
  root.traverse((child) => {
    child.userData.skipFullscreenOutline = enabled;
  });
}

function setDecorativeVegetationFlags(root, enabled) {
  root.userData.skipFade = enabled;
  root.traverse((child) => {
    child.userData.skipFade = enabled;
  });
}

function setCameraOccluderEnabled(root, enabled) {
  root.userData.cameraOccluder = enabled ? root.userData.cameraOccluder : false;
  root.traverse((child) => {
    child.userData.cameraOccluder = enabled ? child.userData.cameraOccluder : false;
  });
}

function getVegetationCollisionMode(species) {
  if (!species || species.collision === 'none') return 'none';
  if (species.kind === 'tree') return 'trunk-shape';
  if (species.renderMode === 'instancedCards') return 'none';
  return 'bvh-proxy';
}

function buildClumpGeometry(cardCount = 3) {
  const cards = [];
  for (let index = 0; index < cardCount; index += 1) {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 4);
    geometry.translate(0, 0.5, 0);
    geometry.rotateY((index / cardCount) * Math.PI);
    cards.push(geometry);
  }
  const merged = mergeGeometries(cards, false);
  cards.forEach((geometry) => geometry.dispose());
  merged.computeVertexNormals();
  merged.userData.isVegetationCachedGeometry = true;
  return merged;
}

function patchAnimatedFoliageMaterial(material, {
  atlasColumns = ATLAS_COLUMNS,
  atlasRows = ATLAS_ROWS,
  windAmp = 0.08,
  windFreq = 1.4,
} = {}) {
  const sharedUniforms = {
    uVegTime: { value: 0 },
    uVegAtlasGrid: { value: new THREE.Vector2(atlasColumns, atlasRows) },
    uVegWindAmp: { value: windAmp },
    uVegWindFreq: { value: windFreq },
  };

  const applyShaderPatch = (shader) => {
    shader.uniforms.uVegTime = sharedUniforms.uVegTime;
    shader.uniforms.uVegAtlasGrid = sharedUniforms.uVegAtlasGrid;
    shader.uniforms.uVegWindAmp = sharedUniforms.uVegWindAmp;
    shader.uniforms.uVegWindFreq = sharedUniforms.uVegWindFreq;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        attribute vec4 instanceParams;
        varying float vVegAtlasCell;
        varying float vVegBrightness;
        uniform float uVegTime;
        uniform float uVegWindAmp;
        uniform float uVegWindFreq;
      `)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float vegPhase = instanceParams.x;
        float vegBend = instanceParams.y;
        vVegAtlasCell = instanceParams.z;
        vVegBrightness = instanceParams.w;
        float vegTip = pow(max(uv.y, 0.0), 1.6);
        float vegGust = sin(uVegTime * uVegWindFreq + vegPhase + instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.21);
        transformed.x += vegGust * uVegWindAmp * vegTip * vegBend;
        transformed.z += vegGust * uVegWindAmp * 0.55 * vegTip * vegBend;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        varying float vVegAtlasCell;
        varying float vVegBrightness;
        uniform vec2 uVegAtlasGrid;
      `)
      .replace('#include <map_fragment>', `
        vec2 atlasUv = vMapUv;
        float vegCols = uVegAtlasGrid.x;
        float vegRows = uVegAtlasGrid.y;
        float vegCell = vVegAtlasCell;
        float vegX = mod(vegCell, vegCols);
        float vegY = floor(vegCell / vegCols);
        atlasUv = atlasUv / uVegAtlasGrid + vec2(vegX / vegCols, 1.0 - (vegY + 1.0) / vegRows);
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        diffuseColor *= sampledDiffuseColor;
        diffuseColor.rgb *= vVegBrightness;
      `);
  };

  material.onBeforeCompile = applyShaderPatch;
  material.customProgramCacheKey = () => `veg:${atlasColumns}:${atlasRows}:${windAmp}:${windFreq}`;
  material.userData.vegUniforms = sharedUniforms;
  material.needsUpdate = true;
}

function createAnimatedFoliageMaterial(texture, species) {
  const material = new THREE.MeshStandardMaterial({
    map: texture ?? null,
    color: '#ffffff',
    side: THREE.DoubleSide,
    alphaTest: 0.45,
    transparent: false,
    roughness: 0.88,
    metalness: 0.02,
  });
  material.alphaToCoverage = true;
  patchAnimatedFoliageMaterial(material, {
    windAmp: species.wind?.amp ?? 0.08,
    windFreq: species.wind?.freq ?? 1.4,
  });

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: texture ?? null,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
  patchAnimatedFoliageMaterial(depthMaterial, {
    windAmp: species.wind?.amp ?? 0.08,
    windFreq: species.wind?.freq ?? 1.4,
  });
  material.customDepthMaterial = depthMaterial;

  const distanceMaterial = new THREE.MeshDistanceMaterial({
    map: texture ?? null,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
  patchAnimatedFoliageMaterial(distanceMaterial, {
    windAmp: species.wind?.amp ?? 0.08,
    windFreq: species.wind?.freq ?? 1.4,
  });
  material.customDistanceMaterial = distanceMaterial;
  return material;
}

export class VegetationSystem {
  constructor({ room }) {
    this.room = room;
    this.group = new THREE.Group();
    this.group.name = 'Vegetation';
    this.placementObjects = new Map();
    this.geometryCache = new Map();
    this.atlasTextureCache = new Map();
    this.library = normalizeVegetationLibrary(DEFAULT_VEGETATION_LIBRARY);
    this.placements = [];
    this._buildToken = 0;
    this._libraryPromise = null;
  }

  async ensureLibrary() {
    if (this._libraryPromise) return this._libraryPromise;
    this._libraryPromise = fetch(assetUrl('levels/vegetation-library.json'), { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : DEFAULT_VEGETATION_LIBRARY))
      .catch(() => DEFAULT_VEGETATION_LIBRARY)
      .then((library) => {
        this.library = normalizeVegetationLibrary(library);
        return this.library;
      });
    return this._libraryPromise;
  }

  setLibrary(library) {
    this.library = normalizeVegetationLibrary(library ?? DEFAULT_VEGETATION_LIBRARY);
    this._libraryPromise = Promise.resolve(this.library);
    return this.rebuild(this.placements);
  }

  getEditableObject(id) {
    return this.placementObjects.get(id)?.group ?? null;
  }

  _removeVegetationColliders() {
    this.room.colliders = this.room.colliders.filter((entry) => entry.metadata?.source !== 'vegetation');
  }

  clear() {
    this._removeVegetationColliders();
    for (const entry of this.placementObjects.values()) {
      disposeObject3D(entry.group);
    }
    this.group.clear();
    this.placementObjects.clear();
  }

  _getSharedClumpGeometry(cardCount) {
    const key = Math.max(1, Math.trunc(cardCount) || 1);
    if (!this.geometryCache.has(key)) {
      this.geometryCache.set(key, buildClumpGeometry(key));
    }
    return this.geometryCache.get(key);
  }

  _getAtlasTexture(atlasId) {
    const key = atlasId || 'textures';
    if (this.atlasTextureCache.has(key)) {
      return this.atlasTextureCache.get(key);
    }

    const image = this.room.textureAtlasImages.get(key) ?? this.room.textureAtlasImage;
    if (!image) return null;

    const source = isPropTextureAtlas(key) ? applyPropsChromaKey(image) : image;
    const texture = new THREE.Texture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    this.atlasTextureCache.set(key, texture);
    return texture;
  }

  _makeInstanceMatrices(entry, species, count, rng) {
    const matrices = [];
    const params = new Float32Array(count * 4);
    const heightRange = species.size.heightMax - species.size.heightMin;
    const widthRange = species.size.widthMax - species.size.widthMin;
    const areaShape = entry.area?.shape ?? 'rect';
    const lineLength = entry.line?.length ?? 4;
    const lineWidth = entry.line?.width ?? 0.8;
    const temp = new THREE.Object3D();

    for (let index = 0; index < count; index += 1) {
      let x = 0;
      let z = 0;
      if (entry.mode === 'patch') {
        if (areaShape === 'circle') {
          const angle = rng() * Math.PI * 2;
          const radius = Math.sqrt(rng()) * (entry.area?.radius ?? 1.5);
          x = Math.cos(angle) * radius;
          z = Math.sin(angle) * radius;
        } else {
          x = (rng() - 0.5) * (entry.area?.width ?? 2);
          z = (rng() - 0.5) * (entry.area?.depth ?? 2);
        }
      } else if (entry.mode === 'line') {
        const countDenominator = Math.max(1, count - 1);
        const t = count === 1 ? 0.5 : index / countDenominator;
        x = (t - 0.5) * lineLength;
        z = (rng() - 0.5) * lineWidth;
      }

      const height = species.size.heightMin + rng() * Math.max(0.0001, heightRange);
      const width = species.size.widthMin + rng() * Math.max(0.0001, widthRange);
      const yaw = entry.mode === 'line'
        ? (Math.PI * 0.5) + (rng() - 0.5) * 0.35
        : rng() * Math.PI;

      temp.position.set(x, 0, z);
      temp.rotation.set(0, yaw, 0);
      temp.scale.set(width, height, width);
      temp.updateMatrix();
      matrices.push(temp.matrix.clone());

      const cell = species.cells[Math.min(species.cells.length - 1, Math.floor(rng() * species.cells.length))] ?? 0;
      const brightness = clamp(0.9 + (rng() - 0.5) * 0.22, 0.7, 1.2);
      params[index * 4] = rng() * Math.PI * 2;
      params[index * 4 + 1] = 0.75 + rng() * 0.5;
      params[index * 4 + 2] = cell;
      params[index * 4 + 3] = brightness;
    }

    return { matrices, params };
  }

  _attachAnimatedUniformTick(mesh, materials = []) {
    mesh.onBeforeRender = () => {
      const timeSeconds = performance.now() * 0.001;
      materials.forEach((material) => {
        material?.userData?.vegUniforms?.uVegTime && (material.userData.vegUniforms.uVegTime.value = timeSeconds);
      });
    };
  }

  _buildTreeCanopy(species, seedKey) {
    const treeBuilder = normalizeTreeBuilder(species.treeBuilder);
    const geometry = this._getSharedClumpGeometry(species.cardCount ?? 2).clone();
    geometry.userData.isVegetationCachedGeometry = false;

    const { matrices, params } = createTreeLeafInstanceData({
      treeBuilder,
      cells: species.cells,
      seed: hashSeed(seedKey),
    });
    geometry.setAttribute('instanceParams', new THREE.InstancedBufferAttribute(params, 4));

    const texture = this._getAtlasTexture(species.atlas);
    const material = createAnimatedFoliageMaterial(texture, species);
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    mesh.name = 'TreeCanopy';
    mesh.userData.excludeBvhCollider = true;
    mesh.castShadow = species.shadow !== 'none';
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    matrices.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    this._attachAnimatedUniformTick(mesh, [
      material,
      material.customDepthMaterial,
      material.customDistanceMaterial,
    ]);
    return mesh;
  }

  _createProceduralTreeTrunk(species, { excludeBvhCollider = false } = {}) {
    const trunk = buildTreeTrunkMesh(species.treeBuilder);
    trunk.castShadow = species.shadow !== 'none';
    trunk.receiveShadow = true;
    trunk.userData.excludeBvhCollider = excludeBvhCollider === true;
    return trunk;
  }

  _createTreeCollisionProxy(species) {
    const shape = species?.collisionShape ?? {};
    const height = Math.max(0.05, Number(shape.height ?? 1));
    const radius = Math.max(0.025, Number(shape.radius ?? 0.15));
    const width = Math.max(0.05, Number(shape.width ?? (radius * 2)));
    const depth = Math.max(0.05, Number(shape.depth ?? (radius * 2)));
    const offsetY = Number.isFinite(shape.offsetY) ? shape.offsetY : (height * 0.5);
    const geometry = species?.collision === 'box'
      ? new THREE.BoxGeometry(width, height, depth)
      : new THREE.CylinderGeometry(radius, radius, height, 12, 1, false);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff8a1f,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'TreeCollisionProxy';
    mesh.position.y = offsetY;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.colliderAlwaysActive = true;
    mesh.userData.skipOutline = true;
    return mesh;
  }

  _buildInstancedCards(entry, species) {
    const geometry = this._getSharedClumpGeometry(species.cardCount ?? 3).clone();
    geometry.userData.isVegetationCachedGeometry = false;
    const count = entry.mode === 'single'
      ? 1
      : entry.mode === 'line'
        ? Math.max(1, Math.round((entry.line?.length ?? 4) / Math.max(0.1, species.lineSpacing ?? 0.4)))
        : Math.max(1, Math.trunc(entry.density || 1));
    const rng = mulberry32(hashSeed(`${entry.id}:${entry.seed}:${species.id}`));
    const { matrices, params } = this._makeInstanceMatrices(entry, species, count, rng);
    geometry.setAttribute('instanceParams', new THREE.InstancedBufferAttribute(params, 4));

    const texture = this._getAtlasTexture(species.atlas);
    const material = createAnimatedFoliageMaterial(texture, species);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `${entry.name}-instanced`;
    mesh.castShadow = species.shadow !== 'none';
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    matrices.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    setVegetationUserData(mesh, entry.id);
    setSkipFullscreenOutline(mesh, species.kind === 'grass');
    setDecorativeVegetationFlags(mesh, species.kind === 'grass');
    setCameraOccluderEnabled(mesh, species.kind !== 'grass' && species.kind !== 'tree');
    this._attachAnimatedUniformTick(mesh, [
      material,
      material.customDepthMaterial,
      material.customDistanceMaterial,
    ]);
    return mesh;
  }

  async _buildGlbPlacement(entry, species) {
    const treeBuilder = species.kind === 'tree' ? normalizeTreeBuilder(species.treeBuilder) : null;
    const source = species.assetId
      ? await this.room.loadGlbModel(species.assetId)
      : null;
    if (!source && !treeBuilder) return null;

    const group = new THREE.Group();
    // Trees render from the baked/source visual asset, but collision should stay on a
    // simple authored trunk proxy instead of the decorative canopy silhouette.
    const colliderProxyGroup = treeBuilder ? new THREE.Group() : null;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    if (source) {
      box.setFromObject(source);
      box.getSize(size);
    } else if (treeBuilder) {
      const bounds = estimateTreeBuilderBounds(treeBuilder);
      size.set(bounds.radius * 2, bounds.height, bounds.radius * 2);
    }
    const baseHeight = Math.max(size.y, 0.001);
    const rng = mulberry32(hashSeed(`${entry.id}:${entry.seed}:${species.id}:glb`));

    let count = 1;
    if (entry.mode === 'patch') {
      count = Math.min(32, Math.max(1, Math.trunc(entry.density || 1)));
    } else if (entry.mode === 'line') {
      count = Math.max(1, Math.round((entry.line?.length ?? 4) / Math.max(0.1, species.lineSpacing ?? 0.5)));
    }

    const points = this._makeInstanceMatrices(entry, species, count, rng).matrices;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const ignoredScale = new THREE.Vector3();
    points.forEach((matrix) => {
      const clone = source ? source.clone(true) : new THREE.Group();
      matrix.decompose(position, quaternion, ignoredScale);
      clone.position.copy(position);
      clone.quaternion.copy(quaternion);
      if (source) {
        clone.traverse((child) => {
          if (!child.isMesh || !child.material) return;
          child.material = Array.isArray(child.material)
            ? child.material.map((material) => material?.clone())
            : child.material.clone();
          child.castShadow = species.shadow !== 'none';
          child.receiveShadow = true;
        });
      } else if (treeBuilder) {
        clone.add(this._createProceduralTreeTrunk(species, { excludeBvhCollider: true }));
      }

      if (treeBuilder) {
        clone.add(this._buildTreeCanopy(species, `${entry.id}:${species.id}:${position.x.toFixed(3)}:${position.z.toFixed(3)}`));
      }

      const desiredHeight = species.size.heightMin + rng() * Math.max(0.0001, species.size.heightMax - species.size.heightMin);
      const scalar = desiredHeight / baseHeight;
      clone.scale.setScalar(scalar);
      group.add(clone);

      if (colliderProxyGroup) {
        const colliderMesh = this._createTreeCollisionProxy(species);
        // Preserve the authored trunk lift so the proxy sits on the ground
        // instead of getting re-centered at the placement origin.
        colliderMesh.position.set(
          position.x,
          position.y + colliderMesh.position.y,
          position.z,
        );
        colliderMesh.quaternion.copy(quaternion);
        colliderMesh.scale.setScalar(scalar);
        colliderProxyGroup.add(colliderMesh);
      }
    });

    if (colliderProxyGroup && colliderProxyGroup.children.length) {
      colliderProxyGroup.name = `${entry.name}-collider`;
      colliderProxyGroup.visible = false;
      colliderProxyGroup.userData.colliderAlwaysActive = true;
      setVegetationUserData(colliderProxyGroup, entry.id);
      group.add(colliderProxyGroup);
      group.userData.colliderProxyRoot = colliderProxyGroup;
    }

    setVegetationUserData(group, entry.id);
    setSkipFullscreenOutline(group, species.kind === 'grass');
    setDecorativeVegetationFlags(group, species.kind === 'grass');
    setCameraOccluderEnabled(group, species.kind !== 'grass' && species.kind !== 'tree');
    return group;
  }

  async _buildPlacement(entry, species) {
    const group = new THREE.Group();
    group.name = entry.name;
    group.position.set(entry.position.x, entry.position.y, entry.position.z);
    group.rotation.set(entry.rotation.x, entry.rotation.y, entry.rotation.z);
    group.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
    group.userData.colliderEnabled = species.collision !== 'none';
    setVegetationUserData(group, entry.id);
    setSkipFullscreenOutline(group, species.kind === 'grass');
    setDecorativeVegetationFlags(group, species.kind === 'grass');
    setCameraOccluderEnabled(group, species.kind !== 'grass' && species.kind !== 'tree');

    const content = species.renderMode === 'instancedCards'
      ? this._buildInstancedCards(entry, species)
      : await this._buildGlbPlacement(entry, species);
    if (!content) {
      return null;
    }

    group.add(content);
    if (content.userData?.colliderProxyRoot) {
      group.userData.colliderProxyRoot = content.userData.colliderProxyRoot;
    }
    group.updateMatrixWorld(true);
    return group;
  }

  async rebuild(placements = []) {
    const buildToken = ++this._buildToken;
    await this.ensureLibrary();
    this.placements = Array.isArray(placements)
      ? placements.map((entry) => normalizeVegetationPlacement(entry)).filter((entry) => !entry.deleted)
      : [];

    this.clear();
    for (const entry of this.placements) {
      if (buildToken !== this._buildToken) return;
      const species = this.library.species.find((candidate) => candidate.id === entry.speciesId);
      if (!species) continue;
      const group = await this._buildPlacement(entry, species);
      if (buildToken !== this._buildToken) {
        disposeObject3D(group);
        return;
      }
      if (!group) continue;
      this.group.add(group);
      this.placementObjects.set(entry.id, { entry, species, group });

      if (species.collision !== 'none') {
        const collisionMode = getVegetationCollisionMode(species);
        const colliderRoot = group.userData.colliderProxyRoot ?? group;
        const colliderMetadata = {
          source: 'vegetation',
          vegetationId: entry.id,
          nonWalkable: species.kind === 'tree',
          collisionMode,
        };
        if (collisionMode === 'trunk-shape') {
          (colliderRoot.children ?? []).forEach((proxyMesh, proxyIndex) => {
            this.room._registerCollider(proxyMesh, {
              type: 'furniture',
              metadata: {
                ...colliderMetadata,
                proxyIndex,
              },
            });
          });
        } else {
          this.room._registerCollider(colliderRoot, {
            type: 'furniture',
            metadata: colliderMetadata,
            useBvh: collisionMode !== 'none',
            bvhOptions: collisionMode !== 'none' ? {
              maxDepth: species.kind === 'tree' ? 3 : 2,
              maxLeafSize: species.kind === 'tree' ? 12 : 18,
              maxBoxes: species.kind === 'tree' ? 32 : 24,
              exclude: (child) => child.userData?.excludeBvhCollider === true,
            } : null,
          });
        }
      }
    }

    this.room.refreshColliders();
  }

  setKindVisible(kind, visible) {
    for (const entry of this.placementObjects.values()) {
      if (entry.species?.kind === kind) {
        entry.group.visible = !!visible;
      }
    }
  }

  isKindVisible(kind) {
    for (const entry of this.placementObjects.values()) {
      if (entry.species?.kind === kind) return entry.group.visible !== false;
    }
    return true;
  }
}
