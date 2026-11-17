import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, logSpy } from './patient-fixtures.ts';
import {
  createEncounter,
  FakePhone,
  intakeValue,
  push,
  register,
  results,
  setupTeam,
  type Team,
} from './sync-fixtures.ts';

// One lock order between pushes and merges (phase 3 design 2.2 step 2, D32, review finding 12;
// 13.3 sync-concurrency). Two connections: a raw transaction standing in for a merge (or any
// patient-side writer), and pushes through the API. Every patient here is made up.

type Change = Awaited<ReturnType<FakePhone['change']>>;

describe('phase 3 sync: lock order', () => {
  const spy = logSpy();
  let h: Harness;
  let t: Team;
  let phoneA: FakePhone;
  let phoneB: FakePhone;

  beforeAll(async () => {
    h = await createHarness({ log: spy.log });
    t = await setupTeam(h);
    phoneA = await FakePhone.create();
    phoneB = await FakePhone.create();
    await register(h, phoneA, t.aToken, t.teamId);
    await register(h, phoneB, t.bToken, t.teamId);
  });
  afterAll(() => h.close());

  const asA = async (...changes: Change[]) =>
    results((await push(h, phoneA, t.aToken, t.teamId, changes)).body);
  const asB = async (...changes: Change[]) =>
    results((await push(h, phoneB, t.bToken, t.teamId, changes)).body);

  /** Waits until some backend waits on an advisory lock: the push, at the team's write lock. */
  async function pushWaitsForTeamLock() {
    for (let i = 0; i < 400; i++) {
      const [row] = await h.scratch.owner<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      if (row!.n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('the push never waited for the team lock');
  }

  /**
   * A merge as it locks (design 8.4): the team's write lock first, then both patient rows. It
   * holds them until `finish` runs, and fails fast instead of waiting long.
   */
  async function openMerge(mergedId: string, survivorId: string) {
    const conn = await h.scratch.owner.reserve();
    await conn`begin`;
    await conn`set local lock_timeout = '3s'`;
    await conn`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${t.teamId}::uuid::text, 0))`;
    await conn`select id from sineobex.patients where id in (${mergedId}, ${survivorId}) for no key update`;
    return {
      conn,
      async finish() {
        try {
          await conn`update sineobex.patients set status = 'merged', merged_into = ${survivorId},
                     canonical_id = ${survivorId} where id = ${mergedId}`;
          await conn`commit`;
        } finally {
          conn.release();
        }
      },
    };
  }

  it('an encounter create naming a patient waits for a merge before its foreign key touches the patient', async () => {
    const survivor = await createPatient(h, t.teamId, t.aId);
    const merged = await createPatient(h, t.teamId, t.aId);
    const merge = await openMerge(merged.id, survivor.id);
    const encounter = await phoneA.change({
      entity: 'encounter',
      op: 'create',
      value: { kind: 'medical', patientId: merged.id },
    });
    const pushing = asA(encounter);
    await pushWaitsForTeamLock();
    // Had the insert run first, its foreign key check would hold FOR KEY SHARE on the patient while
    // the push waited for the team lock, and this would wait for it in turn: a deadlock.
    await merge.conn`select id from sineobex.patients where id = ${merged.id} for update`;
    await merge.finish();
    expect(await pushing).toEqual([
      expect.objectContaining({ status: 'accepted', hash: encounter.valueHash }),
    ]);
  });

  it('so does an encounter moved to a patient', async () => {
    const survivor = await createPatient(h, t.teamId, t.aId);
    const merged = await createPatient(h, t.teamId, t.aId);
    const encounterId = await createEncounter(h, t.teamId, t.aId, null);
    const merge = await openMerge(merged.id, survivor.id);
    const move = await phoneA.change({
      entity: 'encounter',
      recordId: encounterId,
      op: 'set',
      field: 'patientId',
      value: merged.id,
      baseVersion: 1,
    });
    const pushing = asA(move);
    await pushWaitsForTeamLock();
    await merge.conn`select id from sineobex.patients where id = ${merged.id} for update`;
    await merge.finish();
    expect(await pushing).toEqual([expect.objectContaining({ status: 'accepted', serverVersion: 2 })]);
  });

  it('an encounter edit never deadlocks with a patient-side write naming the encounter', async () => {
    // A writer holding the team lock may insert a problem naming the encounter, whose foreign key
    // check takes FOR KEY SHARE; the edit, waiting for that lock, has not locked the row yet.
    const p = await createPatient(h, t.teamId, t.aId);
    const encounterId = await createEncounter(h, t.teamId, t.aId, p.id);
    const writer = await h.scratch.owner.reserve();
    try {
      await writer`begin`;
      await writer`set local lock_timeout = '3s'`;
      await writer`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${t.teamId}::uuid::text, 0))`;
      const edit = await phoneA.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'location',
        value: { lat: 42.33, lng: -83.05 },
        baseVersion: 1,
      });
      const pushing = asA(edit);
      await pushWaitsForTeamLock();
      await writer`
        insert into sineobex.problems (id, team_id, patient_id, title, sensitive, status, status_encounter_id,
          status_changed_at, status_changed_by, status_checked_at, author_user_id)
        values (gen_random_uuid(), ${t.teamId}, ${p.id}, 'Demo problem', false, 'new', ${encounterId}, now(),
          ${t.aId}, now(), ${t.aId})`;
      await writer`commit`;
      expect(await pushing).toEqual([expect.objectContaining({ status: 'accepted', serverVersion: 2 })]);
    } finally {
      writer.release();
    }
  });

  it('every encounter edit takes the team lock before the encounter row', async () => {
    // Review finding S3: a status edit (a location edit since phase 4 took status out of the fields)
    // locked the row, then waited for the team lock at its audit event, while a patient move held
    // the team lock and waited for the row.
    const p = await createPatient(h, t.teamId, t.aId);
    const encounterId = await createEncounter(h, t.teamId, t.aId, p.id);
    const mover = await h.scratch.owner.reserve();
    try {
      await mover`begin`;
      await mover`set local lock_timeout = '3s'`;
      await mover`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${t.teamId}::uuid::text, 0))`;
      const edit = await phoneA.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'location',
        value: { lat: 42.33, lng: -83.05 },
        baseVersion: 1,
      });
      const pushing = asA(edit);
      await pushWaitsForTeamLock();
      // What `set patientId` does next under the team lock.
      await mover`select id from sineobex.encounters where id = ${encounterId} for no key update`;
      await mover`commit`;
      expect(await pushing).toEqual([expect.objectContaining({ status: 'accepted', serverVersion: 2 })]);
    } finally {
      mover.release();
    }
  });

  it('a note change waits for another writer of its visit, so the visit’s status is right', async () => {
    // Lifecycle 4.2: every note change takes the team lock. Today's sync cannot finish a note (0018
    // refuses a status without its time of finishing); the move it can make that finishes a visit
    // is blanking its last open draft ("Remove this note"), which a draft opened at the same time
    // by another phone must still stop.
    const encounterId = await createEncounter(h, t.teamId, t.aId, null);
    await h.scratch.owner`
      insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data,
        status, completed_at, completed_by)
      values (gen_random_uuid(), ${t.teamId}, ${encounterId}, 'wound_care', ${t.aId},
        '{"plan": "Demo: dress daily"}', 'completed', now(), ${t.aId})`;
    const open = await phoneA.change({
      entity: 'encounter_note',
      op: 'create',
      value: { encounterId, noteTypeKey: 'wound_care', data: { plan: 'Demo: soak first' } },
    });
    expect((await asA(open)).map((r) => r.status)).toEqual(['accepted']);
    const statusOf = async () => {
      const [row] = await h.scratch.owner<{ status: string; worked: string }[]>`
        select status, sineobex.encounter_status(id) as worked from sineobex.encounters where id = ${encounterId}`;
      return row;
    };
    expect(await statusOf()).toEqual({ status: 'draft', worked: 'draft' });

    // Another phone's note create, under the team lock as its push takes it, not yet committed.
    const other = await h.scratch.owner.reserve();
    try {
      await other`begin`;
      await other`set local lock_timeout = '3s'`;
      await other`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${t.teamId}::uuid::text, 0))`;
      await other`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
        values (gen_random_uuid(), ${t.teamId}, ${encounterId}, 'wound_care', ${t.bId},
          '{"plan": "Demo: second look"}')`;
      const blank = await phoneA.change({
        entity: 'encounter_note',
        recordId: open.recordId,
        op: 'set',
        field: 'data.plan',
        value: '',
        baseVersion: 1,
      });
      const pushing = asA(blank);
      await pushWaitsForTeamLock();
      // What an encounter set does next under the team lock: the row. The push has not locked it.
      await other`select id from sineobex.encounters where id = ${encounterId} for no key update`;
      await other`commit`;
      expect(await pushing).toEqual([expect.objectContaining({ status: 'accepted', serverVersion: 2 })]);
    } finally {
      // After a failure, so the push it holds up and the tests after it are not stuck behind it.
      await other`rollback`.catch(() => {});
      other.release();
    }
    // The other phone's draft counts: the visit is still a draft.
    expect(await statusOf()).toEqual({ status: 'draft', worked: 'draft' });
  });

  it('two phones editing one encounter at once, one its location and one its patient, are both answered', async () => {
    const p1 = await createPatient(h, t.teamId, t.aId);
    const p2 = await createPatient(h, t.teamId, t.aId);
    const failedBefore = spy.lines.filter((l) => l.includes('sync.change_failed')).length;
    for (let i = 0; i < 20; i++) {
      const encounterId = await createEncounter(h, t.teamId, t.aId, p1.id);
      const location = await phoneA.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'location',
        value: { lat: 42.33, lng: -83.05 },
        baseVersion: 1,
      });
      const move = await phoneB.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'patientId',
        value: p2.id,
        baseVersion: 1,
      });
      const answered = await Promise.all([asA(location), asB(move)]);
      expect(answered.map((r) => r.map((x) => x.status))).toEqual([['accepted'], ['accepted']]);
    }
    expect(spy.lines.filter((l) => l.includes('sync.change_failed')).length).toBe(failedBefore);
  });

  it('merges and pushes naming the merged patient finish in either order, without a deadlock', async () => {
    for (let i = 0; i < 6; i++) {
      const survivor = await createPatient(h, t.teamId, t.aId);
      const merged = await createPatient(h, t.teamId, t.aId);
      const encounterId = await createEncounter(h, t.teamId, t.aId, null);
      const changes = [
        await phoneA.change({
          entity: 'encounter',
          op: 'create',
          value: { kind: 'medical', patientId: merged.id },
        }),
        await phoneA.change({
          entity: 'encounter',
          recordId: encounterId,
          op: 'set',
          field: 'patientId',
          value: merged.id,
          baseVersion: 1,
        }),
        await phoneA.change({
          entity: 'patient_allergy',
          op: 'create',
          value: { patientId: merged.id, substance: 'Demo dust' },
        }),
      ];
      const mergeRun = async () => (await openMerge(merged.id, survivor.id)).finish();
      const [first, second] = i % 2 === 0 ? [mergeRun(), asA(...changes)] : [asA(...changes), mergeRun()];
      const settled = await Promise.allSettled([first, second]);
      expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
      const pushed = (i % 2 === 0 ? settled[1] : settled[0]) as PromiseFulfilledResult<
        Awaited<ReturnType<typeof asA>>
      >;
      expect(pushed.value.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    }
  });

  it('two phones registering the same person at the same moment make exactly one pair', async () => {
    // The second intake's matching runs under the team lock the first released, so it sees it.
    const person = {
      preferredName: 'Delbert',
      legalName: { given: 'Delbert', family: 'Quillfeather' },
      birth: { precision: 'day', date: '1951-04-09' },
    };
    const a = await phoneA.change({ entity: 'patient', op: 'create', value: intakeValue(person) });
    const b = await phoneB.change({ entity: 'patient', op: 'create', value: intakeValue(person) });
    const [ra, rb] = await Promise.all([asA(a), asB(b)]);
    expect([ra![0]!.status, rb![0]!.status]).toEqual(['accepted', 'accepted']);
    const [pairs] = await h.scratch.owner<{ n: number }[]>`
      select count(*)::int as n from sineobex.duplicate_pairs
      where (patient_a, patient_b) in ((${a.recordId}, ${b.recordId}), (${b.recordId}, ${a.recordId}))`;
    expect(pairs!.n).toBe(1);
  });
});
