// Silence all console output in production. Runs before any module-level log
// fires. Gated by Vite's `import.meta.env.PROD`, so dev + `vite preview` when
// NODE_ENV=development still log normally. Complements the build-time drop in
// vite.config.js (`esbuild.drop`), which strips the calls outright — this
// runtime shim is the belt that catches anything the suspenders miss
// (dynamic imports, vendor code that checks `typeof console.log`, etc.).
if (import.meta.env.PROD) {
  const noop = () => {};
  for (const key of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog', 'count', 'countReset', 'assert']) {
    if (typeof console[key] === 'function') console[key] = noop;
  }
}

import { createGameSession } from './app/createGameSession.js';
import { RendererModePanel, readRendererMode } from './hud/RendererModePanel.js';

readRendererMode(); // migrate legacy localStorage `webgpu` → `webgl`

const canvas = document.getElementById('canvas');
const ROOM_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BUILD_MODE_PROFILE = import.meta.env.MODE === 'buildmode';

const modePanel = new RendererModePanel({
  visible: false,
});

let app;
let buildMode = null;
let mobileControls = null;

const isCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
const shouldShowMobileControls = isCoarsePointer || navigator.maxTouchPoints > 0;
let bootRoomId = 'default';
let bootRoomVisibility = 'public';
let handlingRoomRedirect = false;
let matchmakeEndpointAvailable = null;

function sanitizeRoomId(value) {
  const roomId = String(value ?? '').trim().toLowerCase();
  return ROOM_ID_RE.test(roomId) ? roomId : '';
}

function isTruthyFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function inferRoomVisibility(roomId) {
  return String(roomId).startsWith('priv-') ? 'private' : 'public';
}

function nextPublicOverflowRoomId(currentRoomId = 'default') {
  const roomId = sanitizeRoomId(currentRoomId) || 'default';
  if (roomId === 'default') return 'pub-1';
  const match = /^pub-(\d+)$/.exec(roomId);
  if (!match) return 'pub-1';
  return `pub-${Number.parseInt(match[1], 10) + 1}`;
}

