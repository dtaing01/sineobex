import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { sealData, unsealData } from 'iron-session';
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

// Phase 4 design, lifecycle 3.5, 3.7, 5.3, 5.4, 6.4, 9.11, 9.14 and 11.1: the co-sign and
// attestation queues, and Co-sign and Attest on the visit page, against the real API, with made-up
// visits Casey (the resident) charts on a phone here. Jordan, an attending, co-signs and attests;
// Alex, a Program Admin and an attending, attests what Jordan's role may not read whole.
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
/**
 * The Done when's story (lifecycle 11.1), which the API's and the phone's tests read too: each note's
 * answers, those of step 2 and the red-flag answer of step 4, and the assessment.
 */
const DONE_WHEN = JSON.parse(
  readFileSync(
    new URL('../../../packages/contract/test-vectors/encounters-done-when.json', import.meta.url),
    'utf8',
  ),
) as {
  assessment: string;
  notes: { ref: string; noteTypeKey: string; answers: Answers; answersAtStep4: Answers }[];
};
/** A note of the story as the resident finishes it: its type, and its answers of steps 2 and 4. */
function doneWhenNote(ref: string): [string, Answers] {
  const n = DONE_WHEN.notes.find((x) => x.ref === ref)!;
  return [n.noteTypeKey, { ...n.answers, ...n.answersAtStep4 }];
}
/** A GU exam: a sensitive exam section, which only patients.view_sensitive_exams reads (6.4). */
const GU_EXAM: Answers = {
  'reason.concern': 'Demo: burning when passing water',
  'exam.systems': ['gu'],
  'gu.general': ['dysuria'],
  'gu.cva': 'no_tenderness',
};
/** A sensitive note type, which only patients.view_sensitive reads (6.4). */
const PSYCH: Answers = { 'mse.notes': 'Demo: calm and talking easily', 'safety.suicidal': 'denies' };
const MEDICAL = new Set([
  'red_flags_disposition',
  'quick_encounter',
  'general_primary_care',
  'wound_care',
  'psychological',
]);

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
 * the note's author, over the assessment too when the visit has one (lifecycle 4.5).
 */
