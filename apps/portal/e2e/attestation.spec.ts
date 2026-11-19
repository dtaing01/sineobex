import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import type { Schemas } from '@sineobex/contract';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  portalNav,
  signIn,
  staffToken,
  watchCsp,
  watchTraffic,
} from './helpers';
import { newPatient, newSurname, phoneOf } from './phone-records';

// Phase 4 design, lifecycle 3.5, 3.7, 5.3, 5.4, 9.11 and 9.14: the co-sign and attestation queues,
// and Co-sign and Attest on the visit page, against the real API, with made-up visits Casey (the
// resident) charts on a phone here. Jordan, an attending, co-signs and attests.
test.describe.configure({ mode: 'serial' });

type Answers = Record<string, unknown>;
const RED_FLAGS: Answers = {
  'red_flags.emergency': 'no',
  'disposition.disposition': ['follow_up'],
  'follow_up.when': 'prn',
};
const RED_FLAGS_EMS: Answers = {
  'red_flags.emergency': 'yes',
  'red_flags.ems_activated': 'yes',
  'red_flags.ems_time': '14:05',
  'disposition.disposition': ['ems'],
};
const QUICK: Answers = { 'visit.parts': ['general'], 'general.concern': 'Demo: a cough for a week' };
const SOCIAL: Answers = { 'needs.needs': ['food'], 'needs.housing': 'unsheltered' };
const MEDICAL = new Set(['red_flags_disposition', 'quick_encounter']);

interface Charted {
  id: string;
  patient: string;
  name: string;
  /** Each note's ID, by its type. */
  notes: Record<string, string>;
}

/**
 * A Medical visit Casey charts on the phone and finishes as Complete does, the Red flags note first:
 * each Medical note signed (then it waits for an attending's attestation) or completed for a
 * co-signer, and a Non-Medical note completed. Each sign-off carries the hash the visit read gives
 * the note's author.
 */
async function residentVisit(act: 'sign' | 'complete', ...notes: [string, Answers][]): Promise<Charted> {
  const phone = await phoneOf('resident@example.com');
  const name = `Lark ${newSurname()}`;
  const chart = newPatient({ preferredName: name }, 90);
  const id = randomUUID();
  const ids = notes.map(() => randomUUID());
  await phone.send(
    chart,
    {
      entity: 'encounter',
      recordId: id,
      op: 'create',
      value: {
        kind: 'medical',
        patientId: chart.recordId,
        locationText: 'Demo: by the made-up library steps',
      },
      minutesAgo: 80,
    },
    ...notes.map(([type, data], i) => ({
      entity: 'encounter_note',
      recordId: ids[i]!,
      op: 'create' as const,
      value: { encounterId: id, noteTypeKey: type, noteTypeVersion: 1, data },
      minutesAgo: 79 - i,
    })),
  );
  const read = (await (
    await apiCall(phone.token, 'GET', `/v1/encounters/${id}`)
  ).json()) as Schemas['VisitRead'];
  await phone.send(
    ...notes.map(([type], i) => {
      const signs = act === 'sign' && MEDICAL.has(type);
      return {
        entity: 'note_signoff',
        recordId: randomUUID(),
        op: 'create' as const,
        value: {
          noteId: ids[i]!,
          act: signs ? 'sign' : 'complete',
          contentHash: read.notes.find((n) => n.noteId === ids[i])!.contentHash,
          claimedCredential: signs ? 'resident' : null,
          statementVersion: signs ? 'sign-2026-11' : 'complete-2026-11',
        },
        minutesAgo: 60 - i,
      };
    }),
  );
  return {
    id,
    patient: chart.recordId,
    name,
    notes: Object.fromEntries(notes.map(([type], i) => [type, ids[i]!])),
  };
}

/** Casey corrects an answer of a finished note on the phone, as another person reads the visit. */
async function correct(noteId: string, field: string, newValue: unknown) {
  await (
    await phoneOf('resident@example.com')
  ).send({
    entity: 'note_correction',
    recordId: randomUUID(),
    op: 'create',
    value: {
      noteId,
      changes: [{ field: `data.${field}`, newValue, baseVersion: 1 }],
      reason: 'Demo: the call was logged a few minutes later',
      requestedByPatient: false,
      declined: false,
      claimedCredential: 'resident',
      signoffId: null,
    },
    minutesAgo: 0,
  });
}

