#!/usr/bin/env node
/**
 * Synthetic WebSocket clients against PartyKit + optional server metrics export.
 *
 * Prereqs:
 *   1. PartyKit dev running: `npm run dev:party`
 *   2. In `.env` (loaded via npm script): `BENCH_METRICS_TOKEN=<secret>`
 *
 * Usage:
 *   npm run bench:net                                                    # local dev (127.0.0.1:1999)
 *   node scripts/bench-network.mjs --host=party.example.com --clients=4  # remote (auto TLS/wss)
 *   node scripts/bench-network.mjs --host=http://10.0.0.5:1999           # explicit plaintext
 *
 * NOTE: Benching prod is disabled by default. The prod party rejects WS upgrades
 * with empty Origin headers (scripts don't send one) and requires a Turnstile
 * token that node can't generate. To bench prod you must temporarily set
 * ALLOW_EMPTY_ORIGIN=true AND leave TURNSTILE_SECRET unset in the deployed
 * PartyKit env — do this in a separate staging party, not your live one.
 *
 * Writes ./bench-results.json (gitignored) for `npm run bench:compare`.
 */

const MAX_BENCH_CLIENTS = 16;

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import WebSocket from 'ws';

/** Load `.env` into process.env if present (does not override existing vars). */
function loadDotEnv() {
  const envFile = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) return;
  const text = fs.readFileSync(envFile, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv();

function parseArgs(argv) {
  const out = {
    host: process.env.BENCH_HOST ?? '127.0.0.1:1999',
    room: process.env.BENCH_ROOM ?? 'bench-net',
    clients: Number(process.env.BENCH_CLIENTS ?? 4),
    durationSec: Number(process.env.BENCH_DURATION_SEC ?? 12),
    warmupSec: Number(process.env.BENCH_WARMUP_SEC ?? 2),
    inputHz: Number(process.env.BENCH_INPUT_HZ ?? 30),
  };
  for (const a of argv) {
    if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
    else if (a.startsWith('--room=')) out.room = a.slice('--room='.length);
    else if (a.startsWith('--clients=')) out.clients = Math.max(1, Math.min(MAX_BENCH_CLIENTS, Number(a.slice('--clients='.length)) || 1));
    else if (a.startsWith('--duration=')) out.durationSec = Math.max(1, Number(a.slice('--duration='.length)) || 12);
    else if (a.startsWith('--warmup=')) out.warmupSec = Math.max(0, Number(a.slice('--warmup='.length)) || 0);
    else if (a.startsWith('--input-hz=')) out.inputHz = Math.max(5, Math.min(60, Number(a.slice('--input-hz='.length)) || 30));
  }
  return out;
}

function utf8Len(str) {
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Decide http(s)/ws(s) based on host. Pass `http://…` / `ws://…` explicitly to
 * force plaintext. Anything non-local defaults to TLS so `--host=party.example.com`
 * Just Works against a deployed PartyKit party.
 */
function resolveSchemes(host) {
  const trimmed = String(host).trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('ws://')) {
    return { http: 'http', ws: 'ws', host: trimmed.replace(/^(https?|wss?):\/\//i, '') };
  }
  if (lower.startsWith('https://') || lower.startsWith('wss://')) {
    return { http: 'https', ws: 'wss', host: trimmed.replace(/^(https?|wss?):\/\//i, '') };
  }
  const hostname = trimmed.split(':')[0] ?? '';
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return { http: isLocal ? 'http' : 'https', ws: isLocal ? 'ws' : 'wss', host: trimmed };
}

function benchHttpBase(host, room) {
  const { http, host: h } = resolveSchemes(host);
  return `${http}://${h}/parties/main/${encodeURIComponent(room)}`;
}

function benchWsUrl(host, room) {
  const { ws, host: h } = resolveSchemes(host);
  return `${ws}://${h}/parties/main/${encodeURIComponent(room)}`;
}

async function httpJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}`);
    err.data = data;
    throw err;
  }
  return data;
}

function makePlayerKey() {
  return crypto.randomBytes(32).toString('hex');
}

function runClient({ wsUrl, playerKey, label, inputIntervalMs, warmupMs, runMs, stats }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    let inputTimer = null;
    const tOpen = Date.now();

    const sendJson = (obj) => {
      const raw = JSON.stringify(obj);
      stats.clientBytesOut += utf8Len(raw);
      stats.clientMsgsOut += 1;
      ws.send(raw);
    };

    ws.on('message', (data) => {
      const s = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      stats.clientBytesIn += utf8Len(s);
      stats.clientMsgsIn += 1;
    });

    ws.on('open', () => {
      sendJson({
        type: 'hello',
        playerKey,
        displayName: label,
      });

      const startInputs = () => {
        inputTimer = setInterval(() => {
          seq += 1;
          sendJson({
            type: 'input',
            moveX: Math.sin(seq * 0.11) * 0.85,
            moveZ: Math.cos(seq * 0.07) * 0.85,
            sprint: (seq % 50) < 6,
            jump: false,
            jumpPressed: false,
            jumpHeld: false,
            crouch: false,
            rotation: seq * 0.015,
            interactHeld: false,
            seq,
          });
        }, inputIntervalMs);
      };

      setTimeout(startInputs, warmupMs);
      setTimeout(() => {
        if (inputTimer) clearInterval(inputTimer);
        inputTimer = null;
        ws.close();
      }, warmupMs + runMs);
    });

    ws.on('close', () => {
      resolve({ label, ms: Date.now() - tOpen });
    });

    ws.on('error', (e) => reject(e));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.BENCH_METRICS_TOKEN?.trim() ?? '';
  const base = benchHttpBase(args.host, args.room);
  const wsUrl = benchWsUrl(args.host, args.room);
  console.log(`[bench] host=${args.host} ws=${wsUrl}`);

  const stats = {
    clientBytesIn: 0,
    clientBytesOut: 0,
    clientMsgsIn: 0,
    clientMsgsOut: 0,
  };

  const inputIntervalMs = Math.max(8, Math.round(1000 / args.inputHz));
  const warmupMs = args.warmupSec * 1000;
  const runMs = args.durationSec * 1000;

  if (token) {
    try {
      await httpJson(`${base}/bench-metrics/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('[bench] reset failed (is PartyKit up and BENCH_METRICS_TOKEN set?)', e.message);
    }
  } else {
    console.warn('[bench] BENCH_METRICS_TOKEN unset — server metrics will be skipped.');
  }

  const t0 = Date.now();
  const tasks = [];
  for (let i = 0; i < args.clients; i += 1) {
    tasks.push(runClient({
      wsUrl,
      playerKey: makePlayerKey(),
      label: `Bench-${i}`,
      inputIntervalMs,
      warmupMs,
      runMs,
      stats,
    }));
  }

  await Promise.all(tasks);
  const elapsedSec = (Date.now() - t0) / 1000;

  let server = null;
  if (token) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      server = await httpJson(`${base}/bench-metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('[bench] fetch bench-metrics failed:', e.message);
    }
  }

  const out = {
    meta: {
      host: args.host,
      room: args.room,
      clients: args.clients,
      durationSec: args.durationSec,
      warmupSec: args.warmupSec,
      inputHz: args.inputHz,
      wallClockSec: Math.round(elapsedSec * 1000) / 1000,
      collectedAt: new Date().toISOString(),
    },
    server,
    clients: {
      bytesIn: stats.clientBytesIn,
      bytesOut: stats.clientBytesOut,
      msgsIn: stats.clientMsgsIn,
      msgsOut: stats.clientMsgsOut,
      bytesInPerSec: Math.round(stats.clientBytesIn / elapsedSec),
      bytesOutPerSec: Math.round(stats.clientBytesOut / elapsedSec),
    },
  };

  fs.writeFileSync('bench-results.json', `${JSON.stringify(out, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
