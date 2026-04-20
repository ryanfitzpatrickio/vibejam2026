import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_SMALL_LABEL_FONT,
  HUD_LABEL_SHADOW,
} from './hudStyle.js';
import { MouseHeadTarget, CheeseItem, StaminaBolt } from './hudSprites.jsx';
import { actionLabel } from '../input/inputSource.js';

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function RoundRaidView(props) {
  return (
    <>
      <div
        id="round-phase"
        style={{
          ...HUD_PANEL_STYLE,
          position: 'fixed',
          top: '14px',
          left: '50%',
          transform: 'translateX(-50%)',
          'z-index': '120',
          'pointer-events': 'none',
          padding: '8px 18px',
          'border-radius': '14px',
          'max-width': 'min(92vw, 560px)',
          'text-align': 'center',
          'white-space': 'pre-line',
          font: HUD_LABEL_FONT,
          color: props.state.phaseColor,
          'text-shadow': HUD_LABEL_SHADOW,
          'letter-spacing': '0.04em',
          'line-height': '1.25',
          display: props.state.phaseVisible ? 'block' : 'none',
        }}
      >
        {props.state.phaseText}
      </div>

      <div
        style={{
          position: 'fixed',
          inset: '0',
          'z-index': '200',
          background: 'rgba(0,0,0,0.6)',
          'backdrop-filter': 'blur(3px)',
          display: props.state.roundEndVisible ? 'flex' : 'none',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '20px',
          'box-sizing': 'border-box',
          'pointer-events': 'auto',
        }}
        onClick={() => props.onRoundEndDismiss()}
      >
        <div
          style={{
            ...HUD_PANEL_STYLE,
            width: 'min(96vw, 560px)',
            'max-height': 'min(86dvh, 720px)',
            padding: '18px 20px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '12px',
            'box-sizing': 'border-box',
            overflow: 'hidden',
            'touch-action': 'pan-y',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              font: HUD_LABEL_FONT,
              'font-size': '22px',
              'letter-spacing': '0.06em',
              'text-transform': 'uppercase',
              'text-shadow': HUD_LABEL_SHADOW,
              'text-align': 'center',
            }}
          >
            {props.state.roundEndTitle}
          </div>

          <Show when={props.state.roundEndRows.length > 0}>
            <div
              style={{
                display: 'grid',
                'grid-template-columns': '28px 1fr 64px 64px 64px',
                'align-items': 'end',
                gap: '10px',
                padding: '0 6px',
                color: 'rgba(255,255,255,0.7)',
                font: HUD_SMALL_LABEL_FONT,
                'letter-spacing': '0.06em',
                'text-transform': 'uppercase',
                'text-shadow': HUD_LABEL_SHADOW,
              }}
            >
              <span>#</span>
              <span>Player</span>
              <span style={{ 'text-align': 'right' }}>Extract</span>
              <span style={{ 'text-align': 'right' }}>Score</span>
              <span style={{ 'text-align': 'right' }}>XP</span>
            </div>
          </Show>

          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: '4px',
              overflow: 'auto',
              '-webkit-overflow-scrolling': 'touch',
              'overscroll-behavior': 'contain',
              'touch-action': 'pan-y',
              'min-height': '0',
            }}
          >
            <For each={props.state.roundEndRows}>
              {(row, i) => (
                <div
                  style={{
                    display: 'grid',
                    'grid-template-columns': '28px 1fr 64px 64px 64px',
                    'align-items': 'center',
                    gap: '10px',
                    padding: '6px',
                    'border-radius': '8px',
                    background: i() % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    font: HUD_LABEL_FONT,
                    'text-shadow': HUD_LABEL_SHADOW,
                  }}
                >
                  <span style={{ 'text-align': 'center', color: '#fde68a' }}>
                    {i() + 1}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '8px',
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    <MouseHeadTarget size={22} />
                    <span
                      style={{
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {row.name}
                    </span>
                  </span>
                  <span
                    style={{
                      'text-align': 'right',
                      color: row.extracted ? '#a7f3d0' : '#fda4af',
                      font: HUD_VALUE_FONT,
                    }}
                  >
                    {row.extracted ? '✓' : '✗'}
                  </span>
                  <span
                    style={{
                      'text-align': 'right',
                      color: '#fff7c2',
                      font: HUD_VALUE_FONT,
                    }}
                  >
                    {row.score}
                  </span>
                  <span
                    style={{
                      'text-align': 'right',
                      color: '#a5d7ff',
                      font: HUD_VALUE_FONT,
                    }}
                  >
                    +{row.xp}
                  </span>
                </div>
              )}
            </For>
          </div>

          <div
            style={{
              'margin-top': '4px',
              opacity: '0.7',
              font: HUD_SMALL_LABEL_FONT,
              'text-align': 'center',
              'text-shadow': HUD_LABEL_SHADOW,
            }}
          >
            Press {actionLabel('dismiss')} or click to close
          </div>
        </div>
      </div>
    </>
  );
}

