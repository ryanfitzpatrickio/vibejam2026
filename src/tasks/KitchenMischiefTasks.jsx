import { createMemo, createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_LABEL_SHADOW,
  HUD_SMALL_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_COLORS,
} from '../hud/hudStyle.js';
import { setInputSource } from '../input/inputSource.js';

const TASK_COPY = Object.freeze({
  topple_tower: {
    title: 'Topple the Tower',
    subtitle: 'Smack each stack before the noise meter maxes out.',
    action: 'SMACK',
    done: 'CRASH!',
    steps: ['Cans', 'Boxes', 'Pans', 'Victory'],
    color: HUD_COLORS.coral,
  },
  fridge_raid: {
    title: 'Fridge Raid',
    subtitle: 'Alternate both paws to wrench the fridge open.',
    action: 'PULL',
    done: 'FRIDGE OPEN!',
    steps: ['Left paw', 'Right paw', 'Left paw', 'Right paw', 'Yank!'],
    color: HUD_COLORS.mint,
  },
  cut_lights: {
    title: 'Cut the Lights',
    subtitle: 'Hit the lit switches in sequence to blind the kitchen.',
    action: 'CUT',
    done: 'LIGHTS OUT!',
    steps: ['Blue', 'Amber', 'Pink', 'Green'],
    color: HUD_COLORS.cyan,
  },
  knife_drawer: {
    title: 'Knife Drawer',
    subtitle: 'Rattle the drawer open, swipe the cheese, then slam it shut.',
    action: 'RATTLE',
    done: 'DRAWER RAIDED!',
    steps: ['Wiggle', 'Jam', 'Yank', 'Swipe', 'Slam'],
    color: HUD_COLORS.amber,
  },
  sabotage_roomba: {
    title: 'Sabotage Roomba',
    subtitle: 'Stuff crumbs in the brushes before it notices you.',
    action: 'JAM',
    done: 'ROOMBA JAMMED!',
    steps: ['Brush', 'Wheel', 'Sensor', 'Escape'],
    color: HUD_COLORS.lime,
  },
  window: {
    title: 'Window',
    subtitle: 'Force the window open and make a clean getaway route.',
    action: 'OPEN',
    done: 'WINDOW OPEN!',
    steps: ['Latch', 'Wedge', 'Lift', 'Slip'],
    color: HUD_COLORS.cyan,
  },
});

