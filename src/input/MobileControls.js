const NON_PASSIVE = { passive: false };
const CAPTURE_NON_PASSIVE = { passive: false, capture: true };
const SVG_NS = 'http://www.w3.org/2000/svg';

function preventGesture(event) {
  if (event.cancelable) event.preventDefault();
}

function consumeControlEvent(event) {
  preventGesture(event);
  event.stopPropagation();
}

function setPointerCaptureSafe(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Android can throw if a pointer is canceled between dispatch and capture.
  }
}

function releasePointerCaptureSafe(element, pointerId) {
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Ignore stale pointer capture state.
  }
}

function addSvgPath(svg, attrs) {
  const path = document.createElementNS(SVG_NS, 'path');
  for (const [key, value] of Object.entries(attrs)) path.setAttribute(key, value);
  svg.append(path);
}

function addSvgCircle(svg, attrs) {
  const circle = document.createElementNS(SVG_NS, 'circle');
  for (const [key, value] of Object.entries(attrs)) circle.setAttribute(key, value);
  svg.append(circle);
}

function addSvgLine(svg, attrs) {
  const line = document.createElementNS(SVG_NS, 'line');
  for (const [key, value] of Object.entries(attrs)) line.setAttribute(key, value);
  svg.append(line);
}

function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {
    display: 'block',
    flexShrink: '0',
    pointerEvents: 'none',
  });
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  if (name === 'jump') {
    addSvgPath(svg, { d: 'M12 20V5' });
    addSvgPath(svg, { d: 'M6.5 10.5 12 5l5.5 5.5' });
    addSvgPath(svg, { d: 'M6 20h12' });
  } else if (name === 'sprint') {
    addSvgPath(svg, { d: 'M4 17 10 7l3.2 5H18' });
    addSvgPath(svg, { d: 'M13 7h5' });
    addSvgPath(svg, { d: 'M15.5 4.5 18 7l-2.5 2.5' });
  } else if (name === 'crouch') {
    addSvgPath(svg, { d: 'M7 8h7.5a3.5 3.5 0 0 1 0 7H10' });
    addSvgPath(svg, { d: 'M10 15v4' });
    addSvgPath(svg, { d: 'M6 19h9' });
  } else if (name === 'emote') {
    addSvgCircle(svg, { cx: '12', cy: '12', r: '8' });
    addSvgLine(svg, { x1: '9', y1: '10', x2: '9.01', y2: '10' });
    addSvgLine(svg, { x1: '15', y1: '10', x2: '15.01', y2: '10' });
    addSvgPath(svg, { d: 'M8.8 14.2c1.6 1.8 4.8 1.8 6.4 0' });
  } else if (name === 'ball') {
    addSvgCircle(svg, { cx: '10.5', cy: '13.5', r: '5.5' });
    addSvgPath(svg, { d: 'M10.5 8v11' });
    addSvgPath(svg, { d: 'M5 13.5h11' });
    addSvgPath(svg, { d: 'M17 5v5' });
    addSvgPath(svg, { d: 'M14.5 7.5h5' });
  } else if (name === 'use') {
    addSvgPath(svg, { d: 'M7 12.5V7a1.4 1.4 0 0 1 2.8 0v5' });
    addSvgPath(svg, { d: 'M9.8 11V5.8a1.4 1.4 0 0 1 2.8 0V11' });
    addSvgPath(svg, { d: 'M12.6 11.3V7a1.4 1.4 0 0 1 2.8 0v5.4' });
    addSvgPath(svg, { d: 'M15.4 12.8v-2a1.3 1.3 0 0 1 2.6 0V14c0 4-2.8 6-6 6h-1.2C8 20 6 18 6 15.6v-1.8' });
  } else if (name === 'drop') {
    addSvgPath(svg, { d: 'M12 4v10' });
    addSvgPath(svg, { d: 'M7.5 10.5 12 15l4.5-4.5' });
    addSvgPath(svg, { d: 'M6 19h12' });
  } else if (name === 'grab') {
    addSvgPath(svg, { d: 'M8 11V6a1.4 1.4 0 0 1 2.8 0v5' });
    addSvgPath(svg, { d: 'M10.8 10V5.2a1.4 1.4 0 0 1 2.8 0V11' });
    addSvgPath(svg, { d: 'M13.6 11V7a1.4 1.4 0 0 1 2.8 0v5.2' });
    addSvgPath(svg, { d: 'M16.4 12.4v-1.6a1.3 1.3 0 0 1 2.6 0V15c0 3.4-2.4 5.5-5.5 5.5h-1C9.6 20.5 7.5 18.4 7.5 15.5V13' });
  } else if (name === 'rope') {
    addSvgPath(svg, { d: 'M6 4c3 2 3 4 0 6s-3 4 0 6 3 4 0 6' });
    addSvgPath(svg, { d: 'M13 4c3 2 3 4 0 6s-3 4 0 6 3 4 0 6' });
  } else if (name === 'hero') {
    addSvgPath(svg, { d: 'M12 3 14.2 8l5.3.5-4 3.8 1.2 5.3L12 14.9 7.3 17.6l1.2-5.3-4-3.8L9.8 8z' });
  } else if (name === 'human') {
    addSvgCircle(svg, { cx: '12', cy: '8', r: '3' });
    addSvgPath(svg, { d: 'M6.5 19c.5-3.7 2.8-5.5 5.5-5.5s5 1.8 5.5 5.5' });
    addSvgPath(svg, { d: 'M4 12h3' });
    addSvgPath(svg, { d: 'M17 12h3' });
  } else if (name === 'smack') {
    addSvgPath(svg, { d: 'M4 13 10 7l3 3-6 6z' });
    addSvgPath(svg, { d: 'M11 8l2-2 5 5-2 2' });
    addSvgPath(svg, { d: 'M15 3v2M18 5l-1.4 1.4M19 9h2' });
  }

  return svg;
}

