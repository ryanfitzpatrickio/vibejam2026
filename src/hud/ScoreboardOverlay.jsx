import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_SMALL_LABEL_FONT,
  HUD_LABEL_SHADOW,
} from './hudStyle.js';
import { HeartHealthHappy, MouseHeadTarget, CheeseItem, StaminaBolt } from './hudSprites.jsx';
import { inputSource } from '../input/inputSource.js';

function isFormTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
}

function SvgLabel(props) {
  return (
    <text
      x={props.x}
      y={props.y}
      text-anchor={props.anchor ?? 'start'}
      fill={props.fill ?? '#fff7c2'}
      font-family="Fredoka, Baloo, system-ui, sans-serif"
      font-size={props.size ?? 13}
      font-weight="800"
      letter-spacing="0"
      paint-order="stroke"
      stroke="#111827"
      stroke-width="3"
      stroke-linejoin="round"
    >
      {props.children}
    </text>
  );
}

function Callout(props) {
  const d = () => (props.midX != null || props.midY != null
    ? `M ${props.fromX} ${props.fromY} L ${props.midX ?? props.toX} ${props.midY ?? props.fromY} L ${props.toX} ${props.toY}`
    : `M ${props.fromX} ${props.fromY} L ${props.toX} ${props.toY}`);
  return (
    <>
      <path
        d={d()}
        fill="none"
        stroke={props.color ?? '#fde68a'}
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx={props.fromX} cy={props.fromY} r="3.5" fill={props.color ?? '#fde68a'} />
      <SvgLabel x={props.labelX} y={props.labelY} anchor={props.anchor}>
        {props.label}
      </SvgLabel>
    </>
  );
}

function KeyboardKey(props) {
  return (
    <g>
      <rect
        x={props.x}
        y={props.y}
        width={props.w ?? 34}
        height={props.h ?? 28}
        rx="5"
        fill={props.active ? '#fbbf24' : 'rgba(255,255,255,0.11)'}
        stroke={props.active ? '#fff7c2' : 'rgba(255,255,255,0.24)'}
        stroke-width="2"
      />
      <text
        x={props.x + (props.w ?? 34) / 2}
        y={props.y + (props.h ?? 28) / 2 + 5}
        text-anchor="middle"
        fill={props.active ? '#111827' : 'rgba(255,255,255,0.84)'}
        font-family="Fredoka, Baloo, system-ui, sans-serif"
        font-size={props.size ?? 12}
        font-weight="900"
        letter-spacing="0"
      >
        {props.label}
      </text>
    </g>
  );
}

function KeyboardControlsImage() {
  return (
    <svg viewBox="0 0 900 360" role="img" aria-label="Keyboard controls map" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="12" y="16" width="876" height="328" rx="8" fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.18)" />
      <SvgLabel x="450" y="44" anchor="middle" size="18">Keyboard controls</SvgLabel>

      <g transform="translate(300 96)">
        <rect x="-18" y="-18" width="384" height="176" rx="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" />
        <KeyboardKey x="0" y="0" label="Tab" w="56" active />
        <KeyboardKey x="70" y="0" label="Q" active />
        <KeyboardKey x="112" y="0" label="W" active />
        <KeyboardKey x="154" y="0" label="E" active />
        <KeyboardKey x="196" y="0" label="R" active />
        <KeyboardKey x="238" y="0" label="F" active />

        <KeyboardKey x="0" y="44" label="Shift" w="76" active size="11" />
        <KeyboardKey x="88" y="44" label="A" active />
        <KeyboardKey x="130" y="44" label="S" active />
        <KeyboardKey x="172" y="44" label="D" active />
        <KeyboardKey x="214" y="44" label="H" active />
        <KeyboardKey x="256" y="44" label="J" active />

        <KeyboardKey x="0" y="88" label="Ctrl" w="64" active size="11" />
        <KeyboardKey x="84" y="88" label="Space" w="190" active />
      </g>

      <Callout fromX="449" fromY="110" toX="216" toY="86" labelX="38" labelY="90" label="WASD move" />
      <Callout fromX="338" fromY="154" toX="216" toY="130" labelX="38" labelY="134" label="Shift sprint" color="#93c5fd" />
      <Callout fromX="332" fromY="198" toX="216" toY="174" labelX="38" labelY="178" label="Ctrl crouch" color="#86efac" />
      <Callout fromX="479" fromY="198" toX="216" toY="218" labelX="38" labelY="222" label="Space jump" color="#fca5a5" />
      <Callout fromX="328" fromY="110" toX="216" toY="262" labelX="38" labelY="266" label="Tab players" color="#d9f99d" />

      <Callout fromX="387" fromY="110" toX="686" toY="86" labelX="704" labelY="90" label="Q grab" color="#c4b5fd" />
      <Callout fromX="471" fromY="110" toX="686" toY="122" labelX="704" labelY="126" label="E smack / throw held" color="#fda4af" />
      <Callout fromX="513" fromY="110" toX="686" toY="158" labelX="704" labelY="162" label="R spawn ball" color="#fde68a" />
      <Callout fromX="555" fromY="110" toX="686" toY="194" labelX="704" labelY="198" label="F emote" color="#99f6e4" />
      <Callout fromX="531" fromY="154" toX="686" toY="230" labelX="704" labelY="234" label="H hero" color="#fdba74" />
      <Callout fromX="573" fromY="154" toX="686" toY="266" labelX="704" labelY="270" label="J adversary" color="#f0abfc" />
    </svg>
  );
}

