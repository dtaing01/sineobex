import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
import { QUEUE_THRESHOLD, SEARCH_MIN } from '../src/patients/match-constants.ts';
import { loadSummaries } from '../src/patients/projection.ts';
import type {
  PatientMatchResultValue,
  PatientSearchResultValue,
  PatientSummaryValue,
} from '../src/patients/schemas.ts';
import { createHarness, type Harness } from './harness.ts';
import {
  auditMark,
  createPatient,
  createTeam,
  expectAudit,
  expectAuditClean,
  logSpy,
  memberWith,
  mergeDirect,
  type Member,
} from './patient-fixtures.ts';
import {
  archiveDirect,
  idOf,
  insertPreset,
  memberOf,
  presetsTeam,
  tokenOf,
  type Person,
  type PresetsTeam,
} from './presets-fixtures.ts';

// POST /v1/patients/search and /v1/patients/match (phase 3 design 3.1, 5): misspellings, street
// names, merged groups, other teams, the cut after ranking, birth-date searches, what the phone may
// see, and audit events that list the patients shown and never the search text (D41).

const BILLING: Permission[] = [
  'patients.view',
  'billing.view_codes',
  'inventory.view',
  'exports.billing',
  'exports.grant',
];
const CLINICIAN: Permission[] = [
  'patients.view',
  'patients.edit',
  'patients.view_sensitive',
  'encounters.chart',
  'checkins.create',
  'referrals.create',
  'routes.view',
  'inventory.view',
];

/** Sorts after every random UUID: the ranking test's target loses every tie by ID. */
const LAST_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

const spy = logSpy();
let h: Harness;
let teamId: string;
let clinician: Member;
let billing: Member;
let p1: string;
let merged: string;
let survivor: string;

const search = (token: string, body: unknown, team = teamId) =>
  h.request('/v1/patients/search', { method: 'POST', token, teamId: team, json: body });
const match = (token: string, body: unknown) =>
  h.request('/v1/patients/match', { method: 'POST', token, teamId, json: body });

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  teamId = await createTeam(h);
  clinician = await memberWith(h, teamId, CLINICIAN);
  billing = await memberWith(h, teamId, BILLING);
  p1 = (
    await createPatient(h, teamId, clinician.userId, {
      preferredName: 'Del',
      legalName: { given: 'Delbert', family: 'Smithfield' },
      aliases: ['Smitty'],
      birth: { precision: 'day', date: '1946-03-07' },
      visualDescriptor: 'Demo: tall, grey beard, red cap',
      usualArea: 'Demo: by the made-up Elm St underpass',
      allergies: [{ substance: 'penicillin', category: 'drug', severity: 'severe' }],
    })
  ).id;
  survivor = (await createPatient(h, teamId, clinician.userId, { preferredName: 'Raymond' })).id;
  merged = (await createPatient(h, teamId, clinician.userId, { preferredName: 'Ray', aliases: ['Lefty'] }))
    .id;
  await mergeDirect(h, teamId, merged, survivor, clinician.userId);
  const other = await createTeam(h, 'Other Team (demo)');
  await createPatient(h, other, clinician.userId, { preferredName: 'Smitty', aliases: ['Smity Smitty'] });
});

afterAll(async () => {
  await h.close();
});

