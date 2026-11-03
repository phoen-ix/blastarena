// .mts because the root package.json is CommonJS (no "type": "module") and this config is ESM.
import { defineConfig } from 'vitest/config';
import path from 'path';

const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@blast-arena/shared': path.resolve(root, 'shared/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/backend/**/*.test.ts', 'tests/shared/**/*.test.ts'],
  },
});
