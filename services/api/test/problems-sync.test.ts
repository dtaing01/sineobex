import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, mergeDirect } from './patient-fixtures.ts';
import {
  addMember,
  call,
  createEncounter,
  createProblem,
  FakePhone,
  push,
  register,
  results,
  setRole,
  setupTeam,
  type ProblemStatus,
  type Team,
} from './sync-fixtures.ts';

// The problem list through sync (phase 3 design 9, 13.3 problems-sync): the status rule of 9.2,
// the conflict card's three answers, recurrences and reversal requests, sensitive codes, notes,
// and entered in error. Every patient and problem here is made up.

type Change = Awaited<ReturnType<FakePhone['change']>>;

describe('phase 3 sync: problems', () => {
  let h: Harness;
  let t: Team;
  let phoneA: FakePhone;
  let phoneB: FakePhone;
  let adminPhone: FakePhone;
  let chwPhone: FakePhone;
  let billing: { id: string; token: string; phone: FakePhone };
  let patientId: string;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    phoneA = await FakePhone.create();
    phoneB = await FakePhone.create();
    adminPhone = await FakePhone.create();
    chwPhone = await FakePhone.create();
    await register(h, phoneA, t.aToken, t.teamId);
    await register(h, phoneB, t.bToken, t.teamId);
    await register(h, adminPhone, t.adminToken, t.teamId);
    await register(h, chwPhone, t.chwToken, t.teamId);
    const member = await addMember(h, t, 'blair@example.com', 'Blair (demo)', 'billing_data');
    const phone = await FakePhone.create();
    await register(h, phone, member.token, t.teamId);
    billing = { id: member.id, token: member.token, phone };
    patientId = (await createPatient(h, t.teamId, t.aId)).id;
  });
  afterAll(() => h.close());

  const send = async (phone: FakePhone, token: string, ...changes: Change[]) =>
    results((await push(h, phone, token, t.teamId, changes)).body);
  const asA = (...c: Change[]) => send(phoneA, t.aToken, ...c);
  const asB = (...c: Change[]) => send(phoneB, t.bToken, ...c);

  const at = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;
  /** A problem whose statuses were observed in order, the current one at [observed]. */
  const problem = (statuses: ProblemStatus[], observed = '10:00', p: { code?: string } = {}) =>
    createProblem(h, t.teamId, patientId, t.aId, { statuses, at: new Date(at(observed)), ...p });
  const status = (
    phone: FakePhone,
    id: string,
    value: ProblemStatus,
    baseVersion: number,
    observed: string,
    more: { encounterId?: string | null; conflictOf?: string; resolution?: 'keep_server' | 'replace' } = {},
  ) =>
    phone.change({
      entity: 'problem',
      recordId: id,
      op: 'set',
      field: 'status',
      value: { status: value, encounterId: more.encounterId ?? null },
      baseVersion,
      deviceTime: at(observed),
      correctedTime: at(observed),
      ...(more.conflictOf ? { conflictOf: more.conflictOf } : {}),
      ...(more.resolution ? { resolution: more.resolution } : {}),
    });
  const create = (phone: FakePhone, value: Record<string, unknown>) =>
    phone.change({
      entity: 'problem',
      op: 'create',
      value: { patientId, title: 'Demo problem', status: 'new', ...value },
    });

  const row = async (id: string) =>
    (
      await h.scratch.owner<
        {
          status: string;
          statusEncounterId: string | null;
          statusChangedAt: Date;
          statusCheckedAt: Date;
          version: number;
          sensitive: boolean;
          reversalRequest: string | null;
          errorReason: string | null;
        }[]
      >`select status, status_encounter_id as "statusEncounterId", status_changed_at as "statusChangedAt",
               status_checked_at as "statusCheckedAt", (field_versions->>'status')::int as version, sensitive,
               reversal_request as "reversalRequest", error_reason as "errorReason"
        from sineobex.problems where id = ${id}`
    )[0]!;
  const kinds = async (id: string) =>
    (
      await h.scratch.owner<{ kind: string }[]>`
        select kind from sineobex.field_history where record_id = ${id} and field = 'status' order by id`
    ).map((r) => r.kind);
  const summary = (r: {
    status: string;
    reason?: string;
    serverVersion?: number;
    details?: Record<string, unknown>;
  }) =>
    r.status === 'accepted'
      ? [r.status, r.serverVersion, r.details?.outcome ?? null]
      : [r.status, r.details?.problem ?? null];

  describe('the status rule (design 9.2)', () => {
    it('a phone that saw the current version: confirm, move forward, never back', async () => {
      const id = await problem(['new']);
      const r = await asA(
        await status(phoneA, id, 'new', 1, '11:00'),
        await status(phoneA, id, 'ongoing', 2, '12:00'),
        await status(phoneA, id, 'new', 3, '12:30'),
        await status(phoneA, id, 'resolved', 3, '13:00'),
        await status(phoneA, id, 'ongoing', 4, '13:30'),
      );
      expect(r.map(summary)).toEqual([
        ['accepted', 2, null],
        ['accepted', 3, null],
        ['rejected', 'status_backwards'],
        ['accepted', 4, null],
        ['rejected', 'resolved_needs_admin'],
      ]);
      expect(await kinds(id)).toEqual(['created', 'confirmed', 'set', 'set']);
      const p = await row(id);
      expect(p).toMatchObject({ status: 'resolved', version: 4 });
      expect(p.statusChangedAt.toISOString()).toBe(at('13:00'));
      expect(p.statusCheckedAt.toISOString()).toBe(at('13:00'));
    });

    it('a confirmation moves only the check date', async () => {
      const id = await problem(['new', 'ongoing'], '10:00');
      await asA(await status(phoneA, id, 'ongoing', 2, '11:00'));
      const p = await row(id);
      expect(p.statusChangedAt.toISOString()).toBe(at('10:00'));
      expect(p.statusCheckedAt.toISOString()).toBe(at('11:00'));
    });

    it('a phone that did not see it: the observation’s time decides', async () => {
      // Each case starts from a problem observed Ongoing at 12:00 (version 2), sent from version 1.
      const cases: [ProblemStatus[], ProblemStatus, string, unknown[]][] = [
        [['new', 'ongoing'], 'ongoing', '13:00', ['accepted', 3, null]], // the same, newer: confirmed
        [['new', 'ongoing'], 'resolved', '11:00', ['accepted', 2, 'history_only']], // older: history
        [['new', 'ongoing'], 'ongoing', '11:00', ['accepted', 2, 'history_only']], // older, the same: history
        [['new', 'ongoing'], 'resolved', '13:00', ['accepted', 3, null]], // newer, forward: progress
        [['new', 'ongoing'], 'new', '13:00', ['accepted', 2, 'history_only']], // newer, back to New
        [['new', 'resolved'], 'ongoing', '13:00', ['conflict']], // newer, out of Resolved
      ];
      for (const [statuses, next, observed, expected] of cases) {
        const id = await problem(statuses, '12:00');
        const [r] = await asB(await status(phoneB, id, next, 1, observed));
        expect(
          r!.status === 'conflict' ? [r!.status] : summary(r!),
          `${statuses.at(-1)} → ${next} at ${observed}`,
        ).toEqual(expected);
        if (r!.details?.outcome === 'history_only' || r!.status === 'conflict') {
          expect(r!.server).toMatchObject({
            value: { status: statuses.at(-1), encounterId: null },
            version: 2,
          });
          expect((await row(id)).status).toBe(statuses.at(-1));
        }
      }
    });

    it('the conflict, and the problem card’s three answers', async () => {
      // Sam marked it Resolved at 10:05; this phone, from the version before, says Ongoing at 14:30.
      const original = await problem(['new', 'resolved'], '10:05');
      const mine = await status(phoneB, original, 'ongoing', 1, '14:30');
      const [conflict] = await asB(mine);
      expect(conflict).toMatchObject({
        status: 'conflict',
        server: { value: { status: 'resolved', encounterId: null }, version: 2 },
      });

      // All three send keep_server: the person's value stays in history and the conflict settles.
      const keep = await status(phoneB, original, 'ongoing', 2, '14:31', {
        conflictOf: mine.changeId,
        resolution: 'keep_server',
      });
      // "It came back": a new problem, New, recurrenceOf the original.
      const recurrence = await create(phoneB, { recurrenceOf: original, title: 'Burn, left forearm' });
      // "Resolved by mistake": a new problem standing in for the original: the reversal request.
      const request = await create(phoneB, { resolvedInErrorOf: original, title: 'Burn, left forearm' });
      const mark = await auditMark(h);
      const r = await asB(keep, recurrence, request);
      expect(r.map(summary)).toEqual([
        ['accepted', 2, null],
        ['accepted', 1, null],
        ['accepted', 1, null],
      ]);
      const [settled] = await h.scratch.owner<{ by: string }[]>`
        select resolved_by_change as by from sineobex.sync_changes where change_id = ${mine.changeId}`;
      expect(settled!.by).toBe(keep.changeId);
      expect(await kinds(original)).toEqual(['created', 'set', 'kept_both']);
      expect((await row(original)).status).toBe('resolved');
      expect((await row(request.recordId)).reversalRequest).toBe('open');
      const [requested] = await expectAudit(h, 'problem.reversal_requested', {
        after: mark,
        patientId,
        count: 1,
      });
      expect(requested!.details).toMatchObject({ resolvedInErrorOf: original });
    });

    it('a status set names its encounter as a parent: unknown, or held for review with the person’s own', async () => {
      const id = await problem(['new']);
      const unknown = await status(phoneA, id, 'ongoing', 1, '11:00', { encounterId: randomUUID() });
      expect((await asA(unknown))[0]).toMatchObject({
        status: 'rejected',
        reason: 'stale_reference',
        details: { problem: 'encounter_missing' },
      });

      const m = await addMember(h, t, 'drew@example.com', 'Drew (demo)');
      const phone = await FakePhone.create();
      await register(h, phone, m.token, t.teamId);
      const encounter = await phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId },
      });
      await setRole(h, t, m.membershipId, 'billing_data');
      expect((await send(phone, m.token, encounter))[0]).toMatchObject({
        reason: 'permission',
        quarantined: true,
      });
      await setRole(h, t, m.membershipId, 'healthcare_staff');
      const held = await status(phone, id, 'ongoing', 1, '11:30', { encounterId: encounter.recordId });
      expect((await send(phone, m.token, held))[0]).toMatchObject({
        status: 'rejected',
        reason: 'awaiting_review',
        quarantined: true,
        hash: held.valueHash,
      });
      // Neither reached problems.status_encounter_id (whose foreign key would have refused it).
      expect(await row(id)).toMatchObject({ status: 'new', statusEncounterId: null, version: 1 });

      const known = await createEncounter(h, t.teamId, t.aId, patientId);
      expect(
        (await asA(await status(phoneA, id, 'ongoing', 1, '12:00', { encounterId: known })))[0]!.status,
      ).toBe('accepted');
      expect((await row(id)).statusEncounterId).toBe(known);
    });

    it('a status sent for an entry merged into another applies to the survivor', async () => {
      const survivor = await problem(['new', 'ongoing'], '10:00');
      const merged = await problem(['new'], '09:00');
      await h.scratch.owner`update sineobex.problems set merged_into = ${survivor} where id = ${merged}`;
      const [r] = await asA(await status(phoneA, merged, 'resolved', 1, '11:00'));
      expect(r).toMatchObject({ status: 'accepted', serverVersion: 3, details: { redirectedTo: survivor } });
      expect((await row(survivor)).status).toBe('resolved');
      expect((await row(merged)).status).toBe('new');
      expect((await kinds(survivor)).at(-1)).toBe('redirected');
    });
  });

  describe('creating problems', () => {
    it('a recurrence or a reversal request stands beside a Resolved entry of the same person', async () => {
      const other = await createPatient(h, t.teamId, t.aId);
      const ongoing = await problem(['ongoing']);
      const elsewhere = await createProblem(h, t.teamId, other.id, t.aId, { statuses: ['resolved'] });
      const r = await asA(
        await create(phoneA, { recurrenceOf: ongoing }),
        await create(phoneA, { resolvedInErrorOf: elsewhere }),
      );
      expect(r.map((x) => x.details?.problem)).toEqual(['not_resolved', 'not_resolved']);

      // A merged group is one person: the merged record's Resolved entry may come back on the survivor.
      await mergeDirect(h, t.teamId, other.id, patientId, t.adminId);
      expect((await asA(await create(phoneA, { resolvedInErrorOf: elsewhere })))[0]!.status).toBe('accepted');
    });

    it('a problem is sensitive by its code’s range, or when the phone says so', async () => {
      const coded = (code: string) => ({ code: { system: 'icd10cm', code } });
      const changes = [
        await create(phoneA, coded('F11.20')),
        await create(phoneA, coded('Z71.41')),
        await create(phoneA, coded('J02.9')),
        await create(phoneA, { sensitive: true }),
      ];
      expect((await asA(...changes)).map((x) => x.status)).toEqual(Array(4).fill('accepted'));
      const flags = await Promise.all(changes.map(async (c) => (await row(c.recordId)).sensitive));
      expect(flags).toEqual([true, true, false, true]);
    });

    it('Billing/Data and a community health worker hold every problem write for review', async () => {
      const id = await problem(['new']);
      for (const [phone, token] of [
        [billing.phone, billing.token],
        [chwPhone, t.chwToken],
      ] as const) {
        const r = await send(
          phone,
          token,
          await create(phone, {}),
          await status(phone, id, 'ongoing', 1, '11:00'),
          await phone.change({
            entity: 'problem_note',
            op: 'create',
            value: { problemId: id, text: 'Demo: note' },
          }),
        );
        expect(r.map((x) => [x.reason, x.quarantined])).toEqual(Array(3).fill(['permission', true]));
      }
    });
  });

  describe('notes and entered in error', () => {
    it('notes are append-only', async () => {
      const id = await problem(['new']);
      const note = await phoneA.change({
        entity: 'problem_note',
        op: 'create',
        value: { problemId: id, text: 'Demo: dressing changed.' },
      });
      const mark = await auditMark(h);
      expect((await asA(note))[0]).toMatchObject({ status: 'accepted', hash: note.valueHash });
      await expectAudit(h, 'problem_note.created', { after: mark, patientId, count: 1 });
      await expect(
        h.scratch.owner`update sineobex.problem_notes set text = 'Demo: changed' where id = ${note.recordId}`,
      ).rejects.toThrow();
      const set = await phoneA.change({
        entity: 'problem_note',
        recordId: note.recordId,
        op: 'set',
        field: 'text',
        value: 'Demo: changed',
      });
      expect((await asA(set))[0]).toMatchObject({
        status: 'rejected',
        details: { problem: 'unknown_field' },
      });
    });

    it('entered in error: its author, or someone who may reverse a resolution; others are held', async () => {
      const retract = (phone: FakePhone, id: string) =>
        phone.change({
          entity: 'problem',
          recordId: id,
          op: 'set',
          field: 'enteredInError',
          value: { reason: 'Demo: added to the wrong chart' },
        });
      const byAuthor = await problem(['new']);
      const byAdmin = await problem(['new']);
      const byOther = await problem(['new']);
      const byChw = await problem(['new']);
      const mark = await auditMark(h);
      expect((await asA(await retract(phoneA, byAuthor)))[0]!.status).toBe('accepted');
      expect((await send(adminPhone, t.adminToken, await retract(adminPhone, byAdmin)))[0]!.status).toBe(
        'accepted',
      );
      expect((await asB(await retract(phoneB, byOther)))[0]).toMatchObject({
        reason: 'permission',
        quarantined: true,
      });
      expect((await send(chwPhone, t.chwToken, await retract(chwPhone, byChw)))[0]).toMatchObject({
        reason: 'permission',
        quarantined: true,
      });
      await expectAudit(h, 'problem.entered_in_error', { after: mark, patientId, count: 2 });
      expect((await row(byOther)).errorReason).toBeNull();
    });

    it('work for a problem someone marked entered in error is kept, never refused', async () => {
      const id = await problem(['new'], '10:00');
      await asA(
        await phoneA.change({
          entity: 'problem',
          recordId: id,
          op: 'set',
          field: 'enteredInError',
          value: { reason: 'Demo: wrong patient' },
        }),
      );
      const late = await status(phoneB, id, 'resolved', 1, '12:00');
      const note = await phoneB.change({
        entity: 'problem_note',
        op: 'create',
        value: { problemId: id, text: 'Demo: healed, no dressing needed.' },
      });
      const r = await asB(late, note);
      expect(r[0]).toMatchObject({
        status: 'accepted',
        serverVersion: 1,
        server: { value: { status: 'new', encounterId: null }, version: 1 },
        details: { outcome: 'history_only' },
      });
      expect(r[1]).toMatchObject({ status: 'accepted', details: { problemRetracted: true } });
      expect(await row(id)).toMatchObject({ status: 'new', errorReason: 'Demo: wrong patient' });
      expect(await kinds(id)).toEqual(['created', 'kept_both']);
      const [stored] = await h.scratch.owner<{ problemId: string }[]>`
        select problem_id as "problemId" from sineobex.problem_notes where id = ${note.recordId}`;
      expect(stored!.problemId).toBe(id);
    });
  });

  describe('reading problems', () => {
    it('Billing/Data reads problems and codes; a community health worker reads none', async () => {
      const id = await problem(['new'], '10:00', { code: 'J02.9' });
      const read = (token: string) =>
        call(h, '/v1/sync/records', {
          method: 'POST',
          token,
          teamId: t.teamId,
          json: { records: [{ entity: 'problem', id }] },
        });
      const billed = await read(billing.token);
      expect(billed.status).toBe(200);
      expect((billed.body.records as { attributes: Record<string, unknown> }[])[0]!.attributes).toMatchObject(
        {
          code: { system: 'icd10cm', code: 'J02.9' },
          sensitive: false,
        },
      );
      expect((await read(t.chwToken)).status).toBe(403);
    });
  });
});
