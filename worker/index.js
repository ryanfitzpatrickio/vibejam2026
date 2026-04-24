const GLOBAL_STATS_KEY = 'stats:v1:global';
const UNIQUE_PLAYER_BUCKET_COUNT = 8192;
const LEADERBOARD_LIMIT = 10;
const ROOM_REGISTRY_PREFIX = 'rooms:v1:room:';
const DEFAULT_PUBLIC_ROOM_ID = 'default';
const PUBLIC_ROOM_PREFIX = 'pub-';
const PRIVATE_ROOM_PREFIX = 'priv-';
const PUBLIC_ROOM_CAPACITY = 16;
const DEFAULT_BOT_FILL_TARGET = 8;
const ROOM_STATE_TTL_SECONDS = 60 * 60 * 24 * 7;
const ROOM_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const JSON_CONTENT_TYPE_RE = /^application\/(?:[\w.-]+\+)?json\b/i;
const MATCHMAKE_JSON_MAX_BYTES = 4096;
const ROOM_EVENT_JSON_MAX_BYTES = 16 * 1024;
const STATS_EVENT_JSON_MAX_BYTES = 128 * 1024;
const STATS_EVENT_MAX_PLAYERS = 128;
const MATCHMAKE_RATE_WINDOW_MS = 60_000;
const MATCHMAKE_MAX_REQUESTS_PER_WINDOW = 60;
const PRIVATE_MATCHMAKE_MAX_REQUESTS_PER_WINDOW = 12;
const matchmakeBuckets = new Map();
const jsonTextEncoder = new TextEncoder();

const BASE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://vibejam.cc https://vibej.am https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://vibejam.cc https://vibej.am https://static.cloudflareinsights.com https://cloudflareinsights.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "frame-src https://vibejam.cc https://vibej.am https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
];

const SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), fullscreen=(self), gamepad=(self)',
});

const HSTS_HEADER = 'max-age=31536000; includeSubDomains; preload';

