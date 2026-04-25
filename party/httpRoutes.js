import { corsHeadersForRequest, jsonResponse } from './httpSecurity.js';

function getPartyEnv(room, key) {
  return room.env?.[key] ?? room.context?.env?.[key] ?? undefined;
}

function bearerTokenFromRequest(request) {
  const authHeader = request.headers.get('Authorization') ?? '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function requireBearerToken(request, expected) {
  return Boolean(expected) && bearerTokenFromRequest(request) === expected;
}

async function handleBenchMetricsRequest(server, request, env, isBenchMetrics, isBenchReset) {
  const benchTok = getPartyEnv(server.room, 'BENCH_METRICS_TOKEN');
  const expected = typeof benchTok === 'string' ? benchTok.trim() : '';
  if (!expected) {
    return jsonResponse(request, env, {
      error: 'Set BENCH_METRICS_TOKEN in PartyKit env to enable bench-metrics',
    }, 503);
  }
  if (!requireBearerToken(request, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.method === 'POST' && isBenchReset) {
    server._resetBenchMetrics();
    return jsonResponse(request, env, { ok: true, reset: true });
  }
  if (request.method === 'GET' && isBenchMetrics) {
    return jsonResponse(request, env, server.getBenchMetricsPayload());
  }
  return new Response('Method not allowed', { status: 405 });
}

async function handleStatsRequest(server, request, env) {
  const adminTok = getPartyEnv(server.room, 'STATS_ADMIN_TOKEN');
  const expectedToken = typeof adminTok === 'string' ? adminTok.trim() : '';

  if (!expectedToken) {
    return jsonResponse(request, env, {
      error: 'Set STATS_ADMIN_TOKEN for /stats',
    }, 503);
  }

  if (!requireBearerToken(request, expectedToken)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const summary = await server.stats.getSummary();
  return jsonResponse(request, env, summary);
}

export async function handleGameServerRequest(server, request) {
  const url = new URL(request.url);
  const env = server.room.env ?? server.room.context?.env ?? {};
  try {
    const isLeaderboardRequest = url.pathname.endsWith('/leaderboard');
    const isStatsRequest = url.pathname.endsWith('/stats');
    const isBenchReset = url.pathname.endsWith('/bench-metrics/reset');
    const isBenchMetrics = url.pathname.endsWith('/bench-metrics') && !isBenchReset;

    if (request.method === 'OPTIONS' && (isLeaderboardRequest || isStatsRequest || isBenchMetrics || isBenchReset)) {
      return new Response(null, {
        status: 204,
        headers: corsHeadersForRequest(request, env),
      });
    }

    if (isLeaderboardRequest) {
      return jsonResponse(request, env, await server.stats.getLeaderboards());
    }

    if (isBenchMetrics || isBenchReset) {
      return handleBenchMetricsRequest(server, request, env, isBenchMetrics, isBenchReset);
    }

    if (!isStatsRequest) {
      return new Response('Not found', { status: 404 });
    }

    return handleStatsRequest(server, request, env);
  } catch (error) {
    server._reportUnhandledError(`onRequest:${request.method} ${url.pathname}`, error);
    return jsonResponse(request, env, { error: 'Internal error' }, 500);
  }
}
