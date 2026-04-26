import * as THREE from 'three';

const STATE_TO_CLIP = Object.freeze({
  idle: 'Idle',
  run: 'Run',
  walk: 'Walk',
  jump: 'Jump',
  chew: 'Bite',
  carry: 'Idle Alert',
  grab: 'Idle Alert',
  death: 'Death',
  sit: 'Sit',
  win: 'Sit',
});

/** Per-clip playback rate (1 = authored speed). Walk is sped up to match ~4 m/s in-world stride. */
const CLIP_TIME_SCALE = Object.freeze({
  Walk: 3.5,
});

export class MouseAnimationManager {
  constructor({ fadeDuration = 0.18 } = {}) {
    this.fadeDuration = fadeDuration;
    this.mixer = null;
    this.root = null;
    this.actions = new Map();
    this.currentAction = null;
    this.currentState = 'idle';
    this._emoteActive = false;
    this._scrubAction = null;
  }

  get emoteActive() {
    return this._emoteActive;
  }

  attach(root, clips = []) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions.clear();

    clips.forEach((clip) => {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    });

    this._play('Idle', true);
  }

  setState(state, { immediate = false } = {}) {
    this.currentState = state;
    if (this._scrubAction) this.stopScrubClip();
    const clipName = STATE_TO_CLIP[state] ?? 'Idle';
    this._play(clipName, immediate);
  }

  update(delta) {
    if (this.mixer) {
      this.mixer.update(delta);
    }
  }

  scrubReverseClip(candidates = [], progress = 0) {
    if (!this.mixer || this._emoteActive) return false;
    const clipName = candidates.find((name) => this.actions.has(name));
    if (!clipName) return false;
    const action = this.actions.get(clipName);
    if (!action) return false;

    if (this._scrubAction !== action) {
      const previous = this.currentAction;
      this._scrubAction = action;
      this.currentAction = action;
      action.enabled = true;
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(1);
      action.play();
      if (previous && previous !== action) {
        previous.fadeOut(0.08);
        action.crossFadeFrom(previous, 0.08, false);
      }
    }

    const pct = Math.max(0, Math.min(1, Number(progress) || 0));
    action.paused = false;
    action.timeScale = 0;
    action.time = Math.max(0, action.getClip().duration * (1 - pct));
    return true;
  }

  stopScrubClip() {
    if (!this._scrubAction) return;
    this._scrubAction.paused = false;
    this._scrubAction.fadeOut(0.08);
    this._scrubAction = null;
    this.currentAction = null;
    this.setState(this.currentState, { immediate: true });
  }

  /**
   * Scale the current locomotion action's timeScale. Multiplier is applied on
   * top of the clip's authored base rate (e.g. Walk base is 3.5). Pass 1 to
   * reset to base. Only affects looping locomotion clips (Walk/Run/Idle) so we
   * don't mess with one-shots like Jump/Death.
   */
  setPlaybackRate(multiplier = 1) {
    if (!this.currentAction || this._emoteActive) return;
    const clipName = this.currentAction.getClip?.()?.name;
    if (clipName !== 'Walk' && clipName !== 'Run' && clipName !== 'Idle') return;
    const base = CLIP_TIME_SCALE[clipName] ?? 1;
    this.currentAction.timeScale = base * Math.max(0.25, Math.min(2.5, multiplier));
  }

  _play(clipName, immediate = false) {
    if (!this.mixer) return;

    const action = this.actions.get(clipName) ?? this.actions.get('Idle');
    if (!action || this.currentAction === action) return;

    const previous = this.currentAction;
    this.currentAction = action;

    const once = clipName === 'Jump' || clipName === 'Death';
    action.enabled = true;
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.timeScale = CLIP_TIME_SCALE[clipName] ?? 1;
    action.play();

    if (previous && previous !== action) {
      if (immediate) {
        previous.stop();
      } else {
        previous.fadeOut(this.fadeDuration);
        action.crossFadeFrom(previous, this.fadeDuration, false);
      }
    }
  }

  playEmoteClip(clipName) {
    if (!this.mixer) return;
    const action = this.actions.get(clipName);
    if (!action) return;

    this._emoteActive = true;

    const previous = this.currentAction;
    this.currentAction = action;
    action.enabled = true;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    if (previous && previous !== action) {
      previous.fadeOut(this.fadeDuration);
      action.crossFadeFrom(previous, this.fadeDuration, false);
    }
  }

  stopEmote() {
    if (!this._emoteActive) return;
    this._emoteActive = false;
    if (this.currentAction) {
      this.currentAction.fadeOut(this.fadeDuration);
    }
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.root) this.mixer.uncacheRoot(this.root);
    }

    this.actions.clear();
    this.currentAction = null;
    this._scrubAction = null;
    this.root = null;
    this.mixer = null;
  }
}
