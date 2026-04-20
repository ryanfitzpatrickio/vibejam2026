import * as THREE from 'three';
import { EMOTES } from '../emote/EmoteManager.js';

/**
 * Absolute URL for files in `public/`, safe with `base: './'` and non-root page paths.
 * (Plain `./assets/...` fetch strings resolve against the *current* path, not the app root.)
 */
function publicAssetFetchUrl(relativePath) {
  const encoded = String(relativePath)
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const base = import.meta.env.BASE_URL || '/';
  const root = new URL(base, window.location.href);
  return new URL(encoded, root).href;
}

/**
 * Candidate path stems under `public/` (no extension). Order matters.
 * Static hosts are case-sensitive — try lowercase first, then common variants.
 */
const AMBIENT_CALM_STEMS = [
  'assets/cartoon saturn',
  'assets/Cartoon Saturn',
  'assets/cartoonsaturn',
  'assets/CartoonSaturn',
];
const AMBIENT_CHASE_STEMS = [
  'assets/corn dog alarm',
  'assets/Corn Dog Alarm',
  'assets/corn-dog-alarm',
  'assets/Corn-Dog-Alarm',
  'assets/corndogalarm',
];
/** Prefer .mp3 when `public/assets` ships mp3 without running `optimize-ambient-audio` (m4a). */
const AMBIENT_FORMATS = ['.mp3', '.m4a', '.ogg', '.wav'];
/** Crossfade responsiveness (higher = quicker transitions). */
const AMBIENT_CROSSFADE_RATE = 2.85;
const AMBIENT_TRACK_GAIN = 0.92;

const MOVE_LOOP_STEMS = ['assets/run', 'assets/Run'];
/** `wallrun` first matches `public/assets/wallrun.mp3`; space variants match optimize-ambient-audio `wall run.m4a`. */
const WALL_RUN_STEMS = ['assets/wallrun', 'assets/WallRun', 'assets/wall run', 'assets/Wall Run'];
const JUMP_SFX_STEMS = ['assets/jump', 'assets/Jump'];
const JUMP_SFX_GAIN = 0.62;
const GRAB_SFX_STEMS = ['assets/grab', 'assets/Grab'];
const SMACK_SFX_STEMS = ['assets/smack', 'assets/Smack'];
const CAT_SFX_STEMS = [['assets/cat1', 'assets/Cat1'], ['assets/cat2', 'assets/Cat2']];
const VACUUM_SFX_STEMS = ['assets/vacuum', 'assets/Vacuum'];
const VACUUM2_SFX_STEMS = ['assets/vacuum2', 'assets/Vacuum2'];
const MEME_SFX_STEMS = ['assets/meme', 'assets/Meme', 'assets/MEME'];
const MOVE_LOOP_FADE_RATE = 5.5;
const MOVE_LOOP_GAIN = 0.55;
const WALL_RUN_GAIN = 0.5;
/** Sprint uses the same run loop, sped up (1 = walk/move clip at normal pitch). */
const RUN_SPRINT_PLAYBACK_RATE = 1.32;

function emoteAssetStems(soundName) {
  const base = String(soundName || '').trim();
  if (!base) return [];
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  return base === cap ? [`assets/${base}`] : [`assets/${base}`, `assets/${cap}`];
}

/** Human-adversary emote SFX variants. Files live in `public/assets/*.mp3`. */
const HUMAN_EMOTE_VARIANTS = {
  wave: ['wave2'],
  dance: ['dance2'],
  laugh: ['laugh2', 'laugh3'],
  cry: ['cry2'],
  angry: ['angry2'],
  love: ['love2'],
  thumbsup: ['thumbsup2'],
  scream: ['scream2'],
};

function pickHumanEmoteSound(soundName) {
  const variants = HUMAN_EMOTE_VARIANTS[soundName];
  if (!variants || variants.length === 0) return soundName;
  return variants[Math.floor(Math.random() * variants.length)];
}

function bufferLooksLikeMarkup(arrayBuffer) {
  const n = Math.min(96, arrayBuffer.byteLength);
  if (n < 1) return true;
  const head = new Uint8Array(arrayBuffer, 0, n);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head).trimStart();
  return text.startsWith('<!') || text.startsWith('<html') || text.startsWith('<?xml');
}

/**
 * Procedural audio synthesis functions
 */
const SoundSynth = {
  /**
   * Generate a short squeak sound
   */
  squeak(audioContext, duration = 0.1, pitch = 800) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.7, audioContext.currentTime + duration);

    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + duration);

    return gain;
  },

  /**
   * Generate a footstep sound (brief noise burst)
   */
  footstep(audioContext, duration = 0.05) {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    // Brown noise (walking sound)
    let last = 0;
    for (let i = 0; i < buffer.length; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (last + white * 0.02) / 1.02;
      last = data[i];
    }

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();

    source.buffer = buffer;
    gain.gain.setValueAtTime(0.2, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    source.connect(gain);
    gain.connect(audioContext.destination);

    source.start(audioContext.currentTime);
    source.stop(audioContext.currentTime + duration);

    return gain;
  },

  /**
   * Generate a beep/ping sound
   */
  beep(audioContext, frequency = 600, duration = 0.1) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, audioContext.currentTime);

    gain.gain.setValueAtTime(0.2, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + duration);

    return gain;
  },

  /**
   * Generate a crash/impact sound
   */
  crash(audioContext, duration = 0.3) {
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    // Noise burst with pitch change
    for (let i = 0; i < buffer.length; i++) {
      const t = i / buffer.length;
      const noise = Math.random() * 2 - 1;
      const envelope = Math.exp(-t * 5);
      data[i] = noise * envelope;
    }

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2000, audioContext.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + duration);

    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    source.start(audioContext.currentTime);
    source.stop(audioContext.currentTime + duration);

    return gain;
  },

  /**
   * Generate death sound (pitch drop)
   */
  deathSound(audioContext, duration = 0.4) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + duration);

    gain.gain.setValueAtTime(0.2, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + duration);

    return gain;
  },

  /**
   * Generate a sparkle/pickup sound
   */
  sparkle(audioContext, duration = 0.15) {
    const now = audioContext.currentTime;
    const notes = [800, 1200, 1600];
    let maxGain = null;

    notes.forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + duration);

      const delay = (i * duration) / 3;
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.15, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start(now + delay);
      osc.stop(now + duration);

      if (!maxGain) maxGain = gain;
    });

    return maxGain;
  },

  emoteWave(audioContext) {
    const now = audioContext.currentTime;
    const notes = [500, 700, 500, 700];
    let maxGain = null;
    notes.forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      const delay = i * 0.12;
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.1);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.1);
      if (!maxGain) maxGain = gain;
    });
    return maxGain;
  },

  emoteDance(audioContext) {
    const now = audioContext.currentTime;
    const bass = [200, 250, 300, 250, 200];
    let maxGain = null;
    bass.forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'triangle';
      const delay = i * 0.15;
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.2, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.12);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.12);
      if (!maxGain) maxGain = gain;
    });
    return maxGain;
  },

  emoteLaugh(audioContext) {
    const now = audioContext.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      const delay = i * 0.1;
      const freq = 600 + (i % 2) * 200;
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.15, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.08);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.08);
    }
    return null;
  },

  emoteCry(audioContext) {
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.6);
    osc.frequency.exponentialRampToValueAtTime(350, now + 1.0);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.8);
    return gain;
  },

  emoteAngry(audioContext) {
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.2);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.5);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.5);
    return gain;
  },

  emoteLove(audioContext) {
    const now = audioContext.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      const delay = i * 0.15;
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.2, now + delay + 0.2);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.25);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.25);
    });
    return null;
  },

  emoteThumbsup(audioContext) {
    const now = audioContext.currentTime;
    [400, 600, 800].forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      const delay = i * 0.08;
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.15, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.15);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.15);
    });
    return null;
  },

  emoteScream(audioContext) {
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.15);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.4);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.5);
    return gain;
  },

  /** Cartoon slap — short noise burst with a sharp attack. */
  smack(audioContext) {
    const now = audioContext.currentTime;
    const dur = 0.18;
    const buf = audioContext.createBuffer(1, audioContext.sampleRate * dur, audioContext.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < buf.length; i++) {
      const t = i / buf.length;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 12);
    }
    const src = audioContext.createBufferSource();
    src.buffer = buf;
    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.8;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    src.start(now);
    src.stop(now + dur);
    return gain;
  },

  /** Cartoon grab — quick rising chirp. */
  grab(audioContext) {
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.15);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.15);
    return gain;
  },
};

