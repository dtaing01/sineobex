import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Schemas } from '@sineobex/contract';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  registerPhone,
  setRole,
  signIn,
  staffToken,
  watchCsp,
  watchTraffic,
} from './helpers';
import { newBirthDate, newPatient, newSurname, phoneOf, type PhoneChange } from './phone-records';

// Phase 5 design 8.1, the patient page's flags (cards P5-portal-header, P5-portal-panel,
// P5-portal-filters): the header's pills, the Flags panel's history, Save and Entered in error, the
// search's Risk level and Conditions, Status check due on the problem list, and a sensitive flag
// absent for a reader the flag rule hides it from; then the Done when's step 8, read from the
// shared story. Every patient is made up and made here, sent the way a phone sends it, so no case
// changes what another spec reads; every flag a case adds is removed again, and none is a risk
// level, so Team setup's own specs find the platform's three as they left them.

type ListedFlag = Schemas['ListedFlag'];
type Chart = Schemas['PatientChart'];

const ADMIN = 'admin@example.com';
const JORDAN = 'clinician@example.com'; // Healthcare Staff: sees sensitive flags, manages no one
const CASEY = 'resident@example.com'; // Healthcare Staff
const ROBIN = 'chw@example.com'; // the community health worker preset: no sensitive flag

const SAVED = 'Flag saved. The history below shows the change.';
const MARKED =
  'Marked entered in error. The flags at the top of the page show the patient’s flags without it.';
const DROPPED =
  'The connection dropped, so we can’t tell whether the flag was saved. Press Save again: if it was, it isn’t saved twice.';
const DROPPED_MARK =
  'The connection dropped, so we can’t tell whether the change was marked. Press Mark entered in error again: if it was, nothing changes.';
const ARCHIVED = 'This flag is no longer on your team’s list, so it can only be cleared.';
const KEPT_BACK = 'Only the person who made it and Program Admins see why.';

/** The patient page's addresses, by ID only, with the panel's word for what it just did. */
function expectOnlyIds(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(/\/patients(\/[0-9a-f-]{36}(\?flag=(saved|marked))?)?$|\/(home|sign-in.*)$/);
}

