import * as THREE from 'three';
import {
  DEFAULT_ROPE_COLOR,
  DEFAULT_ROPE_CARD_OPACITY,
  DEFAULT_ROPE_CARD_WIDTH,
  ROPE_SEGMENT_RADIUS,
} from '../../shared/ropes.js';

const CARD_TWIST_CLAMP_RADIANS = THREE.MathUtils.degToRad(16);

/**
 * Renders server-authoritative ropes as a tube along segment positions.
 * Style (radius, color, optional atlas texture) comes from layout merged by id.
 */
export class RopeSystem extends THREE.Group {
  constructor({ resolveTexture = null } = {}) {
    super();
    this.name = 'RopeSystem';
    this._resolveTexture = typeof resolveTexture === 'function' ? resolveTexture : null;
    /** @type {Map<string, { group: THREE.Group, mesh: THREE.Mesh | null, cardsMesh: THREE.Mesh | null, material: THREE.MeshStandardMaterial | null, cardsMaterial: THREE.MeshStandardMaterial | null, pinnedCardRight: THREE.Vector3 | null, styleKey: string }>} */
    this._entries = new Map();
    this._up = new THREE.Vector3(0, 1, 0);
    this._fallbackRight = new THREE.Vector3(1, 0, 0);
  }

  /**
   * @param {{ id: string, segments: { x: number, y: number, z: number }[] }[]} ropesSnapshot
   * @param {Map<string, { segmentRadius?: number, color?: string, texture?: { atlas: string, cell: number } | null, visualMode?: string, cards?: { enabled?: boolean, width?: number, opacity?: number } }>} [styleById]
   */
  update(ropesSnapshot, styleById) {
    if (!Array.isArray(ropesSnapshot)) return;
    const styles = styleById instanceof Map ? styleById : new Map();
    const seen = new Set();

    for (const rope of ropesSnapshot) {
      if (!rope?.id || !Array.isArray(rope.segments) || rope.segments.length < 2) continue;
      seen.add(rope.id);

      const st = styles.get(rope.id) ?? {};
      const segmentRadius = Number.isFinite(st.segmentRadius) ? st.segmentRadius : ROPE_SEGMENT_RADIUS;
      const color = typeof st.color === 'string' ? st.color : DEFAULT_ROPE_COLOR;
      const tex = st.texture && Number.isFinite(st.texture.cell)
        ? st.texture
        : null;
      const visualMode = st.visualMode === 'cards' || st.visualMode === 'rope-cards' ? st.visualMode : 'rope';
      const showRope = visualMode !== 'cards';
      const showCards = visualMode === 'cards' || visualMode === 'rope-cards' || st.cards?.enabled === true;
      const cardWidth = Number.isFinite(st.cards?.width) ? st.cards.width : DEFAULT_ROPE_CARD_WIDTH;
      const cardOpacity = Number.isFinite(st.cards?.opacity) ? st.cards.opacity : DEFAULT_ROPE_CARD_OPACITY;
      const styleKey = [
        segmentRadius,
        color,
        tex ? `${tex.atlas}:${tex.cell}` : 'none',
        visualMode,
        showCards ? `${cardWidth}:${cardOpacity}` : 'no-cards',
      ].join('|');

      let entry = this._entries.get(rope.id);
      if (!entry) {
        const group = new THREE.Group();
        group.name = `rope-visual-${rope.id}`;
        this.add(group);
        entry = {
          group,
          mesh: null,
          cardsMesh: null,
          material: null,
          cardsMaterial: null,
          pinnedCardRight: null,
          styleKey: '',
        };
        this._entries.set(rope.id, entry);
      }

      if (!entry.material || entry.styleKey !== styleKey) {
        if (entry.material) entry.material.dispose();
        if (entry.cardsMaterial) entry.cardsMaterial.dispose();
        const map = tex && this._resolveTexture
          ? this._resolveTexture(tex.atlas, tex.cell)
          : null;
        entry.material = new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : new THREE.Color(color),
          map: map ?? null,
          roughness: map ? 0.7 : 0.52,
          metalness: 0.05,
        });
        entry.material.side = THREE.DoubleSide;
        entry.cardsMaterial = new THREE.MeshStandardMaterial({
          color: map ? 0xffffff : new THREE.Color(color),
          map: map ?? null,
          roughness: map ? 0.72 : 0.6,
          metalness: 0.02,
          transparent: true,
          opacity: cardOpacity,
          alphaTest: map ? 0.18 : 0,
          depthWrite: !map && cardOpacity >= 0.98,
        });
        entry.cardsMaterial.side = THREE.DoubleSide;
        entry.styleKey = styleKey;
      }

