import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
import { CHART_TABLES } from '../src/patients/charts.ts';
import { HISTORY_PAGE } from '../src/patients/history.ts';
import { idLinkTokenRef } from '../src/patients/id-links.ts';
import type { ChartBundleValue, FieldHistoryPageValue, PatientChartValue } from '../src/patients/schemas.ts';
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
import {
  archiveDirect,
  editDirect,
  idOf,
  insertPreset,
  memberOf,
  presetsTeam,
  tokenOf,
  type Person,
  type PresetsTeam,
} from './presets-fixtures.ts';
import { call, createProblem } from './sync-fixtures.ts';

// GET /v1/patients/{id}, POST /v1/patients/charts and GET /v1/patients/{id}/history (phase 3 design
// 3.1, 4.3, 7): every chart is the whole merged group, projected per role, audited once per chart;
// and the schema test that keeps every table with a patient_id column read through the group (13.3).

const CLINICIAN: Permission[] = [
  'patients.view',
  'patients.edit',
  'patients.view_sensitive',
  'encounters.chart',
  'checkins.create',
];
const BILLING: Permission[] = [
  'patients.view',
  'billing.view_codes',
  'inventory.view',
  'exports.billing',
  'exports.grant',
];
const CHW: Permission[] = [
  'patients.view',
  'patients.edit',
  'checkins.create',
  'referrals.create',
  'routes.view',
];

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
const spy = logSpy();
let h: Harness;
let teamId: string;
let clinician: Member;
let billing: Member;
let chw: Member;
let p1: string;
let p2: string;
let p3: string;
let footProblem: string;
let sensitiveProblem: string;
let otherTeamPatient: string;

const get = (token: string, path: string, headers: Record<string, string> = {}) =>
  h.request(path, { token, teamId, headers });
const chart = async (token: string, id: string) =>
  (await (await get(token, `/v1/patients/${id}`)).json()) as PatientChartValue;
const charts = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  h.request('/v1/patients/charts', { method: 'POST', token, teamId, json: body, headers });

async function addProblem(patientId: string, title: string, code: string | null, sensitive: boolean) {
  const id = randomUUID();
  const at = h.clock.now;
  const sql = h.scratch.owner;
  await sql`
    insert into sineobex.problems (id, team_id, patient_id, title, code_system, code, sensitive, status,
      status_changed_at, status_changed_by, status_checked_at, author_user_id, field_versions)
    values (${id}, ${teamId}, ${patientId}, ${title}, ${code ? 'icd10cm' : null}, ${code}, ${sensitive}, 'new',
      ${at}, ${clinician.userId}, ${at}, ${clinician.userId}, ${sql.json({ status: 1 })})`;
  await sql`
    insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by)
    values (${teamId}, 'problem', ${id}, 'status', 1, ${sql.json({ status: 'new', encounterId: null })}, 'created',
      ${clinician.userId})`;
  await sql`
    insert into sineobex.problem_notes (id, team_id, problem_id, text, written_at, author_user_id)
    values (${randomUUID()}, ${teamId}, ${id}, ${`Demo note on ${title}`}, ${at}, ${clinician.userId})`;
  return id;
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  teamId = await createTeam(h);
  clinician = await memberWith(h, teamId, CLINICIAN);
  billing = await memberWith(h, teamId, BILLING);
  chw = await memberWith(h, teamId, CHW);
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
  p2 = (await createPatient(h, teamId, clinician.userId, { preferredName: 'Delly', aliases: ['Lefty'] })).id;
  p3 = (await createPatient(h, teamId, clinician.userId, { preferredName: 'Rosa' })).id;
  await mergeDirect(h, teamId, p2, p1, clinician.userId);
  footProblem = await addProblem(p1, 'Demo: foot wound', 'L97.509', false);
  sensitiveProblem = await addProblem(p2, 'Demo: opioid use', 'F11.20', true);
  const sql = h.scratch.owner;
  await sql`
    insert into sineobex.patient_id_links (id, team_id, patient_id, token, token_hash, status, reason, effective_at,
      clock_verified, made_offline, issued_by)
    values (${randomUUID()}, ${teamId}, ${p1}, ${TOKEN}, ${'0'.repeat(64)}, 'active', 'first_card', ${h.clock.now},
      true, false, ${clinician.userId})`;
  const [review] = await sql<{ id: string }[]>`
    insert into sineobex.field_reviews (team_id, patient_id, entity, record_id, field, needs)
    values (${teamId}, ${p1}, 'patient', ${p1}, 'usualArea', 'patients.edit') returning id`;
  await sql`
    insert into sineobex.field_history (team_id, entity, record_id, field, version, value, kind, changed_by, review_id)
    values (${teamId}, 'patient', ${p1}, 'usualArea', 1, ${sql.json('Demo: by the library steps')}, 'kept_both',
      ${chw.userId}, ${review!.id})`;
  const other = await createTeam(h, 'Other Team (demo)');
  otherTeamPatient = (await createPatient(h, other, clinician.userId, { preferredName: 'Del' })).id;
});

