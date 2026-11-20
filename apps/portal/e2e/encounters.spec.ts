import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { Schemas } from '@sineobex/contract';
import {
  apiCall,
  customRole,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  IDP,
  MFA_CODE,
  portalNav,
  setRole,
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
const OUTREACH = visit(2); // Pepe's Non-Medical outreach visit: no Red flags note
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
    expect(address).toMatch(
      /\/(patients|encounters)\/[0-9a-f-]{36}(\?(handoff|assign)=[a-z_]+(&note=[0-9a-f-]{36})?)?(#assign-[0-9a-f-]{36})?$|\/team\/incomplete-notes$|\/(home|sign-in.*|reauth.*)$/,
    );
}

/** The text a PDF draws: pdf-lib writes each page as a Flate stream, each string in hex. */
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g))
      out.push(Buffer.from(t[1]!, 'hex').toString('latin1'));
  }
  return out.join(' ');
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
  // EMS was not activated: nothing to export. Nothing on the page changes the visit.
  await expect(page.getByRole('region', { name: 'EMS handoff' })).toHaveCount(0);
  await expect(main.getByRole('button')).toHaveCount(0);
  await expect(main.locator('form')).toHaveCount(0);

  await expectAccessible(page, 'visit page');
  await expectReflow(page, 'visit page');
  await expectNothingStored(page, 'visit page');
  expectOnlyIds(traffic.addresses);
  expect(csp).toEqual([]);
});

test('opening a chart logs no visit or note read, and following a visit’s link reads that visit once', async ({
  page,
}) => {
  // The chart carries its timeline only: titles and states, nothing of a note's content. The earlier
  // build's chart read logged three visits' notes the page never showed.
  await signIn(page, 'clinician@example.com');
  const count = (action: string) => audited('clinician@example.com', MARCUS, action);
  const [charts, visits, notes] = [
    await count('patient.viewed'),
    await count('encounter.viewed'),
    await count('note.viewed'),
  ];
  await page.goto(`/patients/${MARCUS}`);
  const link = page
    .getByRole('region', { name: 'Timeline' })
    .getByRole('link', { name: 'Visit on Oct 20, 2026, 12:00 PM' });
  await expect(link).toBeVisible();
  expect(await count('patient.viewed')).toBeGreaterThan(charts);
  expect(await count('encounter.viewed')).toBe(visits);
  expect(await count('note.viewed')).toBe(notes);

  await link.click();
  await expect(page.getByRole('article', { name: 'Social needs' })).toBeVisible();
  expect(await count('encounter.viewed')).toBe(visits + 1);
  expect(await count('note.viewed')).toBeGreaterThan(notes);
});

test('@responsive every state the visit page comes back with is a status, accessible in every theme', async ({
  page,
}) => {
  // Each act and each refusal loads the visit again with what to say (lifecycle 9.11, 9.12).
  // Thirteen states, each read in three themes.
  test.slow();
  await signIn(page, 'clinician@example.com');
  for (const [query, text] of [
    ['signed=cosigned', 'Co-signed. Your co-signature is on each note below.'],
    ['signed=attested', 'Attested. Your attestation is on each note below.'],
    ['signed=changed', 'This visit changed. Read it again.'],
    ['signed=cannot_sign', 'Your credential can’t co-sign notes now.'],
    ['signed=cannot_attest', 'Your credential can’t attest notes now.'],
    [
      'assign=done',
      'Assigned. The note names who acts as its author now, and they can finish or correct it.',
    ],
    ['assign=reauthed', 'You confirmed it’s you. Assign the note again.'],
    ['assign=author_active', 'Someone on the team acts as this note’s author now, so it can’t be assigned.'],
    ['assign=changed', 'Who may take this note changed. Choose again from the list.'],
    ['handoff=reauthed', 'You confirmed it’s you. Export the handoff again.'],
    ['handoff=no_handoff', 'This visit has no EMS handoff: EMS was not activated in it.'],
    [
      'handoff=cannot_see_red_flags',
      'Only someone who may read the visit’s Red flags note may export its handoff.',
    ],
    ['handoff=failed', 'The handoff couldn’t be exported. Try again.'],
  ] as const) {
    await page.goto(`/encounters/${visit(1)}?${query}`);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(text);
    await expectAccessible(page, `visit page, ?${query}`);
    await expectReflow(page, `visit page, ?${query}`);
  }
  // A state the page doesn't know says nothing.
  await page.goto(`/encounters/${visit(1)}?signed=done`);
  await expect(page.getByRole('main').getByRole('status')).toHaveCount(0);
});

