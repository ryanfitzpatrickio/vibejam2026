import { Show, createEffect, createMemo, createSignal, For, onCleanup } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { HUD_ICONS } from './hudSprites.jsx';
import { actionLabel } from '../input/inputSource.js';
import { getAvatarPortrait, subscribeAvatarPortrait } from '../data/avatarPortraits.js';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT as LABEL_FONT,
  HUD_VALUE_FONT as VALUE_FONT,
  HUD_LABEL_SHADOW as LABEL_SHADOW,
} from './hudStyle.js';

/**
 * Cartoon HUD: metallic rounded panel with icon + fill bar rows for health/stamina,
 * and a combined lives/cheese/live-mice row below.
 */

// --- Layout constants (panel-local px). Tweak here; the panel auto-sizes. ---
const PANEL_PADDING = 12;
const PANEL_WIDTH = 460;
const BAR_HEIGHT = 28;
const ICON_SIZE = 36;
const ROW_GAP = 8;

function Sprite(props) {
  return (
    <Dynamic
      component={HUD_ICONS[props.name]}
      size={props.size ?? ICON_SIZE}
    />
  );
}

function StatBar(props) {
  const pct = () => `${Math.max(0, Math.min(1, props.value())) * 100}%`;
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
      }}
    >
      <Sprite name={props.iconName} size={ICON_SIZE} />
      <div
        style={{
          position: 'relative',
          flex: '1',
          height: `${BAR_HEIGHT}px`,
          'border-radius': `${BAR_HEIGHT / 2}px`,
          background: 'linear-gradient(180deg, #5a6270 0%, #3f4753 100%)',
          'box-shadow': 'inset 0 2px 3px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.14)',
          border: '2px solid rgba(20, 26, 36, 0.85)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '2px',
            bottom: '2px',
            left: '2px',
            width: `calc(${pct()} - 4px)`,
            'min-width': '0',
            'border-radius': `${(BAR_HEIGHT - 4) / 2}px`,
            background: props.fillColor,
            'box-shadow': `inset 0 1.5px 0 ${props.fillHighlight}, inset 0 -1.5px 0 rgba(0,0,0,0.25)`,
            transition: 'width 0.12s ease-out',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: '0',
            display: 'flex',
            'align-items': 'center',
            'padding-left': '14px',
            color: '#fff',
            font: LABEL_FONT,
            'letter-spacing': '0.04em',
            'text-shadow': LABEL_SHADOW,
            'pointer-events': 'none',
          }}
        >
          {props.label}
        </div>
      </div>
      <div
        style={{
          'min-width': '72px',
          'text-align': 'right',
          color: '#fff',
          font: VALUE_FONT,
          'text-shadow': LABEL_SHADOW,
        }}
      >
        {props.valueText()}
      </div>
    </div>
  );
}

function LivesCell(props) {
  const slots = createMemo(() => {
    const max = Math.max(1, Math.min(3, Math.floor(Number(props.maxLives?.() ?? 2))));
    const cur = Math.max(0, Math.min(max, Math.floor(Number(props.lives?.() ?? 0))));
    return Array.from({ length: max }, (_, i) => (i < cur ? 'HEART_LIFE_FULL' : 'HEART_LIFE_LOST'));
  });

  return (
    <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        <For each={slots()}>{(name) => <Sprite name={name} size={34} />}</For>
      </div>
      <div
        style={{
          color: '#fff',
          font: LABEL_FONT,
          'letter-spacing': '0.04em',
          'text-shadow': LABEL_SHADOW,
          'line-height': '1.05',
        }}
      >
        LIVES
      </div>
    </div>
  );
}

function Counter(props) {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
      }}
    >
      <Sprite name={props.iconName} size={48} />
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          'line-height': '1.05',
        }}
      >
        <div
          style={{
            color: props.labelColor,
            font: LABEL_FONT,
            'letter-spacing': '0.04em',
            'text-shadow': LABEL_SHADOW,
          }}
        >
          {props.label}
        </div>
        <div
          style={{
            color: '#fff',
            font: VALUE_FONT,
            'text-shadow': LABEL_SHADOW,
          }}
        >
          {props.valueText()}
        </div>
      </div>
    </div>
  );
}

function StatusDot(props) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '10px',
        height: '10px',
        'border-radius': '999px',
        background: props.color,
        'box-shadow': `0 0 0 2px rgba(12,18,26,0.45), 0 0 8px ${props.glow ?? props.color}`,
        'flex-shrink': '0',
      }}
    />
  );
}

function LiveCountsRow(props) {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '14px',
        'justify-self': 'end',
        'min-width': '0',
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          color: '#fff',
          font: VALUE_FONT,
          'text-shadow': LABEL_SHADOW,
          'white-space': 'nowrap',
        }}
      >
        <StatusDot color="#62df7c" glow="rgba(98,223,124,0.7)" />
        <span>{Math.max(0, Math.floor(Number(props.connectedCount) || 0))}</span>
      </div>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          color: '#d8dee8',
          font: VALUE_FONT,
          'text-shadow': LABEL_SHADOW,
          'white-space': 'nowrap',
        }}
      >
        <StatusDot color="#8e98a8" glow="rgba(142,152,168,0.45)" />
        <span>{Math.max(0, Math.floor(Number(props.botCount) || 0))}</span>
      </div>
    </div>
  );
}

