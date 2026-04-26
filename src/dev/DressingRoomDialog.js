import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MouseEyeAtlasAnimator } from '../animation/MouseEyeAtlasAnimator.js';
import {
  getAvatarPortrait,
  hasAvatarPortrait,
  resetAvatarPortrait,
  setAvatarPortrait,
} from '../data/avatarPortraits.js';
import {
  exportEyePlacements,
  getEyePlacement,
  getEyeTargetDef,
  listEyeTargets,
  resetEyePlacement,
  setEyePlacement,
} from '../data/eyePlacements.js';
import { findSocket, listSockets } from '../data/attachEyes.js';
import { assetUrl } from '../utils/assetUrl.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const PORTRAIT_CAPTURE_WIDTH = 768;
const PORTRAIT_CAPTURE_HEIGHT = 1024;
const HUD_AVATAR_SIZE = 36;
const PORTRAIT_PREVIEW_SIZE = 84;

/**
 * Dev-only "Dressing Room" dialog. Loads any registered eye-placement target
 * (mouse, brain, jerry, cat, human, bird) into an isolated viewport so eyes can be
 * positioned, rotated, and scaled relative to a chosen socket bone. Changes
 * persist via the eyePlacements store and are broadcast live to in-game
 * entities listening for that target.
 *
 * Future-proofed for additional slot types (e.g. hand items).
 */
export class DressingRoomDialog {
  constructor({ OrbitControls, TransformControls } = {}) {
    this.OrbitControls = OrbitControls;
    this.TransformControls = TransformControls;
    this.targets = listEyeTargets();
    this.activeKey = this.targets[0]?.key ?? 'mouse';
    this._raf = 0;
    this._gltfCache = new Map();
    this._previewModel = null;
    this._eyeAnimator = null;
    this._activeDef = null;
    this._lastTime = 0;
    this._suppressInputSync = false;
    this._suppressPortraitSync = false;

    this._buildUI();
    this._buildScene();
  }

  open(modelKey) {
    if (modelKey && this.targets.find((t) => t.key === modelKey)) {
      this.activeKey = modelKey;
    }
    this.overlay.style.display = 'grid';
    this._resizeRenderer();
    this._loadActiveTarget().catch((err) => this._setStatus(`load failed: ${err.message}`, true));
    this._startLoop();
  }

  close() {
    this.overlay.style.display = 'none';
    this._stopLoop();
    this._transformControls?.detach();
  }

  isOpen() {
    return this.overlay.style.display !== 'none';
  }

  toggle(modelKey) {
    if (this.isOpen()) this.close();
    else this.open(modelKey);
  }

