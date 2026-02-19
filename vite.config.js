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
  // Rapier ships its own WASM; prevent Vite from re-bundling it
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
