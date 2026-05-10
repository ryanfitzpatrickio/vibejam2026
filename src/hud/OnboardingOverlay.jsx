import { For, Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  HUD_LABEL_FONT,
  HUD_SMALL_LABEL_FONT,
  HUD_VALUE_FONT,
  HUD_LABEL_SHADOW,
  HUD_PANEL_STYLE,
  HUD_COLORS,
} from './hudStyle.js';
import { actionLabel } from '../input/inputSource.js';

function OnboardingView(props) {
  const steps = () => [
    { label: 'Grab cheese', detail: `Press ${actionLabel('interact')} near cheese and tasks.` },
    { label: 'Avoid predators', detail: 'Cat and roomba contact can ruin the raid.' },
    { label: 'Cause mischief', detail: `Smack with ${actionLabel('smack')}, grab with ${actionLabel('grab')}, chain combos.` },
    { label: 'Extract in panic time', detail: 'When EXIT OPEN appears, stand in a glowing mouse hole.' },
    { label: 'Brag after', detail: 'Grades and awards score cheese, chaos, chases, tasks, and escape.' },
  ];

  return (
    <Show when={props.visible()}>
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(94vw, 620px)',
          'max-height': 'calc(100vh - max(36px, env(safe-area-inset-top)) - max(36px, env(safe-area-inset-bottom)))',
          overflow: 'auto',
          'z-index': '170',
          'pointer-events': 'auto',
          color: '#fff',
          'box-sizing': 'border-box',
        }}
      >
        <div
          style={{
            ...HUD_PANEL_STYLE,
            padding: '14px',
            border: `2px solid ${HUD_COLORS.amber}`,
            background: [
              'radial-gradient(circle at 12% 10%, rgba(255,224,128,0.26) 0%, transparent 34%)',
              'linear-gradient(135deg, rgba(40,30,55,0.96) 0%, rgba(98,88,115,0.92) 58%, rgba(27,76,69,0.9) 100%)',
            ].join(', '),
          }}
        >
          <div
            style={{
              display: 'flex',
              'align-items': 'start',
              'justify-content': 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div
                style={{
                  color: '#fff8c7',
                  font: HUD_LABEL_FONT,
                  'font-size': '20px',
                  'letter-spacing': '0.06em',
                  'text-transform': 'uppercase',
                  'text-shadow': HUD_LABEL_SHADOW,
                }}
              >
                Kitchen Raid 101
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.76)',
                  font: HUD_SMALL_LABEL_FONT,
                  'margin-top': '2px',
                  'text-shadow': HUD_LABEL_SHADOW,
                }}
              >
                Tiny mice break in, steal cheese, make noise, then barely escape.
              </div>
            </div>
            <button
              type="button"
              onClick={props.onDismiss}
              style={{
                border: '2px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,224,128,0.18)',
                color: HUD_COLORS.amber,
                'border-radius': '0',
                'clip-path': 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                padding: '6px 11px',
                font: HUD_VALUE_FONT,
                cursor: 'pointer',
                'text-shadow': HUD_LABEL_SHADOW,
                'white-space': 'nowrap',
              }}
            >
              Got it
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '8px',
              'margin-top': '12px',
            }}
          >
            <For each={steps()}>
              {(step, i) => (
                <div
                  style={{
                    padding: '9px 10px',
                    'border-radius': '0',
                    'clip-path': 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
                    background: 'rgba(0,0,0,0.24)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '7px',
                      color: '#fde68a',
                      font: HUD_VALUE_FONT,
                      'font-size': '14px',
                      'text-shadow': HUD_LABEL_SHADOW,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-grid',
                        placeItems: 'center',
                        width: '20px',
                        height: '20px',
                        'border-radius': '0',
                        transform: 'skewX(-8deg)',
                        background: 'rgba(255,232,120,0.18)',
                        color: '#fff8c7',
                        'font-size': '12px',
                      }}
                    >
                      {i() + 1}
                    </span>
                    {step.label}
                  </div>
                  <div
                    style={{
                      color: 'rgba(255,255,255,0.74)',
                      font: HUD_SMALL_LABEL_FONT,
                      'line-height': '1.25',
                      'margin-top': '4px',
                    }}
                  >
                    {step.detail}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}

export class OnboardingOverlay {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this._mount = document.createElement('div');
    container.appendChild(this._mount);
    const [visible, setVisible] = createSignal(false);
    this._show = () => setVisible(true);
    this._dismiss = () => {
      setVisible(false);
    };
    this._dispose = render(() => (
      <OnboardingView visible={visible} onDismiss={this._dismiss} />
    ), this._mount);
  }

  dismiss() {
    this._dismiss?.();
  }

  show() {
    this._show?.();
  }

  dispose() {
    this._dispose?.();
    this._mount.remove();
  }
}