describe('POST /v1/patients/search', () => {
  it('finds a misspelled street name, and audits who was shown but not what was typed', async () => {
    const mark = await auditMark(h);
    const res = await search(clinician.token, { name: 'Smity', surface: 'portal' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as PatientSearchResultValue;
    expect(body.hits.map((x) => x.patientId)).toEqual([p1]);
    expect(body.hits[0]).toMatchObject({ band: 'likely', reasons: ['alias', 'typo'] });
    expect(body.hits[0]!.score).toBeCloseTo(1 - 1 / 6, 12);
    expect(body.hits[0]!.summary).toMatchObject({
      preferredName: 'Del',
      legalName: { given: 'Delbert', family: 'Smithfield' },
      aliases: ['Smitty'],
      birth: { precision: 'day', date: '1946-03-07' },
      ageYears: 80,
      allergy: { screen: 'not_asked', count: 1, severe: true },
      duplicateHint: false,
    });
    const [event] = await expectAudit(h, 'patient.searched', { after: mark, count: 1, patientId: null });
    expect(event!.details).toEqual({
      resultCount: 1,
      patientIds: [p1],
      criteria: ['name'],
      surface: 'portal',
    });
    await expectAuditClean(h, ['smit', 'delbert'], mark);
  });

  it('lets Billing/Data find someone by a street name too (D38)', async () => {
    const body = (await (
      await search(billing.token, { name: 'smitty', surface: 'portal' })
    ).json()) as PatientSearchResultValue;
    expect(body.hits.map((x) => x.patientId)).toEqual([p1]);
  });

  it('never puts a legal name in a phone result (D40)', async () => {
    const body = (await (
      await search(clinician.token, { name: 'Delbert', surface: 'phone' })
    ).json()) as PatientSearchResultValue;
    expect(body.hits.map((x) => x.patientId)).toEqual([p1]);
    expect(body.hits[0]!.reasons).toEqual(['legal_name']);
    expect(Object.keys(body.hits[0]!.summary)).not.toContain('legalName');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('smithfield');
  });

  it('finds the survivor by a street name only the merged record had', async () => {
    const body = (await (
      await search(clinician.token, { name: 'Lefty', surface: 'portal' })
    ).json()) as PatientSearchResultValue;
    expect(body.hits.map((x) => x.patientId)).toEqual([survivor]);
    expect(body.hits[0]!.summary.aliases).toEqual(['Lefty']);
  });

  it('never shows another team’s patient', async () => {
    const body = (await (
      await search(clinician.token, { name: 'Smity Smitty', surface: 'portal' })
    ).json()) as PatientSearchResultValue;
    expect(body.hits.map((x) => x.patientId)).toEqual([p1]);
  });

  it('searches by a full birth date alone, and audits the criteria', async () => {
    const mark = await auditMark(h);
    const body = (await (
      await search(clinician.token, { birth: { year: 1946, month: 3, day: 7 }, surface: 'portal' })
    ).json()) as PatientSearchResultValue;
    expect(body.hits.map((x) => x.patientId)).toEqual([p1]);
    expect(body.hits[0]!.reasons).toEqual(['dob_exact']);
    const [event] = await expectAudit(h, 'patient.searched', { after: mark, count: 1 });
    expect(event!.details.criteria).toEqual(['birth_full']);
  });

  it('refuses a year without a name, and a name that is too long, before reading anything', async () => {
    const mark = await auditMark(h);
    expect((await search(clinician.token, { birth: { year: 1946 }, surface: 'portal' })).status).toBe(422);
    expect((await search(clinician.token, { name: 'x'.repeat(101), surface: 'portal' })).status).toBe(422);
    expect((await search(clinician.token, { surface: 'portal' })).status).toBe(422);
    expect(await auditMark(h)).toBe(mark);
  });

  it('finds nobody for a name that normalizes to nothing, and still audits the search', async () => {
    const mark = await auditMark(h);
    const body = (await (
      await search(clinician.token, { name: '!!!', surface: 'portal' })
    ).json()) as PatientSearchResultValue;
    expect(body).toEqual({ hits: [], truncated: false });
    await expectAudit(h, 'patient.searched', { after: mark, count: 1 });
  });

  it('takes the search only in a POST body', async () => {
    // GET falls to /v1/patients/{patientId}, which refuses "search" as an ID.
    const mark = await auditMark(h);
    const res = await h.request('/v1/patients/search?name=Smity', { token: clinician.token, teamId });
    expect(res.status).toBe(422);
    await expectAudit(h, 'patient.searched', { after: mark, count: 0 });
  });

  it('refuses a member without patients.view, and logs the refusal', async () => {
    const m = await memberWith(h, teamId, ['checkins.create']);
    const mark = await auditMark(h);
    expect((await search(m.token, { name: 'Smity', surface: 'portal' })).status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'patients.view', route: '/v1/patients/search' });
    await expectAudit(h, 'patient.searched', { after: mark, count: 0 });
  });

  it('shows nothing when the search can’t be logged', async () => {
    await h.scratch.owner.unsafe(`
      create function sineobex.test_fail_search() returns trigger language plpgsql as $$
      begin if new.action = 'patient.searched' then raise exception 'audit refused'; end if; return new; end $$;
      create trigger test_fail_search before insert on sineobex.audit_events
        for each row execute function sineobex.test_fail_search()`);
    try {
      const res = await search(clinician.token, { name: 'Smity', surface: 'portal' });
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain(p1);
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_fail_search on sineobex.audit_events;
        drop function sineobex.test_fail_search()`);
    }
  });
});

// Phase 5 (design 7, 8.1; section 11, row 37): flagIds narrows a name or birth search by the
// patients' current flags, both tiers, in the request's body. Written ahead of P5-search: until it
// lands the field is ignored and each case fails. What they expect of it: `flagIds`, optional, a list
// of UUIDs; a hit carries every flag named among its current flags (currentFlags, with the reader's
// flag rule); a flag alone is refused as a search that browses the list is; a flag id that flagHidden
// hides from the caller, one the team does not hold among them, is 403 logged access.denied with
// `permission: 'patients.view_sensitive'` and the route, never the id; the search's event gains
// `flagCount`, the number of flag ids, and names none.
describe('POST /v1/patients/search by flags (phase 5)', () => {
  let team: PresetsTeam;
  let chw: Person;
  let both: string;
  let frostOnly: string;
  let cleared: string;
  let mistaken: string;
  let archived: string;
  let none: string;
  let winter: string;

  const searchAs = async (who: Person, body: Record<string, unknown>) =>
    h.request('/v1/patients/search', {
      method: 'POST',
      token: await tokenOf(h, who),
      teamId: team.teamId,
      json: { name: 'Demo Wren', surface: 'portal', ...body },
    });
  const hitsOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return ((await res.json()) as PatientSearchResultValue).hits.map((x) => x.patientId).sort();
  };
  const insertChange = async (patientId: string, flagId: string, minutesAgo: number, action = 'set') => {
    const id = randomUUID();
    const at = new Date(h.clock.now.getTime() - minutesAgo * 60_000);
    await h.scratch.owner`
      insert into sineobex.patient_flag_changes (id, team_id, patient_id, flag_id, action, reason, effective_at,
        device_time, clock_verified, author_user_id)
      values (${id}, ${team.teamId}, ${patientId}, ${flagId}, ${action}, 'Demo: seen at the van', ${at}, ${at}, true,
        ${team.staff.userId})`;
    return id;
  };
  const flag = (key: string) => idOf(team, key);

  beforeAll(async () => {
    team = await presetsTeam(h, 'Search flags');
    chw = await memberOf(
      h,
      team.teamId,
      ['patients.view', 'patients.edit', 'checkins.create', 'referrals.create', 'routes.view'],
      'Search flags CHW',
    );
    const patient = async (name: string) =>
      (await createPatient(h, team.teamId, team.staff.userId, { preferredName: name })).id;
    both = await patient('Demo Wren Alder');
    frostOnly = await patient('Demo Wren Birch');
    cleared = await patient('Demo Wren Cedar');
    mistaken = await patient('Demo Wren Dogwood');
    archived = await patient('Demo Wren Elm');
    none = await patient('Demo Wren Fir');
    winter = (
      await insertPreset(
        h,
        team.teamId,
        'flag',
        {
          name: 'Demo: Winter outreach',
          tier: 'secondary',
          criteria: '',
          color: 'teal',
          rank: 40,
          sensitive: false,
        },
        team.admin.userId,
      )
    ).id;
    await insertChange(both, flag('flag.high'), 50);
    await insertChange(both, flag('flag.frost_risk'), 40);
    await insertChange(both, flag('flag.pregnancy'), 35);
    await insertChange(frostOnly, flag('flag.frost_risk'), 30);
    await insertChange(cleared, flag('flag.high'), 30);
    await insertChange(cleared, flag('flag.high'), 20, 'clear');
    const wrong = await insertChange(mistaken, flag('flag.high'), 30);
    await h.scratch.owner`
      update sineobex.patient_flag_changes
      set status = 'entered_in_error', error_reason = 'Demo: wrong patient', error_by = ${team.staff.userId},
          error_at = now(), version = version + 1,
          field_versions = field_versions || '{"enteredInError": 1}'::jsonb,
          field_meta = field_meta || jsonb_build_object('enteredInError',
            jsonb_build_object('by', ${team.staff.userId}::text, 'at', now()::text, 'changeId', null))
      where id = ${wrong}`;
    await insertChange(archived, winter, 30);
    await archiveDirect(h, team.teamId, winter, team.admin.userId);
  });

  it('narrows a name search to the patients carrying every flag named, a risk level or a condition', async () => {
    expect(await hitsOf(await searchAs(team.staff, {}))).toEqual(
      [both, frostOnly, cleared, mistaken, archived, none].sort(),
    );
    expect(await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.high')] }))).toEqual([both]);
    expect(await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.frost_risk')] }))).toEqual(
      [both, frostOnly].sort(),
    );
    expect(
      await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.high'), flag('flag.frost_risk')] })),
    ).toEqual([both]);
    // One risk level at a time: two never match together.
    expect(
      await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.high'), flag('flag.low')] })),
    ).toEqual([]);
    // An archived flag stays on the patients who carry it; a sensitive one for a reader who sees it.
    expect(await hitsOf(await searchAs(team.staff, { flagIds: [winter] }))).toEqual([archived]);
    expect(await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.pregnancy')] }))).toEqual([both]);
    // The phone's surface narrows the same way.
    expect(
      await hitsOf(await searchAs(team.staff, { surface: 'phone', flagIds: [flag('flag.frost_risk')] })),
    ).toEqual([both, frostOnly].sort());
  });

  it('reads current flags only: a cleared flag and one entered in error match nothing', async () => {
    const hits = await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.high')] }));
    expect(hits).not.toContain(cleared);
    expect(hits).not.toContain(mistaken);
  });

  it('counts the flags in the search’s event and names none', async () => {
    const mark = await auditMark(h);
    await hitsOf(await searchAs(team.staff, { flagIds: [flag('flag.high'), flag('flag.frost_risk')] }));
    const [event] = await expectAudit(h, 'patient.searched', { after: mark, count: 1 });
    expect(event!.details).toEqual({
      resultCount: 1,
      patientIds: [both],
      criteria: ['name'],
      surface: 'portal',
      flagCount: 2,
    });
    expect(JSON.stringify(event!.details)).not.toContain(flag('flag.high'));
  });

  it('refuses a flag alone, as a search that would browse the list, and a flag id that is no UUID', async () => {
    const mark = await auditMark(h);
    const alone = await h.request('/v1/patients/search', {
      method: 'POST',
      token: await tokenOf(h, team.staff),
      teamId: team.teamId,
      json: { surface: 'portal', flagIds: [flag('flag.high')] },
    });
    // The refusal of a search with neither a name nor a full birth date (name_or_full_birth_date).
    expect(alone.status).toBe(422);
    expect(
      (
        (await alone.json()) as { error: { details: { fields: { path: string }[] } } }
      ).error.details.fields.map((f) => f.path),
    ).toEqual(['name']);
    expect((await searchAs(team.staff, { flagIds: ['high'] })).status).toBe(422);
    expect(await auditMark(h)).toBe(mark);
  });

  it('refuses a flag hidden from the caller, or one the team does not hold, with 403 logged without it', async () => {
    for (const flagId of [flag('flag.pregnancy'), randomUUID()]) {
      const mark = await auditMark(h);
      const res = await searchAs(chw, { flagIds: [flagId] });
      expect(res.status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
      expect(denied!.details).toMatchObject({
        permission: 'patients.view_sensitive',
        route: '/v1/patients/search',
      });
      expect(JSON.stringify(denied)).not.toContain(flagId);
      await expectAudit(h, 'patient.searched', { after: mark, count: 0 });
    }
    // A flag the CHW may see narrows their search.
    expect(await hitsOf(await searchAs(chw, { flagIds: [flag('flag.frost_risk')] }))).toEqual(
      [both, frostOnly].sort(),
    );
  });
});

describe('POST /v1/patients/match', () => {
  const intake = {
    preferredName: 'Smitty',
    legalName: { given: 'Del', family: null },
    birth: { precision: 'day', date: '1946-07-03' },
  };

  it('flags the done-when intake as likely, and audits the check', async () => {
    const mark = await auditMark(h);
    const res = await match(clinician.token, { ...intake, surface: 'phone' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PatientMatchResultValue;
    expect(body.candidates.map((c) => c.patientId)).toEqual([p1]);
    expect(body.candidates[0]).toMatchObject({ band: 'likely' });
    expect(body.candidates[0]!.reasons).toEqual(expect.arrayContaining(['name', 'alias', 'dob_swapped']));
    expect(body.candidates[0]!.score).toBeGreaterThanOrEqual(QUEUE_THRESHOLD);
    expect(Object.keys(body.candidates[0]!.summary)).not.toContain('legalName');
    const [event] = await expectAudit(h, 'patient.match_checked', { after: mark, count: 1 });
    expect(event!.details).toEqual({ checkId: body.checkId, patientIds: [p1], surface: 'phone' });
    await expectAuditClean(h, ['smit', 'del'], mark);
  });

  it('leaves out the patient being edited, and the patients kept separate from it', async () => {
    const edited = (await match(clinician.token, { ...intake, excludePatientId: p1, surface: 'portal' }).then(
      (r) => r.json(),
    )) as PatientMatchResultValue;
    expect(edited.candidates).toEqual([]);
    const twin = (await createPatient(h, teamId, clinician.userId, { preferredName: 'Smitty' })).id;
    const [a, b] = [p1, twin].sort() as [string, string];
    await h.scratch.owner`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources, status)
      values (${teamId}, ${a}, ${b}, 0.9, '{sync}', 'keep_separate')`;
    const res = (await match(clinician.token, { ...intake, excludePatientId: twin, surface: 'portal' }).then(
      (r) => r.json(),
    )) as PatientMatchResultValue;
    expect(res.candidates.map((c) => c.patientId)).not.toContain(p1);
  });

  it('needs patients.edit (Billing/Data registers nobody)', async () => {
    const mark = await auditMark(h);
    expect((await match(billing.token, { ...intake, surface: 'portal' })).status).toBe(403);
    await expectAudit(h, 'access.denied', { after: mark, count: 1 });
  });
});

describe('summaries', () => {
  it('describe the whole group, keyed by the ID asked for', async () => {
    const summaries = await h.db.tx({ teamId, userId: clinician.userId }, async (tx) => {
      const scope = { deps: { now: () => h.clock.now } } as Parameters<typeof loadSummaries>[1];
      return loadSummaries(tx, scope, [merged, survivor, '00000000-0000-4000-8000-000000000000']);
    });
    expect([...summaries.keys()].sort()).toEqual([merged, survivor].sort());
    const s = summaries.get(merged) as PatientSummaryValue;
    expect(s).toEqual(summaries.get(survivor));
    expect(s).toMatchObject({ preferredName: 'Raymond', aliases: ['Lefty'], birth: null, ageYears: null });
  });
});

describe('ranking before the cut (design 5.4, review finding 4)', () => {
  let team: string;
  let member: Member;

  beforeAll(async () => {
    team = await createTeam(h, 'Big Team (demo)');
    member = await memberWith(h, team, CLINICIAN);
    // 2,000 patients: 200 names that look like "smity" to word_similarity ("smit …", "smith …",
    // "smitts …") and 100 unrelated names, all born in 1946 like the target; 1,699 others born in
    // other years. Hex names hold no s, m, i, t or y, so they never match by accident.
    await h.scratch.owner`
      insert into sineobex.patients (id, team_id, canonical_id, preferred_name, birth_precision, birth_year,
        registered_at, author_user_id)
      select id, ${team}, id, name, 'year', y, now(), ${member.userId}
      from (select gen_random_uuid() as id,
                   case when g <= 200 then (array['Smit ', 'Smith ', 'Smitts '])[g % 3 + 1] || substr(md5(g::text), 1, 5)
                        else 'Zq' || substr(md5(g::text), 1, 6) end as name,
                   case when g <= 300 then 1946 else 1930 + (g % 70) + (case when 1930 + (g % 70) >= 1946 then 1 else 0 end) end as y
            from generate_series(1, 1999) as g) s`;
    await createPatient(h, team, member.userId, {
      id: LAST_ID,
      preferredName: 'Del',
      aliases: ['Smitty'],
      birth: { precision: 'day', date: '1946-03-07' },
    });
    const [{ n }] = (await h.scratch.owner`
      select count(*)::int as n from sineobex.patient_name_keys where team_id = ${team}`) as unknown as [
      { n: number },
    ];
    expect(n).toBeGreaterThanOrEqual(2000);
  });

  it('finds the target first by "Smity" and its birth year', async () => {
    const res = await search(member.token, { name: 'Smity', birth: { year: 1946 }, surface: 'phone' }, team);
    const body = (await res.json()) as PatientSearchResultValue;
    expect(body.hits[0]!.patientId).toBe(LAST_ID);
    expect(body.hits.length).toBeLessThanOrEqual(20);
    for (const hit of body.hits) expect(hit.score).toBeGreaterThanOrEqual(SEARCH_MIN);
    const scores = body.hits.map((x) => x.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('finds the target first at intake', async () => {
    const res = await h.request('/v1/patients/match', {
      method: 'POST',
      token: member.token,
      teamId: team,
      json: { preferredName: 'Smitty', birth: { precision: 'day', date: '1946-03-07' }, surface: 'phone' },
    });
    const body = (await res.json()) as PatientMatchResultValue;
    expect(body.candidates[0]!.patientId).toBe(LAST_ID);
    expect(body.candidates.length).toBeLessThanOrEqual(5);
  });

  it('cuts a birth-date search at the limit, exact dates first', async () => {
    const body = (await (
      await search(
        member.token,
        { birth: { year: 1946, month: 3, day: 7 }, limit: 5, surface: 'portal' },
        team,
      )
    ).json()) as PatientSearchResultValue;
    expect(body.hits).toHaveLength(5);
    expect(body.hits[0]!.patientId).toBe(LAST_ID);
    expect(body.hits[0]!.reasons).toEqual(['dob_exact']);
    expect(body.truncated).toBe(true);
  });

  it('cuts a name search at the limit and says more matched', async () => {
    const body = (await (
      await search(member.token, { name: 'Smith', limit: 10, surface: 'portal' }, team)
    ).json()) as PatientSearchResultValue;
    expect(body.hits).toHaveLength(10);
    expect(body.truncated).toBe(true);
  });
});

describe('logs', () => {
  it('never mention a name, a street name, a birth date or the search text', () => {
    expect(spy.lines.length).toBeGreaterThan(0);
    spy.expectClean(['smity', 'smitty', 'delbert', 'smithfield', 'lefty', '1946-03-07', '1946-07-03']);
  });
});
