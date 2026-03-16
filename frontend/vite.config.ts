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
      '@shared': path.resolve(__dirname, '../shared/src'),
      '@blast-arena/shared': path.resolve(__dirname, '../shared/src'),
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
    sourcemap: true,
  },
});
