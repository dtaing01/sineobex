import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORTAL_TEST_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    // Local sandboxes ship their own Chromium; CI installs Playwright's.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://localhost:${port}/sign-in`,
    reuseExistingServer: !process.env.CI,
    env: { PORTAL_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' },
    timeout: 60_000,
  },
});
