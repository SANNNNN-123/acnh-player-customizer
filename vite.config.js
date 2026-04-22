import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';

const ACNH_EXPORT_ROOT = 'C:/Users/ZUHAIR/Desktop/2026/animalcrossing/ACNH_2.0.0_Exported_Model_DAE+PNG';
const ACNH_MODEL_ROOT = path.join(ACNH_EXPORT_ROOT, 'Model');
const SUFFIX = '.Nin_NX_NVN';

function clothingApiPlugin() {
  let folderCache = null;
  let cacheTime = 0;

  async function getAllFolders() {
    if (folderCache && Date.now() - cacheTime < 30000) return folderCache;
    const dirents = await fs.readdir(ACNH_MODEL_ROOT, { withFileTypes: true });
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

export default defineConfig({
  server: {
    fs: {
      allow: [process.cwd(), ACNH_EXPORT_ROOT],
    },
    watch: {
      ignored: ['**/public/models/**'],
    },
  },
  plugins: [clothingApiPlugin()],
});
