import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const execFileAsync = promisify(execFile);

function devLevelSavePlugin() {
  const layoutPath = path.resolve(process.cwd(), 'public/levels/kitchen-layout.json');
  const prefabPath = path.resolve(process.cwd(), 'public/levels/prefabs.json');
  const vegetationLibraryPath = path.resolve(process.cwd(), 'public/levels/vegetation-library.json');
  const glbRegistryPath = path.resolve(process.cwd(), 'public/levels/glb-registry.json');
  const customGlbSourceDir = path.resolve(process.cwd(), 'assets/source/custom');
  const customGlbPublicDir = path.resolve(process.cwd(), 'public/models');
  const kitchenLayoutScriptPath = path.resolve(process.cwd(), 'scripts/generate-kitchen-layout-module.mjs');
  const kitchenNavMeshScriptPath = path.resolve(process.cwd(), 'scripts/generate-kitchen-navmesh-module.mjs');

  return {
    name: 'dev-level-save',
    configureServer(server) {
      const runNodeScript = async (scriptPath) => {
        await execFileAsync(process.execPath, [scriptPath], { cwd: process.cwd() });
      };

      const handleJsonSave = (targetPath, publicPath, afterSave = null) => async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
            if (afterSave) {
              await afterSave();
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              path: publicPath,
            }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        });
      };

      server.middlewares.use(
        '/__dev/save-level',
        handleJsonSave(layoutPath, '/levels/kitchen-layout.json', async () => {
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
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
          return;
        }

        const parsedUrl = new URL(req.url, 'http://localhost');
        const filename = decodeURIComponent(parsedUrl.searchParams.get('name') || 'untitled.glb');
        if (!filename.toLowerCase().endsWith('.glb')) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Only .glb files allowed' }));
          return;
        }

        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

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

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, entry }));
      });

      server.middlewares.use(
        '/__dev/save-glb-registry',
        handleJsonSave(glbRegistryPath, '/levels/glb-registry.json'),
      );
    },
  };
}

export default defineConfig({
  plugins: [solid(), devLevelSavePlugin()],
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
    target: 'esnext',
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    open: true,
  },
});