async function residentVisit(
  act: 'sign' | 'complete',
  notes: [string, Answers][],
  assessment?: string,
): Promise<Charted> {
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
    ...(assessment === undefined
      ? []
      : [
          {
            entity: 'encounter',
            recordId: id,
            op: 'set' as const,
            field: 'summary',
            value: assessment,
            minutesAgo: 65,
          },
        ]),
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

/** The visit as the API holds it now, read as that person. */
async function visitAs(email: string, id: string): Promise<Schemas['VisitRead']> {
  const res = await apiCall(await staffToken(email), 'GET', `/v1/encounters/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Schemas['VisitRead'];
}

const visitAsJordan = (id: string) => visitAs('clinician@example.com', id);

/**
 * Moves a seeded staff member to another credential, as the members page does, and gives back what
 * puts them back as they were, fields and all: specs share the database.
 */
async function credentialForAWhile(
  email: string,
  credential: Schemas['Credential'],
): Promise<() => Promise<void>> {
  const list = await apiCall(await staffToken('admin@example.com'), 'GET', '/v1/team/members');
  const was = ((await list.json()) as Schemas['Member'][]).find((m) => m.email === email)!;
  const change = async (to: Schemas['Credential'], fields: Schemas['Member']['credentialFields']) => {
    const res = await apiCall(
      await staffToken('admin@example.com'),
      'PUT',
      `/v1/team/members/${was.membershipId}/credential`,
      { credential: to, credentialFields: fields, reason: 'Demo: covering another desk for a day' },
    );
    expect(res.status, `credential ${to}`).toBe(200);
  };
  await change(credential, {});
  return () => change(was.credential, was.credentialFields);
}

/** What a queue says of a note the person may not act on, whichever reason it gives (5.4). */
const NOT_YOURS = /someone else has to|a part you can’t open/i;

/** A queue's row for a visit, found by its patient's name. */
function queueRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) });
}

/**
 * Co-signs and attests every note the team's queues hold, as Alex and Jordan may, so a queue can be
 * seen empty: specs share the database, and every visit charted before this one may still wait.
 * Between the two attendings every note is someone's to act on (neither wrote one; Alex reads
 * everything; a note one of them signed or acts as the author of, the other may take).
 */
async function emptyQueues() {
  const acts = { cosign: '/v1/team/cosign-queue', attest: '/v1/team/attestation-queue' } as const;
  const versions = { cosign: 'cosign-2026-11', attest: 'attest-2026-11' } as const;
  for (let round = 0; round < 3; round++) {
    let waiting = 0;
    for (const act of ['cosign', 'attest'] as const) {
      for (const email of ['admin@example.com', 'clinician@example.com']) {
        const token = await staffToken(email);
        const queue = (await (await apiCall(token, 'GET', acts[act])).json()) as Schemas['SignatureQueue'];
        waiting += queue.rows.length;
        for (const row of queue.rows) {
          const notes = planOf(await visitAs(email, row.encounterId), act);
          if (notes.length === 0) continue;
          const res = await apiCall(token, 'POST', `/v1/encounters/${row.encounterId}/${act}`, {
            notes,
            statementVersion: versions[act],
          });
          expect(res.status, `${act} ${row.encounterId} as ${email}`).toBe(200);
        }
      }
    }
    if (waiting === 0) return;
  }
  throw new Error('The queues still hold notes nobody here may act on.');
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

/**
 * Stay signed in, from the idle warning: a server action, so the page renders again from a fresh
 * read of the visit. The warning runs on the browser's clock, which the test installs and moves on.
 */
async function staySignedIn(page: Page) {
  await page.clock.fastForward('13:05');
  const idle = page.getByRole('dialog', { name: 'Still there?' });
  await idle.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(idle).toBeHidden();
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
let story: Charted;
let sensitive: Charted;

test.beforeAll(async () => {
  // Two Medical notes and a Social needs note: Co-sign covers the two, and the third waits for no one.
  cosign = await residentVisit('complete', [
    ['red_flags_disposition', RED_FLAGS],
    ['quick_encounter', QUICK],
    ['social_needs', SOCIAL],
  ]);
  attest = await residentVisit('sign', [['red_flags_disposition', RED_FLAGS]]);
  stay = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS_EMS]]);
  exported = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS_EMS]]);
  // The Done when's visit (lifecycle 11.1): General / primary care, Wound care and Social needs, with
  // the Red flags note the app adds by itself and an assessment, signed and completed at Complete.
  // The answers are the shared story's; the Red flags note is charted first here, as the visit page
  // and the queue are asserted.
  story = await residentVisit(
    'sign',
    ['redFlags', 'general', 'wound', 'social'].map(doneWhenNote),
    DONE_WHEN.assessment,
  );
  // A sensitive note type, a note with a GU exam, and a Social needs note (6.4), beside the Red flags
  // note every Medical visit has.
  sensitive = await residentVisit('sign', [
    ['red_flags_disposition', RED_FLAGS],
    ['psychological', PSYCH],
    ['general_primary_care', GU_EXAM],
    ['social_needs', SOCIAL],
  ]);
});

test('each queue link and Home card shows to a credential that may act, one line each in the 240 px sidebar', async ({
  page,
}) => {
  for (const [email, links] of [
    ['clinician@example.com', ['Co-sign queue', 'Attestation queue']],
    ['admin@example.com', ['Co-sign queue', 'Attestation queue', 'Notes not complete']],
    ['resident@example.com', ['Co-sign queue']],
    // Logistics charts, but a credential of none signs and attests nothing.
    ['logistics@example.com', []],
    ['billing@example.com', []],
    ['chw@example.com', []],
  ] as const) {
    await signIn(page, email);
    const nav = portalNav(page);
    expect((await nav.boundingBox())!.width, 'the sidebar').toBe(240);
    const cards = page.getByRole('main').getByRole('listitem').getByRole('heading', { level: 2 });
    for (const name of ['Co-sign queue', 'Attestation queue', 'Notes not complete']) {
      const link = nav.getByRole('link', { name, exact: true });
      const card = cards.filter({ hasText: name });
      if ((links as readonly string[]).includes(name)) {
        await expectOneLine(link);
        // Home counts exactly the lists the person may open.
        await expect(card, `${email}: the ${name} card`).toHaveCount(1);
      } else {
        await expect(link, `${email}: ${name}`).toHaveCount(0);
        await expect(card, `${email}: the ${name} card`).toHaveCount(0);
      }
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
  await expect(row).not.toContainText(NOT_YOURS);
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
  // Why, in the visit page's words (5.4).
  await expect(row).toContainText('You wrote this note, so someone else has to co-sign it.');
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
  await expectAccessible(page, 'visit page after Attest');
});

test('@responsive the Done when, its portal half: an attending opens the attestation queue and attests a resident’s visit in one action', async ({
  page,
}) => {
  // Lifecycle 11.1, step 7. Steps 1 to 6 are the phone's; Casey's phone has sent what they leave
  // on the server: three Medical notes signed, each waiting for an attending, and Social needs
  // completed.
  const medical = ['Red flags and disposition', 'General / primary care', 'Wound care'];
  await signIn(page, 'clinician@example.com');
  const csp = watchCsp(page);
  const traffic = watchTraffic(page);
  const presses = watchPresses(page);
  const viewed = await audited('clinician@example.com', story.patient, 'attestation_queue.viewed');
  await portalNav(page).getByRole('link', { name: 'Attestation queue' }).click();
  // The queue lists one visit with three notes.
  const row = queueRow(page, story.name);
  await expect(row).toHaveCount(1);
  await expect(row.locator('strong')).toHaveText(medical);
  await expect(row).not.toContainText('Social needs');
  await expect(row).not.toContainText(NOT_YOURS);
  expect(await audited('clinician@example.com', story.patient, 'attestation_queue.viewed')).toBe(viewed + 1);

  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${story.id}$`));
  await expect(page.getByRole('region', { name: 'About the visit' })).toContainText(DONE_WHEN.assessment);
  const section = page.getByRole('region', { name: 'Attest' });
  await expect(section.getByRole('listitem')).toHaveText(medical);
  await expect(section).toContainText(
    'Attest adds your dated attestation below these 3 notes, and changes nothing in them:',
  );
  await expect(page.getByRole('article', { name: 'Social needs' }).locator('.sx-pill')).toHaveText(
    'Complete',
  );
  await expect(page.getByRole('region', { name: 'Co-sign' })).toHaveCount(0);
  await expectAccessible(page, 'visit page, the Done when’s visit');
  await expectReflow(page, 'visit page, the Done when’s visit');

  // One action attests the three.
  const plan = planOf(await visitAsJordan(story.id), 'attest');
  await section.getByRole('button', { name: 'Attest' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${story.id}\\?signed=attested$`));
  expect(presses.map((p) => p.postDataJSON())).toEqual([{ act: 'attest', notes: plan }]);
  for (const title of medical) {
    const note = page.getByRole('article', { name: title });
    await expect(note.locator('.sx-pill')).toHaveText('Signed and attested');
    await expect(note).toContainText(/Attested by Jordan Lee \(demo\), /);
  }
  await expect(page.getByRole('region', { name: 'Attest' })).toHaveCount(0);

  // What the step asserts on the server: three attestations, each logged, and one notice to Casey.
  const after = await visitAsJordan(story.id);
  expect(after.status).toBe('signed');
  expect(after.notes.map((n) => [n.title, n.status, n.attestation])).toEqual([
    ['Red flags and disposition', 'signed', 'attested'],
    ['General / primary care', 'signed', 'attested'],
    ['Wound care', 'signed', 'attested'],
    ['Social needs', 'completed', 'not_needed'],
  ]);
  expect(await audited('clinician@example.com', story.patient, 'note.attested')).toBe(3);
  const notices = (await (
    await apiCall(await staffToken('resident@example.com'), 'GET', '/v1/team/notices')
  ).json()) as Schemas['Notice'][];
  expect(notices.filter((n) => n.kind === 'note_attested' && n.recordId === story.id)).toHaveLength(1);

  // Then none.
  await portalNav(page).getByRole('link', { name: 'Attestation queue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Attestation queue');
  await expect(queueRow(page, story.name)).toHaveCount(0);
  expectOnlyIds(traffic.addresses);
  expect(csp).toEqual([]);
});

test('@responsive each reader sees a visit’s notes and sections as their role allows, and no act their credential doesn’t', async ({
  page,
}) => {
  const titles = () => page.getByRole('main').getByRole('article').getByRole('heading', { level: 2 });
  const main = page.getByRole('main');

  // Billing/Data reads Medical notes but neither sensitive note types nor sensitive exams, and
  // charts nothing: no Behavioral health note, no GU exam, no act and no reason why not.
  await signIn(page, 'billing@example.com');
  await page.goto(`/encounters/${sensitive.id}`);
  await expect(titles()).toHaveText(['Red flags and disposition', 'General / primary care', 'Social needs']);
  const general = page.getByRole('article', { name: 'General / primary care' });
  await expect(general).toContainText('Demo: burning when passing water');
  await expect(general.getByRole('heading', { name: 'Genitourinary (GU)' })).toHaveCount(0);
  await expect(main).not.toContainText('Dysuria');
  await expect(main).not.toContainText('Demo: calm and talking easily');
  await expect(main).not.toContainText('Ask a Program Admin');
  await expect(main.getByRole('button')).toHaveCount(0);
  await expectAccessible(page, 'visit page, Billing/Data');
  // The chart's timeline lists the same notes.
  await page.goto(`/patients/${sensitive.patient}`);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline.locator('ol > li').first().getByRole('listitem')).toHaveText([
    'Red flags and disposition: Signed, waiting for attestation',
    'General / primary care: Signed, waiting for attestation',
    'Social needs: Complete',
  ]);
  await expect(timeline).not.toContainText('Behavioral health');

  // Logistics reads sensitive note types and charts, but not sensitive exams, and its credential
  // attests nothing: no act is offered, and none is explained.
  await signIn(page, 'logistics@example.com');
  await page.goto(`/encounters/${sensitive.id}`);
  await expect(titles()).toHaveText([
    'Red flags and disposition',
    'Behavioral health',
    'General / primary care',
    'Social needs',
  ]);
  await expect(main).toContainText('Demo: calm and talking easily');
  await expect(main).not.toContainText('Dysuria');
  await expect(main).not.toContainText('Ask a Program Admin');
  await expect(main.getByRole('region', { name: 'Attest' })).toHaveCount(0);
  await expectAccessible(page, 'visit page, Logistics');

  // The CHW preset reads no Medical note at all.
  await signIn(page, 'chw@example.com');
  await page.goto(`/encounters/${sensitive.id}`);
  await expect(titles()).toHaveText(['Social needs']);
  await expect(main.getByRole('heading', { name: 'Assessment' })).toHaveCount(0);

  // Casey wrote every note: all of them, the GU exam too, and nothing to act on.
  await signIn(page, 'resident@example.com');
  await page.goto(`/encounters/${sensitive.id}`);
  await expect(titles()).toHaveText([
    'Red flags and disposition',
    'Behavioral health',
    'General / primary care',
    'Social needs',
  ]);
  await expect(page.getByRole('heading', { name: 'Genitourinary (GU)' })).toBeVisible();
  await expect(main.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Behavioral health' })).toContainText(
    'You wrote this note, so someone else has to attest it.',
  );
});

test('@responsive an attending attests what they read whole; a note with a GU exam waits, says why, and a Program Admin attests it', async ({
  page,
}) => {
  // Lifecycle 6.4 rule 4 and 11.1's shorter test: Healthcare Staff doesn't read sensitive exams.
  await signIn(page, 'clinician@example.com');
  const presses = watchPresses(page);
  await portalNav(page).getByRole('link', { name: 'Attestation queue' }).click();
  const row = queueRow(page, sensitive.name);
  await expect(row.locator('strong')).toHaveText([
    'Red flags and disposition',
    'Behavioral health',
    'General / primary care',
  ]);
  await expect(row.getByRole('listitem').last()).toContainText(
    'This note has a part you can’t open. Ask a Program Admin.',
  );
  await expect(row.getByRole('listitem').first()).not.toContainText(NOT_YOURS);
  await expect(row.getByRole('listitem').nth(1)).not.toContainText(NOT_YOURS);

  await row.getByRole('link').click();
  const general = page.getByRole('article', { name: 'General / primary care' });
  await expect(general).toContainText('This note has a part you can’t open. Ask a Program Admin.');
  await expect(general.getByRole('heading', { name: 'Genitourinary (GU)' })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText('Dysuria');
  // The behavioral health note is Jordan's to attest: Healthcare Staff reads sensitive note types.
  await expect(page.getByRole('article', { name: 'Behavioral health' })).toContainText(
    'Demo: calm and talking easily',
  );
  const section = page.getByRole('region', { name: 'Attest' });
  await expect(section.getByRole('listitem')).toHaveText(['Red flags and disposition', 'Behavioral health']);
  await expect(section).toContainText(
    'Attest adds your dated attestation below these 2 notes, and changes nothing in them:',
  );
  await expectAccessible(page, 'visit page, a note with a part the reader can’t open');
  await expectReflow(page, 'visit page, a note with a part the reader can’t open');

  const jordans = planOf(await visitAsJordan(sensitive.id), 'attest');
  expect(jordans.map((n) => n.noteId)).toEqual([
    sensitive.notes.red_flags_disposition,
    sensitive.notes.psychological,
  ]);
  await section.getByRole('button', { name: 'Attest' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${sensitive.id}\\?signed=attested$`));
  expect(presses.map((p) => p.postDataJSON())).toEqual([{ act: 'attest', notes: jordans }]);
  await expect(page.getByRole('article', { name: 'Behavioral health' }).locator('.sx-pill')).toHaveText(
    'Signed and attested',
  );
  await expect(general.locator('.sx-pill')).toHaveText('Signed, waiting for attestation');
  await expect(general).toContainText('This note has a part you can’t open. Ask a Program Admin.');
  await expect(page.getByRole('region', { name: 'Attest' })).toHaveCount(0);

  // Alex reads the GU exam, and attests the note from the queue.
  await signIn(page, 'admin@example.com');
  const alexPresses = watchPresses(page);
  await portalNav(page).getByRole('link', { name: 'Attestation queue' }).click();
  const waiting = queueRow(page, sensitive.name);
  await expect(waiting.locator('strong')).toHaveText(['General / primary care']);
  await expect(waiting).not.toContainText(NOT_YOURS);
  await waiting.getByRole('link').click();
  const whole = page.getByRole('article', { name: 'General / primary care' });
  await expect(whole.getByRole('heading', { name: 'Genitourinary (GU)' })).toBeVisible();
  await expect(whole).toContainText('Dysuria');
  await expect(whole).not.toContainText('Ask a Program Admin');
  await expect(page.getByRole('region', { name: 'Attest' }).getByRole('listitem')).toHaveText([
    'General / primary care',
  ]);
  await expectAccessible(page, 'visit page, a Program Admin reads a GU exam');
  const alexs = planOf(await visitAs('admin@example.com', sensitive.id), 'attest');
  await page.getByRole('region', { name: 'Attest' }).getByRole('button', { name: 'Attest' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${sensitive.id}\\?signed=attested$`));
  expect(alexPresses.map((p) => p.postDataJSON())).toEqual([{ act: 'attest', notes: alexs }]);
  await expect(whole.locator('.sx-pill')).toHaveText('Signed and attested');
  await expect(whole).toContainText(/Attested by Alex Rivera \(demo\), /);
  expect(await audited('clinician@example.com', sensitive.patient, 'note.attested')).toBe(2);
  expect(await audited('admin@example.com', sensitive.patient, 'note.attested')).toBe(1);
});

test('a second press while the visit loads again after Co-sign sends nothing: the button stays disabled', async ({
  page,
}) => {
  // Review finding PAC-1: the button came back as soon as the answer said where to go, while the
  // visit was still loading, and a second press was answered "This visit changed".
  const v = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS]]);
  await signIn(page, 'clinician@example.com');
  const presses = watchPresses(page);
  await page.goto(`/encounters/${v.id}`);
  // The visit is slow to load again after the act.
  const held = /\?signed=cosigned$/;
  await page.route(held, async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue().catch(() => undefined);
  });
  // Watched in the page itself: a locator waits for the load the answer started.
  const seen = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>(
      'section[aria-labelledby="cosign-heading"] button',
    )!;
    const pause = () => new Promise((r) => setTimeout(r, 10));
    const start = performance.now();
    button.click();
    while (!button.disabled && performance.now() - start < 2000) await pause();
    // The answer comes, and the visit starts to load again; the button must stay as it is.
    while (button.disabled && performance.now() - start < 2500) await pause();
    const enabled = !button.disabled;
    const text = button.textContent;
    // A second press, which a disabled button doesn't take.
    button.click();
    return { enabled, text };
  });
  expect(seen).toEqual({ enabled: false, text: 'Working…' });
  await expect(page).toHaveURL(new RegExp(`/encounters/${v.id}\\?signed=cosigned$`));
  await page.unroute(held);
  await expect(page.getByRole('main').getByRole('status')).toHaveText(
    'Co-signed. Your co-signature is on each note below.',
  );
  expect(presses).toHaveLength(1);
  expect(await audited('clinician@example.com', v.patient, 'note.cosigned')).toBe(1);
});

test('a press the route answers with a problem: the alert takes focus, and a second failure is said again', async ({
  page,
}) => {
  // Review finding PAX-1: the button is disabled while it sends, so focus fell to the page's body,
  // and the same problem twice changed nothing a screen reader would hear.
  const v = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS]]);
  await signIn(page, 'clinician@example.com');
  await page.goto(`/encounters/${v.id}`);
  const sign = /\/encounters\/[0-9a-f-]{36}\/sign$/;
  await page.route(sign, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ problem: 'Something went wrong. Try again.' }),
    }),
  );
  const section = page.getByRole('region', { name: 'Co-sign' });
  const button = section.getByRole('button', { name: 'Co-sign' });
  await button.focus();
  await page.keyboard.press('Enter');
  const alert = section.getByRole('alert');
  await expect(alert).toHaveText('Something went wrong. Try again.');
  await expect(alert).toBeFocused();
  const first = await alert.elementHandle();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(alert).toBeFocused();
  // A new alert, which a screen reader announces again.
  expect(await first!.evaluate((e) => e.isConnected)).toBe(false);
  await page.unroute(sign);
  expect((await visitAsJordan(v.id)).notes[0]!.status).toBe('completed');
});

test('the connection drops after the press reached the server: the page can’t tell, and the visit read again shows the co-signature', async ({
  page,
}) => {
  // Review finding PAC-4: the page said "Nothing was sent", and a second press was told the visit changed.
  const v = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS]]);
  await signIn(page, 'clinician@example.com');
  const presses = watchPresses(page);
  const sign = /\/encounters\/[0-9a-f-]{36}\/sign$/;
  await page.route(sign, async (route) => {
    // The server takes it and answers; the answer never comes back.
    expect((await route.fetch()).status()).toBe(200);
    await route.abort('connectionreset');
  });
  await page.goto(`/encounters/${v.id}`);
  const section = page.getByRole('region', { name: 'Co-sign' });
  await section.getByRole('button', { name: 'Co-sign' }).click();
  await expect(section.getByRole('alert')).toHaveText(
    'The connection dropped, so we can’t tell whether your co-signature went through. Read the visit again to see.',
  );
  await expect(section.getByRole('alert')).toBeFocused();
  await expect(section.getByRole('button', { name: 'Co-sign' })).toHaveCount(0);
  await page.unroute(sign);
  await section.getByRole('button', { name: 'Read the visit again' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${v.id}$`));
  const note = page.getByRole('article', { name: 'Red flags and disposition' });
  await expect(note.locator('.sx-pill')).toHaveText('Signed');
  await expect(note).toContainText(/Co-signed by Jordan Lee \(demo\), /);
  await expect(page.getByRole('region', { name: 'Co-sign' })).toHaveCount(0);
  expect(presses).toHaveLength(1);
  expect(await audited('clinician@example.com', v.patient, 'note.cosigned')).toBe(1);
});

