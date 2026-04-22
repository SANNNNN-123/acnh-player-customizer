import { defineConfig } from 'vite';

const ACNH_EXPORT_ROOT = 'C:/Users/ZUHAIR/Desktop/2026/animalcrossing/ACNH_2.0.0_Exported_Model_DAE+PNG';

export default defineConfig({
  server: {
    fs: {
      allow: [process.cwd(), ACNH_EXPORT_ROOT],
    },
    watch: {
      ignored: ['**/public/models/**'],
    },
  },
});
