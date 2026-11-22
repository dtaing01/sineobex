import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Schemas } from '@sineobex/contract';
import {
  apiCall,
  expectNothingStored,
  IDP,
  portalNav,
  signIn,
  staffToken,
  watchCsp,
  watchTraffic,
} from './helpers';

// Phase 5 design 10.1, the portal's half of the Done when: a Program Admin adds a Labs item, a
// bundle and a secondary flag through Team setup's pages, each with a reason, and a phone member's
// next pull, from the revision the phone held before, answers exactly the three. What the portal
// adds is what a phone's sync gets (build-plan 91). The story is the shared presets-done-when.json,
// which the API's and the phone's tests read too: its people, names, bodies and reasons are read
// from it, never copied here. Its names are new to every team, so this runs once on a freshly
// prepared database (tools/e2e-db.sh), as every portal run is.

/** A body's reference to another preset, with the name a form shows it by (the story's note). */
type Ref = { platform: string; name: string } | { preset: string; name: string };

interface ItemBody {
  name: string;
  categoryId: Ref;
  unit: string;
  medical: boolean;
  captureLot: boolean;
  result: null | { type: 'choice'; options: string[] } | { type: 'number'; unit: string };
}

interface BundleBody {
  name: string;
  medical: boolean;
  prompt: string;
  lines: { itemId: Ref; qty: number; core: boolean }[];
}

interface FlagBody {
  name: string;
  tier: 'primary' | 'secondary';
  criteria: string;
  color: string;
  rank: number;
  sensitive: boolean;
}

type StoryPreset = { ref: string; reason: string } & (
  | { kind: 'item'; body: ItemBody; teamSetup: { under: string; shows: string } }
  | { kind: 'bundle'; body: BundleBody; teamSetup: { under: string; shows: string; lines: string[] } }
  | { kind: 'flag'; body: FlagBody; teamSetup: { under: string; shows: string; pill: string } }
);

/** Steps 2 to 4: each adds one of the story's presets, and what the server holds after it. */
interface AddStep {
  n: number;
  adds: string;
  expect: {
    version: number;
    revision: number;
    head: { state: string; version: number; customized: boolean };
    storedVersion: { source: string };
    event: { act: string; version: number; by: string };
    audit: { action: string; entity: string; count: number };
  };
}

/** Step 5: the writes that are refused, and leave the revision where step 4 left it. */
interface Attempt {
  by: string;
  signedInMinutesAgo: number;
  repeats: string;
  expect: { code: string; audit: null | { action: string; count: number; details: Record<string, unknown> } };
}

/** Step 6: the phone's next pull. */
interface PullStep {
  by: string;
  expect: {
    pull: {
      reset: boolean;
      presets: { ref: string; kind: string; name: string; version: number; state: string }[];
      exactly: boolean;
      revision: number;
    };
  };
}

const STORY = JSON.parse(
  readFileSync(
    new URL('../../../packages/contract/test-vectors/presets-done-when.json', import.meta.url),
    'utf8',
  ),
) as {
  people: Record<string, { email: string; displayName: string }>;
  recentSignInMinutes: number;
  presets: StoryPreset[];
  steps: ({ n: number } & Record<string, unknown>)[];
  neverInAuditDetails: string[];
};

const stepOf = <T>(n: number) => STORY.steps.find((s) => s.n === n) as unknown as T;
const ADDS = STORY.steps.filter((s) => typeof s.adds === 'string') as unknown as AddStep[];
const presetOf = (ref: string) => STORY.presets.find((p) => p.ref === ref)!;
const ADMIN = STORY.people.programAdmin!;

/** Team setup's addresses, a page of it or a preset's, by ID only, and where a refusal sent the person. */
function expectOnlyIds(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(
      /\/team\/presets(\/[a-z-]+(\/[0-9a-f-]{36})?)?$|\/(home(\?denied=1)?|sign-in.*|reauth\?next=[%A-Za-z0-9-]*)$/,
    );
}

/** A pull of the team's presets as a phone makes it: with the revision and epoch it holds, or none. */
async function pull(token: string, held?: { revision: number; epoch: string }) {
  const query = held ? `?since=${held.revision}&epoch=${held.epoch}` : '';
  const res = await apiCall(token, 'GET', `/v1/presets${query}`);
  expect(res.status, `GET /v1/presets${query}`).toBe(200);
  return (await res.json()) as Schemas['PresetsPull'];
}

type Row = { id: string; name: string; state: string; version: number; customized: boolean; body: unknown };

/** A kind's presets as the admin list answers them, archived ones included. */
async function rowsOf(kind: string): Promise<Row[]> {
  const res = await apiCall(await staffToken(ADMIN.email), 'GET', `/v1/admin/presets/${kind}`);
  expect(res.status, kind).toBe(200);
  return (await res.json()) as Row[];
}