test('@responsive a corrected measurement shows the new value, and the old one struck through and read as replaced', async ({
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
  // It sits in its entry's column with no margin of its own: no gap opens around it.
  await expect(wound.getByRole('heading', { level: 4 })).toHaveCSS('margin-top', '0px');
  await expect(wound.getByRole('heading', { level: 4 })).toHaveCSS('margin-bottom', '0px');
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

test('@responsive long typed text wraps at 320 px: a recap answer, the assessment, the visit’s and a note’s addenda, and a referral', async ({
  page,
}) => {
  // Review finding PAX-2: the recap was the one block of typed text that never wrapped.
  const phone = await phoneOf('clinician@example.com');
  const chart = newPatient({ preferredName: `Ash ${newSurname()}` }, 300);
  const id = randomUUID();
  const note = randomUUID();
  const url = 'https://demo.example.org/eastern-market/shed-hours?day=tuesday&slot=morning';
  const token = `Demo:${'x'.repeat(140)}`;
  await phone.send(
    chart,
    {
      entity: 'encounter',
      recordId: id,
      op: 'create',
      value: { kind: 'medical', patientId: chart.recordId, locationText: `Demo: by ${url}` },
      minutesAgo: 90,
    },
    {
      entity: 'encounter_note',
      recordId: note,
      op: 'create',
      value: {
        encounterId: id,
        noteTypeKey: 'quick_encounter',
        noteTypeVersion: 1,
        data: { 'visit.parts': ['general'], 'general.concern': `Demo: shelter intake at ${url}` },
      },
      minutesAgo: 89,
    },
    { entity: 'encounter', recordId: id, op: 'set', field: 'summary', value: token, minutesAgo: 80 },
    {
      entity: 'note_addendum',
      recordId: randomUUID(),
      op: 'create',
      value: { encounterId: id, noteId: null, text: `Demo: about the visit ${token}`, signoffId: null },
      minutesAgo: 70,
    },
    {
      entity: 'note_addendum',
      recordId: randomUUID(),
      op: 'create',
      value: { encounterId: id, noteId: note, text: `Demo: about the note ${token}`, signoffId: null },
      minutesAgo: 69,
    },
    {
      entity: 'referral',
      recordId: randomUUID(),
      op: 'create',
      value: { patientId: chart.recordId, referredOn: '2026-10-02', details: token, encounterId: id },
      minutesAgo: 60,
    },
  );

  await signIn(page, 'clinician@example.com');
  await page.goto(`/encounters/${id}`);
  const quick = page.getByRole('article', { name: 'Quick encounter' });
  await expect(quick.getByRole('heading', { name: 'Recap' })).toBeVisible();
  await expect(quick).toContainText(url);
  const about = page.getByRole('region', { name: 'About the visit' });
  await expect(about.getByRole('heading', { name: 'Addenda to the visit' })).toBeVisible();
  await expect(about).toContainText(`Demo: about the visit ${token}`);
  await expect(quick).toContainText(`Demo: about the note ${token}`);
  await expect(page.getByRole('region', { name: 'Recorded at this visit' })).toContainText(token);
  await expectAccessible(page, 'visit page, long typed text');
  await expectReflow(page, 'visit page, long typed text');
});

test('@responsive the records made at a visit: one on another chart since the visit moved, one entered in error, as the API says', async ({
  page,
}) => {
  // PAX-6: neither state was drawn by any spec. Which chart a record is on is the API's answer
  // (recordsOnAnotherChart), not a comparison of IDs on the page.
  const phone = await phoneOf('clinician@example.com');
  const first = newPatient({ preferredName: `Bay ${newSurname()}` }, 300);
  const now = newPatient({ preferredName: `Elm ${newSurname()}` }, 300);
  const id = randomUUID();
  const [left, kept, wrong] = [randomUUID(), randomUUID(), randomUUID()];
  const referral = (recordId: string, patientId: string, details: string, minutesAgo: number) => ({
    entity: 'referral',
    recordId,
    op: 'create' as const,
    value: { patientId, referredOn: '2026-10-02', details, encounterId: id },
    minutesAgo,
  });
  await phone.send(
    first,
    now,
    {
      entity: 'encounter',
      recordId: id,
      op: 'create',
      value: { kind: 'non_medical', patientId: first.recordId },
      minutesAgo: 90,
    },
    referral(left, first.recordId, 'Demo: dental van', 80),
    // The visit was for someone else: it moves, and its referral stays with the first chart (12.1 #25).
    {
      entity: 'encounter',
      recordId: id,
      op: 'set',
      field: 'patientId',
      value: now.recordId,
      baseVersion: 1,
      minutesAgo: 70,
    },
    referral(kept, now.recordId, 'Demo: food bank', 60),
    referral(wrong, now.recordId, 'Demo: shelter beds', 50),
    {
      entity: 'referral',
      recordId: wrong,
      op: 'set',
      field: 'enteredInError',
      value: { reason: 'Demo: meant for someone else' },
      baseVersion: 1,
      minutesAgo: 40,
    },
  );

  await signIn(page, 'clinician@example.com');
  await page.goto(`/encounters/${id}`);
  const rows = page.getByRole('region', { name: 'Recorded at this visit' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  const moved = rows.filter({ hasText: 'Demo: dental van' });
  await expect(moved).toContainText('On another chart now');
  await expect(moved.getByRole('link', { name: /^Open that chart/ })).toHaveAttribute(
    'href',
    `/patients/${first.recordId}`,
  );
  const here = rows.filter({ hasText: 'Demo: food bank' });
  await expect(here).not.toContainText('On another chart now');
  await expect(here.getByRole('link', { name: /^Open the chart/ })).toHaveAttribute(
    'href',
    `/patients/${now.recordId}`,
  );
  const struck = rows.filter({ hasText: 'Demo: shelter beds' });
  await expect(struck.locator('del')).toHaveText('Referral, Oct 2, 2026: Demo: shelter beds');
  await expect(struck).toContainText('Entered in error');
  await expect(struck).not.toContainText('On another chart now');
  await expectAccessible(page, 'visit page, records on another chart and entered in error');
  await expectReflow(page, 'visit page, records on another chart and entered in error');
});

test('@responsive a visit with no patient says so, and offers no chart', async ({ page }) => {
  // PAX-6: no spec drew it.
  const phone = await phoneOf('clinician@example.com');
  const id = randomUUID();
  await phone.send(
    { entity: 'encounter', recordId: id, op: 'create', value: { kind: 'non_medical' }, minutesAgo: 30 },
    {
      entity: 'encounter_note',
      recordId: randomUUID(),
      op: 'create',
      value: {
        encounterId: id,
        noteTypeKey: 'outreach',
        noteTypeVersion: 1,
        data: { 'outreach.type': 'wellness_check' },
      },
      minutesAgo: 29,
    },
  );
  await signIn(page, 'clinician@example.com');
  await page.goto(`/encounters/${id}`);
  await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
    /^No patient recorded · Non-Medical · /,
  );
  const about = page.getByRole('region', { name: 'About the visit' });
  await expect(about.locator('dl > div').filter({ hasText: 'Patient' }).locator('dd')).toHaveText(
    'No patient recorded',
  );
  await expect(page.getByRole('navigation', { name: 'This visit' })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: /chart/ })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Outreach' })).toContainText('Draft');
  await expectAccessible(page, 'visit page, no patient');
  await expectReflow(page, 'visit page, no patient');
});

test('@responsive a role that reads no Medical notes sees a visit without them, and without its assessment', async ({
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
  // Empty, the notice is there for a screen reader and takes no room in the panel.
  await expect(timeline.getByRole('status')).toHaveCSS('position', 'absolute');

  // The connection drops: an alert that takes focus, said again when it drops again (review
  // finding PAX-1).
  const earlier = /\/encounters\/earlier$/;
  await page.route(earlier, (route) => route.abort('internetdisconnected'));
  const show = timeline.getByRole('button', { name: 'Show earlier visits' });
  await show.focus();
  await page.keyboard.press('Enter');
  const alert = timeline.getByRole('alert');
  await expect(alert).toHaveText('Earlier visits couldn’t be loaded. Check the connection and try again.');
  await expect(alert).toBeFocused();
  const first = await alert.elementHandle();
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(alert).toBeFocused();
  expect(await first!.evaluate((e) => e.isConnected)).toBe(false);
  await expectAccessible(page, 'timeline, earlier visits failed', { inPlace: true });
  await page.unroute(earlier);

  await timeline.getByRole('button', { name: 'Show earlier visits' }).click();
  await expect(visitLinks).toHaveCount(52);
  // Focus moves to the first visit the page added, and there is nothing earlier to show.
  await expect(visitLinks.nth(50)).toBeFocused();
  await expect(visitLinks.nth(50)).toHaveAttribute('href', `/encounters/${visits[1]!.recordId}`);
  await expect(timeline.getByRole('status')).toHaveText('2 earlier visits shown.');
  await expect(timeline.getByRole('alert')).toHaveCount(0);
  await expect(timeline.getByRole('status')).toHaveCSS('position', 'static');
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

test('@responsive Show earlier visits on a chart of exactly 50 visits finds none: it says so and moves focus to the Visits heading', async ({
  page,
}) => {
  // PAX-6: a full first page shows the button, and nothing earlier was ever drawn.
  const phone = await phoneOf('clinician@example.com');
  const chart = newPatient({ preferredName: `Fir ${newSurname()}` }, 600);
  const visits: PhoneChange[] = Array.from({ length: 50 }, (_, i) => ({
    entity: 'encounter',
    recordId: randomUUID(),
    op: 'create',
    value: { kind: 'non_medical', patientId: chart.recordId },
    minutesAgo: 500 - i,
  }));
  await phone.send(chart, ...visits);
  await signIn(page, 'clinician@example.com');
  await page.goto(`/patients/${chart.recordId}`);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline.getByRole('link', { name: /^Visit on / })).toHaveCount(50);
  await timeline.getByRole('button', { name: 'Show earlier visits' }).click();
  await expect(timeline.getByRole('status')).toHaveText('No earlier visits.');
  await expect(timeline.getByRole('heading', { name: 'Visits' })).toBeFocused();
  await expect(timeline.getByRole('button', { name: 'Show earlier visits' })).toHaveCount(0);
  await expect(timeline.getByRole('link', { name: /^Visit on / })).toHaveCount(50);
  await expectAccessible(page, 'timeline, no earlier visits', { inPlace: true });
  await expectReflow(page, 'timeline, no earlier visits');
});

test.describe('the EMS handoff', () => {
  // The browser's time zone, which the export sends: the file's times are printed in it.
  test.use({ timezoneId: 'America/Chicago' });

  let emsVisit = '';
  let emsPatient = '';

  test.beforeAll(async () => {
    const phone = await phoneOf('clinician@example.com');
    const chart = newPatient({ preferredName: `Ash ${newSurname()}` }, 60);
    emsVisit = randomUUID();
    emsPatient = chart.recordId;
    await phone.send(
      chart,
      {
        entity: 'encounter',
        recordId: emsVisit,
        op: 'create',
        value: {
          kind: 'medical',
          patientId: chart.recordId,
          locationText: 'Demo: by the made-up river walk',
        },
        minutesAgo: 30,
      },
      {
        entity: 'encounter_note',
        recordId: randomUUID(),
        op: 'create',
        value: {
          encounterId: emsVisit,
          noteTypeKey: 'red_flags_disposition',
          noteTypeVersion: 1,
          data: {
            'red_flags.emergency': 'yes',
            'red_flags.ems_activated': 'yes',
            'red_flags.ems_time': '14:05',
          },
        },
        minutesAgo: 29,
      },
    );
  });

  test('@responsive Export EMS handoff (PDF) asks for a fresh sign-in, sends the browser’s time zone and keeps the file’s name', async ({
    page,
  }) => {
    // Billing/Data reads the Red flags note. Their sign-in is dated back an hour, so the export
    // goes through /reauth first.
    const stale = await fetch(`${IDP}/test/stale-sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'billing@example.com', minutes: 60 }),
    });
    expect(stale.status).toBe(200);
    await signIn(page, 'billing@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto(`/encounters/${emsVisit}`);
    const handoff = page.getByRole('region', { name: 'EMS handoff' });
    const exportButton = handoff.getByRole('button', { name: 'Export EMS handoff (PDF)' });
    await expect(exportButton).toBeVisible();
    await expectAccessible(page, 'visit page with a handoff');

    await exportButton.click();
    await expect(page).toHaveURL(/\/reauth\?next=/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${emsVisit}\\?handoff=reauthed$`));
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'You confirmed it’s you. Export the handoff again.',
    );
    await expectAccessible(page, 'visit page after /reauth');

    const reads = await audited('billing@example.com', emsPatient, 'encounter.viewed');
    const exports = await audited('billing@example.com', emsPatient, 'ems_handoff.exported');
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/ems-handoff'));
    const downloaded = page.waitForEvent('download');
    await exportButton.click();
    const [request, download] = await Promise.all([sent, downloaded]);
    expect(new URLSearchParams(request.postData() ?? '').get('timeZone')).toBe('America/Chicago');
    expect(download.suggestedFilename()).toBe('ems-handoff.pdf');
    const file = readFileSync(await download.path());
    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = pdfText(file);
    expect(text).toContain('EMS handoff');
    expect(text).toContain('America/Chicago');
    expect(text).toContain('Exported by Riley Chen (demo)');

    // The page stays as it was: the export reads the visit for the file, and the page is not read again.
    await expect(page).toHaveURL(new RegExp(`/encounters/${emsVisit}\\?handoff=reauthed$`));
    expect(await audited('billing@example.com', emsPatient, 'ems_handoff.exported')).toBe(exports + 1);
    expect(await audited('billing@example.com', emsPatient, 'encounter.viewed')).toBe(reads);
    expectOnlyIds(traffic.addresses);
    await expectNothingStored(page, 'visit page with a handoff');
    expect(csp).toEqual([]);
  });

  test('@responsive no_handoff and cannot_see_red_flags come back as states of the visit page, and another site can’t export', async ({
    page,
  }) => {
    // The CHW preset reads no Medical note: the page offers no export.
    await signIn(page, 'chw@example.com');
    await page.goto(`/encounters/${emsVisit}`);
    await expect(page.getByRole('region', { name: 'EMS handoff' })).toHaveCount(0);

    // A form sent from a page loaded before something changed comes back as a state, not an error.
    const refused = await page.request.post(`/encounters/${emsVisit}/ems-handoff`, {
      form: { timeZone: 'America/Chicago' },
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(303);
    expect(refused.headers().location).toMatch(
      new RegExp(`/encounters/${emsVisit}\\?handoff=cannot_see_red_flags$`),
    );
    await page.goto(`/encounters/${emsVisit}?handoff=cannot_see_red_flags`);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Only someone who may read the visit’s Red flags note may export its handoff.',
    );
    await expectAccessible(page, 'visit page, cannot_see_red_flags');

    const none = await page.request.post(`/encounters/${OUTREACH}/ems-handoff`, {
      form: { timeZone: 'America/Chicago' },
      maxRedirects: 0,
    });
    expect(none.status()).toBe(303);
    expect(none.headers().location).toMatch(new RegExp(`/encounters/${OUTREACH}\\?handoff=no_handoff$`));
    await page.goto(`/encounters/${OUTREACH}?handoff=no_handoff`);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'This visit has no EMS handoff: EMS was not activated in it.',
    );
    await expectAccessible(page, 'visit page, no_handoff');

    // Only a POST from the portal's own page exports: not another site's form, and not a link.
    const exports = await audited('chw@example.com', emsPatient, 'ems_handoff.exported');
    const elsewhere = await page.request.post(`/encounters/${emsVisit}/ems-handoff`, {
      form: { timeZone: 'America/Chicago' },
      headers: { origin: 'https://elsewhere.example.com' },
      maxRedirects: 0,
    });
    expect(elsewhere.status()).toBe(403);
    expect(
      (await page.request.get(`/encounters/${emsVisit}/ems-handoff`, { maxRedirects: 0 })).status(),
    ).toBe(405);
    expect(await audited('chw@example.com', emsPatient, 'ems_handoff.exported')).toBe(exports);
  });
});

test.describe('notes not complete, and Assign', () => {
  /** The team's members, as the members page lists them. */
  async function members(): Promise<Schemas['Member'][]> {
    const res = await apiCall(await staffToken('admin@example.com'), 'GET', '/v1/team/members');
    expect(res.status).toBe(200);
    return (await res.json()) as Schemas['Member'][];
  }

  /**
   * Removes a seeded staff member from the team, as the members page does, and gives back what puts
   * them back as they were: specs share the database.
   */
  async function removeForAWhile(email: string): Promise<() => Promise<void>> {
    const member = (await members()).find((m) => m.email === email)!;
    const removed = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      `/v1/team/members/${member.membershipId}/remove`,
      { reason: 'Demo: away from the team for a while' },
    );
    expect(removed.status, 'removed').toBeLessThan(300);
    return async () => {
      const back = await apiCall(await staffToken('admin@example.com'), 'POST', '/v1/team/members', {
        email: member.email,
        displayName: member.displayName,
        roleId: member.role.id,
        credential: member.credential,
        credentialFields: member.credentialFields,
      });
      expect(back.status, 'restored').toBeLessThan(300);
    };
  }

  async function countsOf(email: string): Promise<Schemas['HomeCounts']> {
    return (await (
      await apiCall(await staffToken(email), 'GET', '/v1/me/counts')
    ).json()) as Schemas['HomeCounts'];
  }

  test('@responsive Notes not complete lists every draft by the API’s titles and names, marks one older than a day, and Home counts them as the list does', async ({
    page,
  }) => {
    const phone = await phoneOf('clinician@example.com');
    const name = `Fern ${newSurname()}`;
    const chart = newPatient({ preferredName: name }, 3000);
    const [old, fresh] = [randomUUID(), randomUUID()];
    const [oldNote, freshNote] = [randomUUID(), randomUUID()];
    const outreach = (encounterId: string, recordId: string, minutesAgo: number) => ({
      entity: 'encounter_note',
      recordId,
      op: 'create' as const,
      value: {
        encounterId,
        noteTypeKey: 'outreach',
        noteTypeVersion: 1,
        data: { 'outreach.type': 'wellness_check' },
      },
      minutesAgo,
    });
    await phone.send(
      chart,
      // Two days ago: past the 24 hours of lifecycle 3.9.
      {
        entity: 'encounter',
        recordId: old,
        op: 'create',
        value: { kind: 'non_medical', patientId: chart.recordId },
        minutesAgo: 2900,
      },
      outreach(old, oldNote, 2899),
      {
        entity: 'encounter',
        recordId: fresh,
        op: 'create',
        value: { kind: 'non_medical', patientId: chart.recordId },
        minutesAgo: 20,
      },
      outreach(fresh, freshNote, 19),
    );

    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    const counts = await countsOf('admin@example.com');
    const list = (await (
      await apiCall(await staffToken('admin@example.com'), 'GET', '/v1/team/incomplete-notes')
    ).json()) as Schemas['IncompleteNotes'];
    // The count is the list's, overdue and all.
    expect(counts.teamIncomplete).toBe(list.notes.length);
    expect(counts.teamOverdue).toBe(list.notes.filter((n) => n.overdue).length);
    const n = counts.teamIncomplete!;
    const o = counts.teamOverdue!;
    const card = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Notes not complete' });
    await expect(card.locator('p')).toHaveText(
      `${n} ${n === 1 ? 'note' : 'notes'} not complete.${o > 0 ? ` ${o} ${o === 1 ? 'is' : 'are'} older than a day.` : ''}`,
    );

    await card.getByRole('link', { name: 'Notes not complete' }).click();
    await expect(page).toHaveURL(/\/team\/incomplete-notes$/);
    await expect(page).toHaveTitle('Notes not complete · Sineobex');
    await expect(page.getByRole('table')).toContainText(`Draft notes, oldest visit first: ${n} `);
    const rows = page.getByRole('row').filter({ hasText: name });
    await expect(rows).toHaveCount(2);
    // Oldest visit first.
    const [older, newer] = [rows.first(), rows.last()];
    await expect(older.getByRole('rowheader')).toHaveText('Outreach');
    await expect(older).toContainText('Jordan Lee (demo)');
    await expect(older).toContainText('Older than a day');
    await expect(newer).not.toContainText('Older than a day');
    await expect(older).not.toContainText('No longer on the team');
    await expect(older.getByRole('link', { name: /^Open the visit/ })).toHaveAttribute(
      'href',
      `/encounters/${old}`,
    );
    await expect(older.getByRole('link', { name: /^Open the chart/ })).toHaveAttribute(
      'href',
      `/patients/${chart.recordId}`,
    );
    // Its author is on the team: nothing to assign.
    await expect(older.getByRole('link', { name: /^Assign/ })).toHaveCount(0);
    await expectAccessible(page, 'notes not complete');
    await expectReflow(page, 'notes not complete');
    await expectNothingStored(page, 'notes not complete');
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('@responsive a note whose author left says so and has Assign: the picker lists exactly who the API answers, the act asks for a fresh sign-in, and the assignee is never told they wrote it', async ({
    page,
  }) => {
    test.slow();
    // Casey charts a Medical visit: a Red flags note completed for a co-signer, and an Outreach draft.
    const phone = await phoneOf('resident@example.com');
    const name = `Moss ${newSurname()}`;
    const chart = newPatient({ preferredName: name }, 60);
    const visitId = randomUUID();
    const [flags, draft] = [randomUUID(), randomUUID()];
    await phone.send(
      chart,
      {
        entity: 'encounter',
        recordId: visitId,
        op: 'create',
        value: { kind: 'medical', patientId: chart.recordId },
        minutesAgo: 50,
      },
      {
        entity: 'encounter_note',
        recordId: flags,
        op: 'create',
        value: {
          encounterId: visitId,
          noteTypeKey: 'red_flags_disposition',
          noteTypeVersion: 1,
          data: {
            'red_flags.emergency': 'no',
            'disposition.disposition': ['follow_up'],
            'follow_up.when': 'prn',
          },
        },
        minutesAgo: 49,
      },
      {
        entity: 'encounter_note',
        recordId: draft,
        op: 'create',
        value: {
          encounterId: visitId,
          noteTypeKey: 'outreach',
          noteTypeVersion: 1,
          data: { 'outreach.type': 'wellness_check' },
        },
        minutesAgo: 48,
      },
    );
    const read = (await (
      await apiCall(phone.token, 'GET', `/v1/encounters/${visitId}`)
    ).json()) as Schemas['VisitRead'];
    await phone.send({
      entity: 'note_signoff',
      recordId: randomUUID(),
      op: 'create',
      value: {
        noteId: flags,
        act: 'complete',
        contentHash: read.notes.find((x) => x.noteId === flags)!.contentHash,
        claimedCredential: null,
        statementVersion: 'complete-2026-11',
      },
      minutesAgo: 40,
    });

    const putBack = await removeForAWhile('resident@example.com');
    try {
      // Alex's sign-in is dated back an hour, so the assignment goes through /reauth first.
      const stale = await fetch(`${IDP}/test/stale-sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', minutes: 60 }),
      });
      expect(stale.status).toBe(200);
      await signIn(page, 'admin@example.com');
      const csp = watchCsp(page);
      const traffic = watchTraffic(page);

      await portalNav(page).getByRole('link', { name: 'Notes not complete' }).click();
      const row = page.getByRole('row').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Casey Nguyen (demo)No longer on the team');
      const assign = row.getByRole('link', { name: /^Assign/ });
      await expect(assign).toHaveAttribute('href', `/encounters/${visitId}#assign-${draft}`);
      await expectAccessible(page, 'notes not complete, an author who left');
      await assign.click();
      await expect(page).toHaveURL(new RegExp(`/encounters/${visitId}#assign-${draft}$`));

      // The picker is the assignees route's answer, exactly: Sam, whose credential is lower than
      // Casey's, is not in it.
      const assignees = (await (
        await apiCall(await staffToken('admin@example.com'), 'GET', `/v1/notes/${draft}/assignees`)
      ).json()) as Schemas['NoteAssignees'];
      const form = page.getByRole('article', { name: 'Outreach' }).locator(`#assign-${draft}`);
      const picker = form.getByLabel('Assign to');
      const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(picker.locator('option')).toHaveText([
        'Choose a clinician',
        // Each person, with their credential in words when they hold one.
        ...assignees.assignees.map(
          (a) => new RegExp(`^${escape(a.displayName)}${a.credential === 'none' ? '' : ', .+'}$`),
        ),
      ]);
      expect(assignees.assignees.map((a) => a.displayName)).toContain('Jordan Lee (demo)');
      expect(assignees.assignees.map((a) => a.displayName)).not.toContain('Sam Okafor (demo)');
      // The Red flags note's author left too: it has its own form.
      await expect(
        page
          .getByRole('article', { name: 'Red flags and disposition' })
          .getByRole('button', { name: 'Assign' }),
      ).toBeVisible();
      await expectAccessible(page, 'visit page with Assign');
      await expectReflow(page, 'visit page with Assign');

      // Nothing chosen: a summary that takes focus and links to each field.
      await form.getByRole('button', { name: 'Assign' }).click();
      const alert = form.getByRole('alert');
      await expect(alert).toBeFocused();
      await expect(
        alert.getByRole('link', { name: 'Choose who will act as the note’s author.' }),
      ).toBeVisible();
      await expect(
        alert.getByRole('link', { name: 'Give a reason of at least 3 characters.' }),
      ).toBeVisible();
      await expectAccessible(page, 'Assign, with problems', { inPlace: true });

      const fill = async () => {
        const f = page.getByRole('article', { name: 'Outreach' });
        await f.getByLabel('Assign to').selectOption({ label: 'Jordan Lee (demo), Attending physician' });
        await f.getByLabel('Reason').fill('Demo: Casey is away from the team');
        await f.getByRole('button', { name: 'Assign' }).click();
      };
      await fill();
      await expect(page).toHaveURL(/\/reauth\?next=/);
      await page.getByLabel('6-digit code').fill(MFA_CODE);
      await page.getByRole('button', { name: 'Continue' }).click();
      // Back at the note's own form, which says so and takes focus (review finding PAX-3): this
      // visit has two notes to assign.
      await expect(page).toHaveURL(
        new RegExp(`/encounters/${visitId}\\?assign=reauthed&note=${draft}#assign-${draft}$`),
      );
      await expect(form).toBeFocused();
      await expect(form.getByRole('status')).toHaveText('You confirmed it’s you. Assign the note again.');
      await expect(page.getByRole('main').getByRole('status')).toHaveCount(1);
      await expectAccessible(page, 'visit page, Assign again after a fresh sign-in', { inPlace: true });
      // The visit is slow to load again after the act: the button stays off while it loads, and a
      // second press goes nowhere (review finding PAC-1).
      const held = /\?assign=done$/;
      await page.route(held, async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue().catch(() => undefined);
      });
      const outreach = page.getByRole('article', { name: 'Outreach' });
      await outreach
        .getByLabel('Assign to')
        .selectOption({ label: 'Jordan Lee (demo), Attending physician' });
      await outreach.getByLabel('Reason').fill('Demo: Casey is away from the team');
      // Watched in the page itself: a locator waits for the load the answer started.
      const seen = await outreach.getByRole('button', { name: 'Assign' }).evaluate(async (button) => {
        const b = button as HTMLButtonElement;
        const pause = () => new Promise((r) => setTimeout(r, 10));
        const start = performance.now();
        b.click();
        while (!b.disabled && performance.now() - start < 2000) await pause();
        while (b.disabled && performance.now() - start < 2500) await pause();
        const state = { enabled: !b.disabled, text: b.textContent };
        b.click();
        return state;
      });
      expect(seen).toEqual({ enabled: false, text: 'Working…' });
      await expect(page).toHaveURL(new RegExp(`/encounters/${visitId}\\?assign=done$`));
      await page.unroute(held);
      await expect(page.getByRole('main').getByRole('status')).toHaveText(
        'Assigned. The note names who acts as its author now, and they can finish or correct it.',
      );
      await expect(page.getByRole('article', { name: 'Outreach' })).toContainText(
        'Written by Casey Nguyen (demo). Assigned to Jordan Lee (demo), who acts as its author now.',
      );
      // Its author acts on the team now: the API lists no one, and nothing of Assign is shown.
      await expect(
        page.getByRole('article', { name: 'Outreach' }).getByRole('heading', { name: 'Assign this note' }),
      ).toHaveCount(0);

      // The Red flags note, waiting for a co-signer, to Jordan too.
      const flagsForm = page.getByRole('article', { name: 'Red flags and disposition' });
      await flagsForm
        .getByLabel('Assign to')
        .selectOption({ label: 'Jordan Lee (demo), Attending physician' });
      await flagsForm.getByLabel('Reason').fill('Demo: Casey is away from the team');
      await flagsForm.getByRole('button', { name: 'Assign' }).click();
      await expect(page).toHaveURL(new RegExp(`/encounters/${visitId}\\?assign=done$`));
      await expect(page.getByRole('main').getByRole('heading', { name: 'Assign this note' })).toHaveCount(0);
      await expectAccessible(page, 'visit page after Assign');
      expect(await audited('admin@example.com', chart.recordId, 'note.assigned')).toBe(2);
      expectOnlyIds(traffic.addresses);
      expect(csp).toEqual([]);

      // Jordan acts as the author of a note Casey wrote: told so, never that they wrote it, and
      // offered no Co-sign.
      await signIn(page, 'clinician@example.com');
      await page.goto(`/encounters/${visitId}`);
      const note = page.getByRole('article', { name: 'Red flags and disposition' });
      await expect(note).toContainText('This note was assigned to you, so someone else has to co-sign it.');
      await expect(note).not.toContainText('You wrote');
      await expect(page.getByRole('region', { name: 'Co-sign' })).toHaveCount(0);
    } finally {
      await putBack();
    }
  });

  test('@responsive Assign refused: someone chosen who may no longer take the note, or an author back on the team, loads the visit again saying so', async ({
    page,
  }) => {
    test.slow();
    const phone = await phoneOf('resident@example.com');
    const name = `Sage ${newSurname()}`;
    const chart = newPatient({ preferredName: name }, 60);
    const visitId = randomUUID();
    const noteId = randomUUID();
    await phone.send(
      chart,
      {
        entity: 'encounter',
        recordId: visitId,
        op: 'create',
        value: { kind: 'medical', patientId: chart.recordId },
        minutesAgo: 50,
      },
      {
        entity: 'encounter_note',
        recordId: noteId,
        op: 'create',
        value: {
          encounterId: visitId,
          noteTypeKey: 'outreach',
          noteTypeVersion: 1,
          data: { 'outreach.type': 'wellness_check' },
        },
        minutesAgo: 49,
      },
    );

    let putBack: (() => Promise<void>) | null = await removeForAWhile('resident@example.com');
    try {
      await signIn(page, 'admin@example.com');
      await page.goto(`/encounters/${visitId}`);
      const note = page.getByRole('article', { name: 'Outreach' });
      const jordan = 'Jordan Lee (demo), Attending physician';
      const choose = async () => {
        await note.getByLabel('Assign to').selectOption({ label: jordan });
        await note.getByLabel('Reason').fill('Demo: Casey is away from the team');
      };

      // The connection drops on the press: the page can't tell whether the note was assigned, so it
      // says so and offers the visit again, not a second press (review finding PAC-4).
      const assignRoute = /\/encounters\/[0-9a-f-]{36}\/assign$/;
      await page.route(assignRoute, (route) => route.abort('internetdisconnected'));
      await choose();
      await note.getByRole('button', { name: 'Assign' }).click();
      const dropped = note.getByRole('alert');
      await expect(dropped).toHaveText(
        'The connection dropped, so we can’t tell whether the note was assigned. Read the visit again to see.',
      );
      await expect(dropped).toBeFocused();
      await expect(note.getByRole('button', { name: 'Assign' })).toHaveCount(0);
      await expectAccessible(page, 'Assign, the connection dropped', { inPlace: true });
      await page.unroute(assignRoute);
      await note.getByRole('button', { name: 'Read the visit again' }).click();
      await expect(page).toHaveURL(new RegExp(`/encounters/${visitId}$`));
      await expect(note.getByRole('alert')).toHaveCount(0);

      // Jordan moves to a role that doesn't chart after the picker was loaded.
      await choose();
      await setRole('clinician@example.com', 'billing_data');
      try {
        await note.getByRole('button', { name: 'Assign' }).click();
        // At the note's own form, which says so and takes focus (review finding PAX-3).
        await expect(page).toHaveURL(
          new RegExp(`/encounters/${visitId}\\?assign=changed&note=${noteId}#assign-${noteId}$`),
        );
        await expect(note.locator(`#assign-${noteId}`)).toBeFocused();
        await expect(note.getByRole('status')).toHaveText(
          'Who may take this note changed. Choose again from the list.',
        );
        await expect(page.getByRole('main').getByRole('status')).toHaveCount(1);
        // The picker, loaded again, lists who may take the note now.
        await expect(note.getByRole('heading', { name: 'Assign this note' })).toBeVisible();
        expect(await note.locator('option').allTextContents()).not.toContain(jordan);
        await expectAccessible(page, 'visit page, assign changed');
      } finally {
        await setRole('clinician@example.com', 'healthcare_staff');
      }

      // Casey is back on the team before the form is sent.
      await page.goto(`/encounters/${visitId}`);
      await choose();
      await putBack();
      putBack = null;
      await note.getByRole('button', { name: 'Assign' }).click();
      await expect(page).toHaveURL(new RegExp(`/encounters/${visitId}\\?assign=author_active$`));
      await expect(page.getByRole('main').getByRole('status')).toHaveText(
        'Someone on the team acts as this note’s author now, so it can’t be assigned.',
      );
      await expect(page.getByRole('main').getByRole('heading', { name: 'Assign this note' })).toHaveCount(0);
      await expect(note).toContainText('Written by Casey Nguyen (demo).');
      await expect(note).not.toContainText('Assigned to');
      await expectAccessible(page, 'visit page, author_active');
      expect(await audited('admin@example.com', chart.recordId, 'note.assigned')).toBe(0);
    } finally {
      if (putBack) await putBack();
    }
  });

  test('@responsive two drafts of one type by one author at one visit are told apart, in their rows and in their links’ names', async ({
    page,
  }) => {
    // Review finding PAX-5: both rows said "Outreach", and both links "Assign: Outreach, Ivy …".
    const phone = await phoneOf('resident@example.com');
    const ivy = `Ivy ${newSurname()}`;
    const chart = newPatient({ preferredName: ivy }, 60);
    const visitId = randomUUID();
    const [draft, second] = [randomUUID(), randomUUID()];
    const outreach = (recordId: string, minutesAgo: number) => ({
      entity: 'encounter_note',
      recordId,
      op: 'create' as const,
      value: {
        encounterId: visitId,
        noteTypeKey: 'outreach',
        noteTypeVersion: 1,
        data: { 'outreach.type': 'wellness_check' },
      },
      minutesAgo,
    });
    await phone.send(
      chart,
      {
        entity: 'encounter',
        recordId: visitId,
        op: 'create',
        value: { kind: 'non_medical', patientId: chart.recordId },
        minutesAgo: 50,
      },
      outreach(draft, 48),
      outreach(second, 47),
    );
    const putBack = await removeForAWhile('resident@example.com');
    try {
      await signIn(page, 'admin@example.com');
      await page.goto('/team/incomplete-notes');
      const rows = page.getByRole('row').filter({ hasText: ivy });
      await expect(rows).toHaveCount(2);
      await expect(rows.getByRole('rowheader')).toHaveText(['Outreach (1 of 2)', 'Outreach (2 of 2)']);
      const names = await rows
        .getByRole('link', { name: /^Assign/ })
        .evaluateAll((links) => links.map((a) => a.textContent ?? ''));
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
      expect(names[0]).toMatch(
        new RegExp(`^Assign: Outreach \\(1 of 2\\) by Casey Nguyen \\(demo\\), ${ivy}, visit on `),
      );
      expect(names[1]).toMatch(
        new RegExp(`^Assign: Outreach \\(2 of 2\\) by Casey Nguyen \\(demo\\), ${ivy}, visit on `),
      );
      await expect(rows.first().getByRole('link', { name: /^Assign/ })).toHaveAttribute(
        'href',
        `/encounters/${visitId}#assign-${draft}`,
      );
      await expect(rows.last().getByRole('link', { name: /^Assign/ })).toHaveAttribute(
        'href',
        `/encounters/${visitId}#assign-${second}`,
      );
      await expectAccessible(page, 'notes not complete, two drafts of one type');
      await expectReflow(page, 'notes not complete, two drafts of one type');
    } finally {
      await putBack();
    }
  });

  test('@responsive a role with team.manage_users and no patients.view lists the team’s drafts with no patient named, no visit or chart link and no Assign, and can’t open a visit', async ({
    page,
  }) => {
    // A draft of its own, so the list has a row whichever tests ran before.
    const phone = await phoneOf('clinician@example.com');
    const chart = newPatient({ preferredName: `Reed ${newSurname()}` }, 30);
    const visitId = randomUUID();
    await phone.send(
      chart,
      {
        entity: 'encounter',
        recordId: visitId,
        op: 'create',
        value: { kind: 'non_medical', patientId: chart.recordId },
        minutesAgo: 20,
      },
      {
        entity: 'encounter_note',
        recordId: randomUUID(),
        op: 'create',
        value: {
          encounterId: visitId,
          noteTypeKey: 'outreach',
          noteTypeVersion: 1,
          data: { 'outreach.type': 'wellness_check' },
        },
        minutesAgo: 19,
      },
    );
    const role = await customRole('Staff desk (demo)', ['team.manage_users']);
    await setRole('billing@example.com', role);
    try {
      await signIn(page, 'billing@example.com');
      await expect(portalNav(page).getByRole('link', { name: 'Patients' })).toHaveCount(0);
      await expect(portalNav(page).getByRole('link', { name: /queue$/ })).toHaveCount(0);
      // Home counts the one list this role opens.
      const cards = page.getByRole('main').getByRole('listitem').getByRole('heading', { level: 2 });
      await expect(cards.filter({ hasText: 'Notes not complete' })).toHaveCount(1);
      await expect(cards.filter({ hasText: /queue$/ })).toHaveCount(0);

      await portalNav(page).getByRole('link', { name: 'Notes not complete' }).click();
      await expect(page).toHaveURL(/\/team\/incomplete-notes$/);
      await expect(page.getByRole('main')).toContainText(
        'Your role doesn’t open patients’ charts, so patients aren’t named here.',
      );
      // Told who can assign a note, not to do what no page lets this role do (review finding PAX-4).
      const help = page.getByRole('main').locator('.sx-help').first();
      await expect(help).toContainText(
        'When a note’s author has left the team, someone whose role opens patients’ charts can assign it to another clinician from its visit.',
      );
      await expect(help).not.toContainText('left the team, assign it');
      await expect(page.getByRole('columnheader')).toHaveText(['Note', 'Author', 'Visit started']);
      await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
      await expectAccessible(page, 'notes not complete, no patients.view');
      await expectReflow(page, 'notes not complete, no patients.view');

      // A visit or a chart typed in goes Home: the API refuses the read and logs the refusal.
      for (const path of [`/encounters/${visit(1)}`, `/patients/${MARCUS}`]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/home\?denied=1$/);
        await expect(page.getByRole('main').getByRole('alert')).toHaveText(
          'Your role doesn’t allow that screen. The attempt was logged.',
        );
      }
      await expectAccessible(page, 'Home, a visit refused');
      // So does an export sent from a page loaded before the role changed.
      const refused = await page.request.post(`/encounters/${visit(1)}/ems-handoff`, {
        form: { timeZone: 'America/Chicago' },
        maxRedirects: 0,
      });
      expect(refused.status()).toBe(303);
      expect(refused.headers().location).toMatch(/\/home\?denied=1$/);
    } finally {
      await setRole('billing@example.com', 'billing_data');
    }
  });
});