      const pts = rope.segments.map((s) => new THREE.Vector3(s.x, s.y, s.z));
      let curve;
      if (pts.length === 2) {
        curve = new THREE.LineCurve3(pts[0], pts[1]);
      } else {
        curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      }

      const tubularSegments = Math.max(16, (pts.length - 1) * 10);
      const radialSegments = 6;

      if (entry.mesh) {
        entry.mesh.geometry.dispose();
        entry.group.remove(entry.mesh);
        entry.mesh = null;
      }
      if (entry.cardsMesh) {
        entry.cardsMesh.geometry.dispose();
        entry.group.remove(entry.cardsMesh);
        entry.cardsMesh = null;
      }

      if (showRope) {
        const geometry = new THREE.TubeGeometry(
          curve,
          tubularSegments,
          segmentRadius,
          radialSegments,
          false,
        );
        const mesh = new THREE.Mesh(geometry, entry.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        entry.group.add(mesh);
        entry.mesh = mesh;
      }

      if (showCards) {
        if (!entry.pinnedCardRight) {
          entry.pinnedCardRight = this._computeInitialCardRight(pts);
        }
        const cardsGeometry = this._createCardGeometry(pts, cardWidth, entry.pinnedCardRight);
        const cardsMesh = new THREE.Mesh(cardsGeometry, entry.cardsMaterial);
        cardsMesh.castShadow = true;
        cardsMesh.receiveShadow = true;
        cardsMesh.frustumCulled = false;
        entry.group.add(cardsMesh);
        entry.cardsMesh = cardsMesh;
      }
    }

    for (const id of [...this._entries.keys()]) {
      if (seen.has(id)) continue;
      const entry = this._entries.get(id);
      if (entry?.mesh) entry.mesh.geometry.dispose();
      if (entry?.cardsMesh) entry.cardsMesh.geometry.dispose();
      if (entry?.material) entry.material.dispose();
      if (entry?.cardsMaterial) entry.cardsMaterial.dispose();
      this.remove(entry.group);
      this._entries.delete(id);
    }
  }

  _computeInitialCardRight(points) {
    const dir = new THREE.Vector3();
    for (let i = 0; i < points.length - 1; i += 1) {
      dir.copy(points[i + 1]).sub(points[i]);
      if (dir.lengthSq() <= 0.000001) continue;
      dir.normalize();
      const right = new THREE.Vector3().crossVectors(this._up, dir);
      if (right.lengthSq() <= 0.000001) return this._fallbackRight.clone();
      return right.normalize();
    }
    return this._fallbackRight.clone();
  }

  _createCardGeometry(points, width, pinnedTopRight = null) {
    const positions = [];
    const uvs = [];
    const indices = [];
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const prevRight = new THREE.Vector3();
    let hasPrevRight = false;
    let vertex = 0;
    const halfWidth = Math.max(0.01, Number(width) || DEFAULT_ROPE_CARD_WIDTH) * 0.5;

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      dir.copy(b).sub(a);
      if (dir.lengthSq() <= 0.000001) continue;
      dir.normalize();
      if (!hasPrevRight && pinnedTopRight) {
        right.copy(pinnedTopRight);
        // Keep the top fabric frame pinned, but project it enough that the
        // card still has valid width when the rope segment bends under it.
        right.addScaledVector(dir, -right.dot(dir));
        if (right.lengthSq() <= 0.000001) right.copy(pinnedTopRight);
      } else {
        right.crossVectors(this._up, dir);
      }
      if (right.lengthSq() <= 0.000001) right.copy(this._fallbackRight);
      else right.normalize();
      if (hasPrevRight) {
        if (right.dot(prevRight) < 0) right.negate();
        const dot = THREE.MathUtils.clamp(prevRight.dot(right), -1, 1);
        const angle = Math.acos(dot);
        if (angle > CARD_TWIST_CLAMP_RADIANS) {
          right.lerp(prevRight, 1 - (CARD_TWIST_CLAMP_RADIANS / angle)).normalize();
        }
      }
      prevRight.copy(right);
      hasPrevRight = true;
      right.multiplyScalar(halfWidth);

      positions.push(
        a.x - right.x, a.y - right.y, a.z - right.z,
        a.x + right.x, a.y + right.y, a.z + right.z,
        b.x + right.x, b.y + right.y, b.z + right.z,
        b.x - right.x, b.y - right.y, b.z - right.z,
      );
      uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
      indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
      vertex += 4;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  dispose() {
    for (const entry of this._entries.values()) {
      entry.mesh?.geometry?.dispose();
      entry.cardsMesh?.geometry?.dispose();
      entry.material?.dispose();
      entry.cardsMaterial?.dispose();
    }
    this._entries.clear();
  }
}
