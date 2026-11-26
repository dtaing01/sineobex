import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean, mergeDirect } from './patient-fixtures.ts';
import { archiveDirect, insertPreset, platformIds, whileLocked } from './presets-fixtures.ts';
import {
  call,
  clinician,
  FakePhone,
  intakeValue,
  push,
  register,
  results,
  secondTeam,
  setRole,
  setupTeam,
  type Change,
  type Clinician,
  type Result,
  type Team,
} from './sync-fixtures.ts';

// Phase 5's flag changes through sync (design 4.5, 6.2, 9; D135, D137): a patient's flag set or
// cleared with a reason, by anyone who holds patients.edit; at its own time, never later than the
// server's receipt; refused only for what its sender can fix (unknown_flag: Choose a flag;
// reason_invalid: Change the reason), held for everything else; marked entered in error once, by its
// author or a Program Admin; a held change that will not apply tells its sender. Every row of 6.2's
// table has its case here, named as fake_parity_test.dart's are. Every person, reason and patient
// is made up.
//
// Written ahead of P5-entity-values, P5-read-rule and P5-entity: until they land the push refuses
// the entity, and each case fails. What these tests expect of them:
//
// - The entity `patient_flag_change` (sync/schemas.ts' entity lists), registered in
//   sync/entities/index.ts by sync/entities/patient-flag-change.ts: permission `patients.edit` for
//   the create and for `enteredInError`; `takesTeamLock: () => true`; parents, the value's patient.
// - Its create (values.ts): `{patientId: Uuid, flagId: Uuid, action: 'set' | 'clear', reason:
//   string}`, strict; `valueProblem` answers `reason_invalid` for a reason that is not trimmed, is
//   empty, or holds more than 500 code points (sync-values.json), before anything is read.
// - insertFlagChange's check, in order: `unknown_flag` for a flag the team does not hold as a flag
//   (any other id, another kind, another team's), then the flag rule: a flag hidden from the sender
//   answers `rejected('permission')`, which the push holds. The flag's sensitive is read as
//   `coalesce(body -> 'sensitive' = 'true'::jsonb, false)`, never cast. An archived flag is taken.
// - The row: `effective_at` the earlier of when(c) and receivedAtOf(c); `received_at` receivedAtOf(c)
//   (a held change's hold time); device time, clock, author, phone, change and approver as sent; no
//   field_history row for the create, since its one field is the mark.
// - `patient_flag.changed` in the change's transaction, details `{changeId, clockVerified, action,
//   tier}` (an admin's accept adds onBehalfOf and quarantineItem first);
//   `patient_flag.entered_in_error` with writeValue's details and `{tier}`. Never a reason, and
//   never the flag, whatever the flag (CO-14): an event names its change by its entity id.
// - `enteredInError`: set_once, a Retraction; mayChange is the change's author or a holder of
//   team.manage_users, and never a sender the flag is hidden from.
// - review.ts: a held flag change rejected, or refused at its accept, writes one
//   `flag_change_not_applied` notice to its sender naming the change (entity patient_flag_change,
//   record the flag change's id) and its patient (user_notices.patient_id), only when that patient
//   is on the chart; a refused accept is logged `quarantine.accept_refused` on the patient. The
//   notices route answers each notice's `patientId`.

type Entity = Parameters<FakePhone['change']>[0]['entity'];
/** Named through a string: the contract's entity lists hold it once P5-entity-values lands. */
const FLAG_CHANGE = 'patient_flag_change' as string as Entity;

const REASON = 'Demo: missed two follow-ups this month';
const MARK_REASON = 'Demo: set on the wrong patient';
const ICE = '\u{1F9CA}';

/** A time `minutes` from now on the database's clock, which is the receipt's. */
const fromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

interface FlagRow {
  id: string;
  teamId: string;
  patientId: string;
  flagId: string;
  action: string;
  reason: string;
  effectiveAt: Date;
  deviceTime: Date | null;
  clockVerified: boolean;
  authorUserId: string;
  createdDeviceId: string | null;
  changeId: string | null;
  approvedBy: string | null;
  status: string;
  errorReason: string | null;
  errorBy: string | null;
  errorAt: Date | null;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, { by: string; at: string; changeId: string | null }>;
  receivedAt: Date;
}

/** Whoever pushes: a member with a registered phone. */
interface Sender {
  id: string;
  phone: FakePhone;
  send: (...changes: Change[]) => Promise<Result[]>;
}

