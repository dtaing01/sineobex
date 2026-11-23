import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, expectAudit, expectAuditClean } from './patient-fixtures.ts';
import {
  archiveDirect,
  asWriter,
  auditMark,
  errorOf,
  idOf,
  insertPreset,
  memberOf,
  presetsTeam,
  REASON as PRESET_REASON,
  tokenOf,
  whileLocked,
  type Answer,
  type Person,
  type PresetsTeam,
} from './presets-fixtures.ts';
import { call } from './sync-fixtures.ts';

// The flag routes that only work online (phase 5 design 7, 9; D115, D136): the portal's two writes
// on a patient, POST /v1/patients/{patientId}/flags and the Entered in error mark, and the portal's
// flag list, GET /v1/presets/flags. Every person, patient and reason here is made up.
//
// Written ahead of P5-route (and P5-entity's insertFlagChange, which the writes call): until it
// lands each route answers 404 and every case fails. What these tests expect:
//
// - POST /v1/patients/{patientId}/flags, `{id, flagId, action, reason}`: patients.view and
//   patients.edit; 201 `{id}`. `id` is made once per form by the page: the same id again answers the
//   first answer and writes nothing more (D115). Refusals, in insertFlagChange's order: 404
//   `not_found` for a patient the team does not hold; 422 `unknown_flag`, then 422 `reason_invalid`
//   (empty, untrimmed, over 500 code points); 409 `archived` for a set of an archived flag (a clear is
//   taken); 403 for a flag hidden from the caller, logged `access.denied` with the patient and
//   `permission: 'patients.view_sensitive'`, never the flag. A body its schema refuses is 422
//   `validation_failed`. Takes the team lock first; `patient_flag.changed` in its transaction.
// - POST /v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error, `{reason}` (3 to 300):
//   patients.edit; the change's author or a holder of team.manage_users, else 403 logged; a change
//   of a flag hidden from the caller, 403 logged as the set is; 404 for a change the patient's
//   group does not hold; 409 `already_marked`; 200 `{version}`. Writes the mark as sync does, with
//   its history row; `patient_flag.entered_in_error` in its transaction.
// - GET /v1/presets/flags: patients.view; `[{flagId, name, tier, color, colorName, rank}]`, the
//   team's active flags the caller may see (flagHidden), primary before secondary, each tier by
//   rank, then name, then id. Names no patient and writes no audit event.

const REASON = 'Demo: missed two follow-ups this month';

interface FlagRow {
  id: string;
  patientId: string;
  flagId: string;
  action: string;
  reason: string;
  effectiveAt: Date;
  receivedAt: Date;
  deviceTime: Date | null;
  createdDeviceId: string | null;
  changeId: string | null;
  authorUserId: string;
  approvedBy: string | null;
  status: string;
  errorReason: string | null;
  errorBy: string | null;
  version: number;
}

let h: Harness;
let team: PresetsTeam;
let patient: string;
let otherPatient: string;
/** The CHW preset: patients.edit and no problem list, so no sight of a sensitive flag. */
let chw: Person;
/** Billing/Data: no patients.edit. */
let billing: Person;
/** Healthcare Staff, as the team's staff member, and a second one. */
let nurse: Person;

beforeAll(async () => {
  h = await createHarness();
  team = await presetsTeam(h, 'Flags');
  patient = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Ash' })).id;
  otherPatient = (await createPatient(h, team.teamId, team.admin.userId, { preferredName: 'Demo Birch' })).id;
  chw = await memberOf(
    h,
    team.teamId,
    ['patients.view', 'patients.edit', 'checkins.create', 'referrals.create', 'routes.view'],
    'Flags CHW',
  );
  billing = await memberOf(
    h,
    team.teamId,
    ['patients.view', 'billing.view_codes', 'inventory.view', 'exports.billing', 'exports.grant'],
    'Flags Billing',
  );
  nurse = await memberOf(
    h,
    team.teamId,
    ['patients.view', 'patients.edit', 'patients.view_sensitive', 'encounters.chart'],
    'Flags Nurse',
  );
});
afterAll(() => h.close());