async function asJson<T>(email: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiCall(await staffToken(email), method, path, body);
  expect(res.status, `${method} ${path}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** The team's active flags a person may see, as the panel and the search list them. */
const listedFor = (email: string) => asJson<ListedFlag[]>(email, 'GET', '/v1/presets/flags');

/** A flag of the team's by its name, as a Program Admin's list gives it. */
async function flagNamed(name: string): Promise<ListedFlag> {
  const flag = (await listedFor(ADMIN)).find((f) => f.name === name);
  expect(flag, name).toBeDefined();
  return flag!;
}

/** "Red · High": a flag as its pill and its choices read. */
const pill = (f: { colorName: string; name: string }) => `${f.colorName} · ${f.name}`;

/** The chart as a person's role may see it, read through the API. */
const chartFor = (email: string, patientId: string) =>
  asJson<Chart>(email, 'GET', `/v1/patients/${patientId}`);

/** A made-up patient, registered as a phone registers one: "Wren Kqzvbn", with a birth date. */
async function freshPatient(minutesAgo = 30, family = newSurname()) {
  const name = `Wren ${family}`;
  const patient = newPatient(
    { preferredName: name, birth: { precision: 'day', date: newBirthDate() } },
    minutesAgo,
  );
  await (await phoneOf(ADMIN)).send(patient);
  return { id: patient.recordId, name, family };
}

/** A flag set or cleared at the desk, as the panel's route handler posts it, by [email]: a case's setup. */
async function changeFlag(
  email: string,
  patientId: string,
  flagId: string,
  action: 'set' | 'clear',
  reason: string,
) {
  const res = await apiCall(await staffToken(email), 'POST', `/v1/patients/${patientId}/flags`, {
    id: randomUUID(),
    flagId,
    action,
    reason,
  });
  expect(res.status, `${action} ${flagId}`).toBe(201);
}

/** A condition of the team's own, added as Team setup adds one, at the end of its list; its ID. */
async function addCondition(
  name: string,
  color: string,
  body: Record<string, unknown> = {},
  reason = 'Demo: set up for a test',
) {
  const rows = await asJson<{ body: { tier: string; rank: number } }[]>(
    ADMIN,
    'GET',
    '/v1/admin/presets/flag',
  );
  const ranks = rows.filter((r) => r.body.tier === 'secondary').map((r) => r.body.rank);
  const made = await asJson<{ id: string }>(ADMIN, 'POST', '/v1/admin/presets/flag', {
    body: {
      name,
      tier: 'secondary',
      criteria: '',
      color,
      rank: Math.max(0, ...ranks) + 10,
      sensitive: false,
      ...body,
    },
    reason,
  });
  return made.id;
}

/** Another admin removes a flag from the team's list, at the version it is at. */
async function removeFlag(id: string) {
  const rows = await asJson<{ id: string; version: number }[]>(ADMIN, 'GET', '/v1/admin/presets/flag');
  const row = rows.find((r) => r.id === id)!;
  await asJson(ADMIN, 'POST', `/v1/admin/presets/flag/${id}/archive`, {
    baseVersion: row.version,
    reason: 'Demo: taken off the list for a test',
  });
}

/** The patient page's parts a case reads. */
function partsOf(page: Page) {
  const panel = page.getByRole('region', { name: 'Flags', exact: true });
  const form = page.getByRole('form', { name: 'Set or clear a flag' });
  return {
    pills: page.getByRole('list', { name: 'Flags', exact: true }),
    panel,
    rows: panel.locator('tbody tr'),
    status: panel.getByRole('status'),
    form,
    alert: form.getByRole('alert'),
    flag: form.getByLabel('Flag', { exact: true }),
    reason: form.getByLabel('Reason', { exact: true }),
    save: form.getByRole('button', { name: 'Save', exact: true }),
    action: (a: 'Set' | 'Clear') => form.getByRole('radio', { name: a, exact: true }),
  };
}

/** Fills the panel's form: the flag by its choice's words, set or clear, and the reason. */
async function fill(
  parts: ReturnType<typeof partsOf>,
  choice: string,
  action: 'Set' | 'Clear',
  reason: string,
) {
  await parts.flag.selectOption({ label: choice });
  await parts.action(action).check();
  await parts.reason.fill(reason);
}

/** [words] as a pattern that matches them as written. */
const literal = (words: string) => new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** A field's own words beside it, read as part of its description. */
const besideIt = (field: Locator, words: string) => expect(field).toHaveAccessibleDescription(literal(words));

// ------------------------------------------------------------------------------------------------
// The Done when's step 8 (design 10.1): a flag set on a phone shows on the patient's chart
// ------------------------------------------------------------------------------------------------

interface Story {
  people: Record<string, { email: string; displayName: string }>;
  patient: { id: string } & Record<string, unknown>;
  presets: {
    ref: string;
    kind: string;
    body: { name: string; tier: string; color: string; rank: number };
    reason: string;
  }[];
  steps: {
    n: number;
    by?: string;
    flagChange?: { patient: string; flag: string; action: 'set' | 'clear'; reason: string };
    expect: Record<string, unknown>;
  }[];
}

const STORY = JSON.parse(
  readFileSync(
    new URL('../../../packages/contract/test-vectors/presets-done-when.json', import.meta.url),
    'utf8',
  ),
) as Story;

/** Canonical JSON (services/api/src/sync/canonical.ts) for the plain ASCII values a phone sends here. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
const hashOf = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

test('step 8 of the Done when: the flag a phone set offline shows on the patient’s chart, as the story gives it', async ({
  page,
}) => {
  const eighth = STORY.steps.find((s) => s.n === 8)!;
  const change = eighth.flagChange!;
  const expected = eighth.expect as {
    receipts: { status: string; hashConfirmed: boolean };
    chart: {
      flags: { primary: null; secondary: (Omit<Schemas['ChartFlag'], 'flagId'> & { flag: string })[] };
      pill: string;
      history: { flag: string; action: string; by: string; holdsTheReason: boolean }[];
    };
  };
  const preset = STORY.presets.find((p) => p.ref === change.flag)!;
  const staff = STORY.people[eighth.by!]!;
  expect(change.patient).toBe(STORY.patient.id);

  // Step 4's flag, as presets.spec.ts adds it through Team setup. That spec runs after this one, and
  // a name is taken only by an active preset: the flag made here is removed once this case is done.
  const rows = await asJson<{ id: string; name: string; state: string }[]>(
    ADMIN,
    'GET',
    '/v1/admin/presets/flag',
  );
  const held = rows.find((r) => r.name === preset.body.name && r.state === 'active');
  const flagId =
    held?.id ??
    (
      await asJson<{ id: string }>(ADMIN, 'POST', '/v1/admin/presets/flag', {
        body: preset.body,
        reason: preset.reason,
      })
    ).id;
  try {
    // The patient, registered by the staff member's phone before step 1 (the story's note).
    const phone = await registerPhone(staff.email);
    let seq = 0;
    const sent = (entity: string, recordId: string, value: unknown, minutesAgo: number) => ({
      changeId: randomUUID(),
      seq: ++seq,
      entity,
      recordId,
      op: 'create',
      value,
      valueHash: hashOf(value),
      baseVersion: 0,
      deviceTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      clockVerified: true,
    });
    const { id: patientId, ...fields } = STORY.patient;
    const known = await apiCall(await staffToken(ADMIN), 'GET', `/v1/patients/${patientId}`);
    if (known.status === 404) {
      const registered = await phone.push([sent('patient', patientId, newPatient(fields, 60).value, 60)]);
      expect((registered.results as { status: string }[]).map((r) => r.status)).toEqual(['accepted']);
    }

    // Still offline, the staff member sets the flag with a reason; then the phone syncs.
    const value = { patientId, flagId, action: change.action, reason: change.reason };
    const pushed = await phone.push([sent('patient_flag_change', randomUUID(), value, 5)]);
    const [receipt] = pushed.results as { status: string; hash?: string }[];
    expect(receipt!.status).toBe(expected.receipts.status);
    expect(receipt!.hash === hashOf(value)).toBe(expected.receipts.hashConfirmed);

    // The portal's chart shows the flag: its pill in the header, its change in the panel's history.
    await signIn(page, ADMIN);
    const traffic = watchTraffic(page);
    await page.goto(`/patients/${patientId}`);
    const parts = partsOf(page);
    await expect(parts.pills.getByText(expected.chart.pill, { exact: true })).toBeVisible();
    const [row] = expected.chart.history;
    const ours = parts.rows.filter({ hasText: preset.body.name }).last();
    await expect(ours).toContainText(row!.action === 'set' ? 'Set' : 'Cleared');
    await expect(ours).toContainText(STORY.people[row!.by]!.displayName);
    if (row!.holdsTheReason) await expect(ours).toContainText(change.reason);

    // As the API worked it out: the story's flag among the conditions, as the flag is now.
    const chart = await chartFor(ADMIN, patientId);
    const [want] = expected.chart.flags.secondary;
    const { flag: _ref, rank, ...rest } = want!;
    expect(chart.flags!.primary).toBe(expected.chart.flags.primary);
    expect(chart.flags!.secondary.find((f) => f.flagId === flagId)).toMatchObject({
      ...rest,
      // A flag presets.spec.ts added through its page goes after every flag of its list, so the
      // story's rank holds only for the one made here.
      ...(held ? {} : { rank }),
    });
    await expectAccessible(page, 'step 8, the chart');
    await expectReflow(page, 'step 8, the chart');
    await expectNothingStored(page, 'step 8, the chart');
    expectOnlyIds(traffic.addresses);
  } finally {
    if (!held) await removeFlag(flagId);
  }
});

// ------------------------------------------------------------------------------------------------
// The header and the panel's history
// ------------------------------------------------------------------------------------------------

test('@responsive the header shows the risk level, then each condition, by its pill, and the panel each change: the flag, set or cleared, who, when and why', async ({
  page,
}) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  const frost = await flagNamed('Frost risk');
  const dehydration = await flagNamed('Dehydration risk');
  const medium = await flagNamed('Medium');
  await changeFlag(JORDAN, patient.id, medium.flagId, 'set', 'Demo: first seen this week');
  await changeFlag(JORDAN, patient.id, dehydration.flagId, 'set', 'Demo: no water source nearby');
  await changeFlag(CASEY, patient.id, frost.flagId, 'set', 'Demo: sleeps by the made-up river');
  await changeFlag(CASEY, patient.id, high.flagId, 'set', 'Demo: open wound and nowhere warm');

  await signIn(page, ADMIN);
  const csp = watchCsp(page);
  const traffic = watchTraffic(page);
  await page.goto(`/patients/${patient.id}`);
  await expect(page).toHaveTitle('Patient · Sineobex');
  const parts = partsOf(page);
  // The risk level first, then the conditions by rank, each naming its colour and its flag.
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(high), pill(frost), pill(dehydration)]);
  // Each change, oldest first, with who made it and why; the risk level High took Medium's place.
  await expect(parts.rows).toHaveCount(4);
  await expect(parts.rows.nth(0)).toContainText('Medium');
  await expect(parts.rows.nth(0)).toContainText('Set');
  await expect(parts.rows.nth(0)).toContainText('Jordan Lee (demo)');
  await expect(parts.rows.nth(0)).toContainText('Demo: first seen this week');
  await expect(parts.rows.nth(3)).toContainText('High');
  await expect(parts.rows.nth(3)).toContainText('Casey Nguyen (demo)');
  await expect(parts.rows.nth(3)).toContainText('Demo: open wound and nowhere warm');
  // The seeded risk level, on the patient the seed gave it to.
  await page.goto('/patients/5eed0000-0000-4000-8000-000000000021');
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(high)]);
  await page.goBack();

  await expectAccessible(page, 'a patient’s flags');
  await expectReflow(page, 'a patient’s flags');
  await expectNothingStored(page, 'a patient’s flags');
  expectOnlyIds(traffic.addresses);
  expect(csp).toEqual([]);
});

// ------------------------------------------------------------------------------------------------
// Save (D115)
// ------------------------------------------------------------------------------------------------

test('Save makes one change, pressed twice or pressed again after its answer was lost; changed after a lost answer, it says why nothing was saved', async ({
  page,
}) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  const frost = await flagNamed('Frost risk');
  const dehydration = await flagNamed('Dehydration risk');
  const route = `**/patients/${patient.id}/flags`;
  const ofFlag = async (flagId: string) =>
    (await chartFor(ADMIN, patient.id)).flags!.history.filter((h) => h.flagId === flagId);

  await signIn(page, ADMIN);
  const traffic = watchTraffic(page);
  await page.goto(`/patients/${patient.id}`);
  let parts = partsOf(page);
  await expect(parts.panel).toContainText('No flag has been set or cleared.');

  // Pressed twice before the first answer: both posts carry the form's one ID, so one change.
  await fill(parts, pill(high), 'Set', 'Demo: open wound and nowhere warm');
  await parts.form.evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}\\?flag=saved$`));
  parts = partsOf(page);
  await expect(parts.status).toHaveText(SAVED);
  await expect(parts.status).toBeFocused();
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(high)]);
  await expect(parts.rows).toHaveCount(1);
  expect(await ofFlag(high.flagId)).toHaveLength(1);

  // The API makes the change and its answer is lost on the way back: the panel can't tell.
  await fill(parts, pill(frost), 'Set', 'Demo: sleeps by the made-up river');
  await page.route(route, async (r) => {
    expect((await r.fetch()).status()).toBe(200);
    await r.abort('connectionreset');
  });
  await parts.save.click();
  await expect(parts.alert).toBeFocused();
  await expect(parts.alert).toHaveText(DROPPED);
  await expect(parts.reason).toHaveValue('Demo: sleeps by the made-up river');
  expect(await ofFlag(frost.flagId)).toHaveLength(1);
  await page.unroute(route);
  await expectAccessible(page, 'Save, its answer lost', { inPlace: true });
  // Pressed again, the same change is answered done, and nothing is saved twice. The page loads
  // again at the address it is at, so wait for the load itself.
  await Promise.all([page.waitForEvent('load'), parts.save.click()]);
  parts = partsOf(page);
  await expect(parts.status).toHaveText(SAVED);
  await expect(parts.rows).toHaveCount(2);
  expect(await ofFlag(frost.flagId)).toHaveLength(1);

  // Lost again, then the reason changed before Save: the form's change went through, so this one isn't saved.
  await fill(parts, pill(dehydration), 'Set', 'Demo: no water source nearby');
  await page.route(route, async (r) => {
    await r.fetch();
    await r.abort('connectionreset');
  });
  await parts.save.click();
  await expect(parts.alert).toHaveText(DROPPED);
  await page.unroute(route);
  await parts.reason.fill('Demo: no water source nearby, and hot days');
  await parts.save.click();
  await expect(parts.alert).toBeFocused();
  await expect(parts.alert).toHaveText(
    'This form already saved a change, so this one wasn’t saved. Reload the page to see the flags as they are now.',
  );
  const dehydrated = await ofFlag(dehydration.flagId);
  expect(dehydrated.map((h) => h.reason)).toEqual(['Demo: no water source nearby']);

  await expectNothingStored(page, 'Save');
  expectOnlyIds(traffic.addresses);
  // The reasons went in the posts' bodies, and in no address.
  for (const address of traffic.addresses) expect(address).not.toContain('water');
});