/**
 * AudioManager: handles spatial audio, effects, and dynamic music
 */
export class AudioManager {
  constructor() {
    if (AudioManager.instance) {
      return AudioManager.instance;
    }

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // One shared context: THREE.AudioListener() otherwise creates a second AudioContext that may stay suspended.
    THREE.AudioContext.setContext(this.audioContext);
    this.listener = new THREE.AudioListener();
    /** Set by {@link attachListenerToCamera}; enables auto position/orientation tracking. */
    this._listenerAttached = false;
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);
    this.masterGain.gain.value = 0.5; // Default volume

    this.musicContext = this.audioContext.createGain();
    this.musicContext.connect(this.masterGain);
    this._musicVolume = 0.3;
    this._musicMuted = false;
    this.musicContext.gain.value = this._musicVolume;

    this.sfxContext = this.audioContext.createGain();
    this.sfxContext.connect(this.masterGain);
    this._sfxVolume = 0.4;
    this._sfxMuted = false;
    this.sfxContext.gain.value = this._sfxVolume;

    // Default THREE.AudioListener wiring is listener.gain -> destination, which skips this graph.
    // PositionalAudio (roomba vacuum) feeds listener.gain, so route it through the SFX bus so it
    // respects SFX volume, mute, and master — same as one-shot spatial SFX via _createSpatialPanner.
    this.listener.gain.disconnect();
    this.listener.gain.connect(this.sfxContext);

    /** Footstep / movement loop (not spatial SFX); own level into master. */
    this.movementLoopBus = this.audioContext.createGain();
    this.movementLoopBus.connect(this.masterGain);
    this._movementLoopVolume = 0.85;
    this.movementLoopBus.gain.value = this._movementLoopVolume;

    // Music system
    this.musicOscillators = [];
    this.isPlayingMusic = false;
    this.musicState = 'ambient'; // ambient, tense, triumph
    this.musicTime = 0;

    /** Looped MP3 ambient bed (calm vs chase), crossfaded in `update`. */
    this._ambientDecodePromise = null;
    this._ambientBuffers = null;
    this._ambientCalmGain = null;
    this._ambientChaseGain = null;
    this._ambientCalmSource = null;
    this._ambientChaseSource = null;
    this._ambientBedActive = false;
    this._ambientBlend = 0; // 0 = calm only, 1 = chase only
    this._ambientChaseTarget = 0;
    this._ambientBedStarting = null;

    /** Looped locomotion: run (rate-boosted when sprinting) + wall-run; `undefined` = load not finished. */
    this._movementRunBuffer = undefined;
    this._movementWallRunBuffer = undefined;
    this._movementDecodePromise = null;
    this._movementRunGain = null;
    this._movementRunSource = null;
    this._movementWallRunGain = null;
    this._movementWallRunSource = null;
    this._movementLoopTarget = 0;
    this._movementLoopBlend = 0;
    this._movementSprintTarget = 0;
    this._movementSprintBlend = 0;
    this._movementWallRunTarget = 0;
    this._movementWallRunBlend = 0;

    // Spatial sounds
    this.spatialSounds = [];

    /** @type {Map<string, AudioBuffer|null>} */
    this._emoteBufferCache = new Map();
    /** @type {Map<string, Promise<AudioBuffer|null>>} */
    this._emoteBufferInflight = new Map();

    /** One-shot jump SFX; `undefined` = not loaded yet. */
    this._jumpBuffer = undefined;
    this._jumpLoadPromise = null;

    /** General SFX buffer cache (keyed by name, e.g. 'grab', 'smack', 'cat1'). */
    this._sfxBuffers = new Map();
    this._sfxLoadPromises = new Map();

    /** Procedural loop: Roomba motor + vacuum hiss (spatialized via PositionalAudio or PannerNode). */
    this._roombaMotorBuilt = false;
    this._roombaMotorGain = null;
    this._roombaMotorPanner = null;
    this._roombaPositionalAudio = null;
    this._roombaMesh = null;
    this._roombaHumOsc = null;
    this._roombaNoiseSrc = null;

