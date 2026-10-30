import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNothingStored, expectReflow, MFA_CODE, signIn } from './helpers';

// Phase 3 design 11.6 and 13.7: an admin corrects a legal name or date of birth, behind a fresh
// sign-in, with a reason; a patient's request can be declined. Benny is a made-up seeded patient.
const BENNY = '5eed0000-0000-4000-8000-000000000036';

test.describe.configure({ mode: 'serial' });

/** Through the profile's Correct identity link: the authenticator code first, then the form. */
async function openCorrections(page: Page) {
  await page.goto(`/patients/${BENNY}`);
  await page.getByRole('link', { name: 'Correct identity' }).click();
  await expect(page).toHaveURL(/\/reauth\?next=/);
  await expect(page).toHaveTitle('Confirm it’s you · Sineobex');
  await page.getByLabel('6-digit code').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${BENNY}/correct$`));
  await expect(page).toHaveTitle('Correct identity · Sineobex');
}

test('a date of birth is corrected behind the sign-in check, read back in words, and needs a reason', async ({
  page,
}) => {
  await signIn(page, 'admin@example.com');
  await openCorrections(page);
  for (const label of [/^Given name/, /^Family name/, /^Date of birth or age/])
    await expect(page.getByLabel(label)).toHaveAttribute('autocomplete', 'off');
  await expectAccessible(page, '/correct');
  await expectReflow(page, '/correct');

  // A different day each run, so the correction always changes the chart.
  const day = 1 + Math.floor(Math.random() * 27);
  const form = page.getByRole('form', { name: 'Correct the date of birth' });
  await form.getByLabel(/^Date of birth or age/).fill(`2/${day}/1961`);
  await form.getByRole('button', { name: 'Check the date' }).click();
  const summary = form.getByRole('alert');
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Choose why the change is made.',
    'Give a reason of at least 3 characters.',
  ]);
  await expectAccessible(page, 'correction without a reason', { inPlace: true });

  await form.getByRole('radio', { name: 'Correcting a mistake on the chart' }).check();
  await form.getByLabel(/^Reason/).fill('Demo: checked against the made-up shelter intake form');
  await form.getByRole('button', { name: 'Check the date' }).click();
  // The read-back is its own step, under its own heading, before anything is saved.
  await expect(form.getByRole('heading', { name: 'Check the date of birth' })).toBeFocused();
  await expect(form).toContainText(new RegExp(`February ${day}, 1961 · age \\d+`));
  await expectAccessible(page, 'date read back', { inPlace: true });
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(new RegExp(`/patients/${BENNY}\\?corrected=birth$`));
  await expect(page.getByRole('status')).toContainText('Date of birth corrected');
  await expect(page.getByRole('main')).toContainText(`Born February ${day}, 1961`);
  await page.goto(`/patients/${BENNY}/history?field=birth`);
  const row = page.getByRole('row').filter({ hasText: 'Admin correction' }).first();
  await expect(row.getByRole('cell').nth(1)).toContainText(`February ${day}, 1961`);
  await expect(row.getByRole('cell').nth(2)).toHaveText('Alex Rivera (demo)');
  await expectNothingStored(page, 'corrections');
});

test('a patient’s request to change the legal name, declined: recorded with a reason, the chart unchanged', async ({
  page,
}) => {
  await signIn(page, 'admin@example.com');
  await openCorrections(page);
  const form = page.getByRole('form', { name: 'Correct the legal name' });
  await form.getByLabel(/^Given name/).fill('Benjamín');
  await form.getByRole('radio', { name: 'The patient asked, and the request is declined' }).check();
  await form.getByLabel(/^Reason/).fill('Demo: the made-up ID card shows the recorded spelling');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${BENNY}\\?corrected=declined$`));
  await expect(page.getByRole('status')).toContainText('The declined request is recorded');
  await expect(page.getByRole('main')).toContainText('Legal name: Benjamin Ross');
});

test('without patients.correct_identity there is no way to a correction', async ({ page }) => {
  await signIn(page, 'logistics@example.com');
  await page.goto(`/patients/${BENNY}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Benny');
  await expect(page.getByRole('link', { name: 'Correct identity' })).toHaveCount(0);
  await page.goto(`/patients/${BENNY}/correct`);
  await expect(page).toHaveURL(/\/home\?denied=1$/);
});
