import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  portalNav,
  signIn,
  staffToken,
  watchTraffic,
} from './helpers';
import { newBirthDate, newPatient, newSurname, phoneOf, type PhoneChange } from './phone-records';

// Phase 3 design 9.4, 12.2, 13.7: problems marked Resolved by mistake, reversed or declined in the
// portal, then the offer to merge the two entries.

/**
 * A made-up patient with a problem resolved on a phone, and the "It never went away" entry a
 * worker added for it afterwards: the reversal request.
 */
async function freshRequest() {
  const family = newSurname();
  const patient = newPatient(
    { preferredName: `Wren ${family}`, birth: { precision: 'day', date: newBirthDate() } },
    10,
  );
  const title = `Demo: wound on the left shin ${family}`;
  const original: PhoneChange = {
    entity: 'problem',
    recordId: randomUUID(),
    op: 'create',
    value: { patientId: patient.recordId, title, status: 'new' },
    minutesAgo: 9,
  };
  const resolved: PhoneChange = {
    entity: 'problem',
    recordId: original.recordId,
    op: 'set',
    field: 'status',
    value: { status: 'resolved', encounterId: null },
    baseVersion: 1,
    minutesAgo: 8,
  };
  const request: PhoneChange = {
    entity: 'problem',
    recordId: randomUUID(),
    op: 'create',
    value: { patientId: patient.recordId, title, status: 'new', resolvedInErrorOf: original.recordId },
    minutesAgo: 7,
  };
  await (await phoneOf('admin@example.com')).send(patient, original, resolved, request);
  return {
    patientId: patient.recordId,
    originalId: original.recordId,
    requestId: request.recordId,
    title,
    family,
  };
}

/** The request's section on the page, found by its heading. */
function requestSection(page: Page, title: string) {
  return page.getByRole('region', { name: new RegExp(`\\d+\\. ${title}, for Wren`) });
}

test('@responsive a reversal request is reversed with a reason, then the new entry is merged into the original', async ({
  page,
}) => {
  const req = await freshRequest();
  const traffic = watchTraffic(page);
  await signIn(page, 'admin@example.com');
  await portalNav(page).getByRole('link', { name: 'Problem reversals' }).click();
  await expect(page).toHaveURL(/\/team\/problem-reversals$/);
  await expect(page).toHaveTitle('Problem reversals · Sineobex');
  const section = requestSection(page, req.title);
  await expect(section.getByRole('heading', { name: 'The original entry' })).toBeVisible();
  await expect(section.getByRole('listitem').filter({ hasText: 'The original entry' })).toContainText(
    'Resolved',
  );
  await expectAccessible(page, '/team/problem-reversals');
  await expectReflow(page, '/team/problem-reversals');

  // No decision and no reason: the summary takes focus.
  const form = section.getByRole('form', { name: /^Decide on / });
  await form.getByRole('button', { name: 'Record decision' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await expect(
    form.getByRole('alert').getByRole('link', { name: 'Choose Reverse or Decline.' }),
  ).toBeVisible();
  await expect(
    form.getByRole('alert').getByRole('link', { name: 'Give a reason of at least 3 characters.' }),
  ).toBeVisible();
  await expectAccessible(page, 'reversal errors', { inPlace: true });

  await form.getByLabel(/^Reverse:/).check();
  await form.getByLabel('Reason').fill('Demo: the wound never healed');
  await form.getByRole('button', { name: 'Record decision' }).click();

  // The outcome takes focus, the answered request leaves the list, and the merge is offered.
  const outcome = page.getByRole('region', { name: `Reversed: ${req.title} is Ongoing again` });
  await expect(outcome.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(requestSection(page, req.title)).toHaveCount(0);
  const offer = outcome.getByRole('form', { name: 'Merge the new entry into the original' });
  await expect(offer).toContainText(`Entry: ${req.title}, New`);
  await expectAccessible(page, 'merge offer', { inPlace: true });
  await offer.getByRole('button', { name: 'Merge entries' }).click();
  await expect(offer.getByRole('alert')).toBeFocused();
  await expectAccessible(page, 'merge offer errors', { inPlace: true });
  await offer.getByLabel('Comment').fill('Demo: one wound, one entry');
  await offer.getByRole('button', { name: 'Merge entries' }).click();

  await expect(page).toHaveURL(/\/team\/problem-reversals\?done=merged&entry=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Entries merged' })).toBeFocused();
  await expect(requestSection(page, req.title)).toHaveCount(0);

  // The chart: the original is Ongoing, and the new entry was merged into it.
  const chart = (await (
    await apiCall(await staffToken('admin@example.com'), 'GET', `/v1/patients/${req.patientId}`)
  ).json()) as { problems: { id: string; status: string; attributes: { mergedInto: string | null } }[] };
  expect(chart.problems.find((p) => p.id === req.originalId)?.status).toBe('ongoing');
  expect(chart.problems.find((p) => p.id === req.requestId)?.attributes.mergedInto).toBe(req.originalId);
  for (const url of traffic.addresses) expect(decodeURIComponent(url)).not.toContain(req.family);
  await expectNothingStored(page, '/team/problem-reversals');
});

test('after Reverse, Keep them separate leaves both entries on the list', async ({ page }) => {
  const req = await freshRequest();
  await signIn(page, 'admin@example.com');
  await page.goto('/team/problem-reversals');
  const form = requestSection(page, req.title).getByRole('form', { name: /^Decide on / });
  await form.getByLabel(/^Reverse:/).check();
  await form.getByLabel('Reason').fill('Demo: the wound never healed');
  await form.getByRole('button', { name: 'Record decision' }).click();
  const outcome = page.getByRole('region', { name: `Reversed: ${req.title} is Ongoing again` });
  await outcome.getByRole('link', { name: 'Keep them separate' }).click();

  await expect(page).toHaveURL(/\/team\/problem-reversals\?done=reversed&entry=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Reversed', exact: true })).toBeFocused();
  await expect(outcome).toHaveCount(0);
  const chart = (await (
    await apiCall(await staffToken('admin@example.com'), 'GET', `/v1/patients/${req.patientId}`)
  ).json()) as { problems: { id: string; status: string; attributes: { mergedInto: string | null } }[] };
  expect(chart.problems.find((p) => p.id === req.originalId)?.status).toBe('ongoing');
  expect(chart.problems.find((p) => p.id === req.requestId)?.attributes.mergedInto).toBeNull();
});

test('a declined request stays a separate problem', async ({ page }) => {
  const req = await freshRequest();
  await signIn(page, 'admin@example.com');
  await page.goto('/team/problem-reversals');
  const form = requestSection(page, req.title).getByRole('form', { name: /^Decide on / });
  await form.getByLabel(/^Decline:/).check();
  await form.getByLabel('Reason').fill('Demo: it healed; this is a new wound');
  await form.getByRole('button', { name: 'Record decision' }).click();

  await expect(page).toHaveURL(/\/team\/problem-reversals\?done=declined&entry=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Declined' })).toBeFocused();
  await expect(requestSection(page, req.title)).toHaveCount(0);
  const chart = (await (
    await apiCall(await staffToken('admin@example.com'), 'GET', `/v1/patients/${req.patientId}`)
  ).json()) as { problems: { id: string; status: string; attributes: { mergedInto: string | null } }[] };
  expect(chart.problems.find((p) => p.id === req.originalId)?.status).toBe('resolved');
  expect(chart.problems.find((p) => p.id === req.requestId)?.attributes.mergedInto).toBeNull();
});
