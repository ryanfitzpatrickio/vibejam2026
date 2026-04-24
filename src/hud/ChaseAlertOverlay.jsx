import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import {
  HUD_PANEL_STYLE,
  HUD_COLORS,
  HUD_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_LABEL_SHADOW,
} from './hudStyle.js';

function ChaseAlertView(props) {
  return (
    <div
      id="chase-alert"
      role="status"
      aria-live="polite"
      style={{
        display: props.state.active ? 'block' : 'none',
        position: 'fixed',
        top: '76px',
        left: '18px',
        'z-index': '102',
        'pointer-events': 'none',
        'user-select': 'none',
        'text-align': 'left',
        padding: '10px 18px 10px 14px',
        ...HUD_PANEL_STYLE,
        border: `2px solid ${HUD_COLORS.coral}`,
        background: 'linear-gradient(160deg, rgba(255,107,143,0.96) 0%, rgba(91,31,58,0.94) 100%)',
        'box-shadow': '3px 3px 0 rgba(0,0,0,0.55), 0 0 22px rgba(255,107,143,0.24), inset 0 2px 0 rgba(255,255,255,0.24)',
      }}
    >
      <div
        style={{
          font: HUD_LABEL_FONT,
          'font-size': '13px',
          'letter-spacing': '0.18em',
          'text-transform': 'uppercase',
          color: '#fff8c7',
          'text-shadow': HUD_LABEL_SHADOW,
          'margin-bottom': '4px',
        }}
      >
        Cat Nearby
      </div>
      <div
        style={{
          font: HUD_VALUE_FONT,
          'font-size': '24px',
          color: '#fff',
          'text-shadow': HUD_LABEL_SHADOW,
          'line-height': '1.1',
        }}
      >
        {props.state.timerText}
      </div>
    </div>
  );
}

/** Top-center warning while the cat is actively hunting this player. */
export class ChaseAlertOverlay {
  constructor({ container = document.body } = {}) {
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const [state, setState] = createStore({
      active: false,
      timerText: '0.0s',
    });
    this._setState = setState;
    this._dispose = render(() => <ChaseAlertView state={state} />, this._mount);
  }

  update({ active = false, streakSeconds = 0 } = {}) {
    const on = active && streakSeconds > 0.02;
    batch(() => {
      this._setState({
        active: on,
        timerText: `${Number(streakSeconds).toFixed(1)}s`,
      });
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