const GLOBAL_INCREMENT_FIELDS = Object.freeze([
  'totalConnections',
  'totalDeaths',
  'totalRespawns',
  'totalCatHits',
  'totalPlaySeconds',
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function getContentSecurityPolicy(request, env) {
  const url = new URL(request.url);
  const isLocalRequest = isLocalHostname(url.hostname);
  const allowDevConnect = isLocalRequest || String(env?.ALLOW_DEV_CSP_CONNECT ?? '').toLowerCase() === 'true';
  const connectSources = [
    "'self'",
    'blob:',
    'https://vibejam.cc',
    'https://vibej.am',
    'https://static.cloudflareinsights.com',
    'https://cloudflareinsights.com',
    'https://*.partykit.dev',
    'https://*.partykit.io',
    'https://party.ryanfitzpatrick.io',
    'wss://*.partykit.dev',
    'wss://*.partykit.io',
    'wss://party.ryanfitzpatrick.io',
  ];
  if (allowDevConnect) {
    connectSources.push('wss://localhost:*', 'ws://localhost:*', 'http://localhost:*');
  }
  return [
    ...BASE_CONTENT_SECURITY_POLICY.slice(0, 5),
    `connect-src ${connectSources.join(' ')}`,
    ...BASE_CONTENT_SECURITY_POLICY.slice(5),
  ].join('; ');
}

function withSecurityHeaders(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set('Content-Security-Policy', getContentSecurityPolicy(request, env));

  const url = new URL(request.url);
  if (url.protocol === 'https:' && !isLocalHostname(url.hostname)) {
    headers.set('Strict-Transport-Security', HSTS_HEADER);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createGlobalStats(now = Date.now()) {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalConnections: 0,
    uniquePlayers: 0,
    peakConcurrent: 0,
    totalDeaths: 0,
    totalRespawns: 0,
    totalCatHits: 0,
    totalPlaySeconds: 0,
    leaderboards: createLeaderboards(),
    uniquePlayerBase: 0,
    uniquePlayerBucketCount: UNIQUE_PLAYER_BUCKET_COUNT,
    uniquePlayerBuckets: '',
  };
}

function normalizeDisplayName(value) {
  const name = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return name || 'Mouse';
}

function createLeaderboards() {
  return {
    bestChase: [],
    bestCheeseHeld: [],
    bestAdversary: [],
  };
}

function ensureLeaderboards(global) {
  if (!global.leaderboards || typeof global.leaderboards !== 'object') {
    global.leaderboards = createLeaderboards();
  }
  if (!Array.isArray(global.leaderboards.bestChase)) global.leaderboards.bestChase = [];
  if (!Array.isArray(global.leaderboards.bestCheeseHeld)) global.leaderboards.bestCheeseHeld = [];
  if (!Array.isArray(global.leaderboards.bestAdversary)) global.leaderboards.bestAdversary = [];
  return global.leaderboards;
}

function publicLeaderboardEntry(entry) {
  return {
    displayName: normalizeDisplayName(entry?.displayName),
    value: Number(entry?.value) || 0,
    updatedAt: Number(entry?.updatedAt) || 0,
  };
}

function publicLeaderboards(global) {
  const leaderboards = ensureLeaderboards(global);
  const cap = (arr) => (Array.isArray(arr) ? arr.slice(0, LEADERBOARD_LIMIT) : []);
  return {
    bestChase: cap(leaderboards.bestChase).map(publicLeaderboardEntry),
    bestCheeseHeld: cap(leaderboards.bestCheeseHeld).map(publicLeaderboardEntry),
    bestAdversary: cap(leaderboards.bestAdversary).map(publicLeaderboardEntry),
  };
}

function upsertLeaderboardEntry(global, boardName, { playerHash, displayName, value, updatedAt = Date.now() }) {
  if (!isPlayerHash(playerHash)) return false;
  const numericValue = Number(value) || 0;
  if (numericValue <= 0) return false;

  const leaderboards = ensureLeaderboards(global);
  const board = leaderboards[boardName];
  if (!Array.isArray(board)) return false;

  const roundedValue = boardName === 'bestChase' || boardName === 'bestAdversary'
    ? Math.round(numericValue * 10) / 10
    : Math.floor(numericValue);
  const name = normalizeDisplayName(displayName);
  const existing = board.find((entry) => entry?.playerHash === playerHash);
  if (existing) {
    if ((Number(existing.value) || 0) > roundedValue) return false;
    if ((Number(existing.value) || 0) === roundedValue && existing.displayName === name) return false;
    existing.value = roundedValue;
    existing.displayName = name;
    existing.updatedAt = updatedAt;
  } else {
    board.push({
      playerHash,
      displayName: name,
      value: roundedValue,
      updatedAt,
    });
  }

  board.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
    || (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0)
    || normalizeDisplayName(a.displayName).localeCompare(normalizeDisplayName(b.displayName)));
  if (board.length > LEADERBOARD_LIMIT) board.length = LEADERBOARD_LIMIT;
  return true;
}

async function readJson(kv, key) {
  const value = await kv.get(key);
  return value ? JSON.parse(value) : null;
}

async function writeJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

function getBearerToken(request) {
  const authHeader = request.headers.get('Authorization') ?? '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function authorize(request, expectedToken) {
  return Boolean(expectedToken) && getBearerToken(request) === expectedToken;
}

async function readLimitedJson(request, maxBytes) {
  const type = request.headers.get('Content-Type') ?? '';
  if (type && !JSON_CONTENT_TYPE_RE.test(type)) {
    return { error: 'Unsupported media type', status: 415 };
  }
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { error: 'Payload too large', status: 413 };
  }
  const text = await request.text();
  if (jsonTextEncoder.encode(text).length > maxBytes) {
    return { error: 'Payload too large', status: 413 };
  }
  try {
    return { value: text ? JSON.parse(text) : {} };
  } catch {
    return { error: 'Invalid JSON', status: 400 };
  }
}

function getClientRateKey(request) {
  const forwarded = request.headers.get('X-Forwarded-For') ?? '';
  const ip = request.headers.get('CF-Connecting-IP') ?? forwarded.split(',')[0]?.trim() ?? '';
  return ip || `unknown:${request.headers.get('User-Agent') ?? ''}`.slice(0, 96);
}

function consumeMatchmakeRequest(request, { isPrivate = false } = {}, now = Date.now()) {
  const key = getClientRateKey(request);
  let bucket = matchmakeBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= MATCHMAKE_RATE_WINDOW_MS) {
    bucket = { windowStart: now, total: 0, privateTotal: 0 };
    matchmakeBuckets.set(key, bucket);
  }
  bucket.total += 1;
  if (isPrivate) bucket.privateTotal += 1;

  if (matchmakeBuckets.size > 5000) {
    for (const [entryKey, entry] of matchmakeBuckets) {
      if (now - entry.windowStart >= MATCHMAKE_RATE_WINDOW_MS) {
        matchmakeBuckets.delete(entryKey);
      }
    }
  }

  return bucket.total <= MATCHMAKE_MAX_REQUESTS_PER_WINDOW
    && bucket.privateTotal <= PRIVATE_MATCHMAKE_MAX_REQUESTS_PER_WINDOW;
}

