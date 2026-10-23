import { expect, test } from '@playwright/test';
import { expectAccessible, MFA_CODE, PASSWORD, signIn, watchCsp } from './helpers';

const VALID_NPI = '1234567893';

test.describe.configure({ mode: 'serial' });

test('done when: a Program Admin invites a user, upgrades a student to resident with fields and a reason, and both are in the audit log', async ({
  page,
}) => {
  const csp = watchCsp(page);

  // Sign in with password and authenticator code; a wrong code is refused accessibly.
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/sign-in\/mfa$/);
  await expectAccessible(page, '/sign-in/mfa');
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('form', { name: 'Authenticator code' }).getByRole('alert')).toContainText(
    'code didn’t work',
  );
  await page.getByLabel('6-digit code').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // One team: straight to Home.
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Street Team (made-up data)');
  await expectAccessible(page, '/home');

  // Invite a student.
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Team members' }).click();
  await expect(page).toHaveURL(/\/team\/members$/);
  await expectAccessible(page, '/team/members');
  const invite = page.getByRole('form', { name: 'Invite someone' });
  await invite.getByLabel('Name').fill('Taylor Brooks (demo)');
  await invite.getByLabel('Email').fill('student@example.com');
  await invite.getByLabel('Credential').selectOption('student');
  await invite.getByLabel('School').fill('Demo School of Medicine');
  await invite.getByLabel('Supervising physician').fill('Jordan Lee (demo)');
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(invite.getByRole('status')).toContainText('Taylor Brooks (demo) was invited');

  // Upgrade to resident: first without the resident's fields, which changes nothing.
  await page.getByRole('link', { name: 'Taylor Brooks (demo)' }).click();
  await expect(page).toHaveURL(/\/team\/members\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Taylor Brooks (demo)');
  await expectAccessible(page, '/team/members/[id]');
  const cred = page.getByRole('form', { name: 'Change credential' });
  await cred.getByLabel('Credential').selectOption('resident');
  await cred.getByLabel('Reason').fill('Started residency');
  await cred.getByRole('button', { name: 'Save credential' }).click();
  const alert = cred.getByRole('alert');
  await expect(alert).toContainText('Fill in the fields this credential needs');
  await expect(alert.getByRole('link', { name: 'NPI is required for this credential.' })).toBeVisible();
  await expectAccessible(page, '/team/members/[id] with errors', { inPlace: true });

  await cred.getByLabel('NPI').fill(VALID_NPI);
  await cred.getByLabel('Residency program').fill('Demo Internal Medicine');
  await cred.getByLabel('Supervising attending').fill('Jordan Lee (demo)');
  await cred.getByLabel('Reason').fill('Started residency in July');
  await cred.getByRole('button', { name: 'Save credential' }).click();
  await expect(cred.getByRole('status')).toContainText('Credential updated');
  await page.reload();
  const history = page.getByRole('table', { name: /Changes to this person’s access/ });
  await expect(history.getByRole('row').nth(1)).toContainText('Credential changed');
  await expect(history.getByRole('row').nth(1)).toContainText('Started residency in July');

  // Both changes are in the audit log, and the chain is intact.
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expectAccessible(page, '/audit');
  await page.getByLabel('Action').selectOption({ label: 'Staff access changes' });
  await page.getByRole('button', { name: 'Search' }).click();
  const results = page.getByRole('table', { name: /entries, newest first/ });
  await expect(results).toContainText('membership.credential_changed');
  await expect(results).toContainText('membership.invited');
  await page.getByRole('button', { name: 'Check for tampering' }).click();
  await expect(page.getByText(/^Intact: \d+ entries checked\.$/)).toBeVisible();

  expect(csp).toEqual([]);
});

test('roles page lists standard roles and builds custom ones from existing permissions', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  await page.goto('/team/roles');
  await expectAccessible(page, '/team/roles');
  const form = page.getByRole('form', { name: 'New custom role' });
  await form.getByLabel('Name', { exact: true }).fill('Outreach driver');
  await form.getByRole('button', { name: 'Create role' }).click();
  await expect(form.getByRole('alert')).toContainText('Choose at least one permission');
  await form.getByLabel('See routes and runs').check();
  await form.getByRole('button', { name: 'Create role' }).click();
  await expect(form.getByRole('status')).toContainText('Outreach driver');
});

test('staff without the permission never see admin screens, and typed URLs are refused', async ({ page }) => {
  await signIn(page, 'clinician@example.com');
  await expect(page).toHaveURL(/\/home$/);
  await expect(
    page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Team members' }),
  ).toHaveCount(0);
  await page.goto('/team/members');
  await expect(page).toHaveURL(/\/home\?denied=1$/);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('doesn’t allow');
});

test('owners use the owner console without belonging to a team', async ({ page }) => {
  await signIn(page, 'owner@example.com');
  await expect(page).toHaveURL(/\/owner$/);
  await expectAccessible(page, '/owner');
  const form = page.getByRole('form', { name: 'Create a team' });
  await form.getByLabel('Team name').fill('Second Demo Team (made-up)');
  await form.getByRole('button', { name: 'Create team' }).click();
  await expect(form.getByRole('status')).toContainText('created');
  await expect(page.getByRole('heading', { name: 'Second Demo Team (made-up)' })).toBeVisible();
});

test('signing out ends the session', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in\?ended=signed_out$/);
  await expect(page.getByRole('status')).toContainText('You have signed out');
  await page.goto('/home');
  await expect(page).toHaveURL(/\/sign-in$/);
});