  _buildUI() {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '170',
      display: 'none',
      gridTemplateColumns: 'minmax(440px, 1fr) 360px',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(8px)',
      fontFamily: 'monospace',
      color: '#f7efe5',
    });

    const viewportWrap = document.createElement('div');
    Object.assign(viewportWrap.style, {
      position: 'relative',
      minHeight: '100vh',
      padding: '20px',
      boxSizing: 'border-box',
    });
    this.overlay.appendChild(viewportWrap);

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      borderRadius: '18px',
      background: 'linear-gradient(180deg, rgba(42,52,63,1) 0%, rgba(20,18,16,1) 100%)',
      boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
    });
    viewportWrap.appendChild(this.canvas);

    const hint = document.createElement('div');
    hint.textContent = 'Dressing Room — orbit to inspect, drag gizmo to nudge eyes, then Save. Use Capture portrait for a clean PNG.';
    Object.assign(hint.style, {
      position: 'absolute',
      left: '32px',
      bottom: '28px',
      padding: '8px 10px',
      borderRadius: '10px',
      background: 'rgba(12,10,9,0.72)',
      border: '1px solid rgba(255,255,255,0.12)',
      fontSize: '12px',
    });
    viewportWrap.appendChild(hint);

    this.panel = document.createElement('aside');
    Object.assign(this.panel.style, {
      overflowY: 'auto',
      padding: '20px',
      boxSizing: 'border-box',
      background: 'rgba(12,10,9,0.95)',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      fontSize: '12px',
    });
    this.overlay.appendChild(this.panel);

    const title = document.createElement('div');
    title.textContent = 'DRESSING ROOM';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      color: '#ffd7a4',
      marginBottom: '12px',
    });
    this.panel.appendChild(title);

    this.targetSelect = this._addSelect('Character', this.targets.map((t) => ({ value: t.key, label: t.label })), this.activeKey, (val) => {
      this.activeKey = val;
      this._loadActiveTarget().catch((err) => this._setStatus(`load failed: ${err.message}`, true));
    });

    this.socketSelect = this._addSelect('Socket bone', [{ value: '', label: '(model root)' }], '', (val) => {
      const placement = { socket: val || null };
      setEyePlacement(this.activeKey, placement);
      this._reflectPlacementToInputs(getEyePlacement(this.activeKey));
    });

    const transformBtns = document.createElement('div');
    Object.assign(transformBtns.style, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', margin: '8px 0' });
    transformBtns.appendChild(this._makeButton('Move', () => this._setTransformMode('translate')));
    transformBtns.appendChild(this._makeButton('Rotate', () => this._setTransformMode('rotate')));
    transformBtns.appendChild(this._makeButton('Scale', () => this._setTransformMode('scale')));
    this.panel.appendChild(transformBtns);

    this.posInputs = this._addVectorRow('Position', [-2, 2, 0.001]);
    this.rotInputs = this._addVectorRow('Rotation°', [-360, 360, 0.5]);
    this.scaleInputs = this._addVectorRow('Scale', [0.01, 8, 0.001]);
    this.eyeSizeInput = this._addNumberRow('Eye size', 0.01, 1, 0.001);

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginTop: '12px' });
    actions.appendChild(this._makeButton('Reset target', () => this._resetActive(), '#5d221f'));
    actions.appendChild(this._makeButton('Copy JSON', () => this._copyJson()));
    this.panel.appendChild(actions);

    const portraitBtn = this._makeButton('Capture portrait PNG', () => {
      this._capturePortrait().catch((err) => this._setStatus(`portrait failed: ${err.message}`, true));
    }, '#2c3454');
    portraitBtn.style.marginTop = '8px';
    portraitBtn.style.width = '100%';
    this.panel.appendChild(portraitBtn);

    this._buildPortraitEditor();

    this.status = document.createElement('div');
    Object.assign(this.status.style, { marginTop: '10px', minHeight: '18px', color: '#9ee8b2', whiteSpace: 'pre-wrap' });
    this.panel.appendChild(this.status);

    const closeBtn = this._makeButton('Close (N)', () => this.close());
    closeBtn.style.marginTop = '12px';
    this.panel.appendChild(closeBtn);

    document.body.appendChild(this.overlay);
  }

  _buildPortraitEditor() {
    this.portraitSection = document.createElement('section');
    Object.assign(this.portraitSection.style, {
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
    });
    this.panel.appendChild(this.portraitSection);

    const title = document.createElement('div');
    title.textContent = 'AVATAR PORTRAIT';
    Object.assign(title.style, {
      fontWeight: '700',
      letterSpacing: '0.08em',
      color: '#ffd7a4',
      marginBottom: '10px',
    });
    this.portraitSection.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Upload a portrait image for the selected hero and position it inside the circular HUD avatar.';
    Object.assign(subtitle.style, {
      color: '#cbb89a',
      fontSize: '11px',
      lineHeight: '1.35',
      marginBottom: '10px',
    });
    this.portraitSection.appendChild(subtitle);

    const previewRow = document.createElement('div');
    Object.assign(previewRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '10px',
    });
    this.portraitSection.appendChild(previewRow);

    const previews = document.createElement('div');
    Object.assign(previews.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexShrink: '0',
    });
    previewRow.appendChild(previews);

    const hudPreviewWrap = document.createElement('div');
    Object.assign(hudPreviewWrap.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
    });
    previews.appendChild(hudPreviewWrap);

    this.portraitHudPreview = this._createPortraitFrame(HUD_AVATAR_SIZE);
    hudPreviewWrap.appendChild(this.portraitHudPreview.frame);

    const hudPreviewLabel = document.createElement('div');
    hudPreviewLabel.textContent = 'HUD';
    Object.assign(hudPreviewLabel.style, {
      color: '#cbb89a',
      fontSize: '10px',
      letterSpacing: '0.06em',
    });
    hudPreviewWrap.appendChild(hudPreviewLabel);

    const editPreviewWrap = document.createElement('div');
    Object.assign(editPreviewWrap.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
    });
    previews.appendChild(editPreviewWrap);

    this.portraitPreview = this._createPortraitFrame(PORTRAIT_PREVIEW_SIZE);
    editPreviewWrap.appendChild(this.portraitPreview.frame);

    const editPreviewLabel = document.createElement('div');
    editPreviewLabel.textContent = 'Edit';
    Object.assign(editPreviewLabel.style, {
      color: '#cbb89a',
      fontSize: '10px',
      letterSpacing: '0.06em',
    });
    editPreviewWrap.appendChild(editPreviewLabel);

    this.portraitMeta = document.createElement('div');
    Object.assign(this.portraitMeta.style, {
      minWidth: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    });
    previewRow.appendChild(this.portraitMeta);

    this.portraitName = document.createElement('div');
    Object.assign(this.portraitName.style, {
      color: '#ffe08a',
      fontWeight: '700',
      letterSpacing: '0.06em',
    });
    this.portraitMeta.appendChild(this.portraitName);

    this.portraitSource = document.createElement('div');
    Object.assign(this.portraitSource.style, {
      color: '#dce8ff',
      fontSize: '11px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '220px',
    });
    this.portraitMeta.appendChild(this.portraitSource);

    const uploadLabel = this._makeLabelSpan('Portrait image');
    this.portraitSection.appendChild(uploadLabel);
    this.portraitUploadInput = document.createElement('input');
    this.portraitUploadInput.type = 'file';
    this.portraitUploadInput.accept = 'image/*';
    Object.assign(this.portraitUploadInput.style, this._inputStyle(), { marginBottom: '8px' });
    this.portraitUploadInput.addEventListener('change', () => {
      this._onPortraitFileSelected().catch((err) => this._setStatus(`portrait upload failed: ${err.message}`, true));
    });
    this.portraitSection.appendChild(this.portraitUploadInput);

    this.portraitXInput = this._addPortraitSlider('Horizontal position', -50, 150, 1);
    this.portraitYInput = this._addPortraitSlider('Vertical position', -50, 150, 1);
    this.portraitScaleInput = this._addPortraitSlider('Zoom', 0.25, 3, 0.01);

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginTop: '10px' });
    actions.appendChild(this._makeButton('Reset portrait', () => this._resetPortrait(), '#5d221f'));
    actions.appendChild(this._makeButton('Use defaults', () => this._restoreDefaultPortraitImage(), '#2c3454'));
    this.portraitSection.appendChild(actions);

    this._refreshPortraitEditor();
  }

  _addSelect(label, options, value, onChange) {
    const row = document.createElement('label');
    Object.assign(row.style, { display: 'block', marginBottom: '8px' });
    row.appendChild(this._makeLabelSpan(label));
    const select = document.createElement('select');
    Object.assign(select.style, this._inputStyle());
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    row.appendChild(select);
    this.panel.appendChild(row);
    return select;
  }

  _addVectorRow(label, [min, max, step]) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginBottom: '8px' });
    wrap.appendChild(this._makeLabelSpan(label));
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' });
    const inputs = ['x', 'y', 'z'].map((axis) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.dataset.axis = axis;
      Object.assign(input.style, this._inputStyle());
      input.addEventListener('input', () => this._onInputsChanged());
      grid.appendChild(input);
      return input;
    });
    wrap.appendChild(grid);
    this.panel.appendChild(wrap);
    return inputs;
  }

  _addNumberRow(label, min, max, step) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginBottom: '8px' });
    wrap.appendChild(this._makeLabelSpan(label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    Object.assign(input.style, this._inputStyle());
    input.addEventListener('input', () => this._onInputsChanged());
    wrap.appendChild(input);
    this.panel.appendChild(wrap);
    return input;
  }

  _addPortraitSlider(label, min, max, step) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginBottom: '8px' });
    wrap.appendChild(this._makeLabelSpan(label));

    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 72px',
      gap: '6px',
      alignItems: 'center',
    });

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    Object.assign(input.style, {
      width: '100%',
      accentColor: '#ffd7a4',
    });
    input.addEventListener('input', () => this._onPortraitInputChanged());
    row.appendChild(input);

    const value = document.createElement('input');
    value.type = 'number';
    value.min = String(min);
    value.max = String(max);
    value.step = String(step);
    Object.assign(value.style, this._inputStyle());
    value.addEventListener('input', () => {
      input.value = value.value;
      this._onPortraitInputChanged();
    });
    input.addEventListener('input', () => {
      value.value = input.value;
    });
    row.appendChild(value);

    wrap.appendChild(row);
    this.portraitSection.appendChild(wrap);
    return { input, value };
  }

  _createPortraitFrame(size) {
    const frame = document.createElement('div');
    Object.assign(frame.style, {
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '999px',
      overflow: 'hidden',
      border: '2px solid rgba(210, 220, 236, 0.9)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 6px rgba(0,0,0,0.35)',
      background: 'radial-gradient(circle at 35% 30%, rgba(140,150,170,0.95) 0%, rgba(72,80,96,0.98) 100%)',
      flexShrink: '0',
      display: 'grid',
      placeItems: 'center',
    });

    const image = document.createElement('img');
    Object.assign(image.style, {
      width: '100%',
      height: '100%',
      display: 'none',
      objectFit: 'contain',
      transformOrigin: 'center center',
    });
    frame.appendChild(image);

    const fallback = document.createElement('div');
    fallback.textContent = size <= HUD_AVATAR_SIZE ? '' : 'No image';
    Object.assign(fallback.style, {
      width: '100%',
      height: '100%',
      display: 'grid',
      placeItems: 'center',
      color: '#f7efe5',
      fontSize: size <= HUD_AVATAR_SIZE ? '0px' : '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    });
    frame.appendChild(fallback);

    return { frame, image, fallback };
  }

  _makeLabelSpan(text) {
    const span = document.createElement('div');
    span.textContent = text;
    Object.assign(span.style, { color: '#cbb89a', marginBottom: '2px', fontSize: '11px' });
    return span;
  }

  _inputStyle() {
    return {
      width: '100%',
      boxSizing: 'border-box',
      padding: '4px 6px',
      background: 'rgba(255,255,255,0.05)',
      color: '#f7efe5',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px',
      fontFamily: 'monospace',
      fontSize: '12px',
    };
  }

  _makeButton(label, onClick, bg = '#23472d') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '6px 8px',
      background: bg,
      color: '#f7efe5',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontSize: '12px',
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  _setPortraitSliderValue(control, rawValue, digits = 2) {
    const numericValue = Number(rawValue);
    const value = digits === 0 ? String(Math.round(numericValue)) : numericValue.toFixed(digits);
    control.input.value = value;
    control.value.value = value;
  }

  _buildScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2e333a');

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
    this.camera.position.set(2.2, 1.6, 2.6);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor('#2e333a', 1);

    this.scene.add(new THREE.HemisphereLight('#dfe8f1', '#3b2f26', 1.2));
    const sun = new THREE.DirectionalLight('#ffdcb3', 1.6);
    sun.position.set(4, 6, 3);
    this.scene.add(sun);

    this._gridHelper = new THREE.GridHelper(8, 8, 0x556677, 0x222a33);
    this._gridHelper.position.y = 0;
    this.scene.add(this._gridHelper);

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    if (this.OrbitControls) {
      this._orbit = new this.OrbitControls(this.camera, this.canvas);
      this._orbit.enableDamping = true;
      this._orbit.dampingFactor = 0.08;
      this._orbit.target.set(0, 1.0, 0);
    }

    if (this.TransformControls) {
      this._transformControls = new this.TransformControls(this.camera, this.canvas);
      this._transformControls.size = 0.7;
      this._transformControls.addEventListener('dragging-changed', (event) => {
        if (this._orbit) this._orbit.enabled = !event.value;
      });
      this._transformControls.addEventListener('objectChange', () => this._onGizmoChanged());
      this._transformControlsHelper = this._transformControls.getHelper?.() ?? this._transformControls;
      this.scene.add(this._transformControlsHelper);
    }

    window.addEventListener('resize', () => {
      if (this.isOpen()) this._resizeRenderer();
    });
  }

  _resizeRenderer() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(64, Math.floor(rect.width));
    const h = Math.max(64, Math.floor(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _setTransformMode(mode) {
    this._transformControls?.setMode(mode);
  }

  async _loadActiveTarget() {
    const def = getEyeTargetDef(this.activeKey);
    if (!def) return;
    this._activeDef = def;
    this._refreshPortraitEditor();
    this._setStatus(`Loading ${def.label}…`);

    if (this._previewModel) {
      this.modelRoot.remove(this._previewModel);
      this._previewModel = null;
    }
    if (this._eyeAnimator) {
      this._eyeAnimator.dispose();
      this._eyeAnimator = null;
    }
    this._mixer = null;
    this._transformControls?.detach();

    const gltf = await this._loadGltf(def.modelPath);
    // Use SkeletonUtils.clone so cloned skinned meshes actually deform under
    // their own skeleton (regular .clone() leaves the mesh bound to the
    // ORIGINAL skeleton, so playing animations on the clone wouldn't move
    // the mesh — and bone positions wouldn't match in-game's idle pose).
    const model = cloneSkinned(gltf.scene);
    model.traverse((child) => { if (child.isMesh) child.castShadow = false; });
    this.modelRoot.add(model);
    this._previewModel = model;

    // Drive the model with its idle animation so the head bone (and the
    // eyes parented to it) sit in the same rest pose you see in-game,
    // not in the GLB's bind pose. Without this the cat looks T-posed and
    // any eye placement tuned here is offset from where it lands at runtime.
    if (gltf.animations?.length) {
      this._mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations.find((c) => /^idle$/i.test(c.name))
        ?? gltf.animations.find((c) => /idle/i.test(c.name))
        ?? gltf.animations[0];
      if (clip) {
        const action = this._mixer.clipAction(clip);
        action.play();
        // Advance once so the bones snap to the first frame before bbox/socket lookup.
        this._mixer.update(0);
      }
      model.updateMatrixWorld(true);
    }

    // Match the in-game world height for this character so eye placement
    // values are 1:1 portable: bone world-space scale (and therefore the
    // visible eye plane size) ends up identical to the live game.
    //
    // IMPORTANT: bbox method must match the in-game entity. Predators use
    // `Box3.setFromObject` (includes bones); HeroAvatar uses mesh-only
    // because some skinned skeletons have stray empties at extreme positions
    // that poison setFromObject. Pick per `kind`.
    model.updateMatrixWorld(true);
    let box = this._measureModelBounds(model, def.kind);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = def.previewWorldHeight ?? 1.6;
    const measuredH = Math.max(0.001, size.y);
    const fit = targetH / measuredH;
    model.scale.setScalar(fit);
    model.position.y = -box.min.y * fit;
    model.updateMatrixWorld(true);
    box = this._measureModelBounds(model, def.kind);

    // Frame the camera to the model's visible height so a 0.6m brain is just
    // as inspectable as a 9m human (with eyes still visibly large enough).
    if (this._orbit) {
      this._frameDefaultCamera(box, targetH);
      this.camera.near = Math.max(0.001, targetH * 0.005);
      this.camera.far = Math.max(50, targetH * 30);
      this.camera.updateProjectionMatrix();
      this._orbit.update();
    }

    // Populate socket dropdown from the just-loaded model.
    this._refillSocketOptions(model);

    // Attach a fresh eye animator for live preview.
    this._eyeAnimator = new MouseEyeAtlasAnimator();
    await this._eyeAnimator.load();
    const placement = getEyePlacement(this.activeKey);
    const anchor = findSocket(model, placement.socket);
    this._eyeAnimator.attach(anchor, {
      localOffset: new THREE.Vector3(placement.position.x, placement.position.y, placement.position.z),
      localRotation: new THREE.Euler(placement.rotation.x, placement.rotation.y, placement.rotation.z),
      localScale: new THREE.Vector3(placement.scale.x, placement.scale.y, placement.scale.z),
      eyeSize: placement.eyeSize ?? 0.13,
    });
    this._eyeAnimator.setViewCamera(this.camera);
    this._eyeAnimator.setState('idle', { immediate: true });
    if (this._transformControls && this._eyeAnimator.group) {
      this._transformControls.attach(this._eyeAnimator.group);
      this._transformControls.setMode('translate');
    }

    this._reflectPlacementToInputs(placement);
    this._refreshPortraitEditor();
    this._setStatus(`Editing ${def.label}.`);
  }

  _refreshPortraitEditor() {
    if (!this.portraitSection) return;
    const enabled = hasAvatarPortrait(this.activeKey);
    this.portraitSection.style.display = enabled ? 'block' : 'none';
    if (!enabled) return;
    this.portraitName.textContent = `${this.activeKey.toUpperCase()} PORTRAIT`;
    this._reflectPortraitToInputs();
  }

  _loadGltf(path) {
    if (!this._gltfCache.has(path)) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this._gltfCache.set(path, loader.loadAsync(assetUrl(path)));
    }
    return this._gltfCache.get(path);
  }

  _measureModelBounds(model, kind) {
    if (kind === 'predator') return new THREE.Box3().setFromObject(model);
    const box = new THREE.Box3();
    const meshBox = new THREE.Box3();
    model.updateMatrixWorld(true);
    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
      box.union(meshBox);
    });
    if (box.isEmpty()) box.setFromObject(model);
    return box;
  }

  _frameDefaultCamera(box, targetH) {
    if (!this._orbit) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const focusY = box.min.y + size.y * 0.55;
    const dist = Math.max(0.6, targetH * 1.8);
    this._orbit.target.set(center.x, focusY, center.z);
    this.camera.position.set(center.x + dist * 0.7, focusY + dist * 0.4, center.z + dist);
  }

  _framePortraitCamera(width, height) {
    const def = this._activeDef;
    const model = this._previewModel;
    if (!def || !model) return;
    const box = this._measureModelBounds(model, def.kind);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const isTall = def.kind === 'predator';
    const focusY = box.min.y + size.y * (isTall ? 0.72 : 0.76);
    const portraitSpan = Math.max(
      size.y * (isTall ? 0.78 : 0.72),
      (def.previewWorldHeight ?? 1) * (isTall ? 0.52 : 0.46),
    );
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitDist = (portraitSpan * 0.5) / Math.tan(vFov * 0.5);
    const offset = new THREE.Vector3(0.26, isTall ? 0.05 : 0.08, 1).normalize().multiplyScalar(fitDist * 1.18);
    const target = new THREE.Vector3(center.x, focusY, center.z);

    this.camera.aspect = width / height;
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    if (this._orbit) {
      this._orbit.target.copy(target);
      this._orbit.update();
    }
  }

  _refillSocketOptions(model) {
    const sockets = listSockets(model);
    while (this.socketSelect.firstChild) this.socketSelect.firstChild.remove();
    const root = document.createElement('option');
    root.value = '';
    root.textContent = '(model root)';
    this.socketSelect.appendChild(root);
    for (const name of sockets) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.socketSelect.appendChild(opt);
    }
    const placement = getEyePlacement(this.activeKey);
    this.socketSelect.value = placement.socket ?? '';
  }

  _reflectPlacementToInputs(placement) {
    if (!placement) return;
    this._suppressInputSync = true;
    try {
      const setVec = (inputs, vec, scale = 1) => {
        inputs[0].value = (vec.x * scale).toFixed(4);
        inputs[1].value = (vec.y * scale).toFixed(4);
        inputs[2].value = (vec.z * scale).toFixed(4);
      };
      setVec(this.posInputs, placement.position);
      setVec(this.rotInputs, placement.rotation, RAD2DEG);
      setVec(this.scaleInputs, placement.scale);
      this.eyeSizeInput.value = (placement.eyeSize ?? 0.13).toFixed(3);
      this.socketSelect.value = placement.socket ?? '';
    } finally {
      this._suppressInputSync = false;
    }
    this._applyPlacementToAnimator(placement);
  }

  _applyPlacementToAnimator(placement) {
    if (!this._eyeAnimator) return;
    this._eyeAnimator.setPlacement({
      position: placement.position,
      rotation: placement.rotation,
      scale: placement.scale,
      eyeSize: placement.eyeSize,
    });
  }

  _reflectPortraitToInputs() {
    const portrait = getAvatarPortrait(this.activeKey);
    if (!portrait) return;
    this._suppressPortraitSync = true;
    try {
      this._setPortraitSliderValue(this.portraitXInput, portrait.positionX, 0);
      this._setPortraitSliderValue(this.portraitYInput, portrait.positionY, 0);
      this._setPortraitSliderValue(this.portraitScaleInput, portrait.scale, 2);
      this._syncPortraitPreview(portrait);
    } finally {
      this._suppressPortraitSync = false;
    }
  }

  _syncPortraitPreview(portrait = getAvatarPortrait(this.activeKey)) {
    const activeLabel = this._activeDef?.label ?? this.activeKey;
    this.portraitName.textContent = `${activeLabel} portrait`;
    if (!portrait?.resolvedSrc) {
      for (const preview of [this.portraitHudPreview, this.portraitPreview]) {
        preview.image.style.display = 'none';
        preview.fallback.style.display = 'grid';
      }
      this.portraitSource.textContent = 'No image selected';
      return;
    }
    for (const preview of [this.portraitHudPreview, this.portraitPreview]) {
      preview.image.src = portrait.resolvedSrc;
      preview.image.style.display = 'block';
      preview.image.style.objectPosition = `${portrait.basePositionX}% ${portrait.basePositionY}%`;
      preview.image.style.transform = `translate(${portrait.translateX}%, ${portrait.translateY}%) scale(${portrait.scale})`;
      preview.fallback.style.display = 'none';
    }
    if (portrait.src?.startsWith('data:')) {
      this.portraitSource.textContent = 'Uploaded image';
    } else {
      this.portraitSource.textContent = portrait.src;
    }
  }

  _onPortraitInputChanged() {
    if (this._suppressPortraitSync || !hasAvatarPortrait(this.activeKey)) return;
    const num = (control, fallback = 0) => {
      const number = Number(control.input.value);
      return Number.isFinite(number) ? number : fallback;
    };
    const success = setAvatarPortrait(this.activeKey, {
      positionX: num(this.portraitXInput, 50),
      positionY: num(this.portraitYInput, 100),
      scale: num(this.portraitScaleInput, 1),
    });
    if (!success) {
      this._setStatus('portrait save failed: local storage quota exceeded', true);
      return;
    }
    this._syncPortraitPreview();
  }

  async _onPortraitFileSelected() {
    const file = this.portraitUploadInput.files?.[0];
    if (!file || !hasAvatarPortrait(this.activeKey)) return;
    const dataUrl = await this._readFileAsDataUrl(file);
    const success = setAvatarPortrait(this.activeKey, { src: dataUrl });
    this.portraitUploadInput.value = '';
    if (!success) {
      this._setStatus('portrait upload failed: local storage quota exceeded', true);
      return;
    }
    this._reflectPortraitToInputs();
    this._setStatus(`Using uploaded portrait for ${this.activeKey}.`);
  }

  _readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  _resetPortrait() {
    if (!hasAvatarPortrait(this.activeKey)) return;
    const success = resetAvatarPortrait(this.activeKey);
    if (!success) {
      this._setStatus('portrait reset failed: local storage quota exceeded', true);
      return;
    }
    this.portraitUploadInput.value = '';
    this._reflectPortraitToInputs();
    this._setStatus(`Reset portrait crop for ${this.activeKey}.`);
  }

  _restoreDefaultPortraitImage() {
    if (!hasAvatarPortrait(this.activeKey)) return;
    const success = setAvatarPortrait(this.activeKey, { src: null });
    if (!success) {
      this._setStatus('portrait image restore failed: local storage quota exceeded', true);
      return;
    }
    this.portraitUploadInput.value = '';
    this._reflectPortraitToInputs();
    this._setStatus(`Restored default portrait image for ${this.activeKey}.`);
  }

  _onInputsChanged() {
    if (this._suppressInputSync) return;
    const num = (input) => {
      const n = Number(input.value);
      return Number.isFinite(n) ? n : 0;
    };
    const placement = {
      position: { x: num(this.posInputs[0]), y: num(this.posInputs[1]), z: num(this.posInputs[2]) },
      rotation: {
        x: num(this.rotInputs[0]) * DEG2RAD,
        y: num(this.rotInputs[1]) * DEG2RAD,
        z: num(this.rotInputs[2]) * DEG2RAD,
      },
      scale: { x: num(this.scaleInputs[0]), y: num(this.scaleInputs[1]), z: num(this.scaleInputs[2]) },
      eyeSize: num(this.eyeSizeInput),
    };
    setEyePlacement(this.activeKey, placement);
    this._applyPlacementToAnimator(getEyePlacement(this.activeKey));
  }

  _onGizmoChanged() {
    const group = this._eyeAnimator?.group;
    if (!group) return;
    const placement = {
      position: { x: group.position.x, y: group.position.y, z: group.position.z },
      rotation: { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
      scale: { x: group.scale.x, y: group.scale.y, z: group.scale.z },
    };
    setEyePlacement(this.activeKey, placement);
    this._reflectPlacementToInputs(getEyePlacement(this.activeKey));
  }

  _resetActive() {
    resetEyePlacement(this.activeKey);
    this._reflectPlacementToInputs(getEyePlacement(this.activeKey));
    this._setStatus(`Reset ${this.activeKey} to defaults.`);
  }

  async _copyJson() {
    const data = exportEyePlacements();
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this._setStatus('Copied JSON to clipboard.');
    } catch {
      this._setStatus('Clipboard blocked — JSON in console.', true);
      // eslint-disable-next-line no-console
      console.log('[DressingRoom] eye placements:', text);
    }
  }

  _setStatus(text, isError = false) {
    this.status.textContent = text;
    this.status.style.color = isError ? '#ff8b8b' : '#9ee8b2';
  }

  async _capturePortrait() {
    if (!this._previewModel || !this._activeDef) {
      this._setStatus('Load a character before capturing a portrait.', true);
      return;
    }

    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevAspect = this.camera.aspect;
    const prevPos = this.camera.position.clone();
    const prevQuat = this.camera.quaternion.clone();
    const prevTarget = this._orbit?.target.clone() ?? null;
    const prevBackground = this.scene.background;
    const prevClearAlpha = this.renderer.getClearAlpha();
    const prevGridVisible = this._gridHelper?.visible ?? false;
    const prevGizmoVisible = this._transformControlsHelper?.visible ?? false;

    try {
      if (this._gridHelper) this._gridHelper.visible = false;
      if (this._transformControlsHelper) this._transformControlsHelper.visible = false;
      this.scene.background = null;
      this.renderer.setClearColor('#000000', 0);
      this.renderer.setSize(PORTRAIT_CAPTURE_WIDTH, PORTRAIT_CAPTURE_HEIGHT, false);
      this._framePortraitCamera(PORTRAIT_CAPTURE_WIDTH, PORTRAIT_CAPTURE_HEIGHT);
      this._orbit?.update();
      this._mixer?.update(0);
      this._eyeAnimator?.update(0);
      this.renderer.render(this.scene, this.camera);

      const blob = await new Promise((resolve, reject) => {
        this.canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error('canvas export returned empty data'));
        }, 'image/png');
      });
      const safeKey = String(this.activeKey || 'portrait').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeKey}-portrait.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this._setStatus(`Saved ${safeKey}-portrait.png`);
    } finally {
      if (this._gridHelper) this._gridHelper.visible = prevGridVisible;
      if (this._transformControlsHelper) this._transformControlsHelper.visible = prevGizmoVisible;
      this.scene.background = prevBackground;
      this.renderer.setClearColor('#2e333a', prevClearAlpha);
      this.renderer.setSize(prevSize.x, prevSize.y, false);
      this.camera.aspect = prevAspect;
      this.camera.position.copy(prevPos);
      this.camera.quaternion.copy(prevQuat);
      this.camera.updateProjectionMatrix();
      if (this._orbit && prevTarget) {
        this._orbit.target.copy(prevTarget);
        this._orbit.update();
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  _startLoop() {
    if (this._raf) return;
    const tick = (timeMs) => {
      this._raf = requestAnimationFrame(tick);
      const dt = this._lastTime ? (timeMs - this._lastTime) * 0.001 : 1 / 60;
      this._lastTime = timeMs;
      this._orbit?.update();
      this._mixer?.update(dt);
      this._eyeAnimator?.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this._lastTime = 0;
    this._raf = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}