    AudioManager.instance = this;
  }

  /**
   * Resume audio context if needed
   */
  async resume() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Attach the THREE.AudioListener to a camera so Three.js automatically updates
   * listener position and orientation each frame. Call once after camera creation.
   * @param {THREE.Camera} camera
   */
  attachListenerToCamera(camera) {
    if (this._listenerAttached) return;
    camera.add(this.listener);
    this._listenerAttached = true;
  }

  /**
   * Create a PannerNode positioned at `worldPos` for true 3D spatialization.
   * Uses inverse-distance model with the same max range as the old manual calc.
   * @param {THREE.Vector3} worldPos
   * @returns {PannerNode}
   */
  _createSpatialPanner(worldPos) {
    const panner = this.audioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = 20;
    panner.rolloffFactor = 1;
    panner.setPosition(worldPos.x, worldPos.y, worldPos.z);
    panner.connect(this.sfxContext);
    return panner;
  }

  /**
   * Play sound effect at world position
   */
  playSoundAtPosition(type, position) {
    if (this._sfxMuted) return;

    const panner = this._createSpatialPanner(position);

    if (type === 'jump') {
      void this._playJumpSfx(panner);
      return;
    }

    // File-based SFX with synth fallback
    if (type === 'grab') {
      void this._playSfxBufferAtPanner('grab', GRAB_SFX_STEMS, panner).then((ok) => {
        if (!ok) SoundSynth.grab(this.audioContext)?.connect(panner);
      });
      return;
    }
    if (type === 'smack') {
      void this._playSfxBufferAtPanner('smack', SMACK_SFX_STEMS, panner).then((ok) => {
        if (!ok) SoundSynth.smack(this.audioContext)?.connect(panner);
      });
      return;
    }
    if (type === 'meme') {
      void this._playSfxBufferAtPanner('meme', MEME_SFX_STEMS, panner);
      return;
    }
    if (type === 'cat') {
      const idx = Math.random() < 0.5 ? 0 : 1;
      const name = `cat${idx + 1}`;
      void this._playSfxBufferAtPanner(name, CAT_SFX_STEMS[idx], panner).then((ok) => {
        if (!ok) SoundSynth.crash(this.audioContext)?.connect(panner);
      });
      return;
    }

    let sound;
    switch (type) {
      case 'squeak':
        sound = SoundSynth.squeak(this.audioContext, 0.1, 600 + Math.random() * 200);
        break;
      case 'footstep':
        sound = SoundSynth.footstep(this.audioContext, 0.05);
        break;
      case 'crash':
        sound = SoundSynth.crash(this.audioContext, 0.3);
        break;
      case 'pickup':
        sound = SoundSynth.sparkle(this.audioContext, 0.15);
        break;
      case 'death':
        sound = SoundSynth.deathSound(this.audioContext, 0.4);
        break;
      case 'beep':
        sound = SoundSynth.beep(this.audioContext, 600, 0.1);
        break;
      default:
        sound = SoundSynth.beep(this.audioContext, 500, 0.08);
    }

    sound.connect(panner);

    // Track for one debug frame, then auto-prune. Without this prune the
    // array grew unbounded for the life of the tab — every squeak/footstep/
    // crash kept its source + gain + panner alive forever.
    const entry = { sound, panner, position, type, startedAt: this.audioContext.currentTime };
    this.spatialSounds.push(entry);
    const lifetime = 2.0; // seconds; longest synthed SFX is ~0.8s, padding for safety
    setTimeout(() => {
      const idx = this.spatialSounds.indexOf(entry);
      if (idx !== -1) this.spatialSounds.splice(idx, 1);
      try { sound.disconnect(); } catch { /* already gone */ }
      try { panner.disconnect(); } catch { /* already gone */ }
    }, Math.ceil(lifetime * 1000));
  }

  playEmote(soundName, position, opts = {}) {
    if (this._sfxMuted) return;

    const panner = this._createSpatialPanner(position);
    const resolved = opts.human ? pickHumanEmoteSound(soundName) : soundName;
    void this._playEmoteClipOrSynth(resolved, panner);
  }

  /**
   * Decode `public/assets/{sound}.{m4a|mp3|…}` once; used by {@link playEmote}.
   */
  prefetchEmoteBuffers() {
    const seen = new Set();
    for (const e of EMOTES) {
      if (seen.has(e.sound)) continue;
      seen.add(e.sound);
      void this._getEmoteBuffer(e.sound);
      for (const variant of HUMAN_EMOTE_VARIANTS[e.sound] ?? []) {
        if (seen.has(variant)) continue;
        seen.add(variant);
        void this._getEmoteBuffer(variant);
      }
    }
  }

  /** Pre-decode `public/assets/jump.{m4a|mp3|…}` after a user gesture. */
  prefetchJumpSfx() {
    void this._loadJumpBufferOnce();
  }

  /**
   * Load a named SFX buffer from the given stems list. Returns cached result on repeat calls.
   * @param {string} name - cache key (e.g. 'grab', 'smack', 'cat1')
   * @param {string[]} stems - asset stem list to try
   * @returns {Promise<AudioBuffer|null>}
   */
  async _loadSfxBuffer(name, stems) {
    if (this._sfxBuffers.has(name)) return this._sfxBuffers.get(name);
    if (this._sfxLoadPromises.has(name)) return this._sfxLoadPromises.get(name);
    const promise = (async () => {
      try {
        const buf = await this._tryFetchDecodeAmbientStemList(stems);
        this._sfxBuffers.set(name, buf);
        return buf;
      } catch {
        this._sfxBuffers.set(name, null);
        return null;
      } finally {
        this._sfxLoadPromises.delete(name);
      }
    })();
    this._sfxLoadPromises.set(name, promise);
    return promise;
  }

  /** Pre-decode grab, smack, cat, and vacuum SFX after a user gesture. */
  prefetchInteractionSfx() {
    void this._loadSfxBuffer('grab', GRAB_SFX_STEMS);
    void this._loadSfxBuffer('smack', SMACK_SFX_STEMS);
    for (let i = 0; i < CAT_SFX_STEMS.length; i++) {
      void this._loadSfxBuffer(`cat${i + 1}`, CAT_SFX_STEMS[i]);
    }
    void this._loadSfxBuffer('vacuum', VACUUM_SFX_STEMS);
    void this._loadSfxBuffer('vacuum2', VACUUM2_SFX_STEMS);
    void this._loadSfxBuffer('meme', MEME_SFX_STEMS);
  }

  /**
   * Play a file-based SFX at a position. Falls back to synth if file not loaded.
   * @param {string} name - buffer cache key
   * @param {string[]} stems - asset stems to try loading
   * @param {PannerNode} panner
   * @param {number} [gain=1]
   */
  async _playSfxBufferAtPanner(name, stems, panner, gain = 1) {
    let buf = this._sfxBuffers.get(name);
    if (buf === undefined) buf = await this._loadSfxBuffer(name, stems);
    if (!buf) return false;
    await this.audioContext.resume();
    const g = this.audioContext.createGain();
    g.gain.value = gain;
    const src = this.audioContext.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    g.connect(panner);
    src.onended = () => {
      try { src.disconnect(); } catch { /* already gone */ }
      try { g.disconnect(); } catch { /* already gone */ }
      try { panner.disconnect(); } catch { /* already gone */ }
    };
    src.start();
    return true;
  }

  async _loadJumpBufferOnce() {
    if (this._jumpBuffer !== undefined) return this._jumpBuffer;
    if (this._jumpLoadPromise) return this._jumpLoadPromise;
    this._jumpLoadPromise = (async () => {
      try {
        const buf = await this._tryFetchDecodeAmbientStemList(JUMP_SFX_STEMS);
        this._jumpBuffer = buf;
        if (!buf) {
          console.warn(
            '[audio] Missing jump SFX; add public/assets/jump.{m4a|mp3} or assets/source/audio/jump.* for prebuild.',
          );
        }
        return buf;
      } catch (e) {
        console.warn('[audio] Jump SFX failed to load:', e?.message || e);
        this._jumpBuffer = null;
        return null;
      } finally {
        this._jumpLoadPromise = null;
      }
    })();
    return this._jumpLoadPromise;
  }

  async _playJumpSfx(panner) {
    await this.audioContext.resume();
    const buf = await this._loadJumpBufferOnce();
    if (buf) {
      const gain = this.audioContext.createGain();
      gain.gain.value = JUMP_SFX_GAIN;
      const src = this.audioContext.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      gain.connect(panner);
      src.onended = () => {
        try { src.disconnect(); } catch { /* already gone */ }
        try { gain.disconnect(); } catch { /* already gone */ }
        try { panner.disconnect(); } catch { /* already gone */ }
      };
      src.start();
      return;
    }
    const dur = 0.07;
    const now = this.audioContext.currentTime;
    const osc = this.audioContext.createOscillator();
    const g = this.audioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(780, now);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + dur);
    osc.connect(g);
    g.connect(panner);
    osc.start(now);
    osc.stop(now + dur);
  }

  async _getEmoteBuffer(soundName) {
    if (this._emoteBufferCache.has(soundName)) {
      return this._emoteBufferCache.get(soundName);
    }
    if (this._emoteBufferInflight.has(soundName)) {
      return this._emoteBufferInflight.get(soundName);
    }
    const promise = (async () => {
      try {
        const stems = emoteAssetStems(soundName);
        const buf = stems.length
          ? await this._tryFetchDecodeAmbientStemList(stems)
          : null;
        this._emoteBufferCache.set(soundName, buf);
        return buf;
      } catch {
        this._emoteBufferCache.set(soundName, null);
        return null;
      } finally {
        this._emoteBufferInflight.delete(soundName);
      }
    })();
    this._emoteBufferInflight.set(soundName, promise);
    return promise;
  }

  async _playEmoteClipOrSynth(soundName, panner) {
    const buf = await this._getEmoteBuffer(soundName);
    if (buf) {
      void this.audioContext.resume();
      const src = this.audioContext.createBufferSource();
      src.buffer = buf;
      src.connect(panner);
      src.onended = () => {
        try { src.disconnect(); } catch { /* already gone */ }
        try { panner.disconnect(); } catch { /* already gone */ }
      };
      src.start();
      return;
    }

    const synthFn = {
      wave: 'emoteWave',
      dance: 'emoteDance',
      laugh: 'emoteLaugh',
      cry: 'emoteCry',
      angry: 'emoteAngry',
      love: 'emoteLove',
      thumbsup: 'emoteThumbsup',
      scream: 'emoteScream',
    }[soundName];

    const sound = synthFn ? SoundSynth[synthFn]?.(this.audioContext) : null;
    if (sound) {
      sound.connect(panner);
    }
  }

  /**
   * Decode and start looping ambient tracks (calm + chase), crossfaded via {@link setAmbientChaseTarget}.
   * Safe to call multiple times; starts once.
   */
  async startAmbientBed() {
    if (this._ambientBedActive) return;
    if (this._ambientBedStarting) return this._ambientBedStarting;

    this._ambientBedStarting = (async () => {
      if (!this._ambientDecodePromise) {
        this._ambientDecodePromise = this._loadAmbientBufferPair();
      }

      let buffers;
      try {
        buffers = await this._ambientDecodePromise;
      } catch (e) {
        console.warn(
          '[audio] Ambient bed failed to load:',
          e?.message || e,
          '(add public/assets/cartoon saturn.{m4a|mp3} and corn dog alarm.{m4a|mp3}, or run npm run prebuild with masters in assets/source/audio/)',
        );
        this._ambientDecodePromise = null;
        return;
      }

      if (this._ambientBedActive) return;

      const calmGain = this.audioContext.createGain();
      const chaseGain = this.audioContext.createGain();
      calmGain.connect(this.musicContext);
      chaseGain.connect(this.musicContext);

      const calmSrc = this.audioContext.createBufferSource();
      const chaseSrc = this.audioContext.createBufferSource();
      calmSrc.buffer = buffers.calm;
      chaseSrc.buffer = buffers.chase;
      calmSrc.loop = true;
      chaseSrc.loop = true;
      calmSrc.connect(calmGain);
      chaseSrc.connect(chaseGain);

      const now = this.audioContext.currentTime;
      calmSrc.start(now);
      chaseSrc.start(now);
      await this.audioContext.resume();

      this._ambientBuffers = buffers;
      this._ambientCalmGain = calmGain;
      this._ambientChaseGain = chaseGain;
      this._ambientCalmSource = calmSrc;
      this._ambientChaseSource = chaseSrc;
      this._ambientBedActive = true;
      this._ambientBlend = this._ambientChaseTarget;
      this._applyAmbientGains();
      if (import.meta.env.DEV) {
        console.log('[audio] Ambient bed playing (Web Audio). Context:', this.audioContext.state);
      }
      this.prefetchMovementLoopBuffer();
      this.prefetchJumpSfx();
      this.prefetchEmoteBuffers();
      this.prefetchInteractionSfx();
    })();

    try {
      await this._ambientBedStarting;
    } finally {
      this._ambientBedStarting = null;
    }
  }

  async _loadAmbientBufferPair() {
    const [calmBuf, chaseBuf] = await Promise.all([
      this._tryFetchDecodeAmbientStemList(AMBIENT_CALM_STEMS),
      this._tryFetchDecodeAmbientStemList(AMBIENT_CHASE_STEMS),
    ]);
    if (!calmBuf && !chaseBuf) {
      throw new Error(
        'No decodable ambient audio under public/assets/ (expected cartoon saturn / corn dog alarm, .m4a or .mp3)',
      );
    }
    let calm = calmBuf;
    let chase = chaseBuf;
    if (!calm) {
      console.warn('[audio] Missing calm bed (cartoon saturn); using chase track for both layers.');
      calm = chase;
    }
    if (!chase) {
      console.warn(
        '[audio] Missing chase bed (corn dog alarm); using calm track for both — add public/assets/corn dog alarm.{m4a|mp3} for the alarm crossfade.',
      );
      chase = calm;
    }
    return { calm, chase };
  }

  async _tryFetchDecodeAmbientStemList(stems) {
    for (const stem of stems) {
      const buf = await this._tryFetchDecodeAmbientStem(stem);
      if (buf) return buf;
    }
    return null;
  }

  /**
   * Try each extension; returns null if nothing decodes (missing file / HTML shell / bad codec).
   */
  async _tryFetchDecodeAmbientStem(stemRelative) {
    let lastError = null;
    for (const ext of AMBIENT_FORMATS) {
      const url = publicAssetFetchUrl(`${stemRelative}${ext}`);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} for ${url}`);
          continue;
        }
        const data = await res.arrayBuffer();
        if (data.byteLength < 256) {
          lastError = new Error(`Too small (${data.byteLength} B): ${url}`);
          continue;
        }
        if (bufferLooksLikeMarkup(data)) {
          lastError = new Error(`Not audio (HTML/text response): ${url}`);
          continue;
        }
        const copy = data.slice(0);
        return await this.audioContext.decodeAudioData(copy);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    return null;
  }

  /**
   * When true, crossfades toward the chase/alarm track (local player is the cat's hunt target).
   */
  setAmbientChaseTarget(active) {
    this._ambientChaseTarget = active ? 1 : 0;
  }

  /**
   * Begin loading `run` and `wall run` loops after user gesture (with ambient); safe to call repeatedly.
   */
  prefetchMovementLoopBuffer() {
    if (
      this._movementRunBuffer !== undefined &&
      this._movementWallRunBuffer !== undefined
    ) {
      return;
    }
    if (this._movementDecodePromise) return;
    this._movementDecodePromise = this._loadMovementLoopBuffersOnce();
  }

  /**
   * Fade looped movement audio in/out (local player walking or running on the ground).
   */
  setMovementLoopTarget(active) {
    this._movementLoopTarget = active ? 1 : 0;
    if (active) this.prefetchMovementLoopBuffer();
    if (!active) this._movementSprintTarget = 0;
  }

  /**
   * While {@link setMovementLoopTarget} is true, speeds up the run loop (same clip, higher playbackRate).
   */
  setMovementSprintTarget(active) {
    this._movementSprintTarget = active ? 1 : 0;
    if (active) this.prefetchMovementLoopBuffer();
  }

  /**
   * Looped audio while wall-holding (jump on wall) and moving along the wall.
   */
  setMovementWallRunTarget(active) {
    this._movementWallRunTarget = active ? 1 : 0;
    if (active) this.prefetchMovementLoopBuffer();
  }

  async _loadMovementLoopBuffersOnce() {
    try {
      const [runBuf, wallRunBuf] = await Promise.all([
        this._tryFetchDecodeAmbientStemList(MOVE_LOOP_STEMS),
        this._tryFetchDecodeAmbientStemList(WALL_RUN_STEMS),
      ]);
      this._movementRunBuffer = runBuf;
      this._movementWallRunBuffer = wallRunBuf;
      if (!runBuf) {
        console.warn(
          '[audio] Missing movement loop (run); add public/assets/run.{m4a|mp3} or a master in assets/source/audio/ for prebuild.',
        );
      }
      if (!wallRunBuf) {
        console.warn(
          '[audio] Missing wall run loop; add public/assets/wall run.{m4a|mp3} or assets/source/audio/wall run.* for prebuild.',
        );
      }
    } catch (e) {
      this._movementRunBuffer = this._movementRunBuffer ?? null;
      this._movementWallRunBuffer = this._movementWallRunBuffer ?? null;
      console.warn('[audio] Movement loop failed to load:', e?.message || e);
    } finally {
      this._movementDecodePromise = null;
    }
  }

  _startMovementRunSource() {
    if (!this._movementRunBuffer || this._movementRunSource) return;
    const gain = this.audioContext.createGain();
    gain.connect(this.movementLoopBus);
    const src = this.audioContext.createBufferSource();
    src.buffer = this._movementRunBuffer;
    src.loop = true;
    src.playbackRate.value = 1;
    src.connect(gain);
    const now = this.audioContext.currentTime;
    gain.gain.setValueAtTime(0, now);
    src.start(now);
    void this.audioContext.resume();
    this._movementRunGain = gain;
    this._movementRunSource = src;
    if (import.meta.env.DEV) {
      console.log('[audio] Run loop started. Context:', this.audioContext.state);
    }
  }

  _stopMovementRunSource() {
    if (this._movementRunSource) {
      try {
        this._movementRunSource.stop();
      } catch {
        /* already stopped */
      }
    }
    this._movementRunSource = null;
    this._movementRunGain?.disconnect();
    this._movementRunGain = null;
  }

  _startMovementWallRunSource() {
    if (!this._movementWallRunBuffer || this._movementWallRunSource) return;
    const gain = this.audioContext.createGain();
    gain.connect(this.movementLoopBus);
    const src = this.audioContext.createBufferSource();
    src.buffer = this._movementWallRunBuffer;
    src.loop = true;
    src.connect(gain);
    const now = this.audioContext.currentTime;
    gain.gain.setValueAtTime(0, now);
    src.start(now);
    void this.audioContext.resume();
    this._movementWallRunGain = gain;
    this._movementWallRunSource = src;
  }

  _stopMovementWallRunSource() {
    if (this._movementWallRunSource) {
      try {
        this._movementWallRunSource.stop();
      } catch {
        /* already stopped */
      }
    }
    this._movementWallRunSource = null;
    this._movementWallRunGain?.disconnect();
    this._movementWallRunGain = null;
  }

  _tickMovementLoopFade(deltaSeconds) {
    const target = this._movementLoopTarget;
    const t = 1 - Math.exp(-MOVE_LOOP_FADE_RATE * deltaSeconds);
    this._movementLoopBlend += (target - this._movementLoopBlend) * t;
    if (Math.abs(this._movementLoopBlend - target) < 0.002) {
      this._movementLoopBlend = target;
    }

    const st = this._movementSprintTarget;
    this._movementSprintBlend += (st - this._movementSprintBlend) * t;
    if (Math.abs(this._movementSprintBlend - st) < 0.002) {
      this._movementSprintBlend = st;
    }

    const wt = this._movementWallRunTarget;
    this._movementWallRunBlend += (wt - this._movementWallRunBlend) * t;
    if (Math.abs(this._movementWallRunBlend - wt) < 0.002) {
      this._movementWallRunBlend = wt;
    }

    const hasRun = !!this._movementRunBuffer;
    const wantPlay = this._movementLoopTarget > 0.5 && hasRun;

    if (wantPlay && !this._movementRunSource) this._startMovementRunSource();

    const m = this._movementLoopBlend;
    const w = this._movementSprintBlend;

    if (this._movementRunGain) {
      this._movementRunGain.gain.value = hasRun ? m * MOVE_LOOP_GAIN : 0;
    }
    if (this._movementRunSource) {
      const rate = 1 + w * (RUN_SPRINT_PLAYBACK_RATE - 1);
      this._movementRunSource.playbackRate.value = rate;
    }

    const hasWallRun = !!this._movementWallRunBuffer;
    const wantWallRun = this._movementWallRunTarget > 0.5 && hasWallRun;
    if (wantWallRun && !this._movementWallRunSource) this._startMovementWallRunSource();
    if (this._movementWallRunGain) {
      this._movementWallRunGain.gain.value = this._movementWallRunBlend * WALL_RUN_GAIN;
    }

    if (this._movementLoopBlend < 0.03 && target < 0.5) {
      this._stopMovementRunSource();
    }
    if (this._movementWallRunBlend < 0.03 && wt < 0.5) {
      this._stopMovementWallRunSource();
    }
  }

  /**
   * Stop movement loop (session teardown).
   */
  stopMovementLoop() {
    this._stopMovementRunSource();
    this._stopMovementWallRunSource();
    this._movementLoopTarget = 0;
    this._movementLoopBlend = 0;
    this._movementSprintTarget = 0;
    this._movementSprintBlend = 0;
    this._movementWallRunTarget = 0;
    this._movementWallRunBlend = 0;
  }

  _applyAmbientGains() {
    if (!this._ambientCalmGain || !this._ambientChaseGain) return;
    const w = this._ambientBlend;
    const duck = (this._ambientDuckForIntermission || this._ambientDuckForHero || this._musicOverrideExtract) ? 0 : 1;
    this._ambientCalmGain.gain.value = (1 - w) * AMBIENT_TRACK_GAIN * duck;
    this._ambientChaseGain.gain.value = w * AMBIENT_TRACK_GAIN * duck;
  }

  _applyMusicOverrideDucking() {
    const now = this.audioContext.currentTime;
    const heroDuck = (this._musicOverrideExtract || this._musicOverrideIntermission) ? 0 : 1;
    if (this._heroMusicGain) {
      this._heroMusicGain.gain.cancelScheduledValues(now);
      this._heroMusicGain.gain.setTargetAtTime(heroDuck, now, 0.2);
    }
    const interDuck = this._musicOverrideExtract ? 0 : 1;
    if (this._intermissionMusicGain) {
      this._intermissionMusicGain.gain.cancelScheduledValues(now);
      this._intermissionMusicGain.gain.setTargetAtTime(interDuck, now, 0.2);
    }
  }

  _tickAmbientCrossfade(deltaSeconds) {
    if (!this._ambientBedActive) return;
    const target = this._ambientChaseTarget;
    const t = 1 - Math.exp(-AMBIENT_CROSSFADE_RATE * deltaSeconds);
    this._ambientBlend += (target - this._ambientBlend) * t;
    if (Math.abs(this._ambientBlend - target) < 0.002) {
      this._ambientBlend = target;
    }
    this._applyAmbientGains();
  }

  /**
   * Stops decoded ambient loops (e.g. session teardown). Decoded buffers are kept for a possible restart.
   */
  stopAmbientBed() {
    for (const src of [this._ambientCalmSource, this._ambientChaseSource]) {
      if (!src) continue;
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this._ambientCalmSource = null;
    this._ambientChaseSource = null;
    this._ambientCalmGain?.disconnect();
    this._ambientChaseGain?.disconnect();
    this._ambientCalmGain = null;
    this._ambientChaseGain = null;
    this._ambientBedActive = false;
    this._ambientBlend = 0;
    this._ambientChaseTarget = 0;
  }

  /**
   * Start dynamic music playback
   */
  startMusic() {
    if (this.isPlayingMusic) return;

    this.isPlayingMusic = true;
    this.musicTime = 0;
    this.musicState = 'ambient';
    this.playAmbientMusic();
  }

  /**
   * Play ambient exploration music (calm, looping)
   */
  playAmbientMusic() {
    const now = this.audioContext.currentTime;
    const tempo = 0.5; // Slow, calm

    // Simple harmonic progression: C-Am-F-G
    const chords = [
      { freq: 130.81, duration: 2 }, // C3
      { freq: 110, duration: 2 }, // A2
      { freq: 174.61, duration: 2 }, // F3
      { freq: 196, duration: 2 }, // G3
    ];

    this.playMusicChords(chords, now);
  }

  /**
   * Increase music tension (faster tempo, higher pitch)
   */
  setMusicTense() {
    if (this.musicState === 'tense') return;

    this.musicState = 'tense';
    this.stopMusic();

    const now = this.audioContext.currentTime;
    const chords = [
      { freq: 164.81, duration: 0.8 }, // E3
      { freq: 110, duration: 0.8 }, // A2
      { freq: 196, duration: 0.8 }, // G3
      { freq: 220, duration: 0.8 }, // A3
    ];

    this.playMusicChords(chords, now);
  }

  /**
   * Play triumphant success stinger
   */
  playTriumph() {
    const now = this.audioContext.currentTime;
    this.stopMusic();
    this.musicState = 'triumph';

    // Triumphant chord
    const frequencies = [262, 330, 392, 523]; // C-E-G-C
    const duration = 0.8;

    frequencies.forEach((freq, i) => {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

      osc.connect(gain);
      gain.connect(this.musicContext);

      const delay = i * 0.1;
      osc.start(now + delay);
      osc.stop(now + duration);

      this.musicOscillators.push(osc);
    });
  }

  /**
   * Play chord progression
   */
  playMusicChords(chords, startTime) {
    const now = this.audioContext.currentTime;
    let currentTime = startTime || now;

    const playChord = (frequencies, duration) => {
      frequencies.forEach((freq) => {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, currentTime);

        gain.gain.setValueAtTime(0.1, currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, currentTime + duration);

        osc.connect(gain);
        gain.connect(this.musicContext);

        osc.start(currentTime);
        osc.stop(currentTime + duration);

        this.musicOscillators.push(osc);
      });
    };

    // Simple chord (root + 3rd + 5th)
    chords.forEach((chord) => {
      const root = chord.freq;
      const frequencies = [root, root * 1.25, root * 1.5];
      playChord(frequencies, chord.duration);
      currentTime += chord.duration;
    });

    // Loop music if still in ambient
    if (this.musicState === 'ambient') {
      setTimeout(() => {
        if (this.isPlayingMusic && this.musicState === 'ambient') {
          this.playAmbientMusic();
        }
      }, (currentTime - now) * 1000);
    }
  }

  /**
   * Stop all music
   */
  stopMusic() {
    this.musicOscillators.forEach((osc) => {
      try {
        osc.stop(this.audioContext.currentTime);
      } catch (e) {
        // Oscillator already stopped
      }
    });
    this.musicOscillators = [];
  }

  /**
   * Set master volume
   */
  setMasterVolume(value) {
    this.masterGain.gain.setTargetAtTime(Math.min(1, Math.max(0, value)), this.audioContext.currentTime, 0.01);
  }

  /**
   * Set music volume
   */
  setMusicVolume(value) {
    this._musicVolume = Math.min(1, Math.max(0, value));
    const target = this._musicMuted ? 0 : this._musicVolume;
    this.musicContext.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.01);
  }

  setMusicMuted(muted) {
    this._musicMuted = !!muted;
    const target = this._musicMuted ? 0 : this._musicVolume;
    this.musicContext.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.01);
  }

  isMusicMuted() {
    return this._musicMuted;
  }

  async _loadHeroMusicBuffer() {
    if (this._heroMusicBuffer !== undefined) return this._heroMusicBuffer;
    if (this._heroMusicLoading) return this._heroMusicLoading;
    this._heroMusicLoading = (async () => {
      const buf = await this._tryFetchDecodeAmbientStem('assets/Railroad Spitshine')
        ?? await this._tryFetchDecodeAmbientStem('assets/railroad spitshine');
      this._heroMusicBuffer = buf ?? null;
      return this._heroMusicBuffer;
    })();
    try {
      return await this._heroMusicLoading;
    } finally {
      this._heroMusicLoading = null;
    }
  }

  async startHeroMusic() {
    if (this._heroMusicSource) return;
    try {
      await this.audioContext.resume();
    } catch {}
    const buffer = await this._loadHeroMusicBuffer();
    if (!buffer) return;
    if (this._heroMusicSource) return; // another caller started it while we awaited
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicContext);
    const src = this.audioContext.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    const now = this.audioContext.currentTime;
    src.start(now);
    gain.gain.setTargetAtTime(1, now, 0.25);
    this._heroMusicSource = src;
    this._heroMusicGain = gain;
    this._ambientDuckForHero = true;
    this._applyAmbientGains?.();
    this._applyMusicOverrideDucking?.();
    this._applyAmbientGains?.();
  }

  async _loadIntermissionMusicBuffer() {
    if (this._intermissionMusicBuffer !== undefined) return this._intermissionMusicBuffer;
    if (this._intermissionMusicLoading) return this._intermissionMusicLoading;
    this._intermissionMusicLoading = (async () => {
      const buf = await this._tryFetchDecodeAmbientStem('assets/Pineapple Xylophone')
        ?? await this._tryFetchDecodeAmbientStem('assets/pineapple xylophone');
      this._intermissionMusicBuffer = buf ?? null;
      return this._intermissionMusicBuffer;
    })();
    try {
      return await this._intermissionMusicLoading;
    } finally {
      this._intermissionMusicLoading = null;
    }
  }

  async startIntermissionMusic() {
    if (this._intermissionMusicSource) return;
    try { await this.audioContext.resume(); } catch {}
    const buffer = await this._loadIntermissionMusicBuffer();
    if (!buffer) return;
    if (this._intermissionMusicSource) return;
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicContext);
    const src = this.audioContext.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    const now = this.audioContext.currentTime;
    src.start(now);
    gain.gain.setTargetAtTime(1, now, 0.3);
    this._intermissionMusicSource = src;
    this._intermissionMusicGain = gain;
    // Duck the regular ambient bed while intermission music plays.
    this._ambientDuckForIntermission = true;
    this._musicOverrideIntermission = true;
    this._applyAmbientGains?.();
    this._applyMusicOverrideDucking?.();
    this._applyAmbientGains?.();
  }

  stopIntermissionMusic() {
    const src = this._intermissionMusicSource;
    const gain = this._intermissionMusicGain;
    if (!src || !gain) {
      if (this._ambientDuckForIntermission) {
        this._ambientDuckForIntermission = false;
        this._applyAmbientGains?.();
      }
      return;
    }
    this._intermissionMusicSource = null;
    this._intermissionMusicGain = null;
    const now = this.audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, 0.4);
    const stopAt = now + 1.2;
    try { src.stop(stopAt); } catch {}
    setTimeout(() => {
      try { src.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    }, 1600);
    this._ambientDuckForIntermission = false;
    this._musicOverrideIntermission = false;
    this._applyAmbientGains?.();
    this._applyMusicOverrideDucking?.();
    this._applyAmbientGains?.();
  }

  async playExtractCountdown() {
    if (this._extractCountdownPlaying) return;
    if (this._extractCountdownBuffer === undefined) {
      this._extractCountdownBuffer = await this._tryFetchDecodeAmbientStem('assets/Cartoon Countdown')
        ?? await this._tryFetchDecodeAmbientStem('assets/cartoon countdown');
    }
    const buffer = this._extractCountdownBuffer;
    if (!buffer) return;
    try { await this.audioContext.resume(); } catch {}
    const src = this.audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicContext);
    this._extractCountdownPlaying = true;
    this._musicOverrideExtract = true;
    this._applyMusicOverrideDucking?.();
    this._applyAmbientGains?.();
    src.onended = () => {
      this._extractCountdownPlaying = false;
      this._musicOverrideExtract = false;
      try { src.disconnect(); } catch {}
      this._applyMusicOverrideDucking?.();
    this._applyAmbientGains?.();
    };
    src.start(this.audioContext.currentTime);
  }

  stopHeroMusic() {
    const src = this._heroMusicSource;
    const gain = this._heroMusicGain;
    if (!src || !gain) {
      if (this._ambientDuckForHero) {
        this._ambientDuckForHero = false;
        this._applyAmbientGains?.();
      }
      return;
    }
    this._heroMusicSource = null;
    this._heroMusicGain = null;
    const now = this.audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, 0.25);
    const stopAt = now + 0.8;
    try { src.stop(stopAt); } catch {}
    setTimeout(() => {
      try { src.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    }, 1200);
    this._ambientDuckForHero = false;
    this._applyAmbientGains?.();
  }

  /**
   * Set SFX volume
   */
  setSFXVolume(value) {
    this._sfxVolume = Math.min(1, Math.max(0, value));
    const target = this._sfxMuted ? 0 : this._sfxVolume;
    this.sfxContext.gain.setTargetAtTime(target, this.audioContext.currentTime, 0.01);
  }

  setSFXMuted(muted) {
    this._sfxMuted = !!muted;
    const sfxTarget = this._sfxMuted ? 0 : this._sfxVolume;
    const movementTarget = this._sfxMuted ? 0 : this._movementLoopVolume;
    this.sfxContext.gain.setTargetAtTime(sfxTarget, this.audioContext.currentTime, 0.01);
    this.movementLoopBus.gain.setTargetAtTime(movementTarget, this.audioContext.currentTime, 0.01);
  }

  isSFXMuted() {
    return this._sfxMuted;
  }

  /**
   * Get master volume
   */
  getMasterVolume() {
    return this.masterGain.gain.value;
  }

  /**
   * Get listener for spatial audio integration with Three.js
   */
  getListener() {
    return this.listener;
  }

  /**
   * Attach a THREE.PositionalAudio node to the roomba mesh so Three.js
   * auto-spatialises the motor hum based on the roomba's world transform.
   * Call once after roomba + listener are ready.
   * @param {THREE.Object3D} roombaMesh
   */
  attachRoombaAudio(roombaMesh) {
    if (this._roombaMotorBuilt) return;
    this._roombaMesh = roombaMesh;
    // Defer graph build until first updateRoombaMotor call (needs resumed context).
  }

  _ensureRoombaMotorGraph() {
    if (this._roombaMotorBuilt) return;
    const ctx = this.audioContext;

    // PositionalAudio on the roomba mesh — Three.js handles panning + distance.
    if (this._roombaMesh) {
      const positional = new THREE.PositionalAudio(this.listener);
      positional.setRefDistance(1);
      positional.setMaxDistance(26);
      positional.setDistanceModel('linear');
      positional.setRolloffFactor(1);
      this._roombaMesh.add(positional);
      this._roombaPositionalAudio = positional;
      // We'll connect our oscillator graph into the positional audio's gain node.
      this._roombaMotorGain = ctx.createGain();
      this._roombaMotorGain.gain.value = 0;
      this._roombaMotorGain.connect(positional.getOutput());
    } else {
      // Fallback: no mesh provided, use a plain PannerNode.
      this._roombaMotorPanner = ctx.createPanner();
      this._roombaMotorPanner.panningModel = 'HRTF';
      this._roombaMotorPanner.distanceModel = 'linear';
      this._roombaMotorPanner.refDistance = 1;
      this._roombaMotorPanner.maxDistance = 26;
      this._roombaMotorPanner.rolloffFactor = 1;
      this._roombaMotorPanner.connect(this.sfxContext);

      this._roombaMotorGain = ctx.createGain();
      this._roombaMotorGain.gain.value = 0;
      this._roombaMotorGain.connect(this._roombaMotorPanner);
    }

    // Try file-based vacuum loop; fall back to procedural synth.
    this._roombaMotorBuilt = true;
    void this._startRoombaAudioSource(ctx);
  }

  async _startRoombaAudioSource(ctx) {
    // Try vacuum.mp3 first, then vacuum2.mp3
    let buf = await this._loadSfxBuffer('vacuum', VACUUM_SFX_STEMS);
    if (!buf) buf = await this._loadSfxBuffer('vacuum2', VACUUM2_SFX_STEMS);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this._roombaMotorGain);
      src.start();
      this._roombaNoiseSrc = src;
      return;
    }
    // Procedural fallback: hum oscillator + filtered brown noise
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = 58;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.09;
    hum.connect(humGain);
    humGain.connect(this._roombaMotorGain);
    hum.start();
    this._roombaHumOsc = hum;

    const dur = 1.2;
    const n = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < n; i += 1) {
      const w = Math.random() * 2 - 1;
      brown = (brown + w * 0.035) * 0.965;
      data[i] = brown;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1350;
    bp.Q.value = 0.62;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.06;
    src.connect(bp);
    bp.connect(hissGain);
    hissGain.connect(this._roombaMotorGain);
    src.start();
    this._roombaNoiseSrc = src;
  }

  /**
   * Roomba motor / vacuum: phase-based gain; spatialization handled by Three.js PositionalAudio
   * (or fallback PannerNode if no mesh was attached).
   * @param {THREE.Vector3 | null} roombaWorldPos only used for fallback panner positioning
   * @param {string} phase server `ai` (charging | deploying | vacuuming | returning)
   */
  updateRoombaMotor(roombaWorldPos, phase) {
    const off = !roombaWorldPos || phase === 'charging' || this._sfxMuted;
    if (off && !this._roombaMotorBuilt) return;

    this._ensureRoombaMotorGraph();
    const t = this.audioContext.currentTime;

    // When using PositionalAudio on the mesh, Three.js handles distance/panning automatically.
    // We only control the source gain based on phase.
    const phaseBoost = phase === 'vacuuming' ? 0.195 : 0.1075;
    const target = off ? 0 : phaseBoost;

    // Fallback: manually position the PannerNode when no mesh was provided.
    if (this._roombaMotorPanner && roombaWorldPos && !off) {
      this._roombaMotorPanner.setPosition(roombaWorldPos.x, roombaWorldPos.y, roombaWorldPos.z);
    }

    this._roombaMotorGain.gain.setTargetAtTime(target, t, 0.055);
  }

  _stopRoombaMotorGraph() {
    if (!this._roombaMotorBuilt) return;
    try {
      this._roombaHumOsc?.stop();
    } catch {
      // already stopped
    }
    try {
      this._roombaNoiseSrc?.stop();
    } catch {
      // already stopped
    }
    this._roombaHumOsc?.disconnect();
    this._roombaNoiseSrc?.disconnect();
    this._roombaMotorGain?.disconnect();
    this._roombaMotorPanner?.disconnect();
    if (this._roombaPositionalAudio) {
      this._roombaPositionalAudio.disconnect();
      this._roombaMesh?.remove(this._roombaPositionalAudio);
      this._roombaPositionalAudio = null;
    }
    this._roombaHumOsc = null;
    this._roombaNoiseSrc = null;
    this._roombaMotorGain = null;
    this._roombaMotorPanner = null;
    this._roombaMotorBuilt = false;
  }

  /**
   * Update audio state (called each frame).
   * Listener position/orientation is auto-tracked by Three.js when attached to the camera.
   * @param {number} [deltaSeconds]
   */
  update(deltaSeconds) {
    if (typeof deltaSeconds === 'number' && deltaSeconds > 0) {
      this._tickAmbientCrossfade(deltaSeconds);
      this._tickMovementLoopFade(deltaSeconds);
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    this.stopMusic();
    this.stopAmbientBed();
    this.stopMovementLoop();
    this._stopRoombaMotorGraph();
    this._ambientBuffers = null;
    this._ambientDecodePromise = null;
    this._movementRunBuffer = undefined;
    this._movementWallRunBuffer = undefined;
    this._movementDecodePromise = null;
    this._emoteBufferCache.clear();
    this._emoteBufferInflight.clear();
    this._sfxBuffers.clear();
    this._sfxLoadPromises.clear();
    this._jumpBuffer = undefined;
    this._jumpLoadPromise = null;
    this.audioContext.close();
  }
}

// Singleton pattern
let audioManagerInstance = null;

export function getAudioManager() {
  if (!audioManagerInstance) {
    audioManagerInstance = new AudioManager();
  }
  return audioManagerInstance;
}