describe('phase 5 sync: flag changes', () => {
  let h: Harness;
  let t: Team;
  let ids: Record<string, string>;
  let patientA: string;
  let patientB: string;
  /** Merged into A: one person, two records. */
  let patientC: string;
  /** Healthcare Staff: patients.edit, and sight of sensitive flags. */
  let kim: Clinician;
  let ivy: Clinician;
  /** The CHW preset: patients.edit, and no problem list, so no sensitive flag. */
  let lee: Clinician;
  /** Billing/Data: no patients.edit. */
  let bo: Clinician;
  /** The team's Program Admin, with a phone of their own. */
  let admin: Sender;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    ids = await platformIds(h, t.teamId);
    patientA = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Ash' })).id;
    patientB = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Birch' })).id;
    patientC = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Ash two' })).id;
    await mergeDirect(h, t.teamId, patientC, patientA, t.adminId);
    kim = await clinician(h, t, 'kim@example.com', 'Kim (demo)', 'none');
    ivy = await clinician(h, t, 'ivy@example.com', 'Ivy (demo)', 'none');
    lee = await clinician(h, t, 'lee@example.com', 'Lee (demo)', 'chw', 'community_health_worker');
    bo = await clinician(h, t, 'bo@example.com', 'Bo (demo)', 'none', 'billing_data');
    const phone = await FakePhone.create();
    await register(h, phone, t.adminToken, t.teamId);
    admin = {
      id: t.adminId,
      phone,
      send: async (...changes) => results((await push(h, phone, t.adminToken, t.teamId, changes)).body),
    };
  });
  afterAll(() => h.close());

  /** The team's copy of a platform preset, by its origin key. */
  const presetId = (key: string) => {
    const id = ids[key];
    if (!id) throw new Error(`the team holds no ${key}`);
    return id;
  };

  const flagChange = (
    c: Sender,
    patientId: string,
    flagId: string,
    more: {
      action?: 'set' | 'clear';
      reason?: unknown;
      recordId?: string;
      supersedes?: string;
      deviceTime?: string;
      correctedTime?: string;
      clockVerified?: boolean;
    } = {},
  ) => {
    const { action, reason, ...change } = more;
    return c.phone.change({
      entity: FLAG_CHANGE,
      op: 'create',
      value: { patientId, flagId, action: action ?? 'set', reason: reason === undefined ? REASON : reason },
      ...change,
    });
  };

  const markOf = (
    c: Sender,
    changeId: string,
    reason = MARK_REASON,
    more: { baseVersion?: number; resolution?: 'replace' | 'keep_server' } = {},
  ) =>
    c.phone.change({
      entity: FLAG_CHANGE,
      recordId: changeId,
      op: 'set',
      field: 'enteredInError',
      value: { reason },
      ...more,
    });

  /**
   * What a create's answer says of when the server stored it (6.1): when it was received, and once on
   * the chart the time it is ordered by and the team index's counter after it. A mark taken says the
   * counter only; a held change names no counter, since a hold moves no index.
   */
  const timesOf = (c: Change, held: boolean) =>
    c.entity === FLAG_CHANGE && c.op === 'create'
      ? {
          details: held
            ? { receivedAt: expect.any(String) }
            : {
                receivedAt: expect.any(String),
                effectiveAt: expect.any(String),
                indexVersion: expect.any(Number),
              },
        }
      : c.entity === FLAG_CHANGE && !held
        ? { details: { indexVersion: expect.any(Number) } }
        : {};

  /** The team index's counter as the database holds it now (0009's team_index_versions). */
  const teamCounter = async () =>
    Number(
      (
        await h.scratch.owner<{ version: string }[]>`
          select version::text from sineobex.team_index_versions where team_id = ${t.teamId}`
      )[0]!.version,
    );

  /** A first page of the team index as Kim's phone downloads it, and the counter its version names. */
  const indexPage = async () => {
    const r = await call(h, '/v1/patients/index', {
      method: 'POST',
      token: kim.token,
      teamId: t.teamId,
      json: {},
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const entries = r.body.entries as { patientId: string; flags: { primary: string | null } }[];
    return {
      counter: Number((r.body.version as string).split('.')[0]),
      generatedAt: new Date(r.body.generatedAt as string),
      primaryOf: (patientId: string) => entries.find((e) => e.patientId === patientId)?.flags.primary,
    };
  };

  const taken = (c: Change, serverVersion = 1) => ({
    changeId: c.changeId,
    status: 'accepted',
    serverVersion,
    hash: c.valueHash,
    ...timesOf(c, false),
  });

  const refusedAs = (c: Change, reason: string, details: Record<string, unknown>) => ({
    changeId: c.changeId,
    status: 'rejected',
    reason,
    message: expect.any(String),
    details,
  });

  /** Held for a Program Admin (lifecycle 4.2): the phone may let go of it. */
  const heldFor = (c: Change, reason: 'permission' | 'awaiting_review' = 'permission') => ({
    changeId: c.changeId,
    status: 'rejected',
    reason,
    message: expect.any(String),
    quarantined: true,
    hash: c.valueHash,
    ...timesOf(c, true),
  });

  const row = async (id: string) =>
    (
      await h.scratch.owner<FlagRow[]>`
        select id, team_id as "teamId", patient_id as "patientId", flag_id as "flagId", action, reason,
               effective_at as "effectiveAt", device_time as "deviceTime", clock_verified as "clockVerified",
               author_user_id as "authorUserId", created_device_id as "createdDeviceId", change_id as "changeId",
               approved_by as "approvedBy", status, error_reason as "errorReason", error_by as "errorBy",
               error_at as "errorAt", version, field_versions as "fieldVersions", field_meta as "fieldMeta",
               received_at as "receivedAt"
        from sineobex.patient_flag_changes where id = ${id}`
    )[0];

  /** The transaction that last wrote the change's row, and the one that wrote an event about it. */
  const rowXid = async (id: string) =>
    (
      await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.patient_flag_changes where id = ${id}`
    )[0]!.xid;
  const eventXid = async (action: string, entityId: string) =>
    (
      await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.audit_events
        where action = ${action} and entity_id = ${entityId} order by id desc limit 1`
    )[0]!.xid;

  const itemOf = async (c: Change) =>
    (
      await h.scratch.owner<{ id: string; reason: string; status: string; receivedAt: Date }[]>`
        select id, reason, status, received_at as "receivedAt" from sineobex.quarantine_items
        where change_id = ${c.changeId}`
    )[0];

  const decide = (itemId: string, decision: 'accept' | 'reject', reason = 'Demo: checked with the team') =>
    call(h, `/v1/team/quarantine/${itemId}/decision`, {
      method: 'POST',
      token: t.adminToken,
      teamId: t.teamId,
      json: { decision, reason },
    });

  const noticesAbout = (recordId: string) =>
    h.scratch.owner<Record<string, unknown>[]>`
      select user_id as "userId", kind, entity, record_id as "recordId", patient_id as "patientId",
             note_id as "noteId"
      from sineobex.user_notices where record_id = ${recordId} order by created_at, id`;

  const historyOf = (recordId: string) =>
    h.scratch.owner<Record<string, unknown>[]>`
      select field, version, value, previous_value as "previousValue", kind, changed_by as "changedBy",
             approved_by as "approvedBy"
      from sineobex.field_history where record_id = ${recordId} order by id`;

  it('is taken from anyone who holds patients.edit, at its own time, and logged in its transaction without its reason', async () => {
    const before = await auditMark(h);
    const deviceTime = fromNow(-60);
    const correctedTime = new Date(Date.parse(deviceTime) + 4_000).toISOString();
    const made = await flagChange(kim, patientA, presetId('flag.high'), { deviceTime, correctedTime });
    const [answer] = await kim.send(made);
    expect(answer).toEqual(taken(made));
    const stored = await row(made.recordId);
    expect(stored).toEqual({
      id: made.recordId,
      teamId: t.teamId,
      patientId: patientA,
      flagId: presetId('flag.high'),
      action: 'set',
      reason: REASON,
      // The corrected time, earlier than the receipt (4.5).
      effectiveAt: new Date(correctedTime),
      deviceTime: new Date(deviceTime),
      clockVerified: true,
      authorUserId: kim.id,
      createdDeviceId: kim.phone.deviceId,
      changeId: made.changeId,
      approvedBy: null,
      status: 'active',
      errorReason: null,
      errorBy: null,
      errorAt: null,
      version: 1,
      fieldVersions: {},
      fieldMeta: {},
      receivedAt: expect.any(Date),
    });
    expect(stored!.receivedAt.getTime()).toBeGreaterThanOrEqual(stored!.effectiveAt.getTime());
    // Its one field is the mark: the create writes no history of its own.
    expect(await historyOf(made.recordId)).toEqual([]);

    const [event] = await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
    expect(event).toMatchObject({
      actorUserId: kim.id,
      entity: 'patient_flag_change',
      entityId: made.recordId,
      patientId: patientA,
    });
    expect(event!.details).toEqual({
      changeId: made.changeId,
      clockVerified: true,
      action: 'set',
      tier: 'primary',
    });
    expect(await eventXid('patient_flag.changed', made.recordId)).toBe(await rowXid(made.recordId));
    await expectAuditClean(h, [REASON, 'follow-ups'], before);

    // Sent again, it answers from its receipt and writes nothing more.
    expect(await kim.send(made)).toEqual([answer]);
    await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
  });

  it('a clear and a condition are taken as a set is, each event naming its tier; a merged patient is stored as sent', async () => {
    const before = await auditMark(h);
    const clear = await flagChange(kim, patientA, presetId('flag.medium'), { action: 'clear' });
    const frost = await flagChange(ivy, patientC, presetId('flag.frost_risk'));
    expect(await kim.send(clear)).toEqual([taken(clear)]);
    expect(await ivy.send(frost)).toEqual([taken(frost)]);
    expect(await row(clear.recordId)).toMatchObject({ action: 'clear', patientId: patientA });
    // Reads group by canonical_id (D27): the row keeps the record it named.
    expect(await row(frost.recordId)).toMatchObject({
      action: 'set',
      patientId: patientC,
      authorUserId: ivy.id,
    });
    const events = await expectAudit(h, 'patient_flag.changed', { after: before, count: 2 });
    expect(events.map((e) => [e.entityId, e.patientId, e.details])).toEqual([
      [
        clear.recordId,
        patientA,
        {
          changeId: clear.changeId,
          clockVerified: true,
          action: 'clear',
          tier: 'primary',
        },
      ],
      [
        frost.recordId,
        patientC,
        {
          changeId: frost.changeId,
          clockVerified: true,
          action: 'set',
          tier: 'secondary',
        },
      ],
    ]);
  });

  it('a sensitive flag’s change is logged as any flag’s is, without its flag', async () => {
    const before = await auditMark(h);
    const made = await flagChange(kim, patientB, presetId('flag.pregnancy'));
    expect(await kim.send(made)).toEqual([taken(made)]);
    const [event] = await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
    expect(event!.details).toEqual({
      changeId: made.changeId,
      clockVerified: true,
      action: 'set',
      tier: 'secondary',
    });
    const text = JSON.stringify(
      await h.scratch.owner`select details from sineobex.audit_events where id > ${before}::bigint`,
    );
    expect(text).not.toContain(presetId('flag.pregnancy'));
  });

  it('reads IDs in capitals as the database writes them, from a phone: stored and read in lowercase', async () => {
    // A patient of its own, so no other case reads this change.
    const patient = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Cedar' })).id;
    const low = presetId('flag.low');
    const made = await flagChange(kim, patient.toUpperCase(), low.toUpperCase());
    const before = await auditMark(h);
    expect(await kim.send(made)).toEqual([taken(made)]);
    expect(await row(made.recordId)).toMatchObject({ patientId: patient, flagId: low });
    // Logged on the patient as stored, naming no flag (CO-14).
    const [event] = await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });
    expect(event).toMatchObject({ entityId: made.recordId, patientId: patient });
    expect(JSON.stringify(event!.details).toLowerCase()).not.toContain(low);
    const read = await call(h, '/v1/sync/records', {
      method: 'POST',
      token: kim.token,
      teamId: t.teamId,
      json: { records: [{ entity: FLAG_CHANGE, id: made.recordId }] },
    });
    expect((read.body.records as { attributes: Record<string, unknown> }[])[0]!.attributes).toMatchObject({
      patientId: patient,
      flagId: low,
    });
    // On the chart under its flag.
    const chart = await call(h, `/v1/patients/${patient}`, { token: kim.token, teamId: t.teamId });
    expect((chart.body.flags as { primary: { flagId: string } | null }).primary!.flagId).toBe(low);
  });

  it('is never later than the server’s receipt: a phone clock ahead is taken at the receipt', async () => {
    const ahead = await flagChange(kim, patientB, presetId('flag.low'), {
      deviceTime: fromNow(24 * 60),
      clockVerified: false,
    });
    const correctedAhead = await flagChange(kim, patientB, presetId('flag.medium'), {
      deviceTime: fromNow(-5),
      correctedTime: fromNow(60),
    });
    const sentAt = Date.now();
    expect(await kim.send(ahead, correctedAhead)).toEqual([taken(ahead), taken(correctedAhead)]);
    for (const c of [ahead, correctedAhead]) {
      const stored = await row(c.recordId);
      expect(stored!.effectiveAt.getTime()).toBe(stored!.receivedAt.getTime());
      expect(stored!.effectiveAt.getTime()).toBeGreaterThanOrEqual(sentAt - 1_000);
      expect(stored!.effectiveAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
    expect(await row(ahead.recordId)).toMatchObject({
      deviceTime: new Date(ahead.deviceTime),
      clockVerified: false,
    });
  });

  it('held for review, it takes its time from when the server first received it, not from its accept', async () => {
    const ahead = await flagChange(bo, patientA, presetId('flag.low'), {
      deviceTime: fromNow(24 * 60),
      clockVerified: false,
    });
    const earlier = await flagChange(bo, patientA, presetId('flag.dehydration_risk'), {
      deviceTime: fromNow(-30),
    });
    expect(await bo.send(ahead, earlier)).toEqual([heldFor(ahead), heldFor(earlier)]);
    const aheadItem = (await itemOf(ahead))!;
    const earlierItem = (await itemOf(earlier))!;
    await new Promise((r) => setTimeout(r, 20));
    const before = await auditMark(h);
    expect((await decide(aheadItem.id, 'accept')).status).toBe(200);
    expect((await decide(earlierItem.id, 'accept')).status).toBe(200);
    const stored = await row(ahead.recordId);
    expect(stored).toMatchObject({
      authorUserId: bo.id,
      createdDeviceId: bo.phone.deviceId,
      changeId: ahead.changeId,
      approvedBy: t.adminId,
      clockVerified: false,
    });
    // The hold is the receipt: both times are the hold's, before the accept.
    expect(stored!.effectiveAt.getTime()).toBe(aheadItem.receivedAt.getTime());
    expect(stored!.receivedAt.getTime()).toBe(aheadItem.receivedAt.getTime());
    // A phone time before the hold stands.
    expect((await row(earlier.recordId))!.effectiveAt).toEqual(new Date(earlier.deviceTime));
    const events = await expectAudit(h, 'patient_flag.changed', { after: before, count: 2 });
    expect(events[0]).toMatchObject({ actorUserId: t.adminId, patientId: patientA });
    expect(events[0]!.details).toEqual({
      onBehalfOf: bo.id,
      quarantineItem: aheadItem.id,
      changeId: ahead.changeId,
      clockVerified: false,
      action: 'set',
      tier: 'primary',
    });
  });

  // Review finding S1: a phone weighs its own change against the team index's time by when the server
  // received it. A lost answer's retry must be answered that time, as stored, never the retry's.
  it('answers a create with the times it stored, taken or held, and a retry with the same times', async () => {
    // A patient of its own, so no other case reads these changes.
    const patient = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Pine' })).id;
    const made = await flagChange(kim, patient, presetId('flag.dehydration_risk'), {
      deviceTime: fromNow(-3),
    });
    const [first] = await kim.send(made);
    const stored = (await row(made.recordId))!;
    expect(first).toEqual({
      ...taken(made),
      details: {
        receivedAt: stored.receivedAt.toISOString(),
        effectiveAt: stored.effectiveAt.toISOString(),
        indexVersion: await teamCounter(),
      },
    });
    expect(stored.effectiveAt).toEqual(new Date(made.deviceTime));
    // Later, its first answer lost: the stored receipt, with the stored times.
    await new Promise((r) => setTimeout(r, 25));
    expect(await kim.send(made)).toEqual([first]);

    // Held: when the hold received it, the same to a retry.
    const held = await flagChange(bo, patient, presetId('flag.dehydration_risk'), { action: 'clear' });
    const [heldAnswer] = await bo.send(held);
    const item = (await itemOf(held))!;
    expect(heldAnswer).toEqual({ ...heldFor(held), details: { receivedAt: item.receivedAt.toISOString() } });
    await new Promise((r) => setTimeout(r, 25));
    expect(await bo.send(held)).toEqual([heldAnswer]);
    // Accepted from review, the change is received when it was held, and a retry is answered so,
    // with the counter the accept moved the index to.
    expect((await decide(item.id, 'accept')).status).toBe(200);
    const accepted = (await row(held.recordId))!;
    expect(accepted.receivedAt).toEqual(item.receivedAt);
    expect(await bo.send(held)).toEqual([
      {
        ...taken(held),
        details: {
          receivedAt: item.receivedAt.toISOString(),
          effectiveAt: accepted.effectiveAt.toISOString(),
          indexVersion: await teamCounter(),
        },
      },
    ]);
  });

  // Review finding VR1: only the server knows which team index holds which change. A taken create and
  // a taken mark answer the index's counter after them, which an index reaches only once the change
  // has committed.
  it('answers a taken create and a taken mark with the team index’s counter after it, and a retry with the same', async () => {
    const patient = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Larch' })).id;
    const before = (await indexPage()).counter;
    const made = await flagChange(kim, patient, presetId('flag.high'));
    const [first] = await kim.send(made);
    const afterCreate = await teamCounter();
    expect(afterCreate).toBeGreaterThan(before);
    expect(first).toEqual(taken(made));
    expect(first!.details?.indexVersion).toBe(afterCreate);
    // An index read since is at or above it; a retry later answers the counter it stored.
    expect((await indexPage()).counter).toBeGreaterThanOrEqual(afterCreate);
    await new Promise((r) => setTimeout(r, 25));
    expect(await kim.send(made)).toEqual([first]);

    const mark = await markOf(kim, made.recordId);
    const [marked] = await kim.send(mark);
    const afterMark = await teamCounter();
    expect(afterMark).toBeGreaterThan(afterCreate);
    expect(marked).toEqual({ ...taken(mark), details: { indexVersion: afterMark } });
    expect(await kim.send(mark)).toEqual([marked]);

    // A hold moves no index, so its answer names no counter; nor does a mark kept in history.
    const held = await flagChange(bo, patient, presetId('flag.low'));
    const [heldAnswer] = await bo.send(held);
    expect(heldAnswer).toEqual(heldFor(held));
    expect(await teamCounter()).toBe(afterMark);
    const second = await markOf(admin, made.recordId, 'Demo: second thoughts');
    const [kept] = await admin.send(second);
    expect(kept!.details).toEqual({ outcome: 'history_only' });
    expect(await teamCounter()).toBe(afterMark);
  });

  // The first verifier's window (VS1, VR1): a push that waits on the team's write lock is dated when
  // its transaction began, so its receipt's time is before an index worked out meanwhile, which left
  // the change out. The counter tells them apart.
  it('a push waiting on the team’s write lock while an index is read: the index’s counter is below the receipt’s', async () => {
    const patient = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Cedar' })).id;
    const [low] = await kim.send(
      await flagChange(kim, patient, presetId('flag.low'), { deviceTime: fromNow(-1) }),
    );
    expect(low!.status).toBe('accepted');
    const high = await flagChange(kim, patient, presetId('flag.high'), { deviceTime: fromNow(0) });
    let indexing: ReturnType<typeof indexPage> | undefined;
    // Another writer holds the team's write lock (a merge, another phone's push): the push begins and
    // waits on it. The phone's index refresh runs meanwhile: it reads its counter and its entries, then
    // waits on the lock to log its download.
    const { waited, answer } = await whileLocked(
      h,
      t.teamId,
      () => kim.send(high),
      async () => {
        indexing = indexPage();
        for (let i = 0; i < 500; i++) {
          const [w] = await h.scratch.owner<{ n: number }[]>`
            select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
          if (w!.n >= 2) return;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('the index never waited on the team’s write lock');
      },
    );
    expect(waited).toBe(true);
    const [stored] = answer;
    const page = await indexing!;
    const receipt = stored!.details as { receivedAt: string; indexVersion: number };
    // The times can't tell: the receipt's is before the index was worked out, and the index left the
    // change out.
    expect(new Date(receipt.receivedAt).getTime()).toBeLessThan(page.generatedAt.getTime());
    expect(page.primaryOf(patient)).toBe(presetId('flag.low'));
    // The counter does: the index's, read before its entries, is below the receipt's.
    expect(page.counter).toBeLessThan(receipt.indexVersion);
    // The next index holds the change, at or above the receipt's counter.
    const next = await indexPage();
    expect(next.counter).toBeGreaterThanOrEqual(receipt.indexVersion);
    expect(next.primaryOf(patient)).toBe(presetId('flag.high'));
  });

  it('dates a receipt and the team index on one clock, the database’s, whatever the API’s says', async () => {
    const patient = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Spruce' })).id;
    // The API's clock (deps.now) stands weeks from the database's in this harness.
    expect(Math.abs(h.clock.now.getTime() - Date.now())).toBeGreaterThan(60 * 60_000);
    const indexAt = async () => {
      const r = await call(h, '/v1/patients/index', {
        method: 'POST',
        token: kim.token,
        teamId: t.teamId,
        json: {},
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return new Date(r.body.generatedAt as string);
    };
    const receivedAt = async (c: Change) => {
      const [answer] = await kim.send(c);
      return new Date((answer!.details as { receivedAt: string }).receivedAt);
    };
    const before = await receivedAt(await flagChange(kim, patient, presetId('flag.high')));
    const generated = await indexAt();
    const after = await receivedAt(await flagChange(kim, patient, presetId('flag.low')));
    expect(before.getTime()).toBeLessThan(generated.getTime());
    expect(generated.getTime()).toBeLessThan(after.getTime());
  });

  it('an archived flag, or one archived since, is taken and kept: it stays on the patient', async () => {
    const winter = await insertPreset(
      h,
      t.teamId,
      'flag',
      {
        name: 'Demo: Winter outreach',
        tier: 'secondary',
        criteria: '',
        color: 'teal',
        rank: 40,
        sensitive: false,
      },
      t.adminId,
    );
    // Set offline before the archive, sent after it; then set and cleared after it.
    const setBefore = await flagChange(kim, patientB, winter.id, { deviceTime: fromNow(-120) });
    await archiveDirect(h, t.teamId, winter.id, t.adminId);
    const setAfter = await flagChange(ivy, patientA, winter.id);
    const clearAfter = await flagChange(ivy, patientA, winter.id, { action: 'clear' });
    expect(await kim.send(setBefore)).toEqual([taken(setBefore)]);
    expect(await ivy.send(setAfter, clearAfter)).toEqual([taken(setAfter), taken(clearAfter)]);
    expect(await row(setBefore.recordId)).toMatchObject({ flagId: winter.id, status: 'active' });
    expect(await row(clearAfter.recordId)).toMatchObject({ flagId: winter.id, action: 'clear' });
  });

  it('a flag the team does not hold is refused unknown_flag before anything is written, the queue goes on, and Choose a flag settles it', async () => {
    const other = await secondTeam(h);
    const theirs = (await platformIds(h, other.teamId))['flag.high']!;
    const before = await auditMark(h);
    const changes = [
      await flagChange(kim, patientA, randomUUID()),
      await flagChange(kim, patientA, theirs),
      // A preset of another kind is no flag.
      await flagChange(kim, patientA, presetId('item.gauze')),
      await flagChange(kim, patientA, presetId('flag.low')),
    ];
    expect(await kim.send(...changes)).toEqual([
      refusedAs(changes[0]!, 'validation', { problem: 'unknown_flag' }),
      refusedAs(changes[1]!, 'validation', { problem: 'unknown_flag' }),
      refusedAs(changes[2]!, 'validation', { problem: 'unknown_flag' }),
      taken(changes[3]!),
    ]);
    for (const c of changes.slice(0, 3)) expect(await row(c.recordId)).toBeUndefined();
    await expectAudit(h, 'patient_flag.changed', { after: before, count: 1 });

    // Choose a flag: the same record, sent again with a flag of the team, settles the refusal.
    const chosen = await flagChange(kim, patientA, presetId('flag.medium'), {
      recordId: changes[0]!.recordId,
      supersedes: changes[0]!.changeId,
    });
    expect(await kim.send(chosen)).toEqual([taken(chosen)]);
    expect(await row(chosen.recordId)).toMatchObject({
      flagId: presetId('flag.medium'),
      patientId: patientA,
    });
    const [refusal] = await h.scratch.owner<{ resolvedByChange: string | null }[]>`
      select resolved_by_change as "resolvedByChange" from sineobex.sync_changes
      where change_id = ${changes[0]!.changeId}`;
    expect(refusal!.resolvedByChange).toBe(chosen.changeId);
  });

  it('reads whether a flag is sensitive from its stored body without a cast, so an odd body never stops the push', async () => {
    // A body no writer leaves (the schemas take a boolean only): a cast of it would fail with class
    // 22, stop the push at every retry and block the phone's queue (lifecycle 4.1). It reads as not
    // sensitive.
    const odd = await insertPreset(
      h,
      t.teamId,
      'flag',
      {
        name: 'Demo: Odd flag',
        tier: 'secondary',
        criteria: '',
        color: 'grey',
        rank: 80,
        sensitive: 'unknown',
      },
      t.adminId,
    );
    const changes = [
      await flagChange(lee, patientB, odd.id),
      await flagChange(lee, patientB, presetId('flag.low')),
    ];
    expect(await lee.send(...changes)).toEqual([taken(changes[0]!), taken(changes[1]!)]);
  });

  it('a reason empty, untrimmed or over 500 code points is refused reason_invalid, and Change the reason settles it', async () => {
    const reasons = [
      '',
      '   ',
      ' Demo: a space before',
      'Demo: a line break after\n',
      'D'.repeat(501),
      ICE.repeat(501),
    ];
    const refused: Change[] = [];
    for (const reason of reasons)
      refused.push(await flagChange(kim, patientB, presetId('flag.low'), { reason }));
    const fine = [
      await flagChange(kim, patientB, presetId('flag.low'), { reason: 'x' }),
      await flagChange(kim, patientB, presetId('flag.low'), { reason: 'D'.repeat(500) }),
      // 500 code points in 1,000 UTF-16 units, and 500 in 501.
      await flagChange(kim, patientB, presetId('flag.low'), { reason: ICE.repeat(500) }),
      await flagChange(kim, patientB, presetId('flag.low'), { reason: `${'D'.repeat(499)}${ICE}` }),
    ];
    // The value's own rule is answered before anything is read: an unknown flag with it too.
    const both = await flagChange(kim, patientB, randomUUID(), { reason: '' });
    expect(await kim.send(...refused, ...fine, both)).toEqual([
      ...refused.map((c) => refusedAs(c, 'validation', { problem: 'reason_invalid' })),
      ...fine.map((c) => taken(c)),
      refusedAs(both, 'validation', { problem: 'reason_invalid' }),
    ]);
    for (const c of refused) expect(await row(c.recordId)).toBeUndefined();
    expect((await row(fine[2]!.recordId))!.reason).toBe(ICE.repeat(500));

    // A reason that is not text fails at its path; so does a value missing one.
    const notText = await flagChange(kim, patientB, presetId('flag.low'), { reason: 42 });
    const [answer] = await kim.send(notText);
    expect(answer).toMatchObject({ status: 'rejected', reason: 'validation' });
    expect((answer!.details!.problems as { path: string }[]).map((p) => p.path)).toEqual(['reason']);

    // Change the reason: the same record, sent again with a new reason, settles the refusal.
    const changed = await flagChange(kim, patientB, presetId('flag.low'), {
      recordId: refused[0]!.recordId,
      supersedes: refused[0]!.changeId,
      reason: 'Demo: dehydrated twice this week',
    });
    expect(await kim.send(changed)).toEqual([taken(changed)]);
    const [refusal] = await h.scratch.owner<{ resolvedByChange: string | null }[]>`
      select resolved_by_change as "resolvedByChange" from sineobex.sync_changes
      where change_id = ${refused[0]!.changeId}`;
    expect(refusal!.resolvedByChange).toBe(changed.changeId);
  });

  it('a patient the server lacks is a stale reference; one whose create waits for review holds the change with it', async () => {
    const nobody = await flagChange(kim, randomUUID(), presetId('flag.high'));
    expect(await kim.send(nobody)).toEqual([
      refusedAs(nobody, 'stale_reference', { problem: 'patient_missing' }),
    ]);

    // Intake's risk level (8.2): the patient create is held (a role lowered offline), so the risk
    // level, sent once the role is back, waits behind it.
    const rae = await clinician(h, t, 'rae@example.com', 'Rae (demo)', 'none');
    const intake = await rae.phone.change({
      entity: 'patient',
      op: 'create',
      value: intakeValue({ preferredName: 'Demo Mo' }),
    });
    await setRole(h, t, rae.membershipId, 'billing_data');
    expect(await rae.send(intake)).toEqual([heldFor(intake)]);
    await setRole(h, t, rae.membershipId, 'healthcare_staff');
    const risk = await flagChange(rae, intake.recordId, presetId('flag.high'));
    expect(await rae.send(risk)).toEqual([heldFor(risk, 'awaiting_review')]);
    const [held] = await h.scratch.owner<{ waitsOn: string }[]>`
      select details->>'waitsOn' as "waitsOn" from sineobex.audit_events
      where action = 'sync.quarantined' and details->>'changeId' = ${risk.changeId}`;
    expect(held!.waitsOn).toBe(intake.changeId);
    // The queue names the risk level's patient, through its value (patient_of_change, 0024).
    const mark = await auditMark(h);
    const queue = await call(h, `/v1/team/quarantine?userId=${rae.id}`, {
      token: t.adminToken,
      teamId: t.teamId,
    });
    expect(queue.status).toBe(200);
    expect((queue.body.items as { changeId: string }[]).map((i) => i.changeId)).toEqual([
      intake.changeId,
      risk.changeId,
    ]);
    await expectAudit(h, 'quarantine.item_viewed', { after: mark, patientId: intake.recordId, count: 2 });
  });

  it('a member without patients.edit is held for a Program Admin, never refused, and the hold is logged', async () => {
    const theirs = await flagChange(kim, patientB, presetId('flag.medium'));
    expect(await kim.send(theirs)).toEqual([taken(theirs)]);
    const before = await auditMark(h);
    const set = await flagChange(bo, patientB, presetId('flag.high'));
    const mark = await markOf(bo, theirs.recordId);
    expect(await bo.send(set, mark)).toEqual([heldFor(set), heldFor(mark)]);
    expect(await row(set.recordId)).toBeUndefined();
    expect(await row(theirs.recordId)).toMatchObject({ status: 'active', version: 1 });
    expect(await itemOf(set)).toMatchObject({ reason: 'permission', status: 'pending' });
    const events = await expectAudit(h, 'sync.quarantined', { after: before, count: 2 });
    expect(events.map((e) => e.details)).toEqual([
      { changeId: set.changeId, reason: 'permission' },
      { changeId: mark.changeId, reason: 'permission' },
    ]);
    await expectAudit(h, 'sync.rejected', { after: before, count: 0 });
    await expectAuditClean(h, [REASON, MARK_REASON], before);
  });

  it('a flag hidden from its sender is held, a set or a clear, and so is its author’s mark once it is hidden from them', async () => {
    const before = await auditMark(h);
    const set = await flagChange(lee, patientA, presetId('flag.pregnancy'));
    const clear = await flagChange(lee, patientA, presetId('flag.pregnancy'), { action: 'clear' });
    expect(await lee.send(set, clear)).toEqual([heldFor(set), heldFor(clear)]);
    expect(await row(set.recordId)).toBeUndefined();
    expect(await row(clear.recordId)).toBeUndefined();
    const events = await expectAudit(h, 'sync.quarantined', { after: before, count: 2 });
    for (const e of events) expect(e.details).toMatchObject({ reason: 'permission' });

    // Zoe sees sensitive flags and sets one; her role is lowered while she is offline, and her mark
    // of her own change waits for someone who may see it.
    const zoe = await clinician(h, t, 'zoe@example.com', 'Zoe (demo)', 'none');
    const hers = await flagChange(zoe, patientA, presetId('flag.pregnancy'));
    expect(await zoe.send(hers)).toEqual([taken(hers)]);
    await setRole(h, t, zoe.membershipId, 'community_health_worker');
    const mark = await markOf(zoe, hers.recordId);
    expect(await zoe.send(mark)).toEqual([heldFor(mark)]);
    expect(await row(hers.recordId)).toMatchObject({ status: 'active', version: 1 });
  });

  it('is entered in error once, by its author or a Program Admin; anyone else is held for review', async () => {
    const kims = await flagChange(kim, patientB, presetId('flag.medium'));
    const ivys = await flagChange(ivy, patientB, presetId('flag.frost_risk'));
    const others = await flagChange(ivy, patientB, presetId('flag.dehydration_risk'));
    const sensitive = await flagChange(kim, patientB, presetId('flag.pregnancy'));
    expect(await kim.send(kims, sensitive)).toEqual([taken(kims), taken(sensitive)]);
    expect(await ivy.send(ivys, others)).toEqual([taken(ivys), taken(others)]);

    const before = await auditMark(h);
    const byAuthor = await markOf(kim, kims.recordId, MARK_REASON, {});
    expect(await kim.send(byAuthor)).toEqual([taken(byAuthor)]);
    expect(await row(kims.recordId)).toMatchObject({
      status: 'entered_in_error',
      errorReason: MARK_REASON,
      errorBy: kim.id,
      errorAt: new Date(byAuthor.deviceTime),
      fieldVersions: { enteredInError: 1 },
      fieldMeta: { enteredInError: { by: kim.id, at: byAuthor.deviceTime, changeId: byAuthor.changeId } },
      version: 2,
      // Nothing else of it moves (0024's guard holds it in the database too).
      action: 'set',
      reason: REASON,
      flagId: presetId('flag.medium'),
    });
    expect(await historyOf(kims.recordId)).toEqual([
      {
        field: 'enteredInError',
        version: 1,
        value: { reason: MARK_REASON },
        previousValue: null,
        kind: 'entered_in_error',
        changedBy: kim.id,
        approvedBy: null,
      },
    ]);
    const [event] = await expectAudit(h, 'patient_flag.entered_in_error', { after: before, count: 1 });
    expect(event).toMatchObject({
      actorUserId: kim.id,
      entity: 'patient_flag_change',
      entityId: kims.recordId,
      patientId: patientB,
    });
    expect(event!.details).toEqual({
      changeId: byAuthor.changeId,
      field: 'enteredInError',
      kind: 'entered_in_error',
      version: 1,
      tier: 'primary',
    });
    expect(await eventXid('patient_flag.entered_in_error', kims.recordId)).toBe(await rowXid(kims.recordId));

    // A sensitive flag's mark is logged as any flag's is, without its flag.
    const sensitiveMark = await markOf(kim, sensitive.recordId);
    expect(await kim.send(sensitiveMark)).toEqual([taken(sensitiveMark)]);
    const [quiet] = await expectAudit(h, 'patient_flag.entered_in_error', {
      after: before,
      count: 2,
    }).then((e) => e.slice(1));
    expect(quiet!.details).toEqual({
      changeId: sensitiveMark.changeId,
      field: 'enteredInError',
      kind: 'entered_in_error',
      version: 1,
      tier: 'secondary',
    });
    await expectAuditClean(h, [MARK_REASON, REASON], before);

    // Set once: a second mark, the Program Admin's, is kept in history, and the first stands. Its
    // answer carries the field as the server holds it: the first answer's event names the patient,
    // as every value kept in history does, and a retry of it is logged as the read it is (lifecycle
    // 10.1, review finding PA-1).
    const viewed = await auditMark(h);
    const second = await markOf(admin, kims.recordId, 'Demo: second thoughts');
    const keptAnswer = {
      ...taken(second),
      server: {
        value: { reason: MARK_REASON },
        version: 1,
        changedBy: kim.id,
        changedAt: byAuthor.deviceTime,
      },
      details: { outcome: 'history_only' },
    };
    expect(await admin.send(second)).toEqual([keptAnswer]);
    expect(await row(kims.recordId)).toMatchObject({ errorReason: MARK_REASON, errorBy: kim.id, version: 2 });
    const [kept] = await expectAudit(h, 'patient_flag.kept_in_history', {
      after: viewed,
      count: 1,
      patientId: patientB,
    });
    expect(kept!.details).toEqual({ changeId: second.changeId, field: 'enteredInError', version: 1 });
    await expectAudit(h, 'patient.viewed', { after: viewed, count: 0 });
    const retried = await auditMark(h);
    expect(await admin.send(second)).toEqual([keptAnswer]);
    const [read] = await expectAudit(h, 'patient.viewed', { after: retried, count: 1, patientId: patientB });
    expect(read!.details).toEqual({ source: 'sync', changeId: second.changeId, field: 'enteredInError' });

    // The Program Admin takes back someone else's change.
    const byAdmin = await markOf(admin, ivys.recordId);
    expect(await admin.send(byAdmin)).toEqual([taken(byAdmin)]);
    expect(await row(ivys.recordId)).toMatchObject({ status: 'entered_in_error', errorBy: t.adminId });

    // Kim neither made Ivy's other change nor manages the team's people: held, and an admin's accept
    // applies it as Kim's, approved by the admin.
    const notHers = await markOf(kim, others.recordId);
    expect(await kim.send(notHers)).toEqual([heldFor(notHers)]);
    expect(await row(others.recordId)).toMatchObject({ status: 'active', errorBy: null });
    expect((await decide((await itemOf(notHers))!.id, 'accept')).status).toBe(200);
    expect(await row(others.recordId)).toMatchObject({ status: 'entered_in_error', errorBy: kim.id });
    expect((await historyOf(others.recordId))[0]).toMatchObject({ changedBy: kim.id, approvedBy: t.adminId });

    // A mark never conflicts, so there is nothing to resolve.
    const resolved = await markOf(kim, kims.recordId, 'Demo: keep mine', {
      baseVersion: 1,
      resolution: 'replace',
    });
    expect(await kim.send(resolved)).toEqual([
      refusedAs(resolved, 'validation', { problem: 'nothing_to_resolve' }),
    ]);
  });

  it('changes only by its mark, and a mark’s value is checked before anything is read', async () => {
    const made = await flagChange(kim, patientA, presetId('flag.low'));
    expect(await kim.send(made)).toEqual([taken(made)]);
    const set = (field: string, value: unknown) =>
      kim.phone.change({ entity: FLAG_CHANGE, recordId: made.recordId, op: 'set', field, value });
    const changes = [
      await set('reason', 'Demo: another reason'),
      await set('action', 'clear'),
      await set('flagId', presetId('flag.high')),
      await markOf(kim, made.recordId, 'No'),
      await markOf(kim, made.recordId, 'E'.repeat(301)),
      await markOf(kim, made.recordId, 'Demo: a space after '),
      await set('enteredInError', null),
    ];
    const answered = await kim.send(...changes);
    expect(answered.map((r) => [r.status, r.reason])).toEqual(changes.map(() => ['rejected', 'validation']));
    expect(answered.slice(0, 3).map((r) => r.details)).toEqual([
      { problem: 'unknown_field' },
      { problem: 'unknown_field' },
      { problem: 'unknown_field' },
    ]);
    expect(
      answered.slice(3).map((r) => (r.details!.problems as { path: string }[]).map((p) => p.path)),
    ).toEqual([['reason'], ['reason'], ['reason'], ['']]);
    expect(await row(made.recordId)).toMatchObject({ status: 'active', version: 1, reason: REASON });
    // The longest reason a mark takes, and the shortest.
    expect(await kim.send(await markOf(kim, made.recordId, 'E'.repeat(300)))).toMatchObject([
      { status: 'accepted' },
    ]);
    const another = await flagChange(kim, patientA, presetId('flag.low'));
    expect(await kim.send(another)).toEqual([taken(another)]);
    expect(await kim.send(await markOf(kim, another.recordId, 'Oop'))).toMatchObject([
      { status: 'accepted' },
    ]);
  });

  it('takes the team’s write lock before anything else (D32)', async () => {
    const c = await flagChange(kim, patientB, presetId('flag.low'));
    const { waited, relations, answer } = await whileLocked(h, t.teamId, () => kim.send(c));
    expect(waited).toBe(true);
    expect(relations).toEqual([]);
    expect(answer).toEqual([taken(c)]);
  });

  describe('a held change that will not reach the chart tells its sender', () => {
    it('rejected: one notice, naming the change and its patient, with no text of it', async () => {
      const held = await flagChange(bo, patientA, presetId('flag.high'));
      expect(await bo.send(held)).toEqual([heldFor(held)]);
      expect((await decide((await itemOf(held))!.id, 'reject')).status).toBe(200);
      expect(await noticesAbout(held.recordId)).toEqual([
        {
          userId: bo.id,
          kind: 'flag_change_not_applied',
          entity: 'patient_flag_change',
          recordId: held.recordId,
          patientId: patientA,
          noteId: null,
        },
      ]);
      // Listed to its sender with its patient, so any phone they sign in on can open the chart.
      const listed = await call(h, '/v1/team/notices', { token: bo.token, teamId: t.teamId });
      expect(listed.status).toBe(200);
      expect(
        (listed.body as unknown as Record<string, unknown>[]).filter(
          (n) => n.kind === 'flag_change_not_applied' && n.recordId === held.recordId,
        ),
      ).toEqual([
        expect.objectContaining({
          entity: 'patient_flag_change',
          recordId: held.recordId,
          patientId: patientA,
          noteId: null,
        }),
      ]);
      expect(JSON.stringify(listed.body)).not.toContain('follow-ups');
      expect(await row(held.recordId)).toBeUndefined();
    });

    it('a held mark rejected names the change it was about and that change’s patient', async () => {
      const theirs = await flagChange(kim, patientC, presetId('flag.frost_risk'));
      expect(await kim.send(theirs)).toEqual([taken(theirs)]);
      const mark = await markOf(bo, theirs.recordId);
      expect(await bo.send(mark)).toEqual([heldFor(mark)]);
      expect((await decide((await itemOf(mark))!.id, 'reject')).status).toBe(200);
      expect(await noticesAbout(theirs.recordId)).toEqual([
        {
          userId: bo.id,
          kind: 'flag_change_not_applied',
          entity: 'patient_flag_change',
          recordId: theirs.recordId,
          patientId: patientC,
          noteId: null,
        },
      ]);
    });

    it('refused at its accept: told once, logged on the patient, and the reject after it tells nobody again', async () => {
      // Held before its value was read: its reason is one the rule refuses.
      const held = await flagChange(bo, patientB, presetId('flag.medium'), { reason: '' });
      expect(await bo.send(held)).toEqual([heldFor(held)]);
      const item = (await itemOf(held))!;
      const before = await auditMark(h);
      const accepted = await decide(item.id, 'accept');
      expect(accepted.status).toBe(409);
      expect(accepted.body.error).toMatchObject({
        code: 'cannot_apply',
        details: { status: 'rejected', reason: 'validation', problem: 'reason_invalid' },
      });
      expect(await itemOf(held)).toMatchObject({ status: 'pending' });
      expect(await noticesAbout(held.recordId)).toEqual([
        expect.objectContaining({ userId: bo.id, kind: 'flag_change_not_applied', patientId: patientB }),
      ]);
      const [refused] = await expectAudit(h, 'quarantine.accept_refused', {
        after: before,
        count: 1,
        patientId: patientB,
      });
      expect(refused!.details).toMatchObject({ itemId: item.id, changeId: held.changeId });
      expect((await decide(item.id, 'reject')).status).toBe(200);
      expect(await noticesAbout(held.recordId)).toHaveLength(1);
      expect(await row(held.recordId)).toBeUndefined();
    });

    it('each held change is told of on its own', async () => {
      const first = await flagChange(bo, patientA, presetId('flag.low'));
      const second = await flagChange(bo, patientA, presetId('flag.low'));
      expect(await bo.send(first, second)).toEqual([heldFor(first), heldFor(second)]);
      for (const c of [first, second])
        expect((await decide((await itemOf(c))!.id, 'reject')).status).toBe(200);
      for (const c of [first, second]) expect(await noticesAbout(c.recordId)).toHaveLength(1);
    });

    it('a held patient create and its held risk level, both rejected, in either order: both rejects succeed and nobody is told', async () => {
      for (const order of ['risk level first', 'patient first']) {
        const sue = await clinician(h, t, `sue-${order.split(' ')[0]}@example.com`, 'Sue (demo)', 'none');
        const intake = await sue.phone.change({
          entity: 'patient',
          op: 'create',
          value: intakeValue({ preferredName: 'Demo Pip' }),
        });
        const risk = await flagChange(sue, intake.recordId, presetId('flag.high'));
        // A role lowered while the phone was offline: the intake and its risk level are both held.
        await setRole(h, t, sue.membershipId, 'billing_data');
        expect(await sue.send(intake, risk)).toEqual([heldFor(intake), heldFor(risk)]);
        const items = [(await itemOf(risk))!, (await itemOf(intake))!];
        for (const item of order === 'patient first' ? items.reverse() : items) {
          const decided = await decide(item.id, 'reject');
          expect(decided.status, `${order}: ${JSON.stringify(decided.body)}`).toBe(200);
        }
        expect(await noticesAbout(risk.recordId)).toEqual([]);
        expect(
          await h.scratch.owner`select 1 from sineobex.user_notices where user_id = ${sue.id}`,
          order,
        ).toHaveLength(0);
      }
    });
  });
});
