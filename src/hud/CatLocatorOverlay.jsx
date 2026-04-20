import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import { computeCatLocatorLayout } from './catLocatorLayout.js';

function CatLocatorView(props) {
  const arrowTransform = () => `rotate(${props.state.arrowDeg}deg)`;
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          display: props.state.arrowVisible ? 'block' : 'none',
          'z-index': '98',
          'pointer-events': 'none',
          color: '#ff6b4a',
          'font-size': '22px',
          'font-weight': '900',
          'text-shadow': '0 0 8px #000, 0 1px 3px #000',
          'user-select': 'none',
          'transform-origin': '50% 50%',
          left: `${props.state.arrowLeft}px`,
          top: `${props.state.arrowTop}px`,
          transform: arrowTransform(),
        }}
      >
        ▲
      </div>
      <div
        style={{
          position: 'fixed',
          display: props.state.distVisible ? 'block' : 'none',
          'z-index': '98',
          'pointer-events': 'none',
          color: 'rgba(255,245,230,0.92)',
          'font-size': '10px',
          'font-family': 'monospace',
          'font-weight': '700',
          'text-shadow': '1px 1px 2px #000',
          'user-select': 'none',
          left: `${props.state.distLeft}px`,
          top: `${props.state.distTop}px`,
        }}
      >
        {props.state.distText}
      </div>
    </>
  );
}

/** Edge-of-screen arrow toward the cat. */
export class CatLocatorOverlay {
  constructor({ container = document.body } = {}) {
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const [state, setState] = createStore({
      arrowVisible: false,
      distVisible: false,
      arrowLeft: 0,
      arrowTop: 0,
      arrowDeg: 0,
      distLeft: 0,
      distTop: 0,
      distText: '',
    });
    this._setState = setState;
    this._dispose = render(() => <CatLocatorView state={state} />, this._mount);
  }

  update(opts = {}) {
    const lay = computeCatLocatorLayout(opts);
    if (!lay.visible) {
      batch(() => {
        this._setState({ arrowVisible: false, distVisible: false });
      });
      return;
    }
    const angDeg = lay.ang * (180 / Math.PI) + 90;
    batch(() => {
      this._setState({
        arrowVisible: true,
        distVisible: true,
        arrowLeft: lay.ex - 11,
        arrowTop: lay.ey - 11,
        arrowDeg: angDeg,
        distLeft: lay.ex - 16,
        distTop: lay.ey + 16,
        distText: lay.distText,
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