// ------------------------------------------------------------------------------------------------
// Entered in error (section 11, rows 23 and 24)
// ------------------------------------------------------------------------------------------------

test('@responsive Entered in error is offered to the change’s author and to a Program Admin, asks for a reason, and its reasons reach only them', async ({
  page,
}) => {
  const patient = await freshPatient();
  const frost = await flagNamed('Frost risk');
  const dehydration = await flagNamed('Dehydration risk');
  const why = 'Demo: sleeps by the made-up river';
  await changeFlag(CASEY, patient.id, frost.flagId, 'set', why);
  await changeFlag(JORDAN, patient.id, dehydration.flagId, 'set', 'Demo: no water source nearby');
  const markOf = (parts: ReturnType<typeof partsOf>, name: string) =>
    parts.panel.getByRole('button', { name: new RegExp(`^Entered in error: Set ${name},`) });

  // Jordan made neither the change nor manages the team's people: Entered in error is not offered on Casey's.
  await signIn(page, JORDAN);
  await page.goto(`/patients/${patient.id}`);
  let parts = partsOf(page);
  await expect(parts.rows.filter({ hasText: 'Frost risk' })).toContainText(why);
  await expect(markOf(parts, 'Frost risk')).toHaveCount(0);
  await expect(markOf(parts, 'Dehydration risk')).toHaveCount(1);

  // Casey marks her own change, with a reason the panel and then the API refuse first.
  await signIn(page, CASEY);
  const traffic = watchTraffic(page);
  await page.goto(`/patients/${patient.id}`);
  parts = partsOf(page);
  await expect(markOf(parts, 'Dehydration risk')).toHaveCount(0);
  const button = markOf(parts, 'Frost risk');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const heading = parts.panel.getByRole('heading', { name: /^Mark entered in error: Set Frost risk,/ });
  await expect(heading).toBeFocused();
  await expect(parts.panel.locator('#flags-mark')).toContainText(
    'This set no longer counts among the patient’s flags. It stays in the history, marked.',
  );
  // Cancel gives focus back to the button that opened it.
  await parts.panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(button).toBeFocused();
  await button.click();
  const mark = page.getByRole('form', { name: 'Mark entered in error' });
  const reason = mark.getByLabel('Why it was entered in error');
  await expect(reason).toHaveAttribute('autocomplete', 'off');
  await mark.getByRole('button', { name: 'Mark entered in error' }).click();
  await expect(mark.getByRole('alert')).toBeFocused();
  await besideIt(reason, 'Give a reason.');
  await reason.fill('ab');
  await mark.getByRole('button', { name: 'Mark entered in error' }).click();
  await besideIt(reason, 'Give a reason of 3 to 300 characters.');
  await expectAccessible(page, 'Entered in error, its reason refused', { inPlace: true });
  await expectReflow(page, 'Entered in error, its reason refused');
  await reason.fill('Demo: set on the wrong patient');
  await mark.getByRole('button', { name: 'Mark entered in error' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}\\?flag=marked$`));
  parts = partsOf(page);
  await expect(parts.status).toHaveText(MARKED);
  await expect(parts.status).toBeFocused();
  // It leaves the patient's flags and stays in the history, marked, with who and when.
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(dehydration)]);
  const marked = parts.rows.filter({ hasText: 'Frost risk' });
  await expect(marked).toContainText('Entered in error by Casey Nguyen (demo)');
  await expect(marked).toContainText(why);
  await expect(marked).toContainText('Entered in error because: Demo: set on the wrong patient');
  await expect(markOf(parts, 'Frost risk')).toHaveCount(0);
  await expectNothingStored(page, 'Entered in error');
  expectOnlyIds(traffic.addresses);

  // Jordan sees that it was marked, by whom and when, and neither reason.
  await signIn(page, JORDAN);
  await page.goto(`/patients/${patient.id}`);
  parts = partsOf(page);
  const seen = parts.rows.filter({ hasText: 'Frost risk' });
  await expect(seen).toContainText('Entered in error by Casey Nguyen (demo)');
  await expect(seen).toContainText(KEPT_BACK);
  await expect(parts.panel).not.toContainText(why);
  await expect(parts.panel).not.toContainText('wrong patient');

  // A Program Admin reads both, and may mark anyone's change.
  await signIn(page, ADMIN);
  await page.goto(`/patients/${patient.id}`);
  parts = partsOf(page);
  await expect(parts.rows.filter({ hasText: 'Frost risk' })).toContainText('Demo: set on the wrong patient');
  await expect(markOf(parts, 'Dehydration risk')).toHaveCount(1);
  await expectAccessible(page, 'the history with a change entered in error');
});

// Review finding R2: a clear marked entered in error brings back the flag it cleared, and says so.
test('Entered in error on a clear says the flag it cleared can come back, and the header shows it back', async ({
  page,
}) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  await changeFlag(ADMIN, patient.id, high.flagId, 'set', 'Demo: open wound and nowhere warm');
  await changeFlag(CASEY, patient.id, high.flagId, 'clear', 'Demo: pressed Clear by mistake');

  await signIn(page, CASEY);
  await page.goto(`/patients/${patient.id}`);
  let parts = partsOf(page);
  await expect(parts.pills).toHaveCount(0);
  await parts.panel.getByRole('button', { name: /^Entered in error: Cleared High,/ }).click();
  await expect(parts.panel.locator('#flags-mark')).toContainText(
    'This clear no longer counts, so the flag it cleared can come back on the patient. It stays in the history, marked.',
  );
  await expect(parts.panel.locator('#flags-mark')).not.toContainText('leaves the patient’s flags');
  const mark = page.getByRole('form', { name: 'Mark entered in error' });
  await mark.getByLabel('Why it was entered in error').fill('Demo: cleared the wrong flag');
  await mark.getByRole('button', { name: 'Mark entered in error' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}\\?flag=marked$`));
  parts = partsOf(page);
  await expect(parts.status).toHaveText(MARKED);
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(high)]);
  expect((await chartFor(ADMIN, patient.id)).flags!.primary?.flagId).toBe(high.flagId);
});