afterAll(async () => {
  await h.close();
});

describe('GET /v1/patients/{patientId}', () => {
  it('answers the whole group for a clinician, and audits one view', async () => {
    const mark = await auditMark(h);
    const res = await get(clinician.token, `/v1/patients/${p1}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const c = (await res.json()) as PatientChartValue;
    expect(c.canonicalId).toBe(p1);
    expect(c.redirectedFrom).toBeUndefined();
    expect(c.patient.fields.legalName!.value).toEqual({ given: 'Delbert', family: 'Smithfield' });
    expect(c.patient.fields.usualArea).toMatchObject({
      version: 1,
      value: 'Demo: by the made-up Elm St underpass',
    });
    expect(c.mergedFrom.map((m) => m.patientId)).toEqual([p2]);
    expect(c.aliases.map((a) => a.attributes.alias).sort()).toEqual(['Lefty', 'Smitty']);
    expect(c.allergies.map((a) => a.attributes.substance)).toEqual(['penicillin']);
    expect(c.consents).toHaveLength(4);
    expect(c.problems!.map((p) => p.id).sort()).toEqual([footProblem, sensitiveProblem].sort());
    expect(c.problemHistory).toHaveLength(2);
    expect(c.problemNotes).toHaveLength(2);
    expect(c.idLinks).toHaveLength(1);
    expect(c.idLinks[0]!.url).toContain(`#${TOKEN}`);
    expect(c.reviews).toHaveLength(1);
    expect(c.reviews[0]).toMatchObject({
      field: 'usualArea',
      current: { value: 'Demo: by the made-up Elm St underpass' },
    });
    expect(c.reviews[0]!.alternates.map((a) => a.value)).toEqual(['Demo: by the library steps']);
    expect(c.duplicate).toBeNull();
    expect(c.projection).toBe('c1+prob+sens+url');
    const [event] = await expectAudit(h, 'patient.viewed', { after: mark, count: 1, patientId: p1 });
    expect(event!.details).toEqual({ source: 'portal' });
    // The chart carried the card's link, so that is logged as a read of the link (design 10.6).
    const [link] = await expectAudit(h, 'id_link.viewed', { after: mark, count: 1, patientId: p1 });
    expect(link!.details).toEqual({
      linkId: c.idLinks[0]!.id,
      tokenRef: await idLinkTokenRef(TOKEN),
      source: 'portal',
    });
  });

  it('answers a merged ID with the survivor’s chart', async () => {
    const c = await chart(clinician.token, p2);
    expect(c.canonicalId).toBe(p1);
    expect(c.redirectedFrom).toBe(p2);
  });

  it('shows Billing/Data the whole chart without sensitive problems or card links (D38)', async () => {
    const mark = await auditMark(h);
    const c = await chart(billing.token, p1);
    await expectAudit(h, 'id_link.viewed', { after: mark, count: 0 });
    expect(c.aliases).toHaveLength(2);
    expect(c.allergies).toHaveLength(1);
    expect(c.consents).toHaveLength(4);
    expect(c.patient.fields.visualDescriptor!.value).toBe('Demo: tall, grey beard, red cap');
    expect(c.problems!.map((p) => p.id)).toEqual([footProblem]);
    expect(c.problemHistory!.map((e) => e.problemId)).toEqual([footProblem]);
    expect(c.problemNotes!.map((n) => n.problemId)).toEqual([footProblem]);
    expect(c.idLinks).toHaveLength(1);
    expect(Object.keys(c.idLinks[0]!)).not.toContain('url');
    expect(JSON.stringify(c)).not.toContain(TOKEN);
    expect(JSON.stringify(c)).not.toContain('opioid');
    expect(c.projection).toBe('c1+prob');
  });

  it('shows the CHW preset no problem list, and the card link', async () => {
    const c = await chart(chw.token, p1);
    expect(Object.keys(c)).not.toEqual(expect.arrayContaining(['problems']));
    for (const k of ['problems', 'problemHistory', 'problemNotes']) expect(Object.keys(c)).not.toContain(k);
    expect(c.idLinks[0]!.url).toContain(`#${TOKEN}`);
    expect(c.projection).toBe('c1+url');
  });

  it('answers 404 for a patient the team doesn’t have, and audits nothing', async () => {
    const mark = await auditMark(h);
    expect((await get(clinician.token, `/v1/patients/${otherTeamPatient}`)).status).toBe(404);
    expect((await get(clinician.token, `/v1/patients/${randomUUID()}`)).status).toBe(404);
    await expectAudit(h, 'patient.viewed', { after: mark, count: 0 });
  });

  it('refuses a member without patients.view, and logs the refusal', async () => {
    const m = await memberWith(h, teamId, ['checkins.create']);
    const mark = await auditMark(h);
    expect((await get(m.token, `/v1/patients/${p1}`)).status).toBe(403);
    await expectAudit(h, 'access.denied', { after: mark, count: 1 });
  });

  it('shows nothing when the view can’t be logged', async () => {
    await h.scratch.owner.unsafe(`
      create function sineobex.test_fail_view() returns trigger language plpgsql as $$
      begin if new.action = 'patient.viewed' then raise exception 'audit refused'; end if; return new; end $$;
      create trigger test_fail_view before insert on sineobex.audit_events
        for each row execute function sineobex.test_fail_view()`);
    try {
      const res = await get(clinician.token, `/v1/patients/${p1}`);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain('Smitty');
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_fail_view on sineobex.audit_events;
        drop function sineobex.test_fail_view()`);
    }
  });
});

describe('POST /v1/patients/charts', () => {
  it('answers each group once, with what is missing and every redirect that touches them', async () => {
    const missing = randomUUID();
    const mark = await auditMark(h);
    const res = await charts(clinician.token, { patientIds: [p2, missing, p3, p1], reason: 'opened' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChartBundleValue;
    expect(body.charts.map((c) => c.canonicalId).sort()).toEqual([p1, p3].sort());
    expect(body.missing).toEqual([missing]);
    expect(body.redirects).toEqual([{ mergedId: p2, survivorId: p1, mergedAt: expect.any(String) }]);
    const events = await expectAudit(h, 'patient.viewed', { after: mark, count: 2 });
    expect(events.map((e) => e.patientId).sort()).toEqual([p1, p3].sort());
    for (const e of events) expect(e.details).toEqual({ source: 'cache', reason: 'opened' });
    const [link] = await expectAudit(h, 'id_link.viewed', { after: mark, count: 1, patientId: p1 });
    expect(link!.details).toMatchObject({ tokenRef: await idLinkTokenRef(TOKEN), source: 'cache' });
  });

  // Review finding S3: the phone's test server holds this case too (fake_parity_test.dart).
  it('never shows another team’s patient', async () => {
    const mark = await auditMark(h);
    const res = await charts(clinician.token, { patientIds: [otherTeamPatient, p3], reason: 'opened' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChartBundleValue;
    expect(body.charts.map((c) => c.canonicalId)).toEqual([p3]);
    expect(body.missing).toEqual([otherTeamPatient]);
    expect(JSON.stringify([body.charts, body.redirects])).not.toContain(otherTeamPatient);
    const events = await expectAudit(h, 'patient.viewed', { after: mark, count: 1 });
    expect(events[0]!.patientId).toBe(p3);
  });

  it('projects every chart in the bundle', async () => {
    const body = (await (
      await charts(billing.token, { patientIds: [p1], reason: 'refresh' })
    ).json()) as ChartBundleValue;
    expect(body.charts[0]!.problems!.map((p) => p.id)).toEqual([footProblem]);
  });

  it('is gzipped when the phone asks', async () => {
    const res = await charts(
      clinician.token,
      { patientIds: [p1, p3], reason: 'opened' },
      { 'accept-encoding': 'gzip' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const body = (await new Response(
      res.body!.pipeThrough(new DecompressionStream('gzip')),
    ).json()) as ChartBundleValue;
    expect(body.charts).toHaveLength(2);
  });

  it('takes 1 to 50 IDs and only the reasons phase 3 has', async () => {
    expect((await charts(clinician.token, { patientIds: [], reason: 'opened' })).status).toBe(422);
    expect((await charts(clinician.token, { patientIds: [p1], reason: 'today' })).status).toBe(422);
    const many = Array.from({ length: 51 }, () => randomUUID());
    expect((await charts(clinician.token, { patientIds: many, reason: 'opened' })).status).toBe(422);
  });
});

describe('GET /v1/patients/{patientId}/history', () => {
  it('lists old and new values of one field, newest first, and audits the read', async () => {
    const mark = await auditMark(h);
    const res = await get(clinician.token, `/v1/patients/${p2}/history?field=usualArea`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FieldHistoryPageValue;
    expect(body.entries.map((e) => [e.kind, e.recordId])).toEqual([
      ['kept_both', p1],
      ['created', p2],
      ['created', p1],
    ]);
    expect(body.entries[0]!.changedBy.userId).toBe(chw.userId);
    expect(body.entries[0]!.reviewId).not.toBeNull();
    expect(body.nextAfterId).toBeNull();
    const [event] = await expectAudit(h, 'patient.history_viewed', { after: mark, count: 1, patientId: p1 });
    expect(event!.details).toEqual({ field: 'usualArea', count: 3 });
  });

  it('projects problem history like the chart', async () => {
    const all = (await (
      await get(clinician.token, `/v1/patients/${p1}/history?field=status`)
    ).json()) as FieldHistoryPageValue;
    expect(all.entries.map((e) => e.recordId).sort()).toEqual([footProblem, sensitiveProblem].sort());
    const billed = (await (
      await get(billing.token, `/v1/patients/${p1}/history?field=status`)
    ).json()) as FieldHistoryPageValue;
    expect(billed.entries.map((e) => e.recordId)).toEqual([footProblem]);
    const chwPage = (await (
      await get(chw.token, `/v1/patients/${p1}/history?field=status`)
    ).json()) as FieldHistoryPageValue;
    expect(chwPage.entries).toEqual([]);
  });

  it('pages by keyset', async () => {
    const first = (await (
      await get(clinician.token, `/v1/patients/${p1}/history`)
    ).json()) as FieldHistoryPageValue;
    expect(first.entries.length).toBeLessThanOrEqual(HISTORY_PAGE);
    const ids = first.entries.map((e) => Number(e.id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const after = (await (
      await get(clinician.token, `/v1/patients/${p1}/history?afterId=${first.entries[2]!.id}`)
    ).json()) as FieldHistoryPageValue;
    expect(after.entries[0]!.id).toBe(first.entries[3]!.id);
  });

  it('answers 404 for another team’s patient, and refuses a bad field name', async () => {
    expect((await get(clinician.token, `/v1/patients/${otherTeamPatient}/history`)).status).toBe(404);
    expect((await get(clinician.token, `/v1/patients/${p1}/history?field=Delbert%20Smith`)).status).toBe(422);
  });
});

// Phase 5 (design 6.1, 7; D114, D139): the chart's flag changes, the flags worked out from them on the
// server, and each problem's status check. Written ahead of P5-chart-read: until it lands the chart
// carries none of these, and each case fails. What they expect of it, on GET /v1/patients/{patientId}
// and on each chart of POST /v1/patients/charts:
//
// - `flagChanges`: every flag change of the group as a record snapshot (the sync read's, the same
//   shape: patients-flags-sensitive.test.ts), oldest first by effectiveAt, then id.
// - `flags: {primary, secondary, history}`: currentFlags over the group's changes with the reader's
//   flag rule. A flag is `{flagId, name, tier, color, colorName, rank, archived}` as the flag is now;
//   secondary by rank, then name, then id. A history row is `{changeId, flagId, name, tier, action,
//   effectiveAt, authorName, reason, enteredInError: {byName, at, reason} or null}`, oldest first by
//   effectiveAt, then id; names are the people's display names now.
// - Each problem snapshot's `attributes.statusCheckDue`: problemCheckDue with the team's settings
//   preset's problemCheckDays, at the server's time.
describe('the chart’s flags and status checks (phase 5)', () => {
  interface FlagView {
    flagId: string;
    name: string;
    tier: string;
    color: string;
    colorName: string;
    rank: number;
    archived: boolean;
  }
  interface HistoryRow {
    changeId: string;
    flagId: string;
    name: string;
    tier: string;
    action: string;
    effectiveAt: string;
    authorName: string;
    reason?: string;
    enteredInError: { byName: string; at: string; reason?: string } | null;
  }
  type FlagChart = PatientChartValue & {
    flagChanges?: { id: string; entity: string; status: string; attributes: Record<string, unknown> }[];
    flags?: { primary: FlagView | null; secondary: FlagView[]; history: HistoryRow[] };
  };

  let team: PresetsTeam;
  let chw: Person;
  let survivor: string;
  let merged: string;
  let winter: string;
  const minutesAgo = (m: number) => new Date(h.clock.now.getTime() - m * 60_000);

  async function insertChange(c: {
    patientId: string;
    flagKey?: string;
    flagId?: string;
    by: Person;
    reason: string;
    at: Date;
    action?: 'set' | 'clear';
  }): Promise<string> {
    const id = randomUUID();
    await h.scratch.owner`
      insert into sineobex.patient_flag_changes (id, team_id, patient_id, flag_id, action, reason, effective_at,
        device_time, clock_verified, author_user_id)
      values (${id}, ${team.teamId}, ${c.patientId}, ${c.flagId ?? idOf(team, c.flagKey!)}, ${c.action ?? 'set'},
        ${c.reason}, ${c.at}, ${c.at}, true, ${c.by.userId})`;
    return id;
  }

  async function markInError(id: string, by: Person, reason: string, at: Date) {
    await h.scratch.owner`
      update sineobex.patient_flag_changes
      set status = 'entered_in_error', error_reason = ${reason}, error_by = ${by.userId}, error_at = ${at},
          version = version + 1,
          field_versions = field_versions || jsonb_build_object('enteredInError', 1),
          field_meta = field_meta || jsonb_build_object('enteredInError',
            jsonb_build_object('by', ${by.userId}::text, 'at', ${at.toISOString()}::text, 'changeId', null))
      where id = ${id}`;
  }

  const chartOf = async (who: Person, patientId: string) => {
    const r = await call(h, `/v1/patients/${patientId}`, {
      token: await tokenOf(h, who),
      teamId: team.teamId,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as unknown as FlagChart;
  };

  const view = (key: string, o: Partial<FlagView> = {}): FlagView => {
    const platform: Record<string, Omit<FlagView, 'flagId' | 'archived'>> = {
      'flag.high': { name: 'High', tier: 'primary', color: 'red', colorName: 'Red', rank: 10 },
      'flag.medium': { name: 'Medium', tier: 'primary', color: 'yellow', colorName: 'Yellow', rank: 20 },
      'flag.low': { name: 'Low', tier: 'primary', color: 'green', colorName: 'Green', rank: 30 },
      'flag.frost_risk': {
        name: 'Frost risk',
        tier: 'secondary',
        color: 'blue',
        colorName: 'Blue',
        rank: 10,
      },
      'flag.dehydration_risk': {
        name: 'Dehydration risk',
        tier: 'secondary',
        color: 'orange',
        colorName: 'Orange',
        rank: 20,
      },
    };
    return { flagId: idOf(team, key), ...platform[key]!, archived: false, ...o };
  };

  let changes: Record<string, string>;

  beforeAll(async () => {
    team = await presetsTeam(h, 'Chart flags');
    chw = await memberOf(
      h,
      team.teamId,
      ['patients.view', 'patients.edit', 'checkins.create', 'referrals.create', 'routes.view'],
      'Chart flags CHW',
    );
    survivor = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Wren' })).id;
    merged = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Wren two' })).id;
    await mergeDirect(h, team.teamId, merged, survivor, team.admin.userId);
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
    // Both records of the merged chart carry changes; one flag is archived after it was set.
    changes = {
      medium: await insertChange({
        patientId: survivor,
        flagKey: 'flag.medium',
        by: team.staff,
        reason: 'Demo: missed a visit',
        at: minutesAgo(60),
      }),
      high: await insertChange({
        patientId: merged,
        flagKey: 'flag.high',
        by: team.admin,
        reason: 'Demo: back from hospital',
        at: minutesAgo(50),
      }),
      frost: await insertChange({
        patientId: merged,
        flagKey: 'flag.frost_risk',
        by: team.staff,
        reason: 'Demo: sleeping out',
        at: minutesAgo(40),
      }),
      dehydration: await insertChange({
        patientId: survivor,
        flagKey: 'flag.dehydration_risk',
        by: team.staff,
        reason: 'Demo: hot week',
        at: minutesAgo(30),
      }),
      cleared: await insertChange({
        patientId: survivor,
        flagKey: 'flag.dehydration_risk',
        by: team.staff,
        reason: 'Demo: cooler now',
        at: minutesAgo(20),
        action: 'clear',
      }),
      winter: await insertChange({
        patientId: survivor,
        flagId: winter,
        by: team.staff,
        reason: 'Demo: on the winter list',
        at: minutesAgo(10),
      }),
    };
    await archiveDirect(h, team.teamId, winter, team.admin.userId);
  });

  it('works out the group’s flags on the server, both records of a merged chart, an archived flag kept', async () => {
    const c = await chartOf(team.staff, survivor);
    expect(c.flags!.primary).toEqual(view('flag.high'));
    expect(c.flags!.secondary).toEqual([
      view('flag.frost_risk'),
      {
        flagId: winter,
        name: 'Demo: Winter outreach',
        tier: 'secondary',
        color: 'teal',
        colorName: 'Teal',
        rank: 40,
        archived: true,
      },
    ]);
    // A merged ID answers the survivor's chart, its flags included.
    expect((await chartOf(team.staff, merged)).flags).toEqual(c.flags);
  });

  it('lists every change in the history, oldest first, as the flag is now, with who made it by their name now', async () => {
    const c = await chartOf(team.staff, survivor);
    const row = (
      key: string,
      flag: FlagView,
      action: string,
      by: Person,
      reason: string,
      at: number,
    ): HistoryRow => ({
      changeId: changes[key]!,
      flagId: flag.flagId,
      name: flag.name,
      tier: flag.tier,
      action,
      effectiveAt: minutesAgo(at).toISOString(),
      authorName: by.displayName,
      reason,
      enteredInError: null,
    });
    expect(c.flags!.history).toEqual([
      row('medium', view('flag.medium'), 'set', team.staff, 'Demo: missed a visit', 60),
      row('high', view('flag.high'), 'set', team.admin, 'Demo: back from hospital', 50),
      row('frost', view('flag.frost_risk'), 'set', team.staff, 'Demo: sleeping out', 40),
      row('dehydration', view('flag.dehydration_risk'), 'set', team.staff, 'Demo: hot week', 30),
      row('cleared', view('flag.dehydration_risk'), 'clear', team.staff, 'Demo: cooler now', 20),
      row(
        'winter',
        view('flag.frost_risk', { flagId: winter, name: 'Demo: Winter outreach' }),
        'set',
        team.staff,
        'Demo: on the winter list',
        10,
      ),
    ]);
    // Each change is there as the record snapshot the phone imports, in the same order.
    expect(c.flagChanges!.map((s) => [s.entity, s.id])).toEqual(
      Object.values(changes).map((id) => ['patient_flag_change', id]),
    );
    const read = await call(h, '/v1/sync/records', {
      method: 'POST',
      token: await tokenOf(h, team.staff),
      teamId: team.teamId,
      json: { records: [{ entity: 'patient_flag_change', id: changes.frost }] },
    });
    expect(c.flagChanges!.find((s) => s.id === changes.frost)).toEqual(
      (read.body.records as unknown[] | undefined)?.[0],
    );
  });

  it('shows a flag as it is now: an edit renames it everywhere on the chart', async () => {
    const body = {
      name: 'Demo: Winter list',
      tier: 'secondary',
      criteria: '',
      color: 'purple',
      rank: 5,
      sensitive: false,
    };
    await editDirect(h, team.teamId, winter, body, team.admin.userId);
    const c = await chartOf(team.staff, survivor);
    const shown = c.flags!.secondary.find((f) => f.flagId === winter)!;
    expect(shown).toEqual({
      flagId: winter,
      name: 'Demo: Winter list',
      tier: 'secondary',
      color: 'purple',
      colorName: 'Purple',
      rank: 5,
      archived: true,
    });
    // Now ranked first among the conditions.
    expect(c.flags!.secondary.map((f) => f.flagId)).toEqual([winter, idOf(team, 'flag.frost_risk')]);
    expect(c.flags!.history.find((r) => r.changeId === changes.winter)!.name).toBe('Demo: Winter list');
  });

  it('drops a change entered in error out of the flags, and its history row says who marked it and when', async () => {
    const patient = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Lark' }))
      .id;
    await insertChange({
      patientId: patient,
      flagKey: 'flag.medium',
      by: team.staff,
      reason: 'Demo: missed a visit',
      at: minutesAgo(30),
    });
    const wrong = await insertChange({
      patientId: patient,
      flagKey: 'flag.low',
      by: team.staff,
      reason: 'Demo: meant for Wren',
      at: minutesAgo(20),
    });
    const markedAt = minutesAgo(15);
    await markInError(wrong, team.staff, 'Demo: set on the wrong patient', markedAt);
    const c = await chartOf(team.staff, patient);
    expect(c.flags!.primary).toEqual(view('flag.medium'));
    expect(c.flags!.history.find((r) => r.changeId === wrong)).toMatchObject({
      reason: 'Demo: meant for Wren',
      enteredInError: {
        byName: team.staff.displayName,
        at: markedAt.toISOString(),
        reason: 'Demo: set on the wrong patient',
      },
    });
    expect(c.flagChanges!.find((s) => s.id === wrong)!.status).toBe('entered_in_error');
  });

  it('gives a reader without the problem list the flags too, and the phone’s chart bundle the same view', async () => {
    const forChw = await chartOf(chw, survivor);
    expect(forChw.flags!.primary).toEqual(view('flag.high'));
    expect(forChw.flags!.secondary.map((f) => f.flagId)).toContain(idOf(team, 'flag.frost_risk'));
    const r = await call(h, '/v1/patients/charts', {
      method: 'POST',
      token: await tokenOf(h, team.staff),
      teamId: team.teamId,
      json: { patientIds: [survivor], reason: 'opened' },
    });
    expect(r.status).toBe(200);
    const [bundled] = (r.body as unknown as ChartBundleValue).charts as FlagChart[];
    expect(bundled!.flags).toEqual((await chartOf(team.staff, survivor)).flags);
    expect(bundled!.flagChanges!.map((s) => s.id)).toEqual(Object.values(changes));
  });

  it('marks each problem whose status check is due, by the team’s window, on both reads', async () => {
    const patient = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Finch' }))
      .id;
    const days = (n: number) => new Date(h.clock.now.getTime() - n * 86_400_000);
    const problems = {
      newOld: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new'],
        at: days(91),
      }),
      ongoingOld: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new', 'ongoing'],
        at: days(91),
      }),
      newRecent: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new'],
        at: days(10),
      }),
      resolvedOld: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new', 'resolved'],
        at: days(200),
      }),
    };
    const due = async () => {
      const c = await chartOf(team.staff, patient);
      return Object.fromEntries(
        Object.entries(problems).map(([k, id]) => [
          k,
          c.problems!.find((p) => p.id === id)!.attributes.statusCheckDue,
        ]),
      );
    };
    // The platform's window: 90 days.
    expect(await due()).toEqual({ newOld: true, ongoingOld: true, newRecent: false, resolvedOld: false });
    // The team's own window: 7 days.
    const settings = idOf(team, 'settings.team');
    await editDirect(
      h,
      team.teamId,
      settings,
      { name: 'Team settings', bagMinimumsOn: false, newBagMinimums: [], problemCheckDays: 7 },
      team.admin.userId,
    );
    expect(await due()).toEqual({ newOld: true, ongoingOld: true, newRecent: true, resolvedOld: false });
    const r = await call(h, '/v1/patients/charts', {
      method: 'POST',
      token: await tokenOf(h, team.staff),
      teamId: team.teamId,
      json: { patientIds: [patient], reason: 'refresh' },
    });
    const [bundled] = (r.body as unknown as ChartBundleValue).charts;
    expect(bundled!.problems!.find((p) => p.id === problems.newRecent)!.attributes.statusCheckDue).toBe(true);
  });

  it('marks a problem the same way read through sync, so the phone holds one record whichever way it came', async () => {
    const patient = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Plover' }))
      .id;
    const days = (n: number) => new Date(h.clock.now.getTime() - n * 86_400_000);
    await editDirect(
      h,
      team.teamId,
      idOf(team, 'settings.team'),
      { name: 'Team settings', bagMinimumsOn: false, newBagMinimums: [], problemCheckDays: 30 },
      team.admin.userId,
    );
    const problems = {
      due: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new'],
        at: days(40),
      }),
      notDue: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['ongoing'],
        at: days(20),
      }),
      enteredInError: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new'],
        at: days(40),
      }),
      resolved: await createProblem(h, team.teamId, patient, team.admin.userId, {
        statuses: ['new', 'resolved'],
        at: days(40),
      }),
    };
    await h.scratch.owner`
      update sineobex.problems
      set error_reason = 'Demo: on the wrong chart', error_by = ${team.admin.userId}, error_at = ${days(1)}
      where id = ${problems.enteredInError}`;
    const c = await chartOf(team.staff, patient);
    const read = await call(h, '/v1/sync/records', {
      method: 'POST',
      token: await tokenOf(h, team.staff),
      teamId: team.teamId,
      json: { records: Object.values(problems).map((id) => ({ entity: 'problem', id })) },
    });
    expect(read.status).toBe(200);
    const records = read.body.records as { id: string; attributes: Record<string, unknown> }[];
    const dueBy = (snapshots: { id: string; attributes: Record<string, unknown> }[]) =>
      Object.fromEntries(
        Object.entries(problems).map(([k, id]) => [
          k,
          snapshots.find((p) => p.id === id)!.attributes.statusCheckDue,
        ]),
      );
    // The team's window, 30 days, on both reads; never for one entered in error or Resolved.
    const expected = { due: true, notDue: false, enteredInError: false, resolved: false };
    expect(dueBy(c.problems!)).toEqual(expected);
    expect(dueBy(records)).toEqual(expected);
    expect(records).toEqual(Object.values(problems).map((id) => c.problems!.find((p) => p.id === id)));
  });
});

