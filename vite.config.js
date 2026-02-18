import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.fbx'],
  server: {
    open: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
