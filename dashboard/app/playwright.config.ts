import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  globalTeardown: './tests/global-teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:8787',

    // --- Screenshots ---
    screenshot: {
      mode: 'on',             // capture after every test (pass or fail)
      fullPage: false,         // viewport only — fullPage causes blank captures on SPAs
    },

    // --- Video recording ---
    video: {
      mode: 'on',             // record every test (webm → converted to mp4 by globalTeardown)
      size: { width: 1280, height: 720 },
    },

    // --- Trace (timeline, network, DOM snapshots) ---
    trace: 'on',               // full trace for every test — viewable at trace.playwright.dev

    // --- Viewport ---
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
