import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import rune from 'rune-sdk/vite';

const execFileAsync = promisify(execFile);
const DEV_JSON_MAX_BYTES = 2 * 1024 * 1024;
const DEV_GLB_MAX_BYTES = 32 * 1024 * 1024;
const LOCAL_REMOTE_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function isLocalDevRequest(req) {
  const remoteAddress = req.socket?.remoteAddress ?? '';
  return LOCAL_REMOTE_ADDRESSES.has(remoteAddress);
}

function hasDevWriteAccess(req) {
  if (!isLocalDevRequest(req)) return false;
  const expected = process.env.VITE_DEV_SERVER_TOKEN ?? process.env.DEV_SERVER_TOKEN ?? '';
  if (!expected) return true;
  return req.headers['x-dev-server-token'] === expected;
}

async function readRequestBuffer(req, maxBytes) {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Payload too large');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error('Payload too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function isGlbBuffer(buffer) {
  return buffer.length >= 12 && buffer.toString('utf8', 0, 4) === 'glTF';
}

function devLevelSavePlugin() {
  const layoutPath = path.resolve(process.cwd(), 'public/levels/kitchen-layout.json');
  const prefabPath = path.resolve(process.cwd(), 'public/levels/prefabs.json');
  const vegetationLibraryPath = path.resolve(process.cwd(), 'public/levels/vegetation-library.json');
  const glbRegistryPath = path.resolve(process.cwd(), 'public/levels/glb-registry.json');
  const customGlbSourceDir = path.resolve(process.cwd(), 'assets/source/custom');
  const customGlbPublicDir = path.resolve(process.cwd(), 'public/models');
  const kitchenLayoutScriptPath = path.resolve(process.cwd(), 'scripts/generate-kitchen-layout-module.mjs');
  const kitchenNavMeshScriptPath = path.resolve(process.cwd(), 'scripts/generate-kitchen-navmesh-module.mjs');
  const bakeHouseGlbScriptPath = path.resolve(process.cwd(), 'scripts/bake-house-glb.mjs');
  const optimizeCustomGlbsScriptPath = path.resolve(process.cwd(), 'scripts/optimize-custom-glbs.mjs');

  return {
    name: 'dev-level-save',
    configureServer(server) {
      const runNodeScript = async (scriptPath) => {
        await execFileAsync(process.execPath, [scriptPath], { cwd: process.cwd() });
      };

      const handleJsonSave = (targetPath, publicPath, afterSave = null) => async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }

        if (!hasDevWriteAccess(req)) {
          sendJson(res, 403, { ok: false, error: 'Forbidden' });
          return;
        }

        try {
          const body = await readRequestBuffer(req, DEV_JSON_MAX_BYTES);
          const payload = JSON.parse(body.length ? body.toString('utf8') : '{}');
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
          if (afterSave) {
            await afterSave();
          }

          sendJson(res, 200, {
            ok: true,
            path: publicPath,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, message === 'Payload too large' ? 413 : 500, {
            ok: false,
            error: message,
          });
        }
      };

      server.middlewares.use(
        '/__dev/save-level',
        handleJsonSave(layoutPath, '/levels/kitchen-layout.json', async () => {
          await runNodeScript(bakeHouseGlbScriptPath);
          await runNodeScript(optimizeCustomGlbsScriptPath);
          await runNodeScript(kitchenLayoutScriptPath);
          await runNodeScript(kitchenNavMeshScriptPath);
        }),
      );
      server.middlewares.use(
        '/__dev/save-prefabs',
        handleJsonSave(prefabPath, '/levels/prefabs.json'),
      );
      server.middlewares.use(
        '/__dev/save-vegetation-library',
        handleJsonSave(vegetationLibraryPath, '/levels/vegetation-library.json'),
      );

      server.middlewares.use('/__dev/upload-glb', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }

        if (!hasDevWriteAccess(req)) {
          sendJson(res, 403, { ok: false, error: 'Forbidden' });
          return;
        }

        const parsedUrl = new URL(req.url, 'http://localhost');
        const filename = decodeURIComponent(parsedUrl.searchParams.get('name') || 'untitled.glb');
        if (!filename.toLowerCase().endsWith('.glb')) {
          sendJson(res, 400, { ok: false, error: 'Only .glb files allowed' });
          return;
        }

        let buffer;
        try {
          buffer = await readRequestBuffer(req, DEV_GLB_MAX_BYTES);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, message === 'Payload too large' ? 413 : 500, {
            ok: false,
            error: message,
          });
          return;
        }
        if (!isGlbBuffer(buffer)) {
          sendJson(res, 400, { ok: false, error: 'Invalid GLB file' });
          return;
        }

        await fs.mkdir(customGlbSourceDir, { recursive: true });
        await fs.mkdir(customGlbPublicDir, { recursive: true });

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        await fs.writeFile(path.join(customGlbSourceDir, safeName), buffer);
        await fs.writeFile(path.join(customGlbPublicDir, safeName), buffer);

        let registry = { assets: [] };
        try {
          const data = await fs.readFile(glbRegistryPath, 'utf8');
          registry = JSON.parse(data);
        } catch {}

        const existingIndex = registry.assets.findIndex((a) => a.filename === safeName);
        const assetId = existingIndex >= 0
          ? registry.assets[existingIndex].id
          : `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const entry = {
          id: assetId,
          name: safeName.replace(/\.glb$/i, ''),
          filename: safeName,
          sourcePath: `assets/source/custom/${safeName}`,
          publicPath: `models/${safeName}`,
          size: buffer.length,
          uploadedAt: new Date().toISOString(),
        };

        if (existingIndex >= 0) {
          registry.assets[existingIndex] = entry;
        } else {
          registry.assets.push(entry);
        }

        await fs.mkdir(path.dirname(glbRegistryPath), { recursive: true });
        await fs.writeFile(glbRegistryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

        sendJson(res, 200, { ok: true, entry });
      });

      server.middlewares.use(
        '/__dev/save-glb-registry',
        handleJsonSave(glbRegistryPath, '/levels/glb-registry.json'),
      );
    },
  };
}

function stripExternalWidgetForRune(enabled) {
  return {
    name: 'prepare-html-for-rune',
    transformIndexHtml(html) {
      if (!enabled) {
        return html.replace(
          /\n\s*<script type="module" src="\/rune\/logic\/logic\.js" data-rune-logic><\/script>/,
          '',
        );
      }
      return html.replace(
        /\n\s*<script async src="https:\/\/vibejam\.cc\/2026\/widget\.js"><\/script>/,
        '',
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isRuneBuild = mode === 'rune' || process.env.VITE_RUNE_BACKEND === 'true';
  return {
    plugins: [
      solid(),
      devLevelSavePlugin(),
      stripExternalWidgetForRune(isRuneBuild),
      ...(isRuneBuild
        ? [rune({
          logicPath: path.resolve(process.cwd(), 'rune/logic/logic.js'),
          minifyLogic: false,
          ignoredDependencies: [],
        })]
        : []),
    ],
    base: './',
    root: '.',
    publicDir: 'public',
    resolve: {
      alias: {
        '@chenglou/pretext': path.resolve(process.cwd(), 'node_modules/@chenglou/pretext/src/layout.ts'),
      },
    },
    optimizeDeps: {
      include: ['@chenglou/pretext'],
    },
    build: {
      outDir: isRuneBuild ? 'dist-rune' : 'dist',
      target: 'esnext',
      modulePreload: { polyfill: false },
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
    // Strip console.* + debugger statements at build time (production only; dev
    // server is untouched). Reduces bundle size and prevents leaking log strings
    // into the minified output. See also the runtime shim in src/main.js which
    // covers any dynamic `console[key]()` calls the static pass can't remove.
    esbuild: {
      drop: ['console', 'debugger'],
    },
    server: {
      host: '127.0.0.1',
      open: !isRuneBuild,
    },
  };
});
