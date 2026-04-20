import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';

function ChaseAlertView(props) {
  return (
    <div
      id="chase-alert"
      role="status"
      aria-live="polite"
      style={{
        display: props.state.active ? 'block' : 'none',
        position: 'fixed',
        top: '64px',
        left: '50%',
        transform: 'translateX(-50%)',
        'z-index': '102',
        'pointer-events': 'none',
        'user-select': 'none',
        'text-align': 'center',
        'font-family': 'monospace',
        padding: '10px 22px',
        'border-radius': '8px',
        background: 'linear-gradient(180deg, rgba(120,20,20,0.92), rgba(40,8,8,0.88))',
        border: '1px solid rgba(255,120,80,0.55)',
        'box-shadow': '0 4px 18px rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          'font-size': '11px',
          'font-weight': '800',
          'letter-spacing': '0.28em',
          color: 'rgba(255,200,160,0.95)',
          'text-shadow': '0 0 8px rgba(255,80,40,0.6)',
          'margin-bottom': '4px',
        }}
      >
        CHASED
      </div>
      <div
        style={{
          'font-size': '22px',
          'font-weight': '700',
          color: '#fff',
          'text-shadow': '0 1px 3px #000, 0 0 12px rgba(255,60,30,0.35)',
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
