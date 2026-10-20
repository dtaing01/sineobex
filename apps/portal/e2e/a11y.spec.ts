import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Every public page, in every theme. Pages behind sign-in join this list as they are built.
const PAGES = ['/', '/sign-in', '/no-such-page'];
const THEMES = ['day', 'night', 'contrast'] as const;
// WCAG 2.2 AA is the target; 2.1 AA is the legal floor (module 15).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

for (const path of PAGES) {
  for (const theme of THEMES) {
    test(`${path} has no axe violations in ${theme}`, async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: 'sx-theme', value: theme, url: baseURL! }]);
      const cspViolations: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text()))
          cspViolations.push(msg.text());
      });
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
      expect(cspViolations).toEqual([]);
    });
  }
}

test('pages follow the system dark and high-contrast settings when no theme is chosen', async ({
  browser,
  baseURL,
}) => {
  for (const options of [{ colorScheme: 'dark' as const }, { contrast: 'more' as const }]) {
    const context = await browser.newContext({ ...options, baseURL: baseURL! });
    const page = await context.newPage();
    await page.goto('/');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations).toEqual([]);
    await context.close();
  }
});

test('every page shows the Demo data only banner in a demo deployment', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('region', { name: 'Demo environment' })).toContainText('Demo data only');
  }
});

test('the first Tab press reaches the skip link, and it moves focus to the content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('responses carry no-store, a nonce-based CSP and no framing', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['cache-control']).toBe('no-store');
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-powered-by']).toBeUndefined();
});

test('page titles never carry more than the screen name', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page).toHaveTitle('Sign in · Sineobex');
});
