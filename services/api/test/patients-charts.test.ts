import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
import { CHART_TABLES } from '../src/patients/charts.ts';
import { HISTORY_PAGE } from '../src/patients/history.ts';
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
  });

  it('answers a merged ID with the survivor’s chart', async () => {
    const c = await chart(clinician.token, p2);
    expect(c.canonicalId).toBe(p1);
    expect(c.redirectedFrom).toBe(p2);
  });

  it('shows Billing/Data the whole chart without sensitive problems or card links (D38)', async () => {
    const c = await chart(billing.token, p1);
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
