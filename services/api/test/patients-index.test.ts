import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHW_PRESET, PERMISSION_KEYS, type Permission } from '../src/auth/permissions.ts';
import { normalizeName } from '../src/patients/normalize.ts';
import type { ChartBundleValue, TeamIndexPageValue } from '../src/patients/schemas.ts';
import { INDEX_PROJECTION } from '../src/patients/team-index.ts';
import { createHarness, type Harness } from './harness.ts';
import {
  auditMark,
  createPatient,
  createTeam,
  expectAudit,
  logSpy,
  memberWith,
  mergeDirect,
  type Member,
} from './patient-fixtures.ts';
import { archiveDirect, idOf, memberOf, presetsTeam, tokenOf, type PresetsTeam } from './presets-fixtures.ts';

// POST /v1/patients/index (phase 3 design 6): who may hold the team index on a phone (D37, D38),
// exactly what an entry holds (never a legal name, D40), versions, keyset pages, the complete
// redirect list on the first page, and one audit event per page with its ID range (D33).
//
// Phase 5 (design 6.1; D139) adds each entry's flags, and the projection idx1+sens for a reader who
// sees sensitive flags. Written ahead of P5-index: the entry's key set and the projection of a role
// that sees them, here and in the flags' own group below, fail until it lands.

const ROLES: Record<string, Permission[]> = {
  'Program Admin': PERMISSION_KEYS,
  Logistics: [
    'patients.view',
    'patients.edit',
    'patients.view_sensitive',
    'encounters.chart',
    'checkins.create',
    'referrals.create',
    'routes.view',
    'routes.manage',
    'inventory.view',
    'inventory.manage',
  ],
  'Healthcare Staff': [
    'patients.view',
    'patients.edit',
    'patients.view_sensitive',
    'encounters.chart',
    'checkins.create',
    'referrals.create',
    'routes.view',
    'inventory.view',
  ],
  'CHW preset': CHW_PRESET.permissions,
  'Custom: view and check-ins': ['patients.view', 'checkins.create'],
};
const BILLING: Permission[] = [
  'patients.view',
  'billing.view_codes',
  'inventory.view',
  'exports.billing',
  'exports.grant',
];

const ENTRY_KEYS = [
  'aliases',
  'allergies',
  'allergyScreen',
  'birth',
  'duplicate',
  'flags',
  'idLinks',
  'lastSeenOn',
  'patientId',
  'preferredName',
  'reviews',
  'usualArea',
  'versions',
  'visualDescriptor',
];

const TOKEN = 'BBBBBBBBBBBBBBBBBBBBBB';
const spy = logSpy();
let h: Harness;
let teamId: string;
let staff: Member;
let p1: string;
let p2: string;
let linkId: string;

const index = (token: string, body: unknown = {}, team = teamId) =>
  h.request('/v1/patients/index', { method: 'POST', token, teamId: team, json: body });
const page = async (token: string, body: unknown = {}, team = teamId) =>
  (await (await index(token, body, team)).json()) as TeamIndexPageValue;

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  teamId = await createTeam(h);
  staff = await memberWith(h, teamId, ROLES['Healthcare Staff']!);
  p1 = (
    await createPatient(h, teamId, staff.userId, {
      preferredName: 'Del',
      legalName: { given: 'Delbert', family: 'Smithfield' },
      aliases: ['Smitty'],
      birth: { precision: 'day', date: '1946-03-07' },
      visualDescriptor: 'Demo: tall, grey beard, red cap',
      usualArea: 'Demo: by the made-up Elm St underpass',
      livingSituation: { kind: 'unsheltered' },
      preferredLanguage: 'en',
      allergies: [{ substance: 'penicillin', category: 'drug', severity: 'severe', reaction: 'Demo: hives' }],
      at: new Date('2026-10-03T16:00:00Z'),
    })
  ).id;
  p2 = (await createPatient(h, teamId, staff.userId, { preferredName: 'Delly', aliases: ['Lefty'] })).id;
  await mergeDirect(h, teamId, p2, p1, staff.userId);
  linkId = randomUUID();
  await h.scratch.owner`
    insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason, effective_at,
      clock_verified, made_offline, issued_by)
    values (${linkId}, ${teamId}, ${p2}, ${TOKEN}, ${'1'.repeat(64)}, 'active', 'first_card', ${h.clock.now},
      true, false, ${staff.userId})`;
});

