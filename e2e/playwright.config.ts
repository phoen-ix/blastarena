import { defineConfig, devices } from '@playwright/test';

/* The e2e suite: every spec under e2e/ except the docs tour. Run it through scripts/e2e.sh, which
 * starts the stack (with a Mailpit sink) and sets E2E_BASE_URL, E2E_MAILPIT_URL and the compose
 * project the specs reach into for SQL and rate-limit resets. Coverage map: COVERAGE.md. */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: ['docs/**', 'node_modules/**'],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:24200',
    viewport: { width: 1280, height: 800 },
    locale: 'en-GB',
    timezoneId: 'Europe/Vienna',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