function isMatchmakeEndpointMissing(error) {
  return /matchmake returned (404|405)/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function buildRoomUrl(roomId, { isPrivate = false } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  if (isPrivate) {
    url.searchParams.set('private', '1');
  } else {
    url.searchParams.delete('private');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function replaceUrlRoom(roomId, { isPrivate = false } = {}) {
  window.history.replaceState({}, '', buildRoomUrl(roomId, { isPrivate }));
}

function makeLocalPrivateRoomId() {
  return `priv-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function resolveBootRoomId() {
  const url = new URL(window.location.href);
  const explicitRoomId = sanitizeRoomId(url.searchParams.get('room'));
  if (explicitRoomId) {
    bootRoomId = explicitRoomId;
    bootRoomVisibility = inferRoomVisibility(explicitRoomId);
    return explicitRoomId;
  }

  const wantsPrivate = isTruthyFlag(url.searchParams.get('private'));
  if (matchmakeEndpointAvailable !== false) {
    try {
      const response = await fetch('/api/matchmake', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: wantsPrivate ? 'private' : 'public',
        }),
      });
      if (!response.ok) {
        throw new Error(`matchmake returned ${response.status}`);
      }
      const payload = await response.json();
      const roomId = sanitizeRoomId(payload?.roomId);
      if (roomId) {
        matchmakeEndpointAvailable = true;
        bootRoomId = roomId;
        bootRoomVisibility = payload?.visibility === 'private' || wantsPrivate ? 'private' : 'public';
        if (bootRoomVisibility === 'private') {
          replaceUrlRoom(roomId, { isPrivate: true });
        }
        return roomId;
      }
    } catch (error) {
      if (isMatchmakeEndpointMissing(error)) {
        matchmakeEndpointAvailable = false;
      }
      console.warn('[boot] matchmaking unavailable, falling back:', error);
    }
  }

  if (wantsPrivate) {
    const roomId = makeLocalPrivateRoomId();
    bootRoomId = roomId;
    bootRoomVisibility = 'private';
    replaceUrlRoom(roomId, { isPrivate: true });
    return roomId;
  }
  bootRoomId = 'default';
  bootRoomVisibility = 'public';
  return 'default';
}

async function requestMatchmake({ mode = 'public', excludeRoomId = '' } = {}) {
  if (matchmakeEndpointAvailable !== false) {
    try {
      const response = await fetch('/api/matchmake', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode, excludeRoomId }),
      });
      if (!response.ok) {
        throw new Error(`matchmake returned ${response.status}`);
      }
      const payload = await response.json();
      const roomId = sanitizeRoomId(payload?.roomId);
      if (!roomId) {
        throw new Error('matchmake returned no room id');
      }
      matchmakeEndpointAvailable = true;
      return {
        roomId,
        visibility: payload?.visibility === 'private' ? 'private' : 'public',
        shareUrl: typeof payload?.shareUrl === 'string' ? payload.shareUrl : '',
      };
    } catch (error) {
      if (!isMatchmakeEndpointMissing(error)) throw error;
      matchmakeEndpointAvailable = false;
      console.warn('[matchmake] endpoint unavailable, using local fallback:', error);
    }
  }
  if (mode === 'private') {
    const roomId = makeLocalPrivateRoomId();
    return {
      roomId,
      visibility: 'private',
      shareUrl: new URL(buildRoomUrl(roomId, { isPrivate: true }), window.location.href).toString(),
    };
  }
  const roomId = nextPublicOverflowRoomId(excludeRoomId || bootRoomId);
  return {
    roomId,
    visibility: 'public',
    shareUrl: '',
  };
}

function navigateToRoom(roomId, { visibility = inferRoomVisibility(roomId), replace = false } = {}) {
  const href = buildRoomUrl(roomId, { isPrivate: visibility === 'private' });
  handlingRoomRedirect = true;
  if (replace) window.location.replace(href);
  else window.location.assign(href);
}

async function copyCurrentInviteLink() {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set('room', bootRoomId);
  shareUrl.searchParams.set('private', '1');
  const text = shareUrl.toString();
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard unavailable');
  }
  await navigator.clipboard.writeText(text);
  return 'Copied invite';
}

async function createAndJoinPrivateRoom() {
  const { roomId, visibility } = await requestMatchmake({ mode: 'private' });
  navigateToRoom(roomId, { visibility });
  return 'Opening private room';
}

function installRoomRecovery(currentRoomId, currentVisibility) {
  return app?.net?.on?.(async (event) => {
    if (event?.type !== 'error' || event?.message !== 'Room full' || handlingRoomRedirect) return;
    if (currentVisibility === 'private') {
      handlingRoomRedirect = true;
      showFatalBootError(new Error('This private room is full. Create a new private room or join public matchmaking.'));
      return;
    }
    try {
      const next = await requestMatchmake({ mode: 'public', excludeRoomId: currentRoomId });
      navigateToRoom(next.roomId || 'default', { visibility: next.visibility || 'public', replace: true });
    } catch (error) {
      handlingRoomRedirect = true;
      showFatalBootError(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function showFatalBootError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error('Fatal boot error:', error);

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(0, 0, 0, 0.88)',
    color: '#fff4ea',
    fontFamily: 'monospace',
    padding: '24px',
  });

  overlay.innerHTML = `
    <div style="max-width:720px;width:100%;border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:18px;background:rgba(20,16,14,0.96)">
      <div style="font-weight:700;color:#ffb089;margin-bottom:10px">APP BOOT FAILED</div>
      <div style="margin-bottom:10px;white-space:pre-wrap">${message}</div>
      <div style="color:#d8c3a8;font-size:12px;line-height:1.4">
        Open the browser console for the full stack trace.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

try {
  const roomId = BUILD_MODE_PROFILE ? 'buildmode-local' : await resolveBootRoomId();
  app = await createGameSession({
    canvas,
    roomId,
    roomVisibility: BUILD_MODE_PROFILE ? 'local' : bootRoomVisibility,
    onCopyInvite: BUILD_MODE_PROFILE ? null : (bootRoomVisibility === 'private' ? copyCurrentInviteLink : null),
    onCreatePrivateRoom: BUILD_MODE_PROFILE ? null : createAndJoinPrivateRoom,
    offlineMode: BUILD_MODE_PROFILE,
  });
  if (!BUILD_MODE_PROFILE) installRoomRecovery(roomId, bootRoomVisibility);
} catch (error) {
  showFatalBootError(error);
  throw error;
}

app.bindPerformancePanel?.(modePanel);

let dressingRoom = null;
if (import.meta.env.DEV) {
  const { installBuildMode } = await import('./dev/installBuildMode.js');
  buildMode = await installBuildMode(app);
  if (BUILD_MODE_PROFILE && !buildMode.isActive?.()) {
    buildMode.toggle();
  }

  const [{ DressingRoomDialog }, { OrbitControls }, { TransformControls }] = await Promise.all([
    import('./dev/DressingRoomDialog.js'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/controls/TransformControls.js'),
  ]);
  dressingRoom = new DressingRoomDialog({ OrbitControls, TransformControls });
}

if (shouldShowMobileControls) {
  const { MobileControls } = await import('./input/MobileControls.js');
  mobileControls = await new MobileControls({
    controller: app.controller,
    thirdPersonCamera: app.thirdPersonCamera,
    onSpawnExtraBall: () => app.spawnExtraBall?.(),
    onOpenEmote: () => app.emoteWheel?.toggle?.(),
  }).init();
  app.setMobileControls(mobileControls);
}

if (buildMode?.isActive?.()) {
  mobileControls?.hide();
}

canvas.addEventListener('click', () => {
  if (buildMode?.isActive?.() || shouldShowMobileControls) return;
  app.thirdPersonCamera.requestPointerLock();
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const target = event.target;
  if (
    target instanceof HTMLElement
    && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
  ) {
    return;
  }

  const key = event.key?.toLowerCase();
  if (key === 'p') {
    modePanel.toggleVisible();
    return;
  }

  if (key === 'b' && buildMode) {
    buildMode.toggle();
    if (buildMode.isActive?.()) {
      mobileControls?.hide();
    } else {
      mobileControls?.show();
    }
    return;
  }

  if (key === 'o') {
    app.toggleNavMeshOverlay?.();
    modePanel.syncPerformanceToggleChecks?.();
  }

  if (key === 'n' && !buildMode?.isActive?.()) {
    if (dressingRoom) {
      dressingRoom.toggle();
    } else {
      app.spawnExtraBall?.();
    }
  }

  if (key === 'r' && !buildMode?.isActive?.()) {
    app.spawnExtraBall?.();
  }
});

function resize() {
  const w = Math.max(1, Math.floor(window.innerWidth));
  const h = Math.max(1, Math.floor(window.innerHeight));
  app.resize(w, h, window.devicePixelRatio);
}

resize();
window.addEventListener('resize', resize);
function handleUnload() {
  if (handlingRoomRedirect) return;
  try { app?.net?.disconnect?.(); } catch {}
  mobileControls?.dispose();
}
window.addEventListener('beforeunload', handleUnload);
window.addEventListener('pagehide', handleUnload);

let lastTime = 0;

function animate(timeMs) {
  const dt = lastTime ? (timeMs - lastTime) * 0.001 : 1 / 60;
  lastTime = timeMs;

  if (buildMode?.isActive?.()) {
    buildMode.update(dt);
  }

  const perf = app.update(timeMs, dt);
  modePanel.updatePerformance({
    timeMs,
    deltaSeconds: dt,
    drawCalls: perf?.drawCalls ?? 0,
    triangles: perf?.triangles ?? 0,
    geometries: perf?.geometries ?? 0,
    textures: perf?.textures ?? 0,
    programs: perf?.programs ?? 0,
    bakeStats: perf?.bakeStats ?? null,
  });
}

app.renderer.setAnimationLoop(animate);