// Review finding R4: the panel records no change that would change nothing, as the phone's sheet
// writes only what differs.
test('a Set of a flag the patient has, or a Clear of one they don’t, is said beside it and never sent', async ({
  page,
}) => {
  const patient = await freshPatient();
  const medium = await flagNamed('Medium');
  const frost = await flagNamed('Frost risk');
  await changeFlag(ADMIN, patient.id, frost.flagId, 'set', 'Demo: sleeps by the made-up river');

  await signIn(page, ADMIN);
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/patients/${patient.id}/flags`)) posted.push(r.url());
  });
  await page.goto(`/patients/${patient.id}`);
  const parts = partsOf(page);
  const action = parts.form.getByRole('group', { name: 'Set or clear' });
  await fill(parts, pill(medium), 'Clear', 'Demo: pressed Clear by mistake');
  await parts.save.click();
  await expect(parts.alert).toBeFocused();
  await besideIt(action, 'This patient doesn’t have this flag, so there’s nothing to clear.');
  await fill(parts, `${pill(frost)} (on this patient)`, 'Set', 'Demo: still by the river');
  await parts.save.click();
  await expect(parts.alert).toBeFocused();
  await besideIt(action, 'This patient has this flag already.');
  await expectAccessible(page, 'a change that changes nothing', { inPlace: true });
  expect(posted).toEqual([]);
  expect((await chartFor(ADMIN, patient.id)).flags!.history).toHaveLength(1);

  // The same flag the other way is a change, and is saved.
  await parts.action('Clear').check();
  await parts.save.click();
  await expect(page).toHaveURL(/\?flag=saved$/);
  expect(posted).toHaveLength(1);
});

// Review finding R1: an answer is the route handler's only in its shape; JSON from a gateway or a
// platform in front of the portal says nothing of whether the act went through.
test('an answer that isn’t the route handler’s own is read as a dropped connection, and what was typed stays', async ({
  page,
}) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  const frost = await flagNamed('Frost risk');
  await changeFlag(ADMIN, patient.id, frost.flagId, 'set', 'Demo: sleeps by the made-up river');
  const foreign = [
    { status: 500, body: { error: { code: 'internal', message: 'Something broke' } } },
    { status: 502, body: { message: 'Internal Server Error' } },
  ];

  await signIn(page, ADMIN);
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await page.goto(`/patients/${patient.id}`);
  const parts = partsOf(page);
  const saveRoute = `**/patients/${patient.id}/flags`;
  for (const { status, body } of foreign) {
    await page.route(saveRoute, (r) =>
      r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
    );
    await fill(parts, pill(high), 'Set', 'Demo: open wound and nowhere warm');
    await parts.save.click();
    await expect(parts.alert).toBeFocused();
    await expect(parts.alert).toHaveText(DROPPED);
    await expect(parts.reason).toHaveValue('Demo: open wound and nowhere warm');
    await page.unroute(saveRoute);
  }

  const markRoute = `**/patients/${patient.id}/flag-changes/*/entered-in-error`;
  await parts.panel.getByRole('button', { name: /^Entered in error: Set Frost risk,/ }).click();
  const mark = page.getByRole('form', { name: 'Mark entered in error' });
  const reason = mark.getByLabel('Why it was entered in error');
  for (const { status, body } of foreign) {
    await page.route(markRoute, (r) =>
      r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
    );
    await reason.fill('Demo: set on the wrong patient');
    await mark.getByRole('button', { name: 'Mark entered in error' }).click();
    await expect(mark.getByRole('alert')).toBeFocused();
    await expect(mark.getByRole('alert')).toHaveText(DROPPED_MARK);
    await expect(reason).toHaveValue('Demo: set on the wrong patient');
    await page.unroute(markRoute);
  }
  await expectAccessible(page, 'an answer not the route handler’s own', { inPlace: true });
  expect(crashes).toEqual([]);
  const history = (await chartFor(ADMIN, patient.id)).flags!.history;
  expect(history.map((h) => [h.name, h.action, h.enteredInError])).toEqual([['Frost risk', 'set', null]]);
});

// Review finding R5: a session that ends with the panel open goes to sign-in, from either act, and
// what the press carried was never received.
test('a session that ended with the panel open goes to sign-in from Save and from Entered in error, and nothing is saved', async ({
  page,
  context,
}) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  const frost = await flagNamed('Frost risk');
  await changeFlag(ADMIN, patient.id, frost.flagId, 'set', 'Demo: sleeps by the made-up river');
  const history = async () =>
    (await chartFor(ADMIN, patient.id)).flags!.history.map((h) => [h.name, h.action, h.enteredInError]);

  await signIn(page, ADMIN);
  await page.goto(`/patients/${patient.id}`);
  let parts = partsOf(page);
  await fill(parts, pill(high), 'Set', 'Demo: open wound and nowhere warm');
  await context.clearCookies();
  await parts.save.click();
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, ADMIN);
  expect(await history()).toEqual([['Frost risk', 'set', null]]);

  await page.goto(`/patients/${patient.id}`);
  parts = partsOf(page);
  await parts.panel.getByRole('button', { name: /^Entered in error: Set Frost risk,/ }).click();
  const mark = page.getByRole('form', { name: 'Mark entered in error' });
  await mark.getByLabel('Why it was entered in error').fill('Demo: set on the wrong patient');
  await context.clearCookies();
  await mark.getByRole('button', { name: 'Mark entered in error' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, ADMIN);
  expect(await history()).toEqual([['Frost risk', 'set', null]]);
  // Signed in again, the page shows the form empty and the change unmarked.
  await page.goto(`/patients/${patient.id}`);
  parts = partsOf(page);
  await expect(parts.rows).toHaveCount(1);
  await expect(parts.rows).not.toContainText('Entered in error by');
});

/** Words drawn across two lines in the Flags history: none should be, but for one longer than its column. */
function splitWords(): string[] {
  const out: string[] = [];
  const table = document.querySelector('#flags table');
  if (!table) return out;
  // Stacked, the table's heading row is kept for screen readers in a box one pixel wide.
  const head = table.querySelector('thead');
  const headShown = !!head && head.getBoundingClientRect().width > 1;
  const range = document.createRange();
  const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest('.sr-only') || (!headShown && el.closest('thead'))) continue;
    const text = node.textContent ?? '';
    for (const m of text.matchAll(/\S{2,}/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const lines = new Set(
        [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
      );
      if (lines.size > 1) out.push(m[0]);
    }
  }
  return out;
}

// Review finding R3: one long reason took nearly all of the history's width, and every other column
// split mid-word, at the default width and at 200% zoom.
test('the Flags history splits no word with a reason of 500 characters, at 1280 and 640 px and on a phone', async ({
  page,
}) => {
  const patient = await freshPatient();
  const frost = await flagNamed('Frost risk');
  const dehydration = await flagNamed('Dehydration risk');
  const long =
    `Demo: ${'slept outside again in the made-up park by the river path with wet clothes and no blanket, '.repeat(6)}`
      .slice(0, 500)
      .trim();
  expect([...long].length).toBeLessThanOrEqual(500);
  await changeFlag(CASEY, patient.id, frost.flagId, 'set', long);
  await changeFlag(ADMIN, patient.id, dehydration.flagId, 'set', 'Demo: no water source nearby');

  await signIn(page, ADMIN);
  await page.goto(`/patients/${patient.id}`);
  const parts = partsOf(page);
  await expect(parts.rows).toHaveCount(2);
  for (const width of [1280, 640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await parts.panel.locator('table').scrollIntoViewIfNeeded();
    expect(await page.evaluate(splitWords), `split words at ${width} px`).toEqual([]);
    await expectReflow(page, `the Flags history at ${width} px`, width);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectAccessible(page, 'the Flags history with a long reason', { inPlace: true });
});

// ------------------------------------------------------------------------------------------------
// A flag no longer on the team's list (5.1), and each refusal said beside its field (7)
// ------------------------------------------------------------------------------------------------

test('a flag no longer on the team’s list stays on the patient, says so, and is offered only to clear', async ({
  page,
}) => {
  const patient = await freshPatient();
  const id = await addCondition('Demo: Wet socks', 'grey');
  await changeFlag(ADMIN, patient.id, id, 'set', 'Demo: socks soaked through');
  await removeFlag(id);
  const words = 'Grey · Demo: Wet socks';

  await signIn(page, ADMIN);
  const posted: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/patients/${patient.id}/flags`)) posted.push(r.url());
  });
  await page.goto(`/patients/${patient.id}`);
  let parts = partsOf(page);
  await expect(parts.pills.getByRole('listitem')).toHaveText([`${words} · No longer on the team’s list`]);
  // Offered only to clear: a Set of it is refused beside the flag before anything is sent.
  await fill(parts, `${words} · No longer on the team’s list (clear only)`, 'Set', 'Demo: still wet');
  await parts.save.click();
  await expect(parts.alert).toBeFocused();
  await besideIt(parts.flag, ARCHIVED);
  await expect(parts.alert.getByRole('link')).toHaveText([ARCHIVED]);
  expect(posted).toEqual([]);
  await expectAccessible(page, 'a removed flag, set', { inPlace: true });
  await expectReflow(page, 'a removed flag, set');

  await parts.action('Clear').check();
  await parts.save.click();
  await expect(page).toHaveURL(/\?flag=saved$/);
  parts = partsOf(page);
  await expect(parts.pills).toHaveCount(0);
  await expect(parts.rows.filter({ hasText: 'Cleared' })).toContainText('Demo: Wet socks');
  expect(posted).toHaveLength(1);
});

test('each refusal of the flag routes is said in plain words beside its field', async ({ page }) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  const pregnancy = await flagNamed('Pregnancy');
  const cold = await addCondition('Demo: Cold hands', 'grey');

  await signIn(page, ADMIN);
  await page.goto(`/patients/${patient.id}`);
  const parts = partsOf(page);
  // Nothing chosen: the panel's own words, each linked to its field.
  await parts.save.click();
  await expect(parts.alert).toBeFocused();
  await expect(parts.alert.getByRole('link')).toHaveText([
    'Choose a flag.',
    'Choose Set or Clear.',
    'Give a reason.',
  ]);
  await expectAccessible(page, 'the flag form, nothing chosen', { inPlace: true });

  // Removed by another admin since the page loaded: the API refuses the Set (409 archived).
  await removeFlag(cold);
  await fill(parts, 'Grey · Demo: Cold hands', 'Set', 'Demo: no gloves');
  await parts.save.click();
  await besideIt(parts.flag, ARCHIVED);
  // A reason past 500 characters (reason_invalid): the box itself sets no limit of its own.
  await fill(parts, pill(high), 'Set', `Demo: ${'x'.repeat(495)}`);
  await parts.save.click();
  await besideIt(parts.reason, 'Give a reason of 1 to 500 characters.');
  await expect(parts.pills).toHaveCount(0);

  // Casey's role loses patients.edit while her page is open (403): said, never sent home.
  await signIn(page, CASEY);
  await page.goto(`/patients/${patient.id}`);
  await setRole(CASEY, 'billing_data');
  try {
    await fill(parts, pill(high), 'Set', 'Demo: open wound and nowhere warm');
    await parts.save.click();
    await expect(parts.alert).toHaveText(
      'Your role doesn’t let you change flags. Reload the page to see what you can do.',
    );
    await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}$`));
  } finally {
    await setRole(CASEY, 'healthcare_staff');
  }

  // Jordan's role loses sight of sensitive flags while his page is open (403 flag_hidden).
  await signIn(page, JORDAN);
  await page.goto(`/patients/${patient.id}`);
  await setRole(JORDAN, 'community_health_worker');
  try {
    await fill(parts, pill(pregnancy), 'Set', 'Demo: told the team this week');
    await parts.save.click();
    await besideIt(parts.flag, 'Your role can’t see this flag, so you can’t change it.');
  } finally {
    await setRole(JORDAN, 'healthcare_staff');
  }
  expect((await chartFor(ADMIN, patient.id)).flags!.history).toEqual([]);
});

// ------------------------------------------------------------------------------------------------
// A sensitive flag (section 11, row 29), and Status check due (5.3)
// ------------------------------------------------------------------------------------------------

test('a sensitive flag is absent for a reader the flag rule hides it from: header, history, choices and search', async ({
  page,
}) => {
  const patient = await freshPatient();
  const high = await flagNamed('High');
  const pregnancy = await flagNamed('Pregnancy');
  await changeFlag(ADMIN, patient.id, high.flagId, 'set', 'Demo: open wound and nowhere warm');
  await changeFlag(ADMIN, patient.id, pregnancy.flagId, 'set', 'Demo: told the team this week');

  await signIn(page, ADMIN);
  await page.goto(`/patients/${patient.id}`);
  let parts = partsOf(page);
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(high), pill(pregnancy)]);
  await expect(parts.rows).toHaveCount(2);

  // Robin's role sees no sensitive flag: absent, never blanked, wherever the page reads flags.
  await signIn(page, ROBIN);
  await page.goto(`/patients/${patient.id}`);
  parts = partsOf(page);
  await expect(parts.pills.getByRole('listitem')).toHaveText([pill(high)]);
  await expect(parts.rows).toHaveCount(1);
  // Nor among the choices: the main's text holds every option's.
  await expect(parts.flag.locator('option')).toHaveCount((await listedFor(ROBIN)).length + 1);
  await expect(page.getByRole('main')).not.toContainText('Pregnancy');
  await expect(page.getByRole('main')).not.toContainText('told the team');
  await expectAccessible(page, 'a patient’s flags, a reader without sensitive flags');
  await page.goto('/patients');
  await expect(page.getByRole('group', { name: 'Conditions (optional)' })).not.toContainText('Pregnancy');
  expect((await listedFor(ROBIN)).map((f) => f.flagId)).not.toContain(pregnancy.flagId);
});

