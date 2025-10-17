import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite aliases to smooth over Tauri v1 -> v2 API changes
// and avoid resolution errors from legacy imports.
export default defineConfig({
  plugins: [react()],
  root: '.',
  // Ensure the dev server matches Tauri's devUrl (http://localhost:5173)
  // so the Tauri window can load the UI during `tauri dev`.
  server: {
    host: '127.0.0.1',
    port: 5225,
    strictPort: true,
    // Avoid watch loops triggered by repo-level changes (e.g., Rust target, venv)
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/target/**',
        '**/.venv/**',
      ],
    },
    // Restrict file-system access to the UI folder
    fs: {
      strict: true,
      allow: ['.'],
    },
  },
  resolve: {
    alias: {
      // Core invoke API moved from 'api/tauri' (v1) to 'api/core' (v2)
      '@tauri-apps/api/tauri': '@tauri-apps/api/core',
      // Common v1 modules now provided by dedicated plugins in v2
      '@tauri-apps/api/dialog': '@tauri-apps/plugin-dialog',
      '@tauri-apps/api/shell': '@tauri-apps/plugin-shell',
      '@tauri-apps/api/store': '@tauri-apps/plugin-store',
      'gray-matter': '/src/lib/vendor/gray-matter.js',
    },
    // Ensure a single React instance (fixes invalid hook call with linked deps)
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Prevent esbuild pre-bundling glitches with tauri packages
    exclude: [
      '@tauri-apps/api',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-shell',
      '@tauri-apps/plugin-store',
      '@tauri-apps/plugin-opener',
    ],
  },
  build: {
    outDir: 'dist',
  },
});
