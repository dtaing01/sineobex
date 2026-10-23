import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectAccessible, PASSWORD, TAGS, watchCsp } from './helpers';

test('@responsive the sign-in page is accessible in all three themes, with no CSP violations', async ({
  page,
}) => {
  const csp = watchCsp(page);
  await page.goto('/sign-in');
  await expectAccessible(page, '/sign-in');
  expect(csp).toEqual([]);
});

test('@responsive it follows the system dark and high-contrast settings when no theme is chosen', async ({
  browser,
  baseURL,
}) => {
  for (const options of [{ colorScheme: 'dark' as const }, { contrast: 'more' as const }]) {
    const context = await browser.newContext({ ...options, baseURL: baseURL! });
    const page = await context.newPage();
    await page.goto('/sign-in');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
    await context.close();
  }
});

test('@responsive every screen shows the Demo data only banner in a demo deployment', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('region', { name: 'Demo environment' })).toContainText('Demo data only');
});

test('the first Tab press reaches the skip link, and it moves focus to the content', async ({ page }) => {
  await page.goto('/sign-in');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('responses carry no-store, a nonce-based CSP and no framing', async ({ request }) => {
  const res = await request.get('/sign-in');
  const h = res.headers();
  expect(h['cache-control']).toBe('no-store');
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-powered-by']).toBeUndefined();
});

test('pages behind sign-in redirect to the sign-in page', async ({ page }) => {
  for (const path of ['/', '/home', '/team/members', '/audit', '/owner']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test('a wrong password shows an error summary that takes focus', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill(`${PASSWORD}-wrong`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const alert = page.getByRole('form', { name: 'Sign in' }).getByRole('alert');
  await expect(alert).toContainText('don’t match');
  await expect(alert).toBeFocused();
  // The email is kept; the password is not.
  await expect(page.getByLabel('Email')).toHaveValue('admin@example.com');
  await expectAccessible(page, '/sign-in with error', { inPlace: true });
});

test('page titles never carry more than the screen name', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page).toHaveTitle('Sign in · Sineobex');
});
