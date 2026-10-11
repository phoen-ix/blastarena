import { defineConfig } from 'vite';
import path from 'path';

const appUrl = process.env.APP_URL;
const allowedHosts: string[] = [];
if (appUrl) {
  try {
    allowedHosts.push(new URL(appUrl).hostname);
  } catch {
    // ignore invalid URL
  }
}

export default defineConfig({
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: Vite 8 warns that its native config loader cannot
      // provide the CommonJS globals.
      '@shared': path.resolve(import.meta.dirname, '../shared/src'),
      '@blast-arena/shared': path.resolve(import.meta.dirname, '../shared/src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://backend:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // No source maps in the production bundle: they published readable TypeScript for the whole
    // client, admin UI included. (audit SOURCEMAP-1)
    sourcemap: false,
    modulePreload: { polyfill: false },
    minify: 'terser',
    // Vite 8 bundles with rolldown: `rollupOptions` is `rolldownOptions`, and `codeSplitting`
    // replaces the object form of `manualChunks` (which rolldown rejects). Phaser stays in its
    // own long-cached chunk.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'phaser', test: /node_modules[\\/]phaser[\\/]/ }],
        },
      },
    },
  },
});
