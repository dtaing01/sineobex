import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  apiCall,
  customRole,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  portalNav,
  setRole,
  signIn,
  staffToken,
  watchTraffic,
} from './helpers';
import { newBirthDate, newPatient, newSurname, phoneOf } from './phone-records';

// Phase 3 design 8, 12.2, 13.7: the duplicate queue, the side-by-side, decisions, merges and undo.

const PAIR_URL = /\/team\/duplicates\/[0-9a-f-]{36}$/;

/**
 * Two charts of one made-up person, made on a phone three minutes apart and reported by staff, so
 * the pair is in the queue whatever the matcher scores. Their names and where they are usually
 * found differ; with `cards`, each has an ID card.
 */
async function freshPair(options: { cards?: boolean } = {}) {
  const family = newSurname();
  const birth = { precision: 'day', date: newBirthDate() };
  const legalName = { given: 'Ozias', family };
  const older = newPatient(
    { preferredName: `Oz ${family}`, legalName, birth, usualArea: 'Demo: by the made-up river steps' },
    4,
  );
  const newer = newPatient(
    { preferredName: `Ozzie ${family}`, legalName, birth, usualArea: 'Demo: made-up library porch' },
    1,
  );
  const phone = await phoneOf('admin@example.com');
  await phone.send(older, newer);
  const admin = await staffToken('admin@example.com');
  if (options.cards) {
    for (const p of [older, newer]) {
      const issued = await apiCall(admin, 'POST', `/v1/patients/${p.recordId}/id-link`, {
        linkId: randomUUID(),
        replacesLinkId: null,
        reason: 'first_card',
      });
      expect(issued.status).toBe(200);
    }
  }
  const flagged = await apiCall(admin, 'POST', '/v1/team/duplicates', {
    patientA: older.recordId,
    patientB: newer.recordId,
    comment: 'Demo: the same person, registered twice',
  });
  expect(flagged.status).toBe(200);
  const pair = (await flagged.json()) as { id: string };
  return {
    pairId: pair.id,
    older: { id: older.recordId, name: `Oz ${family}` },
    newer: { id: newer.recordId, name: `Ozzie ${family}` },
    surname: family,
    phone,
  };
}

/** Nothing typed or shown about a patient reached an address. */
function expectNoNames(addresses: string[], ...names: string[]) {
  for (const name of names) {
    for (const url of addresses) expect(decodeURIComponent(url), url).not.toContain(name);
  }
}

async function decisionForm(page: Page) {
  const form = page.getByRole('form', { name: 'Decide on this pair' });
  await expect(form).toBeVisible();
  return form;
}

test('@responsive done when: the queue lists the seeded pair, and the side by side is a captioned table that passes axe and reflows', async ({
  page,
}) => {
  const traffic = watchTraffic(page);
  await signIn(page, 'admin@example.com');
  await portalNav(page).getByRole('link', { name: 'Duplicates' }).click();
  await expect(page).toHaveURL(/\/team\/duplicates$/);
  await expect(page).toHaveTitle('Duplicates · Sineobex');
  const queue = page.getByRole('table', { name: /Pairs waiting for a decision/ });
  // The seeded pair the server flagged at sync (db/seed/demo-patients.ts, pair 1).
  const name = 'Jon, born 1962, and Johnny, born 1962';
  const seeded = queue.getByRole('link', { name });
  await expect(seeded).toBeVisible();
  // `has` is matched inside each row, so it starts from the page, not the table.
  const listed = queue.getByRole('row').filter({ has: page.getByRole('link', { name }) });
  await expect(listed).toContainText('Likely the same person');
  await expectAccessible(page, '/team/duplicates');
  await expectReflow(page, '/team/duplicates');

  await seeded.click();
  await expect(page).toHaveURL(PAIR_URL);
  await expect(page).toHaveTitle('Compare records · Sineobex');
  const table = page.getByRole('table', { name: 'Two records that may be the same person' });
  await expect(table.getByRole('columnheader', { name: /^Record A, made .* by Demo intake/ })).toBeVisible();
  const row = (label: string) =>
    table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label }) });
  await expect(row('Name they go by')).toContainText('Jon');
  await expect(row('Name they go by')).toContainText('Johnny');
  // Same or Differs in words, never colour alone (1.4.1).
  await expect(row('Name they go by').getByRole('cell').last()).toHaveText('Differs');
  await expect(row('Date of birth').getByRole('cell').last()).toHaveText('Same');
  await expect(row('Photo')).toContainText('No photo yet');
  await expect(row('Recent encounters')).toContainText('No encounters yet');
  await expect(page.getByRole('region', { name: 'Why they were flagged' })).toContainText('Same birth date');
  await expectAccessible(page, '/team/duplicates/[pairId]');
  await expectReflow(page, '/team/duplicates/[pairId]');
  await expectNothingStored(page, '/team/duplicates/[pairId]');
  expectNoNames(traffic.addresses, 'Jon', 'Johnny', 'Mercer');
});