function setButtonActive(button, active) {
  const restBackground = button._mobileRestBackground
    || 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06)), rgba(15,18,18,0.42)';
  const activeBackground = button._mobileActiveBackground
    || 'linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0.08)), rgba(192,77,52,0.52)';
  const restBorder = button._mobileRestBorder || 'rgba(255,255,255,0.28)';
  const activeBorder = button._mobileActiveBorder || 'rgba(255,236,185,0.56)';
  button.dataset.active = active ? 'true' : 'false';
  button.style.transform = active ? 'translateY(1px) scale(0.97)' : 'translateY(0) scale(1)';
  button.style.background = active ? activeBackground : restBackground;
  button.style.borderColor = active ? activeBorder : restBorder;
  button.style.color = active ? '#fff3d4' : '#fff8ef';
}

function createButton({ label, icon, primary = false, area = '' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.ariaLabel = label;
  button.draggable = false;
  if (area) button.style.gridArea = area;

  const iconEl = createIcon(icon);
  const text = document.createElement('span');
  text.textContent = label;
  Object.assign(text.style, {
    fontSize: primary ? '12px' : '10px',
    fontWeight: '800',
    lineHeight: '1',
    textTransform: 'uppercase',
    letterSpacing: '0',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  });

  button.append(iconEl, text);
  button._labelEl = text;
  Object.assign(button.style, {
    appearance: 'none',
    WebkitAppearance: 'none',
    border: '1px solid rgba(255,255,255,0.28)',
    borderRadius: '8px',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06)), rgba(15,18,18,0.42)',
    color: '#fff8ef',
    width: primary ? '74px' : '62px',
    height: primary ? '118px' : '54px',
    padding: primary ? '12px 8px' : '7px 6px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    boxSizing: 'border-box',
    boxShadow: '0 12px 26px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.18)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitTapHighlightColor: 'transparent',
    cursor: 'pointer',
    transition: 'transform 80ms ease, background 80ms ease, border-color 80ms ease, color 80ms ease',
  });
  return button;
}