function formatSeconds(value) {
  return `${Math.max(0, Number(value) || 0).toFixed(1)}s`;
}

const HERO_NAMES = Object.freeze({
  brain: 'The Brain',
  jerry: 'Jerry',
  gus: 'Gus',
  speedy: 'Speedy',
});

const HERO_ICON_NAMES = Object.freeze({
  brain: 'HERO_BRAIN',
  jerry: 'HERO_JERRY',
  gus: 'HERO_GUS',
  speedy: 'HERO_SPEEDY',
});

function HumanRoleRow(props) {
  const role = () => props.state.humanRole ?? { mode: 'off' };
  const mode = () => role().mode;
  const isAvailable = () => mode() === 'available';
  const isLocal = () => mode() === 'local';
  const hiding = () => !!role().hiding;
  const statusText = () => {
    if (isAvailable()) return 'OPEN';
    return hiding() ? 'HIDING' : 'SEEN';
  };
  const statusColor = () => {
    if (isAvailable()) return '#ffe08a';
    return hiding() ? '#9dffb1' : '#ffcf8a';
  };
  const subtitle = () => {
    if (isAvailable()) return 'Adversary available';
    if (isLocal()) return 'You are the human';
    const dn = role().displayName || 'A player';
    return `${dn} is the human`;
  };

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
      }}
    >
      <Sprite name="HUMAN_ROLE" size={ICON_SIZE} />
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          'line-height': '1.1',
          flex: '1',
          'min-width': '0',
        }}
      >
        <div
          style={{
            display: 'flex',
            'align-items': 'baseline',
            gap: '8px',
          }}
        >
          <div
            style={{
              color: statusColor(),
              font: LABEL_FONT,
              'letter-spacing': '0.06em',
              'text-shadow': LABEL_SHADOW,
            }}
          >
            HUMAN: {statusText()}
          </div>
          <Show when={!isAvailable()}>
            <div
              style={{
                color: '#fff',
                font: VALUE_FONT,
                'text-shadow': LABEL_SHADOW,
              }}
            >
              {formatSeconds(role().streakSeconds)}
              <span style={{ color: '#cdd6e8', opacity: '0.85' }}>
                {' / '}{formatSeconds(role().safeSeconds)}
              </span>
            </div>
          </Show>
        </div>
        <div
          style={{
            color: '#dce8ff',
            font: LABEL_FONT,
            'text-shadow': LABEL_SHADOW,
            'white-space': 'nowrap',
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
          }}
        >
          {subtitle()}
        </div>
      </div>
    </div>
  );
}

function HeroPortrait(props) {
  const [version, setVersion] = createSignal(0);
  createEffect(() => {
    const key = props.heroKey;
    if (!key) return undefined;
    const unsubscribe = subscribeAvatarPortrait(key, () => setVersion((count) => count + 1));
    onCleanup(unsubscribe);
    return undefined;
  });
  const meta = () => {
    version();
    return props.heroKey ? getAvatarPortrait(props.heroKey) : null;
  };

  return (
    <div
      style={{
        width: `${ICON_SIZE}px`,
        height: `${ICON_SIZE}px`,
        'border-radius': '999px',
        overflow: 'hidden',
        border: '2px solid rgba(210, 220, 236, 0.9)',
        'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 6px rgba(0,0,0,0.35)',
        background: 'radial-gradient(circle at 35% 30%, rgba(140,150,170,0.95) 0%, rgba(72,80,96,0.98) 100%)',
        display: 'grid',
        'place-items': 'center',
        'flex-shrink': '0',
      }}
    >
      <Show
        when={meta()}
        fallback={<Sprite name={props.fallbackIconName} size={ICON_SIZE - 4} />}
      >
        {(resolved) => (
          <img
            src={resolved().resolvedSrc}
            alt=""
            aria-hidden="true"
            draggable="false"
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              'object-fit': 'contain',
              'object-position': `${resolved().basePositionX}% ${resolved().basePositionY}%`,
              'transform-origin': 'center center',
              transform: `translate(${resolved().translateX ?? 0}%, ${resolved().translateY ?? 0}%) scale(${resolved().scale ?? 1.02})`,
            }}
          />
        )}
      </Show>
    </div>
  );
}

function HeroStatusRow(props) {
  const heroKey = () => props.state.heroAvatar ?? null;
  const heroName = () => HERO_NAMES[heroKey()] ?? 'Hero';
  const heroIconName = () => HERO_ICON_NAMES[heroKey()] ?? 'HERO_BRAIN';
  const timerText = () => formatSeconds(props.state.heroTimeRemaining);

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
        'justify-self': 'end',
        'min-width': '0',
      }}
    >
      <HeroPortrait heroKey={heroKey()} fallbackIconName={heroIconName()} />
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'flex-end',
          'line-height': '1.1',
          'min-width': '0',
        }}
      >
        <div
          style={{
            color: '#ffe08a',
            font: LABEL_FONT,
            'letter-spacing': '0.06em',
            'text-shadow': LABEL_SHADOW,
            'white-space': 'nowrap',
          }}
        >
          HERO: {heroName()}
        </div>
        <div
          style={{
            color: '#dce8ff',
            font: VALUE_FONT,
            'text-shadow': LABEL_SHADOW,
            'white-space': 'nowrap',
          }}
        >
          {timerText()}
        </div>
      </div>
    </div>
  );
}