describe('CHART_TABLES (design 13.3, risk 14.2-7)', () => {
  /** Tables with a patient_id column that CHART_TABLES doesn't list. */
  async function unregistered(): Promise<string[]> {
    const rows = await h.scratch.owner<{ tableName: string }[]>`
      select c.table_name as "tableName" from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'sineobex' and c.column_name = 'patient_id' and t.table_type = 'BASE TABLE'
      order by c.table_name`;
    return rows.map((r) => r.tableName).filter((t) => !Object.hasOwn(CHART_TABLES, t));
  }

  it('lists every table with a patient_id column', async () => {
    // A table missing here would show half a merged chart: register it and read it through the group.
    expect(await unregistered()).toEqual([]);
  });

  it('fails for a new child table until it is registered', async () => {
    await h.scratch
      .owner`create table sineobex.test_child_rows (id uuid primary key, patient_id uuid not null)`;
    try {
      expect(await unregistered()).toEqual(['test_child_rows']);
    } finally {
      await h.scratch.owner`drop table sineobex.test_child_rows`;
    }
  });

  it('reads a referral through the group, like the rest of a chart', () => {
    // A merged patient's referrals are every record's referrals (phase 4 design, lifecycle 2.5, 7).
    expect(CHART_TABLES.referrals).toBe('group');
  });

  it('lists only tables that exist', async () => {
    const rows = await h.scratch.owner<{ name: string }[]>`
      select table_name as name from information_schema.tables where table_schema = 'sineobex'`;
    const existing = new Set(rows.map((r) => r.name));
    for (const t of Object.keys(CHART_TABLES)) expect(existing.has(t), t).toBe(true);
  });
});

describe('logs', () => {
  it('never mention a name, a token or a chart value', () => {
    expect(spy.lines.length).toBeGreaterThan(0);
    spy.expectClean(['delbert', 'smitty', 'lefty', 'penicillin', 'opioid', TOKEN.toLowerCase(), 'elm st']);
  });
});
