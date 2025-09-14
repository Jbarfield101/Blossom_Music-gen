import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite aliases to smooth over Tauri v1 -> v2 API changes
// and avoid resolution errors from legacy imports.
export default defineConfig({
  plugins: [react()],
  root: '.',
  resolve: {
    alias: {
      // Core invoke API moved from 'api/tauri' (v1) to 'api/core' (v2)
      '@tauri-apps/api/tauri': '@tauri-apps/api/core',
      // Common v1 modules now provided by dedicated plugins in v2
      '@tauri-apps/api/dialog': '@tauri-apps/plugin-dialog',
      '@tauri-apps/api/shell': '@tauri-apps/plugin-shell',
      '@tauri-apps/api/store': '@tauri-apps/plugin-store',
    },
  },
  optimizeDeps: {
    // Prevent esbuild pre-bundling glitches with tauri packages
    exclude: [
      '@tauri-apps/api',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-shell',
      '@tauri-apps/plugin-store',
      '@tauri-apps/plugin-opener',
    ],
  },
  build: {
    outDir: 'dist',
  },
});
