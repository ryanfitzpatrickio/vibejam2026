import { For, Show, createSignal, createMemo, batch } from 'solid-js';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_SMALL_LABEL_FONT,
  HUD_LABEL_SHADOW,
  HUD_TRACK_STYLE,
} from './hudStyle.js';

/**
 * Top-left toolbar + settings/leaderboard panels, matching the cartoon metallic
 * panel look used by the main HUD. Keeps the imperative GameToolbar class API
 * consumed by createGameSession (constructor + updateState/setLeaderboardRows/
 * setAllTimeLeaderboards/setDisplayName/setSettingsOpen/setLeaderboardOpen/dispose
 * + .allTimeLeaderboards field) so callers don't have to change.
 */

const BUTTON_SIZE = 44;
const BUTTON_COUNT = 4;

function stopUi(event) {
  event.preventDefault();
  event.stopPropagation();
}
function stopPanel(event) {
  event.stopPropagation();
}

// --- Inline SVG icons (stroke-based, 24x24). -------------------------------
function Icon(props) {
  const common = {
    viewBox: '0 0 24 24',
    width: props.size ?? 22,
    height: props.size ?? 22,
    'aria-hidden': 'true',
    style: { 'pointer-events': 'none', display: 'block' },
  };
  switch (props.name) {
    case 'github':
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 2.5a9.5 9.5 0 0 0-3 18.52c.48.08.66-.2.66-.46v-1.6c-2.68.58-3.24-1.14-3.24-1.14-.44-1.1-1.08-1.4-1.08-1.4-.88-.6.06-.58.06-.58.98.06 1.5 1 1.5 1 .86 1.48 2.28 1.06 2.82.8.1-.62.34-1.06.62-1.3-2.14-.24-4.4-1.06-4.4-4.76 0-1.06.38-1.92 1-2.6-.1-.24-.44-1.22.1-2.56 0 0 .82-.26 2.68 1a9.2 9.2 0 0 1 4.88 0c1.86-1.26 2.68-1 2.68-1 .54 1.34.2 2.32.1 2.56.62.68 1 1.54 1 2.6 0 3.7-2.26 4.52-4.42 4.76.36.3.68.9.68 1.82v2.7c0 .26.18.54.68.46A9.5 9.5 0 0 0 12 2.5z" />
        </svg>
      );
    case 'music':
    case 'musicOff':
      return (
        <svg
          {...common}
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M9 18.2a2.2 2.2 0 1 1-1.2-2v-10l9-1.8v10.2" />
          <path d="M16.8 14.6a2.2 2.2 0 1 1-1.2-2" />
          <line x1="7.8" y1="9" x2="16.8" y2="7.2" />
          <Show when={props.name === 'musicOff'}>
            <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" />
          </Show>
        </svg>
      );
    case 'sfx':
    case 'sfxOff':
      return (
        <svg
          {...common}
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 9.3h3.2l4.2-3.5v12.4l-4.2-3.5H4z" />
          <path d="M15 9.2a4.2 4.2 0 0 1 0 5.6" />
          <path d="M17.8 6.7a8 8 0 0 1 0 10.6" />
          <Show when={props.name === 'sfxOff'}>
            <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" />
          </Show>
        </svg>
      );
    case 'gear':
      return (
        <svg
          {...common}
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3.1" />
          <path d="M19.1 13.4a7.8 7.8 0 0 0 0-2.8l2-1.5-2-3.4-2.4 1a7.4 7.4 0 0 0-2.4-1.4L14 2.7h-4l-.4 2.6a7.4 7.4 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2.8l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 2.4-1.4l2.4 1 2-3.4z" />
        </svg>
      );
    case 'leaderboard':
      return (
        <svg
          {...common}
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="5" y1="19" x2="19" y2="19" />
          <path d="M7 19v-5.6h3V19" />
          <path d="M10.5 19V9h3V19" />
          <path d="M14 19v-7.2h3V19" />
          <path d="M10.4 5.8 12 4.2l1.6 1.6 2.2-.3-1 2 1 2-2.2-.3L12 10.8l-1.6-1.6-2.2.3 1-2-1-2z" />
        </svg>
      );
    case 'close':
      return (
        <svg
          {...common}
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="7" y1="7" x2="17" y2="17" />
          <line x1="17" y1="7" x2="7" y2="17" />
        </svg>
      );
    default:
      return null;
  }
}

