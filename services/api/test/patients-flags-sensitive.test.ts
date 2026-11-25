import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Permission } from '../src/auth/permissions.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, memberWith, type Member } from './patient-fixtures.ts';
import { platformIds } from './presets-fixtures.ts';
import {
  call,
  clinician,
  FakePhone,
  push,
  register,
  results,
  setRole,
  setupTeam,
  type Change,
  type Clinician,
  type Team,
} from './sync-fixtures.ts';

// One flag rule, wherever a flag is read (phase 5 design 6.2, 7, 9; D136): flagHidden, the
// sensitive-problem rule, hides a sensitive flag from a reader who may not see a sensitive problem
// (mayViewProblems and patients.view_sensitive), and flagChangeShown gives an entered-in-error
// change's reasons only to its author and Program Admins (team.manage_users). Read here through
// the sync read, the review queue, a retry's answer, the chart, the phone's chart bundle, the team
// index, search, the flag routes and the portal's flag list. A hidden flag and every history row of
// it are absent, its reason included, never blanked. Every person, patient and reason is made up.
//
// Written ahead of P5-read-rule, P5-entity, P5-chart-read, P5-index, P5-route and P5-search: each
// case fails until the card that builds what it reads lands. What they expect, beyond the other
// flag tests' files:
//
// - A flag change's snapshot (the sync read, and the chart's flagChanges): entity
//   `patient_flag_change`, its row's version and status, attributes exactly `{patientId, flagId,
//   action, reason, effectiveAt, clockVerified}` (effectiveAt an ISO time), and one field,
//   `enteredInError`: null at version 0 until it is marked, then `{reason}` at version 1. For a reader
//   who is neither its author nor a holder of team.manage_users, an entered-in-error change keeps
//   no reason: no `reason` attribute, and its field's value `{}`.
// - The chart's `flags: {primary, secondary, history}` (patients-charts.test.ts has its shape): a
//   history row's `reason`, and its `enteredInError.reason`, left out as the snapshot's are.
// - A hidden flag's change is missing from the sync read, as a record the team does not have; in the
//   review queue it is listed hidden (no field, no value) and its accept is 403 change_hidden.

const SECRET = 'Demo: told the team at the clinic';
const WHY = 'Demo: sleeping out in the cold';
const ERROR_WHY = 'Demo: set on the wrong patient';

type Entity = Parameters<FakePhone['change']>[0]['entity'];
const FLAG_CHANGE = 'patient_flag_change' as string as Entity;

interface Snapshot {
  entity: string;
  id: string;
  version: number;
  status: string;
  authorUserId: string;
  attributes: Record<string, unknown>;
  fields: Record<
    string,
    { value: unknown; version: number; changedBy: string | null; changedAt: string | null }
  >;
}
interface FlagView {
  flagId: string;
  name: string;
}
interface HistoryRow {
  changeId: string;
  flagId: string;
  reason?: string;
  enteredInError: { byName: string; at: string; reason?: string } | null;
}
interface Flags {
  primary: FlagView | null;
  secondary: FlagView[];
  history: HistoryRow[];
}
interface Chart {
  canonicalId: string;
  flagChanges?: Snapshot[];
  flags?: Flags;
}

let h: Harness;
let t: Team;
let ids: Record<string, string>;
let patient: string;
let kim: Clinician;
let ivy: Clinician;
let lee: Clinician;
let bo: Clinician;
/** May review held changes and read patients, with no sight of sensitive ones. */
let reviewer: Member;
let readers: Record<string, { token: string; sees: boolean }>;
/** The changes on the patient, written straight to the database (design 4.5). */
let pregnancy: string;
let frost: string;
let high: string;
/** Ivy's, entered in error by her. */
let mistaken: string;
/** Kim's sensitive one, entered in error by her: hidden whole from whoever may not see it. */
let mistakenSensitive: string;

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

