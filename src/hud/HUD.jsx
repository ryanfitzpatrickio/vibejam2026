import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import { HudView } from './HudView.jsx';

const PATCH_KEYS = [
  'stamina',
  'health',
  'ping',
  'playerCount',
  'playerCountMax',
  'connectedCount',
  'botCount',
  'cheese',
  'cheeseMax',
  'lives',
  'maxLives',
  'heroTimeRemaining',
  'heroAvatar',
  'heroAvailable',
  'heroAvatarAvailable',
  'alive',
  'respawnCountdown',
  'hint',
];

/**
 * In-game HUD (bottom-left bars + stats + respawn overlay), implemented in Solid.js.
 */
export class HUD {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this._mount = document.createElement('div');
    this.container.appendChild(this._mount);

    const [state, setState] = createStore({
      stamina: 1,
      health: 1,
      ping: undefined,
      playerCount: 1,
      playerCountMax: 10,
      connectedCount: 1,
      botCount: 0,
      cheese: 0,
      cheeseMax: 50,
      lives: 2,
      maxLives: 2,
      heroTimeRemaining: 0,
      heroAvatar: null,
      heroAvailable: false,
      heroAvatarAvailable: null,
      alive: true,
      respawnCountdown: 0,
      hint: null,
      humanRole: {
        mode: 'off',
        displayName: '',
        safeSeconds: 0,
        streakSeconds: 0,
        hiding: false,
      },
    });
    this._setState = setState;
    this._dispose = render(() => <HudView state={state} />, this._mount);
  }

  update(patch = {}) {
    const part = {};
    for (const k of PATCH_KEYS) {
      if (patch[k] !== undefined) {
        part[k] = patch[k];
      }
    }
    if (!Object.keys(part).length) return;
    batch(() => {
      this._setState(part);
    });
  }

  updateHumanRole(patch = {}) {
    this._setState('humanRole', {
      mode: patch.mode ?? 'off',
      displayName: patch.displayName ?? '',
      safeSeconds: patch.safeSeconds ?? 0,
      streakSeconds: patch.streakSeconds ?? 0,
      hiding: !!patch.hiding,
    });
  }

  setVisible(visible) {
    this._mount.style.display = visible === false ? 'none' : '';
  }

  dispose() {
    this._dispose();
    this._mount.remove();
  }
}
