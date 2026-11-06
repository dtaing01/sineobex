import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNothingStored, expectReflow, signIn, watchTraffic } from './helpers';
import { phoneOf } from './phone-records';

// Phase 3 design 13.7: search, the profile as each role sees it, field reviews and history, against
// the seeded demo team (made-up people, db/seed/demo-patients.ts).
const patient = (n: number) => `5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DEL = patient(1); // the done-when's patient: street name "Smitty", born 1946
const ROSA = patient(8); // kept when Rosie (9) was merged into her; both records have a card
const ROSIE = patient(9);
const DEE = patient(16); // two problems, one of them sensitive
const KEN = patient(20); // where he is usually found has an open review
const SMOKEY = patient(26); // a street name, and a coded problem beside a sensitive one
const NANA = patient(34); // two allergies

test.describe.configure({ mode: 'serial' });

/** Tab until `name` has focus: the page works from the keyboard alone. */
async function tabTo(page: Page, name: string, limit = 40) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '',
    );
    if (focused.replace(/\s+/g, ' ').trim() === name) return;
  }
  throw new Error(`${name} never took focus`);
}

test('a misspelled street name finds the patient, from the keyboard, and nothing typed reaches an address, title or history', async ({
  page,
}) => {
  await signIn(page, 'logistics@example.com');
  const traffic = watchTraffic(page);
  await page.goto('/patients');
  await expect(page).toHaveTitle('Patients · Sineobex');
  // Names and birth dates never enter the browser's form history.
  for (const label of [/^Name, street name or description/, /^Month/, /^Day/, /^Year/])
    await expect(page.getByLabel(label)).toHaveAttribute('autocomplete', 'off');
  await expectAccessible(page, '/patients');

  // Nothing to search by: the error summary takes focus and links to the field.
  await page.getByRole('button', { name: 'Search' }).click();
  // The form's own summary: Next's route announcer is an alert too.
  const summary = page.getByRole('form', { name: 'Search patients' }).getByRole('alert');
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Type a name, street name or description, or a full date of birth.',
  ]);
  // A year alone never browses the list.
  await page.getByLabel(/^Year/).fill('1946');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(summary).toContainText('Add a name with the birth year');
  await page.getByLabel(/^Year/).fill('');

  await page.getByLabel(/^Name, street name or description/).focus();
  await page.keyboard.type('Smity');
  await page.keyboard.press('Enter');
  const results = page.getByRole('table', { name: 'Search results' });
  const del = results.getByRole('link', { name: 'Open chart: Del, born 1946' });
  await expect(del).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/found/);
  const row = results
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'Open chart: Del, born 1946' }) });
  await expect(row).toContainText('Smitty');
  await expect(row).toContainText('Likely: Street name');
  await expect(page).toHaveURL(/\/patients$/);
  await expectAccessible(page, 'search results', { inPlace: true });
  await expectReflow(page, 'search results');

  // The results take focus, so the first Tab reaches the first chart link.
  await expect(results).toBeFocused();
  await tabTo(page, 'Open chart: Del, born 1946');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${DEL}$`));
  await expect(page).toHaveTitle('Patient · Sineobex');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Del');

  // Only UUIDs in the address bar; the search text went in the search's POST body and nowhere else.
  for (const address of traffic.addresses) expect(address).toMatch(/\/patients(\/[0-9a-f-]{36})?$/);
  expect(await traffic.carrying('Smity')).toEqual(['POST http://localhost:3100/patients']);
  const state = await page.evaluate(() => JSON.stringify(history.state));
  for (const phi of ['Smity', 'Smitty', 'Delbert', 'Del,']) expect(state).not.toContain(phi);
  await expectNothingStored(page, 'search');
});

test('Billing/Data sees the chart read-only: street names, allergies and coded problems, nothing sensitive', async ({
  page,
}) => {
  await signIn(page, 'billing@example.com');
  await page.goto(`/patients/${SMOKEY}`);
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Smokey');
  await expect(main.getByRole('region', { name: 'Street names' })).toContainText('Smoke');
  const problems = main.getByRole('region', { name: 'Problems' });
  await expect(problems).toContainText('Immersion foot, right foot, initial encounter');
  await expect(problems).toContainText('T69.021A');
  // Hidden, not counted (design 4.3).
  await expect(main).not.toContainText('Alcohol dependence');
  await expect(main).not.toContainText('F10.20');
  await expect(main).not.toContainText('Sensitive');
  // Nothing to change: no correction, no card link or new card, no review decision.
  await expect(main.getByRole('link', { name: 'Correct identity' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /link|card|decision/i })).toHaveCount(0);
  await expect(main.getByRole('form')).toHaveCount(0);

  await page.goto(`/patients/${NANA}`);
  const allergies = page.getByRole('table', { name: 'Allergies on the chart' });
  await expect(allergies.getByRole('rowheader')).toHaveText(['sulfa', 'codeine']);
  await expect(allergies).toContainText('Demo: nausea');
  await expectAccessible(page, 'profile, Billing/Data');
});