test('a session idle past 15 minutes reads no visit and co-signs nothing, even on a request that says it is a prefetch', async ({
  page,
  context,
}) => {
  // Review finding PAC-2: the proxy's session gate skips a prefetch, and the pages and route
  // handlers checked only that the session held tokens.
  const v = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS]]);
  await signIn(page, 'clinician@example.com');
  const plan = planOf(await visitAsJordan(v.id), 'cosign');
  const cookie = (await context.cookies()).find((c) => c.name === 'sx-session')!;
  // The test environment's session secret (lib/session.ts).
  const sealing = { password: 'local-only-session-secret-not-for-deploy-0000', ttl: 12 * 3600 };
  const session = await unsealData<Record<string, unknown>>(cookie.value, sealing);
  session.lastActivity = Date.now() - 20 * 60_000;
  const idle = await sealData(session, sealing);
  const outside = await playwrightRequest.newContext({ baseURL: new URL(page.url()).origin });
  try {
    for (const prefetch of [{ purpose: 'prefetch' }, { 'next-router-prefetch': '1' }] as Record<
      string,
      string
    >[]) {
      const headers = { cookie: `sx-session=${idle}`, 'sec-fetch-site': 'same-origin', ...prefetch };
      const read = await outside.get(`/encounters/${v.id}`, { headers, maxRedirects: 0 });
      expect(read.status(), JSON.stringify(prefetch)).toBe(307);
      expect(read.headers()['location']).toMatch(/\/sign-in\?ended=idle$/);
      expect(await read.text()).not.toContain('Red flags and disposition');
      const press = await outside.post(`/encounters/${v.id}/sign`, {
        headers,
        data: { act: 'cosign', notes: plan },
        maxRedirects: 0,
      });
      expect(press.status(), JSON.stringify(prefetch)).toBe(307);
      expect(press.headers()['location']).toMatch(/\/sign-in\?ended=idle$/);
    }
  } finally {
    await outside.dispose();
  }
  expect((await visitAsJordan(v.id)).notes[0]!.status).toBe('completed');
  expect(await audited('clinician@example.com', v.patient, 'note.cosigned')).toBe(0);
});