async function insertChange(c: {
  flagId: string;
  author: string;
  reason: string;
  minutesAgo: number;
  action?: 'set' | 'clear';
  mark?: { reason: string; by: string };
}): Promise<string> {
  const id = randomUUID();
  const sql = h.scratch.owner;
  const when = at(c.minutesAgo);
  await sql`
    insert into sineobex.patient_flag_changes (id, team_id, patient_id, flag_id, action, reason, effective_at,
      device_time, clock_verified, author_user_id)
    values (${id}, ${t.teamId}, ${patient}, ${c.flagId}, ${c.action ?? 'set'}, ${c.reason}, ${when}, ${when}, true,
      ${c.author})`;
  if (c.mark) {
    const markedAt = at(c.minutesAgo - 1).toISOString();
    await sql`
      update sineobex.patient_flag_changes
      set status = 'entered_in_error', error_reason = ${c.mark.reason}, error_by = ${c.mark.by},
          error_at = ${markedAt}, version = version + 1,
          field_versions = field_versions || jsonb_build_object('enteredInError', 1),
          field_meta = field_meta || jsonb_build_object('enteredInError',
            jsonb_build_object('by', ${c.mark.by}::text, 'at', ${markedAt}::text, 'changeId', null))
      where id = ${id}`;
  }
  return id;
}

beforeAll(async () => {
  h = await createHarness();
  t = await setupTeam(h);
  ids = await platformIds(h, t.teamId);
  patient = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Ash' })).id;
  kim = await clinician(h, t, 'kim@example.com', 'Kim (demo)', 'none');
  ivy = await clinician(h, t, 'ivy@example.com', 'Ivy (demo)', 'none');
  lee = await clinician(h, t, 'lee@example.com', 'Lee (demo)', 'chw', 'community_health_worker');
  bo = await clinician(h, t, 'bo@example.com', 'Bo (demo)', 'none', 'billing_data');
  reviewer = await memberWith(h, t.teamId, ['quarantine.review', 'patients.view']);
  const custom = async (permissions: Permission[]) => (await memberWith(h, t.teamId, permissions)).token;
  readers = {
    'Program Admin': { token: t.adminToken, sees: true },
    'Healthcare Staff': { token: kim.token, sees: true },
    'the CHW preset': { token: lee.token, sees: false },
    'Billing/Data': { token: bo.token, sees: false },
    // Risk 6 of 12.1: patients.view_sensitive without the problem list sees no sensitive flag.
    'patients.view_sensitive without the problem list': {
      token: await custom(['patients.view', 'patients.edit', 'patients.view_sensitive']),
      sees: false,
    },
    'billing.view_codes with patients.view_sensitive': {
      token: await custom(['patients.view', 'billing.view_codes', 'patients.view_sensitive']),
      sees: true,
    },
  };
  pregnancy = await insertChange({
    flagId: ids['flag.pregnancy']!,
    author: kim.id,
    reason: SECRET,
    minutesAgo: 50,
  });
  frost = await insertChange({
    flagId: ids['flag.frost_risk']!,
    author: kim.id,
    reason: WHY,
    minutesAgo: 40,
  });
  high = await insertChange({ flagId: ids['flag.high']!, author: ivy.id, reason: WHY, minutesAgo: 30 });
  mistaken = await insertChange({
    flagId: ids['flag.dehydration_risk']!,
    author: ivy.id,
    reason: 'Demo: drank nothing all day',
    minutesAgo: 20,
    mark: { reason: ERROR_WHY, by: ivy.id },
  });
  mistakenSensitive = await insertChange({
    flagId: ids['flag.pregnancy']!,
    author: kim.id,
    reason: 'Demo: a second note of it',
    minutesAgo: 10,
    mark: { reason: 'Demo: meant for someone else', by: kim.id },
  });
});
afterAll(() => h.close());