function ControllerButton(props) {
  return (
    <g>
      <circle
        cx={props.x}
        cy={props.y}
        r={props.r ?? 14}
        fill={props.active ? props.color ?? '#fbbf24' : 'rgba(255,255,255,0.14)'}
        stroke={props.active ? '#fff7c2' : 'rgba(255,255,255,0.28)'}
        stroke-width="2"
      />
      <text
        x={props.x}
        y={props.y + 5}
        text-anchor="middle"
        fill={props.active ? '#111827' : '#fff'}
        font-family="Fredoka, Baloo, system-ui, sans-serif"
        font-size="13"
        font-weight="900"
        letter-spacing="0"
      >
        {props.label}
      </text>
    </g>
  );
}

function ControllerControlsImage() {
  return (
    <svg viewBox="0 0 760 300" role="img" aria-label="Xbox 360 controller controls map" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x="12" y="16" width="736" height="268" rx="8" fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.18)" />
      <SvgLabel x="380" y="42" anchor="middle" size="16">Xbox 360 controls</SvgLabel>

      <g>
        <path
          d="M 196 96 C 226 56 316 64 346 100 L 424 100 C 454 64 544 56 574 96 C 616 146 632 232 586 250 C 552 264 522 224 496 190 L 264 190 C 238 224 208 264 174 250 C 128 232 154 146 196 96 Z"
          fill="rgba(255,255,255,0.12)"
          stroke="rgba(255,255,255,0.28)"
          stroke-width="3"
        />
        <rect x="282" y="78" width="196" height="118" rx="36" fill="rgba(0,0,0,0.12)" stroke="rgba(255,255,255,0.12)" />

        <rect x="245" y="72" width="86" height="24" rx="8" fill="#93c5fd" stroke="#dbeafe" stroke-width="2" />
        <SvgLabel x="288" y="89" anchor="middle" size="12" fill="#111827">LT</SvgLabel>
        <rect x="429" y="72" width="86" height="24" rx="8" fill="#fbbf24" stroke="#fff7c2" stroke-width="2" />
        <SvgLabel x="472" y="89" anchor="middle" size="12" fill="#111827">RT</SvgLabel>

        <rect x="245" y="102" width="86" height="20" rx="7" fill="#fdba74" stroke="#fed7aa" stroke-width="2" />
        <SvgLabel x="288" y="117" anchor="middle" size="11" fill="#111827">LB</SvgLabel>
        <rect x="429" y="102" width="86" height="20" rx="7" fill="#fde68a" stroke="#fff7c2" stroke-width="2" />
        <SvgLabel x="472" y="117" anchor="middle" size="11" fill="#111827">RB</SvgLabel>

        <circle cx="286" cy="156" r="25" fill="#fbbf24" stroke="#fff7c2" stroke-width="3" />
        <circle cx="286" cy="156" r="9" fill="#111827" opacity="0.65" />
        <SvgLabel x="286" y="192" anchor="middle" size="12">L3</SvgLabel>

        <circle cx="452" cy="174" r="23" fill="#fde68a" stroke="#fff7c2" stroke-width="3" />
        <circle cx="452" cy="174" r="8" fill="#111827" opacity="0.65" />
        <SvgLabel x="452" y="210" anchor="middle" size="12">R3</SvgLabel>

        <g fill="#d9f99d" stroke="#ecfccb" stroke-width="2">
          <rect x="337" y="158" width="18" height="54" rx="4" />
          <rect x="319" y="176" width="54" height="18" rx="4" />
        </g>

        <rect x="366" y="130" width="28" height="14" rx="7" fill="#d9f99d" stroke="#ecfccb" stroke-width="2" />
        <rect x="402" y="130" width="28" height="14" rx="7" fill="#f0abfc" stroke="#f5d0fe" stroke-width="2" />

        <ControllerButton x="544" y="136" label="Y" active color="#99f6e4" />
        <ControllerButton x="514" y="166" label="X" active color="#fda4af" />
        <ControllerButton x="574" y="166" label="B" active color="#c4b5fd" />
        <ControllerButton x="544" y="196" label="A" active color="#fca5a5" />
      </g>

      <Callout fromX="286" fromY="156" toX="126" toY="78" labelX="38" labelY="82" label="Left stick move" />
      <Callout fromX="288" fromY="84" toX="126" toY="112" labelX="38" labelY="116" label="LT crouch" color="#93c5fd" />
      <Callout fromX="472" fromY="84" toX="634" toY="78" labelX="648" labelY="82" label="RT sprint" color="#fbbf24" />
      <Callout fromX="288" fromY="112" toX="126" toY="146" labelX="38" labelY="150" label="LB hero" color="#fdba74" />
      <Callout fromX="472" fromY="112" toX="634" toY="112" labelX="648" labelY="116" label="B hold + X throw" color="#fde68a" />
      <Callout fromX="544" fromY="196" toX="634" toY="146" labelX="648" labelY="150" label="A jump" color="#fca5a5" />
      <Callout fromX="514" fromY="166" toX="634" toY="180" labelX="648" labelY="184" label="X smack / throw held" color="#fda4af" />
      <Callout fromX="574" fromY="166" toX="634" toY="214" labelX="648" labelY="218" label="B grab" color="#c4b5fd" />
      <Callout fromX="544" fromY="136" toX="634" toY="248" labelX="648" labelY="252" label="Y emote" color="#99f6e4" />
      <Callout fromX="380" fromY="137" toX="126" toY="180" labelX="38" labelY="184" label="View players" color="#d9f99d" />
      <Callout fromX="416" fromY="137" toX="126" toY="214" labelX="38" labelY="218" label="Menu adversary" color="#f0abfc" />
      <Callout fromX="286" fromY="184" toX="126" toY="248" labelX="38" labelY="252" label="L3 swap sides" color="#bfdbfe" />
      <Callout fromX="452" fromY="174" toX="634" toY="276" labelX="648" labelY="280" label="R3 spawn ball" color="#fde68a" />
    </svg>
  );
}