test('an act refused for the person: a credential changed since the page was read loads the visit again and says so; a dropped connection says it can’t tell, and offers to read the visit again', async ({
  page,
}) => {
  const attestIt = await residentVisit('sign', [['red_flags_disposition', RED_FLAGS]]);
  const cosignIt = await residentVisit('complete', [['red_flags_disposition', RED_FLAGS]]);
  await signIn(page, 'clinician@example.com');
  await page.goto(`/encounters/${attestIt.id}`);
  const section = page.getByRole('region', { name: 'Attest' });

  // The connection drops on the press. The page can't tell whether the act went through, so it
  // says so in place and offers the visit again, not a second press (review finding PAC-4).
  const sign = /\/encounters\/[0-9a-f-]{36}\/sign$/;
  await page.route(sign, (route) => route.abort('internetdisconnected'));
  await section.getByRole('button', { name: 'Attest' }).click();
  await expect(section.getByRole('alert')).toHaveText(
    'The connection dropped, so we can’t tell whether your attestation went through. Read the visit again to see.',
  );
  await expect(section.getByRole('alert')).toBeFocused();
  await expect(section.getByRole('button', { name: 'Attest' })).toHaveCount(0);
  await expectAccessible(page, 'Attest, the connection dropped', { inPlace: true });
  await page.unroute(sign);
  expect((await visitAsJordan(attestIt.id)).notes[0]!.attestation).toBe('waiting');
  await section.getByRole('button', { name: 'Read the visit again' }).click();
  await expect(page).toHaveURL(new RegExp(`/encounters/${attestIt.id}$`));
  await expect(section.getByRole('alert')).toHaveCount(0);

  // Jordan's credential is moved to resident while the page is open: the API refuses the attestation
  // for who is asking, and the visit loads again without the act.
  let putBack = await credentialForAWhile('clinician@example.com', 'resident');
  try {
    await section.getByRole('button', { name: 'Attest' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${attestIt.id}\\?signed=cannot_attest$`));
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Your credential can’t attest notes now.',
    );
    await expect(page.getByRole('region', { name: 'Attest' })).toHaveCount(0);
    await expect(
      page.getByRole('article', { name: 'Red flags and disposition' }).locator('.sx-pill'),
    ).toHaveText('Signed, waiting for attestation');
    await expect(portalNav(page).getByRole('link', { name: 'Attestation queue' })).toHaveCount(0);
    await expect(portalNav(page).getByRole('link', { name: 'Co-sign queue' })).toHaveCount(1);
    await expectAccessible(page, 'visit page, cannot_attest');
    expect(await audited('clinician@example.com', attestIt.patient, 'note.attested')).toBe(0);
  } finally {
    await putBack();
  }

  // ...and to none while a co-sign is open.
  await page.goto(`/encounters/${cosignIt.id}`);
  putBack = await credentialForAWhile('clinician@example.com', 'none');
  try {
    await page.getByRole('region', { name: 'Co-sign' }).getByRole('button', { name: 'Co-sign' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${cosignIt.id}\\?signed=cannot_sign$`));
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Your credential can’t co-sign notes now.',
    );
    await expect(page.getByRole('region', { name: 'Co-sign' })).toHaveCount(0);
    await expect(portalNav(page).getByRole('link', { name: /queue$/ })).toHaveCount(0);
    await expectAccessible(page, 'visit page, cannot_sign');
    expect((await visitAs('admin@example.com', cosignIt.id)).notes[0]!.status).toBe('completed');
  } finally {
    await putBack();
  }
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
    await staySignedIn(page);
    await expect(note).toContainText('Replaced: 14:05');

    // The new hashes are on the page now, but nobody read them: the section says so at once, and
    // Co-sign sends nothing.
    const section = page.getByRole('region', { name: 'Co-sign' });
    await expect(section.getByRole('status')).toHaveText('This visit changed. Read it again.');
    await expect(section.getByRole('link', { name: 'Read it again' })).toHaveAttribute(
      'href',
      `/encounters/${stay.id}`,
    );
    await expectAccessible(page, 'Co-sign, the visit changed', { inPlace: true });
    await section.getByRole('button', { name: 'Co-sign' }).click();
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

  test('read, attested by someone else, corrected, with Stay signed in after each: Attest sends nothing anybody here read', async ({
    page,
  }) => {
    // Review finding PRD-2: the section went away when a re-render had nothing to attest, and came
    // back holding the corrected note's hash as if it were the one the person read.
    const v = await residentVisit('sign', [['red_flags_disposition', RED_FLAGS_EMS]]);
    const noteId = v.notes.red_flags_disposition!;
    await page.clock.install();
    await signIn(page, 'clinician@example.com');
    const presses = watchPresses(page);
    await page.goto(`/encounters/${v.id}`);
    const note = page.getByRole('article', { name: 'Red flags and disposition' });
    await expect(note).toContainText('14:05');
    const section = page.getByRole('region', { name: 'Attest' });
    await expect(section.getByRole('status')).toHaveCount(0);

    // Alex attests it through the API; Stay signed in renders a read with nothing to attest.
    const alexs = planOf(await visitAs('admin@example.com', v.id), 'attest');
    const attested = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      `/v1/encounters/${v.id}/attest`,
      {
        notes: alexs,
        statementVersion: 'attest-2026-11',
      },
    );
    expect(attested.status).toBe(200);
    await staySignedIn(page);
    await expect(note.locator('.sx-pill')).toHaveText('Signed and attested');
    await expect(section.getByRole('status')).toHaveText('This visit changed. Read it again.');

    // Casey corrects it, so it waits again with other content; Stay signed in renders that.
    await correct(noteId, 'red_flags.ems_time', '14:20');
    await staySignedIn(page);
    await expect(note).toContainText('Replaced: 14:05');
    await expect(section.getByRole('status')).toHaveText('This visit changed. Read it again.');
    await section.getByRole('button', { name: 'Attest' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${v.id}\\?signed=changed$`));
    expect(presses).toHaveLength(0);
    expect((await visitAs('admin@example.com', v.id)).notes[0]!.attestations).toHaveLength(1);
  });

  test('read with nothing to attest, then corrected, then Stay signed in: the section says the visit changed, and sends nothing', async ({
    page,
  }) => {
    const v = await residentVisit('sign', [['red_flags_disposition', RED_FLAGS_EMS]]);
    const alexs = planOf(await visitAs('admin@example.com', v.id), 'attest');
    const attested = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      `/v1/encounters/${v.id}/attest`,
      {
        notes: alexs,
        statementVersion: 'attest-2026-11',
      },
    );
    expect(attested.status).toBe(200);
    await page.clock.install();
    await signIn(page, 'clinician@example.com');
    const presses = watchPresses(page);
    await page.goto(`/encounters/${v.id}`);
    const note = page.getByRole('article', { name: 'Red flags and disposition' });
    await expect(note).toContainText('14:05');
    const section = page.getByRole('region', { name: 'Attest' });
    await expect(section).toHaveCount(0);

    await correct(v.notes.red_flags_disposition!, 'red_flags.ems_time', '14:25');
    await staySignedIn(page);
    await expect(note).toContainText('Replaced: 14:05');
    // Nobody here read an Attest section: it says only that the visit changed.
    await expect(section.getByRole('status')).toHaveText('This visit changed. Read it again.');
    await expect(section.getByRole('listitem')).toHaveCount(0);
    await section.getByRole('button', { name: 'Attest' }).click();
    await expect(page).toHaveURL(new RegExp(`/encounters/${v.id}\\?signed=changed$`));
    expect(presses).toHaveLength(0);
    expect((await visitAs('admin@example.com', v.id)).notes[0]!.attestation).toBe('waiting');
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

test('@responsive a note back after a correction: the queue says who attested it before, its caption runs the page’s width at 320 px, and an answer the correction took away reads as no answer now', async ({
  page,
}) => {
  // PAX-6: neither the row nor the answer was ever drawn.
  const v = await residentVisit('sign', [
    ['red_flags_disposition', { ...RED_FLAGS, 'follow_up.details': 'Demo: come back on Tuesday' }],
  ]);
  const noteId = v.notes.red_flags_disposition!;
  const alexs = planOf(await visitAs('admin@example.com', v.id), 'attest');
  const attested = await apiCall(
    await staffToken('admin@example.com'),
    'POST',
    `/v1/encounters/${v.id}/attest`,
    {
      notes: alexs,
      statementVersion: 'attest-2026-11',
    },
  );
  expect(attested.status).toBe(200);
  await correct(noteId, 'follow_up.details', null);

  await signIn(page, 'clinician@example.com');
  await portalNav(page).getByRole('link', { name: 'Attestation queue' }).click();
  const row = queueRow(page, v.name);
  await expect(row.getByRole('listitem')).toContainText(
    'Back after a correction. Attested before by Alex Rivera (demo).',
  );
  await expectAccessible(page, 'attestation queue, back after a correction');
  await expectReflow(page, 'attestation queue, back after a correction');
  // A stacked table's caption runs the width of the page, not of one word.
  await page.setViewportSize({ width: 320, height: 800 });
  const caption = await page.getByRole('table').locator('caption').boundingBox();
  const table = await page.getByRole('table').boundingBox();
  expect(caption!.width).toBeGreaterThan(table!.width * 0.9);

  await page.setViewportSize({ width: 1440, height: 900 });
  await row.getByRole('link').click();
  const note = page.getByRole('article', { name: 'Red flags and disposition' });
  const details = note.locator('dl > div').filter({ has: page.getByText('Demo: come back on Tuesday') });
  await expect(details.getByText('No answer now', { exact: true })).toHaveClass('sr-only');
  await expect(details.locator('del')).toHaveText('Demo: come back on Tuesday');
  await expectAccessible(page, 'visit page, an answer a correction took away');
});

test('@responsive with nothing waiting, each queue and its Home card say so', async ({ page }) => {
  await emptyQueues();
  await signIn(page, 'clinician@example.com');
  const cards = page.getByRole('main').getByRole('listitem');
  await expect(cards.filter({ hasText: 'Co-sign queue' }).locator('p')).toHaveText(
    'No visits wait for a co-signature.',
  );
  await expect(cards.filter({ hasText: 'Attestation queue' }).locator('p')).toHaveText(
    'No visits wait for attestation.',
  );
  await expectAccessible(page, 'Home, nothing waiting');

  for (const [name, empty] of [
    ['Co-sign queue', 'No visits wait for a co-signature.'],
    ['Attestation queue', 'No visits wait for attestation.'],
  ] as const) {
    await portalNav(page).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(page.getByRole('main')).toContainText(empty);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectAccessible(page, `${name}, empty`);
    await expectReflow(page, `${name}, empty`);
  }
});
