import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  HUD_PANEL_STYLE,
  HUD_LABEL_FONT,
  HUD_LABEL_SHADOW,
  HUD_SMALL_LABEL_FONT,
} from './hudStyle.js';
import { actionLabel } from '../input/inputSource.js';

const HERO_NAMES = { brain: 'The Brain', jerry: 'Jerry' };
const HERO_SUBTITLES = {
  brain: 'You led the cat chase',
  jerry: 'You led in cheese',
};

function HeroPromptView(props) {
  const heroName = () => HERO_NAMES[props.avatar?.()] ?? 'The Brain';
  const subtitle = () => HERO_SUBTITLES[props.avatar?.()] ?? 'You are the round leader';
  return (
    <Show when={props.visible()}>
      <div
        id="hero-prompt"
        style={{
          ...HUD_PANEL_STYLE,
          position: 'fixed',
          left: '50%',
          bottom: '20%',
          transform: 'translateX(-50%)',
          'z-index': '150',
          padding: '14px 22px',
          'text-align': 'center',
          'pointer-events': 'none',
          'min-width': '320px',
        }}
      >
        <div
          style={{
            font: HUD_LABEL_FONT,
            'letter-spacing': '0.04em',
            'text-shadow': HUD_LABEL_SHADOW,
            color: '#ffe08a',
          }}
        >
          {subtitle()}
        </div>
        <div
          style={{
            'margin-top': '6px',
            font: HUD_SMALL_LABEL_FONT,
            'text-shadow': HUD_LABEL_SHADOW,
            color: '#fff',
          }}
        >
          Press {actionLabel('heroActivate')} to respawn as {heroName()}
        </div>
      </div>
    </Show>
  );
}

export class HeroPrompt {
  constructor() {
    const [visible, setVisible] = createSignal(false);
    const [enabled, setEnabled] = createSignal(true);
    const [avatar, setAvatar] = createSignal(null);
    this._setVisible = setVisible;
    this._setEnabled = setEnabled;
    this._setAvatar = setAvatar;
    this._dispose = render(
      () => <HeroPromptView visible={() => enabled() && visible()} avatar={avatar} />,
      document.body,
    );
  }

  setVisible(v, avatar = null) {
    this._setVisible(!!v);
    this._setAvatar(avatar);
  }

  setEnabled(enabled) {
    this._setEnabled(enabled !== false);
  }

  dispose() {
    this._setVisible(false);
    this._dispose();
  }
}