const flagId = (key: string) => idOf(team, key);

/** A preset restored straight in the database by `by`, as archiveDirect archives one. */
const restoreDirect = (teamId: string, id: string, by: string) =>
  asWriter(h, teamId, async (tx, revision) => {
    const [head] = await tx<{ version: number }[]>`
      update sineobex.team_presets
      set state = 'active', customized = true, revision = ${revision}, updated_by = ${by}
      where id = ${id} returning current_version as version`;
    await tx`
      insert into sineobex.team_preset_events (team_id, preset_id, act, version, reason, created_by)
      values (${teamId}, ${id}, 'restored', ${head!.version}, ${PRESET_REASON}, ${by})`;
  });

const send = async (who: Person, method: 'GET' | 'POST', path: string, json?: unknown): Promise<Answer> =>
  call(h, path, {
    method,
    token: await tokenOf(h, who),
    teamId: team.teamId,
    ...(json === undefined ? {} : { json }),
  });

const setFlag = (
  who: Person,
  patientId: string,
  body: { id?: string; flagId: string; action?: 'set' | 'clear'; reason?: unknown },
) =>
  send(who, 'POST', `/v1/patients/${patientId}/flags`, {
    id: body.id ?? randomUUID(),
    flagId: body.flagId,
    action: body.action ?? 'set',
    reason: body.reason === undefined ? REASON : body.reason,
  });

const markOf = (
  who: Person,
  patientId: string,
  changeId: string,
  reason: unknown = 'Demo: set on the wrong patient',
) => send(who, 'POST', `/v1/patients/${patientId}/flag-changes/${changeId}/entered-in-error`, { reason });

const row = async (id: string) =>
  (
    await h.scratch.owner<FlagRow[]>`
      select id, patient_id as "patientId", flag_id as "flagId", action, reason, effective_at as "effectiveAt",
             received_at as "receivedAt", device_time as "deviceTime", created_device_id as "createdDeviceId",
             change_id as "changeId", author_user_id as "authorUserId", approved_by as "approvedBy", status,
             error_reason as "errorReason", error_by as "errorBy", version
      from sineobex.patient_flag_changes where id = ${id}`
  )[0];

const rowsOf = async (patientId: string) =>
  Number(
    (
      await h.scratch.owner<{ n: number }[]>`
        select count(*)::int as n from sineobex.patient_flag_changes where patient_id = ${patientId}`
    )[0]!.n,
  );

const xidOf = async (
  table: 'patient_flag_changes' | 'audit_events',
  where: { id?: string; entityId?: string },
) =>
  table === 'patient_flag_changes'
    ? (
        await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.patient_flag_changes where id = ${where.id!}`
      )[0]!.xid
    : (
        await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.audit_events where entity_id = ${where.entityId!}
        order by id desc limit 1`
      )[0]!.xid;

