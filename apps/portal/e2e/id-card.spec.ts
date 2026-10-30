import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  signIn,
  staffToken,
  watchTraffic,
} from './helpers';

// Phase 3 design 10.3, 10.4 and 13.7: Street Medicine ID cards from the portal. Shay is a made-up
// seeded patient with a card.
const SHAY = '5eed0000-0000-4000-8000-000000000014';
const CARD_URL = /\/c#([A-Za-z0-9_-]{22})$/;
const tokenOf = (url: string) => CARD_URL.exec(url)![1]!;

test('Show link, Copy and Make a new card; a card made elsewhere meanwhile is caught; no token leaves the page', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'logistics@example.com');
  const traffic = watchTraffic(page);
  await page.goto(`/patients/${SHAY}`);
  const panel = page.getByRole('region', { name: 'ID card' });
  await expect(panel).toContainText('Active since');
  // The chart's links never reach the browser: Show link asks for them, and that read is logged.
  expect(await page.content()).not.toContain('/c#');
  await expectAccessible(page, 'ID card panel');

  await panel.getByRole('button', { name: 'Show link' }).click();
  await expect(panel.getByRole('heading', { name: 'Card link' })).toBeFocused();
  const first = (await panel.locator('code').textContent())!;
  expect(first).toMatch(CARD_URL);
  await expect(panel).toContainText(
    'Don’t print the person’s name, birth date or health details on the card.',
  );
  await panel.getByRole('button', { name: /^Copy link/ }).click();
  await expect(panel.getByRole('status')).toContainText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
  await expectAccessible(page, 'card link shown', { inPlace: true });

  // A reason first, with nothing chosen for the person, then which card stops working.
  await panel.getByRole('button', { name: 'Make a new card' }).click();
  const form = panel.getByRole('form', { name: 'Make a new card' });
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await expectAccessible(page, 'new card without a reason', { inPlace: true });
  await form.getByRole('radio', { name: 'Lost' }).check();
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByRole('heading', { name: 'Check before making the card' })).toBeFocused();
  await expect(form).toContainText(/The card made on .+ stops working/);
  await expectAccessible(page, 'new card confirmation', { inPlace: true });
  await form.getByRole('button', { name: 'Make the new card' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    'New card made. The old card no longer opens the chart.',
  );
  await expect(panel.getByRole('heading', { name: 'Card link' })).toBeFocused();
  const second = (await panel.locator('code').textContent())!;
  expect(second).toMatch(CARD_URL);
  expect(second).not.toBe(first);

  // Someone else makes a card while this page still shows the one above.
  const clinician = await staffToken('clinician@example.com');
  const cards = (await (await apiCall(clinician, 'GET', `/v1/patients/${SHAY}/id-link`)).json()) as {
    active: { id: string }[];
  };
  const elsewhere = await apiCall(clinician, 'POST', `/v1/patients/${SHAY}/id-link`, {
    linkId: randomUUID(),
    replacesLinkId: cards.active[0]!.id,
    reason: 'damaged',
  });
  expect(elsewhere.status).toBe(200);
  const third = ((await elsewhere.json()) as { active: { url: string }[] }).active[0]!.url;

  // Refused (409 link_changed, which carries no link): the page re-reads the cards and asks again.
  await panel.getByRole('button', { name: 'Make a new card' }).click();
  await form.getByRole('radio', { name: 'Damaged' }).check();
  await form.getByRole('button', { name: 'Continue' }).click();
  await form.getByRole('button', { name: 'Make the new card' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await expect(form.getByRole('alert')).toContainText('Someone made a new card for this patient');
  // The link this page showed no longer opens the chart, so it is gone.
  await expect(panel.locator('code')).toHaveCount(0);
  await form.getByRole('button', { name: 'Cancel' }).click();
  await panel.getByRole('button', { name: 'Show link' }).click();
  await expect(panel.locator('code')).toHaveText(third);
  await expectReflow(page, 'ID card panel');
  await expectNothingStored(page, 'ID card panel');
  for (const url of [first, second, third]) expect(await traffic.carrying(tokenOf(url))).toEqual([]);

  // The card's address shows only the sign-in text, and its token stays in the browser.
  const visit = watchTraffic(page);
  await page.goto(`/c#${tokenOf(third)}`);
  await expect(page).toHaveTitle('Sineobex');
  await expect(page.getByRole('heading')).toHaveText(['This is a Street Medicine ID card']);
  await expect(page.getByRole('main')).toContainText('Staff: sign in to open the chart.');
  expect(await visit.carrying(tokenOf(third))).toEqual([]);
});

test('without patients.edit the panel shows the card, but no link and no new card', async ({ page }) => {
  await signIn(page, 'billing@example.com');
  await page.goto(`/patients/${SHAY}`);
  const panel = page.getByRole('region', { name: 'ID card' });
  await expect(panel).toContainText('Active since');
  await expect(panel.getByRole('button')).toHaveCount(0);
  expect(await page.content()).not.toContain('/c#');
});