/** The visit as the API holds it now, read as Jordan. */
async function visitAsJordan(id: string): Promise<Schemas['VisitRead']> {
  const res = await apiCall(await staffToken('clinician@example.com'), 'GET', `/v1/encounters/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Schemas['VisitRead'];
}

/** How many audit events of [action] the person wrote on the patient's chart. */
async function audited(email: string, patientId: string, action: string): Promise<number> {
  const admin = await staffToken('admin@example.com');
  const members = (await (await apiCall(admin, 'GET', '/v1/team/members')).json()) as {
    userId: string;
    email: string;
  }[];
  const res = await apiCall(admin, 'POST', '/v1/team/audit/search', {
    actorUserId: members.find((m) => m.email === email)!.userId,
    patientId,
    actionPrefix: action,
    limit: 100,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: unknown[] }).entries.length;
}

/** Each press of Co-sign or Attest the page sends to its route handler. */
function watchPresses(page: Page): Request[] {
  const presses: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/encounters\/[0-9a-f-]{36}\/sign$/.test(r.url())) presses.push(r);
  });
  return presses;
}

/** The plan the visit read marks for an act: what a press must send, exactly. */
function planOf(visit: Schemas['VisitRead'], act: 'cosign' | 'attest') {
  return visit.notes
    .filter((n) => (act === 'cosign' ? n.canCosign : n.canAttest))
    .map((n) => ({ noteId: n.noteId, contentHash: n.contentHash }));
}

/** The text of a link sits on one line: it doesn't wrap in the 240 px sidebar. */
async function expectOneLine(link: Locator) {
  const tops = await link.evaluate((a) => {
    const range = document.createRange();
    range.selectNodeContents(a);
    return [...range.getClientRects()].map((r) => Math.round(r.top));
  });
  expect(new Set(tops).size, `${await link.textContent()} wraps`).toBe(1);
}

/** The visit page's addresses, and the queues': IDs only. */
function expectOnlyIds(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(
      /\/encounters\/[0-9a-f-]{36}(\?signed=[a-z_]+)?$|\/team\/(cosign|attestation)$|\/(home|sign-in.*)$/,
    );
}

let cosign: Charted;
let attest: Charted;
let stay: Charted;
let exported: Charted;

test.beforeAll(async () => {
  // Two Medical notes and a Social needs note: Co-sign covers the two, and the third waits for no one.
  cosign = await residentVisit(
    'complete',
    ['red_flags_disposition', RED_FLAGS],
    ['quick_encounter', QUICK],
    ['social_needs', SOCIAL],
  );
  attest = await residentVisit('sign', ['red_flags_disposition', RED_FLAGS]);
  stay = await residentVisit('complete', ['red_flags_disposition', RED_FLAGS_EMS]);
  exported = await residentVisit('complete', ['red_flags_disposition', RED_FLAGS_EMS]);
});

test('each queue link shows to a credential that may act, one line each in the 240 px sidebar', async ({
  page,
}) => {
  for (const [email, links] of [
    ['clinician@example.com', ['Co-sign queue', 'Attestation queue']],
    ['admin@example.com', ['Co-sign queue', 'Attestation queue', 'Notes not complete']],
    ['resident@example.com', ['Co-sign queue']],
    ['billing@example.com', []],
    ['chw@example.com', []],
  ] as const) {
    await signIn(page, email);
    const nav = portalNav(page);
    expect((await nav.boundingBox())!.width, 'the sidebar').toBe(240);
    for (const name of ['Co-sign queue', 'Attestation queue', 'Notes not complete']) {
      const link = nav.getByRole('link', { name, exact: true });
      if ((links as readonly string[]).includes(name)) await expectOneLine(link);
      else await expect(link, `${email}: ${name}`).toHaveCount(0);
    }
  }

  // A typed URL to a queue the credential or the role can't use goes Home, logged by the API.
  await page.goto('/team/cosign');
  await expect(page).toHaveURL(/\/home\?denied=1$/);
  await signIn(page, 'resident@example.com');
  await page.goto('/team/attestation');
  await expect(page).toHaveURL(/\/home\?denied=1$/);
});

test('@responsive the co-sign queue lists a visit by the API’s titles, and Co-sign sends exactly the notes the read marks, with its hashes', async ({
  page,
}) => {
  await signIn(page, 'clinician@example.com');
  const csp = watchCsp(page);
  const traffic = watchTraffic(page);
  const presses = watchPresses(page);

  // Home counts the queues as the API does, by name only.
  const counts = (await (
    await apiCall(await staffToken('clinician@example.com'), 'GET', '/v1/me/counts')
  ).json()) as Schemas['HomeCounts'];
  const cards = page.getByRole('main').getByRole('listitem');
  const visits = (n: number, act: string) => `${n} ${n === 1 ? 'visit waits' : 'visits wait'} for ${act}.`;
  await expect(cards.filter({ hasText: 'Co-sign queue' })).toContainText(
    visits(counts.cosignWaiting!, 'a co-signature'),
  );
  await expect(cards.filter({ hasText: 'Attestation queue' })).toContainText(
    visits(counts.attestationWaiting!, 'attestation'),
  );
  await expect(cards.filter({ hasText: 'Notes not complete' })).toHaveCount(0);

  await portalNav(page).getByRole('link', { name: 'Co-sign queue' }).click();
  await expect(page).toHaveURL(/\/team\/cosign$/);
  await expect(page).toHaveTitle('Co-sign queue · Sineobex');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Co-sign queue');
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: cosign.name }) });
  await expect(row).toHaveCount(1);
  // The waiting notes by their titles; the Social needs note waits for no one.
  const notes = row.getByRole('cell').last().getByRole('listitem');
  await expect(notes.locator('strong')).toHaveText(['Red flags and disposition', 'Quick encounter']);
  await expect(notes.first()).toContainText('Written by Casey Nguyen (demo), completed ');
  await expect(row).not.toContainText('Someone else');
  await expectAccessible(page, 'co-sign queue');
  await expectReflow(page, 'co-sign queue');

  const link = row.getByRole('link', { name: new RegExp(`^${cosign.name} ?, visit on `) });
  await expect(link).toHaveAttribute('href', `/encounters/${cosign.id}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${cosign.id}$`));
  const section = page.getByRole('region', { name: 'Co-sign' });
  await expect(section.getByRole('listitem')).toHaveText(['Red flags and disposition', 'Quick encounter']);
  await expect(section).toContainText('Co-sign signs these 2 notes with your name and credential:');
  await expect(section).toContainText('I reviewed this note and agree with it.');
  await expect(page.getByRole('region', { name: 'Attest' })).toHaveCount(0);
  await expectAccessible(page, 'visit page with Co-sign');
  await expectReflow(page, 'visit page with Co-sign');

  const plan = planOf(await visitAsJordan(cosign.id), 'cosign');
  expect(plan.map((n) => n.noteId)).toEqual([
    cosign.notes.red_flags_disposition,
    cosign.notes.quick_encounter,
  ]);
  await section.getByRole('button', { name: 'Co-sign' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${cosign.id}\\?signed=cosigned$`));
  expect(presses).toHaveLength(1);
  expect(presses[0]!.postDataJSON()).toEqual({ act: 'cosign', notes: plan });
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Co-signed. Your co-signature is on each note below.',
  );
  for (const title of ['Red flags and disposition', 'Quick encounter']) {
    const note = page.getByRole('article', { name: title });
    await expect(note.locator('.sx-pill')).toHaveText('Signed');
    await expect(note).toContainText(/Co-signed by Jordan Lee \(demo\), Attending physician, /);
  }
  await expect(page.getByRole('article', { name: 'Social needs' }).locator('.sx-pill')).toHaveText(
    'Complete',
  );
  await expect(page.getByRole('region', { name: 'Co-sign' })).toHaveCount(0);
  await expectAccessible(page, 'visit page after Co-sign');
  expect(await audited('clinician@example.com', cosign.patient, 'note.cosigned')).toBe(2);

  await page.goto('/team/cosign');
  await expect(page.getByRole('rowheader', { name: cosign.name })).toHaveCount(0);
  await expectNothingStored(page, 'co-sign queue');
  expectOnlyIds(traffic.addresses);
  expect(csp).toEqual([]);
});