describe('POST /v1/patients/{patientId}/flags', () => {
  it('sets a flag at the server’s time, with an id made once per form, and logs it in its transaction', async () => {
    const before = await auditMark(h);
    const id = randomUUID();
    const made = await setFlag(team.staff, patient, { id, flagId: flagId('flag.high') });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toEqual({ id });
    const stored = await row(id);
    expect(stored).toMatchObject({
      patientId: patient,
      flagId: flagId('flag.high'),
      action: 'set',
      reason: REASON,
      deviceTime: null,
      createdDeviceId: null,
      changeId: null,
      authorUserId: team.staff.userId,
      approvedBy: null,
      status: 'active',
      version: 1,
    });
    // Made at the desk: its time is the server's receipt (4.5).
    expect(stored!.effectiveAt.getTime()).toBe(stored!.receivedAt.getTime());
    const [event] = await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
    expect(event).toMatchObject({
      actorUserId: team.staff.userId,
      entity: 'patient_flag_change',
      entityId: id,
      patientId: patient,
    });
    expect(event!.details).toMatchObject({ action: 'set', tier: 'primary', flagId: flagId('flag.high') });
    expect(await xidOf('audit_events', { entityId: id })).toBe(await xidOf('patient_flag_changes', { id }));
    await expectAuditClean(h, [REASON, 'follow-ups'], before);

    // A retry after a dropped connection gets the first answer, not a second history row (D115).
    const retry = await setFlag(team.staff, patient, { id, flagId: flagId('flag.high') });
    expect([retry.status, retry.body]).toEqual([201, { id }]);
    expect(await rowsOf(patient)).toBe(1);
    await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
  });

  it('clears a flag, and a sensitive one is logged without its flag', async () => {
    const before = await auditMark(h);
    const clear = await setFlag(team.staff, patient, { flagId: flagId('flag.high'), action: 'clear' });
    expect(clear.status).toBe(201);
    const pregnancy = await setFlag(team.staff, otherPatient, { flagId: flagId('flag.pregnancy') });
    expect(pregnancy.status).toBe(201);
    const events = await expectAudit(h, 'patient_flag.changed', { after: before, count: 2 });
    expect(events[0]!.details).toMatchObject({
      action: 'clear',
      tier: 'primary',
      flagId: flagId('flag.high'),
    });
    expect(events[1]!.details).toMatchObject({ action: 'set', tier: 'secondary' });
    expect(Object.keys(events[1]!.details)).not.toContain('flagId');
    expect(JSON.stringify(events.map((e) => e.details))).not.toContain(flagId('flag.pregnancy'));
  });

  it('takes the team lock before anything else (D32)', async () => {
    const { waited, relations, answer } = await whileLocked(h, team.teamId, () =>
      setFlag(team.staff, otherPatient, { flagId: flagId('flag.low') }),
    );
    expect(waited).toBe(true);
    expect(relations).toEqual([]);
    expect(answer.status).toBe(201);
  });

  it('refuses a patient the team does not hold, a flag it does not hold, then a reason the rule refuses, writing nothing and logging nothing', async () => {
    const other = await presetsTeam(h, 'Other flags');
    const theirPatient = (
      await createPatient(h, other.teamId, other.admin.userId, { preferredName: 'Demo Wren' })
    ).id;
    const before = await auditMark(h);
    const count = await rowsOf(patient);
    const cases: [Promise<Answer>, number, string][] = [
      [setFlag(team.staff, randomUUID(), { flagId: flagId('flag.low') }), 404, 'not_found'],
      [setFlag(team.staff, theirPatient, { flagId: flagId('flag.low') }), 404, 'not_found'],
      [setFlag(team.staff, patient, { flagId: randomUUID() }), 422, 'unknown_flag'],
      [setFlag(team.staff, patient, { flagId: idOf(other, 'flag.low') }), 422, 'unknown_flag'],
      [setFlag(team.staff, patient, { flagId: flagId('item.gauze') }), 422, 'unknown_flag'],
      // The flag is checked before the reason.
      [setFlag(team.staff, patient, { flagId: randomUUID(), reason: '' }), 422, 'unknown_flag'],
      [setFlag(team.staff, patient, { flagId: flagId('flag.low'), reason: '' }), 422, 'reason_invalid'],
      [setFlag(team.staff, patient, { flagId: flagId('flag.low'), reason: '   ' }), 422, 'reason_invalid'],
      [
        setFlag(team.staff, patient, { flagId: flagId('flag.low'), reason: ' Demo: padded' }),
        422,
        'reason_invalid',
      ],
      [
        setFlag(team.staff, patient, { flagId: flagId('flag.low'), reason: 'D'.repeat(501) }),
        422,
        'reason_invalid',
      ],
      [
        setFlag(team.staff, patient, { flagId: flagId('flag.low'), reason: '\u{1F9CA}'.repeat(501) }),
        422,
        'reason_invalid',
      ],
    ];
    for (const [answer, status, code] of cases) {
      const r = await answer;
      expect([r.status, errorOf(r).code], JSON.stringify(r.body)).toEqual([status, code]);
    }
    expect(await rowsOf(patient)).toBe(count);
    expect(await auditMark(h)).toBe(before);
    // The longest reason, in code points, is taken.
    expect(
      (await setFlag(team.staff, patient, { flagId: flagId('flag.low'), reason: '\u{1F9CA}'.repeat(500) }))
        .status,
    ).toBe(201);
  });

  it('refuses a body its schema refuses, before its keys are checked', async () => {
    for (const body of [
      { id: 'form-1', flagId: flagId('flag.low'), action: 'set', reason: REASON },
      { id: randomUUID(), flagId: 'high', action: 'set', reason: REASON },
      { id: randomUUID(), flagId: flagId('flag.low'), action: 'toggle', reason: REASON },
      { id: randomUUID(), flagId: flagId('flag.low'), action: 'set' },
      { flagId: flagId('flag.low'), action: 'set', reason: REASON },
    ]) {
      const r = await send(billing, 'POST', `/v1/patients/${patient}/flags`, body);
      expect([r.status, errorOf(r).code], JSON.stringify(body)).toEqual([422, 'validation_failed']);
    }
  });

  it('refuses a set of an archived flag and takes its clear; a restored flag is set again', async () => {
    const winter = await insertPreset(
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
    );
    expect((await setFlag(team.staff, patient, { flagId: winter.id })).status).toBe(201);
    await archiveDirect(h, team.teamId, winter.id, team.admin.userId);
    const before = await auditMark(h);
    const set = await setFlag(team.staff, patient, { flagId: winter.id });
    expect([set.status, errorOf(set).code]).toEqual([409, 'archived']);
    expect(await auditMark(h)).toBe(before);
    expect((await setFlag(team.staff, patient, { flagId: winter.id, action: 'clear' })).status).toBe(201);
    await restoreDirect(team.teamId, winter.id, team.admin.userId);
    expect((await setFlag(team.staff, patient, { flagId: winter.id })).status).toBe(201);
  });

  it('refuses a flag hidden from the caller with 403, logged with the patient and never the flag', async () => {
    const before = await auditMark(h);
    for (const action of ['set', 'clear'] as const) {
      const r = await setFlag(chw, patient, { flagId: flagId('flag.pregnancy'), action });
      expect(r.status).toBe(403);
    }
    const denied = await expectAudit(h, 'access.denied', { after: before, count: 2 });
    for (const e of denied) {
      expect(e.patientId).toBe(patient);
      expect(e.details).toMatchObject({ permission: 'patients.view_sensitive' });
    }
    expect(JSON.stringify(denied)).not.toContain(flagId('flag.pregnancy'));
    await expectAudit(h, 'patient_flag.changed', { after: before, count: 0 });
    // The flags the CHW may see are set as any member's are.
    expect((await setFlag(chw, patient, { flagId: flagId('flag.frost_risk') })).status).toBe(201);
  });

  it('needs patients.view and patients.edit, and logs a refusal', async () => {
    const editOnly = await memberOf(h, team.teamId, ['patients.edit'], 'Flags edit only');
    for (const who of [billing, editOnly]) {
      const before = await auditMark(h);
      const r = await setFlag(who, patient, { flagId: flagId('flag.low') });
      expect(r.status).toBe(403);
      const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
      // The route as every refusal names it: the router's path, as c.req.routePath gives it.
      expect(denied!.details).toMatchObject({ route: '/v1/patients/:patientId/flags' });
    }
  });

  it('reads IDs in capitals as the database writes them: stored and logged in lowercase', async () => {
    const id = randomUUID();
    const before = await auditMark(h);
    const made = await send(team.staff, 'POST', `/v1/patients/${patient.toUpperCase()}/flags`, {
      id: id.toUpperCase(),
      flagId: flagId('flag.low').toUpperCase(),
      action: 'set',
      reason: REASON,
    });
    expect([made.status, made.body]).toEqual([201, { id }]);
    expect(await row(id)).toMatchObject({ patientId: patient, flagId: flagId('flag.low') });
    const [event] = await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
    expect(event!.details).toMatchObject({ flagId: flagId('flag.low') });
    // The same form sent again in lowercase is the same change.
    expect((await setFlag(team.staff, patient, { id, flagId: flagId('flag.low') })).status).toBe(201);
    await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
  });

  it('refuses an id another change holds, id_taken, writing nothing, whatever the first one was', async () => {
    const id = randomUUID();
    expect((await setFlag(team.staff, patient, { id, flagId: flagId('flag.medium') })).status).toBe(201);
    const before = await auditMark(h);
    for (const [who, patientId, body] of [
      [team.staff, otherPatient, { id, flagId: flagId('flag.medium') }],
      [team.staff, patient, { id, flagId: flagId('flag.low') }],
      [team.staff, patient, { id, flagId: flagId('flag.medium'), action: 'clear' }],
      [team.staff, patient, { id, flagId: flagId('flag.medium'), reason: 'Demo: another reason' }],
      [nurse, patient, { id, flagId: flagId('flag.medium') }],
    ] as const) {
      const r = await setFlag(who, patientId, body);
      expect([r.status, errorOf(r).code], JSON.stringify(body)).toEqual([409, 'id_taken']);
    }
    expect(await row(id)).toMatchObject({ patientId: patient, flagId: flagId('flag.medium'), action: 'set' });
    expect(await auditMark(h)).toBe(before);
  });
});

