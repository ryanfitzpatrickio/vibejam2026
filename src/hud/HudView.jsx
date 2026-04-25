import { Show, createEffect, createMemo, createSignal, For, onCleanup } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { HUD_ICONS } from './hudSprites.jsx';
import { actionLabel } from '../input/inputSource.js';
import { getAvatarPortrait, subscribeAvatarPortrait } from '../data/avatarPortraits.js';
import {
  HUD_PANEL_STYLE,
  HUD_COLORS,
  HUD_LABEL_FONT as LABEL_FONT,
  HUD_VALUE_FONT as VALUE_FONT,
  HUD_LABEL_SHADOW as LABEL_SHADOW,
} from './hudStyle.js';

/**
 * Angular raid HUD: compact panel with icon + skewed fill bar rows for
 * health/stamina, and a combined lives/cheese/live-mice row below.
 */

// --- Layout constants (panel-local px). Tweak here; the panel auto-sizes. ---
const PANEL_PADDING = 12;
const PANEL_WIDTH = 430;
const BAR_HEIGHT = 22;
const ICON_SIZE = 34;
const ROW_GAP = 8;

const IS_MOBILE = typeof window !== 'undefined'
  && ((window.matchMedia?.('(pointer: coarse)')?.matches ?? false)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

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
          'border-radius': '0',
          background: 'rgba(40,30,55,0.82)',
          'box-shadow': 'inset 0 2px 3px rgba(0,0,0,0.58), 0 1px 0 rgba(255,255,255,0.12)',
          border: '1.5px solid rgba(255,255,255,0.16)',
          overflow: 'hidden',
          transform: 'skewX(-8deg)',
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
            'border-radius': '0',
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
            transform: 'skewX(8deg)',
          }}
        >
          {props.label}
        </div>
      </div>
      <div
        style={{
          'min-width': '56px',
          'text-align': 'right',
          color: '#fff',
          font: VALUE_FONT,
          'font-size': '15px',
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
        'border-radius': '0',
        background: props.color,
        'box-shadow': `0 0 0 2px rgba(12,18,26,0.45), 0 0 8px ${props.glow ?? props.color}`,
        'flex-shrink': '0',
        transform: 'skewX(-8deg)',
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

function hintItems(hint) {
  if (!hint) return [];
  if (Array.isArray(hint.items) && hint.items.length > 0) return hint.items;
  return [hint];
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
  const size = () => Math.max(18, Math.floor(Number(props.size) || ICON_SIZE));
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
        width: `${size()}px`,
        height: `${size()}px`,
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
        fallback={<Sprite name={props.fallbackIconName} size={size() - 4} />}
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

function HeroAvailableBadge(props) {
  const heroKey = () => props.state.heroAvatarAvailable ?? 'brain';
  const heroName = () => HERO_NAMES[heroKey()] ?? 'Hero';
  const heroIconName = () => HERO_ICON_NAMES[heroKey()] ?? 'HERO_BRAIN';
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'flex-end',
        gap: '7px',
        padding: '5px 8px',
        border: `1.5px solid ${HUD_COLORS.amber}`,
        background: 'linear-gradient(135deg, rgba(255,224,128,0.22) 0%, rgba(200,176,232,0.16) 100%)',
        'clip-path': 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.18), 2px 2px 0 rgba(0,0,0,0.3)',
        'min-width': '0',
        'justify-self': 'end',
      }}
    >
      <HeroPortrait heroKey={heroKey()} fallbackIconName={heroIconName()} size={26} />
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'flex-end',
          'line-height': '1.02',
          'min-width': '0',
        }}
      >
        <div
          style={{
            color: HUD_COLORS.amber,
            font: LABEL_FONT,
            'font-size': '12px',
            'letter-spacing': '0.08em',
            'text-shadow': LABEL_SHADOW,
            'white-space': 'nowrap',
          }}
        >
          HERO READY
        </div>
        <div
          style={{
            color: '#fff',
            font: VALUE_FONT,
            'font-size': '11px',
            'text-shadow': LABEL_SHADOW,
            'white-space': 'nowrap',
          }}
        >
          {actionLabel('heroActivate')} {heroName()}
        </div>
      </div>
    </div>
  );
}

const MOBILE_BOTTOM_HUD_GLASS = {
  background: 'linear-gradient(160deg, rgba(72,66,82,0.4) 0%, rgba(40,36,50,0.5) 100%)',
  border: '1px solid rgba(210,195,230,0.35)',
  'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.2)',
  'backdrop-filter': 'blur(5px)',
  'WebkitBackdropFilter': 'blur(5px)',
};

