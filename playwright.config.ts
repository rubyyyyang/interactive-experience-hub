import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Arcade Finder (Google Apps Script web app)
 *
 * Authentication:
 * - First run: authenticate manually and save state to playwright/.auth/
 * - Subsequent runs: reuse saved auth state
 *
 * Shared State:
 * - Uses 1 worker because tests interact with shared Google Sheets backend
 * - Tests are read-only to avoid polluting production data
 */

export default defineConfig({
  testDir: './tests',

  /* Single worker due to shared Apps Script backend state */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',

  /* Shared settings for all the projects below. */
  use: {
    /* Base URL for the deployed Apps Script web app - using /dev for testing */
    baseURL: 'https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/dev',

    /* Collect trace and screenshots on failure */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    /* Reasonable timeouts for Apps Script server-side execution */
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers */
  projects: [
    // Setup project: run manually ONCE to create playwright/.auth/user.json
    // Usage: npx playwright test tests/auth.setup.ts --headed --project=setup
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Main test project: Chromium with saved auth state
    // Runs 2 approved tests: smoke + search
    {
      name: 'chromium',
      testMatch: /finder\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
    },
  ],
});