describe('POST /v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error', () => {
  const madeBy = async (who: Person, flagKey = 'flag.medium', patientId = otherPatient) => {
    const id = randomUUID();
    const r = await setFlag(who, patientId, { id, flagId: flagId(flagKey) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return id;
  };

  it('marks its author’s change once, with its history and its event in its transaction', async () => {
    const id = await madeBy(team.staff);
    const before = await auditMark(h);
    const reason = 'Demo: set on the wrong patient';
    const r = await markOf(team.staff, otherPatient, id, reason);
    expect([r.status, r.body]).toEqual([200, { version: 2 }]);
    expect(await row(id)).toMatchObject({
      status: 'entered_in_error',
      errorReason: reason,
      errorBy: team.staff.userId,
      version: 2,
      action: 'set',
      reason: REASON,
    });
    const history = await h.scratch.owner<Record<string, unknown>[]>`
      select field, version, value, kind, changed_by as "changedBy" from sineobex.field_history
      where record_id = ${id}`;
    expect(history).toEqual([
      {
        field: 'enteredInError',
        version: 1,
        value: { reason },
        kind: 'entered_in_error',
        changedBy: team.staff.userId,
      },
    ]);
    const [event] = await expectAudit(h, 'patient_flag.entered_in_error', { after: before, count: 1 });
    expect(event).toMatchObject({ entity: 'patient_flag_change', entityId: id, patientId: otherPatient });
    expect(event!.details).toMatchObject({ tier: 'primary', flagId: flagId('flag.medium') });
    expect(await xidOf('audit_events', { entityId: id })).toBe(await xidOf('patient_flag_changes', { id }));
    await expectAuditClean(h, [reason, REASON], before);

    // Marked once: again, and a retry after a dropped connection, answer already_marked and write nothing.
    const again = await markOf(team.staff, otherPatient, id, 'Demo: second thoughts');
    expect([again.status, errorOf(again).code]).toEqual([409, 'already_marked']);
    expect(await row(id)).toMatchObject({ errorReason: reason, version: 2 });
    await expectAudit(h, 'patient_flag.entered_in_error', { after: before, count: 1 });
  });

  it('is a Program Admin’s to mark too; anyone else is refused and logged', async () => {
    const id = await madeBy(team.staff, 'flag.low');
    const before = await auditMark(h);
    const r = await markOf(nurse, otherPatient, id);
    expect(r.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'team.manage_users' });
    expect((await row(id))!.status).toBe('active');
    expect((await markOf(team.admin, otherPatient, id)).status).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'entered_in_error', errorBy: team.admin.userId });
  });

  it('refuses its author once the flag is hidden from them, as a set of it is refused', async () => {
    const author = await memberOf(
      h,
      team.teamId,
      ['patients.view', 'patients.edit', 'patients.view_sensitive', 'encounters.chart'],
      'Flags author',
    );
    const id = await madeBy(author, 'flag.pregnancy');
    // The role loses sight of sensitive flags.
    await h.scratch.owner`
      update sineobex.roles set permissions = ${['patients.view', 'patients.edit', 'encounters.chart']}
      where id = (select role_id from sineobex.team_memberships where user_id = ${author.userId})`;
    const before = await auditMark(h);
    const r = await markOf(author, otherPatient, id);
    expect(r.status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
    expect(denied!.patientId).toBe(otherPatient);
    expect(denied!.details).toMatchObject({ permission: 'patients.view_sensitive' });
    expect(JSON.stringify(denied)).not.toContain(flagId('flag.pregnancy'));
    expect((await row(id))!.status).toBe('active');
  });

  it('answers 404 for a change the patient’s chart does not hold, and refuses a reason outside 3 to 300 characters', async () => {
    const id = await madeBy(team.staff, 'flag.low');
    expect((await markOf(team.staff, otherPatient, randomUUID())).status).toBe(404);
    expect((await markOf(team.staff, patient, id)).status).toBe(404);
    expect((await markOf(team.staff, randomUUID(), id)).status).toBe(404);
    for (const reason of ['No', 'E'.repeat(301), 42]) {
      const r = await markOf(team.staff, otherPatient, id, reason);
      expect([r.status, errorOf(r).code], String(reason)).toEqual([422, 'validation_failed']);
    }
    expect((await row(id))!.status).toBe('active');
    expect((await markOf(team.staff, otherPatient, id, 'Oop')).status).toBe(200);
  });

  it('needs patients.edit', async () => {
    const id = await madeBy(team.staff, 'flag.low');
    const before = await auditMark(h);
    expect((await markOf(billing, otherPatient, id)).status).toBe(403);
    await expectAudit(h, 'access.denied', { after: before, count: 1 });
  });

  it('takes the team lock before anything else (D32)', async () => {
    const id = await madeBy(team.staff, 'flag.low');
    const { waited, relations, answer } = await whileLocked(h, team.teamId, () =>
      markOf(team.staff, otherPatient, id),
    );
    expect(waited).toBe(true);
    expect(relations).toEqual([]);
    expect(answer.status).toBe(200);
  });

  it('needs patients.edit of its author too, and logs the key', async () => {
    const author = await memberOf(h, team.teamId, ['patients.view', 'patients.edit'], 'Flags editor');
    const id = await madeBy(author, 'flag.low');
    // The role loses patients.edit: the author alone may mark the change, and may not now.
    await h.scratch.owner`
      update sineobex.roles set permissions = ${['patients.view']}
      where id = (select role_id from sineobex.team_memberships where user_id = ${author.userId})`;
    const before = await auditMark(h);
    expect((await markOf(author, otherPatient, id)).status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'patients.edit' });
    expect((await row(id))!.status).toBe('active');
  });
});