test('whoever wrote a note is told someone else has to co-sign it, and is offered nothing', async ({
  page,
}) => {
  await signIn(page, 'resident@example.com');
  await portalNav(page).getByRole('link', { name: 'Co-sign queue' }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: stay.name }) });
  await expect(row).toContainText('Someone else has to co-sign it.');
  await expectAccessible(page, 'co-sign queue, a note of my own');

  await row.getByRole('link').click();
  const note = page.getByRole('article', { name: 'Red flags and disposition' });
  await expect(note).toContainText('You wrote this note, so someone else has to co-sign it.');
  await expect(page.getByRole('region', { name: 'Co-sign' })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button', { name: 'Co-sign' })).toHaveCount(0);
});

test('@responsive the attestation queue lists a resident’s signed note, and Attest adds the attending’s attestation', async ({
  page,
}) => {
  await signIn(page, 'clinician@example.com');
  const presses = watchPresses(page);
  await portalNav(page).getByRole('link', { name: 'Attestation queue' }).click();
  await expect(page).toHaveURL(/\/team\/attestation$/);
  await expect(page).toHaveTitle('Attestation queue · Sineobex');
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: attest.name }) });
  await expect(row.locator('strong')).toHaveText(['Red flags and disposition']);
  await expectAccessible(page, 'attestation queue');
  await expectReflow(page, 'attestation queue');

  await row.getByRole('link').click();
  const section = page.getByRole('region', { name: 'Attest' });
  await expect(section).toContainText(
    'Attest adds your dated attestation below this note, and changes nothing in it:',
  );
  await expect(section).toContainText('I reviewed this note and agree with the assessment and plan.');
  const plan = planOf(await visitAsJordan(attest.id), 'attest');
  await expectAccessible(page, 'visit page with Attest');

  await section.getByRole('button', { name: 'Attest' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${attest.id}\\?signed=attested$`));
  expect(presses.map((p) => p.postDataJSON())).toEqual([{ act: 'attest', notes: plan }]);
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Attested. Your attestation is on each note below.',
  );
  const note = page.getByRole('article', { name: 'Red flags and disposition' });
  await expect(note.locator('.sx-pill')).toHaveText('Signed and attested');
  await expect(note).toContainText(/Attested by Jordan Lee \(demo\), /);
  expect(await audited('clinician@example.com', attest.patient, 'note.attested')).toBe(1);
});

test.describe('the plan sent is the one the person read', () => {
  test('a note corrected elsewhere, then Stay signed in, then Co-sign: the visit changed, and nothing is sent', async ({
    page,
  }) => {
    // The idle warning runs on the browser's clock, which the test moves on.
    await page.clock.install();
    await signIn(page, 'clinician@example.com');
    const presses = watchPresses(page);
    await page.goto(`/encounters/${stay.id}`);
    const note = page.getByRole('article', { name: 'Red flags and disposition' });
    await expect(note).toContainText('14:05');
    const before = planOf(await visitAsJordan(stay.id), 'cosign');

    // Casey corrects the time EMS was called while Jordan reads.
    await correct(stay.notes.red_flags_disposition!, 'red_flags.ems_time', '14:10');
    const after = planOf(await visitAsJordan(stay.id), 'cosign');
    expect(after[0]!.contentHash).not.toBe(before[0]!.contentHash);

    // Stay signed in is a server action: the page renders again from a fresh read of the visit.
    await page.clock.fastForward('13:05');
    const idle = page.getByRole('dialog', { name: 'Still there?' });
    await idle.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(idle).toBeHidden();
    await expect(note).toContainText('Replaced: 14:05');

    // The new hashes are on the page now, but nobody read them: Co-sign sends nothing.
    await page.getByRole('region', { name: 'Co-sign' }).getByRole('button', { name: 'Co-sign' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${stay.id}\\?signed=changed$`));
    await expect(page.getByRole('main').getByRole('status')).toHaveText('This visit changed. Read it again.');
    expect(presses).toHaveLength(0);
    expect((await visitAsJordan(stay.id)).notes[0]!.status).toBe('completed');
    await expectAccessible(page, 'visit page, changed');

    // Read again, it co-signs what the person now read.
    await page.getByRole('region', { name: 'Co-sign' }).getByRole('button', { name: 'Co-sign' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${stay.id}\\?signed=cosigned$`));
    expect(presses.map((p) => p.postDataJSON())).toEqual([{ act: 'cosign', notes: after }]);
  });

  test('a note corrected elsewhere, then the export, then Co-sign: the API refuses the old hash and the visit loads again, changed', async ({
    page,
  }) => {
    await signIn(page, 'clinician@example.com');
    const presses = watchPresses(page);
    await page.goto(`/encounters/${exported.id}`);
    const before = planOf(await visitAsJordan(exported.id), 'cosign');
    await correct(exported.notes.red_flags_disposition!, 'red_flags.ems_time', '14:12');

    // The export hands over a file and leaves the page as it was read.
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export EMS handoff (PDF)' }).click();
    expect((await downloaded).suggestedFilename()).toBe('ems-handoff.pdf');
    await expect(page.getByRole('article', { name: 'Red flags and disposition' })).not.toContainText('14:12');

    const cosigned = await audited('clinician@example.com', exported.patient, 'note.cosigned');
    await page.getByRole('region', { name: 'Co-sign' }).getByRole('button', { name: 'Co-sign' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${exported.id}\\?signed=changed$`));
    // The hash of what the person read, which the API no longer holds: refused, nothing written.
    expect(presses.map((p) => p.postDataJSON())).toEqual([{ act: 'cosign', notes: before }]);
    expect((await presses[0]!.response())!.status()).toBe(200);
    await expect(page.getByRole('main').getByRole('status')).toHaveText('This visit changed. Read it again.');
    await expect(page.getByRole('article', { name: 'Red flags and disposition' })).toContainText('14:12');
    expect((await visitAsJordan(exported.id)).notes[0]!.status).toBe('completed');
    expect(await audited('clinician@example.com', exported.patient, 'note.cosigned')).toBe(cosigned);
  });
});