test('@responsive Status check due marks a New or Ongoing problem past the team’s window, never one within it or resolved', async ({
  page,
}) => {
  const days = (n: number) => n * 24 * 60;
  const patient = await freshPatient(days(210));
  const problem = (title: string, status: 'new' | 'ongoing', minutesAgo: number): PhoneChange => ({
    entity: 'problem',
    recordId: randomUUID(),
    op: 'create',
    value: { patientId: patient.id, title: `${title} ${patient.family}`, status },
    minutesAgo,
  });
  const old = problem('Demo: knee pain', 'ongoing', days(200));
  const recent = problem('Demo: cough', 'new', 5);
  const settled = problem('Demo: rash', 'new', days(200));
  await (
    await phoneOf(ADMIN)
  ).send(old, recent, settled, {
    entity: 'problem',
    recordId: settled.recordId,
    op: 'set',
    field: 'status',
    value: { status: 'resolved', encounterId: null },
    baseVersion: 1,
    minutesAgo: days(199),
  });

  await signIn(page, ADMIN);
  await page.goto(`/patients/${patient.id}`);
  const problems = page.getByRole('region', { name: 'Problems' });
  const card = (title: string) =>
    problems.getByRole('listitem').filter({ hasText: `${title} ${patient.family}` });
  await expect(card('Demo: knee pain')).toContainText('Status check due');
  await expect(card('Demo: cough')).not.toContainText('Status check due');
  await expect(card('Demo: rash')).not.toContainText('Status check due');
  await expect(problems.getByText('Status check due', { exact: true })).toHaveCount(1);
  // The API's answer, which the page only says.
  const chart = await chartFor(ADMIN, patient.id);
  const due = (id: string) => chart.problems!.find((p) => p.id === id)!.attributes.statusCheckDue;
  expect([due(old.recordId), due(recent.recordId), due(settled.recordId)]).toEqual([true, false, false]);
  await expectAccessible(page, 'Status check due');
  await expectReflow(page, 'Status check due');
});