describe('GET /v1/presets/flags', () => {
  interface Listed {
    flagId: string;
    name: string;
    tier: string;
    color: string;
    colorName: string;
    rank: number;
  }
  const list = async (who: Person) => {
    const r = await send(who, 'GET', '/v1/presets/flags');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as unknown as Listed[];
  };

  it('lists the team’s active flags by tier and rank, each with its colour’s plain name, and logs nothing', async () => {
    const fresh = await presetsTeam(h, 'Flag list');
    const before = await auditMark(h);
    const r = await call(h, '/v1/presets/flags', {
      token: await tokenOf(h, fresh.staff),
      teamId: fresh.teamId,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      {
        flagId: idOf(fresh, 'flag.high'),
        name: 'High',
        tier: 'primary',
        color: 'red',
        colorName: 'Red',
        rank: 10,
      },
      {
        flagId: idOf(fresh, 'flag.medium'),
        name: 'Medium',
        tier: 'primary',
        color: 'yellow',
        colorName: 'Yellow',
        rank: 20,
      },
      {
        flagId: idOf(fresh, 'flag.low'),
        name: 'Low',
        tier: 'primary',
        color: 'green',
        colorName: 'Green',
        rank: 30,
      },
      {
        flagId: idOf(fresh, 'flag.frost_risk'),
        name: 'Frost risk',
        tier: 'secondary',
        color: 'blue',
        colorName: 'Blue',
        rank: 10,
      },
      {
        flagId: idOf(fresh, 'flag.dehydration_risk'),
        name: 'Dehydration risk',
        tier: 'secondary',
        color: 'orange',
        colorName: 'Orange',
        rank: 20,
      },
      {
        flagId: idOf(fresh, 'flag.pregnancy'),
        name: 'Pregnancy',
        tier: 'secondary',
        color: 'purple',
        colorName: 'Purple',
        rank: 30,
      },
    ]);
    expect(await auditMark(h)).toBe(before);
  });

  it('leaves out a flag the caller may not see, an archived one and another team’s, and orders a tied rank by name', async () => {
    const tied = await insertPreset(
      h,
      team.teamId,
      'flag',
      {
        name: 'Demo: Cold weather',
        tier: 'secondary',
        criteria: '',
        color: 'grey',
        rank: 20,
        sensitive: false,
      },
      team.admin.userId,
    );
    const archived = await insertPreset(
      h,
      team.teamId,
      'flag',
      {
        name: 'Demo: Old condition',
        tier: 'secondary',
        criteria: '',
        color: 'grey',
        rank: 15,
        sensitive: false,
      },
      team.admin.userId,
    );
    await archiveDirect(h, team.teamId, archived.id, team.admin.userId);
    const names = (rows: Listed[]) => rows.map((f) => f.name);
    const forNurse = await list(nurse);
    expect(forNurse.map((f) => f.flagId)).not.toContain(archived.id);
    expect(names(forNurse).filter((n) => !n.startsWith('Demo: Winter'))).toEqual([
      'High',
      'Medium',
      'Low',
      'Frost risk',
      'Dehydration risk',
      'Demo: Cold weather',
      'Pregnancy',
    ]);
    expect(forNurse.find((f) => f.flagId === tied.id)).toEqual({
      flagId: tied.id,
      name: 'Demo: Cold weather',
      tier: 'secondary',
      color: 'grey',
      colorName: 'Grey',
      rank: 20,
    });
    // Billing/Data reads the problem list but not sensitive problems; the CHW preset no problem list.
    for (const who of [chw, billing]) expect(names(await list(who))).not.toContain('Pregnancy');
    const other = await presetsTeam(h, 'Other list');
    // Asked in their own team, as a member of it.
    const answer = await call(h, '/v1/presets/flags', {
      token: await tokenOf(h, other.staff),
      teamId: other.teamId,
    });
    expect(answer.status).toBe(200);
    const theirs = (answer.body as unknown as Listed[]).map((f) => f.flagId);
    expect(theirs).not.toContain(flagId('flag.high'));
    expect(theirs).toContain(idOf(other, 'flag.high'));
  });

  it('needs patients.view, and logs a refusal', async () => {
    const none = await memberOf(h, team.teamId, ['checkins.create'], 'Flags none');
    const before = await auditMark(h);
    expect((await send(none, 'GET', '/v1/presets/flags')).status).toBe(403);
    const [denied] = await expectAudit(h, 'access.denied', { after: before, count: 1 });
    expect(denied!.details).toMatchObject({ permission: 'patients.view', route: '/v1/presets/flags' });
  });
});
