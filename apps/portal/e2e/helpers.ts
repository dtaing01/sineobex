import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Request } from '@playwright/test';

// Shared by every portal spec. The servers playwright.config.ts starts, and the seeded demo team
// (db/seed/seed.ts: made-up staff, all with the same password and authenticator code).
export const API = 'http://localhost:8787';
export const IDP = 'http://localhost:8790';
export const TEAM = '0d3e6f00-0000-4000-8000-000000000001';
export const PASSWORD = 'sineobex-demo';
export const MFA_CODE = '000000';
export const THEMES = ['day', 'night', 'contrast'] as const;
// WCAG 2.2 AA is the target; 2.1 AA is the legal floor (module 15).
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * axe in all three themes. By default each theme is a fresh server render (cookie + reload);
 * `inPlace` swaps the theme attribute without reloading, to check a screen mid-interaction
 * (an error summary, a filled form) that a reload would reset.
 */
export async function expectAccessible(page: Page, label: string, options: { inPlace?: boolean } = {}) {
  for (const theme of THEMES) {
    if (options.inPlace) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    } else {
      await page
        .context()
        .addCookies([{ name: 'sx-theme', value: theme, domain: new URL(page.url()).hostname, path: '/' }]);
      await page.reload();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Buttons fade to the new theme's colours over 120 ms (.sx-btn transitions). axe must measure
    // where they land, not a frame mid-fade, or contrast fails at random on a fast runner.
    await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition)));
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map(
        (v) => `${label} [${theme}] ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  }
}

export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

export async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/sign-in\/mfa$/);
  await page.getByLabel('6-digit code').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(home|owner|select-team)$/);
}

/** The portal's main navigation. */
export function portalNav(page: Page) {
  return page.getByRole('navigation', { name: 'Portal' });
}

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, `POST ${url}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** An API token for a seeded staff member, past MFA just now (so recent sign-in checks pass). */
export async function staffToken(email: string): Promise<string> {
  const first = await post(`${IDP}/token`, { grant_type: 'password', email, password: PASSWORD });
  const verified = await post(`${IDP}/mfa/verify`, { access_token: first.access_token, code: MFA_CODE });
  return verified.access_token as string;
}

/** Calls the API as that person, acting for the demo team unless another is given. */
export function apiCall(token: string, method: string, path: string, body?: unknown, team = TEAM) {
  return fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'x-team-id': team, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function adminJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiCall(await staffToken('admin@example.com'), method, path, body);
  expect(res.status, `${method} ${path}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/**
 * A custom role in the demo team made from existing permissions, as the Roles page makes it.
 * Found by name when it already exists, so a rerun against the same database works.
 */
export async function customRole(name: string, permissions: string[]): Promise<string> {
  const roles = await adminJson<{ id: string; name: string }[]>('GET', '/v1/team/roles');
  const existing = roles.find((r) => r.name === name);
  if (existing) return existing.id;
  return (await adminJson<{ id: string }>('POST', '/v1/team/roles', { name, permissions })).id;
}

/**
 * Moves a seeded staff member to another role (a standard role's key, such as 'billing_data', or
 * a role's ID), as the members page does. Put them back when the test is done: specs share the
 * database.
 */
export async function setRole(email: string, role: string): Promise<void> {
  const members = await adminJson<{ membershipId: string; email: string }[]>('GET', '/v1/team/members');
  const roles = await adminJson<{ id: string; key: string }[]>('GET', '/v1/team/roles');
  const roleId = roles.find((r) => r.key === role || r.id === role)?.id;
  expect(roleId, `role ${role}`).toBeDefined();
  await adminJson('PUT', `/v1/team/members/${members.find((m) => m.email === email)!.membershipId}/role`, {
    roleId,
    reason: 'Covering another desk for a day',
  });
}

/** A phone registered for a seeded staff member. `push` sends one sync batch and its unsynced counts. */
export async function registerPhone(email: string) {
  const token = await staffToken(email);
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');
  const deviceId = crypto.randomUUID();
  const registered = await apiCall(token, 'POST', '/v1/devices', {
    deviceId,
    platform: 'android',
    appVersion: '0.3.0',
    publicKey,
  });
  expect(registered.status).toBe(201);
  const push = async (changes: unknown[] = [], counts: Record<string, number> = {}) => {
    const pushed = await apiCall(token, 'POST', '/v1/sync/push', {
      deviceId,
      clock: { deviceTime: new Date().toISOString() },
      unsynced: { counts },
      changes,
    });
    expect(pushed.status).toBe(200);
    return (await pushed.json()) as Record<string, unknown>;
  };
  return { token, deviceId, push };
}

/**
 * Records what the page sends and every address it shows, for checks that something (a name typed
 * into a search, an ID card's token) never reaches a server, a URL or the history.
 */
export function watchTraffic(page: Page) {
  const requests: Request[] = [];
  const addresses: string[] = [];
  page.on('request', (r) => requests.push(r));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) addresses.push(frame.url());
  });
  return {
    /** Every URL the address bar showed, in order (same-page fragment changes included). */
    addresses,
    /** Each request whose URL, headers or body held `secret` (plain or URL-encoded), as "METHOD url". */
    async carrying(secret: string): Promise<string[]> {
      const forms = [secret, encodeURIComponent(secret)];
      const found: string[] = [];
      for (const r of requests) {
        const headers = await r.allHeaders().catch(() => r.headers());
        const sent = [r.url(), ...Object.values(headers), r.postData() ?? ''];
        if (sent.some((s) => forms.some((f) => s.includes(f)))) found.push(`${r.method()} ${r.url()}`);
      }
      return found;
    },
  };
}

/** Nothing in localStorage or sessionStorage (design 12.2: the portal keeps nothing in the browser). */
export async function expectNothingStored(page: Page, label: string) {
  const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
  expect(keys, `${label} wrote to browser storage`).toEqual([]);
}

/** WCAG 1.4.10: at 320 CSS pixels wide nothing scrolls sideways. The viewport is put back after. */
export async function expectReflow(page: Page, label: string, width = 320) {
  const before = page.viewportSize();
  await page.setViewportSize({ width, height: before?.height ?? 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} scrolls sideways at ${width} px`).toBeLessThanOrEqual(0);
  if (before) await page.setViewportSize(before);
}