function safePositiveInteger(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function isPlayerHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function decodeBitset(value, bitCount) {
  const byteLength = Math.ceil(bitCount / 8);
  const bytes = new Uint8Array(byteLength);
  if (typeof value !== 'string' || value === '') return bytes;

  try {
    const binary = atob(value);
    for (let i = 0; i < Math.min(binary.length, byteLength); i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {}
  return bytes;
}

function encodeBitset(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function playerHashBucket(playerHash, bitCount) {
  return Number.parseInt(playerHash.slice(0, 12), 16) % bitCount;
}

function markBit(bytes, bitIndex) {
  const byteIndex = Math.floor(bitIndex / 8);
  const mask = 1 << (bitIndex % 8);
  const wasSet = (bytes[byteIndex] & mask) !== 0;
  bytes[byteIndex] |= mask;
  return !wasSet;
}

function estimateBitsetCardinality(bytes, bitCount) {
  let zeroes = 0;
  for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
    const byteIndex = Math.floor(bitIndex / 8);
    const mask = 1 << (bitIndex % 8);
    if ((bytes[byteIndex] & mask) === 0) zeroes += 1;
  }
  if (zeroes === 0) return bitCount;
  return Math.round(-bitCount * Math.log(zeroes / bitCount));
}

function roomRegistryKey(roomId) {
  return `${ROOM_REGISTRY_PREFIX}${roomId}`;
}

function sanitizeRoomId(value) {
  const roomId = String(value ?? '').trim().toLowerCase();
  return ROOM_ID_RE.test(roomId) ? roomId : '';
}

function inferRoomVisibility(roomId) {
  if (roomId === DEFAULT_PUBLIC_ROOM_ID || roomId.startsWith(PUBLIC_ROOM_PREFIX)) return 'public';
  return 'private';
}

function normalizeRoomVisibility(value, roomId) {
  return value === 'public' || value === 'private'
    ? value
    : inferRoomVisibility(roomId);
}

function createRoomRecord(roomId, {
  visibility = inferRoomVisibility(roomId),
  humans = 0,
  bots = 0,
  occupants = humans + bots,
  capacity = PUBLIC_ROOM_CAPACITY,
  botFillTarget = DEFAULT_BOT_FILL_TARGET,
  createdAt = Date.now(),
  updatedAt = createdAt,
} = {}) {
  return {
    version: 1,
    roomId,
    visibility,
    humans: safePositiveInteger(humans),
    bots: safePositiveInteger(bots),
    occupants: safePositiveInteger(occupants),
    capacity: safePositiveInteger(capacity) || PUBLIC_ROOM_CAPACITY,
    botFillTarget: safePositiveInteger(botFillTarget) || DEFAULT_BOT_FILL_TARGET,
    createdAt: safePositiveInteger(createdAt) || Date.now(),
    updatedAt: safePositiveInteger(updatedAt) || Date.now(),
  };
}

function makeRoomId(prefix) {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function listRoomRecords(kv) {
  const page = await kv.list({ prefix: ROOM_REGISTRY_PREFIX, limit: 1000 });
  if (!Array.isArray(page?.keys) || page.keys.length === 0) return [];
  const records = await Promise.all(page.keys.map(async ({ name }) => {
    try {
      const text = await kv.get(name);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }));
  return records.filter((record) => record && sanitizeRoomId(record.roomId));
}

async function upsertRoomRecord(kv, roomId, updates = {}) {
  const key = roomRegistryKey(roomId);
  const now = Date.now();
  const existing = await readJson(kv, key);
  const record = createRoomRecord(roomId, {
    visibility: normalizeRoomVisibility(
      updates.visibility ?? existing?.visibility,
      roomId,
    ),
    humans: updates.humans ?? existing?.humans ?? 0,
    bots: updates.bots ?? existing?.bots ?? 0,
    occupants: updates.occupants ?? existing?.occupants ?? ((updates.humans ?? existing?.humans ?? 0) + (updates.bots ?? existing?.bots ?? 0)),
    capacity: updates.capacity ?? existing?.capacity ?? PUBLIC_ROOM_CAPACITY,
    botFillTarget: updates.botFillTarget ?? existing?.botFillTarget ?? DEFAULT_BOT_FILL_TARGET,
    createdAt: existing?.createdAt ?? now,
    updatedAt: updates.updatedAt ?? now,
  });
  await kv.put(key, JSON.stringify(record), { expirationTtl: ROOM_STATE_TTL_SECONDS });
  return record;
}

function comparePublicRoomsForFill(a, b) {
  const humansDelta = (Number(b?.humans) || 0) - (Number(a?.humans) || 0);
  if (humansDelta !== 0) return humansDelta;
  const createdDelta = (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
  if (createdDelta !== 0) return createdDelta;
  return String(a?.roomId ?? '').localeCompare(String(b?.roomId ?? ''));
}

async function allocatePublicRoom(kv, { excludeRoomId = '' } = {}) {
  const records = await listRoomRecords(kv);
  const publicRooms = records.filter((record) => record.visibility === 'public');
  const eligible = publicRooms
    .filter((record) => record.roomId !== excludeRoomId)
    .filter((record) => (safePositiveInteger(record.capacity) || PUBLIC_ROOM_CAPACITY) > safePositiveInteger(record.humans))
    .sort(comparePublicRoomsForFill);

  if (eligible.length > 0) return eligible[0];

  const roomId = publicRooms.length === 0
    ? DEFAULT_PUBLIC_ROOM_ID
    : makeRoomId(PUBLIC_ROOM_PREFIX);
  return await upsertRoomRecord(kv, roomId, {
    visibility: 'public',
    humans: 0,
    bots: 0,
    occupants: 0,
    capacity: PUBLIC_ROOM_CAPACITY,
    botFillTarget: DEFAULT_BOT_FILL_TARGET,
  });
}

function buildPrivateShareUrl(request, roomId) {
  const url = new URL(request.url);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomId);
  url.searchParams.set('private', '1');
  return url.toString();
}

async function handleMatchmake(request, env) {
  if (!env.GAME_STATS) {
    return json({ error: 'GAME_STATS KV binding is not configured' }, 503);
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const parsed = await readLimitedJson(request, MATCHMAKE_JSON_MAX_BYTES);
  if (parsed.error) {
    return json({ error: parsed.error }, parsed.status);
  }
  const payload = parsed.value ?? {};

  const explicitRoomId = sanitizeRoomId(payload?.roomId);
  const excludeRoomId = sanitizeRoomId(payload?.excludeRoomId);
  const mode = payload?.mode === 'private' || (explicitRoomId && inferRoomVisibility(explicitRoomId) === 'private')
    ? 'private'
    : 'public';

  if (!consumeMatchmakeRequest(request, { isPrivate: mode === 'private' })) {
    return json({ error: 'Too many matchmaking requests' }, 429);
  }

  if (mode === 'private') {
    const roomId = makeRoomId(PRIVATE_ROOM_PREFIX);
    const record = await upsertRoomRecord(env.GAME_STATS, roomId, {
      visibility: 'private',
      humans: 0,
      bots: 0,
      occupants: 0,
      capacity: PUBLIC_ROOM_CAPACITY,
      botFillTarget: DEFAULT_BOT_FILL_TARGET,
    });
    return json({
      ok: true,
      roomId: record.roomId,
      visibility: record.visibility,
      capacity: record.capacity,
      shareUrl: buildPrivateShareUrl(request, record.roomId),
    });
  }

  const record = await allocatePublicRoom(env.GAME_STATS, { excludeRoomId });
  return json({
    ok: true,
    roomId: record.roomId,
    visibility: record.visibility,
    capacity: record.capacity,
  });
}

async function handleRoomEvent(request, env) {
  if (!env.GAME_STATS) {
    return json({ error: 'GAME_STATS KV binding is not configured' }, 503);
  }
  if (!authorize(request, env.STATS_COLLECTOR_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const parsed = await readLimitedJson(request, ROOM_EVENT_JSON_MAX_BYTES);
  if (parsed.error) {
    return json({ error: parsed.error }, parsed.status);
  }
  const payload = parsed.value;

  if (payload?.type !== 'room-state' || payload?.version !== 1) {
    return json({ error: 'Invalid room event' }, 400);
  }

  const roomId = sanitizeRoomId(payload.roomId);
  if (!roomId) {
    return json({ error: 'Invalid roomId' }, 400);
  }

  const humans = safePositiveInteger(payload.humans);
  const bots = safePositiveInteger(payload.bots);
  const record = await upsertRoomRecord(env.GAME_STATS, roomId, {
    visibility: normalizeRoomVisibility(payload.visibility, roomId),
    humans,
    bots,
    occupants: safePositiveInteger(payload.occupants) || (humans + bots),
    capacity: safePositiveInteger(payload.capacity) || PUBLIC_ROOM_CAPACITY,
    botFillTarget: safePositiveInteger(payload.botFillTarget) || DEFAULT_BOT_FILL_TARGET,
    updatedAt: safePositiveInteger(payload.updatedAt) || Date.now(),
  });

  return json({
    ok: true,
    roomId: record.roomId,
    visibility: record.visibility,
    humans: record.humans,
    bots: record.bots,
    occupants: record.occupants,
    capacity: record.capacity,
  });
}

function applyUniquePlayerEstimate(global, playerHashes) {
  const hadBuckets = typeof global.uniquePlayerBuckets === 'string' && global.uniquePlayerBuckets !== '';
  const bitCount = safePositiveInteger(global.uniquePlayerBucketCount ?? UNIQUE_PLAYER_BUCKET_COUNT) || UNIQUE_PLAYER_BUCKET_COUNT;
  const base = safePositiveInteger(global.uniquePlayerBase ?? (hadBuckets ? 0 : global.uniquePlayers));
  const buckets = decodeBitset(global.uniquePlayerBuckets, bitCount);
  let changed = false;

  for (const playerHash of playerHashes) {
    changed = markBit(buckets, playerHashBucket(playerHash, bitCount)) || changed;
  }

  if (!changed && hadBuckets) return;

  global.uniquePlayerBase = base;
  global.uniquePlayerBucketCount = bitCount;
  global.uniquePlayerBuckets = encodeBitset(buckets);
  global.uniquePlayers = base + estimateBitsetCardinality(buckets, bitCount);
}

function applyIncrements(target, source, fields) {
  for (const field of fields) {
    target[field] += safePositiveInteger(source?.[field] ?? 0);
  }
}

async function handleStatsEvent(request, env) {
  if (!env.GAME_STATS) {
    return json({ error: 'GAME_STATS KV binding is not configured' }, 503);
  }

  if (!authorize(request, env.STATS_COLLECTOR_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const parsed = await readLimitedJson(request, STATS_EVENT_JSON_MAX_BYTES);
  if (parsed.error) {
    return json({ error: parsed.error }, parsed.status);
  }
  const payload = parsed.value;

  if (payload?.type !== 'stats-delta' || payload.version !== 1) {
    return json({ error: 'Invalid stats event' }, 400);
  }
  if (Array.isArray(payload.players) && payload.players.length > STATS_EVENT_MAX_PLAYERS) {
    return json({ error: 'Too many player updates' }, 413);
  }

  const kv = env.GAME_STATS;
  const now = Date.now();
  const global = await readJson(kv, GLOBAL_STATS_KEY) ?? createGlobalStats(now);
  ensureLeaderboards(global);

  applyIncrements(global, payload.global, GLOBAL_INCREMENT_FIELDS);
  global.peakConcurrent = Math.max(
    global.peakConcurrent,
    safePositiveInteger(payload.global?.peakConcurrent ?? 0),
  );

  const acceptedPlayerHashes = [];
  const players = Array.isArray(payload.players) ? payload.players : [];
  for (const incoming of players) {
    if (isPlayerHash(incoming?.playerHash)) {
      acceptedPlayerHashes.push(incoming.playerHash);
      upsertLeaderboardEntry(global, 'bestChase', {
        playerHash: incoming.playerHash,
        displayName: incoming.displayName,
        value: incoming.bestChaseSeconds,
        updatedAt: safePositiveInteger(incoming.lastSeen ?? now) || now,
      });
      upsertLeaderboardEntry(global, 'bestCheeseHeld', {
        playerHash: incoming.playerHash,
        displayName: incoming.displayName,
        value: incoming.bestCheeseHeld,
        updatedAt: safePositiveInteger(incoming.lastSeen ?? now) || now,
      });
      upsertLeaderboardEntry(global, 'bestAdversary', {
        playerHash: incoming.playerHash,
        displayName: incoming.displayName,
        value: incoming.bestAdversarySeconds,
        updatedAt: safePositiveInteger(incoming.lastSeen ?? now) || now,
      });
    }
  }
  applyUniquePlayerEstimate(global, acceptedPlayerHashes);

  global.updatedAt = now;
  await writeJson(kv, GLOBAL_STATS_KEY, global);

  return json({
    ok: true,
    acceptedPlayers: acceptedPlayerHashes.length,
    updatedAt: global.updatedAt,
  });
}

async function handleStatsSummary(request, env) {
  if (!env.GAME_STATS) {
    return json({ error: 'GAME_STATS KV binding is not configured' }, 503);
  }

  const admin = typeof env.STATS_ADMIN_TOKEN === 'string' ? env.STATS_ADMIN_TOKEN.trim() : '';

  if (!admin) {
    return json({ error: 'STATS_ADMIN_TOKEN must be configured' }, 503);
  }

  if (!authorize(request, admin)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const summary = await readJson(env.GAME_STATS, GLOBAL_STATS_KEY) ?? createGlobalStats();
  ensureLeaderboards(summary);
  const {
    uniquePlayerBase,
    uniquePlayerBucketCount,
    uniquePlayerBuckets,
    ...publicSummary
  } = summary;
  return json({
    ...publicSummary,
    leaderboards: publicLeaderboards(summary),
    storage: 'cloudflare-kv',
  });
}

async function handleLeaderboard(request, env) {
  if (!env.GAME_STATS) {
    return json({ error: 'GAME_STATS KV binding is not configured' }, 503);
  }

  const summary = await readJson(env.GAME_STATS, GLOBAL_STATS_KEY) ?? createGlobalStats();
  ensureLeaderboards(summary);
  return json({
    version: 1,
    updatedAt: summary.updatedAt ?? 0,
    storage: 'cloudflare-kv',
    leaderboards: publicLeaderboards(summary),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;

    if (url.pathname === '/api/stats/event' && request.method === 'POST') {
      response = await handleStatsEvent(request, env);
    } else if (url.pathname === '/api/rooms/event' && request.method === 'POST') {
      response = await handleRoomEvent(request, env);
    } else if (url.pathname === '/api/matchmake') {
      response = await handleMatchmake(request, env);
    } else if (url.pathname === '/api/stats' && request.method === 'GET') {
      response = await handleStatsSummary(request, env);
    } else if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      response = await handleLeaderboard(request, env);
    } else if (url.pathname.startsWith('/api/')) {
      response = json({ error: 'Not found' }, 404);
    } else if (env.ASSETS) {
      response = await env.ASSETS.fetch(request);
    } else {
      response = new Response('Not found', { status: 404 });
    }

    return withSecurityHeaders(response, request, env);
  },
};