/** The active preset of a kind with this name. */
async function listedAs(kind: string, name: string): Promise<Row> {
  const row = (await rowsOf(kind)).find((p) => p.name === name && p.state === 'active');
  expect(row, `${kind} ${name}`).toBeDefined();
  return row!;
}

/** The audit log's entries by a seeded staff member whose action starts so, newest first. */
async function auditOf(email: string, actionPrefix: string) {
  const admin = await staffToken(ADMIN.email);
  const members = (await (await apiCall(admin, 'GET', '/v1/team/members')).json()) as {
    userId: string;
    email: string;
  }[];
  const res = await apiCall(admin, 'POST', '/v1/team/audit/search', {
    actorUserId: members.find((m) => m.email === email)!.userId,
    actionPrefix,
    limit: 200,
  });
  expect(res.status).toBe(200);
  return (
    (await res.json()) as {
      entries: {
        action: string;
        entity: string | null;
        entityId: string | null;
        details: Record<string, unknown>;
      }[];
    }
  ).entries;
}

/** Opens one of Team setup's areas from the navigation, as the admin finds it. */
async function openArea(page: Page, area: string) {
  await portalNav(page).getByRole('link', { name: 'Presets', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name: area, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(area);
  // The tab names the screen, never anything the team typed.
  await expect(page).toHaveTitle(`${area} · Sineobex`);
}

/** Add an item's fields as the story gives the item, its category chosen by the name the form shows. */
async function fillItem(form: Locator, preset: Extract<StoryPreset, { kind: 'item' }>) {
  const { body } = preset;
  await form.getByLabel('Name', { exact: true }).fill(body.name);
  await form.getByLabel('Category').selectOption({ label: body.categoryId.name });
  await form.getByLabel('Counted in').fill(body.unit);
  await form.getByLabel('Medical', { exact: true }).setChecked(body.medical);
  await form.getByLabel('Capture lot and expiry').setChecked(body.captureLot);
  if (body.result === null) await form.getByRole('radio', { name: 'None', exact: true }).check();
  else if (body.result.type === 'number') {
    await form.getByRole('radio', { name: 'A number' }).check();
    await form.getByLabel('Unit of the result').fill(body.result.unit);
  } else {
    await form.getByRole('radio', { name: 'A choice from a list' }).check();
    const options = form.getByRole('group', { name: 'Options' });
    for (const [i, option] of body.result.options.entries()) {
      if (i >= 2) await options.getByRole('button', { name: 'Add an option' }).click();
      await options.getByLabel(`Option ${i + 1}`, { exact: true }).fill(option);
    }
  }
  await form.getByLabel('Reason').fill(preset.reason);
}

/** Step 2: the item, on the Items page, listed under its category as the story's Team setup shows it. */
async function addItem(page: Page, preset: Extract<StoryPreset, { kind: 'item' }>) {
  await openArea(page, 'Items');
  const form = page.getByRole('form', { name: 'Add an item' });
  await fillItem(form, preset);
  await form.getByRole('button', { name: 'Add item' }).click();
  await expect(form.getByRole('status')).toHaveText(
    `Added: ${preset.body.name}. It’s on the phones after their next sync.`,
  );
  await expect(
    page
      .getByRole('region', { name: preset.teamSetup.under, exact: true })
      .getByRole('link', { name: preset.teamSetup.shows, exact: true }),
  ).toBeVisible();
}

/**
 * Step 3: the bundle, on the page the story's Team setup shows it under, each line's item chosen by
 * its name; its own page then holds its lines, with the reason in its history.
 */
async function addBundle(page: Page, preset: Extract<StoryPreset, { kind: 'bundle' }>) {
  const { body, teamSetup } = preset;
  await openArea(page, teamSetup.under);
  const form = page.getByRole('form', { name: 'Add a bundle' });
  await form.getByLabel('Name', { exact: true }).fill(body.name);
  await form.getByRole('radio', { name: body.medical ? 'Medical' : 'Non-Medical', exact: true }).check();
  for (const [i, line] of body.lines.entries()) {
    await form.getByRole('button', { name: 'Add an item' }).click();
    const group = form.getByRole('group', { name: `Line ${i + 1}`, exact: true });
    await group.getByLabel('Item').selectOption({ label: line.itemId.name });
    await group.getByLabel('Quantity').fill(String(line.qty));
    await group.getByLabel('Core').setChecked(line.core);
  }
  await form.getByLabel('Ask before applying (optional)').fill(body.prompt);
  await form.getByLabel('Reason').fill(preset.reason);
  await form.getByRole('button', { name: 'Add bundle' }).click();
  await expect(form.getByRole('status')).toHaveText(
    `Added: ${body.name}. It’s on the phones after their next sync.`,
  );

  await page
    .getByRole('region', { name: 'Your team’s bundles' })
    .getByRole('link', { name: teamSetup.shows, exact: true })
    .click();
  await expect(page).toHaveTitle('Bundle · Sineobex');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(teamSetup.shows);
  const edit = page.getByRole('form', { name: `Edit ${body.name}` });
  await expect(edit.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(teamSetup.lines.length);
  for (const [i, item] of teamSetup.lines.entries())
    await expect(
      edit
        .getByRole('group', { name: `Line ${i + 1}`, exact: true })
        .getByLabel('Item')
        .locator('option:checked'),
    ).toHaveText(item);
  await expect(
    page.getByRole('region', { name: 'History' }).getByRole('row', { name: /Added, version 1/ }),
  ).toContainText(preset.reason);
}

/** Step 4: the flag, on the list the story's Team setup shows it under, in the colour its pill names. */
async function addFlag(page: Page, preset: Extract<StoryPreset, { kind: 'flag' }>) {
  const { body, teamSetup } = preset;
  const colour = teamSetup.pill.slice(0, -` · ${body.name}`.length);
  expect(teamSetup.pill, 'a pill reads the colour’s name, then the flag’s').toBe(`${colour} · ${body.name}`);
  await openArea(page, 'Flags');
  const form = page.getByRole('form', { name: 'Add a flag' });
  await form.getByLabel('Name', { exact: true }).fill(body.name);
  await form.getByRole('radio', { name: teamSetup.under, exact: true }).check();
  await form.getByRole('radio', { name: colour, exact: true }).check();
  await form.getByLabel('Criteria (optional)').fill(body.criteria);
  await form.getByLabel('Sensitive', { exact: true }).setChecked(body.sensitive);
  await form.getByLabel('Reason', { exact: true }).fill(preset.reason);
  await form.getByRole('button', { name: 'Add flag' }).click();
  await expect(form.getByRole('status')).toHaveText(
    `Added: ${body.name}. It’s on the phones after their next sync.`,
  );
  // Last on its list, as staff see it.
  await expect(
    page
      .getByRole('region', { name: teamSetup.under, exact: true })
      .getByRole('listitem')
      .getByRole('link')
      .last(),
  ).toHaveText(teamSetup.pill);
}

test('a Program Admin adds the Labs item, the bundle and the secondary flag through Team setup, each with a reason, and a phone member’s next pull answers exactly the three', async ({
  page,
}) => {
  test.slow();

  // Step 1: the staff member's phone pulls with no revision of its own, and holds the revision R.
  const phone = await staffToken(STORY.people[stepOf<PullStep>(6).by]!.email);
  const first = await pull(phone);
  expect(first.reset).toBe(true);
  const R = first.revision;
  for (const p of STORY.presets)
    expect(
      first.presets.some((x) => x.kind === p.kind && x.state === 'active' && x.body.name === p.body.name),
      `${p.body.name} is new to the team`,
    ).toBe(false);

  // A body of the story names a platform preset by its origin key, as the phone's copy does, and
  // one an earlier step made by its ref: as the team holds it, each is the team's ID.
  const platform = new Map(first.presets.flatMap((p) => (p.originKey ? [[p.originKey, p.id] as const] : [])));
  const made = new Map<string, string>();
  const asHeld = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(asHeld);
    if (value === null || typeof value !== 'object') return value;
    if ('platform' in value) return platform.get(String(value.platform));
    if ('preset' in value) return made.get(String(value.preset));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asHeld(v)]));
  };
  // The page puts a new flag after every flag of its list, removed ones too, so its rank is the
  // story's 40 only on a team that added no flag of the list before: presets-pages.spec.ts, which
  // runs first, adds several. The rest of its body is the story's.
  const bodyOf = (preset: StoryPreset, held: unknown) =>
    preset.kind === 'flag'
      ? { ...(asHeld(preset.body) as FlagBody), rank: (held as FlagBody).rank }
      : asHeld(preset.body);

  // Steps 2 to 4: the admin, signed in just now, adds each through its page.
  await signIn(page, ADMIN.email);
  const csp = watchCsp(page);
  const traffic = watchTraffic(page);
  for (const step of ADDS) {
    const preset = presetOf(step.adds);
    const before = await rowsOf(preset.kind);
    if (preset.kind === 'item') await addItem(page, preset);
    else if (preset.kind === 'bundle') await addBundle(page, preset);
    else await addFlag(page, preset);

    const row = await listedAs(preset.kind, preset.body.name);
    made.set(preset.ref, row.id);
    expect(row, `step ${step.n}`).toMatchObject({
      state: step.expect.head.state,
      version: step.expect.head.version,
      customized: step.expect.head.customized,
    });
    expect(row.body, `step ${step.n}: the body the page sent`).toEqual(bodyOf(preset, row.body));
    if (preset.kind === 'flag') {
      const ranks = before.flatMap((f) => {
        const flag = f.body as FlagBody;
        return flag.tier === preset.body.tier ? [flag.rank] : [];
      });
      expect((row.body as FlagBody).rank).toBeGreaterThan(Math.max(...ranks));
    }

    // The act and its reason in the preset's history, by the admin; the version is the team's.
    const history = await apiCall(
      await staffToken(ADMIN.email),
      'GET',
      `/v1/admin/presets/${preset.kind}/${row.id}/history`,
    );
    expect(history.status).toBe(200);
    expect(
      ((await history.json()) as Schemas['PresetEvent'][]).map((e) => ({
        act: e.act,
        version: e.version,
        source: e.source,
        by: e.by?.displayName,
        reason: e.reason,
      })),
    ).toEqual([
      {
        act: step.expect.event.act,
        version: step.expect.event.version,
        source: step.expect.storedVersion.source,
        by: STORY.people[step.expect.event.by]!.displayName,
        reason: preset.reason,
      },
    ]);
    // Audited once, at the revision the step took, naming neither the preset nor the reason.
    const audited = (await auditOf(ADMIN.email, step.expect.audit.action)).filter(
      (e) => e.entityId === row.id,
    );
    expect(audited).toHaveLength(step.expect.audit.count);
    expect(audited[0]).toMatchObject({
      entity: step.expect.audit.entity,
      details: { kind: preset.kind, version: step.expect.version, revision: R + step.expect.revision },
    });
    for (const text of STORY.neverInAuditDetails)
      expect(JSON.stringify(audited[0]!.details), 'audit details').not.toContain(text);
  }
  await expectNothingStored(page, 'Team setup after the three');
  expect(csp).toEqual([]);

  // Step 5, through the pages: the staff member is refused Team setup at a typed address, logged
  // once; the admin, with a sign-in older than the limit, tries step 2's add again and is sent to
  // /reauth, which is not logged.
  for (const attempt of stepOf<{ attempts: Attempt[] }>(5).attempts) {
    const person = STORY.people[attempt.by]!;
    const repeated = presetOf(attempt.repeats);
    if (repeated.kind !== 'item') throw new Error('step 5 repeats step 2’s item');
    const denied = (await auditOf(person.email, 'access.denied')).length;
    if (attempt.signedInMinutesAgo > 0) {
      expect(attempt.signedInMinutesAgo).toBeGreaterThan(STORY.recentSignInMinutes);
      const stale = await fetch(`${IDP}/test/stale-sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: person.email, minutes: attempt.signedInMinutesAgo }),
      });
      expect(stale.status).toBe(200);
    }
    await signIn(page, person.email);
    if (attempt.expect.code === 'forbidden') {
      await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveCount(0);
      await page.goto('/team/presets/items');
      await expect(page).toHaveURL(/\/home\?denied=1$/);
      const after = await auditOf(person.email, attempt.expect.audit!.action);
      expect(after).toHaveLength(denied + attempt.expect.audit!.count);
      expect(after[0]!.details).toMatchObject(attempt.expect.audit!.details);
    } else {
      expect(attempt.expect).toMatchObject({ code: 'reauth_required', audit: null });
      await openArea(page, 'Items');
      const form = page.getByRole('form', { name: 'Add an item' });
      await fillItem(form, repeated);
      await form.getByRole('button', { name: 'Add item' }).click();
      await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fitems$/);
      expect(await auditOf(person.email, 'access.denied')).toHaveLength(denied);
    }
  }
  await expectNothingStored(page, 'step 5');
  expectOnlyIds(traffic.addresses);

  // Step 6: the phone's next pull, from R, answers exactly the three as the portal added them, at
  // R + 3: nothing step 5 tried was written.
  const { expect: sixth } = stepOf<PullStep>(6);
  expect(sixth.pull.exactly).toBe(true);
  const next = await pull(phone, { revision: R, epoch: first.epoch });
  expect(next.reset).toBe(sixth.pull.reset);
  const refOf = (id: string) => [...made].find(([, madeId]) => madeId === id)?.[0];
  expect(
    next.presets.map((p) => ({
      ref: refOf(p.id),
      kind: p.kind,
      name: p.body.name,
      version: p.version,
      state: p.state,
    })),
  ).toEqual(sixth.pull.presets);
  for (const p of next.presets) {
    expect(p.originKey).toBeNull();
    expect(p.body).toEqual(bodyOf(presetOf(refOf(p.id)!), p.body));
  }
  expect(next.revision).toBe(R + sixth.pull.revision);
});
