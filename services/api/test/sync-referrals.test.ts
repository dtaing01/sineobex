import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean, mergeDirect } from './patient-fixtures.ts';
import {
  call,
  clinician,
  setupTeam,
  visitOf,
  type Change,
  type Clinician,
  type Team,
} from './sync-fixtures.ts';

// Phase 4's referrals through sync (lifecycle 4.7, 7): a date and free-text details, made by anyone
// who may make one, a community health worker included; entered in error once, by its author or by
// anyone who charts; never more than a day ahead; never at a visit of someone else. Every person
// and value is made up.

describe('phase 4 sync: referrals', () => {
  let h: Harness;
  let t: Team;
  let patientA: string;
  let patientB: string;
  /** Merged into A: one person, two records. */
  let patientC: string;
  let kim: Clinician;
  let ivy: Clinician;
  let dana: Clinician;
  let bo: Clinician;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    patientA = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Ash' })).id;
    patientB = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Birch' })).id;
    patientC = (await createPatient(h, t.teamId, t.adminId, { preferredName: 'Demo Ash two' })).id;
    await mergeDirect(h, t.teamId, patientC, patientA, t.adminId);
    // Community health workers: referrals.create, and no encounters.chart.
    kim = await clinician(h, t, 'kim@example.com', 'Kim (demo)', 'chw', 'community_health_worker');
    ivy = await clinician(h, t, 'ivy@example.com', 'Ivy (demo)', 'chw', 'community_health_worker');
    dana = await clinician(h, t, 'dana@example.com', 'Dana (demo)', 'attending');
    // Billing/Data: views charts, makes no referral.
    bo = await clinician(h, t, 'bo@example.com', 'Bo (demo)', 'none', 'billing_data');
  });
  afterAll(() => h.close());

  const referral = (
    c: Clinician,
    patientId: string,
    more: { referredOn?: string; details?: string; encounterId?: string | null; recordId?: string } = {},
  ) => {
    const { referredOn, details, encounterId, ...change } = more;
    return c.phone.change({
      entity: 'referral',
      op: 'create',
      value: {
        patientId,
        referredOn: referredOn ?? '2026-10-20',
        details: details ?? 'Demo: dental clinic on Main St',
        encounterId: encounterId ?? null,
      },
      ...change,
    });
  };

  const mark = (
    c: Clinician,
    referralId: string,
    reason = 'Demo: made for the wrong person',
    baseVersion = 0,
  ) =>
    c.phone.change({
      entity: 'referral',
      recordId: referralId,
      op: 'set',
      field: 'enteredInError',
      value: { reason },
      baseVersion,
    });

  const taken = (c: Change, serverVersion = 1) => ({
    changeId: c.changeId,
    status: 'accepted',
    serverVersion,
    hash: c.valueHash,
  });

  const rejectedAs = (c: Change, reason: string, details: Record<string, unknown>) => ({
    changeId: c.changeId,
    status: 'rejected',
    reason,
    message: expect.any(String),
    details,
  });

  const row = async (id: string) =>
    (
      await h.scratch.owner<Record<string, unknown>[]>`
        select id, team_id as "teamId", patient_id as "patientId", to_char(referred_on, 'YYYY-MM-DD') as "referredOn",
               details, encounter_id as "encounterId", status, error_reason as "errorReason", error_by as "errorBy",
               error_at as "errorAt", recorded_at as "recordedAt", clock_verified as "clockVerified",
               author_user_id as "authorUserId", created_device_id as "createdDeviceId",
               field_versions as "fieldVersions", field_meta as "fieldMeta", version
        from sineobex.referrals where id = ${id}`
    )[0];

  it('is made by anyone who may make one, a community health worker included, and logged without its details', async () => {
    const before = await auditMark(h);
    const made = await referral(kim, patientA);
    const [answer] = await kim.send(made);
    expect(answer).toEqual(taken(made));
    expect(await row(made.recordId)).toEqual({
      id: made.recordId,
      teamId: t.teamId,
      patientId: patientA,
      referredOn: '2026-10-20',
      details: 'Demo: dental clinic on Main St',
      encounterId: null,
      status: 'active',
      errorReason: null,
      errorBy: null,
      errorAt: null,
      recordedAt: new Date(made.deviceTime),
      clockVerified: true,
      authorUserId: kim.id,
      createdDeviceId: kim.phone.deviceId,
      fieldVersions: {},
      fieldMeta: {},
      version: 1,
    });
    const [event] = await expectAudit(h, 'referral.created', { after: before, count: 1 });
    expect(event).toMatchObject({
      actorUserId: kim.id,
      entity: 'referral',
      entityId: made.recordId,
      patientId: patientA,
    });
    expect(event!.details).toEqual({ changeId: made.changeId, clockVerified: true, encounterId: null });
    await expectAuditClean(h, ['dental clinic'], before);

    // Sent again, it answers from its receipt and writes nothing more.
    expect(await kim.send(made)).toEqual([answer]);
    await expectAudit(h, 'referral.created', { after: before, count: 1 });

    // Billing/Data holds no referrals.create: held for a Program Admin, nothing stored.
    const fromBo = await referral(bo, patientA);
    expect(await bo.send(fromBo)).toEqual([
      expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
    ]);
    expect(await row(fromBo.recordId)).toBeUndefined();
  });

  it('is dated no more than a day after the server’s date (referral_in_future)', async () => {
    // The harness clock reads 2026-10-20.
    const changes = [
      await referral(kim, patientA, { referredOn: '2026-10-21' }),
      await referral(kim, patientA, { referredOn: '2026-10-22' }),
      await referral(kim, patientA, { referredOn: '2025-01-31' }),
      await referral(kim, patientA, { referredOn: '2026-02-30' }),
      await referral(kim, patientA, { referredOn: '20 Oct 2026' }),
    ];
    const answers = await kim.send(...changes);
    expect(answers.slice(0, 3)).toEqual([
      taken(changes[0]!),
      rejectedAs(changes[1]!, 'validation', { problem: 'referral_in_future' }),
      taken(changes[2]!),
    ]);
    for (const a of answers.slice(3)) {
      expect(a).toMatchObject({ status: 'rejected', reason: 'validation' });
      expect(new Set((a.details!.problems as { path: string }[]).map((p) => p.path))).toEqual(
        new Set(['referredOn']),
      );
    }
    expect(await row(changes[1]!.recordId)).toBeUndefined();
  });

  it('names a visit of its patient’s merged group, or none; a visit of someone else is refused, and sent without it is taken', async () => {
    const ofA = await visitOf(dana, patientA);
    const ofB = await visitOf(dana, patientB);
    const ofC = await visitOf(dana, patientC);
    const nobody = await visitOf(dana, null);
    const before = await auditMark(h);
    const changes = [
      await referral(dana, patientA, { encounterId: ofA.encounterId }),
      await referral(dana, patientA, { encounterId: ofB.encounterId }),
      // One person, two records: either names the other's visit.
      await referral(dana, patientA, { encounterId: ofC.encounterId }),
      await referral(kim, patientC, { encounterId: ofA.encounterId }),
      // A visit with no patient names nobody else.
      await referral(kim, patientB, { encounterId: nobody.encounterId }),
      await referral(dana, patientA, { encounterId: randomUUID() }),
      await referral(dana, randomUUID()),
    ];
    const answers = [
      ...(await dana.send(changes[0]!, changes[1]!, changes[2]!)),
      ...(await kim.send(changes[3]!, changes[4]!)),
      ...(await dana.send(changes[5]!, changes[6]!)),
    ];
    expect(answers).toEqual([
      taken(changes[0]!),
      rejectedAs(changes[1]!, 'stale_reference', { problem: 'encounter_other_patient' }),
      taken(changes[2]!),
      taken(changes[3]!),
      taken(changes[4]!),
      rejectedAs(changes[5]!, 'stale_reference', { problem: 'encounter_missing' }),
      rejectedAs(changes[6]!, 'stale_reference', { problem: 'patient_missing' }),
    ]);
    expect(await row(changes[0]!.recordId)).toMatchObject({ encounterId: ofA.encounterId });
    expect(await row(changes[1]!.recordId)).toBeUndefined();
    const events = await expectAudit(h, 'referral.created', { after: before, count: 4 });
    expect(events[0]!.details).toMatchObject({ encounterId: ofA.encounterId });

    // Send without the visit: the same record, with no visit, settles the refusal.
    const without = await dana.phone.change({
      entity: 'referral',
      op: 'create',
      recordId: changes[1]!.recordId,
      supersedes: changes[1]!.changeId,
      value: { ...(changes[1]!.value as Record<string, unknown>), encounterId: null },
    });
    expect(await dana.send(without)).toEqual([taken(without)]);
    expect(await row(without.recordId)).toMatchObject({ patientId: patientA, encounterId: null });
    const [refusal] = await h.scratch.owner<{ resolvedByChange: string | null }[]>`
      select resolved_by_change as "resolvedByChange" from sineobex.sync_changes where change_id = ${changes[1]!.changeId}`;
    expect(refusal!.resolvedByChange).toBe(without.changeId);
  });

  it('is entered in error once, by its author or by anyone who charts; anyone else is held for review', async () => {
    const kims = await referral(kim, patientA);
    const ivys = await referral(ivy, patientA);
    const others = await referral(ivy, patientA);
    expect((await kim.send(kims)).map((r) => r.status)).toEqual(['accepted']);
    expect((await ivy.send(ivys, others)).map((r) => r.status)).toEqual(['accepted', 'accepted']);

    const before = await auditMark(h);
    const reason = 'Demo: made for the wrong person';
    // Kim takes back her own; Dana charts, and takes back Ivy's.
    const byAuthor = await mark(kim, kims.recordId, reason);
    const byClinician = await mark(dana, ivys.recordId);
    expect(await kim.send(byAuthor)).toEqual([taken(byAuthor)]);
    expect(await dana.send(byClinician)).toEqual([taken(byClinician)]);
    expect(await row(kims.recordId)).toMatchObject({
      status: 'entered_in_error',
      errorReason: reason,
      errorBy: kim.id,
      errorAt: new Date(byAuthor.deviceTime),
      fieldVersions: { enteredInError: 1 },
      version: 2,
    });
    expect(await row(ivys.recordId)).toMatchObject({ status: 'entered_in_error', errorBy: dana.id });
    const [history] = await h.scratch.owner<Record<string, unknown>[]>`
      select field, version, value, previous_value as "previousValue", kind, changed_by as "changedBy"
      from sineobex.field_history where record_id = ${kims.recordId}`;
    expect(history).toEqual({
      field: 'enteredInError',
      version: 1,
      value: { reason },
      previousValue: null,
      kind: 'entered_in_error',
      changedBy: kim.id,
    });
    const [event] = await expectAudit(h, 'referral.entered_in_error', { after: before, count: 2 });
    expect(event).toMatchObject({
      actorUserId: kim.id,
      entity: 'referral',
      entityId: kims.recordId,
      patientId: patientA,
    });
    await expectAuditClean(h, [reason], before);

    // Set once: a second mark is kept in history, and the first stands.
    const second = await mark(dana, kims.recordId, 'Demo: second thoughts');
    expect(await dana.send(second)).toEqual([
      {
        ...taken(second),
        server: { value: { reason }, version: 1, changedBy: kim.id, changedAt: byAuthor.deviceTime },
        details: { outcome: 'history_only' },
      },
    ]);
    expect(await row(kims.recordId)).toMatchObject({ errorReason: reason, errorBy: kim.id, version: 2 });

    // Kim did not make Ivy's other referral and charts nothing: held for a Program Admin.
    const notHers = await mark(kim, others.recordId);
    expect(await kim.send(notHers)).toEqual([
      expect.objectContaining({ status: 'rejected', reason: 'permission', quarantined: true }),
    ]);
    expect(await row(others.recordId)).toMatchObject({ status: 'active', errorBy: null });
    const [item] = await h.scratch.owner<{ id: string }[]>`
      select id from sineobex.quarantine_items where change_id = ${notHers.changeId}`;
    const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
      method: 'POST',
      token: t.adminToken,
      teamId: t.teamId,
      json: { decision: 'accept', reason: 'Demo: Kim checked with Ivy' },
    });
    expect(decided.status).toBe(200);
    expect(await row(others.recordId)).toMatchObject({ status: 'entered_in_error', errorBy: kim.id });

    // A mark never conflicts, so there is nothing to resolve.
    const resolved = await kim.phone.change({
      entity: 'referral',
      recordId: kims.recordId,
      op: 'set',
      field: 'enteredInError',
      value: { reason: 'Demo: keep mine' },
      resolution: 'replace',
    });
    expect(await kim.send(resolved)).toEqual([
      rejectedAs(resolved, 'validation', { problem: 'nothing_to_resolve' }),
    ]);
  });

  it('changes only by its mark, and its value is checked before anything is read', async () => {
    const made = await referral(kim, patientA);
    expect((await kim.send(made)).map((r) => r.status)).toEqual(['accepted']);
    const value = made.value as Record<string, unknown>;
    const bad = (v: Record<string, unknown>) =>
      kim.phone.change({ entity: 'referral', op: 'create', value: { ...value, ...v } });
    const { encounterId: _, ...noVisit } = value;
    const changes = [
      await kim.phone.change({
        entity: 'referral',
        recordId: made.recordId,
        op: 'set',
        field: 'details',
        value: 'Demo: another clinic',
      }),
      await bad({ details: 'Demo: trailing space ' }),
      await bad({ details: 'D'.repeat(2001) }),
      await bad({ details: '' }),
      await bad({ status: 'completed' }),
      await kim.phone.change({ entity: 'referral', op: 'create', value: noVisit }),
      await mark(kim, made.recordId, 'No'),
      await kim.phone.change({
        entity: 'referral',
        recordId: made.recordId,
        op: 'set',
        field: 'enteredInError',
        value: null,
      }),
    ];
    const answered = await kim.send(...changes);
    expect(answered.map((r) => [r.status, r.reason])).toEqual(changes.map(() => ['rejected', 'validation']));
    expect(answered[0]!.details).toEqual({ problem: 'unknown_field' });
    expect(
      answered.slice(1).map((r) => (r.details!.problems as { path: string }[]).map((p) => p.path)),
    ).toEqual([['details'], ['details'], ['details'], [''], ['encounterId'], ['reason'], ['']]);
    expect(await row(made.recordId)).toMatchObject({ status: 'active', version: 1 });
    // The longest details are taken.
    expect((await kim.send(await bad({ details: 'D'.repeat(2000) }))).map((r) => r.status)).toEqual([
      'accepted',
    ]);
  });
});
