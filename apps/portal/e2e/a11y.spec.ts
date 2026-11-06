import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  customRole,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  PASSWORD,
  portalNav,
  registerPhone,
  setRole,
  signIn,
  TAGS,
  watchCsp,
  watchTraffic,
} from './helpers';

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
  for (const path of [
    '/',
    '/home',
    '/team/members',
    '/audit',
    '/owner',
    '/patients',
    '/team/duplicates',
    '/team/reviews',
    '/team/merges',
    '/team/problem-reversals',
  ]) {
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

/** A made-up ID card token: 16 random bytes, base64url (phase 3 design 10.1). */
function cardToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
}

test('@responsive an ID card link shows only a sign-in prompt, and its token never leaves the browser', async ({
  page,
}) => {
  const token = cardToken();
  const traffic = watchTraffic(page);
  const csp = watchCsp(page);
  const response = await page.goto(`/c#${token}`);
  const h = response!.headers();
  expect(h['cache-control']).toBe('no-store');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page).toHaveTitle('Sineobex');

  // One heading and one button; no team name (a team's name can itself disclose care).
  const main = page.getByRole('main');
  await expect(page.getByRole('heading')).toHaveText(['This is a Street Medicine ID card']);
  await expect(main).toContainText('Staff: sign in to open the chart.');
  await expect(main.getByRole('link')).toHaveText(['Sign in']);
  await expect(page.locator('body')).not.toContainText('Demo Street Team');
  await expectAccessible(page, '/c');
  await expectReflow(page, '/c');
  await expectNothingStored(page, '/c');

  await main.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await traffic.carrying(token)).toEqual([]);
  expect(csp).toEqual([]);
});

test('signed in, an ID card link shows the same page, and its button goes to the team', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  const token = cardToken();
  const traffic = watchTraffic(page);
  await page.goto(`/c#${token}`);
  await expect(page).toHaveTitle('Sineobex');
  await expect(page.getByRole('heading')).toHaveText(['This is a Street Medicine ID card']);
  await expect(page.locator('body')).not.toContainText('Demo Street Team');
  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(await traffic.carrying(token)).toEqual([]);
});

// Phase 3 design 12.2: each patient screen in the navigation by the permission its API checks.
const PATIENT_SCREENS: Record<string, string> = {
  Patients: '/patients',
  Reviews: '/team/reviews',
  Duplicates: '/team/duplicates',
  Merges: '/team/merges',
  'Problem reversals': '/team/problem-reversals',
};

async function patientScreens(page: Page): Promise<string[]> {
  const names = await portalNav(page).getByRole('link').allTextContents();
  return names.filter((n) => n in PATIENT_SCREENS);
}

test('@responsive a Program Admin has every patient screen in the navigation, accessible in all three themes', async ({
  page,
}) => {
  await signIn(page, 'admin@example.com');
  expect(await patientScreens(page)).toEqual(Object.keys(PATIENT_SCREENS));
  for (const [name, href] of Object.entries(PATIENT_SCREENS)) {
    await expect(portalNav(page).getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  await expectAccessible(page, 'navigation');
  await expectReflow(page, 'navigation');
});

for (const [email, role, screens] of [
  ['clinician@example.com', 'Healthcare Staff', ['Patients', 'Reviews']],
  ['chw@example.com', 'the community health worker preset', ['Patients', 'Reviews']],
  ['billing@example.com', 'Billing/Data', ['Patients']],
  ['owner@example.com', 'an owner outside any team', []],
] as const) {
  test(`${role} sees ${screens.length ? `only ${screens.join(' and ')}` : 'no patient screens'}`, async ({
    page,
  }) => {
    await signIn(page, email);
    expect(await patientScreens(page)).toEqual(screens);
  });
}

test('a role that corrects identities but doesn’t review duplicates gets Reviews and Merges', async ({
  page,
}) => {
  // A short name: the API answers 500 when a name's key outgrows roles.key's 41-character check.
  const role = await customRole('Identity corrections only', ['patients.view', 'patients.correct_identity']);
  await setRole('resident@example.com', role);
  try {
    await signIn(page, 'resident@example.com');
    expect(await patientScreens(page)).toEqual(['Patients', 'Reviews', 'Merges']);
  } finally {
    await setRole('resident@example.com', 'healthcare_staff');
  }
});

test('a phone holding patient and problem work says so in words on the Phones page', async ({ page }) => {
  const phone = await registerPhone('chw@example.com');
  await phone.push([], { patients: 4, problems: 1 });
  try {
    await signIn(page, 'admin@example.com');
    await page.goto('/team/devices');
    const row = page.getByRole('row').filter({ hasText: 'Robin Patel (demo)' }).first();
    await expect(row).toContainText('4 patient details, 1 problem list entry');
    await expectAccessible(page, '/team/devices (patient work)');
  } finally {
    // Other specs count the phones still holding work.
    await phone.push([], {});
  }
});