const syncRead = async (token: string, recordIds: string[]) => {
  const r = await call(h, '/v1/sync/records', {
    method: 'POST',
    token,
    teamId: t.teamId,
    json: { records: recordIds.map((id) => ({ entity: 'patient_flag_change', id })) },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return {
    records: r.body.records as Snapshot[],
    missing: (r.body.missing as { id: string }[]).map((m) => m.id),
  };
};

const chartFor = async (token: string) => {
  const r = await call(h, `/v1/patients/${patient}`, { token, teamId: t.teamId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as unknown as Chart;
};

const hiddenIds = () => [ids['flag.pregnancy']!, pregnancy, mistakenSensitive];

/** Nothing of the hidden flag anywhere in an answer: no id, no change, no reason, no blank row. */
function expectNothingOfIt(answer: unknown) {
  const text = JSON.stringify(answer);
  for (const id of hiddenIds()) expect(text).not.toContain(id);
  for (const reason of [SECRET, 'Demo: a second note of it', 'Demo: meant for someone else'])
    expect(text).not.toContain(reason);
}

describe('the sync read', () => {
  it('leaves out a hidden flag’s change, as a record the team does not have, and logs only what it shows', async () => {
    for (const [who, reader] of Object.entries(readers)) {
      const before = await auditMark(h);
      const read = await syncRead(reader.token, [pregnancy, frost]);
      expect(read.missing, who).toEqual(reader.sees ? [] : [pregnancy]);
      expect(
        read.records.map((r) => r.id),
        who,
      ).toEqual(reader.sees ? [pregnancy, frost] : [frost]);
      const viewed = await expectAudit(h, 'patient.viewed', { after: before, patientId: patient });
      expect(viewed.map((e) => e.entityId).sort(), who).toEqual(
        reader.sees ? [frost, pregnancy].sort() : [frost],
      );
      // `missing` names back the id the reader asked for, as for a record the team does not have; the
      // records hold nothing of it.
      if (!reader.sees) expectNothingOfIt(read.records);
    }
  });

  it('shows a change whole to one who may see it, and an entered-in-error one’s reasons only to its author and Program Admins', async () => {
    const [shown] = (await syncRead(kim.token, [frost])).records;
    expect(shown).toEqual({
      entity: 'patient_flag_change',
      id: frost,
      version: 1,
      status: 'active',
      authorUserId: kim.id,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      attributes: {
        patientId: patient,
        flagId: ids['flag.frost_risk'],
        action: 'set',
        reason: WHY,
        effectiveAt: expect.any(String),
        clockVerified: true,
      },
      fields: { enteredInError: { value: null, version: 0, changedBy: null, changedAt: null } },
    });
    for (const token of [ivy.token, t.adminToken]) {
      const [own] = (await syncRead(token, [mistaken])).records;
      expect(own).toMatchObject({
        status: 'entered_in_error',
        version: 2,
        attributes: { reason: 'Demo: drank nothing all day' },
        fields: { enteredInError: { value: { reason: ERROR_WHY }, version: 1, changedBy: ivy.id } },
      });
    }
    for (const token of [kim.token, lee.token]) {
      const [other] = (await syncRead(token, [mistaken])).records;
      expect(other!.status).toBe('entered_in_error');
      expect(Object.keys(other!.attributes).sort()).toEqual(
        ['action', 'clockVerified', 'effectiveAt', 'flagId', 'patientId'].sort(),
      );
      expect(other!.fields).toEqual({
        enteredInError: { value: {}, version: 1, changedBy: ivy.id, changedAt: expect.any(String) },
      });
      expect(JSON.stringify(other)).not.toContain('drank nothing');
      expect(JSON.stringify(other)).not.toContain(ERROR_WHY);
    }
  });
});

describe('the review queue (D87)', () => {
  const queueFor = async (token: string) => {
    const r = await call(h, `/v1/team/quarantine?userId=${bo.id}`, { token, teamId: t.teamId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.items as {
      id: string;
      changeId: string;
      field: string | null;
      value: unknown;
      hidden?: true;
    }[];
  };
  const decide = (token: string, itemId: string, decision: 'accept' | 'reject') =>
    call(h, `/v1/team/quarantine/${itemId}/decision`, {
      method: 'POST',
      token,
      teamId: t.teamId,
      json: { decision, reason: 'Demo: checked with the team' },
    });

  it('neither lists nor accepts a held create of a hidden flag, or a held mark of its change, for a reviewer it is hidden from', async () => {
    // Billing/Data holds no patients.edit: each change is held for a Program Admin.
    const create = await bo.phone.change({
      entity: FLAG_CHANGE,
      op: 'create',
      value: { patientId: patient, flagId: ids['flag.pregnancy'], action: 'set', reason: SECRET },
    });
    const mark = await bo.phone.change({
      entity: FLAG_CHANGE,
      recordId: pregnancy,
      op: 'set',
      field: 'enteredInError',
      value: { reason: ERROR_WHY },
    });
    const seen = await bo.phone.change({
      entity: FLAG_CHANGE,
      op: 'create',
      value: { patientId: patient, flagId: ids['flag.frost_risk'], action: 'clear', reason: WHY },
    });
    expect((await bo.send(create, mark, seen)).map((r) => [r.reason, r.quarantined])).toEqual([
      ['permission', true],
      ['permission', true],
      ['permission', true],
    ]);
    const byChange = (items: Awaited<ReturnType<typeof queueFor>>, c: Change) =>
      items.find((i) => i.changeId === c.changeId)!;

    const items = await queueFor(reviewer.token);
    for (const c of [create, mark]) {
      expect(byChange(items, c)).toMatchObject({ field: null, value: null, hidden: true });
      const accepted = await decide(reviewer.token, byChange(items, c).id, 'accept');
      expect([accepted.status, (accepted.body.error as { code: string }).code]).toEqual([
        403,
        'change_hidden',
      ]);
    }
    expect(byChange(items, seen)).toMatchObject({
      field: null,
      value: { patientId: patient, flagId: ids['flag.frost_risk'], action: 'clear', reason: WHY },
    });
    expect(byChange(items, seen).hidden).toBeUndefined();
    // A hidden item names its record, as the queue names every item's, and nothing of what it holds.
    const hidden = JSON.stringify(items.filter((i) => i.changeId !== seen.changeId));
    for (const text of [SECRET, ERROR_WHY, ids['flag.pregnancy']!]) expect(hidden).not.toContain(text);

    // A reviewer who may see the flag reads both, and may accept them.
    const forAdmin = await queueFor(t.adminToken);
    expect(byChange(forAdmin, create)).toMatchObject({ value: { reason: SECRET } });
    expect(byChange(forAdmin, mark)).toMatchObject({ field: 'enteredInError', value: { reason: ERROR_WHY } });
    expect((await decide(t.adminToken, byChange(forAdmin, create).id, 'accept')).status).toBe(200);
    expect((await decide(t.adminToken, byChange(forAdmin, mark).id, 'reject')).status).toBe(200);
  });

  it('hides a held change naming a flag the team does not hold from every reviewer, who may still reject it', async () => {
    // The flag rule's team half: a flag that is none of the team's is shown to nobody, a Program
    // Admin included, so nothing of the change is read and it cannot be accepted.
    const stray = await bo.phone.change({
      entity: FLAG_CHANGE,
      op: 'create',
      value: { patientId: patient, flagId: randomUUID(), action: 'set', reason: WHY },
    });
    expect((await bo.send(stray)).map((r) => [r.reason, r.quarantined])).toEqual([['permission', true]]);
    const item = (await queueFor(t.adminToken)).find((i) => i.changeId === stray.changeId)!;
    expect(item).toMatchObject({ field: null, value: null, hidden: true });
    expect(JSON.stringify(item)).not.toContain(WHY);
    const accepted = await decide(t.adminToken, item.id, 'accept');
    expect([accepted.status, (accepted.body.error as { code: string }).code]).toEqual([403, 'change_hidden']);
    expect((await decide(t.adminToken, item.id, 'reject')).status).toBe(200);
  });
});

describe('a value sent back (D86)', () => {
  it('a retry is answered with nothing of a flag hidden from its sender since, and logs no read', async () => {
    const rio = await clinician(h, t, 'rio@example.com', 'Rio (demo)', 'none');
    const made = await rio.phone.change({
      entity: FLAG_CHANGE,
      op: 'create',
      value: { patientId: patient, flagId: ids['flag.pregnancy'], action: 'set', reason: 'Demo: Rio’s own' },
    });
    const markOf = (reason: string) =>
      rio.phone.change({
        entity: FLAG_CHANGE,
        recordId: made.recordId,
        op: 'set',
        field: 'enteredInError',
        value: { reason },
      });
    const first = await markOf('Demo: on the wrong patient');
    const second = await markOf('Demo: second thoughts');
    expect((await rio.send(made, first)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const [kept] = await rio.send(second);
    expect(kept).toMatchObject({
      status: 'accepted',
      details: { outcome: 'history_only' },
      server: { value: { reason: 'Demo: on the wrong patient' }, version: 1 },
    });
    // Rio's role loses sight of sensitive flags; the same change sent again shows nothing of it.
    await setRole(h, t, rio.membershipId, 'community_health_worker');
    const before = await auditMark(h);
    const [again] = await rio.send(second);
    expect(again).toMatchObject({ status: 'accepted', details: { outcome: 'history_only' } });
    expect(again!.server).toEqual({ value: null, version: 0, changedBy: null, changedAt: null });
    await expectAudit(h, 'patient.viewed', { after: before, count: 0 });
  });

  it('a retry of a mark kept in history gives the change’s reasons only to its author and Program Admins, as they are now', async () => {
    // A patient of its own, so the chart cases below read only theirs.
    const elsewhere = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Cedar' })).id;
    const made = await kim.phone.change({
      entity: FLAG_CHANGE,
      op: 'create',
      value: {
        patientId: elsewhere,
        flagId: ids['flag.frost_risk'],
        action: 'set',
        reason: 'Demo: Kim’s own',
      },
    });
    const markBy = (phone: FakePhone, reason: string) =>
      phone.change({
        entity: FLAG_CHANGE,
        recordId: made.recordId,
        op: 'set',
        field: 'enteredInError',
        value: { reason },
      });
    const phoneOf = async (token: string) => {
      const phone = await FakePhone.create();
      await register(h, phone, token, t.teamId);
      return {
        phone,
        send: async (...changes: Change[]) => results((await push(h, phone, token, t.teamId, changes)).body),
      };
    };
    // A Program Admin marks Kim's change.
    const admin = await phoneOf(t.adminToken);
    const first = await markBy(admin.phone, ERROR_WHY);
    expect((await kim.send(made)).map((r) => r.status)).toEqual(['accepted']);
    expect((await admin.send(first)).map((r) => r.status)).toEqual(['accepted']);
    const kept = { status: 'accepted', details: { outcome: 'history_only' } };
    const why = { value: { reason: ERROR_WHY }, version: 1, changedBy: t.adminId };
    // Marked, by whom and when, and nothing of why: as their sync read shows the field.
    const withheld = { value: {}, version: 1, changedBy: t.adminId, changedAt: expect.any(String) };

    // Its author's own second mark is kept in history and answered with the mark that stands.
    const byKim = await markBy(kim.phone, 'Demo: Kim looks again');
    expect((await kim.send(byKim))[0]).toMatchObject({ ...kept, server: why });

    // Ivy neither made it nor manages the team's people: her mark is held, a Program Admin accepts
    // it into history, and the same change sent again tells her nothing of why.
    const byIvy = await markBy(ivy.phone, 'Demo: Ivy thinks so too');
    expect((await ivy.send(byIvy))[0]).toMatchObject({ reason: 'permission', quarantined: true });
    const [item] = await h.scratch.owner<{ id: string }[]>`
      select id from sineobex.quarantine_items where change_id = ${byIvy.changeId}`;
    const accepted = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
      method: 'POST',
      token: t.adminToken,
      teamId: t.teamId,
      json: { decision: 'accept', reason: 'Demo: checked with the team' },
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const [ivysRetry] = await ivy.send(byIvy);
    expect(ivysRetry).toMatchObject(kept);
    expect(ivysRetry!.server).toEqual(withheld);
    expect((await syncRead(ivy.token, [made.recordId])).records[0]!.fields.enteredInError).toEqual(withheld);

    // A lead who manages the team's people is answered with why; moved to Healthcare Staff, the
    // same change sent again is answered as they may see it now.
    const lead = await memberWith(h, t.teamId, ['patients.view', 'patients.edit', 'team.manage_users']);
    const leads = await phoneOf(lead.token);
    const byLead = await markBy(leads.phone, 'Demo: the lead marks it again');
    expect((await leads.send(byLead))[0]).toMatchObject({ ...kept, server: why });
    await setRole(h, t, lead.membershipId, 'healthcare_staff');
    const [leadsRetry] = await leads.send(byLead);
    expect(leadsRetry).toMatchObject(kept);
    expect(leadsRetry!.server).toEqual(withheld);
    expect(JSON.stringify([ivysRetry, leadsRetry])).not.toContain(ERROR_WHY);
  });
});

describe('the chart', () => {
  it('leaves out a hidden flag and every history row of it, its reason included, never blanked', async () => {
    const full = await chartFor(kim.token);
    const shown = await chartFor(lee.token);
    expect(full.flags!.secondary.map((f) => f.flagId)).toContain(ids['flag.pregnancy']);
    expect(shown.flags!.secondary.map((f) => f.flagId)).toEqual([ids['flag.frost_risk']]);
    expect(shown.flags!.primary!.flagId).toBe(ids['flag.high']);
    // Every row of the hidden flag is gone, and only those.
    const visible = [frost, high, mistaken];
    expect(full.flags!.history.map((r) => r.changeId)).toEqual(
      expect.arrayContaining([...visible, pregnancy, mistakenSensitive]),
    );
    expect(shown.flags!.history.map((r) => r.changeId).sort()).toEqual([...visible].sort());
    expect(shown.flagChanges!.map((s) => s.id).sort()).toEqual([...visible].sort());
    for (const r of shown.flags!.history) expect(r.flagId).not.toBeNull();
    expectNothingOfIt(shown);
  });

  it('gives an entered-in-error change’s reasons only to its author and Program Admins', async () => {
    const rowOf = (c: Chart) => c.flags!.history.find((r) => r.changeId === mistaken)!;
    for (const token of [ivy.token, t.adminToken]) {
      expect(rowOf(await chartFor(token))).toMatchObject({
        reason: 'Demo: drank nothing all day',
        enteredInError: { byName: 'Ivy (demo)', reason: ERROR_WHY },
      });
    }
    for (const token of [kim.token, lee.token]) {
      const c = await chartFor(token);
      const r = rowOf(c);
      expect(Object.keys(r)).not.toContain('reason');
      expect(r.enteredInError).toEqual({ byName: 'Ivy (demo)', at: expect.any(String) });
      const snapshot = c.flagChanges!.find((s) => s.id === mistaken)!;
      expect(Object.keys(snapshot.attributes)).not.toContain('reason');
      expect(snapshot.fields.enteredInError!.value).toEqual({});
      expect(JSON.stringify(c)).not.toContain('drank nothing');
      expect(JSON.stringify(c)).not.toContain(ERROR_WHY);
    }
  });

  it('the phone’s chart bundle follows the same rule', async () => {
    const r = await call(h, '/v1/patients/charts', {
      method: 'POST',
      token: lee.token,
      teamId: t.teamId,
      json: { patientIds: [patient], reason: 'opened' },
    });
    expect(r.status).toBe(200);
    const [c] = r.body.charts as Chart[];
    expect(c!.flags!.secondary.map((f) => f.flagId)).toEqual([ids['flag.frost_risk']]);
    expect(c!.flagChanges!.map((s) => s.id).sort()).toEqual([frost, high, mistaken].sort());
    expectNothingOfIt(r.body);
  });

  it('who sees a sensitive flag is who sees a sensitive problem (section 11, row 29)', async () => {
    for (const [who, reader] of Object.entries(readers)) {
      const c = await chartFor(reader.token);
      expect(
        c.flags!.secondary.some((f) => f.flagId === ids['flag.pregnancy']),
        who,
      ).toBe(reader.sees);
      expect(
        c.flagChanges!.some((s) => s.id === pregnancy),
        who,
      ).toBe(reader.sees);
      if (!reader.sees) expectNothingOfIt(c);
    }
  });
});

describe('the team index, search, the flag routes and the flag list', () => {
  it('the team index leaves a hidden flag out of each entry, and a reader who sees them holds idx1+sens', async () => {
    for (const [token, sees] of [
      [kim.token, true],
      [lee.token, false],
    ] as const) {
      const r = await call(h, '/v1/patients/index', { method: 'POST', token, teamId: t.teamId, json: {} });
      expect(r.status).toBe(200);
      expect(r.body.projection).toBe(sees ? 'idx1+sens' : 'idx1');
      expect(String(r.body.version)).toMatch(sees ? /^\d+\.idx1\+sens$/ : /^\d+\.idx1$/);
      const entry = (
        r.body.entries as { patientId: string; flags: { primary: string | null; secondary: string[] } }[]
      ).find((e) => e.patientId === patient)!;
      expect(entry.flags).toEqual({
        primary: ids['flag.high'],
        secondary: sees ? [ids['flag.frost_risk'], ids['flag.pregnancy']] : [ids['flag.frost_risk']],
      });
      if (!sees) expectNothingOfIt(r.body);
    }
  });

  it('search refuses a hidden flag id with 403, logged and never naming it, and narrows by one the reader sees', async () => {
    const search = (token: string, flagIds: string[]) =>
      call(h, '/v1/patients/search', {
        method: 'POST',
        token,
        teamId: t.teamId,
        json: { name: 'Demo Ash', surface: 'portal', flagIds },
      });
    const before = await auditMark(h);
    const refused = await search(lee.token, [ids['flag.pregnancy']!]);
    expect(refused.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
    expect(denied!.details).toMatchObject({
      permission: 'patients.view_sensitive',
      route: '/v1/patients/search',
    });
    expect(JSON.stringify(denied)).not.toContain(ids['flag.pregnancy']);
    await expectAudit(h, 'patient.searched', { after: before, count: 0 });
    for (const [token, flagId] of [
      [lee.token, ids['flag.frost_risk']!],
      [kim.token, ids['flag.pregnancy']!],
    ] as const) {
      const r = await search(token, [flagId]);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((r.body.hits as { patientId: string }[]).map((x) => x.patientId)).toEqual([patient]);
    }
  });

  it('the flag routes refuse a hidden flag, and the flag list leaves it out', async () => {
    const before = await auditMark(h);
    const set = await call(h, `/v1/patients/${patient}/flags`, {
      method: 'POST',
      token: lee.token,
      teamId: t.teamId,
      json: {
        id: randomUUID(),
        flagId: ids['flag.pregnancy'],
        action: 'set',
        reason: 'Demo: heard it today',
      },
    });
    expect(set.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
    expect(denied!.patientId).toBe(patient);
    for (const [who, reader] of Object.entries(readers)) {
      const list = await call(h, '/v1/presets/flags', { token: reader.token, teamId: t.teamId });
      expect(list.status, who).toBe(200);
      expect(
        (list.body as unknown as { flagId: string }[]).some((f) => f.flagId === ids['flag.pregnancy']),
        who,
      ).toBe(reader.sees);
    }
  });
});