// ------------------------------------------------------------------------------------------------
// The search's Risk level and Conditions (section 11, row 37)
// ------------------------------------------------------------------------------------------------

test('@responsive Risk level and Conditions narrow a name search in the search’s own body, and a flag alone searches nothing', async ({
  page,
}) => {
  const family = newSurname();
  const both = await freshPatient(30, family);
  const one = await freshPatient(30, family);
  const high = await flagNamed('High');
  const frost = await flagNamed('Frost risk');
  await changeFlag(ADMIN, both.id, high.flagId, 'set', 'Demo: open wound and nowhere warm');
  await changeFlag(ADMIN, both.id, frost.flagId, 'set', 'Demo: sleeps by the made-up river');
  await changeFlag(ADMIN, one.id, high.flagId, 'set', 'Demo: open wound and nowhere warm');

  test.slow();
  await signIn(page, ADMIN);
  const traffic = watchTraffic(page);
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto('/patients');
  const form = page.getByRole('form', { name: 'Search patients' });
  const results = page.getByRole('table', { name: 'Search results' });
  const riskLevel = form.getByLabel('Risk level (optional)');
  const conditions = form.getByRole('group', { name: 'Conditions (optional)' });
  await expect(riskLevel.locator('option')).toHaveText([
    'Any risk level',
    ...(await listedFor(ADMIN)).filter((f) => f.tier === 'primary').map(pill),
  ]);
  await expectAccessible(page, '/patients with the flag filters');

  // The two patients' own name: every patient this file makes is a Wren.
  await form.getByLabel(/^Name, street name or description/).fill(family);
  await riskLevel.selectOption({ label: pill(high) });
  await form.getByRole('button', { name: 'Search' }).click();
  await expect(form.getByRole('status')).toContainText('2 people found');
  await conditions.getByRole('checkbox', { name: pill(frost) }).check();
  // The flags go in the search's own POST, with the name.
  const posted = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/patients',
  );
  await form.getByRole('button', { name: 'Search' }).click();
  const body = (await posted).postData() ?? '';
  for (const flagId of [high.flagId, frost.flagId]) expect(body).toContain(flagId);
  await expect(form.getByRole('status')).toContainText('1 person found');
  await expect(results.getByRole('row')).toHaveCount(2);
  await expect(results).toContainText(both.name);
  // The form keeps what it searched by.
  await expect(conditions.getByRole('checkbox', { name: pill(frost) })).toBeChecked();
  await expect(riskLevel).toHaveValue(high.flagId);
  await expectAccessible(page, 'a search narrowed by flags', { inPlace: true });
  await expectReflow(page, 'a search narrowed by flags');

  // A flag alone browses nothing, as a year alone doesn't.
  await form.getByLabel(/^Name, street name or description/).fill('');
  await form.getByRole('button', { name: 'Search' }).click();
  await expect(form.getByRole('alert').getByRole('link')).toHaveText([
    'Type a name, street name or description, or a full date of birth.',
  ]);

  // Neither the name nor a flag reached an address, the page's or any request's.
  for (const address of traffic.addresses) expect(address).toMatch(/\/patients$/);
  for (const secret of [high.flagId, frost.flagId, family])
    expect(urls.filter((u) => u.includes(secret))).toEqual([]);
  await expectNothingStored(page, 'a search narrowed by flags');
});
