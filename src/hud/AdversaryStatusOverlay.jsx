import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { Show, createSignal, onCleanup } from 'solid-js';
import { HUD_SMALL_LABEL_FONT } from './hudStyle.js';

/**
 * Top-right adversary panel was retired in favor of a compact row inside the
 * main HUD (see HudView's HumanRoleRow). This overlay now only renders the
 * mobile toggle button so touch users can still swap roles, since the desktop
 * action key isn't available to them.
 */

function useIsMobile() {
  const mm = typeof window !== 'undefined' ? window.matchMedia : null;
  const queries = mm ? [
    mm.call(window, '(pointer: coarse)'),
    mm.call(window, '(hover: none)'),
    mm.call(window, '(max-width: 820px)'),
  ] : [];
  const evaluate = () => queries.some((q) => q?.matches);
  const [isMobile, setIsMobile] = createSignal(evaluate());
  const handler = () => setIsMobile(evaluate());
  for (const q of queries) {
    q?.addEventListener?.('change', handler);
  }
  onCleanup(() => {
    for (const q of queries) q?.removeEventListener?.('change', handler);
  });
  return isMobile;
}

function AdversaryStatusView(props) {
  const mode = () => props.state.mode;
  const isAvailable = () => mode() === 'available';
  const isLocal = () => mode() === 'local';
  const hiding = () => props.state.hiding;
  const isMobile = useIsMobile();

  const buttonLabel = () => {
    if (isAvailable()) return 'Become human';
    if (isLocal()) return 'Return as mouse';
    return null;
  };
  const buttonColor = () => {
    if (isAvailable()) return '#ffe08a';
    return hiding() ? '#9dffb1' : '#ffcf8a';
  };

  return (
    <Show when={props.renderMobileToggle !== false && isMobile() && buttonLabel()}>
      <button
        type="button"
        id="adversary-toggle-mobile"
        onClick={(e) => { e.preventDefault(); props.onToggle?.(); }}
        onTouchEnd={(e) => { e.preventDefault(); props.onToggle?.(); }}
        style={{
          position: 'fixed',
          top: '10px',
          right: '12px',
          'z-index': '121',
          font: HUD_SMALL_LABEL_FONT,
          color: '#111',
          background: buttonColor(),
          border: 'none',
          'border-radius': '6px',
          padding: '8px 12px',
          'box-shadow': '0 2px 6px rgba(0,0,0,0.35)',
          cursor: 'pointer',
        }}
      >
        {buttonLabel()}
      </button>
    </Show>
  );
}

export class AdversaryStatusOverlay {
  constructor({ container = document.body, onToggle = null, renderMobileToggle = true } = {}) {
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const [state, setState] = createStore({
      mode: 'off',
      displayName: '',
      safeSeconds: 0,
      streakSeconds: 0,
      hiding: false,
    });
    this._setState = setState;
    this._onToggle = onToggle;
    this._dispose = render(
      () => (
        <AdversaryStatusView
          state={state}
          onToggle={() => this._onToggle?.()}
          renderMobileToggle={renderMobileToggle}
        />
      ),
      this._mount,
    );
  }

  setOnToggle(fn) {
    this._onToggle = fn;
  }

  update(patch = {}) {
    this._setState({
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