/** Phase timer banner + round-end score table. */
export class RoundRaidOverlay {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const [state, setState] = createStore({
      phaseVisible: false,
      phaseText: '',
      phaseColor: '#fff',
      roundEndVisible: false,
      roundEndTitle: '',
      roundEndRows: [],
    });
    this._setState = setState;
    this._dismiss = () => {
      batch(() => this._setState({ roundEndVisible: false }));
    };
    this._dispose = render(() => (
      <RoundRaidView state={state} onRoundEndDismiss={this._dismiss} />
    ), this._mount);

    // Allow keyboard dismissal of the round-end summary so players don't have
    // to grab the mouse to clear it. Run in the capture phase so the gameplay
    // controller (which listens for Space → jump) doesn't beat us to it.
    this._onKeyDown = (e) => {
      if (!state.roundEndVisible) return;
      const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
      const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter';
      if (!isSpace && !isEnter) return;
      const t = e.target;
      if (t instanceof HTMLElement
          && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this._dismiss();
    };
    document.addEventListener('keydown', this._onKeyDown, true);

    // Gamepad dismissal: A or B while the round-end summary is visible.
    this._gamepadRaf = 0;
    this._gamepadPrev = { a: false, b: false };
    const pollGamepad = () => {
      if (state.roundEndVisible) {
        const pads = typeof navigator !== 'undefined' && navigator.getGamepads
          ? navigator.getGamepads() : [];
        for (const p of pads) {
          if (!p || !p.connected) continue;
          const a = !!p.buttons[0]?.pressed;
          const b = !!p.buttons[1]?.pressed;
          if ((a && !this._gamepadPrev.a) || (b && !this._gamepadPrev.b)) {
            this._dismiss();
          }
          this._gamepadPrev.a = a;
          this._gamepadPrev.b = b;
          break;
        }
      } else {
        this._gamepadPrev.a = false;
        this._gamepadPrev.b = false;
      }
      this._gamepadRaf = requestAnimationFrame(pollGamepad);
    };
    this._gamepadRaf = requestAnimationFrame(pollGamepad);
  }

  updatePhaseBanner(round, nowSeconds = Date.now() / 1000, hints = {}) {
    if (!round?.phase || typeof round.phaseEndsAt !== 'number') {
      batch(() => this._setState({ phaseVisible: false }));
      return;
    }
    const remain = round.phaseEndsAt - nowSeconds;
    const label = round.phase === 'forage'
      ? `FORAGE  ·  ${formatClock(remain)}`
      : round.phase === 'extract'
        ? `EXTRACT  ·  ${formatClock(remain)}  ·  Hold ${actionLabel('interact')} in a glowing hole`
        : `ROUND END  ·  ${formatClock(remain)}`;
    const sub = hints.subtitle ? `\n${hints.subtitle}` : '';
    const text = `${label}${sub}`;
    let color = '#fff';
    if (round.phase === 'extract') color = '#fde68a';
    else if (round.phase === 'intermission') color = '#a7f3d0';
    batch(() => {
      this._setState({
        phaseVisible: true,
        phaseText: text,
        phaseColor: color,
      });
    });
  }

  showRoundEnd(data) {
    if (!data?.results?.length) return;
    const rn = data.roundNumber ?? '?';
    const title = `Round ${rn} results`;
    const rows = data.results.map((r, i) => ({
      name: typeof r.displayName === 'string' && r.displayName.trim()
        ? r.displayName.trim()
        : String(r.id ?? i).slice(0, 10),
      extracted: !!r.extracted,
      score: Math.max(0, Math.floor(Number(r.finalScore) || 0)),
      xp: Math.max(0, Math.floor(Number(r.xpAwarded) || 0)),
    }));
    batch(() => {
      this._setState({
        roundEndVisible: true,
        roundEndTitle: title,
        roundEndRows: rows,
      });
    });
  }

  setVisible(visible) {
    this._mount.style.display = visible === false ? 'none' : '';
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown, true);
    cancelAnimationFrame(this._gamepadRaf);
    this._dispose();
    this._mount.remove();
  }
}
