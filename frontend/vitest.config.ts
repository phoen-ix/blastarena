import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared/src'),
      '@blast-arena/shared': path.resolve(import.meta.dirname, '../shared/src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Many tests `await import()` a large UI module; the first one in a file pays its cold
    // transform, which took over the 5 s default on a loaded machine (two time-outs at load ~20).
    testTimeout: 20_000,
  },
});
