import { defineConfig, devices } from '@playwright/test';

// Full stack for end-to-end tests: the local dev identity provider, the real API on Node, and the
// portal. The database must be prepared first (tools/e2e-db.sh).
const PORTAL_PORT = Number(process.env.PORTAL_TEST_PORT ?? 3100);
const API_PORT = 8787;
const IDP_PORT = 8790;
const DATABASE_URL =
  process.env.E2E_API_DATABASE_URL ??
  'postgres://sineobex_api_e2e:e2e-local-only@localhost:5432/sineobex_e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORTAL_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'narrow',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      grep: /@responsive/,
    },
  ],
  webServer: [
    {
      command: 'node ../../tools/dev-idp.mjs',
      url: `http://localhost:${IDP_PORT}/.well-known/jwks.json`,
      reuseExistingServer: !process.env.CI,
      env: { DEV_IDP_PORT: String(IDP_PORT) },
    },
    {
      command: 'pnpm --filter @sineobex/api exec tsx src/entry/node.ts',
      url: `http://localhost:${API_PORT}/v1/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        APP_ENV: 'test',
        DATABASE_URL,
        OIDC_ISSUER: `http://localhost:${IDP_PORT}`,
        OIDC_AUDIENCE: 'sineobex-local',
        OIDC_JWKS_URL: `http://localhost:${IDP_PORT}/.well-known/jwks.json`,
        MFA_MODE: 'aal',
        IDENTITY_ADMIN: 'memory',
        PORT: String(API_PORT),
      },
    },
    {
      command: `pnpm start --port ${PORTAL_PORT}`,
      url: `http://localhost:${PORTAL_PORT}/sign-in`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORTAL_ENV: 'test',
        AUTH_PROVIDER: 'dev',
        DEV_IDP_URL: `http://localhost:${IDP_PORT}`,
        API_URL: `http://localhost:${API_PORT}`,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      timeout: 60_000,
    },
  ],
});