function ControlsPanel(props) {
  const source = () => props.source ?? inputSource();
  const isGamepad = () => source() === 'gamepad';
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        width: 'min(100%, 1040px)',
        'align-self': 'center',
        gap: '8px',
        'border-top': '1px solid rgba(255,255,255,0.12)',
        'padding-top': '10px',
        'margin-top': '2px',
      }}
    >
      <div
        style={{
          font: HUD_LABEL_FONT,
          'letter-spacing': '0.08em',
          'text-transform': 'uppercase',
          'text-shadow': HUD_LABEL_SHADOW,
          'text-align': 'center',
        }}
      >
        {isGamepad() ? 'Controller' : 'Keyboard'}
      </div>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          'border-radius': '8px',
        }}
      >
        <Show when={isGamepad()} fallback={<KeyboardControlsImage />}>
          <ControllerControlsImage />
        </Show>
      </div>
    </div>
  );
}

function ColHeader(props) {
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': props.align ?? 'flex-end',
        gap: '2px',
      }}
    >
      {props.children}
      <span
        style={{
          color: 'rgba(255,255,255,0.7)',
          font: HUD_SMALL_LABEL_FONT,
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
          'text-shadow': HUD_LABEL_SHADOW,
        }}
      >
        {props.label}
      </span>
    </div>
  );
}