function styleCircleActionButton(button, {
  size,
  left,
  top,
  background,
  activeBackground,
  border = 'rgba(255,255,255,0.3)',
  activeBorder = 'rgba(255,241,181,0.72)',
  primary = false,
}) {
  button._mobileRestBackground = background;
  button._mobileActiveBackground = activeBackground;
  button._mobileRestBorder = border;
  button._mobileActiveBorder = activeBorder;
  Object.assign(button.style, {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${size}px`,
    height: `${size}px`,
    minWidth: `${size}px`,
    minHeight: `${size}px`,
    padding: primary ? '14px 10px' : '8px 6px',
    borderRadius: '999px',
    pointerEvents: 'auto',
    background,
    borderColor: border,
    gap: primary ? '7px' : '4px',
    boxShadow: primary
      ? '0 18px 34px rgba(0,0,0,0.42), 0 0 0 6px rgba(255,255,255,0.05), inset 0 2px 0 rgba(255,255,255,0.25)'
      : '0 12px 24px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.2)',
  });
  if (button._labelEl) {
    Object.assign(button._labelEl.style, {
      fontSize: primary ? '13px' : '10px',
      letterSpacing: primary ? '0.02em' : '0',
    });
  }
  const icon = button.querySelector('svg');
  if (icon) {
    icon.setAttribute('width', primary ? '30' : '22');
    icon.setAttribute('height', primary ? '30' : '22');
  }
}

export class MobileControls {
  constructor({
    controller,
    thirdPersonCamera,
    parent = document.body,
    onSpawnExtraBall = null,
    onOpenEmote = null,
    onToggleAdversary = null,
  } = {}) {
    this.controller = controller;
    this.thirdPersonCamera = thirdPersonCamera;
    this.parent = parent;
    this.onSpawnExtraBall = onSpawnExtraBall;
    this.onOpenEmote = onOpenEmote;
    this.onToggleAdversary = onToggleAdversary;
    this.moveX = 0;
    this.moveZ = 0;
    /** When true, move stick cluster to the right and action buttons to the left (gamepad Menu/Start). */
    this._sidesMirrored = false;

    this.root = document.createElement('div');
    this.root.dataset.mobileControls = 'true';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '25',
      pointerEvents: 'none',
      touchAction: 'none',
      overscrollBehavior: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
      fontFamily: 'system-ui, sans-serif',
    });

    this.joystickZone = document.createElement('div');
    Object.assign(this.joystickZone.style, {
      position: 'absolute',
      left: '16px',
      bottom: 'calc(16px + env(safe-area-inset-bottom))',
      zIndex: '2',
      width: '150px',
      height: '150px',
      pointerEvents: 'auto',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
      borderRadius: '50%',
      background: 'rgba(15,18,18,0.32)',
      border: '1px solid rgba(255,255,255,0.22)',
      boxShadow: '0 12px 26px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.18)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
    });

    this.joystickKnob = document.createElement('div');
    Object.assign(this.joystickKnob.style, {
      position: 'absolute',
      width: '60px',
      height: '60px',
      borderRadius: '50%',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08)), rgba(15,18,18,0.48)',
      border: '1px solid rgba(255,255,255,0.32)',
      boxShadow: '0 8px 18px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.28)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
    });

    this.joystickCap = document.createElement('div');
    Object.assign(this.joystickCap.style, {
      position: 'absolute',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(17,24,39,0.68)',
      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.22)',
      pointerEvents: 'none',
    });
    this.joystickKnob.appendChild(this.joystickCap);
    this.joystickZone.appendChild(this.joystickKnob);

    this.cameraZone = document.createElement('div');
    Object.assign(this.cameraZone.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '1',
      pointerEvents: 'auto',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    this.topBar = document.createElement('div');
    Object.assign(this.topBar.style, {
      position: 'absolute',
      top: 'calc(12px + env(safe-area-inset-top))',
      right: 'calc(12px + env(safe-area-inset-right))',
      zIndex: '3',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'none',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    this.actionPad = document.createElement('div');
    Object.assign(this.actionPad.style, {
      position: 'absolute',
      right: 'calc(14px + env(safe-area-inset-right))',
      bottom: 'calc(18px + env(safe-area-inset-bottom))',
      zIndex: '3',
      width: '220px',
      height: '238px',
      pointerEvents: 'none',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    this.throwDock = document.createElement('div');
    Object.assign(this.throwDock.style, {
      position: 'absolute',
      left: 'calc(26px + env(safe-area-inset-left))',
      bottom: 'calc(180px + env(safe-area-inset-bottom))',
      zIndex: '3',
      pointerEvents: 'none',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
    });

    this._buttons = {
      adversary: createButton({ label: 'Human', icon: 'human' }),
      emote: createButton({ label: 'Emote', icon: 'emote' }),
      hero: createButton({ label: 'Hero', icon: 'hero' }),
      jump: createButton({ label: 'Jump', icon: 'jump' }),
      smack: createButton({ label: 'Smack', icon: 'smack' }),
      grab: createButton({ label: 'Grab', icon: 'grab' }),
      throw: createButton({ label: 'Throw', icon: 'drop' }),
      sprint: createButton({ label: 'Sprint', icon: 'sprint' }),
    };

    const topButtons = [this._buttons.adversary, this._buttons.emote, this._buttons.hero];
    topButtons.forEach((button) => {
      Object.assign(button.style, {
        width: '62px',
        height: '54px',
        padding: '7px 6px',
        pointerEvents: 'auto',
      });
    });

    styleCircleActionButton(this._buttons.jump, {
      size: 118,
      left: 94,
      top: 4,
      primary: true,
      background: 'radial-gradient(circle at 35% 25%, rgba(255,255,255,0.36), rgba(255,255,255,0.08) 42%, rgba(38,116,165,0.82)), rgba(18,51,74,0.78)',
      activeBackground: 'radial-gradient(circle at 35% 25%, rgba(255,255,255,0.46), rgba(255,255,255,0.12) 40%, rgba(71,166,217,0.92)), rgba(20,74,104,0.9)',
      border: 'rgba(186,230,253,0.58)',
      activeBorder: 'rgba(224,242,254,0.9)',
    });

    styleCircleActionButton(this._buttons.smack, {
      size: 82,
      left: 8,
      top: 68,
      background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 40%, rgba(185,54,72,0.76)), rgba(75,20,29,0.72)',
      activeBackground: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.43), rgba(255,255,255,0.12) 40%, rgba(237,91,109,0.92)), rgba(96,28,40,0.88)',
      border: 'rgba(253,164,175,0.58)',
      activeBorder: 'rgba(255,228,230,0.9)',
    });

    styleCircleActionButton(this._buttons.sprint, {
      size: 76,
      left: 58,
      top: 158,
      background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 40%, rgba(185,116,36,0.78)), rgba(82,46,15,0.72)',
      activeBackground: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.44), rgba(255,255,255,0.12) 40%, rgba(238,164,58,0.94)), rgba(112,64,18,0.9)',
      border: 'rgba(253,186,116,0.6)',
      activeBorder: 'rgba(254,243,199,0.9)',
    });

    styleCircleActionButton(this._buttons.grab, {
      size: 76,
      left: 138,
      top: 132,
      background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 40%, rgba(93,75,177,0.76)), rgba(38,27,82,0.72)',
      activeBackground: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.44), rgba(255,255,255,0.12) 40%, rgba(135,116,230,0.92)), rgba(53,39,111,0.88)',
      border: 'rgba(196,181,253,0.62)',
      activeBorder: 'rgba(237,233,254,0.92)',
    });

    Object.assign(this._buttons.throw.style, {
      width: '76px',
      height: '76px',
      padding: '8px 6px',
      borderRadius: '999px',
      background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.32), rgba(255,255,255,0.08) 40%, rgba(109,94,74,0.78)), rgba(42,34,25,0.74)',
      borderColor: 'rgba(255,255,255,0.34)',
      boxShadow: '0 12px 24px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.2)',
      pointerEvents: 'auto',
    });
    this._buttons.throw._mobileRestBackground = this._buttons.throw.style.background;
    this._buttons.throw._mobileActiveBackground = 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.44), rgba(255,255,255,0.12) 40%, rgba(173,145,100,0.92)), rgba(66,51,35,0.9)';
    this._buttons.throw._mobileRestBorder = 'rgba(255,255,255,0.34)';
    this._buttons.throw._mobileActiveBorder = 'rgba(255,241,214,0.86)';

    this.topBar.append(
      this._buttons.adversary,
      this._buttons.emote,
      this._buttons.hero,
    );
    this.actionPad.append(
      this._buttons.jump,
      this._buttons.smack,
      this._buttons.sprint,
      this._buttons.grab,
    );
    this.throwDock.append(this._buttons.throw);

    this.root.append(this.cameraZone, this.joystickZone, this.topBar, this.actionPad, this.throwDock);
    this.parent.appendChild(this.root);
    this._applySideLayout();

    this._held = { jump: false, sprint: false, interact: false };
    this._humanSwitchState = { mode: 'off', hiding: false };
    this._cameraTouchId = null;
    this._cameraLastX = 0;
    this._cameraLastY = 0;
    this._cameraSensitivity = 0.005;
    this._joystickTouchId = null;
    this._joystickCenterX = 0;
    this._joystickCenterY = 0;
    this._joystickMaxDist = 45;
    this._previousViewportStyles = null;
    this._viewportLocked = false;
    this._preventDocumentTouch = (event) => {
      if (this.root.style.display === 'none') return;
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('[data-scroll-container]')) return;
      preventGesture(event);
    };
    this._preventRootTouch = (event) => {
      preventGesture(event);
    };

    this._applyHumanSwitchState();
  }

  async init() {
    this._installViewportGestureGuards();
    this._installJoystick();
    this._installCameraTouch();
    this._installButtons();
    this._applySideLayout();
    return this;
  }

  /** Swap joystick side vs action-button cluster (for left-handed layout). */
  toggleSides() {
    this._sidesMirrored = !this._sidesMirrored;
    this._applySideLayout();
  }

  _applySideLayout() {
    const m = this._sidesMirrored;
    Object.assign(this.joystickZone.style, m ? {
      left: 'auto',
      right: 'calc(16px + env(safe-area-inset-right))',
    } : {
      left: 'calc(16px + env(safe-area-inset-left))',
      right: 'auto',
    });
    Object.assign(this.actionPad.style, m ? {
      left: 'calc(12px + env(safe-area-inset-left))',
      right: 'auto',
    } : {
      left: 'auto',
      right: 'calc(14px + env(safe-area-inset-right))',
    });
    Object.assign(this.throwDock.style, m ? {
      left: 'auto',
      right: 'calc(26px + env(safe-area-inset-right))',
    } : {
      left: 'calc(26px + env(safe-area-inset-left))',
      right: 'auto',
    });
    Object.assign(this.topBar.style, m ? {
      left: 'calc(12px + env(safe-area-inset-left))',
      right: 'auto',
    } : {
      left: 'auto',
      right: 'calc(12px + env(safe-area-inset-right))',
    });
  }

  _installJoystick() {
    this.joystickZone.addEventListener('pointerdown', (e) => {
      if (this._joystickTouchId !== null) return;
      consumeControlEvent(e);
      this._joystickTouchId = e.pointerId;
      setPointerCaptureSafe(this.joystickZone, e.pointerId);
      const rect = this.joystickZone.getBoundingClientRect();
      this._joystickCenterX = rect.left + rect.width * 0.5;
      this._joystickCenterY = rect.top + rect.height * 0.5;
      this._updateJoystick(e.clientX, e.clientY);
    });

    this.joystickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joystickTouchId) return;
      consumeControlEvent(e);
      this._updateJoystick(e.clientX, e.clientY);
    });

    const endJoystick = (e) => {
      if (e.pointerId !== this._joystickTouchId) return;
      consumeControlEvent(e);
      releasePointerCaptureSafe(this.joystickZone, e.pointerId);
      this._joystickTouchId = null;
      this.moveX = 0;
      this.moveZ = 0;
      this.joystickKnob.style.transform = 'translate(-50%, -50%)';
    };
    this.joystickZone.addEventListener('pointerup', endJoystick);
    this.joystickZone.addEventListener('pointercancel', endJoystick);
  }

  _updateJoystick(clientX, clientY) {
    let dx = clientX - this._joystickCenterX;
    let dy = clientY - this._joystickCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this._joystickMaxDist) {
      dx = (dx / dist) * this._joystickMaxDist;
      dy = (dy / dist) * this._joystickMaxDist;
    }
    this.moveX = dx / this._joystickMaxDist;
    this.moveZ = dy / this._joystickMaxDist;
    this.joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _installCameraTouch() {
    this.cameraZone.addEventListener('pointerdown', (e) => {
      if (this._cameraTouchId !== null) return;
      consumeControlEvent(e);
      this._cameraTouchId = e.pointerId;
      this._cameraLastX = e.clientX;
      this._cameraLastY = e.clientY;
      setPointerCaptureSafe(this.cameraZone, e.pointerId);
    });

    this.cameraZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._cameraTouchId) return;
      consumeControlEvent(e);
      const cam = this.thirdPersonCamera;
      if (!cam) return;
      const dx = e.clientX - this._cameraLastX;
      const dy = e.clientY - this._cameraLastY;
      cam.yaw -= dx * this._cameraSensitivity;
      cam.pitch -= dy * this._cameraSensitivity;
      cam.pitch = Math.max(cam.minPitch, Math.min(cam.maxPitch, cam.pitch));
      this._cameraLastX = e.clientX;
      this._cameraLastY = e.clientY;
    });

    const endCamera = (e) => {
      if (e.pointerId === this._cameraTouchId) {
        consumeControlEvent(e);
        releasePointerCaptureSafe(this.cameraZone, e.pointerId);
        this._cameraTouchId = null;
      }
    };
    this.cameraZone.addEventListener('pointerup', endCamera);
    this.cameraZone.addEventListener('pointercancel', endCamera);
  }

  _installButtons() {
    const kb = this.controller?.keyBindings;

    this._bindHoldButton(this._buttons.sprint, () => {
      this._held.sprint = true;
      if (kb) this.controller.keys[kb.sprint] = true;
    }, () => {
      this._held.sprint = false;
      if (kb) this.controller.keys[kb.sprint] = false;
    });

    this._bindHoldButton(this._buttons.jump, () => {
      this._held.jump = true;
      if (kb) this.controller.keys[kb.jump] = true;
    }, () => {
      this._held.jump = false;
      if (kb) this.controller.keys[kb.jump] = false;
    });

    this._bindHoldButton(this._buttons.grab, () => {
      if (kb) this.controller.keys[kb.grab] = true;
    }, () => {
      if (kb) this.controller.keys[kb.grab] = false;
    });

    this._bindHoldButton(this._buttons.throw, () => {
      if (kb) this.controller.keys[kb.drop] = true;
    }, () => {
      if (kb) this.controller.keys[kb.drop] = false;
    });

    this._bindHoldButton(this._buttons.smack, () => {
      this._held.interact = true;
      if (kb) this.controller.keys[kb.interact] = true;
    }, () => {
      this._held.interact = false;
      if (kb) this.controller.keys[kb.interact] = false;
    });

    this._bindTapButton(this._buttons.hero, () => {
      if (this.controller) this.controller.heroActivatePressed = true;
    });

    this._bindTapButton(this._buttons.adversary, () => {
      if (this.controller) this.controller.adversaryTogglePressed = true;
      this.onToggleAdversary?.();
    });

    this._bindTapButton(this._buttons.emote, () => {
      this.onOpenEmote?.();
    });
  }

  setHumanSwitchState(state = {}) {
    this._humanSwitchState = {
      mode: state.mode ?? 'off',
      hiding: !!state.hiding,
    };
    this._applyHumanSwitchState();
  }

  _applyHumanSwitchState() {
    const mode = this._humanSwitchState.mode;
    const button = this._buttons.adversary;
    if (!button) return;
    if (mode === 'off' || mode === 'remote') {
      button.style.display = 'none';
      return;
    }
    button.style.display = '';
    if (button._labelEl) {
      button._labelEl.textContent = mode === 'local' ? 'Mouse' : 'Human';
    }
    button.style.opacity = this._humanSwitchState.hiding ? '0.92' : '1';
  }

  _bindHoldButton(button, onDown, onUp) {
    let heldPointerId = null;

    const end = (pointerId = heldPointerId) => {
      if (heldPointerId === null) return;
      releasePointerCaptureSafe(button, pointerId);
      heldPointerId = null;
      setButtonActive(button, false);
      onUp?.();
    };

    button.addEventListener('pointerdown', (event) => {
      consumeControlEvent(event);
      if (heldPointerId !== null) return;
      heldPointerId = event.pointerId;
      setPointerCaptureSafe(button, event.pointerId);
      setButtonActive(button, true);
      onDown?.();
    });
    button.addEventListener('pointerup', (event) => {
      if (event.pointerId !== heldPointerId) return;
      consumeControlEvent(event);
      end(event.pointerId);
    });
    button.addEventListener('pointercancel', (event) => {
      if (event.pointerId !== heldPointerId) return;
      consumeControlEvent(event);
      end(event.pointerId);
    });
    button.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId !== heldPointerId) return;
      end(event.pointerId);
    });
  }

  _bindTapButton(button, onTap) {
    let activePointerId = null;

    const clear = (pointerId = activePointerId) => {
      if (activePointerId === null) return;
      releasePointerCaptureSafe(button, pointerId);
      activePointerId = null;
      setButtonActive(button, false);
    };

    button.addEventListener('pointerdown', (event) => {
      consumeControlEvent(event);
      if (activePointerId !== null) return;
      activePointerId = event.pointerId;
      setPointerCaptureSafe(button, event.pointerId);
      setButtonActive(button, true);
      onTap?.();
    });
    button.addEventListener('pointerup', (event) => {
      if (event.pointerId !== activePointerId) return;
      consumeControlEvent(event);
      clear(event.pointerId);
    });
    button.addEventListener('pointercancel', (event) => {
      if (event.pointerId !== activePointerId) return;
      consumeControlEvent(event);
      clear(event.pointerId);
    });
    button.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId !== activePointerId) return;
      clear(event.pointerId);
    });
  }

  _installViewportGestureGuards() {
    this._applyViewportLock();
    this.root.addEventListener('touchstart', this._preventRootTouch, CAPTURE_NON_PASSIVE);
    this.root.addEventListener('touchmove', this._preventRootTouch, CAPTURE_NON_PASSIVE);
    this.root.addEventListener('touchend', this._preventRootTouch, CAPTURE_NON_PASSIVE);
    this.root.addEventListener('touchcancel', this._preventRootTouch, CAPTURE_NON_PASSIVE);
    document.addEventListener('touchmove', this._preventDocumentTouch, NON_PASSIVE);
    window.addEventListener('gesturestart', this._preventDocumentTouch, NON_PASSIVE);
    window.addEventListener('gesturechange', this._preventDocumentTouch, NON_PASSIVE);
    window.addEventListener('contextmenu', this._preventDocumentTouch, NON_PASSIVE);
  }

  _applyViewportLock() {
    if (this._viewportLocked) return;
    const html = document.documentElement;
    const body = document.body;
    const canvas = document.getElementById('canvas');
    this._previousViewportStyles = {
      html: {
        touchAction: html.style.touchAction,
        overscrollBehavior: html.style.overscrollBehavior,
        userSelect: html.style.userSelect,
        WebkitUserSelect: html.style.WebkitUserSelect,
        WebkitTouchCallout: html.style.WebkitTouchCallout,
      },
      body: {
        touchAction: body.style.touchAction,
        overscrollBehavior: body.style.overscrollBehavior,
        userSelect: body.style.userSelect,
        WebkitUserSelect: body.style.WebkitUserSelect,
        WebkitTouchCallout: body.style.WebkitTouchCallout,
      },
      canvas: canvas ? {
        touchAction: canvas.style.touchAction,
        userSelect: canvas.style.userSelect,
        WebkitUserSelect: canvas.style.WebkitUserSelect,
        WebkitTapHighlightColor: canvas.style.WebkitTapHighlightColor,
      } : null,
    };

    Object.assign(html.style, {
      touchAction: 'none',
      overscrollBehavior: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
    });
    Object.assign(body.style, {
      touchAction: 'none',
      overscrollBehavior: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
    });
    if (canvas) {
      Object.assign(canvas.style, {
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      });
    }

    this._viewportLocked = true;
  }

  _releaseViewportLock() {
    if (!this._viewportLocked || !this._previousViewportStyles) return;
    const html = document.documentElement;
    const body = document.body;
    const canvas = document.getElementById('canvas');
    Object.assign(html.style, this._previousViewportStyles.html);
    Object.assign(body.style, this._previousViewportStyles.body);
    if (canvas && this._previousViewportStyles.canvas) {
      Object.assign(canvas.style, this._previousViewportStyles.canvas);
    }
    this._previousViewportStyles = null;
    this._viewportLocked = false;
  }

  show() {
    this.root.style.display = 'block';
    this._applyViewportLock();
    this._applySideLayout();
  }

  _releaseHeldInputs() {
    const kb = this.controller?.keyBindings;
    if (kb) {
      this.controller.keys[kb.sprint] = false;
      this.controller.keys[kb.jump] = false;
      this.controller.keys[kb.interact] = false;
      this.controller.keys[kb.grab] = false;
      this.controller.keys[kb.drop] = false;
      this.controller.keys[kb.ropeGrab] = false;
    }
    this._held.jump = false;
    this._held.sprint = false;
    this._held.interact = false;
    for (const button of Object.values(this._buttons)) {
      setButtonActive(button, false);
    }
  }

  hide() {
    this.root.style.display = 'none';
    this._releaseHeldInputs();
    this._releaseViewportLock();
  }

  dispose() {
    this._releaseHeldInputs();
    this.root.removeEventListener('touchstart', this._preventRootTouch, true);
    this.root.removeEventListener('touchmove', this._preventRootTouch, true);
    this.root.removeEventListener('touchend', this._preventRootTouch, true);
    this.root.removeEventListener('touchcancel', this._preventRootTouch, true);
    document.removeEventListener('touchmove', this._preventDocumentTouch);
    window.removeEventListener('gesturestart', this._preventDocumentTouch);
    window.removeEventListener('gesturechange', this._preventDocumentTouch);
    window.removeEventListener('contextmenu', this._preventDocumentTouch);
    this._releaseViewportLock();
    this.root.remove();
  }
}
