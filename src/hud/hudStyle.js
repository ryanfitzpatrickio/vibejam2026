/**
 * Shared kitchen-raid HUD style tokens. The design file uses chamfered glassy
 * panels, hard angular stat bars, and warm candy colors instead of soft pills.
 */

export const HUD_LABEL_SHADOW = [
  '-1.5px -1.5px 0 #0b1220',
  '1.5px -1.5px 0 #0b1220',
  '-1.5px 1.5px 0 #0b1220',
  '1.5px 1.5px 0 #0b1220',
  '0 0 4px rgba(0,0,0,0.6)',
].join(', ');

export const HUD_LABEL_FONT = '700 18px "Fredoka", "Baloo", system-ui, sans-serif';
export const HUD_VALUE_FONT = '700 17px "Fredoka", "Baloo", system-ui, sans-serif';
export const HUD_SMALL_LABEL_FONT = '700 13px "Fredoka", "Baloo", system-ui, sans-serif';

export const HUD_COLORS = Object.freeze({
  amber: '#ffe080',
  coral: '#ff9eb8',
  coralHot: '#ff6b8f',
  mint: '#8affcc',
  mintHot: '#55e6b2',
  cyan: '#8be9ff',
  lavender: '#c8b0e8',
  lime: '#d9ff8a',
  ink: '#221a31',
  panelBorder: 'rgba(210,195,230,0.75)',
});

export const HUD_CHAMFER = 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))';
export const HUD_SLANTED = 'polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%)';

/** Angular glass panel used behind HUD-style overlays. */
export const HUD_PANEL_STYLE = Object.freeze({
  background: 'linear-gradient(160deg, rgba(148,136,158,0.88) 0%, rgba(98,88,115,0.92) 100%)',
  'border-radius': '0',
  border: `2px solid ${HUD_COLORS.panelBorder}`,
  'clip-path': HUD_CHAMFER,
  'box-shadow': [
    'inset 0 2px 0 rgba(255,255,255,0.22)',
    'inset 0 -2px 0 rgba(0,0,0,0.18)',
    '3px 3px 0 rgba(0,0,0,0.45)',
    '0 12px 28px rgba(16,10,24,0.22)',
  ].join(', '),
  'backdrop-filter': 'blur(8px)',
  color: '#fff',
  'font-family': '"Fredoka", "Baloo", system-ui, sans-serif',
});

/** Inner sunken track (same look as the stat bars' background). */
export const HUD_TRACK_STYLE = Object.freeze({
  background: 'rgba(40,30,55,0.82)',
  'box-shadow': 'inset 0 2px 3px rgba(0,0,0,0.58), 0 1px 0 rgba(255,255,255,0.12)',
  border: '1.5px solid rgba(255,255,255,0.16)',
  'border-radius': '0',
});

/** Outlined label text, matches HUD bars. */
export const HUD_TEXT_STYLE = Object.freeze({
  color: '#fff',
  font: HUD_LABEL_FONT,
  'letter-spacing': '0.04em',
  'text-shadow': HUD_LABEL_SHADOW,
});
