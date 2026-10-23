import { defineConfig, devices } from '@playwright/test';

/* The docs tour (./docs): README and gallery screenshots of a seeded demo, and a render check of
 * every screen it visits. Run it through scripts/docs-screenshots.sh, which starts the stack and
 * sets E2E_BASE_URL, DOCS_SCREENSHOT_DIR and the compose project the seed reaches into. */
export default defineConfig({
  testDir: './docs',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // A retried render check would hide a flaky screen.
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:24200',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    launchOptions: {
      args: ['--lang=en-GB'],
      env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB:en', LC_ALL: 'en_GB.UTF-8' },
    },
    timezoneId: 'Europe/Vienna',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
});
