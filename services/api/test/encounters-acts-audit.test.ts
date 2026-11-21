import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attest,
  chartedVisit,
  cosign,
  createWorld,
  eventsAfter,
  finish,
  noteRow,
  post,
  removeMember,
  roleWith,
  waitingForAttestation,
  waitingForCosign,
  whileTeamLocked,
  type World,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark } from './patient-fixtures.ts';
import { clinician } from './sync-fixtures.ts';

/**
 * The online acts' audit (lifecycle 10.1; CLAUDE.md, every action writes its event in the same
 * transaction): co-sign, attest and assign each write their row and their event in one transaction
 * (review finding PA-2), assign asks who the caller is once the team lock is theirs (PA-3), and an
 * attest naming a note of the visit the caller may not read at all is logged as cannot_read (the
 * coordinator's decision on D98 in the phase's review).
 */
describe('phase 4: the online acts and their events', () => {
  let h: Harness;
  let w: World;
  beforeAll(async () => {
    h = await createHarness();
    w = await createWorld(h);
  });
  afterAll(() => h.close());

  /** The transaction that last wrote each row: equal when one transaction wrote them all. */
  const xmin = async (table: string, id: string) =>
    (
      await h.scratch.owner.unsafe<{ xid: string }[]>(
        `select xmin::text as xid from sineobex.${table} where id = $1`,
        [id],
      )
    )[0]!.xid;
  const eventXmins = async (after: string, action: string) =>
    (
      await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.audit_events where id > ${after}::bigint and action = ${action}
        order by id`
    ).map((r) => r.xid);

  it('a co-signature and its note.cosigned events are written in one transaction', async () => {
    const v = await waitingForCosign(w);
    const mark = await auditMark(h);
    expect((await cosign(w, w.ana, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
    const [row] = await h.scratch.owner<{ id: string }[]>`
      select id from sineobex.note_signoffs where note_id = ${v.note.noteId} and act = 'cosign'`;
    const tx = await xmin('note_signoffs', row!.id);
    expect(await eventXmins(mark, 'note.cosigned')).toEqual([tx, tx]);
  });

  it('an attestation and its note.attested events are written in one transaction', async () => {
    const v = await waitingForAttestation(w);
    const mark = await auditMark(h);
    expect((await attest(w, w.ana, v.visit.encounterId, [v.flags, v.note])).status).toBe(200);
    const [row] = await h.scratch.owner<{ id: string }[]>`
      select id from sineobex.note_attestations where note_id = ${v.note.noteId}`;
    const tx = await xmin('note_attestations', row!.id);
    expect(await eventXmins(mark, 'note.attested')).toEqual([tx, tx]);
  });

  it('an assignment and its note.assigned event are written in one transaction', async () => {
    const left = await clinician(h, w.t, 'left-acts@example.com', 'Left acts (demo)', 'resident');
    const v = await chartedVisit(w, left);
    await removeMember(w, left.membershipId);
    const mark = await auditMark(h);
    const r = await post(w, w.t.adminToken, `/v1/notes/${v.note.noteId}/assign`, {
      toUserId: w.nia.id,
      reason: 'Demo: the author left the team',
    });
    expect(r.status).toBe(200);
    const tx = await xmin('note_assignments', (r.body as { assignmentId: string }).assignmentId);
    expect(await eventXmins(mark, 'note.assigned')).toEqual([tx]);
  });

  it('assign refuses a caller whose role lost team.manage_users while it waited for the team lock, and logs it', async () => {
    const managers = await roleWith(h, w.t, 'Managers', [
      'patients.view',
      'patients.view_sensitive',
      'encounters.chart',
      'team.manage_users',
    ]);
    const plain = await roleWith(h, w.t, 'Plain', ['patients.view', 'encounters.chart']);
    const max = await clinician(h, w.t, 'max@example.com', 'Max (demo)', 'none', managers);
    const left = await clinician(h, w.t, 'left-race@example.com', 'Left race (demo)', 'attending');
    const v = await chartedVisit(w, left);
    await removeMember(w, left.membershipId);
    const [plainRole] = await h.scratch.owner<{ id: string }[]>`
      select id from sineobex.roles where team_id = ${w.t.teamId} and key = ${plain}`;
    const mark = await auditMark(h);
    const { waited, answer } = await whileTeamLocked(
      h,
      w.t.teamId,
      () =>
        post(w, max.token, `/v1/notes/${v.note.noteId}/assign`, {
          toUserId: w.ana.id,
          reason: 'Demo: the author left',
        }),
      (sql) =>
        sql`update sineobex.team_memberships set role_id = ${plainRole!.id} where id = ${max.membershipId}`,
    );
    expect(waited).toBe(true);
    expect(answer.status).toBe(403);
    expect((await noteRow(h, v.note.noteId)).assignedUserId).toBeNull();
    expect(await eventsAfter(h, mark)).toEqual([
      expect.objectContaining({
        action: 'access.denied',
        details: expect.objectContaining({ permission: 'team.manage_users' }),
      }),
    ]);
  });

  it('assign refuses a caller removed while it waited for the team lock: not_a_member, logged', async () => {
    const managers = await roleWith(h, w.t, 'Managers two', [
      'patients.view',
      'encounters.chart',
      'team.manage_users',
    ]);
    const mo = await clinician(h, w.t, 'mo@example.com', 'Mo (demo)', 'none', managers);
    const left = await clinician(h, w.t, 'left-gone@example.com', 'Left gone (demo)', 'attending');
    const v = await chartedVisit(w, left);
    await removeMember(w, left.membershipId);
    const mark = await auditMark(h);
    const { waited, answer } = await whileTeamLocked(
      h,
      w.t.teamId,
      () =>
        post(w, mo.token, `/v1/notes/${v.note.noteId}/assign`, {
          toUserId: w.ana.id,
          reason: 'Demo: the author left',
        }),
      (sql) =>
        sql`update sineobex.team_memberships set status = 'removed', removed_at = now() where id = ${mo.membershipId}`,
    );
    expect(waited).toBe(true);
    expect(answer.status).toBe(403);
    expect((answer.body as { error?: { code?: string } }).error?.code).toBe('not_a_member');
    expect((await noteRow(h, v.note.noteId)).assignedUserId).toBeNull();
    expect(await eventsAfter(h, mark)).toEqual([
      expect.objectContaining({
        action: 'access.denied',
        details: expect.objectContaining({ reason: 'not_a_member' }),
      }),
    ]);
  });

  it('an attest naming a note of the visit the caller may not read at all is answered not_waiting and logged as cannot_read', async () => {
    // Eli charts and holds no patients.view, so he reads no Medical note.
    const v = await waitingForAttestation(w);
    const signed = await chartedVisit(w, w.rae);
    await finish(w.rae, [signed.flags, 'sign', 'signed'], [signed.note, 'sign', 'signed']);
    const mark = await auditMark(h);
    const r = await attest(w, w.eli, v.visit.encounterId, [v.note]);
    expect(r.status).toBe(409);
    expect((r.body as { error?: { code?: string } }).error?.code).toBe('not_waiting');
    expect(await eventsAfter(h, mark)).toEqual([
      expect.objectContaining({
        action: 'access.denied',
        entity: 'encounter',
        entityId: v.visit.encounterId,
        patientId: w.patientId,
        details: expect.objectContaining({ reason: 'cannot_read', noteIds: [v.note.noteId] }),
      }),
    ]);
    // A note of another visit stays unlogged: it is not one of this visit's.
    const other = await auditMark(h);
    expect((await attest(w, w.eli, v.visit.encounterId, [signed.note])).status).toBe(409);
    expect((await eventsAfter(h, other)).filter((e) => e.details?.reason === 'cannot_read')).toEqual([]);
  });
});