export function HudView(props) {
  const healthPct = () => props.state.health;
  const staminaPct = () => props.state.stamina;
  const humanRoleActive = () => (props.state.humanRole?.mode ?? 'off') !== 'off';

  const healthText = createMemo(() => {
    const v = Math.round((props.state.health ?? 0) * 100);
    return `${v}/100`;
  });
  const staminaText = createMemo(() => {
    const v = Math.round((props.state.stamina ?? 0) * 100);
    return `${v}/100`;
  });

  const cheeseMax = createMemo(() => Math.max(1, Math.floor(Number(props.state.cheeseMax ?? 50))));
  const cheeseText = createMemo(() => {
    const n = Math.max(0, Math.floor(Number(props.state.cheese) || 0));
    return `${n} / ${cheeseMax()}`;
  });
  const heroTimeActive = () => Math.max(0, Number(props.state.heroTimeRemaining) || 0) > 0;
  const heroStatusActive = () => heroTimeActive() && !!props.state.heroAvatar;

  return (
    <>
      <div
        id="hud"
        style={{
          ...HUD_PANEL_STYLE,
          position: 'fixed',
          bottom: '20px',
          left: '20px',
          'pointer-events': 'none',
          'z-index': '100',
          'user-select': 'none',
          width: `${PANEL_WIDTH}px`,
          padding: `${PANEL_PADDING}px`,
          display: 'flex',
          'flex-direction': 'column',
          gap: `${ROW_GAP}px`,
        }}
      >
        <StatBar
          iconName="HEART_HEALTH_HAPPY"
          label="HEALTH"
          valueText={healthText}
          value={healthPct}
          fillColor="linear-gradient(180deg, #ff6a6a 0%, #c9302c 100%)"
          fillHighlight="rgba(255,190,190,0.6)"
        />
        <StatBar
          iconName="STAMINA_BOLT"
          label="STAMINA"
          valueText={staminaText}
          value={staminaPct}
          fillColor="linear-gradient(180deg, #7ee084 0%, #3a8a46 100%)"
          fillHighlight="rgba(200,245,205,0.6)"
        />

        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'center',
            gap: '10px',
          }}
        >
          <LivesCell
            lives={() => props.state.lives}
            maxLives={() => props.state.maxLives ?? 2}
          />
          <Counter
            iconName="CHEESE_ITEM"
            label="CHEESE:"
            labelColor="#f6d98a"
            valueText={cheeseText}
          />
          <LiveCountsRow
            connectedCount={props.state.connectedCount}
            botCount={props.state.botCount}
          />
        </div>

        <Show when={humanRoleActive() || heroStatusActive()}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': humanRoleActive() && heroStatusActive() ? '1fr 1fr' : '1fr',
              gap: '10px',
              'align-items': 'center',
            }}
          >
            <Show when={humanRoleActive()}>
              <HumanRoleRow state={props.state} />
            </Show>
            <Show when={heroStatusActive()}>
              <HeroStatusRow state={props.state} />
            </Show>
          </div>
        </Show>
      </div>

      <Show when={props.state.hint}>
        <div
          style={{
            position: 'fixed',
            top: '14%',
            left: '50%',
            transform: 'translateX(-50%)',
            'pointer-events': 'none',
            'z-index': '120',
            'user-select': 'none',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'rgba(16, 20, 28, 0.72)',
            border: '1px solid rgba(255,255,255,0.18)',
            'border-radius': '999px',
            color: '#fff',
            font: LABEL_FONT,
            'letter-spacing': '0.04em',
            'text-shadow': LABEL_SHADOW,
            'backdrop-filter': 'blur(4px)',
          }}
        >
          <Show when={props.state.hint?.action || props.state.hint?.key}>
            <span
              style={{
                display: 'inline-block',
                'min-width': '22px',
                padding: '2px 6px',
                'border-radius': '6px',
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.28)',
                'text-align': 'center',
                'font-size': '11px',
              }}
            >
              {props.state.hint?.action ? actionLabel(props.state.hint.action) : props.state.hint.key}
            </span>
          </Show>
          <span>{props.state.hint?.text}</span>
        </div>
      </Show>

      <Show when={!props.state.alive && props.state.respawnCountdown > 0}>
        <div
          style={{
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            'z-index': '150',
            'pointer-events': 'none',
            'font-family': 'monospace',
            'user-select': 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              'z-index': '1',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'max-content',
              color: '#ff4444',
              'font-size': '24px',
              'text-shadow': '2px 2px 4px #000',
            }}
          >
            RESPAWNING IN {Math.ceil(props.state.respawnCountdown)}
          </div>
        </div>
      </Show>
    </>
  );
}
