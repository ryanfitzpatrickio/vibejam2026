import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_SMALL_LABEL_FONT,
  HUD_LABEL_SHADOW,
  HUD_TRACK_STYLE,
  HUD_COLORS,
} from './hudStyle.js';

const METER_TARGET = 300;

const IS_MOBILE = typeof window !== 'undefined'
  && ((window.matchMedia?.('(pointer: coarse)')?.matches ?? false)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function formatScore(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString();
}

function gradeForScore(value) {
  const score = Math.max(0, Math.floor(Number(value) || 0));
  if (score >= 300) return 'S';
  if (score >= 220) return 'A';
  if (score >= 140) return 'B';
  if (score >= 70) return 'C';
  if (score > 0) return 'D';
  return '-';
}

function MischiefMeterView(props) {
  const fillPct = () => `${Math.round(clamp01(props.state.score / METER_TARGET) * 100)}%`;
  const comboPct = () => `${Math.round(clamp01(props.state.comboProgress) * 100)}%`;
  return (
    <div
      style={{
        ...HUD_PANEL_STYLE,
        position: 'fixed',
        right: '20px',
        bottom: 'max(155px, calc(env(safe-area-inset-bottom) + 92px))',
        width: 'min(180px, calc(100vw - 40px))',
        padding: '10px 12px 12px',
        'z-index': '118',
        'pointer-events': 'none',
        display: 'none',
        transform: props.state.pulse > 0 ? `scale(${1 + props.state.pulse * 0.035})` : 'scale(1)',
        transition: 'transform 90ms ease-out',
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: '8px',
        }}
      >
        <div
          style={{
            font: HUD_LABEL_FONT,
            'font-size': '13px',
            'letter-spacing': '0.12em',
            'text-transform': 'uppercase',
            'text-shadow': HUD_LABEL_SHADOW,
            color: HUD_COLORS.lavender,
          }}
        >
          Mischief
        </div>
        <div
          style={{
            font: HUD_VALUE_FONT,
            'font-size': '34px',
            'line-height': '0.9',
            color: HUD_COLORS.amber,
            'text-shadow': HUD_LABEL_SHADOW,
          }}
        >
          {gradeForScore(props.state.score)}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'baseline',
          color: '#fff',
          font: HUD_SMALL_LABEL_FONT,
          'font-size': '11px',
          'letter-spacing': '0.05em',
          'text-shadow': HUD_LABEL_SHADOW,
          'margin-top': '1px',
        }}
      >
        <span>{formatScore(props.state.score)}</span>
        <span>/ {METER_TARGET}</span>
      </div>

      <div
        style={{
          ...HUD_TRACK_STYLE,
          height: '15px',
          overflow: 'hidden',
          'margin-top': '6px',
          transform: 'skewX(-8deg)',
        }}
      >
        <div
          style={{
            width: fillPct(),
            height: '100%',
            background: `linear-gradient(90deg, ${HUD_COLORS.coral} 0%, ${HUD_COLORS.lavender} 50%, ${HUD_COLORS.cyan} 100%)`,
            'box-shadow': '0 0 16px rgba(139,233,255,0.42), inset 0 2px 0 rgba(255,255,255,0.32)',
            transition: 'width 170ms ease-out',
          }}
        />
      </div>

      <div
        style={{
          display: props.state.combo > 1 ? 'block' : 'none',
          'margin-top': '8px',
        }}
      >
        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            color: HUD_COLORS.amber,
            font: HUD_SMALL_LABEL_FONT,
            'font-size': '11px',
            'letter-spacing': '0.05em',
            'text-shadow': HUD_LABEL_SHADOW,
          }}
        >
          <span>x{props.state.combo} COMBO</span>
          <span>chaos</span>
        </div>
        <div
          style={{
            ...HUD_TRACK_STYLE,
            height: '7px',
            overflow: 'hidden',
            'margin-top': '4px',
            transform: 'skewX(-8deg)',
          }}
        >
          <div
            style={{
              width: comboPct(),
              height: '100%',
              background: `linear-gradient(90deg, ${HUD_COLORS.amber} 0%, ${HUD_COLORS.coralHot} 100%)`,
              transition: 'width 80ms linear',
            }}
          />
        </div>
      </div>
    </div>
  );
}

export class MischiefMeter {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const [state, setState] = createStore({
      visible: true,
      score: 0,
      combo: 0,
      comboProgress: 0,
      pulse: 0,
    });
    this._state = state;
    this._setState = setState;
    this._lastScore = 0;
    this._dispose = render(() => <MischiefMeterView state={state} />, this._mount);
  }

  update(playerState, nowSeconds = Date.now() / 1000) {
    const stats = playerState?.roundStats ?? {};
    const score = Math.max(0, Math.floor(Number(stats.mischiefScore) || 0));
    const combo = Math.max(0, Math.floor(Number(stats.mischiefCombo) || 0));
    const comboEndsAt = Number(stats.mischiefComboEndsAt) || 0;
    const comboRemaining = Math.max(0, comboEndsAt - nowSeconds);
    const comboProgress = combo > 1 ? comboRemaining / 3.4 : 0;
    const gained = score > this._lastScore;
    this._lastScore = score;
    batch(() => {
      this._setState({
        score,
        combo,
        comboProgress: clamp01(comboProgress),
        pulse: gained ? 1 : Math.max(0, this._state.pulse - 0.08),
      });
    });
  }

  setVisible(visible) {
    this._setState('visible', visible !== false);
  }

  dispose() {
    this._dispose();
    this._mount.remove();
  }
}
