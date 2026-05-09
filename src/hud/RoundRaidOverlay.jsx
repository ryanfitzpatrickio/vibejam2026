import { For, Show, createMemo } from 'solid-js';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { batch } from 'solid-js';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_SMALL_LABEL_FONT,
  HUD_LABEL_SHADOW,
  HUD_COLORS,
  HUD_SLANTED,
} from './hudStyle.js';
import { MouseHeadTarget, CheeseItem, StaminaBolt, HeartLifeFull, HeartLifeLost } from './hudSprites.jsx';
import { actionLabel } from '../input/inputSource.js';

const IS_MOBILE = typeof window !== 'undefined'
  && ((window.matchMedia?.('(pointer: coarse)')?.matches ?? false)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

/** Lighter + smaller type for touch / small viewports. */
function isTopCompact() {
  if (typeof window === 'undefined') return false;
  return (typeof window.innerWidth === 'number' && window.innerWidth <= 900)
    || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0);
}

function BarStatusDot(props) {
  const glow = () => props.glow ?? props.color;
  return (
    <span
      aria-hidden="true"
      style={{
        width: '9px',
        height: '9px',
        'border-radius': '999px',
        background: props.color,
        'box-shadow': `0 0 0 2px rgba(12,18,26,0.45), 0 0 6px ${glow()}`,
        'flex-shrink': '0',
      }}
    />
  );
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function connectionColor(connected, ping) {
  if (!connected) {
    return { color: '#8e98a8', glow: 'rgba(142,152,168,0.45)' };
  }
  const ms = Number(ping);
  if (!Number.isFinite(ms) || ms <= 0) {
    return { color: '#62df7c', glow: 'rgba(98,223,124,0.7)' };
  }
  if (ms < 110) return { color: '#62df7c', glow: 'rgba(98,223,124,0.7)' };
  if (ms < 220) return { color: '#ffe08a', glow: 'rgba(255,224,138,0.65)' };
  return { color: '#ff6f91', glow: 'rgba(255,111,145,0.65)' };
}

function latencyText(ping) {
  const ms = Math.max(0, Math.round(Number(ping) || 0));
  return `${ms}ms`;
}

function gradeForRound(row) {
  const score = Math.max(0, Math.floor(Number(row?.finalScore) || 0));
  const thresholds = [
    { grade: 'S', min: 900 },
    { grade: 'A', min: 600 },
    { grade: 'B', min: 350 },
    { grade: 'C', min: 180 },
    { grade: 'D', min: 60 },
  ];
  let grade = 'F';
  for (const step of thresholds) {
    if (score >= step.min) {
      grade = step.grade;
      break;
    }
  }
  if (!row?.extracted && ['S', 'A', 'B'].includes(grade)) grade = 'C';
  return grade;
}

function titleForRound(row) {
  const cheese = Math.max(0, Math.floor(Number(row?.cheese) || 0));
  const mischief = Math.max(0, Math.floor(Number(row?.mischief) || 0));
  const survival = Math.max(0, Math.round(Number(row?.survival) || 0));
  const smacks = Math.max(0, Math.floor(Number(row?.smacksLanded) || 0));
  const tasks = Math.max(
    Math.floor(Number(row?.tasksCompletedCount) || 0),
    Array.isArray(row?.completedTaskIds) ? row.completedTaskIds.length : 0,
  );
  if (!row?.extracted && cheese <= 0) return 'Pantry Casualty';
  if (tasks >= 2) return 'Kitchen Saboteur';
  if (mischief >= 250) return 'Chaos Nibbler';
  if (survival >= 20) return 'Cat Tease';
  if (smacks >= 4) return 'Countertop Menace';
  if (row?.extracted && cheese >= 30) return 'Certified Crumb Goblin';
  if (row?.extracted) return 'Cheese Courier';
  return 'Almost Escaped';
}

function rowName(row, fallback) {
  return typeof row?.displayName === 'string' && row.displayName.trim()
    ? row.displayName.trim()
    : String(row?.id ?? fallback).slice(0, 10);
}

function buildGradeCard(row) {
  if (!row) return null;
  const cheese = Math.max(0, Math.floor(Number(row.cheese) || 0));
  const mischief = Math.max(0, Math.floor(Number(row.mischief) || 0));
  const survival = Math.max(0, Math.round(Number(row.survival) || 0));
  const smacks = Math.max(0, Math.floor(Number(row.smacksLanded) || 0));
  const grabs = Math.max(0, Math.floor(Number(row.grabsInitiated) || 0));
  const throws = Math.max(0, Math.floor(Number(row.throwsLanded) || 0));
  const tasks = Math.max(
    Math.floor(Number(row.tasksCompletedCount) || 0),
    Array.isArray(row.completedTaskIds) ? row.completedTaskIds.length : 0,
  );
  return {
    grade: gradeForRound(row),
    title: titleForRound(row),
    name: rowName(row, 'you'),
    extracted: !!row.extracted,
    stats: [
      { label: 'Cheese stolen', value: cheese },
      { label: 'Mischief', value: mischief },
      { label: 'Cat chase', value: `${survival}s` },
      { label: 'Tasks', value: tasks },
      { label: 'Smacks', value: smacks },
      { label: 'Grabs/throws', value: `${grabs}/${throws}` },
    ],
  };
}

function topAward(results, label, valueLabel, valueFn, minValue = 1) {
  let best = null;
  let bestValue = -Infinity;
  for (const row of results) {
    const value = Number(valueFn(row)) || 0;
    if (value > bestValue) {
      best = row;
      bestValue = value;
    }
  }
  if (!best || bestValue < minValue) return null;
  return {
    label,
    name: rowName(best, label),
    value: valueLabel(bestValue, best),
  };
}

function buildRoundAwards(results) {
  if (!Array.isArray(results) || results.length === 0) return [];
  return [
    topAward(results, 'Most Cheese', (v) => `${Math.floor(v)} stolen`, (row) => row.cheese),
    topAward(results, 'Loudest Mouse', (v) => `${Math.floor(v)} mischief`, (row) => row.mischief),
    topAward(results, 'Longest Chase', (v) => `${Math.round(v)}s`, (row) => row.survival),
    topAward(results, 'Biggest Bully', (v) => `${Math.floor(v)} smacks`, (row) => row.smacksLanded),
    topAward(results, 'Task Gremlin', (v) => `${Math.floor(v)} tasks`, (row) => (
      Number(row.tasksCompletedCount) || (Array.isArray(row.completedTaskIds) ? row.completedTaskIds.length : 0)
    )),
    topAward(results, 'Clean Getaway', (_v, row) => `${Math.floor(Number(row.finalScore) || 0)} score`, (row) => (
      row.extracted ? Number(row.finalScore) || 0 : 0
    )),
  ].filter(Boolean).slice(0, 5);
}

function buildRoundShareText({ title, grade, awards }) {
  const lines = [title];
  if (grade) {
    lines.push(`Mischievery Grade: ${grade.grade} - ${grade.title}`);
    for (const item of grade.stats) lines.push(`${item.label}: ${item.value}`);
  }
  if (Array.isArray(awards) && awards.length > 0) {
    lines.push(`Awards: ${awards.map((award) => `${award.label} (${award.name})`).join(', ')}`);
  }
  return lines.join('\n');
}

/** Lighter, smaller top strip on mobile so the kitchen view stays readable. */
const MOBILE_TOP_GLASS = {
  background: 'linear-gradient(160deg, rgba(72,66,82,0.38) 0%, rgba(40,36,50,0.5) 100%)',
  border: '1px solid rgba(210,195,230,0.38)',
  'box-shadow': 'inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.2)',
  'backdrop-filter': 'blur(5px)',
  WebkitBackdropFilter: 'blur(5px)',
};

function RoundPhaseTopRow(props) {
  const compact = isTopCompact();
  const iconSize = compact ? 20 : 26;
  const fontSize = compact ? '12px' : '14px';
  const phaseFontSize = compact ? 'clamp(10px, 2.6vw, 12px)' : null;
  const mobilePhaseHalfWidthPx = 56;
  const lifeSlots = createMemo(() => {
    const max = Math.max(1, Math.min(3, Math.floor(Number(props.state.barMaxLives ?? 2))));
    const cur = Math.max(0, Math.min(max, Math.floor(Number(props.state.barLives ?? 0))));
    return Array.from({ length: max }, (_, i) => i < cur);
  });
  const cheeseText = createMemo(() => {
    const maxC = Math.max(1, Math.floor(Number(props.state.barCheeseMax ?? 50)));
    const n = Math.max(0, Math.floor(Number(props.state.barCheese) || 0));
    return `${n}/${maxC}`;
  });
  const connection = createMemo(() => connectionColor(!!props.state.connected, props.state.ping));
  const latency = createMemo(() => latencyText(props.state.ping));
  const sidePanel = {
    ...HUD_PANEL_STYLE,
    ...(compact ? MOBILE_TOP_GLASS : {}),
    'flex-shrink': 0,
    'pointer-events': 'none',
    'user-select': 'none',
    display: 'flex',
    'align-items': 'center',
    gap: compact ? '5px' : '8px',
    color: '#fff',
    'font-size': fontSize,
    'letter-spacing': '0.04em',
    'text-shadow': HUD_LABEL_SHADOW,
    font: compact ? `700 ${fontSize} "Fredoka", "Baloo", system-ui, sans-serif` : HUD_LABEL_FONT,
    padding: compact ? '4px 7px' : '6px 10px',
    'min-height': compact ? '30px' : '36px',
    'box-sizing': 'border-box',
  };

  // Desktop uses equal side columns; mobile keeps the whole cluster beside the
  // viewport-centered timer instead of drifting into the touch-control corners.
  return (
    <div
      id="round-phase-top"
      style={{
        position: 'fixed',
        top: compact ? 'calc(6px + env(safe-area-inset-top))' : 'calc(12px + env(safe-area-inset-top))',
        left: '0',
        right: '0',
        width: '100%',
        'box-sizing': 'border-box',
        'padding-left': 'max(6px, env(safe-area-inset-left))',
        'padding-right': 'max(6px, env(safe-area-inset-right))',
        'z-index': '120',
        'pointer-events': 'none',
        display: 'flex',
        'flex-direction': 'row',
        'align-items': 'center',
        'justify-content': compact ? 'center' : undefined,
        gap: '6px',
      }}
    >
      <div
        style={{
          'flex': compact ? '0 0 auto' : '1 1 0',
          'min-width': '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'flex-end',
          position: compact ? 'absolute' : undefined,
          right: compact ? `calc(50% + ${mobilePhaseHalfWidthPx + 6}px)` : undefined,
        }}
      >
        <div
          style={{
            ...sidePanel,
            'clip-path': HUD_SLANTED,
          }}
        >
          <div style={{ display: 'flex', gap: '2px' }}>
            <For each={lifeSlots()}>{(full) => (full
              ? <HeartLifeFull size={iconSize} />
              : <HeartLifeLost size={iconSize} />)}
            </For>
          </div>
        </div>
      </div>

      <div
        id="round-phase"
        style={{
          ...HUD_PANEL_STYLE,
          ...(compact ? MOBILE_TOP_GLASS : {}),
          'flex': '0 0 auto',
          position: compact ? 'absolute' : undefined,
          left: compact ? '50%' : undefined,
          transform: compact ? 'translateX(-50%)' : undefined,
          width: compact ? `${mobilePhaseHalfWidthPx * 2}px` : 'auto',
          'max-width': 'min(62vw, 400px)',
          'min-width': 0,
          padding: compact ? '4px 12px 5px' : '7px 20px 8px',
          'border-radius': '0',
          'clip-path': HUD_SLANTED,
          'text-align': 'center',
          'white-space': 'pre-line',
          'font': phaseFontSize
            ? `700 ${phaseFontSize} "Fredoka", "Baloo", system-ui, sans-serif`
            : HUD_LABEL_FONT,
          'font-size': phaseFontSize ?? undefined,
          color: props.state.phaseColor,
          'text-shadow': HUD_LABEL_SHADOW,
          'letter-spacing': '0.04em',
          'line-height': '1.2',
          display: props.state.phaseVisible ? 'block' : 'none',
        }}
      >
        {props.state.phaseText}
      </div>

      <div
        style={{
          'flex': compact ? '0 0 auto' : '1 1 0',
          'min-width': '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'flex-start',
          position: compact ? 'absolute' : undefined,
          left: compact ? `calc(50% + ${mobilePhaseHalfWidthPx + 6}px)` : undefined,
        }}
      >
        <div
          style={{
            ...sidePanel,
            'clip-path': HUD_SLANTED,
          }}
        >
          <div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
            <CheeseItem size={iconSize} />
            <span
              style={{
                color: '#fff',
                font: HUD_VALUE_FONT,
                'font-size': fontSize,
                'min-width': '0',
              }}
            >
              {cheeseText()}
            </span>
          </div>
          <div
            style={{
              width: '1px',
              height: compact ? '14px' : '18px',
              background: 'rgba(255,255,255,0.2)',
              'align-self': 'center',
            }}
          />
          <div style={{ display: 'flex', 'align-items': 'center', gap: compact ? '3px' : '4px' }}>
            <BarStatusDot color={connection().color} glow={connection().glow} />
            <span
              style={{
                color: '#fff',
                font: HUD_VALUE_FONT,
                'font-size': fontSize,
              }}
            >
              {Math.max(0, Math.floor(Number(props.state.barConnected) || 0))}
            </span>
            <span
              style={{
                color: props.state.connected ? '#dce8ff' : '#aab2c2',
                font: HUD_SMALL_LABEL_FONT,
                'font-size': compact ? '9px' : '10px',
                'letter-spacing': '0.02em',
                'white-space': 'nowrap',
              }}
            >
              {latency()}
            </span>
          </div>
          <Show when={Math.max(0, Math.floor(Number(props.state.barBots) || 0)) > 0}>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
              <BarStatusDot color="#8e98a8" glow="rgba(142,152,168,0.45)" />
              <span
                style={{
                  color: '#d8dee8',
                  font: HUD_VALUE_FONT,
                  'font-size': fontSize,
                }}
              >
                {Math.max(0, Math.floor(Number(props.state.barBots) || 0))}
              </span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function RoundRaidView(props) {
  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: '0',
          display: props.state.extractAlertVisible ? 'flex' : 'none',
          'align-items': 'center',
          'justify-content': 'center',
          'z-index': '180',
          'pointer-events': 'none',
        }}
      >
        <div
          style={{
            padding: '16px 30px',
            'border-radius': '0',
            border: `3px solid ${HUD_COLORS.amber}`,
            'clip-path': HUD_SLANTED,
            background: 'linear-gradient(160deg, rgba(255,158,184,0.97) 0%, rgba(134,70,128,0.96) 55%, rgba(48,35,70,0.96) 100%)',
            color: '#fff8c7',
            font: HUD_LABEL_FONT,
            'font-size': 'clamp(30px, 7vw, 74px)',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
            'text-align': 'center',
            'text-shadow': [
              '-3px -3px 0 #331018',
              '3px -3px 0 #331018',
              '-3px 3px 0 #331018',
              '3px 3px 0 #331018',
              '0 0 22px rgba(255,241,118,0.7)',
            ].join(', '),
            'box-shadow': '3px 3px 0 rgba(0,0,0,0.55), 0 18px 54px rgba(255,90,120,0.35), inset 0 3px 0 rgba(255,255,255,0.34)',
            transform: props.state.extractAlertPulse ? 'scale(1.04)' : 'scale(1)',
            transition: 'transform 120ms ease-out',
          }}
        >
          {props.state.extractAlertText}
          <div
            style={{
              'margin-top': '8px',
              color: '#ffffff',
              font: HUD_SMALL_LABEL_FONT,
              'font-size': 'clamp(13px, 2.2vw, 20px)',
              'letter-spacing': '0.08em',
            }}
          >
            Stand in a glowing hole
          </div>
        </div>
      </div>

      <RoundPhaseTopRow state={props.state} />

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

          <Show when={props.state.roundEndGrade}>
            {(grade) => (
              <div
                style={{
                  display: 'grid',
                  'grid-template-columns': '96px 1fr',
                  gap: '14px',
                  padding: '14px',
                  'border-radius': '0',
                  border: `2px solid ${HUD_COLORS.amber}`,
                  'clip-path': 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                  background: 'linear-gradient(135deg, rgba(78,36,16,0.72) 0%, rgba(70,52,104,0.62) 52%, rgba(22,73,69,0.62) 100%)',
                  'box-shadow': 'inset 0 2px 0 rgba(255,255,255,0.16), 0 12px 28px rgba(0,0,0,0.26)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    'min-height': '96px',
                    'border-radius': '0',
                    'clip-path': 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                    background: grade().extracted
                      ? 'radial-gradient(circle at 35% 25%, #fff8b0 0%, #f8bd48 45%, #b85c2c 100%)'
                      : 'radial-gradient(circle at 35% 25%, #ffd6d6 0%, #f87171 50%, #7f1d1d 100%)',
                    color: '#281008',
                    font: HUD_LABEL_FONT,
                    'font-size': '58px',
                    'text-shadow': '0 2px 0 rgba(255,255,255,0.45)',
                    'box-shadow': 'inset 0 4px 0 rgba(255,255,255,0.28), 0 8px 18px rgba(0,0,0,0.28)',
                  }}
                >
                  {grade().grade}
                </div>
                <div
                  style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '8px',
                    'min-width': '0',
                  }}
                >
                  <div
                    style={{
                      font: HUD_LABEL_FONT,
                      color: '#fff8c7',
                      'font-size': '18px',
                      'letter-spacing': '0.04em',
                      'text-shadow': HUD_LABEL_SHADOW,
                    }}
                  >
                    Mischievery Grade
                  </div>
                  <div
                    style={{
                      font: HUD_VALUE_FONT,
                      color: '#ffffff',
                      'font-size': '16px',
                      'text-shadow': HUD_LABEL_SHADOW,
                    }}
                  >
                    {grade().name}: {grade().title}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
                      gap: '6px',
                    }}
                  >
                    <For each={grade().stats}>
                      {(item) => (
                        <div
                          style={{
                            padding: '6px 8px',
                            'border-radius': '0',
                            background: 'rgba(0,0,0,0.24)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            'min-width': '0',
                          }}
                        >
                          <div
                            style={{
                              color: 'rgba(255,255,255,0.68)',
                              font: HUD_SMALL_LABEL_FONT,
                              'font-size': '10px',
                              'letter-spacing': '0.06em',
                              'text-transform': 'uppercase',
                            }}
                          >
                            {item.label}
                          </div>
                          <div
                            style={{
                              color: '#fff7c2',
                              font: HUD_VALUE_FONT,
                              'font-size': '15px',
                            }}
                          >
                            {item.value}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <Show when={props.state.roundEndAwards.length > 0}>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                overflow: 'auto',
                '-webkit-overflow-scrolling': 'touch',
                padding: '1px 0 3px',
                'scrollbar-width': 'none',
              }}
            >
              <For each={props.state.roundEndAwards}>
                {(award) => (
                  <div
                    style={{
                      flex: '0 0 auto',
                      padding: '8px 10px',
                      'border-radius': '0',
                      border: '2px solid rgba(255,255,255,0.16)',
                      'clip-path': 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.11) 0%, rgba(0,0,0,0.2) 100%)',
                      'min-width': '130px',
                    }}
                  >
                    <div
                      style={{
                        color: '#fde68a',
                        font: HUD_SMALL_LABEL_FONT,
                        'font-size': '10px',
                        'letter-spacing': '0.08em',
                        'text-transform': 'uppercase',
                        'text-shadow': HUD_LABEL_SHADOW,
                      }}
                    >
                      {award.label}
                    </div>
                    <div
                      style={{
                        color: '#ffffff',
                        font: HUD_VALUE_FONT,
                        'font-size': '14px',
                        'text-shadow': HUD_LABEL_SHADOW,
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {award.name}
                    </div>
                    <div
                      style={{
                        color: 'rgba(255,255,255,0.72)',
                        font: HUD_SMALL_LABEL_FONT,
                        'font-size': '11px',
                      }}
                    >
                      {award.value}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

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
                    'border-radius': '0',
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

          <Show when={props.state.roundEndShareText}>
            <button
              type="button"
              style={{
                border: `2px solid ${HUD_COLORS.mint}`,
                'border-radius': '0',
                'clip-path': HUD_SLANTED,
                background: props.state.roundEndShareCopied
                  ? 'linear-gradient(180deg, rgba(65,196,161,0.9) 0%, rgba(18,88,81,0.92) 100%)'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.22) 100%)',
                color: '#fff8c7',
                cursor: 'pointer',
                font: HUD_LABEL_FONT,
                'font-size': '14px',
                'letter-spacing': '0.06em',
                padding: '9px 12px',
                'text-transform': 'uppercase',
                'text-shadow': HUD_LABEL_SHADOW,
              }}
              onClick={(e) => {
                e.stopPropagation();
                props.onCopyRoundRecap();
              }}
            >
              {props.state.roundEndShareCopied ? 'Recap copied' : 'Copy round recap'}
            </button>
          </Show>

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
      barLives: 2,
      barMaxLives: 2,
      barCheese: 0,
      barCheeseMax: 50,
      barConnected: 1,
      barBots: 0,
      connected: false,
      ping: 0,
      phaseVisible: false,
      phaseText: '',
      phaseColor: '#fff',
      roundEndVisible: false,
      roundEndTitle: '',
      roundEndRows: [],
      roundEndGrade: null,
      roundEndAwards: [],
      roundEndShareText: '',
      roundEndShareCopied: false,
      extractAlertVisible: false,
      extractAlertText: 'EXIT OPEN!',
      extractAlertPulse: false,
    });
    this._setState = setState;
    this._dismiss = () => {
      batch(() => this._setState({ roundEndVisible: false }));
    };
    this._copyRoundRecap = async () => {
      if (!state.roundEndShareText) return;
      try {
        await navigator.clipboard?.writeText?.(state.roundEndShareText);
        batch(() => this._setState({ roundEndShareCopied: true }));
        clearTimeout(this._shareCopiedTimeout);
        this._shareCopiedTimeout = setTimeout(() => {
          batch(() => this._setState({ roundEndShareCopied: false }));
        }, 1400);
      } catch {
        batch(() => this._setState({ roundEndShareCopied: false }));
      }
    };
    this._dispose = render(() => (
      <RoundRaidView
        state={state}
        onRoundEndDismiss={this._dismiss}
        onCopyRoundRecap={this._copyRoundRecap}
      />
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
    this._extractAlertTimeout = 0;
    this._extractAlertPulseTimeout = 0;
    this._shareCopiedTimeout = 0;
  }

  updateTopBarStats({
    lives,
    maxLives,
    cheese,
    cheeseMax,
    connectedCount,
    botCount,
    connected,
    ping,
  } = {}) {
    batch(() => {
      this._setState({
        barLives: lives ?? 0,
        barMaxLives: maxLives ?? 2,
        barCheese: cheese ?? 0,
        barCheeseMax: cheeseMax ?? 50,
        barConnected: connectedCount ?? 1,
        barBots: botCount ?? 0,
        connected: connected ?? false,
        ping: ping ?? 0,
      });
    });
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
        ? `EXTRACT  ·  ${formatClock(remain)}  ·  Stand in a glowing hole`
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

  showRoundEnd(data, localId = null) {
    if (!data?.results?.length) return;
    const rn = data.roundNumber ?? '?';
    const title = `Round ${rn} results`;
    const rows = data.results.map((r, i) => ({
      name: rowName(r, i),
      extracted: !!r.extracted,
      score: Math.max(0, Math.floor(Number(r.finalScore) || 0)),
      xp: Math.max(0, Math.floor(Number(r.xpAwarded) || 0)),
    }));
    const localResult = data.results.find((r) => r?.id === localId) ?? data.results[0];
    const roundEndGrade = buildGradeCard(localResult);
    const roundEndAwards = buildRoundAwards(data.results);
    const roundEndShareText = buildRoundShareText({ title, grade: roundEndGrade, awards: roundEndAwards });
    batch(() => {
      this._setState({
        roundEndVisible: true,
        roundEndTitle: title,
        roundEndRows: rows,
        roundEndGrade,
        roundEndAwards,
        roundEndShareText,
        roundEndShareCopied: false,
      });
    });
  }

  showExtractAlert(text = 'EXIT OPEN!') {
    clearTimeout(this._extractAlertTimeout);
    clearTimeout(this._extractAlertPulseTimeout);
    batch(() => {
      this._setState({
        extractAlertVisible: true,
        extractAlertText: text,
        extractAlertPulse: true,
      });
    });
    this._extractAlertPulseTimeout = setTimeout(() => {
      batch(() => this._setState({ extractAlertPulse: false }));
    }, 160);
    this._extractAlertTimeout = setTimeout(() => {
      batch(() => this._setState({ extractAlertVisible: false }));
    }, 2300);
  }

  setVisible(visible) {
    this._mount.style.display = visible === false ? 'none' : '';
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown, true);
    clearTimeout(this._extractAlertTimeout);
    clearTimeout(this._extractAlertPulseTimeout);
    clearTimeout(this._shareCopiedTimeout);
    cancelAnimationFrame(this._gamepadRaf);
    this._dispose();
    this._mount.remove();
  }
}
