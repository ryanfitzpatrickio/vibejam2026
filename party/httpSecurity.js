const DEFAULT_ALLOWED_ORIGINS = Object.freeze(['https://mouse.ryanfitzpatrick.io']);
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const LOCAL_HOSTNAME_RE = /^(?:localhost|127\.0\.0\.1|\[?::1\]?)$/;
const CONNECT_RATE_WINDOW_MS = 60_000;
const MAX_CONNECT_ATTEMPTS_PER_WINDOW = 30;

const connectAttempts = new Map();

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function isProductionEnv(env) {
  return String(env?.ENVIRONMENT ?? env?.NODE_ENV ?? '').toLowerCase() === 'production';
}

function isLocalRequestUrl(request) {
  try {
    const url = new URL(request.url);
    return LOCAL_HOSTNAME_RE.test(url.hostname);
  } catch {
    return false;
  }
}

function getAllowedOrigins(env) {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const key of ['ALLOWED_ORIGINS', 'GAME_ORIGIN', 'PUBLIC_GAME_ORIGIN']) {
    for (const origin of splitCsv(env?.[key])) {
      const normalized = normalizeOrigin(origin);
      if (normalized) origins.add(normalized);
    }
  }
  return origins;
}

/**
 * Origin check for WebSocket upgrades.
 *
 * Browsers ALWAYS send Origin on cross-origin WS upgrades; non-browser clients
 * (node `ws`, python, curl) typically omit it. We treat empty Origin as
 * untrusted in production — set ALLOW_EMPTY_ORIGIN=true only for debugging.
 */
export function isAllowedOrigin(origin, env, request = null) {
  if (!origin) {
    const allowEmpty = String(env?.ALLOW_EMPTY_ORIGIN ?? '').toLowerCase();
    return (allowEmpty === 'true' || allowEmpty === '1') && !isProductionEnv(env);
  }
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (LOCAL_ORIGIN_RE.test(normalized)) {
    return !!request && isLocalRequestUrl(request) && !isProductionEnv(env);
  }
  return getAllowedOrigins(env).has(normalized);
}

export function corsHeadersForRequest(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  if (!origin || !isAllowedOrigin(origin, env, request)) return {};
  return {
    'Access-Control-Allow-Origin': normalizeOrigin(origin),
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  };
}

export function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeadersForRequest(request, env),
    },
  });
}

function getClientRateKey(request) {
  const forwarded = request.headers.get('X-Forwarded-For') ?? '';
  const ip = request.headers.get('CF-Connecting-IP') ?? forwarded.split(',')[0]?.trim() ?? '';
  const origin = normalizeOrigin(request.headers.get('Origin') ?? '') || 'no-origin';
  return ip ? `${ip}:${origin}` : `unknown:${origin}`;
}

export function consumeConnectAttempt(request, now = Date.now()) {
  const key = getClientRateKey(request);
  let bucket = connectAttempts.get(key);
  if (!bucket || now - bucket.windowStart >= CONNECT_RATE_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    connectAttempts.set(key, bucket);
  }

  bucket.count += 1;
  if (connectAttempts.size > 1000) {
    for (const [entryKey, entry] of connectAttempts) {
      if (now - entry.windowStart >= CONNECT_RATE_WINDOW_MS) {
        connectAttempts.delete(entryKey);
      }
    }
  }
  return bucket.count <= MAX_CONNECT_ATTEMPTS_PER_WINDOW;
}

export async function gateWebSocketConnection(request, lobby) {
  if (!isAllowedOrigin(request.headers.get('Origin') ?? '', lobby.env, request)) {
    return new Response('Forbidden origin', { status: 403 });
  }

  if (!consumeConnectAttempt(request)) {
    return new Response('Too many connection attempts', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  return request;
}
