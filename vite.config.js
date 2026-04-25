import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const SUFFIX = '.Nin_NX_NVN';

function requireAcnhModelRoot(env) {
  const raw = env.VITE_ACNH_MODEL_ROOT?.trim();
  if (!raw) {
    throw new Error(
      'Missing VITE_ACNH_MODEL_ROOT. Copy .env.example to .env in acnh-player-customizer/ and set the path to the ACNH "Model" folder.',
    );
  }
  return path.resolve(raw).replace(/\\/g, '/');
}

function clothingApiPlugin(modelRoot) {
  let folderCache = null;
  let cacheTime = 0;

  async function getAllFolders() {
    if (folderCache && Date.now() - cacheTime < 30000) return folderCache;
    const dirents = await fs.readdir(modelRoot, { withFileTypes: true });
    folderCache = dirents
      .filter((d) => d.isDirectory() && d.name.endsWith(SUFFIX))
      .map((d) => d.name.slice(0, -SUFFIX.length));
    cacheTime = Date.now();
    return folderCache;
  }

  return {
    name: 'clothing-api',
    configureServer(server) {
      server.middlewares.use('/api/scan-folders', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const prefix = url.searchParams.get('prefix') || '';
        try {
          const all = await getAllFolders();
          const matched = prefix ? all.filter((n) => n.startsWith(prefix)) : all;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(matched));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err.message) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ACNH_MODEL_ROOT = requireAcnhModelRoot(env);
  const ACNH_EXPORT_ROOT = path.resolve(ACNH_MODEL_ROOT, '..');

  return {
    define: {
      'import.meta.env.VITE_ACNH_MODEL_ROOT': JSON.stringify(ACNH_MODEL_ROOT),
    },
    server: {
      fs: {
        allow: [process.cwd(), ACNH_EXPORT_ROOT],
      },
      watch: {
        ignored: ['**/public/models/**'],
      },
    },
    plugins: [clothingApiPlugin(ACNH_MODEL_ROOT)],
  };
});
