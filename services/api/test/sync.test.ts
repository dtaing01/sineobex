import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { valueHash } from '../src/sync/canonical.ts';
import { createHarness, type Harness } from './harness.ts';
import { call, FakePhone, push, register, results, setupTeam, type Team } from './sync-fixtures.ts';

describe('phase 2 sync: receipts, reconciliation, quarantine, devices', () => {
  let h: Harness;
  let t: Team;
  let phoneA: FakePhone;
  let phoneB: FakePhone;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
    phoneA = await FakePhone.create();
    phoneB = await FakePhone.create();
    await register(h, phoneA, t.aToken, t.teamId);
    await register(h, phoneB, t.bToken, t.teamId);
  });
  afterAll(() => h.close());

  const count = async (table: string, where = 'true') =>
    Number(
      (await h.scratch.owner.unsafe(`select count(*)::int as n from sineobex.${table} where ${where}`))[0]!.n,
    );

  const auditActions = async (prefix: string) => {
    const r = await call(h, '/v1/team/audit/search', {
      method: 'POST',
      token: t.adminToken,
      teamId: t.teamId,
      json: { actionPrefix: prefix, limit: 200 },
    });
    expect(r.status).toBe(200);
    return r.body.entries as {
      action: string;
      details: Record<string, unknown>;
      deviceTime: string | null;
    }[];
  };

  /** A draft encounter with one note on phone A, synced. Returns the IDs. */
  async function syncedDraft(data: Record<string, unknown> = {}) {
    const encounter = await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
    const note = await phoneA.change({
      entity: 'encounter_note',
      op: 'create',
      value: { encounterId: encounter.recordId, noteTypeKey: 'wound_care', data },
    });
    const r = await push(h, phoneA, t.aToken, t.teamId, [encounter, note]);
    expect(results(r.body).map((x) => x.status)).toEqual(['accepted', 'accepted']);
    return { encounterId: encounter.recordId, noteId: note.recordId };
  }

  describe('devices', () => {
    it('registers once per key; a retry is fine, a different key or person is refused', async () => {
      const phone = await FakePhone.create();
      expect((await register(h, phone, t.aToken, t.teamId)).status).toBe(201);
      expect((await register(h, phone, t.aToken, t.teamId)).status).toBe(200);
      const other = await FakePhone.create();
      const swapped = await call(h, '/v1/devices', {
        method: 'POST',
        token: t.aToken,
        teamId: t.teamId,
        json: {
          deviceId: phone.deviceId,
          platform: 'android',
          appVersion: '0.2.0',
          publicKey: other.publicKey,
        },
      });
      expect(swapped.status).toBe(409);
      const stolen = await call(h, '/v1/devices', {
        method: 'POST',
        token: t.bToken,
        teamId: t.teamId,
        json: {
          deviceId: phone.deviceId,
          platform: 'android',
          appVersion: '0.2.0',
          publicKey: phone.publicKey,
        },
      });
      expect(stolen.status).toBe(409);
    });

    it('refuses a push from a phone that is not registered to this person', async () => {
      const unknown = await FakePhone.create();
      const r = await push(h, unknown, t.aToken, t.teamId, []);
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe('device_not_registered');
      const notMine = await push(h, phoneB, t.aToken, t.teamId, []);
      expect(notMine.status).toBe(409);
    });
  });

  describe('confirmed receipts', () => {
    it('charting offline: a batch of creates gets one receipt each, with the server’s hash', async () => {
      const encounter = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', location: { lat: 42.33, lng: -83.05, accuracyM: 12 } },
        deviceTime: '2026-10-20T13:10:00.000Z',
        correctedTime: '2026-10-20T13:10:02.000Z',
      });
      const note = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: {
          encounterId: encounter.recordId,
          noteTypeKey: 'wound_care',
          data: { 'wound.site': 'left forearm' },
        },
      });
      const set = await phoneA.change({
        entity: 'encounter_note',
        recordId: note.recordId,
        op: 'set',
        field: 'data.wound.length_cm',
        value: 2.5,
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [encounter, note, set]);
      expect(r.status).toBe(200);
      const got = results(r.body);
      expect(got.map((x) => [x.status, x.serverVersion])).toEqual([
        ['accepted', 1],
        ['accepted', 1],
        ['accepted', 1],
      ]);
      expect(got.map((x) => x.hash)).toEqual([encounter.valueHash, note.valueHash, set.valueHash]);

      const [row] = await h.scratch.owner<
        { startedAt: Date; startedDeviceTime: Date; clockVerified: boolean }[]
      >`
        select started_at as "startedAt", started_device_time as "startedDeviceTime", clock_verified as "clockVerified"
        from sineobex.encounters where id = ${encounter.recordId}`;
      // Both times are kept: the corrected time is the record's time, the raw device time stays alongside.
      expect(row!.startedAt.toISOString()).toBe('2026-10-20T13:10:02.000Z');
      expect(row!.startedDeviceTime.toISOString()).toBe('2026-10-20T13:10:00.000Z');
      expect(row!.clockVerified).toBe(true);

      const created = await auditActions('note.');
      expect(created.some((e) => e.action === 'note.created' && e.details.changeId === note.changeId)).toBe(
        true,
      );
    });

    it('killing the app mid-sync: resending what the server already committed returns the same receipts', async () => {
      const encounter = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'non_medical' },
      });
      const audit = await phoneA.change({
        entity: 'audit',
        op: 'append',
        value: { action: 'patient.searched', resultCount: 3 },
      });
      const first = await push(h, phoneA, t.aToken, t.teamId, [encounter]);
      const auditBefore = await count('audit_events');
      // The app died before storing the receipt; it sends the same change again with one more.
      const again = await push(h, phoneA, t.aToken, t.teamId, [encounter, audit]);
      expect(results(again.body)[0]).toEqual(results(first.body)[0]);
      expect(results(again.body)[1]!.status).toBe('accepted');
      expect(await count('encounters', `id = '${encounter.recordId}'`)).toBe(1);
      // Only the new change was audited.
      expect(await count('audit_events')).toBe(auditBefore + 1);
      const third = await push(h, phoneA, t.aToken, t.teamId, [encounter, audit]);
      expect(results(third.body)).toEqual(results(again.body));
      expect(await count('audit_events')).toBe(auditBefore + 1);
    });

    it('a server failure mid-batch keeps order: nothing after the failure is processed', async () => {
      const ok = await phoneA.change({ entity: 'audit', op: 'append', value: { action: 'note.viewed' } });
      const failing = await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
      const after = await phoneA.change({ entity: 'audit', op: 'append', value: { action: 'note.viewed' } });
      await h.scratch.owner.unsafe('revoke insert on sineobex.field_history from sineobex_app');
      try {
        const r = await push(h, phoneA, t.aToken, t.teamId, [ok, failing, after]);
        expect(r.status).toBe(200);
        expect(results(r.body).map((x) => x.changeId)).toEqual([ok.changeId]);
      } finally {
        await h.scratch.owner.unsafe('grant insert on sineobex.field_history to sineobex_app');
      }
      const retry = await push(h, phoneA, t.aToken, t.teamId, [ok, failing, after]);
      expect(results(retry.body).map((x) => x.status)).toEqual(['accepted', 'accepted', 'accepted']);
      expect(await count('encounters', `id = '${failing.recordId}'`)).toBe(1);
    });

    it('a value that arrives with the wrong hash is not stored, so it can be sent again', async () => {
      const change = await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
      const damaged = { ...change, valueHash: await valueHash({ kind: 'non_medical' }) };
      const r = await push(h, phoneA, t.aToken, t.teamId, [damaged]);
      expect(results(r.body)[0]).toMatchObject({ status: 'rejected', reason: 'hash_mismatch' });
      expect(await count('sync_changes', `change_id = '${change.changeId}'`)).toBe(0);
      const fixed = await push(h, phoneA, t.aToken, t.teamId, [change]);
      expect(results(fixed.body)[0]).toMatchObject({ status: 'accepted', hash: change.valueHash });
    });

    it('offline reads join the audit chain with their device time', async () => {
      const read = await phoneA.change({
        entity: 'audit',
        op: 'append',
        value: { action: 'patient.viewed', entity: 'patient', entityId: randomUUID() },
        deviceTime: '2026-10-20T12:00:00.000Z',
      });
      await push(h, phoneA, t.aToken, t.teamId, [read]);
      const viewed = (await auditActions('patient.viewed')).find((e) => e.details.changeId === read.changeId);
      expect(viewed?.details.offline).toBe(true);
      expect(new Date(viewed!.deviceTime!).toISOString()).toBe('2026-10-20T12:00:00.000Z');
      const verify = await call(h, '/v1/team/audit/verify', {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: {},
      });
      expect(verify.body.ok).toBe(true);
    });
  });

  describe('rejections', () => {
    it('a rejected change is kept with its reason; the fix links to it and closes it', async () => {
      const bad = await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'telehealth' } });
      const r = await push(h, phoneA, t.aToken, t.teamId, [bad]);
      expect(results(r.body)[0]).toMatchObject({ status: 'rejected', reason: 'validation' });
      expect(results(r.body)[0]!.details?.problems).toBeDefined();

      const devices = async () =>
        (
          (await call(h, '/v1/team/devices', { token: t.adminToken, teamId: t.teamId })).body as unknown as {
            id: string;
            openRejections: number;
          }[]
        ).find((d) => d.id === phoneA.deviceId)!;
      expect((await devices()).openRejections).toBe(1);

      const fix = await phoneA.change({
        entity: 'encounter',
        recordId: bad.recordId,
        op: 'create',
        value: { kind: 'medical' },
        supersedes: bad.changeId,
      });
      const fixed = await push(h, phoneA, t.aToken, t.teamId, [fix]);
      expect(results(fixed.body)[0]!.status).toBe('accepted');
      expect((await devices()).openRejections).toBe(0);
      const actions = (await auditActions('sync.')).map((e) => e.action);
      expect(actions).toEqual(expect.arrayContaining(['sync.rejected', 'sync.rejection_fixed']));
    });

    it('values Postgres cannot store are lasting rejections, never a stuck queue', async () => {
      const { noteId } = await syncedDraft();
      const nul = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.a',
        value: 'x\u0000y',
      });
      const lone = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.b',
        value: 'x\ud800',
      });
      const fine = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.c',
        value: 'ok',
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [nul, lone, fine]);
      expect(results(r.body).map((x) => [x.status, x.details?.problem])).toEqual([
        ['rejected', 'unstorable_value'],
        ['rejected', 'unstorable_value'],
        ['accepted', undefined],
      ]);
    });

    it('fixing a rejected create also settles the edits that were rejected with it', async () => {
      const note = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId: randomUUID(), noteTypeKey: 'wound_care' },
      });
      const edit = await phoneA.change({
        entity: 'encounter_note',
        recordId: note.recordId,
        op: 'set',
        field: 'data.plan',
        value: 'rest',
        follows: note.changeId,
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [note, edit]);
      expect(results(r.body).map((x) => x.reason)).toEqual(['stale_reference', 'stale_reference']);
      const { encounterId } = await syncedDraft();
      const fix = await phoneA.change({
        entity: 'encounter_note',
        recordId: note.recordId,
        op: 'create',
        value: { encounterId, noteTypeKey: 'wound_care', data: { plan: 'rest' } },
        supersedes: note.changeId,
      });
      expect(results((await push(h, phoneA, t.aToken, t.teamId, [fix])).body)[0]!.status).toBe('accepted');
      const open = await count(
        'sync_changes',
        `record_id = '${note.recordId}' and status = 'rejected' and resolved_by_change is null`,
      );
      expect(open).toBe(0);
    });

    it('a note for an encounter the server doesn’t have is a stale reference', async () => {
      const note = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId: randomUUID(), noteTypeKey: 'wound_care' },
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [note]);
      expect(results(r.body)[0]).toMatchObject({ status: 'rejected', reason: 'stale_reference' });
    });

    it('a note has at most 300 data fields, at create and as fields are added', async () => {
      // Review finding: 6,400 keys per note made one push write ~96,000 permanent history rows.
      const tooMany = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`f${i}`, i]));
      const { encounterId } = await syncedDraft();
      const big = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId, noteTypeKey: 'vitals', data: tooMany },
      });
      expect(results((await push(h, phoneA, t.aToken, t.teamId, [big])).body)[0]).toMatchObject({
        status: 'rejected',
        reason: 'validation',
      });
      const full = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, i]));
      const ok = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId, noteTypeKey: 'vitals', data: full },
      });
      const change = (field: string) =>
        phoneA.change({
          entity: 'encounter_note',
          recordId: ok.recordId,
          op: 'set',
          field,
          value: 1,
          baseVersion: 1,
        });
      const r = await push(h, phoneA, t.aToken, t.teamId, [
        ok,
        await change('data.f0'),
        await change('data.f300'),
      ]);
      expect(results(r.body).map((x) => [x.status, x.details?.problem])).toEqual([
        ['accepted', undefined],
        ['accepted', undefined],
        ['rejected', 'too_many_fields'],
      ]);
    });

    it('a signed note refuses changes', async () => {
      const { noteId } = await syncedDraft({ plan: 'dress daily' });
      await h.scratch.owner`update sineobex.encounter_notes set status = 'signed' where id = ${noteId}`;
      const change = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.plan',
        value: 'x',
        baseVersion: 1,
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [change]);
      expect(results(r.body)[0]).toMatchObject({ status: 'rejected', reason: 'record_locked' });
    });

    it('a field outside the record’s fields, or a status of signed, is a validation error', async () => {
      const { encounterId } = await syncedDraft();
      const unknownField = await phoneA.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'kind',
        value: 'non_medical',
        baseVersion: 1,
      });
      const signed = await phoneA.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'status',
        value: 'signed',
        baseVersion: 1,
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [unknownField, signed]);
      expect(results(r.body).map((x) => x.reason)).toEqual(['validation', 'validation']);
    });
  });

  describe('two people editing the same draft (Oct 19 reconciliation rule)', () => {
    async function snapshotOf(token: string, noteId: string) {
      const r = await call(h, '/v1/sync/records', {
        method: 'POST',
        token,
        teamId: t.teamId,
        json: { records: [{ entity: 'encounter_note', id: noteId }] },
      });
      expect(r.status).toBe(200);
      return (
        r.body.records as {
          fields: Record<string, { value: unknown; version: number; changedBy: string | null }>;
        }[]
      )[0]!;
    }

    it('different fields merge; a blank server field fills in; the same field with a different value conflicts', async () => {
      const { noteId } = await syncedDraft({ allergies_note: '' });
      const seen = await snapshotOf(t.bToken, noteId);
      expect(seen.fields['data.allergies_note']).toMatchObject({ value: '', version: 1 });

      const aTemp = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 38.2,
      });
      const aAllergy = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.allergies_note',
        value: 'penicillin',
        baseVersion: 1,
      });
      await push(h, phoneA, t.aToken, t.teamId, [aTemp, aAllergy]);

      // B edited offline from the copy it fetched earlier.
      const bTemp = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.0,
      });
      const bPlan = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.plan',
        value: 'recheck in 2 days',
      });
      const bSame = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.allergies_note',
        value: 'penicillin',
        baseVersion: 1,
      });
      const r = await push(h, phoneB, t.bToken, t.teamId, [bTemp, bPlan, bSame]);
      const [temp, plan, same] = results(r.body);
      expect(temp).toMatchObject({
        status: 'conflict',
        server: { value: 38.2, version: 1, changedBy: t.aId },
      });
      expect(plan).toMatchObject({ status: 'accepted', serverVersion: 1 });
      // Already the server's value: accepted without a new version.
      expect(same).toMatchObject({ status: 'accepted', serverVersion: 2 });

      // A third phone fills a field A left blank, without having seen A's version.
      const blank = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.followup',
        value: '',
      });
      await push(h, phoneA, t.aToken, t.teamId, [blank]);
      const fill = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.followup',
        value: 'clinic Friday',
      });
      const filled = await push(h, phoneB, t.bToken, t.teamId, [fill]);
      expect(results(filled.body)[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      const history = await h.scratch.owner<{ kind: string }[]>`
        select kind from sineobex.field_history where record_id = ${noteId} and field = 'data.followup' order by version`;
      expect(history.map((x) => x.kind)).toEqual(['set', 'filled_blank']);

      // Retrying the conflicted change shows the server's current value again.
      const retried = await push(h, phoneB, t.bToken, t.teamId, [bTemp]);
      expect(results(retried.body)[0]).toMatchObject({ status: 'conflict', server: { value: 38.2 } });
    });

    it('choosing my value replaces the server’s, logging the replaced value and who approved it', async () => {
      const { noteId } = await syncedDraft({ temp_c: 38.2 });
      const mine = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
      });
      const conflicted = results((await push(h, phoneB, t.bToken, t.teamId, [mine])).body)[0]!;
      expect(conflicted.status).toBe('conflict');

      const choice = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
        baseVersion: conflicted.server!.version,
        conflictOf: mine.changeId,
        resolution: 'replace',
      });
      const r = await push(h, phoneB, t.bToken, t.teamId, [choice]);
      expect(results(r.body)[0]).toMatchObject({ status: 'accepted', serverVersion: 2 });
      const [entry] = await h.scratch.owner<
        { kind: string; value: unknown; previousValue: unknown; approvedBy: string }[]
      >`
        select kind, value, previous_value as "previousValue", approved_by as "approvedBy"
        from sineobex.field_history where record_id = ${noteId} and field = 'data.temp_c' and version = 2`;
      expect(entry).toEqual({
        kind: 'replaced_after_review',
        value: 39.1,
        previousValue: 38.2,
        approvedBy: t.bId,
      });
      const [receipt] = await h.scratch.owner<{ resolvedBy: string }[]>`
        select resolved_by_change as "resolvedBy" from sineobex.sync_changes where change_id = ${mine.changeId}`;
      expect(receipt!.resolvedBy).toBe(choice.changeId);
    });

    it('a resolution against a value that changed again is a new conflict', async () => {
      const { noteId } = await syncedDraft({ temp_c: 38.2 });
      const mine = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
      });
      await push(h, phoneB, t.bToken, t.teamId, [mine]);
      const aAgain = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 38.5,
        baseVersion: 1,
      });
      await push(h, phoneA, t.aToken, t.teamId, [aAgain]);
      const stale = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
        baseVersion: 1,
        conflictOf: mine.changeId,
        resolution: 'replace',
      });
      const r = await push(h, phoneB, t.bToken, t.teamId, [stale]);
      expect(results(r.body)[0]).toMatchObject({ status: 'conflict', server: { value: 38.5, version: 2 } });
    });

    it('keeping the server’s value keeps both in history and tells the note’s author', async () => {
      const { noteId } = await syncedDraft({ temp_c: 38.2 });
      const mine = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
      });
      await push(h, phoneB, t.bToken, t.teamId, [mine]);
      const keep = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
        baseVersion: 1,
        conflictOf: mine.changeId,
        resolution: 'keep_server',
      });
      const r = await push(h, phoneB, t.bToken, t.teamId, [keep]);
      expect(results(r.body)[0]).toMatchObject({
        status: 'accepted',
        serverVersion: 1,
        hash: keep.valueHash,
      });
      const snap = await snapshotOf(t.aToken, noteId);
      expect(snap.fields['data.temp_c']).toMatchObject({ value: 38.2, version: 1 });
      const [kept] = await h.scratch.owner<{ value: unknown; previousValue: unknown }[]>`
        select value, previous_value as "previousValue" from sineobex.field_history
        where record_id = ${noteId} and kind = 'kept_both'`;
      expect(kept).toEqual({ value: 39.1, previousValue: 38.2 });

      const notices = await call(h, '/v1/team/notices', { token: t.aToken, teamId: t.teamId });
      const notice = (notices.body as unknown as { id: string; kind: string; recordId: string }[]).find(
        (n) => n.recordId === noteId,
      );
      expect(notice?.kind).toBe('conflict_resolved');
      expect(
        (
          await call(h, `/v1/team/notices/${notice!.id}/read`, {
            method: 'POST',
            token: t.aToken,
            teamId: t.teamId,
          })
        ).status,
      ).toBe(200);
      // Someone else's notice is not theirs to mark.
      expect(
        (
          await call(h, `/v1/team/notices/${notice!.id}/read`, {
            method: 'POST',
            token: t.bToken,
            teamId: t.teamId,
          })
        ).status,
      ).toBe(404);
    });

    it('keeping a server value that changed again since is a new conflict, and nothing is logged as kept', async () => {
      // Review finding: keep_server was accepted against any version, so a value the person never
      // saw was recorded as the one they approved, and their next edit overwrote it silently.
      const { noteId } = await syncedDraft({ temp_c: 38.2 });
      const mine = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
      });
      await push(h, phoneB, t.bToken, t.teamId, [mine]);
      const aAgain = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 38.8,
        baseVersion: 1,
      });
      await push(h, phoneA, t.aToken, t.teamId, [aAgain]);
      const keep = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.temp_c',
        value: 39.1,
        baseVersion: 1,
        conflictOf: mine.changeId,
        resolution: 'keep_server',
      });
      const r = await push(h, phoneB, t.bToken, t.teamId, [keep]);
      expect(results(r.body)[0]).toMatchObject({ status: 'conflict', server: { value: 38.8, version: 2 } });
      expect(await count('field_history', `record_id = '${noteId}' and kind = 'kept_both'`)).toBe(0);
    });

    it('a second offline edit to the same field builds on the first instead of conflicting with it', async () => {
      const { noteId } = await syncedDraft();
      const first = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.plan',
        value: 'rest',
      });
      const second = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.plan',
        value: 'rest and fluids',
        follows: first.changeId,
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [first, second]);
      expect(results(r.body).map((x) => [x.status, x.serverVersion])).toEqual([
        ['accepted', 1],
        ['accepted', 2],
      ]);
      // An edit to a field the create filled, made before the create was confirmed, builds on it.
      const created = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: {
          encounterId: (await syncedDraft()).encounterId,
          noteTypeKey: 'wound_care',
          data: { temp_c: 38 },
        },
      });
      const edited = await phoneA.change({
        entity: 'encounter_note',
        recordId: created.recordId,
        op: 'set',
        field: 'data.temp_c',
        value: 38.4,
        follows: created.changeId,
      });
      const both = await push(h, phoneA, t.aToken, t.teamId, [created, edited]);
      expect(results(both.body).map((x) => [x.status, x.serverVersion])).toEqual([
        ['accepted', 1],
        ['accepted', 2],
      ]);
      // Someone else's change can't be "followed".
      const sneaky = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.plan',
        value: 'other',
        follows: second.changeId,
      });
      expect(results((await push(h, phoneB, t.bToken, t.teamId, [sneaky])).body)[0]!.status).toBe('conflict');
    });

    it('concurrent pushes to one field are applied one after the other', async () => {
      const { noteId } = await syncedDraft();
      const fromA = await phoneA.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.pulse',
        value: 80,
      });
      const fromB = await phoneB.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field: 'data.pulse',
        value: 92,
      });
      const [ra, rb] = await Promise.all([
        push(h, phoneA, t.aToken, t.teamId, [fromA]),
        push(h, phoneB, t.bToken, t.teamId, [fromB]),
      ]);
      const statuses = [results(ra.body)[0]!.status, results(rb.body)[0]!.status].sort();
      expect(statuses).toEqual(['accepted', 'conflict']);
    });
  });

  describe('clock check', () => {
    it('a phone 7 minutes off is flagged once, and unflagged when its clock is right again', async () => {
      const behind = new Date(h.clock.now.getTime() - 7 * 60_000).toISOString();
      const r = await push(h, phoneA, t.aToken, t.teamId, [], { deviceTime: behind });
      expect(r.body.clock).toEqual({ offsetMs: 7 * 60_000, flagged: true });
      await push(h, phoneA, t.aToken, t.teamId, [], { deviceTime: behind });
      const flagged = (await auditActions('device.clock_flagged')).filter(
        (e) => e.details.offsetMs === 420_000,
      );
      expect(flagged).toHaveLength(1);

      const listed = async () =>
        (
          (await call(h, '/v1/team/devices', { token: t.adminToken, teamId: t.teamId })).body as unknown as {
            id: string;
            clockFlagged: boolean;
            clockOffsetMs: number;
          }[]
        ).find((d) => d.id === phoneA.deviceId)!;
      expect(await listed()).toMatchObject({ clockFlagged: true, clockOffsetMs: 420_000 });
      // Work waiting on the phone for more than a day is flagged.
      await push(h, phoneA, t.aToken, t.teamId, [], {
        deviceTime: behind,
        counts: { notes: 1 },
        oldest: new Date(h.clock.now.getTime() - 25 * 60 * 60_000).toISOString(),
      });
      expect(await listed()).toMatchObject({ unsyncedStale: true });
      const right = await push(h, phoneA, t.aToken, t.teamId, []);
      expect(right.body.clock).toEqual({ offsetMs: 0, flagged: false });
      expect((await listed()).clockFlagged).toBe(false);
    });
  });

  describe('clock claims', () => {
    it('a push measured more than 5 minutes off stores none of its times as verified', async () => {
      const ahead = new Date(h.clock.now.getTime() + 10 * 60_000).toISOString();
      const enc = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical' },
        deviceTime: ahead,
        correctedTime: ahead,
        clockVerified: true,
      });
      const r = await push(h, phoneA, t.aToken, t.teamId, [enc], { deviceTime: ahead });
      expect(r.body.clock).toMatchObject({ flagged: true });
      expect(results(r.body)[0]!.status).toBe('accepted');
      const [row] = await h.scratch.owner<{ clockVerified: boolean }[]>`
        select clock_verified as "clockVerified" from sineobex.encounters where id = ${enc.recordId}`;
      expect(row!.clockVerified).toBe(false);
      // The next push on a right clock clears the flag again.
      await push(h, phoneA, t.aToken, t.teamId, []);
    });
  });

  describe('audit attribution', () => {
    it('record reads name a phone only when it is the reader’s own', async () => {
      const { noteId } = await syncedDraft();
      const read = (deviceId: string) =>
        call(h, '/v1/sync/records', {
          method: 'POST',
          token: t.aToken,
          teamId: t.teamId,
          deviceId,
          json: { records: [{ entity: 'encounter_note', id: noteId }] },
        });
      expect((await read(phoneB.deviceId)).status).toBe(200);
      expect((await read(phoneA.deviceId)).status).toBe(200);
      const rows = await h.scratch.owner<{ deviceId: string | null }[]>`
        select device_id as "deviceId" from sineobex.audit_events
        where action = 'note.viewed' and entity_id = ${noteId} and actor_user_id = ${t.aId}
        order by seq desc limit 2`;
      // Newest first: A's own phone is named; B's phone, claimed in the header, is not.
      expect(rows.map((r) => r.deviceId)).toEqual([phoneA.deviceId, null]);
    });
  });

  describe('permission and quarantine', () => {
    it('a change the person may no longer make goes to quarantine; an admin accepts it onto the chart', async () => {
      const phone = await FakePhone.create();
      await register(h, phone, t.chwToken, t.teamId);
      const encounter = await phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'non_medical' },
      });
      const r = await push(h, phone, t.chwToken, t.teamId, [encounter]);
      expect(results(r.body)[0]).toMatchObject({
        status: 'rejected',
        reason: 'permission',
        quarantined: true,
        hash: encounter.valueHash,
      });
      expect(await count('encounters', `id = '${encounter.recordId}'`)).toBe(0);

      const queue = await call(h, '/v1/team/quarantine', { token: t.adminToken, teamId: t.teamId });
      const item = (
        queue.body as unknown as { id: string; changeId: string; reason: string; value: unknown }[]
      ).find((i) => i.changeId === encounter.changeId)!;
      expect(item).toMatchObject({ reason: 'permission', value: { kind: 'non_medical' } });

      // Without quarantine.review the queue is refused.
      expect((await call(h, '/v1/team/quarantine', { token: t.aToken, teamId: t.teamId })).status).toBe(403);

      const decided = await call(h, `/v1/team/quarantine/${item.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Visit confirmed with Sam' },
      });
      expect(decided.status).toBe(200);
      const [enc] = await h.scratch.owner<{ authorUserId: string }[]>`
        select author_user_id as "authorUserId" from sineobex.encounters where id = ${encounter.recordId}`;
      expect(enc!.authorUserId).toBe(t.chwId);
      const again = await push(h, phone, t.chwToken, t.teamId, [encounter]);
      expect(results(again.body)[0]).toMatchObject({ status: 'accepted', hash: encounter.valueHash });
      const twice = await call(h, `/v1/team/quarantine/${item.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'reject', reason: 'second try' },
      });
      expect(twice.status).toBe(409);
    });

    it('nobody decides on their own quarantined change, and nobody else can take its ID', async () => {
      // Review finding: a custom role with quarantine.review but no charting could accept its
      // own change onto the chart.
      const role = await call(h, '/v1/team/roles', {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { name: 'Data reviewer', permissions: ['patients.view', 'quarantine.review'] },
      });
      expect(role.status).toBe(201);
      const invited = await call(h, '/v1/team/members', {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: {
          email: 'reviewer@example.com',
          displayName: 'Robin (demo)',
          roleId: role.body.id,
          credential: 'none',
        },
      });
      expect(invited.status).toBe(201);
      const [reviewer] = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.users where email = 'reviewer@example.com'`;
      const reviewerId = reviewer!.id;
      await h.acknowledge(reviewerId);
      const reviewerToken = await h.tokenFor('reviewer@example.com');
      const phone = await FakePhone.create();
      await register(h, phone, reviewerToken, t.teamId);
      const patientId = randomUUID();
      const own = await phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', patientId },
      });
      expect(results((await push(h, phone, reviewerToken, t.teamId, [own])).body)[0]).toMatchObject({
        reason: 'permission',
        quarantined: true,
      });

      // A teammate pushing a change under that ID is told the ID is taken.
      const taken = {
        ...(await phoneB.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } })),
      };
      taken.changeId = own.changeId;
      expect(results((await push(h, phoneB, t.bToken, t.teamId, [taken])).body)[0]).toMatchObject({
        status: 'rejected',
        details: { problem: 'change_id_reused' },
      });

      const queue = await call(h, '/v1/team/quarantine', { token: reviewerToken, teamId: t.teamId });
      const item = (queue.body as unknown as { id: string; changeId: string }[]).find(
        (i) => i.changeId === own.changeId,
      )!;
      // Seeing it is logged with the patient it is about.
      expect(
        await count('audit_events', `action = 'quarantine.item_viewed' and patient_id = '${patientId}'`),
      ).toBeGreaterThan(0);
      const self = await call(h, `/v1/team/quarantine/${item.id}/decision`, {
        method: 'POST',
        token: reviewerToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Mine, and fine' },
      });
      expect(self.status).toBe(403);
      expect(self.body.error?.code).toBe('own_change');
      expect(await count('encounters', `id = '${own.recordId}'`)).toBe(0);
      expect(
        await count(
          'audit_events',
          `action = 'access.denied' and actor_user_id = '${reviewerId}' and details->>'itemId' = '${item.id}'`,
        ),
      ).toBe(1);
      const byAdmin = await call(h, `/v1/team/quarantine/${item.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Confirmed with Robin' },
      });
      expect(byAdmin.status).toBe(200);
      expect(await count('encounters', `id = '${own.recordId}'`)).toBe(1);
    });

    it('an admin decision needs a recent sign-in', async () => {
      const stale = await h.tokenFor('admin@example.com', {
        authTime: new Date(h.clock.now.getTime() - 60 * 60_000),
      });
      const r = await call(h, `/v1/team/quarantine/${randomUUID()}/decision`, {
        method: 'POST',
        token: stale,
        teamId: t.teamId,
        json: { decision: 'reject', reason: 'not needed' },
      });
      expect(r.body.error?.code).toBe('reauth_required');
    });
  });

  describe('remote wipe and signed device requests', () => {
    it('after a wipe request the phone gets no more changes applied and is told to wipe', async () => {
      const phone = await FakePhone.create();
      await register(h, phone, t.bToken, t.teamId);
      await push(h, phone, t.bToken, t.teamId, [], { counts: { encounters: 4 } });
      const wipe = await call(h, `/v1/team/devices/${phone.deviceId}/wipe`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { reason: 'Phone reported stolen' },
      });
      expect(wipe.status).toBe(200);
      const requested = (await auditActions('device.wipe_requested')).find(
        (e) => e.details.reason === 'Phone reported stolen',
      );
      expect(requested?.details.unsyncedCounts).toEqual({ encounters: 4 });

      const change = await phone.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
      const r = await push(h, phone, t.bToken, t.teamId, [change]);
      expect(r.body).toMatchObject({ results: [], device: { status: 'wipe_requested' } });
      expect(await count('encounters', `id = '${change.recordId}'`)).toBe(0);

      const status = await call(h, `/v1/devices/${phone.deviceId}/status`, {
        method: 'POST',
        json: await phone.signed({
          purpose: 'status',
          deviceId: phone.deviceId,
          sentAt: h.clock.now.toISOString(),
        }),
      });
      expect(status.body).toMatchObject({ status: 'wipe_requested', access: 'active' });
      const wiped = await call(h, `/v1/devices/${phone.deviceId}/wiped`, {
        method: 'POST',
        json: await phone.signed({
          purpose: 'wiped',
          deviceId: phone.deviceId,
          wipedAt: h.clock.now.toISOString(),
        }),
      });
      expect(wiped.status).toBe(200);
      expect((await auditActions('device.wiped')).length).toBeGreaterThan(0);
    });

    it('signed requests are refused with a wrong key, a wrong purpose or another device’s ID', async () => {
      const stranger = await FakePhone.create();
      const payload = { purpose: 'status', deviceId: phoneA.deviceId, sentAt: h.clock.now.toISOString() };
      const wrongKey = await call(h, `/v1/devices/${phoneA.deviceId}/status`, {
        method: 'POST',
        json: { payload, signature: await stranger.sign(payload) },
      });
      expect(wrongKey.status).toBe(401);
      // A status request replayed at another endpoint fails its schema...
      const replayed = await call(h, `/v1/devices/${phoneA.deviceId}/wiped`, {
        method: 'POST',
        json: await phoneA.signed({ ...payload, wipedAt: payload.sentAt }),
      });
      expect(replayed.status).toBe(422);
      // ...and a status signature can't be reused on a well-formed wipe report.
      const reused = await call(h, `/v1/devices/${phoneA.deviceId}/wiped`, {
        method: 'POST',
        json: {
          payload: { purpose: 'wiped', deviceId: phoneA.deviceId, wipedAt: payload.sentAt },
          signature: await phoneA.sign(payload),
        },
      });
      expect(reused.status).toBe(401);
      const otherDevice = await call(h, `/v1/devices/${phoneB.deviceId}/status`, {
        method: 'POST',
        json: await phoneA.signed(payload),
      });
      expect(otherDevice.status).toBe(401);
      const tampered = await phoneA.signed(payload);
      const changed = await call(h, `/v1/devices/${phoneA.deviceId}/status`, {
        method: 'POST',
        json: { ...tampered, payload: { ...payload, sentAt: '2020-01-01T00:00:00.000Z' } },
      });
      expect(changed.status).toBe(401);
    });

    it('a phone whose user can still sync is told to use sync, not quarantine', async () => {
      const change = await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
      const r = await call(h, `/v1/devices/${phoneA.deviceId}/quarantine`, {
        method: 'POST',
        json: await phoneA.signed({ purpose: 'quarantine', deviceId: phoneA.deviceId, changes: [change] }),
      });
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe('use_sync');
    });

    it('removed while offline: the phone hands its unsynced work to quarantine, then confirms its wipe', async () => {
      // Runs last in this file: it removes clinician A.
      const pending = await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
      // A note rejected at push (its encounter was refused, then fixed) is quarantined unfixed.
      const badEncounter = await phoneA.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', location: { lat: 42.3, lng: -83, accuracyM: -1 } },
      });
      const orphan = await phoneA.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId: badEncounter.recordId, noteTypeKey: 'vitals', data: { temp_c: 38.4 } },
      });
      const first = await push(h, phoneA, t.aToken, t.teamId, [badEncounter, orphan]);
      expect(results(first.body).map((x) => x.reason)).toEqual(['validation', 'stale_reference']);
      const fixedEncounter = await phoneA.change({
        entity: 'encounter',
        recordId: badEncounter.recordId,
        op: 'create',
        value: { kind: 'medical', location: { lat: 42.3, lng: -83 } },
        supersedes: badEncounter.changeId,
      });
      expect(results((await push(h, phoneA, t.aToken, t.teamId, [fixedEncounter])).body)[0]!.status).toBe(
        'accepted',
      );

      const removed = await call(h, `/v1/team/members/${t.aMembershipId}/remove`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { reason: 'Left the program' },
      });
      expect(removed.status).toBe(200);
      const refused = await push(h, phoneA, t.aToken, t.teamId, [pending]);
      expect(refused.status).toBe(403);

      const status = await call(h, `/v1/devices/${phoneA.deviceId}/status`, {
        method: 'POST',
        json: await phoneA.signed({
          purpose: 'status',
          deviceId: phoneA.deviceId,
          sentAt: h.clock.now.toISOString(),
        }),
      });
      expect(status.body).toMatchObject({ status: 'active', access: 'removed' });

      // An offline chart view, handed over with the rest (review finding: it was quarantined,
      // so it never joined the audit chain as the person's).
      const viewedPatient = randomUUID();
      const viewed = await phoneA.change({
        entity: 'audit',
        op: 'append',
        value: {
          action: 'patient.viewed',
          entity: 'patient',
          entityId: viewedPatient,
          patientId: viewedPatient,
        },
      });
      const uploaded = await call(h, `/v1/devices/${phoneA.deviceId}/quarantine`, {
        method: 'POST',
        json: await phoneA.signed({
          purpose: 'quarantine',
          deviceId: phoneA.deviceId,
          changes: [pending, orphan, viewed],
        }),
      });
      expect(uploaded.status).toBe(200);
      expect(uploaded.body.results).toEqual([
        { changeId: pending.changeId, status: 'quarantined', hash: pending.valueHash },
        { changeId: orphan.changeId, status: 'quarantined', hash: orphan.valueHash },
        { changeId: viewed.changeId, status: 'recorded', hash: viewed.valueHash },
      ]);
      const reads = await h.scratch.owner<{ actor: string; deviceId: string; afterRemoval: unknown }[]>`
        select actor_user_id as actor, device_id as "deviceId", details->'afterRemoval' as "afterRemoval"
        from sineobex.audit_events where action = 'patient.viewed' and patient_id = ${viewedPatient}`;
      expect(reads).toEqual([{ actor: t.aId, deviceId: phoneA.deviceId, afterRemoval: true }]);
      expect(await count('quarantine_items', `change_id = '${viewed.changeId}'`)).toBe(0);
      // Sent again, it is recorded once.
      await call(h, `/v1/devices/${phoneA.deviceId}/quarantine`, {
        method: 'POST',
        json: await phoneA.signed({ purpose: 'quarantine', deviceId: phoneA.deviceId, changes: [viewed] }),
      });
      expect(
        await count('audit_events', `action = 'patient.viewed' and patient_id = '${viewedPatient}'`),
      ).toBe(1);

      // A phone can't flood the review queue.
      await h.scratch.owner`
        insert into sineobex.quarantine_items
          (team_id, device_id, user_id, change_id, entity, record_id, op, value, value_hash, details, device_time, reason)
        select ${t.teamId}, ${phoneA.deviceId}, ${t.aId}, gen_random_uuid(), 'encounter', gen_random_uuid(), 'create',
               '{"kind":"medical"}'::jsonb, repeat('0', 64), '{}'::jsonb, now(), 'access_removed'
        from generate_series(1, 4999)`;
      const flood = await call(h, `/v1/devices/${phoneA.deviceId}/quarantine`, {
        method: 'POST',
        json: await phoneA.signed({
          purpose: 'quarantine',
          deviceId: phoneA.deviceId,
          changes: [await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } })],
        }),
      });
      expect(flood.status).toBe(409);
      expect(flood.body.error?.code).toBe('quarantine_full');
      await h.scratch.owner`
        delete from sineobex.quarantine_items where device_id = ${phoneA.deviceId} and value_hash = ${'0'.repeat(64)}`;
      // Sending it twice stores it once.
      await call(h, `/v1/devices/${phoneA.deviceId}/quarantine`, {
        method: 'POST',
        json: await phoneA.signed({ purpose: 'quarantine', deviceId: phoneA.deviceId, changes: [pending] }),
      });
      expect(await count('quarantine_items', `change_id = '${pending.changeId}'`)).toBe(1);
      expect(await count('encounters', `id = '${pending.recordId}'`)).toBe(0);

      const queue = await call(h, '/v1/team/quarantine', { token: t.adminToken, teamId: t.teamId });
      const item = (queue.body as unknown as { id: string; changeId: string; reason: string }[]).find(
        (i) => i.changeId === pending.changeId,
      )!;
      expect(item.reason).toBe('access_removed');
      const rejected = await call(h, `/v1/team/quarantine/${item.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'reject', reason: 'Duplicate of the clinic note' },
      });
      expect(rejected.status).toBe(200);
      expect(queue.body as unknown as { changeId: string }[]).not.toContainEqual(
        expect.objectContaining({ changeId: viewed.changeId }),
      );

      // Review finding: its rejection at push used to block the accept ("already reached the
      // chart"), so the admin could only throw the note away.
      const orphanItem = (queue.body as unknown as { id: string; changeId: string }[]).find(
        (i) => i.changeId === orphan.changeId,
      )!;
      const accepted = await call(h, `/v1/team/quarantine/${orphanItem.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Vitals confirmed with Alex' },
      });
      expect(accepted.status).toBe(200);
      expect(await count('encounter_notes', `id = '${orphan.recordId}'`)).toBe(1);
      expect(await count('sync_changes', `change_id = '${orphan.changeId}' and status = 'accepted'`)).toBe(1);

      // An old signed status request, replayed, is answered but doesn't make the phone look seen.
      const [{ seenBefore } = { seenBefore: null }] = await h.scratch.owner<{ seenBefore: Date | null }[]>`
        select last_seen_at as "seenBefore" from sineobex.devices where id = ${phoneA.deviceId}`;
      h.clock.advance(60_000);
      const replay = await call(h, `/v1/devices/${phoneA.deviceId}/status`, {
        method: 'POST',
        json: await phoneA.signed({
          purpose: 'status',
          deviceId: phoneA.deviceId,
          sentAt: '2025-01-01T00:00:00.000Z',
        }),
      });
      expect(replay.status).toBe(200);
      const [{ seenAfter } = { seenAfter: null }] = await h.scratch.owner<{ seenAfter: Date | null }[]>`
        select last_seen_at as "seenAfter" from sineobex.devices where id = ${phoneA.deviceId}`;
      expect(seenAfter).toEqual(seenBefore);

      // Once an admin asks to wipe it, the phone's key hands nothing more over.
      const wipe = await call(h, `/v1/team/devices/${phoneA.deviceId}/wipe`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { reason: 'Left the program' },
      });
      expect(wipe.status).toBe(200);
      const late = await call(h, `/v1/devices/${phoneA.deviceId}/quarantine`, {
        method: 'POST',
        json: await phoneA.signed({
          purpose: 'quarantine',
          deviceId: phoneA.deviceId,
          changes: [await phoneA.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } })],
        }),
      });
      expect(late.status).toBe(409);
      expect(late.body.error?.code).toBe('wipe_requested');

      const wiped = await call(h, `/v1/devices/${phoneA.deviceId}/wiped`, {
        method: 'POST',
        json: await phoneA.signed({
          purpose: 'wiped',
          deviceId: phoneA.deviceId,
          wipedAt: h.clock.now.toISOString(),
        }),
      });
      expect(wiped.status).toBe(200);
      const list = (await call(h, '/v1/team/devices', { token: t.adminToken, teamId: t.teamId }))
        .body as unknown as {
        id: string;
        status: string;
      }[];
      expect(list.find((d) => d.id === phoneA.deviceId)?.status).toBe('wiped');
    });
  });
});