function MischiefTaskView(props) {
  const copy = TASK_COPY[props.kind] ?? TASK_COPY.topple_tower;
  const [step, setStep] = createSignal(0);
  const [mistakes, setMistakes] = createSignal(0);
  const [finished, setFinished] = createSignal(false);
  const total = copy.steps.length;
  const progress = createMemo(() => Math.min(1, step() / total));
  const activeLabel = createMemo(() => copy.steps[Math.min(step(), total - 1)] ?? copy.action);

  const complete = () => {
    if (finished()) return;
    setFinished(true);
    setTimeout(() => props.onComplete?.(), 420);
  };

  const advance = () => {
    if (finished()) return;
    setInputSource('keyboard');
    const next = step() + 1;
    setStep(next);
    if (next >= total) complete();
  };

  const miss = () => {
    if (finished()) return;
    setMistakes((value) => value + 1);
    setStep((value) => Math.max(0, value - 1));
  };

  const cancel = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    props.onCancel?.();
  };

  onMount(() => {
    const onKey = (e) => {
      if (finished()) return;
      if (e.key === 'Escape' || e.key === ' ') {
        cancel(e);
        return;
      }
      if (e.key === 'Enter' || e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        e.stopPropagation();
        advance();
        return;
      }
      if (e.key.length === 1) miss();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: '0',
        'z-index': '400',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        background: 'rgba(8, 10, 16, 0.68)',
        'backdrop-filter': 'blur(4px)',
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) cancel(e);
      }}
    >
      <div
        style={{
          ...HUD_PANEL_STYLE,
          width: 'min(560px, calc(100vw - 22px))',
          padding: '16px',
          display: 'grid',
          gap: '12px',
          'box-sizing': 'border-box',
        }}
      >
        <div style={{ display: 'flex', 'justify-content': 'space-between', gap: '12px' }}>
          <div>
            <div
              style={{
                font: HUD_LABEL_FONT,
                color: copy.color,
                'font-size': '24px',
                'letter-spacing': '0.06em',
                'text-shadow': HUD_LABEL_SHADOW,
                'text-transform': 'uppercase',
              }}
            >
              {copy.title}
            </div>
            <div
              style={{
                font: HUD_SMALL_LABEL_FONT,
                color: 'rgba(255,255,255,0.78)',
                'text-shadow': HUD_LABEL_SHADOW,
              }}
            >
              {copy.subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={cancel}
            style={{
              ...HUD_PANEL_STYLE,
              padding: '6px 12px',
              font: HUD_SMALL_LABEL_FONT,
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Leave
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '10px',
            padding: '14px',
            background: 'rgba(20,14,30,0.62)',
            border: '1px solid rgba(255,255,255,0.16)',
          }}
        >
          <div
            style={{
              display: 'grid',
              'grid-template-columns': `repeat(${total}, 1fr)`,
              gap: '7px',
            }}
          >
            <For each={copy.steps}>
              {(label, i) => (
                <div
                  style={{
                    height: '34px',
                    display: 'grid',
                    'place-items': 'center',
                    background: i() < step()
                      ? `linear-gradient(90deg, ${copy.color}, ${HUD_COLORS.amber})`
                      : 'rgba(255,255,255,0.08)',
                    color: i() < step() ? HUD_COLORS.ink : '#fff',
                    border: '1px solid rgba(255,255,255,0.14)',
                    'clip-path': 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                    font: HUD_SMALL_LABEL_FONT,
                    'font-size': '11px',
                    'text-transform': 'uppercase',
                  }}
                >
                  {label}
                </div>
              )}
            </For>
          </div>

          <button
            type="button"
            onClick={advance}
            style={{
              height: '92px',
              border: `2px solid ${copy.color}`,
              background: `radial-gradient(circle at 50% 25%, rgba(255,255,255,0.22), transparent 45%), linear-gradient(135deg, rgba(34,26,49,0.96), ${copy.color}66)`,
              color: '#fff',
              cursor: 'pointer',
              font: HUD_LABEL_FONT,
              'font-size': '30px',
              'letter-spacing': '0.08em',
              'text-shadow': HUD_LABEL_SHADOW,
              'text-transform': 'uppercase',
              'clip-path': 'polygon(16px 0, 100% 0, calc(100% - 16px) 100%, 0 100%)',
              'box-shadow': `0 0 20px ${copy.color}40, inset 0 2px 0 rgba(255,255,255,0.22)`,
            }}
          >
            <Show when={!finished()} fallback={copy.done}>
              {copy.action} {activeLabel()}
            </Show>
          </button>

          <div
            style={{
              height: '14px',
              background: 'rgba(0,0,0,0.34)',
              border: '1px solid rgba(255,255,255,0.14)',
              overflow: 'hidden',
              transform: 'skewX(-8deg)',
            }}
          >
            <div
              style={{
                width: `${Math.round(progress() * 100)}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${copy.color}, ${HUD_COLORS.amber})`,
                transition: 'width 120ms ease-out',
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            color: 'rgba(255,255,255,0.78)',
            font: HUD_SMALL_LABEL_FONT,
            'text-shadow': HUD_LABEL_SHADOW,
          }}
        >
          <span>Press E/Enter or click the big button.</span>
          <span>Mistakes: {mistakes()}</span>
        </div>
      </div>
    </div>
  );
}

function openMischiefTask(kind, { onComplete, onCancel } = {}) {
  const host = document.createElement('div');
  host.setAttribute('data-task', kind);
  document.body.appendChild(host);

  let finished = false;
  const dispose = render(() => (
    <MischiefTaskView
      kind={kind}
      onComplete={() => {
        if (finished) return;
        finished = true;
        onComplete?.();
        close();
      }}
      onCancel={() => {
        if (finished) return;
        finished = true;
        onCancel?.();
        close();
      }}
    />
  ), host);

  function close() {
    try { dispose(); } catch { /* ignore */ }
    host.remove();
  }

  return { close };
}

export function openToppleTowerTask(options) {
  return openMischiefTask('topple_tower', options);
}

export function openFridgeRaidTask(options) {
  return openMischiefTask('fridge_raid', options);
}

export function openCutLightsTask(options) {
  return openMischiefTask('cut_lights', options);
}

export function openKnifeDrawerTask(options) {
  return openMischiefTask('knife_drawer', options);
}

export function openSabotageRoombaTask(options) {
  return openMischiefTask('sabotage_roomba', options);
}

export function openWindowTask(options) {
  return openMischiefTask('window', options);
}