function MobileStatBar(props) {
  const pct = () => `${Math.max(0, Math.min(1, props.value())) * 100}%`;
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
      }}
    >
      <Sprite name={props.iconName} size={19} />
      <div
        style={{
          position: 'relative',
          flex: '1',
          height: '10px',
          background: 'rgba(32,24,45,0.45)',
          'box-shadow': 'inset 0 1px 1px rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.14)',
          overflow: 'hidden',
          transform: 'skewX(-8deg)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '1px',
            bottom: '1px',
            left: '1px',
            width: `calc(${pct()} - 2px)`,
            'min-width': '0',
            background: props.fillColor,
            'box-shadow': `inset 0 1px 0 ${props.fillHighlight}`,
            transition: 'width 0.12s ease-out',
          }}
        />
      </div>
    </div>
  );
}

const MISCHIEF_METER_TARGET = 300;

function MobileHud(props) {
  const healthPct = () => props.state.health;
  const staminaPct = () => props.state.stamina;
  const mischiefPct = () => Math.max(0, Math.min(1, (Number(props.state.mischiefScore) || 0) / MISCHIEF_METER_TARGET));
  return (
    <div
      id="hud"
      style={{
        ...HUD_PANEL_STYLE,
        ...MOBILE_BOTTOM_HUD_GLASS,
        position: 'fixed',
        bottom: 'max(4px, env(safe-area-inset-bottom))',
        left: '54%',
        transform: 'translateX(-50%)',
        'pointer-events': 'none',
        'z-index': '100',
        'user-select': 'none',
        width: 'min(270px, calc(100vw - 180px))',
        padding: '7px 9px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '5px',
      }}
    >
      <MobileStatBar
        iconName="HEART_HEALTH_HAPPY"
        value={healthPct}
        fillColor={`linear-gradient(90deg, ${HUD_COLORS.coral} 0%, ${HUD_COLORS.coralHot} 100%)`}
        fillHighlight="rgba(255,226,236,0.72)"
      />
      <MobileStatBar
        iconName="STAMINA_BOLT"
        value={staminaPct}
        fillColor={`linear-gradient(90deg, ${HUD_COLORS.mint} 0%, ${HUD_COLORS.mintHot} 100%)`}
        fillHighlight="rgba(222,255,242,0.72)"
      />
      <MobileStatBar
        iconName="CHEESE_ITEM"
        value={mischiefPct}
        fillColor={`linear-gradient(90deg, ${HUD_COLORS.coral} 0%, ${HUD_COLORS.lavender} 50%, ${HUD_COLORS.cyan} 100%)`}
        fillHighlight="rgba(255,236,255,0.72)"
      />
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

  const heroTimeActive = () => Math.max(0, Number(props.state.heroTimeRemaining) || 0) > 0;
  const heroStatusActive = () => heroTimeActive() && !!props.state.heroAvatar;
  const heroAvailableActive = () => !!props.state.heroAvailable && !heroStatusActive() && props.state.alive !== false;

  if (IS_MOBILE) {
    return (
      <>
        <MobileHud state={props.state} />

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
              'flex-direction': 'column',
              'align-items': 'center',
              gap: '6px',
            }}
          >
            <For each={hintItems(props.state.hint)}>{(hint) => (
              <div
                style={{
                  ...HUD_PANEL_STYLE,
                  display: 'flex',
                  'align-items': 'center',
                  gap: '6px',
                  padding: '5px 10px',
                  color: '#fff',
                  font: LABEL_FONT,
                  'font-size': '11px',
                  'letter-spacing': '0.04em',
                  'text-shadow': LABEL_SHADOW,
                }}
              >
                <Show when={hint?.action || hint?.key}>
                  <span
                    style={{
                      display: 'inline-block',
                      'min-width': '18px',
                      padding: '1px 5px',
                      background: 'rgba(255,224,128,0.2)',
                      border: `1px solid ${HUD_COLORS.amber}`,
                      color: HUD_COLORS.amber,
                      'text-align': 'center',
                      'font-size': '10px',
                    }}
                  >
                    {hint?.action ? actionLabel(hint.action) : hint?.key}
                  </span>
                </Show>
                <span>{hint?.text}</span>
              </div>
            )}</For>
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
              background: 'radial-gradient(circle at 50% 45%, rgba(34,26,49,0.42) 0%, rgba(0,0,0,0.78) 68%)',
              'z-index': '150',
              'pointer-events': 'none',
              'font-family': '"Fredoka", "Baloo", system-ui, sans-serif',
              'user-select': 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'max-content',
                color: HUD_COLORS.coral,
                font: LABEL_FONT,
                'font-size': 'clamp(20px, 5vw, 36px)',
                'letter-spacing': '0.08em',
                'text-transform': 'uppercase',
                'text-shadow': LABEL_SHADOW,
              }}
            >
              RESPAWNING IN {Math.ceil(props.state.respawnCountdown)}
            </div>
          </div>
        </Show>
      </>
    );
  }

  const mischiefPct = () => Math.max(0, Math.min(1, (Number(props.state.mischiefScore) || 0) / MISCHIEF_METER_TARGET));
  const mischiefText = () => {
    const n = Math.max(0, Math.floor(Number(props.state.mischiefScore) || 0));
    return `${n}/${MISCHIEF_METER_TARGET}`;
  };

  return (
    <>
      <div
        id="hud"
        style={{
          ...HUD_PANEL_STYLE,
          position: 'fixed',
          bottom: 'max(20px, env(safe-area-inset-bottom))',
          left: '20px',
          'pointer-events': 'none',
          'z-index': '100',
          'user-select': 'none',
          width: `min(${PANEL_WIDTH}px, calc(100vw - 40px))`,
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
          fillColor={`linear-gradient(90deg, ${HUD_COLORS.coral} 0%, ${HUD_COLORS.coralHot} 100%)`}
          fillHighlight="rgba(255,226,236,0.72)"
        />
        <StatBar
          iconName="STAMINA_BOLT"
          label="STAMINA"
          valueText={staminaText}
          value={staminaPct}
          fillColor={`linear-gradient(90deg, ${HUD_COLORS.mint} 0%, ${HUD_COLORS.mintHot} 100%)`}
          fillHighlight="rgba(222,255,242,0.72)"
        />

        <StatBar
          iconName="CHEESE_ITEM"
          label="MISCHIEF"
          valueText={mischiefText}
          value={mischiefPct}
          fillColor={`linear-gradient(90deg, ${HUD_COLORS.coral} 0%, ${HUD_COLORS.lavender} 50%, ${HUD_COLORS.cyan} 100%)`}
          fillHighlight="rgba(255,236,255,0.72)"
        />

        <Show when={humanRoleActive() || heroStatusActive() || heroAvailableActive()}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': humanRoleActive() && (heroStatusActive() || heroAvailableActive()) ? '1fr auto' : '1fr',
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
            <Show when={heroAvailableActive()}>
              <HeroAvailableBadge state={props.state} />
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
            'flex-direction': 'column',
            'align-items': 'center',
            gap: '8px',
          }}
        >
          <For each={hintItems(props.state.hint)}>{(hint) => (
            <div
              style={{
                ...HUD_PANEL_STYLE,
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                padding: '7px 14px',
                color: '#fff',
                font: LABEL_FONT,
                'letter-spacing': '0.04em',
                'text-shadow': LABEL_SHADOW,
              }}
            >
              <Show when={hint?.action || hint?.key}>
                <span
                  style={{
                    display: 'inline-block',
                    'min-width': '22px',
                    padding: '2px 6px',
                    'border-radius': '0',
                    background: 'rgba(255,224,128,0.2)',
                    border: `1px solid ${HUD_COLORS.amber}`,
                    color: HUD_COLORS.amber,
                    'text-align': 'center',
                    'font-size': '11px',
                  }}
                >
                  {hint?.action ? actionLabel(hint.action) : hint?.key}
                </span>
              </Show>
              <span>{hint?.text}</span>
            </div>
          )}</For>
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
            background: 'radial-gradient(circle at 50% 45%, rgba(34,26,49,0.42) 0%, rgba(0,0,0,0.78) 68%)',
            'z-index': '150',
            'pointer-events': 'none',
            'font-family': '"Fredoka", "Baloo", system-ui, sans-serif',
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
              color: HUD_COLORS.coral,
              font: LABEL_FONT,
              'font-size': 'clamp(24px, 5vw, 48px)',
              'letter-spacing': '0.08em',
              'text-transform': 'uppercase',
              'text-shadow': LABEL_SHADOW,
            }}
          >
            RESPAWNING IN {Math.ceil(props.state.respawnCountdown)}
          </div>
        </div>
      </Show>
    </>
  );
}
