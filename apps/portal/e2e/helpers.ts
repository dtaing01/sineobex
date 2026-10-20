import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

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
