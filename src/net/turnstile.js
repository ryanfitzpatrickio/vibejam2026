/**
 * Cloudflare Turnstile loader for invisible proof-of-humanity.
 *
 * Used by NetworkClient to attach a single-use `cfToken` to each WebSocket
 * connect via PartySocket's `query` hook. Matches server-side verification
 * in party/server.js `onBeforeConnect` (requires env TURNSTILE_SECRET).
 *
 * No-ops when VITE_TURNSTILE_SITE_KEY is unset (local dev). Tokens are
 * single-use and valid for ~300s; we render a fresh widget per request so
 * reconnects always get a clean token.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const LOAD_TIMEOUT_MS = 8000;
const EXECUTE_TIMEOUT_MS = 15000;

let scriptPromise = null;

function loadTurnstileScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('turnstile: no document'));
      return;
    }
    if (window.turnstile) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const timer = setTimeout(() => reject(new Error('turnstile: script load timeout')), LOAD_TIMEOUT_MS);
    const onReady = () => {
      clearTimeout(timer);
      const start = Date.now();
      const poll = () => {
        if (window.turnstile) return resolve();
        if (Date.now() - start > LOAD_TIMEOUT_MS) return reject(new Error('turnstile: api never appeared'));
        setTimeout(poll, 50);
      };
      poll();
    };
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('turnstile: script error'));
    }, { once: true });
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((err) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

/**
 * Render an invisible Turnstile widget and resolve with its token.
 * Returns '' if no site key is configured.
 */
export async function getTurnstileToken(siteKey) {
  if (!siteKey) return '';
  if (typeof document === 'undefined') return '';
  await loadTurnstileScript();

  return new Promise((resolve, reject) => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    document.body.appendChild(container);

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      try { container.remove(); } catch {}
    };
    const fail = (message) => {
      cleanup();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('turnstile: execute timeout'), EXECUTE_TIMEOUT_MS);

    try {
      window.turnstile.render(container, {
        sitekey: siteKey,
        size: 'invisible',
        retry: 'auto',
        'refresh-expired': 'auto',
        callback: (token) => {
          clearTimeout(timer);
          cleanup();
          resolve(token ?? '');
        },
        'error-callback': () => {
          clearTimeout(timer);
          fail('turnstile: error-callback');
        },
        'timeout-callback': () => {
          clearTimeout(timer);
          fail('turnstile: timeout-callback');
        },
      });
    } catch (err) {
      clearTimeout(timer);
      fail(`turnstile: render threw: ${err?.message || err}`);
    }
  });
}