// --- Toolbar button --------------------------------------------------------
function ToolbarButton(props) {
  const [hover, setHover] = createSignal(false);
  const bg = () => {
    if (props.pressed) return 'linear-gradient(180deg, #c6463e 0%, #8a2a24 100%)';
    if (hover()) return 'rgba(255,255,255,0.14)';
    return 'transparent';
  };
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.pressed ? 'true' : 'false'}
      onPointerDown={stopUi}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onClick={(e) => {
        stopUi(e);
        props.onClick?.();
      }}
      style={{
        width: `${BUTTON_SIZE}px`,
        height: `${BUTTON_SIZE}px`,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        border: '0',
        'border-right': '2px solid rgba(20,26,36,0.55)',
        background: bg(),
        color: props.pressed ? '#fff2de' : '#fff',
        cursor: 'pointer',
        'touch-action': 'manipulation',
        'user-select': 'none',
        'flex-shrink': '0',
        'box-shadow': props.pressed
          ? 'inset 0 2px 4px rgba(0,0,0,0.45)'
          : 'inset 0 1px 0 rgba(255,255,255,0.08)',
        transition: 'background 0.12s ease',
      }}
    >
      <Icon name={props.icon} size={22} />
    </button>
  );
}

// --- Panel header (title + close) ------------------------------------------
function PanelHeader(props) {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '10px',
        'margin-bottom': '10px',
      }}
    >
      <div
        style={{
          font: HUD_LABEL_FONT,
          'font-size': '18px',
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
          'text-shadow': HUD_LABEL_SHADOW,
          color: '#fff',
        }}
      >
        {props.title}
      </div>
      <button
        type="button"
        title={props.closeTitle}
        aria-label={props.closeTitle}
        onPointerDown={stopUi}
        onClick={(e) => {
          stopUi(e);
          props.onClose?.();
        }}
        style={{
          width: '32px',
          height: '32px',
          'border-radius': '8px',
          border: '2px solid rgba(20,26,36,0.75)',
          background: 'linear-gradient(180deg, #6b7382 0%, #4a525f 100%)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'flex-shrink': '0',
          'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 3px rgba(0,0,0,0.35)',
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

// --- A chunky pill row used for Settings toggles ---------------------------
function SettingRow(props) {
  return (
    <button
      type="button"
      onPointerDown={stopUi}
      onClick={(e) => {
        stopUi(e);
        props.onClick?.();
      }}
      style={{
        ...HUD_TRACK_STYLE,
        width: '100%',
        'min-height': '40px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '12px',
        padding: '0 12px',
        'margin-bottom': '8px',
        color: '#fff',
        font: HUD_LABEL_FONT,
        'text-shadow': HUD_LABEL_SHADOW,
        cursor: 'pointer',
      }}
    >
      <span>{props.label}</span>
      <span
        style={{
          font: HUD_VALUE_FONT,
          color: props.on ? '#a7f3d0' : '#fda4af',
          'text-shadow': HUD_LABEL_SHADOW,
          'flex-shrink': '0',
        }}
      >
        {props.on ? 'On' : 'Off'}
      </span>
    </button>
  );
}

// --- Name input row --------------------------------------------------------
function NameRow(props) {
  let inputRef;
  const [status, setStatus] = createSignal('');

  const commit = () => {
    const value = inputRef?.value ?? '';
    const applied = props.onChange?.(value) ?? value;
    props.onApplied?.(applied);
    setStatus('Saved');
    window.setTimeout(() => setStatus(''), 1200);
  };

  return (
    <div style={{ width: '100%', 'margin-bottom': '10px' }}>
      <div
        style={{
          font: HUD_SMALL_LABEL_FONT,
          color: '#fff',
          'text-shadow': HUD_LABEL_SHADOW,
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
          'margin-bottom': '6px',
        }}
      >
        Name
      </div>
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
        <input
          ref={(el) => {
            inputRef = el;
            if (el) el.value = props.value ?? '';
          }}
          type="text"
          maxlength="24"
          autocomplete="nickname"
          spellcheck={false}
          onPointerDown={stopPanel}
          onClick={stopPanel}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              inputRef?.blur();
            }
          }}
          style={{
            ...HUD_TRACK_STYLE,
            flex: '1 1 auto',
            'min-width': '0',
            height: '38px',
            color: '#fff',
            font: HUD_VALUE_FONT,
            padding: '0 10px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onPointerDown={stopUi}
          onClick={(e) => {
            stopUi(e);
            commit();
          }}
          style={{
            width: '68px',
            height: '38px',
            'border-radius': '10px',
            border: '2px solid rgba(20,26,36,0.75)',
            background: 'linear-gradient(180deg, #d4a24a 0%, #a06f1a 100%)',
            color: '#fff',
            font: HUD_LABEL_FONT,
            'text-shadow': HUD_LABEL_SHADOW,
            'flex-shrink': '0',
            cursor: 'pointer',
            'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 3px rgba(0,0,0,0.4)',
          }}
        >
          Save
        </button>
      </div>
      <div
        style={{
          'min-height': '14px',
          'margin-top': '4px',
          color: '#a7f3d0',
          font: HUD_SMALL_LABEL_FONT,
          'text-shadow': HUD_LABEL_SHADOW,
        }}
      >
        {status()}
      </div>
    </div>
  );
}

function RoomActionButton(props) {
  return (
    <button
      type="button"
      onPointerDown={stopUi}
      onClick={(e) => {
        stopUi(e);
        props.onClick?.();
      }}
      style={{
        'border-radius': '10px',
        border: '2px solid rgba(20,26,36,0.75)',
        background: props.variant === 'secondary'
          ? 'linear-gradient(180deg, #6b7382 0%, #4a525f 100%)'
          : 'linear-gradient(180deg, #d4a24a 0%, #a06f1a 100%)',
        color: '#fff',
        font: HUD_LABEL_FONT,
        'text-shadow': HUD_LABEL_SHADOW,
        cursor: 'pointer',
        'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 3px rgba(0,0,0,0.35)',
        padding: '8px 12px',
        'min-height': '38px',
      }}
    >
      {props.label}
    </button>
  );
}

function RoomRow(props) {
  const [status, setStatus] = createSignal('');

  const runAction = async (fn, successText) => {
    if (!fn) return;
    try {
      const result = await fn();
      setStatus(typeof result === 'string' && result ? result : successText);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    window.setTimeout(() => setStatus(''), 2000);
  };

  return (
    <div style={{ width: '100%', 'margin-bottom': '10px' }}>
      <div
        style={{
          font: HUD_SMALL_LABEL_FONT,
          color: '#fff',
          'text-shadow': HUD_LABEL_SHADOW,
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
          'margin-bottom': '6px',
        }}
      >
        Room
      </div>
      <div
        style={{
          ...HUD_TRACK_STYLE,
          padding: '10px 12px',
          color: '#fff',
          'margin-bottom': '8px',
        }}
      >
        <div style={{ display: 'flex', 'justify-content': 'space-between', gap: '10px', 'margin-bottom': '4px' }}>
          <span style={{ font: HUD_LABEL_FONT, 'text-shadow': HUD_LABEL_SHADOW }}>ID</span>
          <span style={{ font: HUD_VALUE_FONT, 'text-shadow': HUD_LABEL_SHADOW }}>{props.roomId || 'default'}</span>
        </div>
        <div style={{ display: 'flex', 'justify-content': 'space-between', gap: '10px' }}>
          <span style={{ font: HUD_LABEL_FONT, 'text-shadow': HUD_LABEL_SHADOW }}>Mode</span>
          <span style={{ font: HUD_VALUE_FONT, 'text-shadow': HUD_LABEL_SHADOW }}>
            {props.roomVisibility === 'private' ? 'Private' : 'Public'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
        <Show when={props.roomVisibility === 'private'}>
          <RoomActionButton
            label="Copy Invite"
            onClick={() => runAction(() => props.onCopyInvite?.(), 'Copied invite')}
          />
        </Show>
        <RoomActionButton
          label="New Private Room"
          variant={props.roomVisibility === 'private' ? 'secondary' : undefined}
          onClick={() => runAction(() => props.onCreatePrivateRoom?.(), 'Opening private room')}
        />
      </div>
      <div
        style={{
          'min-height': '14px',
          'margin-top': '4px',
          color: '#a7f3d0',
          font: HUD_SMALL_LABEL_FONT,
          'text-shadow': HUD_LABEL_SHADOW,
        }}
      >
        {status()}
      </div>
    </div>
  );
}

// --- Leaderboard sections --------------------------------------------------
function LeaderboardRow(props) {
  return (
    <div
      style={{
        display: 'grid',
        'grid-template-columns': '28px minmax(0, 1fr) 72px',
        'align-items': 'center',
        gap: '8px',
        padding: '4px 6px',
        'border-radius': '6px',
        background: props.zebra ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.05)',
        color: '#fff',
        font: HUD_LABEL_FONT,
        'text-shadow': HUD_LABEL_SHADOW,
      }}
    >
      <span style={{ 'text-align': 'right', color: '#fde68a' }}>{props.rank}</span>
      <span
        style={{
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        {props.name}
      </span>
      <span style={{ 'text-align': 'right', color: '#fff7c2', font: HUD_VALUE_FONT }}>
        {props.value}
      </span>
    </div>
  );
}

function LeaderboardSection(props) {
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '5px', 'margin-bottom': '12px' }}>
      <div
        style={{
          font: HUD_SMALL_LABEL_FONT,
          color: '#fff',
          'text-shadow': HUD_LABEL_SHADOW,
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
        }}
      >
        {props.title}
      </div>
      <Show
        when={props.rows.length > 0}
        fallback={
          <div
            style={{
              color: 'rgba(255,255,255,0.6)',
              font: HUD_SMALL_LABEL_FONT,
              'text-shadow': HUD_LABEL_SHADOW,
            }}
          >
            No scores yet
          </div>
        }
      >
        <For each={props.rows}>
          {(row, i) => (
            <LeaderboardRow
              rank={i() + 1}
              name={row.displayName || 'Mouse'}
              value={props.format(Number(row.value) || 0)}
              zebra={i() % 2 === 0}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

function LiveRoomTable(props) {
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
      <div
        style={{
          font: HUD_SMALL_LABEL_FONT,
          color: '#fff',
          'text-shadow': HUD_LABEL_SHADOW,
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
          'margin-bottom': '4px',
        }}
      >
        Current room
      </div>
      <Show
        when={props.rows.length > 0}
        fallback={
          <div
            style={{
              color: 'rgba(255,255,255,0.6)',
              font: HUD_SMALL_LABEL_FONT,
              'text-shadow': HUD_LABEL_SHADOW,
            }}
          >
            No players yet
          </div>
        }
      >
        <div
          style={{
            display: 'grid',
            'grid-template-columns': '26px minmax(0, 1fr) 54px 50px 38px',
            'align-items': 'end',
            gap: '8px',
            padding: '0 6px',
            font: HUD_SMALL_LABEL_FONT,
            color: 'rgba(255,255,255,0.7)',
            'letter-spacing': '0.06em',
            'text-transform': 'uppercase',
            'text-shadow': HUD_LABEL_SHADOW,
          }}
        >
          <span style={{ 'text-align': 'right' }}>#</span>
          <span>Player</span>
          <span style={{ 'text-align': 'right' }}>Chase</span>
          <span style={{ 'text-align': 'right' }}>Cheese</span>
          <span style={{ 'text-align': 'right' }}>KOs</span>
        </div>
        <For each={props.rows}>
          {(row, i) => (
            <div
              style={{
                display: 'grid',
                'grid-template-columns': '26px minmax(0, 1fr) 54px 50px 38px',
                'align-items': 'center',
                gap: '8px',
                padding: '4px 6px',
                'border-radius': '6px',
                background: i() % 2 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.05)',
                color: '#fff',
                font: HUD_LABEL_FONT,
                'text-shadow': HUD_LABEL_SHADOW,
              }}
            >
              <span style={{ 'text-align': 'right', color: '#fde68a' }}>{i() + 1}</span>
              <span
                style={{
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {row.label || 'Mouse'}
              </span>
              <span style={{ 'text-align': 'right', color: '#fde68a' }}>
                {`${Math.max(0, Number(row.chaseSec) || 0).toFixed(1)}s`}
              </span>
              <span style={{ 'text-align': 'right', color: '#fff7c2' }}>
                {String(Math.max(0, Math.floor(Number(row.cheese) || 0)))}
              </span>
              <span style={{ 'text-align': 'right', color: '#fda4af' }}>
                {String(Math.max(0, Math.floor(Number(row.deaths) || 0)))}
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

// --- Top-level view --------------------------------------------------------
function ToolbarView(props) {
  const s = props.state;

  const mostMischief = createMemo(() => {
    const boards = s.allTimeLeaderboards?.leaderboards ?? s.allTimeLeaderboards ?? {};
    return Array.isArray(boards.mischief) ? boards.mischief : [];
  });
  const totalChase = createMemo(() => {
    const boards = s.allTimeLeaderboards?.leaderboards ?? s.allTimeLeaderboards ?? {};
    return Array.isArray(boards.chaseSeconds) ? boards.chaseSeconds : [];
  });
  const mostCheeseCollected = createMemo(() => {
    const boards = s.allTimeLeaderboards?.leaderboards ?? s.allTimeLeaderboards ?? {};
    return Array.isArray(boards.cheeseCollected) ? boards.cheeseCollected : [];
  });

  const panelBase = {
    position: 'fixed',
    top: `calc(env(safe-area-inset-top, 0px) + ${BUTTON_SIZE + 6}px)`,
    left: 'env(safe-area-inset-left, 6px)',
    'z-index': '12000',
    padding: '14px',
    'box-sizing': 'border-box',
    'max-height': `calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - ${BUTTON_SIZE + 20}px)`,
    overflow: 'auto',
    '-webkit-overflow-scrolling': 'touch',
    'overscroll-behavior': 'contain',
    'touch-action': 'pan-y',
    'pointer-events': 'auto',
    'user-select': 'none',
  };

  return (
    <>
      {/* Toolbar strip */}
      <div
        id="game-toolbar"
        onPointerDown={stopUi}
        style={{
          ...HUD_PANEL_STYLE,
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
          left: 'calc(env(safe-area-inset-left, 0px) + 6px)',
          'z-index': '12000',
          display: 'flex',
          'flex-direction': 'row',
          'align-items': 'center',
          width: `${BUTTON_SIZE * BUTTON_COUNT}px`,
          'max-width': 'calc(100vw - env(safe-area-inset-left, 0px) - 12px)',
          overflow: 'hidden',
          'border-radius': '14px',
          'pointer-events': 'auto',
        }}
      >
        <ToolbarButton
          icon={s.musicMuted ? 'musicOff' : 'music'}
          title={s.musicMuted ? 'Unmute music' : 'Mute music'}
          pressed={s.musicMuted}
          onClick={() => props.onToggleMusic?.()}
        />
        <ToolbarButton
          icon={s.sfxMuted ? 'sfxOff' : 'sfx'}
          title={s.sfxMuted ? 'Unmute sound effects' : 'Mute sound effects'}
          pressed={s.sfxMuted}
          onClick={() => props.onToggleSfx?.()}
        />
        <ToolbarButton
          icon="leaderboard"
          title="Leaderboard"
          pressed={s.leaderboardOpen}
          onClick={() => props.onToggleLeaderboard?.()}
        />
        <ToolbarButton
          icon="gear"
          title="Settings"
          pressed={s.settingsOpen}
          onClick={() => props.onToggleSettings?.()}
        />
      </div>

      {/* Settings panel */}
      <Show when={s.settingsOpen}>
        <div
          id="settings-panel"
          data-scroll-container
          onPointerDown={stopPanel}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...HUD_PANEL_STYLE,
            ...panelBase,
            width: 'min(320px, calc(100vw - env(safe-area-inset-left, 0px) - 12px))',
          }}
        >
          <PanelHeader
            title="Settings"
            closeTitle="Close settings"
            onClose={() => props.onCloseSettings?.()}
          />
          <SettingRow
            label="Music"
            on={!s.musicMuted}
            onClick={() => props.onToggleMusic?.()}
          />
          <SettingRow
            label="Sound effects"
            on={!s.sfxMuted}
            onClick={() => props.onToggleSfx?.()}
          />
          <div
            style={{
              'margin-top': '10px',
              color: 'rgba(255,255,255,0.8)',
              font: HUD_SMALL_LABEL_FONT,
              'text-shadow': HUD_LABEL_SHADOW,
              'line-height': '1.45',
            }}
          >
            WASD to move. Space jumps. Shift sprints. F opens emotes.
          </div>
        </div>
      </Show>

      {/* Leaderboard panel */}
      <Show when={s.leaderboardOpen}>
        <div
          id="leaderboard-panel"
          data-scroll-container
          role="dialog"
          aria-label="Leaderboard"
          onPointerDown={stopPanel}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...HUD_PANEL_STYLE,
            ...panelBase,
            width: 'min(420px, calc(100vw - env(safe-area-inset-left, 0px) - 12px))',
          }}
        >
          <PanelHeader
            title="Leaderboard"
            closeTitle="Close leaderboard"
            onClose={() => props.onCloseLeaderboard?.()}
          />
          <Show when={s.leaderboardStatus}>
            <div
              style={{
                color: 'rgba(255,255,255,0.75)',
                font: HUD_SMALL_LABEL_FONT,
                'text-shadow': HUD_LABEL_SHADOW,
                'margin-bottom': '8px',
              }}
            >
              {s.leaderboardStatus}
            </div>
          </Show>
          <LeaderboardSection
            title="Most Mischief"
            rows={mostMischief()}
            format={(v) => String(Math.max(0, Math.floor(v)))}
          />
          <LeaderboardSection
            title="Total Cat Chase"
            rows={totalChase()}
            format={(v) => `${Math.max(0, Math.round(v))}s`}
          />
          <LeaderboardSection
            title="Most Cheese Collected"
            rows={mostCheeseCollected()}
            format={(v) => String(Math.max(0, Math.floor(v)))}
          />
          <LiveRoomTable rows={s.leaderboardRows} />
        </div>
      </Show>
    </>
  );
}

// --- Class wrapper matching the old imperative API -------------------------
export class GameToolbar {
  constructor({
    container = document.body,
    githubUrl,
    onToggleMusic,
    onToggleSfx,
    onOpenGithub,
    onChangeDisplayName,
    onOpenLeaderboard,
    onCopyInvite,
    onCreatePrivateRoom,
    displayName = 'Mouse',
    leaderboardRows = [],
    allTimeLeaderboards = null,
    roomId = 'default',
    roomVisibility = 'public',
  } = {}) {
    this.container = container;
    this.githubUrl = githubUrl;
    this.onToggleMusic = onToggleMusic;
    this.onToggleSfx = onToggleSfx;
    this.onOpenGithub = onOpenGithub;
    this.onChangeDisplayName = onChangeDisplayName;
    this.onOpenLeaderboard = onOpenLeaderboard;
    this.onCopyInvite = onCopyInvite;
    this.onCreatePrivateRoom = onCreatePrivateRoom;

    this._mount = document.createElement('div');
    container.appendChild(this._mount);

    const [state, setState] = createStore({
      musicMuted: false,
      sfxMuted: false,
      displayName: String(displayName || 'Mouse'),
      roomId: String(roomId || 'default'),
      roomVisibility: roomVisibility === 'private' ? 'private' : 'public',
      leaderboardRows: Array.isArray(leaderboardRows) ? leaderboardRows : [],
      allTimeLeaderboards,
      leaderboardStatus: '',
      settingsOpen: false,
      leaderboardOpen: false,
    });
    this._state = state;
    this._setState = setState;

    this._dispose = render(
      () => (
        <ToolbarView
          state={state}
          onToggleMusic={() => this.onToggleMusic?.()}
          onToggleSfx={() => this.onToggleSfx?.()}
          onOpenGithub={() => {
            if (this.onOpenGithub) this.onOpenGithub();
            else if (this.githubUrl) window.open(this.githubUrl, '_blank', 'noopener,noreferrer');
          }}
          onToggleSettings={() => this.setSettingsOpen(!state.settingsOpen)}
          onToggleLeaderboard={() => {
            const next = !state.leaderboardOpen;
            this.setLeaderboardOpen(next);
            if (next) this.onOpenLeaderboard?.();
          }}
          onCloseSettings={() => this.setSettingsOpen(false)}
          onCloseLeaderboard={() => this.setLeaderboardOpen(false)}
          onChangeDisplayName={(raw) => this.onChangeDisplayName?.(raw) ?? raw}
          onAppliedDisplayName={(applied) => this.setDisplayName(applied)}
          onCopyInvite={() => this.onCopyInvite?.()}
          onCreatePrivateRoom={() => this.onCreatePrivateRoom?.()}
        />
      ),
      this._mount,
    );
  }

  // Match the old compatibility getters/setters.
  get musicMuted() { return this._state.musicMuted; }
  get sfxMuted() { return this._state.sfxMuted; }
  get displayName() { return this._state.displayName; }
  get roomId() { return this._state.roomId; }
  get roomVisibility() { return this._state.roomVisibility; }
  get leaderboardRows() { return this._state.leaderboardRows; }
  get allTimeLeaderboards() { return this._state.allTimeLeaderboards; }
  get leaderboardStatus() { return this._state.leaderboardStatus; }
  get settingsOpen() { return this._state.settingsOpen; }
  get leaderboardOpen() { return this._state.leaderboardOpen; }

  updateState({
    musicMuted = this._state.musicMuted,
    sfxMuted = this._state.sfxMuted,
    displayName = this._state.displayName,
    roomId = this._state.roomId,
    roomVisibility = this._state.roomVisibility,
    leaderboardRows = this._state.leaderboardRows,
    allTimeLeaderboards = this._state.allTimeLeaderboards,
    leaderboardStatus = this._state.leaderboardStatus,
  } = {}) {
    batch(() => {
      this._setState({
        musicMuted: !!musicMuted,
        sfxMuted: !!sfxMuted,
        displayName: String(displayName || 'Mouse'),
        roomId: String(roomId || 'default'),
        roomVisibility: roomVisibility === 'private' ? 'private' : 'public',
        leaderboardRows: Array.isArray(leaderboardRows) ? leaderboardRows : [],
        allTimeLeaderboards,
        leaderboardStatus: String(leaderboardStatus ?? ''),
      });
    });
  }

  setLeaderboardRows(rows) {
    this._setState('leaderboardRows', Array.isArray(rows) ? rows : []);
  }

  setAllTimeLeaderboards(data, status = this._state.leaderboardStatus) {
    batch(() => {
      this._setState({
        allTimeLeaderboards: data,
        leaderboardStatus: String(status ?? ''),
      });
    });
  }

  setDisplayName(displayName) {
    this._setState('displayName', String(displayName || 'Mouse'));
  }

  setSettingsOpen(open) {
    batch(() => {
      const next = !!open;
      this._setState('settingsOpen', next);
      if (next) this._setState('leaderboardOpen', false);
    });
  }

  setLeaderboardOpen(open) {
    batch(() => {
      const next = !!open;
      this._setState('leaderboardOpen', next);
      if (next) this._setState('settingsOpen', false);
    });
  }

  setVisible(visible) {
    this._mount.style.display = visible === false ? 'none' : '';
  }

  dispose() {
    this._dispose?.();
    this._mount.remove();
  }
}
