import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  signIn,
  staffToken,
  watchCsp,
  watchTraffic,
} from './helpers';
import { newPatient, newSurname, phoneOf, type PhoneChange } from './phone-records';

// Phase 4 design, lifecycle 9.7 and 9.11: the visit page and the patient page's timeline, against
// the seeded demo team's made-up visits (db/seed/demo-encounters.ts) and visits a phone sends here.
const patient = (n: number) => `5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const visit = (n: number) => `5eed2000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MARCUS = patient(15); // visit 1: a resident's Red flags note, attested a day later; a Social needs note
const WOUND = visit(3); // the attending's wound note, a measurement corrected the next day

test.describe.configure({ mode: 'serial' });

/** How many audit events of [action] the person wrote on the patient's chart, as the audit search finds them. */
async function audited(email: string, patientId: string, action: string): Promise<number> {
  const admin = await staffToken('admin@example.com');
  const members = (await (await apiCall(admin, 'GET', '/v1/team/members')).json()) as {
    userId: string;
    email: string;
  }[];
  const userId = members.find((m) => m.email === email)!.userId;
  const res = await apiCall(admin, 'POST', '/v1/team/audit/search', {
    actorUserId: userId,
    patientId,
    actionPrefix: action,
    limit: 100,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: unknown[] }).entries.length;
}

/** The visit page's addresses, and the patient page's: IDs only. */
function expectOnlyIds(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(/\/(patients|encounters)\/[0-9a-f-]{36}$|\/(home|sign-in.*)$/);
}

/** The items of the trail under a note: sign-offs, attestations, corrections, addenda. */
function trail(page: Page, note: string) {
  return page
    .getByRole('article', { name: note })
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Sign-offs and changes' }) })
    .getByRole('listitem');
}