function ScoreboardView(props) {
  return (
    <div
      id="scoreboard"
      role="dialog"
      aria-label="Scoreboard"
      style={{
        ...HUD_PANEL_STYLE,
        display: (props.state.tabKeyboardHeld || props.state.gamepadScoreboardHeld) ? 'flex' : 'none',
        'flex-direction': 'column',
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(96vw, 1120px)',
        'min-width': 'min(760px, 96vw)',
        'max-width': 'min(96vw, 1120px)',
        'max-height': 'calc(100vh - 48px)',
        'z-index': '101',
        'pointer-events': 'none',
        padding: '14px 16px',
        gap: '10px',
        'box-sizing': 'border-box',
        'user-select': 'none',
        overflow: 'auto',
        '-webkit-overflow-scrolling': 'touch',
        'overflow-x': 'hidden',
      }}
    >
      <div
        style={{
          font: HUD_LABEL_FONT,
          'letter-spacing': '0.08em',
          'text-transform': 'uppercase',
          'text-shadow': HUD_LABEL_SHADOW,
          'text-align': 'center',
        }}
      >
        Players
      </div>

      <Show when={props.state.rows.length > 0}>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': '1fr 72px 72px 56px',
            'align-items': 'end',
            gap: '12px',
            padding: '0 6px',
          }}
        >
          <ColHeader label="Player" align="flex-start">
            <div style={{ height: '22px' }} />
          </ColHeader>
          <ColHeader label="Chase">
            <StaminaBolt size={22} />
          </ColHeader>
          <ColHeader label="Cheese">
            <CheeseItem size={22} />
          </ColHeader>
          <ColHeader label="KOs">
            <HeartHealthHappy size={22} />
          </ColHeader>
        </div>
      </Show>

      <div style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '6px',
        overflow: 'visible',
        padding: '2px 0',
      }}>
        <For each={props.state.rows}>
          {(row, i) => {
            const cs = () => Math.max(0, Number(row.chaseSec) || 0);
            const bg = () => (i() % 2 === 0
              ? 'rgba(0,0,0,0.18)'
              : 'rgba(255,255,255,0.05)');
            return (
              <div
                style={{
                  display: 'grid',
                  'grid-template-columns': '1fr 72px 72px 56px',
                  'align-items': 'center',
                  gap: '12px',
                  padding: '7px 8px',
                  'min-height': '38px',
                  'border-radius': '6px',
                  background: bg(),
                  color: '#fff',
                  font: HUD_LABEL_FONT,
                  'line-height': '1.12',
                  'text-shadow': HUD_LABEL_SHADOW,
                  overflow: 'visible',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                    'min-height': '28px',
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
                    {row.label}
                  </span>
                </span>
                <span style={{ 'text-align': 'right', color: '#fde68a' }}>
                  {cs().toFixed(1)}s
                </span>
                <span style={{ 'text-align': 'right', color: '#fff7c2' }}>
                  {String(Math.max(0, Math.floor(Number(row.cheese) || 0)))}
                </span>
                <span style={{ 'text-align': 'right', color: '#fda4af' }}>
                  {String(Math.max(0, Math.floor(Number(row.deaths) || 0)))}
                </span>
              </div>
            );
          }}
        </For>
        <Show when={props.state.rows.length === 0}>
          <div
            style={{
              color: 'rgba(255,255,255,0.6)',
              font: HUD_LABEL_FONT,
              'text-align': 'center',
              padding: '8px',
              'text-shadow': HUD_LABEL_SHADOW,
            }}
          >
            No players yet
          </div>
        </Show>
      </div>

      <Show when={!props.state.coarsePointer}>
        <ControlsPanel />
      </Show>
    </div>
  );
}

/** Hold Tab (keyboard) or View/Share (gamepad) for player list (multiplayer). */
export class ScoreboardOverlay {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const coarsePointer = typeof window !== 'undefined'
      && window.matchMedia?.('(pointer: coarse)').matches;
    const [state, setState] = createStore({
      tabKeyboardHeld: false,
      gamepadScoreboardHeld: false,
      rows: [],
      coarsePointer,
    });
    this._setState = setState;
    this._dispose = render(() => <ScoreboardView state={state} />, this._mount);

    this._onKeyDown = (e) => {
      if (e.code !== 'Tab') return;
      if (isFormTarget(e.target)) return;
      e.preventDefault();
      if (!state.tabKeyboardHeld) {
        batch(() => this._setState({ tabKeyboardHeld: true }));
      }
    };
    this._onKeyUp = (e) => {
      if (e.code !== 'Tab') return;
      batch(() => this._setState({ tabKeyboardHeld: false }));
    };
    this._onVisibility = () => {
      if (document.hidden) {
        batch(() => this._setState({ tabKeyboardHeld: false, gamepadScoreboardHeld: false }));
      }
    };
    this._onBlur = () => {
      batch(() => this._setState({ tabKeyboardHeld: false, gamepadScoreboardHeld: false }));
    };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('blur', this._onBlur);
  }

  setRows(rows) {
    const next = Array.isArray(rows) ? rows : [];
    batch(() => {
      this._setState({ rows: next });
    });
  }

  /** View / Select / Share held on gamepad — mirrors Tab hold for scoreboard. */
  setGamepadScoreboardHeld(held) {
    batch(() => this._setState({ gamepadScoreboardHeld: !!held }));
  }

  setVisible(visible) {
    this._mount.style.display = visible === false ? 'none' : '';
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('blur', this._onBlur);
    this._dispose();
    this._mount.remove();
  }
}