test('a Program Admin sees every problem with its history, and the profile works in every theme and at 320 px', async ({
  page,
}) => {
  await signIn(page, 'admin@example.com');
  await page.goto(`/patients/${DEE}`);
  const problems = page.getByRole('region', { name: 'Problems' });
  await expect(problems.getByRole('heading', { level: 3 })).toHaveText([
    'Opioid dependence, uncomplicated',
    'Essential (primary) hypertension',
  ]);
  await expect(problems).toContainText('Sensitive');
  // The status history is a disclosure, opened from the keyboard.
  const disclosure = problems.getByText('Status history and notes for Essential (primary) hypertension');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(problems.locator('details[open]')).toContainText('Ongoing');
  await expect(page.getByRole('link', { name: 'Correct identity' })).toBeVisible();
  // The chart's card links never reach the browser; Show link asks for them (id-card.spec.ts).
  expect(await page.content()).not.toContain('/c#');
  await expectAccessible(page, 'profile, Program Admin');
  await expectReflow(page, 'profile');
  await expectNothingStored(page, 'profile');
});

test('a field review decided from the queue by keyboard, and the history shows the old and the new value', async ({
  page,
}) => {
  // A phone that didn't see Ken's current spot records another: the chart keeps its own.
  const spot = `Demo: e2e spot ${randomUUID().slice(0, 8)}`;
  const phone = await phoneOf('admin@example.com');
  await phone.send({
    entity: 'patient',
    recordId: KEN,
    op: 'set',
    field: 'usualArea',
    value: spot,
    minutesAgo: 0,
  });

  await signIn(page, 'logistics@example.com');
  await page.goto('/team/reviews');
  await expect(page).toHaveTitle('Reviews · Sineobex');
  const choice = `Use “${spot}”`;
  const form = page.getByRole('form').filter({ has: page.getByRole('radio', { name: choice }) });
  await expect(form).toHaveCount(1);
  await expect(form).toContainText('Recorded by');
  // The queue names whose chart each review is on (review finding W1).
  const section = page.getByRole('region').filter({ has: form });
  await expect(section.getByRole('heading', { level: 2 })).toContainText('Usually found, Ken');
  await expect(section.getByRole('link', { name: /^Open the chart of Ken/ })).toHaveCount(1);
  await expectAccessible(page, '/team/reviews');

  // No choice: nothing changes, and the error summary takes focus.
  await form.getByRole('button', { name: 'Record decision' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await expectAccessible(page, 'review without a choice', { inPlace: true });

  await form.getByRole('radio', { name: choice }).focus();
  await page.keyboard.press('Space');
  await form.getByRole('button', { name: 'Record decision' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/team\/reviews\?decided=alternate$/);
  await expect(page.getByRole('status')).toContainText('The chart now shows the value you chose');

  await page.goto(`/patients/${KEN}`);
  await expect(page.getByRole('region', { name: 'Details' })).toContainText(spot);
  await page
    .getByRole('region', { name: 'Details' })
    .getByRole('link', { name: 'History of Usually found' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/patients/${KEN}/history\\?field=usualArea$`));
  await expect(page).toHaveTitle('History · Sineobex');
  const decided = page.getByRole('row').filter({ hasText: 'Review decision' }).filter({ hasText: spot });
  await expect(decided).toHaveCount(1);
  await expect(decided.getByRole('rowheader')).toHaveText('Usually found');
  // The old value is the one the chart held before, never the one chosen.
  const cells = decided.getByRole('cell');
  await expect(cells.nth(0)).not.toHaveText(spot);
  await expect(cells.nth(0)).toHaveText(/^Demo: /);
  await expect(cells.nth(1)).toHaveText(spot);
  // Recorded by the person who saw the value, approved by the reviewer.
  await expect(cells.nth(2)).toContainText('Alex Rivera (demo)');
  await expect(cells.nth(2)).toContainText('Approved by Sam Okafor (demo)');
  await expectAccessible(page, 'history');
  await expectReflow(page, 'history');
});

test('a merged record’s address opens the chart it was merged into, with the banner and both ID cards', async ({
  page,
}) => {
  await signIn(page, 'logistics@example.com');
  const traffic = watchTraffic(page);
  await page.goto(`/patients/${ROSIE}`);
  await expect(page).toHaveTitle('Patient · Sineobex');
  await expect(
    page.getByText('The record you opened was merged into this chart on Sep 27, 2026.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rosa');
  await expect(page.getByRole('link', { name: 'History', exact: true })).toHaveAttribute(
    'href',
    `/patients/${ROSA}/history`,
  );
  // Each record's card keeps opening the kept chart until a new card is made (D39).
  const panel = page.getByRole('region', { name: 'ID card' });
  await expect(panel).toContainText('2 cards open this chart');
  await expect(panel.getByRole('listitem')).toHaveText([
    'Card made Sep 20, 2026, for a record merged into this chart',
    'Card made Sep 3, 2026',
  ]);
  await expectAccessible(page, 'merged chart');
  await panel.getByRole('button', { name: 'Show links' }).click();
  await expect(panel.locator('code')).toHaveText([
    /\/c#DemoCardToken000000009$/,
    /\/c#DemoCardToken000000008$/,
  ]);
  for (const token of ['DemoCardToken000000009', 'DemoCardToken000000008'])
    expect(await traffic.carrying(token)).toEqual([]);
});