test('a decision needs a choice and a comment, and Not sure keeps the pair queued with its note', async ({
  page,
}) => {
  const pair = await freshPair();
  const traffic = watchTraffic(page);
  await signIn(page, 'admin@example.com');
  await page.goto(`/team/duplicates/${pair.pairId}`);
  const form = await decisionForm(page);

  // Nothing chosen: the summary takes focus and links to each problem.
  await form.getByRole('button', { name: 'Record decision' }).click();
  const summary = form.getByRole('alert');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Check your decision.');
  await expect(summary.getByRole('link', { name: 'Choose Merge, Keep separate or Not sure.' })).toBeVisible();
  await expect(
    summary.getByRole('link', { name: 'Write a comment of at least 3 characters.' }),
  ).toBeVisible();
  await expectAccessible(page, 'decision errors', { inPlace: true });

  // A choice without a comment: still refused, and the choice and the note are kept.
  await form.getByLabel('Not sure').check();
  const note = form.getByLabel('Note for field staff (optional)');
  await expect(note).toHaveAttribute('autocomplete', 'off');
  await note.fill('Demo: check the ID card at the next visit');
  await form.getByRole('button', { name: 'Record decision' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await expect(form.getByLabel('Not sure')).toBeChecked();
  await expect(note).toHaveValue('Demo: check the ID card at the next visit');

  const comment = form.getByLabel('Comment');
  await expect(comment).toHaveAttribute('autocomplete', 'off');
  await comment.fill('Demo: the charts don’t settle it');
  await form.getByRole('button', { name: 'Record decision' }).click();

  // Back on the queue: the confirmation takes focus, and the pair is still there with its note.
  await expect(page).toHaveURL(/\/team\/duplicates\?decided=not_sure&pair=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Marked Not sure' })).toBeFocused();
  const queued = page
    .getByRole('row')
    .filter({ has: page.locator(`a[href="/team/duplicates/${pair.pairId}"]`) });
  await expect(queued).toContainText('Not sure');
  await expect(queued).toContainText('Note for field staff: Demo: check the ID card at the next visit');
  // The link names both records.
  await expect(queued.getByRole('link')).toHaveText(
    new RegExp(`${pair.surname}, born \\d+, and Oz.* ${pair.surname}, born`),
  );

  await page
    .getByRole('navigation', { name: 'Duplicate pairs' })
    .getByRole('link', { name: 'Not sure' })
    .click();
  await expect(page.locator(`a[href="/team/duplicates/${pair.pairId}"]`)).toBeVisible();
  expectNoNames(traffic.addresses, pair.surname, 'check the ID card', 'settle it');
});

test('a record that changed after the pair was opened is refused, and the next try sees the change', async ({
  page,
}) => {
  const pair = await freshPair();
  await signIn(page, 'admin@example.com');
  await page.goto(`/team/duplicates/${pair.pairId}`);
  const form = await decisionForm(page);
  // Meanwhile a phone syncs an edit to one of the two records.
  await pair.phone.send({
    entity: 'patient',
    recordId: pair.newer.id,
    op: 'set',
    field: 'usualArea',
    value: 'Demo: made-up bus shelter on Elm',
    baseVersion: 1,
    minutesAgo: 0,
  });
  await form.getByLabel('Keep separate: they are different people').check();
  await form.getByLabel('Comment').fill('Demo: different people after all');
  await form.getByRole('button', { name: 'Record decision' }).click();
  await expect(form.getByRole('alert')).toBeFocused();
  await expect(form.getByRole('alert')).toContainText('One of these records changed');
  // The pair was read again: the edit shows, and the form kept what was chosen and typed.
  const table = page.getByRole('table', { name: 'Two records that may be the same person' });
  await expect(table).toContainText('Demo: made-up bus shelter on Elm');
  await expect(form.getByLabel('Keep separate: they are different people')).toBeChecked();
  await form.getByRole('button', { name: 'Record decision' }).click();
  await expect(page).toHaveURL(/\/team\/duplicates\?decided=keep_separate&pair=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Kept separate' })).toBeFocused();
  await expect(page.locator(`a[href="/team/duplicates/${pair.pairId}"]`)).toHaveCount(0);
});

test('merge through the confirmation; a reviewer without identity corrections sees no Undo and is refused; the admin undoes it', async ({
  page,
  browser,
  baseURL,
}) => {
  const pair = await freshPair({ cards: true });
  const traffic = watchTraffic(page);
  await signIn(page, 'admin@example.com');
  await page.goto(`/team/duplicates/${pair.pairId}`);
  const form = await decisionForm(page);

  await form.getByLabel('Merge: they are the same person').check();
  // The older record is kept unless the reviewer chooses otherwise (design 8.4).
  const kept = form.getByRole('group', { name: 'Which chart is kept?' });
  await expect(kept.getByLabel(new RegExp(`${pair.older.name}.*the older record`))).toBeChecked();
  await form.getByLabel('Comment').fill('Demo: same person, confirmed at the van');
  await form.getByRole('button', { name: 'Continue' }).click();

  // Nothing is merged yet: the confirmation says what will happen.
  const confirm = form.getByRole('region', { name: 'Check before merging' });
  await expect(confirm.getByRole('heading', { name: 'Check before merging' })).toBeFocused();
  await expect(confirm).toContainText('2 fields differ and open reviews on the kept chart');
  await expect(confirm).toContainText('Both ID cards keep opening the kept chart until a new card is made.');
  await expectAccessible(page, 'merge confirmation', { inPlace: true });
  await form.getByRole('button', { name: 'Merge records' }).click();

  await expect(page).toHaveURL(/\/team\/duplicates\?decided=merge&pair=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Merged' })).toBeFocused();
  await expect(page.locator(`a[href="/team/duplicates/${pair.pairId}"]`)).toHaveCount(0);

  await portalNav(page).getByRole('link', { name: 'Merges' }).click();
  await expect(page).toHaveTitle('Merges · Sineobex');
  const merge = page.getByRole('region', {
    name: new RegExp(`${pair.newer.name}, born \\d+, merged into ${pair.older.name}`),
  });
  await expect(merge).toContainText('Demo: same person, confirmed at the van');
  await expect(merge.getByRole('button', { name: 'Undo this merge' })).toBeVisible();
  await expectAccessible(page, '/team/merges');
  await expectReflow(page, '/team/merges');

  // A reviewer made from Healthcare Staff plus Review duplicates: no patients.correct_identity.
  const reviewerRole = await customRole('Healthcare Staff + Review duplicates', [
    'patients.view',
    'patients.edit',
    'patients.view_sensitive',
    'encounters.chart',
    'checkins.create',
    'referrals.create',
    'routes.view',
    'inventory.view',
    'patients.review_duplicates',
  ]);
  await setRole('resident@example.com', reviewerRole);
  try {
    const context = await browser.newContext({ baseURL: baseURL! });
    const other = await context.newPage();
    await signIn(other, 'resident@example.com');
    await other.goto('/team/merges');
    const seen = other.getByRole('region', {
      name: new RegExp(`${pair.newer.name}, born \\d+, merged into`),
    });
    await expect(seen).toBeVisible();
    await expect(seen.getByRole('button', { name: 'Undo this merge' })).toHaveCount(0);
    await context.close();

    // The API refuses it too, and logs the refusal.
    const resident = await staffToken('resident@example.com');
    const merges = (await (await apiCall(resident, 'GET', '/v1/team/merges')).json()) as {
      merges: { id: string; pairId: string; undoable: boolean }[];
    };
    const mine = merges.merges.find((m) => m.pairId === pair.pairId)!;
    expect(mine.undoable).toBe(false);
    const refused = await apiCall(resident, 'POST', `/v1/team/merges/${mine.id}/undo`, {
      comment: 'Demo: trying without the permission',
    });
    expect(refused.status).toBe(403);
    const me = (await (await apiCall(resident, 'GET', '/v1/me')).json()) as { user: { id: string } };
    const log = await apiCall(await staffToken('admin@example.com'), 'POST', '/v1/team/audit/search', {
      actorUserId: me.user.id,
      actionPrefix: 'access.denied',
      limit: 5,
    });
    const entries = ((await log.json()) as { entries: { details: Record<string, unknown> }[] }).entries;
    expect(entries.some((e) => e.details.permission === 'patients.correct_identity')).toBe(true);
  } finally {
    await setRole('resident@example.com', 'healthcare_staff');
  }

  // The Program Admin undoes it: a comment is required, and the result says what went back.
  await merge.getByRole('button', { name: 'Undo this merge' }).click();
  const undo = merge.getByRole('form', { name: `Undo the merge of ${pair.newer.name}` });
  await undo.getByRole('button', { name: 'Undo merge' }).click();
  await expect(undo.getByRole('alert')).toBeFocused();
  await expect(undo.getByRole('alert')).toContainText('Say why you are undoing the merge.');
  await expectAccessible(page, 'undo errors', { inPlace: true });
  await undo.getByLabel('Why are you undoing it?').fill('Demo: two different people after all');
  await undo.getByRole('button', { name: 'Undo merge' }).click();
  await expect(merge.getByRole('heading', { name: 'Merge undone' })).toBeFocused();
  await expect(merge).toContainText(`${pair.newer.name} is a chart of its own again`);
  // The list reloaded behind the result.
  await expect(merge).toContainText('Undone');
  await expect(merge.getByRole('button', { name: 'Undo this merge' })).toHaveCount(0);
  await expectAccessible(page, 'undo result', { inPlace: true });

  // The pair is back in the queue, to be decided again.
  await portalNav(page).getByRole('link', { name: 'Duplicates' }).click();
  await expect(page.locator(`a[href="/team/duplicates/${pair.pairId}"]`)).toBeVisible();
  expectNoNames(traffic.addresses, pair.surname, 'confirmed at the van', 'different people');
  await expectNothingStored(page, '/team/merges');
});
