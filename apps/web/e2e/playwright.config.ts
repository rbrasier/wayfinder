import { defineConfig, devices } from '@playwright/test';

/**
 * Wayfinder E2E Test Configuration
 *
 * Lives at: apps/web/e2e/playwright.config.ts (inside the wayfinder repo)
 *
 * AI MOCK MODE (default — used on every push):
 *   AI calls to Anthropic/OpenAI/Mistral are intercepted and return
 *   fixture responses instantly. No API key needed. No cost.
 *
 * REAL AI MODE (on-demand, triggered manually in GitHub Actions):
 *   Set env var USE_REAL_AI=true and provide ANTHROPIC_API_KEY.
 *   AI calls go through to the real provider. Used for integration smoke tests.
 *
 * Run locally:
 *   npx playwright test --config apps/web/e2e/playwright.config.ts
 *
 * View report:
 *   npx playwright show-report apps/web/e2e/playwright-report
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,      // auth state is shared — keep sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,

  reporter: [
    // Full HTML report with inline screenshots and console logs
    ['html', {
      outputFolder: 'playwright-report',
      open: 'never',
    }],
    // Machine-readable results — parsed by CI to write the job summary
    ['json', { outputFile: 'playwright-results.json' }],
    // Console summary during the run
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,

    // Screenshot every test — pass or fail — so you can always see what happened
    screenshot: 'on',

    // Video only on failure (keeps artifact size manageable)
    video: 'retain-on-failure',

    // Trace (DOM snapshots + network) only on failure
    trace: 'retain-on-failure',

    // Capture console logs — surfaced in HTML report
    // (handled per-test in the base fixture — see helpers/base.ts)

    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // 1. Auth setup — runs first, saves session cookie
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // 2. Seed deterministic fixtures, then tear them down once everything that
    //    depends on the seed has finished.
    {
      name: 'seed',
      testMatch: /seed\.setup\.ts/,
      dependencies: ['setup'],
      teardown: 'cleanup',
    },
    {
      name: 'cleanup',
      testMatch: /cleanup\.teardown\.ts/,
    },

    // 3. Main test suite — Chromium with saved auth
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['setup', 'seed'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  outputDir: 'test-results',
});