test('@responsive a resident’s signed note, attested the next day, opened from the timeline: read-only in every theme', async ({
  page,
}) => {
  await signIn(page, 'admin@example.com');
  const csp = watchCsp(page);
  const traffic = watchTraffic(page);
  const visitPages: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/encounters/')) visitPages.push(r.url());
  });
  await page.goto(`/patients/${MARCUS}`);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const link = timeline.getByRole('link', { name: 'Visit on Oct 20, 2026, 12:00 PM' });
  const row = timeline.getByRole('listitem').filter({
    has: page.getByRole('link', { name: 'Visit on Oct 20, 2026, 12:00 PM' }),
  });
  // Titles and states as the API gives them.
  await expect(row.getByRole('listitem')).toHaveText([
    'Red flags and disposition: Signed and attested',
    'Social needs: Complete',
  ]);
  // A link to a visit loads nothing until it is followed: opening one logs a read.
  expect(visitPages).toEqual([]);

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${visit(1)}$`));
  await expect(page).toHaveTitle('Visit · Sineobex');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Visit');
  const main = page.getByRole('main');
  await expect(main.locator('.px-lede')).toHaveText('Marcus · Medical · Oct 20, 2026, 12:00 PM');
  const about = page.getByRole('region', { name: 'About the visit' });
  await expect(about).toContainText('Demo: outside the made-up Eastern Market shed');
  await expect(about).toContainText('Demo: sugars steady on his own log; no red flags today.');

  const flags = page.getByRole('article', { name: 'Red flags and disposition' });
  await expect(flags).toContainText('Signed and attested');
  await expect(flags).toContainText('Written by Casey Nguyen (demo).');
  await expect(flags).toContainText('Does the patient require emergency evaluation?');
  await expect(trail(page, 'Red flags and disposition')).toHaveText([
    'Signed by Casey Nguyen (demo), Resident, Oct 20, 2026, 12:25 PM',
    'Attested by Jordan Lee (demo), Oct 21, 2026, 11:00 AM',
  ]);
  await expect(trail(page, 'Social needs')).toHaveText([
    'Completed by Casey Nguyen (demo), Resident, Oct 20, 2026, 12:25 PM',
  ]);
  // Nothing on the page changes the visit.
  await expect(main.getByRole('button')).toHaveCount(0);
  await expect(main.locator('form')).toHaveCount(0);

  await expectAccessible(page, 'visit page');
  await expectReflow(page, 'visit page');
  await expectNothingStored(page, 'visit page');
  expectOnlyIds(traffic.addresses);
  expect(csp).toEqual([]);
});

test('a corrected measurement shows the new value, and the old one struck through and read as replaced', async ({
  page,
}) => {
  // Billing/Data reads Medical notes and changes none.
  await signIn(page, 'billing@example.com');
  await page.goto(`/encounters/${WOUND}`);
  // No preferred name on this chart: none is made up.
  await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
    'No name recorded · Medical · Oct 24, 2026, 6:00 PM',
  );
  const wound = page.getByRole('article', { name: 'Wound care' });
  await expect(wound.getByRole('heading', { level: 4 })).toHaveText('Wound 1');
  const length = wound
    .locator('dl > div')
    .filter({ has: page.getByText('Measurements, Length', { exact: true }) });
  await expect(length.locator('dd > span').first()).toHaveText('3.5 cm');
  const old = length.locator('del');
  await expect(old).toHaveText('3.0 cm');
  await expect(old).toHaveAttribute('aria-hidden', 'true');
  // What a screen reader hears in its place.
  await expect(length.getByText('Replaced: 3.0 cm', { exact: true })).toHaveClass('sr-only');
  await expect(length).toContainText(
    'Changed by Jordan Lee (demo), Attending physician, Oct 25, 2026, 12:00 PM',
  );
  await expect(length).toContainText('Reason: Demo: measured again along the long edge');
  // An answer nobody corrected strikes nothing through.
  await expect(wound.locator('del')).toHaveCount(1);
  await expect(trail(page, 'Wound care')).toHaveText([
    'Signed by Jordan Lee (demo), Attending physician, Oct 24, 2026, 6:30 PM',
    'Corrected by Jordan Lee (demo), Attending physician, Oct 25, 2026, 12:00 PM' +
      'Reason: Demo: measured again along the long edge',
  ]);
  // The recap is over the answers as corrected.
  await expect(wound.getByRole('heading', { name: 'Recap' })).toBeVisible();
  await expect(wound).toContainText('Wound 1: Location: Lower Body, Posterior');
  await expect(wound).toContainText('Measurements, Length: 3.5 cm');
  await expectAccessible(page, 'visit page, a corrected answer');
});

test('a role that reads no Medical notes sees a visit without them, and without its assessment', async ({
  page,
}) => {
  await signIn(page, 'chw@example.com');
  await page.goto(`/encounters/${visit(1)}`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: 'Social needs' })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main).not.toContainText('Red flags');
  await expect(main.getByRole('heading', { name: 'Assessment' })).toHaveCount(0);
  await expect(main).not.toContainText('sugars steady');

  // Every note of the wound visit is Medical: none to show.
  await page.goto(`/encounters/${WOUND}`);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText('No notes to show.');
  await expectAccessible(page, 'visit page, no notes to show');

  // A visit the team does not have is not found.
  await page.goto(`/encounters/${randomUUID()}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await page.goto('/encounters/not-a-visit');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('@responsive the timeline lists a chart’s visits and referrals, and Show earlier visits brings the next ones with focus on the first', async ({
  page,
}) => {
  const phone = await phoneOf('clinician@example.com');
  const family = newSurname();
  const chart = newPatient({ preferredName: `Wren ${family}` }, 600);
  // 52 visits, oldest first: a full first page of 50, and two earlier.
  const visits: PhoneChange[] = Array.from({ length: 52 }, (_, i) => ({
    entity: 'encounter',
    recordId: randomUUID(),
    op: 'create',
    value: { kind: 'non_medical', patientId: chart.recordId },
    minutesAgo: 500 - i,
  }));
  const newest = visits[51]!.recordId;
  const atVisit = randomUUID();
  const wrong = randomUUID();
  await phone.send(
    chart,
    ...visits,
    {
      entity: 'encounter_note',
      recordId: randomUUID(),
      op: 'create',
      value: {
        encounterId: newest,
        noteTypeKey: 'outreach',
        noteTypeVersion: 1,
        data: { 'outreach.type': 'wellness_check' },
      },
      minutesAgo: 440,
    },
    {
      entity: 'referral',
      recordId: atVisit,
      op: 'create',
      value: {
        patientId: chart.recordId,
        referredOn: '2026-10-02',
        details: `Demo: dental van for ${family}`,
        encounterId: newest,
      },
      minutesAgo: 430,
    },
    {
      entity: 'referral',
      recordId: wrong,
      op: 'create',
      value: {
        patientId: chart.recordId,
        referredOn: '2026-10-01',
        details: 'Demo: food bank',
        encounterId: null,
      },
      minutesAgo: 420,
    },
    {
      entity: 'referral',
      recordId: wrong,
      op: 'set',
      field: 'enteredInError',
      value: { reason: 'Demo: meant for someone else' },
      baseVersion: 1,
      minutesAgo: 410,
    },
  );

  await signIn(page, 'clinician@example.com');
  await page.goto(`/patients/${chart.recordId}`);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const visitLinks = timeline.getByRole('link', { name: /^Visit on / });
  const visitRows = timeline.locator('ol > li');
  await expect(visitLinks).toHaveCount(50);
  await expect(visitRows.first()).toContainText('Outreach: Draft');
  await expect(visitRows.nth(1)).toContainText('No notes to show');

  const referrals = timeline.getByRole('list').last().getByRole('listitem');
  await expect(referrals).toHaveCount(2);
  await expect(referrals.first()).toContainText(`Oct 2, 2026: Demo: dental van for ${family}`);
  await expect(referrals.first()).toContainText('Recorded by Jordan Lee (demo)');
  const atLink = referrals.first().getByRole('link', { name: /^At the visit on / });
  await expect(atLink).toHaveAttribute('href', `/encounters/${newest}`);
  await expect(referrals.nth(1).locator('del')).toHaveText('Oct 1, 2026: Demo: food bank');
  await expect(referrals.nth(1)).toContainText('Entered in error: Demo: meant for someone else');
  await expectAccessible(page, 'patient page, timeline');

  const chartReads = await audited('clinician@example.com', chart.recordId, 'patient.viewed');
  const pages = await audited('clinician@example.com', chart.recordId, 'chart.timeline_viewed');
  await timeline.getByRole('button', { name: 'Show earlier visits' }).click();
  await expect(visitLinks).toHaveCount(52);
  // Focus moves to the first visit the page added, and there is nothing earlier to show.
  await expect(visitLinks.nth(50)).toBeFocused();
  await expect(visitLinks.nth(50)).toHaveAttribute('href', `/encounters/${visits[1]!.recordId}`);
  await expect(timeline.getByRole('status')).toHaveText('2 earlier visits shown.');
  await expect(timeline.getByRole('button', { name: 'Show earlier visits' })).toHaveCount(0);
  // The next page is logged by the API once, and the chart is not read again.
  expect(await audited('clinician@example.com', chart.recordId, 'chart.timeline_viewed')).toBe(pages + 1);
  expect(await audited('clinician@example.com', chart.recordId, 'patient.viewed')).toBe(chartReads);
  await expectAccessible(page, 'timeline, earlier visits', { inPlace: true });
  await expectReflow(page, 'timeline');

  await atLink.click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${newest}$`));
  await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
    new RegExp(`^Wren ${family} · Non-Medical · `),
  );
  await expect(page.getByRole('article', { name: 'Outreach' })).toContainText('Draft');
  const records = page.getByRole('region', { name: 'Recorded at this visit' });
  await expect(records.getByRole('listitem')).toHaveCount(1);
  await expect(records).toContainText(`Referral, Oct 2, 2026: Demo: dental van for ${family}`);
  await expect(records.getByRole('link', { name: /^Open the chart/ })).toHaveAttribute(
    'href',
    `/patients/${chart.recordId}`,
  );
  await expectAccessible(page, 'visit page, a record made at it');
});
