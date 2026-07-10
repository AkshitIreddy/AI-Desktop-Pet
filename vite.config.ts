import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

// Tauri expects a fixed dev port; fail fast if it's taken.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Single source of truth for the version shown in the UI (package.json is
  // kept in lockstep with tauri.conf.json/Cargo.toml by the release process).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'chrome120',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
      },
    },
  },
});