afterAll(async () => {
  await h.close();
});

describe('who may hold the index (D37, D38)', () => {
  for (const [name, permissions] of Object.entries(ROLES)) {
    it(`gives it to ${name}`, async () => {
      const m = await memberWith(h, teamId, permissions);
      expect((await index(m.token)).status).toBe(200);
    });
  }

  for (const [name, permissions] of [
    ['Billing/Data', BILLING],
    ['patients.view alone', ['patients.view']],
  ] as [string, Permission[]][]) {
    it(`refuses ${name}, and logs the refusal`, async () => {
      const m = await memberWith(h, teamId, permissions);
      const mark = await auditMark(h);
      const res = await index(m.token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('index_not_permitted');
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({ rule: 'mayHoldTeamIndex', route: '/v1/patients/index' });
      await expectAudit(h, 'patient.index_downloaded', { after: mark, count: 0 });
    });
  }

  it('refuses the next request once a member’s last field permission is gone', async () => {
    const m = await memberWith(h, teamId, CHW_PRESET.permissions);
    expect((await index(m.token)).status).toBe(200);
    await h.scratch.owner`
      update sineobex.roles set permissions = ${['patients.view', 'referrals.create', 'routes.view']}
      where id = ${m.roleId}`;
    expect((await index(m.token)).status).toBe(403);
  });
});

describe('an index page', () => {
  it('holds exactly the PRD’s list and its bookkeeping, and no legal name (D40)', async () => {
    const mark = await auditMark(h);
    const res = await index(staff.token);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as TeamIndexPageValue;
    // Healthcare Staff see sensitive flags (design 6.1): idx1+sens.
    expect(body).toMatchObject({ status: 'page', projection: `${INDEX_PROJECTION}+sens`, next: null });
    expect(body.version).toMatch(new RegExp(`^\\d+\\.${INDEX_PROJECTION}\\+sens$`));
    expect(body.entries.map((e) => e.patientId)).toEqual([p1]);
    const entry = body.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(ENTRY_KEYS);
    expect(entry).toMatchObject({
      preferredName: 'Del',
      visualDescriptor: 'Demo: tall, grey beard, red cap',
      birth: { precision: 'day', date: '1946-03-07' },
      usualArea: 'Demo: by the made-up Elm St underpass',
      lastSeenOn: '2026-10-20',
      allergyScreen: 'not_asked',
      idLinks: [{ id: linkId, effectiveAt: h.clock.now.toISOString() }],
      duplicate: null,
      flags: { primary: null, secondary: [] },
      reviews: [],
      versions: { preferredName: 1, visualDescriptor: 1, usualArea: 1, allergyScreen: 1 },
    });
    expect(entry.aliases.map((a) => [a.alias, a.kind])).toEqual([
      ['Smitty', 'alias'],
      ['Lefty', 'alias'],
      ['Delly', 'merged_name'],
    ]);
    expect(entry.allergies).toEqual([
      { id: expect.any(String), substance: 'penicillin', category: 'drug', severity: 'severe' },
    ]);
    expect(body.redirects).toEqual([{ mergedId: p2, survivorId: p1, mergedAt: expect.any(String) }]);
    const json = JSON.stringify(body).toLowerCase();
    for (const never of [
      'delbert',
      'smithfield',
      normalizeName('Delbert Smithfield')!,
      'unsheltered',
      'hives',
      TOKEN.toLowerCase(),
      '1'.repeat(64),
    ])
      expect(json).not.toContain(never);
    const [event] = await expectAudit(h, 'patient.index_downloaded', {
      after: mark,
      count: 1,
      patientId: null,
    });
    expect(event!.details).toEqual({ version: body.version, after: null, next: null, count: 1 });
  });

  it('gives a merged record’s name no ID, and every street name the ID the chart bundle has', async () => {
    const entry = (await page(staff.token)).entries.find((e) => e.patientId === p1)!;
    const merged = entry.aliases.filter((a) => a.kind === 'merged_name');
    expect(merged).toEqual([{ id: null, alias: 'Delly', kind: 'merged_name' }]);
    const res = await h.request('/v1/patients/charts', {
      method: 'POST',
      token: staff.token,
      teamId,
      json: { patientIds: [p1], reason: 'opened' },
    });
    const bundle = (await res.json()) as ChartBundleValue;
    const active = bundle.charts[0]!.aliases.filter((a) => a.status === 'active');
    expect(
      entry.aliases
        .filter((a) => a.kind === 'alias')
        .map((a) => [a.id, a.alias])
        .sort(),
    ).toEqual(active.map((a) => [a.id, a.attributes.alias]).sort());
  });

  // Review finding S1: the index's time is weighed on the phone against a flag change's receipt,
  // which the database dates, so the index is dated by the same clock, never the API's.
  it('is dated by the database’s clock when it was worked out, a page or unchanged, whatever the API’s clock says', async () => {
    const was = h.clock.now;
    h.clock.set(new Date(Date.now() - 3 * 24 * 60 * 60_000));
    try {
      const dbNow = async () =>
        (await h.scratch.owner<{ now: Date }[]>`select now() as now`)[0]!.now.getTime();
      const before = await dbNow();
      const first = await page(staff.token);
      const unchanged = await page(staff.token, { have: first.version });
      const after = await dbNow();
      expect(unchanged.status).toBe('unchanged');
      for (const answer of [first, unchanged]) {
        const at = new Date(answer.generatedAt).getTime();
        expect(at).toBeGreaterThanOrEqual(before);
        expect(at).toBeLessThanOrEqual(after);
      }
    } finally {
      h.clock.set(was);
    }
  });

  // Review finding S3: the phone's test server holds this case too (fake_parity_test.dart).
  it('never shows another team’s patient', async () => {
    const other = await createTeam(h, 'Other Team (demo)');
    const neighbour = await memberWith(h, other, ROLES['Healthcare Staff']!);
    const theirs = (await createPatient(h, other, neighbour.userId, { preferredName: 'Del' })).id;
    const ours = (await page(staff.token)).entries.map((e) => e.patientId);
    expect(ours).toEqual(expect.arrayContaining([p1]));
    expect(ours).not.toContain(theirs);
    const forThem = await page(neighbour.token, {}, other);
    expect(forThem.entries.map((e) => e.patientId)).toEqual([theirs]);
    expect(forThem.redirects).toEqual([]);
  });

  it('answers unchanged for the version the phone holds, and logs nothing', async () => {
    const { version } = await page(staff.token);
    const mark = await auditMark(h);
    const again = await page(staff.token, { have: version });
    expect(again).toMatchObject({ status: 'unchanged', version, entries: [], redirects: [], next: null });
    expect(await auditMark(h)).toBe(mark);
  });

  it('moves the version when anything an entry shows changes', async () => {
    const before = (await page(staff.token)).version;
    await h.scratch
      .owner`update sineobex.patients set usual_area = 'Demo: by the library steps' where id = ${p1}`;
    const afterEdit = (await page(staff.token)).version;
    expect(afterEdit).not.toBe(before);
    expect((await page(staff.token, { have: before })).status).toBe('page');
    const p3 = (await createPatient(h, teamId, staff.userId, { preferredName: 'Del' })).id;
    const [x, y] = [p1, p3].sort() as [string, string];
    await h.scratch.owner`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources, status, note)
      values (${teamId}, ${x}, ${y}, 0.9, '{sync}', 'not_sure', 'Demo: check ID card at next visit')`;
    const withPair = await page(staff.token, { have: afterEdit });
    expect(withPair.status).toBe('page');
    const entry = withPair.entries.find((e) => e.patientId === p1)!;
    // The reviewer's note is free text that may hold a legal name: the chart shows it, the index
    // on every field phone never carries it (D40; review finding P7).
    expect(entry.duplicate).toEqual({ status: 'not_sure' });
    expect(JSON.stringify(withPair)).not.toContain('check ID card');
    const chart = await h.request(`/v1/patients/${p1}`, { token: staff.token, teamId });
    expect(((await chart.json()) as { duplicate: unknown }).duplicate).toEqual({
      status: 'not_sure',
      note: 'Demo: check ID card at next visit',
    });
  });

  it('shows the fields with an open review', async () => {
    await h.scratch.owner`
      insert into sineobex.field_reviews (team_id, patient_id, entity, record_id, field, needs)
      values (${teamId}, ${p1}, 'patient', ${p1}, 'usualArea', 'patients.edit')`;
    const entry = (await page(staff.token)).entries.find((e) => e.patientId === p1)!;
    expect(entry.reviews).toEqual(['usualArea']);
  });
});

describe('pages and redirects', () => {
  let big: string;
  let member: Member;
  let survivor: string;
  let merged: string;

  beforeAll(async () => {
    big = await createTeam(h, 'Big Team (demo)');
    member = await memberWith(h, big, ROLES['Healthcare Staff']!);
    await h.scratch.owner`
      insert into sineobex.patients (id, team_id, canonical_id, preferred_name, registered_at, author_user_id)
      select id, ${big}, id, 'Demo ' || g, now(), ${member.userId}
      from (select gen_random_uuid() as id, g from generate_series(1, 248) as g) s`;
    survivor = (await createPatient(h, big, member.userId, { preferredName: 'Ray' })).id;
    merged = (await createPatient(h, big, member.userId, { preferredName: 'Raymond' })).id;
    await mergeDirect(h, big, merged, survivor, member.userId);
  });

  it('pages by keyset, every active patient once, each page audited with its range', async () => {
    const mark = await auditMark(h);
    const first = await page(member.token, { limit: 100 }, big);
    expect(first.entries).toHaveLength(100);
    expect(first.redirects).toHaveLength(1);
    const second = await page(member.token, { limit: 100, after: first.next }, big);
    expect(second.redirects).toEqual([]);
    const third = await page(member.token, { limit: 100, after: second.next }, big);
    expect(third.next).toBeNull();
    const ids = [...first.entries, ...second.entries, ...third.entries].map((e) => e.patientId);
    expect(ids).toHaveLength(249);
    expect(new Set(ids).size).toBe(249);
    expect(ids).toEqual([...ids].sort());
    expect(ids).not.toContain(merged);
    const events = await expectAudit(h, 'patient.index_downloaded', { after: mark, count: 3 });
    expect(events.map((e) => [e.details.after, e.details.next, e.details.count])).toEqual([
      [null, first.next, 100],
      [first.next, second.next, 100],
      [second.next, null, 49],
    ]);
  });

  it('drops a redirect from the complete list once its merge is undone', async () => {
    expect((await page(member.token, {}, big)).redirects.map((r) => r.mergedId)).toEqual([merged]);
    // As an undo leaves the rows (design 8.5); the merge route's own tests cover the undo itself.
    await h.scratch.owner.begin(async (sql) => {
      await sql`update sineobex.patient_merges set undone_at = now(), undone_by = ${member.userId}
                where team_id = ${big} and merged_id = ${merged}`;
      await sql`update sineobex.patients set status = 'active', merged_into = null, canonical_id = id
                where id = ${merged}`;
    });
    const after = await page(member.token, {}, big);
    expect(after.redirects).toEqual([]);
    expect(after.entries.map((e) => e.patientId)).toContain(merged);
  });

  it('refuses a page size outside 100 to 1000', async () => {
    expect((await index(member.token, { limit: 99 }, big)).status).toBe(422);
    expect((await index(member.token, { limit: 1001 }, big)).status).toBe(422);
  });

  it('is gzipped when the phone asks', async () => {
    const res = await h.request('/v1/patients/index', {
      method: 'POST',
      token: member.token,
      teamId: big,
      json: {},
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });
});

describe('flags in the index (phase 5 design 6.1)', () => {
  type Entry = TeamIndexPageValue['entries'][number] & {
    flags?: { primary: string | null; secondary: string[] };
  };
  let team: PresetsTeam;
  let chw: { userId: string; email: string; displayName: string };
  let flagged: string;
  let mergedIn: string;
  let plain: string;

  const indexOf = async (token: string, body: unknown = {}) => {
    const res = await h.request('/v1/patients/index', {
      method: 'POST',
      token,
      teamId: team.teamId,
      json: body,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as TeamIndexPageValue;
  };
  const entryOf = (page: TeamIndexPageValue, patientId: string) =>
    page.entries.find((e) => e.patientId === patientId) as Entry;
  const insertChange = async (patientId: string, flagKey: string, minutesAgo: number, action = 'set') => {
    const id = randomUUID();
    const at = new Date(h.clock.now.getTime() - minutesAgo * 60_000);
    await h.scratch.owner`
      insert into sineobex.patient_flag_changes (id, team_id, patient_id, flag_id, action, reason, effective_at,
        device_time, clock_verified, author_user_id)
      values (${id}, ${team.teamId}, ${patientId}, ${idOf(team, flagKey)}, ${action}, 'Demo: seen at the van',
        ${at}, ${at}, true, ${team.staff.userId})`;
    return id;
  };

  beforeAll(async () => {
    team = await presetsTeam(h, 'Index flags');
    chw = await memberOf(h, team.teamId, CHW_PRESET.permissions, 'Index flags CHW');
    flagged = (await createPatient(h, team.teamId, team.staff.userId, { preferredName: 'Demo Wren' })).id;
    mergedIn = (await createPatient(h, team.teamId, team.staff.userId, { preferredName: 'Demo Wren two' }))
      .id;
    plain = (await createPatient(h, team.teamId, team.staff.userId, { preferredName: 'Demo Lark' })).id;
    await mergeDirect(h, team.teamId, mergedIn, flagged, team.staff.userId);
    await insertChange(flagged, 'flag.medium', 60);
    await insertChange(mergedIn, 'flag.high', 50);
    await insertChange(flagged, 'flag.dehydration_risk', 40);
    await insertChange(mergedIn, 'flag.pregnancy', 30);
    await insertChange(flagged, 'flag.frost_risk', 20);
  });

  it('gives each entry its group’s current flags, ids only, both records of a merged patient', async () => {
    const page = await indexOf(await tokenOf(h, team.staff));
    expect(entryOf(page, flagged).flags).toEqual({
      primary: idOf(team, 'flag.high'),
      secondary: [
        idOf(team, 'flag.frost_risk'),
        idOf(team, 'flag.dehydration_risk'),
        idOf(team, 'flag.pregnancy'),
      ],
    });
    expect(entryOf(page, plain).flags).toEqual({ primary: null, secondary: [] });
    // Ids only: never a flag change's reason.
    expect(JSON.stringify(page)).not.toContain('seen at the van');
  });

  it('holds a sensitive flag only for a reader who sees it, under idx1+sens; anyone else gets idx1', async () => {
    const staff = await indexOf(await tokenOf(h, team.staff));
    const forChw = await indexOf(await tokenOf(h, chw));
    expect([staff.projection, forChw.projection]).toEqual(['idx1+sens', 'idx1']);
    expect(staff.version).toMatch(/^\d+\.idx1\+sens$/);
    expect(forChw.version).toMatch(/^\d+\.idx1$/);
    expect(entryOf(forChw, flagged).flags!.secondary).toEqual([
      idOf(team, 'flag.frost_risk'),
      idOf(team, 'flag.dehydration_risk'),
    ]);
    expect(JSON.stringify(forChw)).not.toContain(idOf(team, 'flag.pregnancy'));
    // The two copies are two versions: a phone holding one is sent the other whole.
    expect((await indexOf(await tokenOf(h, chw), { have: staff.version })).status).toBe('page');
  });

  it('a flag set on another phone appears after one refresh, and one entered in error leaves', async () => {
    const token = await tokenOf(h, team.staff);
    const before = await indexOf(token);
    const low = await insertChange(plain, 'flag.low', 5);
    const after = await indexOf(token, { have: before.version });
    expect(after.status).toBe('page');
    expect(after.version).not.toBe(before.version);
    expect(entryOf(after, plain).flags!.primary).toBe(idOf(team, 'flag.low'));
    await h.scratch.owner`
      update sineobex.patient_flag_changes
      set status = 'entered_in_error', error_reason = 'Demo: wrong patient', error_by = ${team.staff.userId},
          error_at = now(), version = version + 1,
          field_versions = field_versions || '{"enteredInError": 1}'::jsonb,
          field_meta = field_meta || jsonb_build_object('enteredInError',
            jsonb_build_object('by', ${team.staff.userId}::text, 'at', now()::text, 'changeId', null))
      where id = ${low}`;
    const marked = await indexOf(token, { have: after.version });
    expect(marked.status).toBe('page');
    expect(entryOf(marked, plain).flags!.primary).toBeNull();
  });

  it('keeps an archived flag on the patients who carry it', async () => {
    await archiveDirect(h, team.teamId, idOf(team, 'flag.frost_risk'), team.admin.userId);
    const page = await indexOf(await tokenOf(h, team.staff));
    expect(entryOf(page, flagged).flags!.secondary).toContain(idOf(team, 'flag.frost_risk'));
  });
});

describe('logs', () => {
  it('never mention a name, a street name or a token', () => {
    expect(spy.lines.length).toBeGreaterThan(0);
    spy.expectClean(['delbert', 'smitty', 'lefty', 'penicillin', TOKEN.toLowerCase(), 'elm st']);
  });
});
