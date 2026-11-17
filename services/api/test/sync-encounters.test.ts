import { randomUUID } from 'node:crypto';
import { canonicalJson, checkAnswer, sha256Hex, validate, type ResolvedNoteType } from '@sineobex/forms';
import { checkFile } from '@sineobex/forms/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/db/database.ts';
import { chartsMedical, credentialChangesAfter, loadSigner } from '../src/encounters/signer.ts';
import { takesTeamLock } from '../src/sync/entities/index.ts';
import { MAX_NOTE_FIELDS } from '../src/sync/records.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, createTeam, expectAudit } from './patient-fixtures.ts';
import {
  addMember,
  call,
  CREDENTIAL_FIELDS,
  FakePhone,
  installNoteTypes,
  push,
  register,
  results,
  secondTeam,
  setupTeam,
  TEST_MEDICAL,
  TEST_NOTE,
  TEST_NOTE_TYPES,
  type Team,
} from './sync-fixtures.ts';

type Change = Awaited<ReturnType<FakePhone['change']>>;

// Phase 4's sync rules for encounters and notes (lifecycle 4), each held by a case here. Every
// person and value is made up.

describe('phase 4 sync: encounters and notes', () => {
  let h: Harness;
  let t: Team;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
  });
  afterAll(() => h.close());

  /** A transaction as a request of the team runs one: the app's role, the team's scope. */
  const inTeam = <T>(fn: (tx: Tx) => Promise<T>) => h.db.tx({ teamId: t.teamId, userId: t.adminId }, fn);
  /** One that row-level security lets see every team: the team filter is the query's own. */
  const acrossTeams = <T>(fn: (tx: Tx) => Promise<T>) => h.db.tx({ platform: true }, fn);

  /** A member with a credential, and a phone registered to them. */
  async function clinician(email: string, displayName: string, credential: Parameters<typeof addMember>[5]) {
    const member = await addMember(h, t, email, displayName, 'healthcare_staff', credential);
    const phone = await FakePhone.create();
    await register(h, phone, member.token, t.teamId);
    const send = async (...changes: Change[]) =>
      results((await push(h, phone, member.token, t.teamId, changes)).body);
    return { ...member, phone, send };
  }

  /** An admin moves a member to another credential, as the members page does. */
  async function setCredential(membershipId: string, credential: keyof typeof CREDENTIAL_FIELDS) {
    const r = await call(h, `/v1/team/members/${membershipId}/credential`, {
      method: 'PUT',
      token: t.adminToken,
      teamId: t.teamId,
      json: {
        credential,
        credentialFields: CREDENTIAL_FIELDS[credential],
        reason: 'Demo: credential review',
      },
    });
    expect(r.status).toBe(200);
  }

  async function removeMember(membershipId: string) {
    const r = await call(h, `/v1/team/members/${membershipId}/remove`, {
      method: 'POST',
      token: t.adminToken,
      teamId: t.teamId,
      json: { reason: 'Demo: left the program' },
    });
    expect(r.status).toBe(200);
  }

  /** A draft encounter, on the chart. */
  async function encounterOf(c: Awaited<ReturnType<typeof clinician>>, patientId: string | null = null) {
    const encounter = await c.phone.change({
      entity: 'encounter',
      op: 'create',
      value: { kind: 'medical', ...(patientId ? { patientId } : {}) },
    });
    expect((await c.send(encounter)).map((r) => r.status)).toEqual(['accepted']);
    return encounter.recordId;
  }

  const noteRow = async (id: string) =>
    (
      await h.scratch.owner<{ medical: boolean; data: Record<string, unknown> }[]>`
        select medical, data from sineobex.encounter_notes where id = ${id}`
    )[0];

  const held = { status: 'rejected', reason: 'permission', quarantined: true };

  describe('the test-only note types (lifecycle 4.4)', () => {
    const byKey = new Map(TEST_NOTE_TYPES.map((d) => [d.key, d]));

    it('are definitions the export would take: the schema, then the validator', () => {
      expect([...byKey.keys()]).toEqual([TEST_NOTE.noteTypeKey, TEST_MEDICAL.noteTypeKey]);
      for (const definition of TEST_NOTE_TYPES) {
        expect(definition.version).toBe(1);
        expect(checkFile('noteType', definition)).toEqual([]);
        expect(validate(definition, { noteType: (key) => byKey.get(key) })).toEqual([]);
      }
    });

    it('one is Non-Medical and one Medical, and neither asks for an answer before Complete', () => {
      expect(byKey.get('test_note')!.kinds).toEqual(['medical', 'non_medical']);
      expect(byKey.get('test_medical')!.kinds).toEqual(['medical']);
      expect(JSON.stringify(TEST_NOTE_TYPES)).not.toContain('"required"');
    });

    it('take every answer phase 2’s sync tests send', () => {
      const rows = (i: number) => `rows.e${String(i).padStart(7, '0')}`;
      const answers: [string, unknown][] = [
        ['vitals.temp_c', 38.2],
        ['vitals.pulse', 96],
        ['care.plan', 'Demo: rest and fluids'],
        ['care.followup', 'Demo: clinic Friday'],
        ['care.allergies', 'Demo: penicillin'],
        ['care.history', `Demo: ${'h'.repeat(3990)}`],
        ['wound.site', 'Demo: left forearm'],
        ['wound.length_cm', 2.5],
        ...[...'abcdefg'].map((x): [string, unknown] => [`extra.${x}`, 'ok']),
        [`${rows(0)}.n`, 0],
        [`${rows(300)}.n`, 300],
        [`${rows(999)}.text`, 'Demo: a row'],
        [`${rows(999)}.entryAt`, '2026-10-20T14:50:00.000Z'],
        ['more.none', true],
        ['more.detail', 'Demo: shown while nothing more is ticked'],
      ];
      for (const definition of TEST_NOTE_TYPES) {
        for (const [path, value] of answers)
          expect([path, checkAnswer(definition, path, value)]).toEqual([path, null]);
      }
    });

    it('every test team holds both, at the hash of the file’s definition', async () => {
      const held = await h.scratch.owner<{ key: string; version: number; hash: string }[]>`
        select key, version, hash from sineobex.note_type_versions where team_id = ${t.teamId} order by key desc`;
      expect(held).toEqual(
        await Promise.all(
          TEST_NOTE_TYPES.map(async (d) => ({
            key: d.key,
            version: d.version,
            hash: await sha256Hex(canonicalJson(d)),
          })),
        ),
      );
    });
  });

  describe('the signer is loaded, not carried (lifecycle 4.2)', () => {
    it('loads a member’s name, credential and fields as they are now; a removed member keeps their last', async () => {
      const riley = await addMember(
        h,
        t,
        'riley@example.com',
        'Riley (demo)',
        'healthcare_staff',
        'resident',
      );
      expect(await inTeam((tx) => loadSigner(tx, t.teamId, riley.id))).toEqual({
        userId: riley.id,
        displayName: 'Riley (demo)',
        active: true,
        credential: 'resident',
        fields: CREDENTIAL_FIELDS.resident,
      });
      await setCredential(riley.membershipId, 'attending');
      await removeMember(riley.membershipId);
      const removed = await inTeam((tx) => loadSigner(tx, t.teamId, riley.id));
      expect(removed).toMatchObject({
        active: false,
        credential: 'attending',
        fields: CREDENTIAL_FIELDS.attending,
      });
      // Who has left charts nothing, whatever their credential.
      expect(chartsMedical(removed)).toBe(false);
      expect(chartsMedical({ ...removed!, active: true })).toBe(true);
      expect(chartsMedical({ ...removed!, active: true, credential: 'chw' })).toBe(false);
      expect(chartsMedical(null)).toBe(false);
    });

    it('finds no signer outside the team', async () => {
      const team2 = await secondTeam(h, 'Signer Team', 'signer');
      const [other] = await h.scratch.owner<{ userId: string }[]>`
        select user_id as "userId" from sineobex.team_memberships where team_id = ${team2.teamId} limit 1`;
      expect(await inTeam((tx) => loadSigner(tx, t.teamId, other!.userId))).toBeNull();
      expect(await acrossTeams((tx) => loadSigner(tx, t.teamId, other!.userId))).toBeNull();
      expect(await inTeam((tx) => loadSigner(tx, t.teamId, randomUUID()))).toBeNull();
    });

    it('reads the credential changes and restores after a time, oldest first, each with what it replaced', async () => {
      const casey = await addMember(
        h,
        t,
        'casey.r@example.com',
        'Casey R (demo)',
        'healthcare_staff',
        'student',
      );
      await setCredential(casey.membershipId, 'resident');
      // A role change and a removal replace no credential.
      const roles = await call(h, '/v1/team/roles', { token: t.adminToken, teamId: t.teamId });
      const logistics = (roles.body as unknown as { key: string; id: string }[]).find(
        (r) => r.key === 'logistics',
      )!;
      expect(
        (
          await call(h, `/v1/team/members/${casey.membershipId}/role`, {
            method: 'PUT',
            token: t.adminToken,
            teamId: t.teamId,
            json: { roleId: logistics.id, reason: 'Demo: covering the supply desk' },
          })
        ).status,
      ).toBe(200);
      await removeMember(casey.membershipId);
      // Back as an attending: a restore replaces the credential and its fields.
      await addMember(h, t, 'casey.r@example.com', 'Casey R (demo)', 'healthcare_staff', 'attending');
      await setCredential(casey.membershipId, 'np');
      // The same person in another team changes there too: not this team's history.
      const team2 = await secondTeam(h, 'Other Team', 'other');
      const there = await addMember(
        h,
        team2,
        'casey.r@example.com',
        'Casey R (demo)',
        'healthcare_staff',
        'pa',
      );
      expect(there.id).toBe(casey.id);
      const r = await call(h, `/v1/team/members/${there.membershipId}/credential`, {
        method: 'PUT',
        token: team2.adminToken,
        teamId: team2.teamId,
        json: { credential: 'chw', credentialFields: {}, reason: 'Demo: credential review' },
      });
      expect(r.status).toBe(200);

      // Each time in microseconds, and as the change reads it: rounded up to its millisecond.
      const rows = (
        await h.scratch.owner<{ kind: string; us: string }[]>`
          select c.kind, (extract(epoch from c.changed_at) * 1000000)::bigint::text as us
          from sineobex.membership_changes c
          where c.membership_id = ${casey.membershipId} order by c.changed_at`
      ).map((r) => ({ kind: r.kind, changedAt: new Date(Math.ceil(Number(r.us) / 1000)) }));
      expect(rows.map((x) => x.kind)).toEqual([
        'invited',
        'credential',
        'role',
        'removed',
        'restored',
        'credential',
      ]);

      const all = await inTeam((tx) => credentialChangesAfter(tx, t.teamId, casey.id, new Date(0)));
      expect(await acrossTeams((tx) => credentialChangesAfter(tx, t.teamId, casey.id, new Date(0)))).toEqual(
        all,
      );
      expect(all.map((c) => c.oldValue)).toEqual([
        { credential: 'student', fields: CREDENTIAL_FIELDS.student },
        { credential: 'resident', fields: CREDENTIAL_FIELDS.resident },
        { credential: 'attending', fields: CREDENTIAL_FIELDS.attending },
      ]);
      expect(all.map((c) => c.changedAt)).toEqual(
        rows
          .filter((x) => x.kind === 'credential' || x.kind === 'restored')
          .map((x) => x.changedAt.toISOString()),
      );
      // Only what came after the time: a change at the very time is not after it.
      const firstChange = rows[1]!.changedAt;
      expect(
        (await inTeam((tx) => credentialChangesAfter(tx, t.teamId, casey.id, firstChange))).map(
          (c) => c.oldValue.credential,
        ),
      ).toEqual(['resident', 'attending']);
      expect(
        await inTeam((tx) => credentialChangesAfter(tx, t.teamId, casey.id, new Date(Date.now() + 60_000))),
      ).toEqual([]);
    });

    it('a change within the millisecond after a signature counts as after it', async () => {
      // changed_at holds microseconds and a time here holds milliseconds: rounded down, a change
      // 0.4 ms after the signature would read as at it, and signedUnder would pass it over.
      const sky = await addMember(h, t, 'sky.s@example.com', 'Sky S (demo)', 'healthcare_staff', 'resident');
      const at = new Date('2026-11-09T15:00:00.000Z');
      await h.scratch.owner`
        insert into sineobex.membership_changes (team_id, membership_id, kind, old_value, new_value, changed_by,
          changed_at)
        values
          (${t.teamId}, ${sky.membershipId}, 'credential', ${h.scratch.owner.json({ credential: 'student', fields: {} })},
           ${h.scratch.owner.json({ credential: 'resident', fields: {} })}, ${t.adminId}, ${at}),
          (${t.teamId}, ${sky.membershipId}, 'credential', ${h.scratch.owner.json({ credential: 'np', fields: {} })},
           ${h.scratch.owner.json({ credential: 'resident', fields: {} })}, ${t.adminId},
           ${at}::timestamptz + interval '400 microseconds')`;
      expect(await inTeam((tx) => credentialChangesAfter(tx, t.teamId, sky.id, at))).toEqual([
        { changedAt: '2026-11-09T15:00:00.001Z', oldValue: { credential: 'np', fields: {} } },
      ]);
    });

    it('passes over a restore recorded before restores kept what they replaced, and refuses a row it cannot read', async () => {
      const drew = await addMember(
        h,
        t,
        'drew.d@example.com',
        'Drew D (demo)',
        'healthcare_staff',
        'resident',
      );
      // Phase 1 wrote a restore with no old_value. It is older than any note that can be signed.
      await h.scratch.owner`
        insert into sineobex.membership_changes (team_id, membership_id, kind, old_value, new_value, changed_by)
        values (${t.teamId}, ${drew.membershipId}, 'restored', null, ${h.scratch.owner.json({ credential: 'resident' })},
                ${t.adminId})`;
      expect(await inTeam((tx) => credentialChangesAfter(tx, t.teamId, drew.id, new Date(0)))).toEqual([]);
      // A credential the server does not know is its own fault: never read as some credential.
      await h.scratch.owner`
        insert into sineobex.membership_changes (team_id, membership_id, kind, old_value, new_value, changed_by)
        values (${t.teamId}, ${drew.membershipId}, 'credential',
                ${h.scratch.owner.json({ credential: 'wizard', fields: {} })},
                ${h.scratch.owner.json({ credential: 'resident', fields: {} })}, ${t.adminId})`;
      await expect(
        inTeam((tx) => credentialChangesAfter(tx, t.teamId, drew.id, new Date(0))),
      ).rejects.toThrow('a credential change holds no credential it replaced');
    });
  });

  describe('the Medical gate (lifecycle 4.2)', () => {
    let doc: Awaited<ReturnType<typeof clinician>>;
    let student: Awaited<ReturnType<typeof clinician>>;
    let outreach: Awaited<ReturnType<typeof clinician>>;
    let plain: Awaited<ReturnType<typeof clinician>>;

    // A Medical note needs a visit that names a patient (4.4).
    let patientId: string;

    beforeAll(async () => {
      doc = await clinician('doc@example.com', 'Dana (demo)', 'attending');
      student = await clinician('stu@example.com', 'Sol (demo)', 'student');
      // Both chart (healthcare_staff holds encounters.chart); neither credential charts Medical.
      outreach = await clinician('kim@example.com', 'Kim (demo)', 'chw');
      plain = await clinician('lee@example.com', 'Lee (demo)', 'none');
      patientId = (await createPatient(h, t.teamId, t.adminId)).id;
    });

    const noteCreate = (
      c: Awaited<ReturnType<typeof clinician>>,
      encounterId: string,
      type: object,
      data = {},
    ) => c.phone.change({ entity: 'encounter_note', op: 'create', value: { encounterId, ...type, data } });
    const answer = (
      c: Awaited<ReturnType<typeof clinician>>,
      noteId: string,
      field: string,
      value: unknown,
    ) =>
      c.phone.change({ entity: 'encounter_note', recordId: noteId, op: 'set', field, value, baseVersion: 1 });

    it('a Medical note’s create needs a credential that charts Medical: held for review, never refused', async () => {
      const encounterId = await encounterOf(doc, patientId);
      for (const who of [outreach, plain]) {
        const create = await noteCreate(who, encounterId, TEST_MEDICAL, { 'vitals.pulse': 88 });
        expect(await who.send(create)).toEqual([expect.objectContaining(held)]);
        expect(await noteRow(create.recordId)).toBeUndefined();
        const [item] = await h.scratch.owner<{ reason: string }[]>`
          select reason from sineobex.quarantine_items where change_id = ${create.changeId}`;
        expect(item!.reason).toBe('permission');
      }
      for (const who of [doc, student]) {
        const create = await noteCreate(who, encounterId, TEST_MEDICAL, { 'vitals.pulse': 88 });
        expect((await who.send(create)).map((r) => r.status)).toEqual(['accepted']);
        expect(await noteRow(create.recordId)).toMatchObject({ medical: true });
      }
    });

    it('a Non-Medical note is not gated and is not Medical', async () => {
      const encounterId = await encounterOf(doc, patientId);
      const typed = await noteCreate(plain, encounterId, TEST_NOTE, { 'care.plan': 'Demo: rest' });
      expect((await plain.send(typed)).map((r) => r.status)).toEqual(['accepted']);
      expect(await noteRow(typed.recordId)).toMatchObject({ medical: false });
      const edit = await answer(plain, typed.recordId, 'data.care.plan', 'Demo: fluids');
      expect((await plain.send(edit)).map((r) => r.status)).toEqual(['accepted']);
    });

    it('a set of an answer or of the status of a Medical note is held for someone who cannot chart Medical', async () => {
      const encounterId = await encounterOf(doc, patientId);
      const create = await noteCreate(doc, encounterId, TEST_MEDICAL, { 'vitals.pulse': 88 });
      expect((await doc.send(create)).map((r) => r.status)).toEqual(['accepted']);
      for (const who of [outreach, plain]) {
        const pulse = await answer(who, create.recordId, 'data.vitals.pulse', 90);
        const status = await who.phone.change({
          entity: 'encounter_note',
          recordId: create.recordId,
          op: 'set',
          field: 'status',
          value: 'draft',
          baseVersion: 1,
        });
        // The gate comes first: an answer the type refuses is held too, and checked when accepted.
        const wrong = await answer(who, create.recordId, 'data.vitals.pulse', 'fast');
        expect(await who.send(pulse, status, wrong)).toEqual([
          expect.objectContaining(held),
          expect.objectContaining(held),
          expect.objectContaining(held),
        ]);
      }
      expect(await noteRow(create.recordId)).toMatchObject({ data: { 'vitals.pulse': 88 } });
      const own = await answer(doc, create.recordId, 'data.vitals.pulse', 92);
      const student_ = await answer(student, create.recordId, 'data.care.plan', 'Demo: fluids');
      expect((await doc.send(own)).map((r) => r.status)).toEqual(['accepted']);
      expect((await student.send(student_)).map((r) => r.status)).toEqual(['accepted']);
    });

    it('a credential lowered while the phone was offline holds its change; an admin’s accept lets it through', async () => {
      const pat = await clinician('pat@example.com', 'Pat (demo)', 'np');
      const encounterId = await encounterOf(pat, patientId);
      const create = await noteCreate(pat, encounterId, TEST_MEDICAL, { 'vitals.temp_c': 38.2 });
      expect((await pat.send(create)).map((r) => r.status)).toEqual(['accepted']);
      // Made offline, before the credential went down; sent after.
      const late = await answer(pat, create.recordId, 'data.vitals.temp_c', 38.6);
      await setCredential(pat.membershipId, 'chw');
      expect(await pat.send(late)).toEqual([expect.objectContaining(held)]);
      expect(await noteRow(create.recordId)).toMatchObject({ data: { 'vitals.temp_c': 38.2 } });

      const mark = await auditMark(h);
      const [item] = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.quarantine_items where change_id = ${late.changeId}`;
      const decided = await call(h, `/v1/team/quarantine/${item!.id}/decision`, {
        method: 'POST',
        token: t.adminToken,
        teamId: t.teamId,
        json: { decision: 'accept', reason: 'Demo: checked with Pat' },
      });
      expect(decided.status).toBe(200);
      expect(await noteRow(create.recordId)).toMatchObject({ data: { 'vitals.temp_c': 38.6 } });
      const [history] = await h.scratch.owner<{ changedBy: string; approvedBy: string }[]>`
        select changed_by as "changedBy", approved_by as "approvedBy" from sineobex.field_history
        where record_id = ${create.recordId} and field = 'data.vitals.temp_c' and version = 2`;
      expect(history).toEqual({ changedBy: pat.id, approvedBy: t.adminId });
      // The event is the admin's, on the person's behalf.
      const [updated] = await expectAudit(h, 'note.updated', { after: mark, count: 1 });
      expect(updated).toMatchObject({ actorUserId: t.adminId, details: { onBehalfOf: pat.id } });
    });
  });

  describe('the note’s create (lifecycle 4.4)', () => {
    let drew: Awaited<ReturnType<typeof clinician>>;
    let kai: Awaited<ReturnType<typeof clinician>>;
    let patientId: string;

    beforeAll(async () => {
      drew = await clinician('drew@example.com', 'Drew (demo)', 'attending');
      // Charts, and cannot chart Medical.
      kai = await clinician('kai@example.com', 'Kai (demo)', 'chw');
      patientId = (await createPatient(h, t.teamId, t.adminId)).id;
    });

    const noteCreate = (c: Awaited<ReturnType<typeof clinician>>, encounterId: string, value: object) =>
      c.phone.change({ entity: 'encounter_note', op: 'create', value: { encounterId, ...value } });
    const refused = (c: Change, problem: string) => ({
      changeId: c.changeId,
      status: 'rejected',
      reason: 'validation',
      message: expect.any(String),
      details: { problem },
    });
    const accepted = (c: Change, serverVersion = 1) => ({
      changeId: c.changeId,
      status: 'accepted',
      serverVersion,
      hash: c.valueHash,
    });
    const visitKind = async (id: string) =>
      (
        await h.scratch.owner<{ kind: string; version: number }[]>`
          select kind, (field_versions->>'kind')::int as version from sineobex.encounters where id = ${id}`
      )[0]!;

    it('names a key and version the team holds, or is refused unknown_note_type, and the queue goes on', async () => {
      // A version only another team holds is not this team's.
      const elsewhere = await createTeam(h, 'Demo Note Types Elsewhere');
      await installNoteTypes(h, elsewhere, [{ ...TEST_NOTE_TYPES[0]!, key: 'test_elsewhere' }]);
      const encounterId = await encounterOf(drew, patientId);
      const unknown = [
        await noteCreate(drew, encounterId, { noteTypeKey: 'demo_unknown', noteTypeVersion: 1 }),
        await noteCreate(drew, encounterId, { ...TEST_NOTE, noteTypeVersion: 2 }),
        await noteCreate(drew, encounterId, { noteTypeKey: 'test_elsewhere', noteTypeVersion: 1 }),
        // A note with no version is a phase 2 preview row: no new one is made.
        await noteCreate(drew, encounterId, { noteTypeKey: TEST_NOTE.noteTypeKey }),
      ];
      const known = await noteCreate(drew, encounterId, TEST_NOTE);
      const mark = await auditMark(h);
      expect(await drew.send(...unknown, known)).toEqual([
        ...unknown.map((c) => refused(c, 'unknown_note_type')),
        accepted(known),
      ]);
      for (const c of unknown) expect(await noteRow(c.recordId)).toBeUndefined();
      expect(await noteRow(known.recordId)).toMatchObject({ medical: false });
      const events = await expectAudit(h, 'sync.rejected', { after: mark, count: unknown.length });
      expect(events.map((e) => e.details.problem)).toEqual(unknown.map(() => 'unknown_note_type'));
    });

    it('a Medical note needs a visit that names a patient, ahead of the Medical gate; named, the same create is taken', async () => {
      const encounterId = await encounterOf(drew);
      const medical = await noteCreate(drew, encounterId, { ...TEST_MEDICAL, data: { 'vitals.pulse': 88 } });
      const social = await noteCreate(drew, encounterId, TEST_NOTE);
      expect(await drew.send(medical, social)).toEqual([
        refused(medical, 'medical_note_needs_patient'),
        accepted(social),
      ]);
      // Refused, not held: naming the patient is the fix, whoever sends it.
      const gated = await noteCreate(kai, encounterId, TEST_MEDICAL);
      expect(await kai.send(gated)).toEqual([refused(gated, 'medical_note_needs_patient')]);
      expect(await noteRow(medical.recordId)).toBeUndefined();

      // The worker names the patient; the store sends the note's create again as the fix of the refused one.
      const named = await drew.phone.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field: 'patientId',
        value: patientId,
        baseVersion: 1,
      });
      const again = await drew.phone.change({
        entity: 'encounter_note',
        recordId: medical.recordId,
        op: 'create',
        value: medical.value,
        supersedes: medical.changeId,
      });
      expect(await drew.send(named, again)).toEqual([accepted(named, 2), accepted(again)]);
      expect(await noteRow(medical.recordId)).toMatchObject({ medical: true, data: { 'vitals.pulse': 88 } });
      const [settled] = await h.scratch.owner<{ resolvedBy: string }[]>`
        select resolved_by_change as "resolvedBy" from sineobex.sync_changes where change_id = ${medical.changeId}`;
      expect(settled!.resolvedBy).toBe(again.changeId);
    });

    it('a Medical note makes its visit Medical, as a change of the visit’s kind', async () => {
      const visit = await drew.phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'non_medical', patientId },
      });
      const social = await noteCreate(drew, visit.recordId, TEST_NOTE);
      expect(await drew.send(visit, social)).toEqual([accepted(visit), accepted(social)]);
      expect(await visitKind(visit.recordId)).toEqual({ kind: 'non_medical', version: 1 });

      const mark = await auditMark(h);
      const medical = await noteCreate(drew, visit.recordId, TEST_MEDICAL);
      expect(await drew.send(medical)).toEqual([accepted(medical)]);
      expect(await visitKind(visit.recordId)).toEqual({ kind: 'medical', version: 2 });
      expect(
        await h.scratch.owner`
          select version, value, previous_value as "previousValue", kind, changed_by as "changedBy",
                 change_id as "changeId"
          from sineobex.field_history where record_id = ${visit.recordId} and field = 'kind' order by id`,
      ).toEqual([
        expect.objectContaining({ version: 1, value: 'non_medical', kind: 'created' }),
        {
          version: 2,
          value: 'medical',
          previousValue: 'non_medical',
          kind: 'set',
          changedBy: drew.id,
          changeId: medical.changeId,
        },
      ]);
      const [switched] = await expectAudit(h, 'encounter.updated', { after: mark, patientId, count: 1 });
      expect(switched).toMatchObject({
        entityId: visit.recordId,
        details: { changeId: medical.changeId, field: 'kind', kind: 'set', version: 2 },
      });
      await expectAudit(h, 'note.created', { after: mark, patientId, count: 1 });

      // Medical already: another Medical note leaves the visit as it is.
      const more = await noteCreate(drew, visit.recordId, TEST_MEDICAL);
      expect(await drew.send(more)).toEqual([accepted(more)]);
      expect(await visitKind(visit.recordId)).toEqual({ kind: 'medical', version: 2 });
      await expectAudit(h, 'encounter.updated', { after: mark, count: 1 });

      // A Medical note held by the gate makes nothing Medical.
      const other = await drew.phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'non_medical', patientId },
      });
      expect(await drew.send(other)).toEqual([accepted(other)]);
      const held_ = await noteCreate(kai, other.recordId, TEST_MEDICAL);
      expect(await kai.send(held_)).toEqual([expect.objectContaining(held)]);
      expect(await visitKind(other.recordId)).toEqual({ kind: 'non_medical', version: 1 });
    });

    it('is taken whatever state the visit’s other notes are in', async () => {
      const encounterId = await encounterOf(drew, patientId);
      const first = await noteCreate(drew, encounterId, {
        ...TEST_MEDICAL,
        data: { 'care.plan': 'Demo: rest' },
      });
      expect(await drew.send(first)).toEqual([accepted(first)]);
      await h.scratch.owner`
        update sineobex.encounter_notes set status = 'completed', completed_at = now(), completed_by = author_user_id
        where id = ${first.recordId}`;
      const later = await noteCreate(kai, encounterId, {
        ...TEST_NOTE,
        data: { 'care.followup': 'Demo: Friday' },
      });
      expect(await kai.send(later)).toEqual([accepted(later)]);
    });
  });

  describe('a note’s answers (lifecycle 4.4)', () => {
    let eli: Awaited<ReturnType<typeof clinician>>;
    let fay: Awaited<ReturnType<typeof clinician>>;
    let encounterId: string;

    beforeAll(async () => {
      eli = await clinician('eli@example.com', 'Eli (demo)', 'none');
      fay = await clinician('fay@example.com', 'Fay (demo)', 'none');
      encounterId = await encounterOf(eli);
    });

    const noteCreate = (c: Awaited<ReturnType<typeof clinician>>, value: object) =>
      c.phone.change({ entity: 'encounter_note', op: 'create', value: { encounterId, ...value } });
    const setOn = (
      c: Awaited<ReturnType<typeof clinician>>,
      noteId: string,
      field: string,
      value: unknown,
      baseVersion = 0,
      more: Partial<Change> = {},
    ) =>
      c.phone.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field,
        value,
        baseVersion,
        ...more,
      });
    /** A note on the test-only Non-Medical type, on the chart. */
    async function noteWith(data: Record<string, unknown> = {}) {
      const create = await noteCreate(eli, { ...TEST_NOTE, data });
      expect((await eli.send(create)).map((r) => r.status)).toEqual(['accepted']);
      return create.recordId;
    }
    const refused = (c: Change, details: Record<string, unknown>) => ({
      changeId: c.changeId,
      status: 'rejected',
      reason: 'validation',
      message: expect.any(String),
      details,
    });
    const taken = (c: Change, serverVersion: number, details?: Record<string, unknown>) => ({
      changeId: c.changeId,
      status: 'accepted',
      serverVersion,
      hash: c.valueHash,
      ...(details ? { details } : {}),
    });
    const entry = (n: number) => `rows.e${String(n).padStart(7, '0')}`;
    const at = '2026-10-20T14:40:00.000Z';

    it('each answer is checked against the note’s type once the note is loaded', async () => {
      const noteId = await noteWith({ 'vitals.pulse': 88 });
      const wrong: [string, unknown, string][] = [
        ['data.vitals.pulse', 'fast', 'wrong_type'],
        ['data.vitals.pulse', 301, 'out_of_range'],
        // One decimal: 38.25 is not one of its values.
        ['data.vitals.temp_c', 38.25, 'out_of_range'],
        ['data.care.followup', `Demo: ${'x'.repeat(200)}`, 'too_long'],
        ['data.vitals.bp', 120, 'unknown_path'],
        ['data.rows.notanentry.text', 'Demo: a row', 'unknown_path'],
        ['data.rows.e0000001.n', 'two', 'wrong_type'],
        // A tick stores true; unticking writes null.
        ['data.more.none', false, 'wrong_type'],
      ];
      const sets = await Promise.all(wrong.map(([field, value]) => setOn(eli, noteId, field, value)));
      const right = [
        await setOn(eli, noteId, 'data.vitals.pulse', 96, 1),
        await setOn(eli, noteId, 'data.vitals.temp_c', 38.2),
        // Null clears an answer, wherever one is stored.
        await setOn(eli, noteId, 'data.care.followup', null),
      ];
      expect(await eli.send(...sets, ...right)).toEqual([
        ...sets.map((c, i) => refused(c, { problem: wrong[i]![2] })),
        taken(right[0]!, 2),
        taken(right[1]!, 1),
        taken(right[2]!, 0),
      ]);
      expect(await noteRow(noteId)).toMatchObject({ data: { 'vitals.pulse': 96, 'vitals.temp_c': 38.2 } });
      // Phase 2's open pattern still answers first, before the note is loaded.
      const badPath = await setOn(eli, noteId, 'data.Vitals', 1);
      expect(await eli.send(badPath)).toEqual([refused(badPath, { problem: 'unknown_field' })]);
    });

    it('a create’s answers are checked too, each refusal naming the answer’s path', async () => {
      const cases: [Record<string, unknown>, Record<string, unknown>][] = [
        [{ 'vitals.pulse': 'fast' }, { problem: 'wrong_type', path: 'vitals.pulse' }],
        [
          { 'care.plan': 'Demo: rest', 'vitals.bp': 120 },
          { problem: 'unknown_path', path: 'vitals.bp' },
        ],
        [{ 'wound.length_cm': 100 }, { problem: 'out_of_range', path: 'wound.length_cm' }],
      ];
      const creates = await Promise.all(cases.map(([data]) => noteCreate(eli, { ...TEST_NOTE, data })));
      const fine = await noteCreate(eli, { ...TEST_NOTE, data: { 'vitals.pulse': 88, 'care.plan': null } });
      expect(await eli.send(...creates, fine)).toEqual([
        ...creates.map((c, i) => refused(c, cases[i]![1])),
        taken(fine, 1),
      ]);
      for (const c of creates) expect(await noteRow(c.recordId)).toBeUndefined();
    });

    it('a note with no version keeps the open path rule, and is never checked against a definition', async () => {
      // A phase 2 preview row: no new one can be made.
      const noteId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
        values (${noteId}, ${t.teamId}, ${encounterId}, 'wound_care', ${eli.id}, '{"plan": "Demo: dress daily"}')`;
      const sets = [
        await setOn(eli, noteId, 'data.plan', 'Demo: soak first'),
        await setOn(eli, noteId, 'data.site.left.arm', 12),
      ];
      expect(await eli.send(...sets)).toEqual([taken(sets[0]!, 1), taken(sets[1]!, 1)]);
      expect(await noteRow(noteId)).toMatchObject({
        data: { plan: 'Demo: soak first', 'site.left.arm': 12 },
      });
    });

    it('a note holds up to 1,000 answers', async () => {
      expect(MAX_NOTE_FIELDS).toBe(1000);
      // The server checks one answer at a time and counts no entries: 1,000 is its bound (forms 2.4).
      const data = Object.fromEntries(
        Array.from({ length: MAX_NOTE_FIELDS / 2 }, (_, i) => [
          [`${entry(i)}.entryAt`, at],
          [`${entry(i)}.n`, i],
        ]).flat(),
      );
      const full = await noteCreate(eli, { ...TEST_NOTE, data });
      const over = await noteCreate(eli, { ...TEST_NOTE, data: { ...data, 'care.plan': 'Demo: one more' } });
      const [made, refusedOver] = await eli.send(full, over);
      expect(made).toEqual(taken(full, 1));
      expect(refusedOver).toMatchObject({ status: 'rejected', reason: 'validation' });
      const again = await setOn(eli, full.recordId, `data.${entry(0)}.n`, 7, 1);
      const more = await setOn(eli, full.recordId, 'data.care.plan', 'Demo: one more');
      expect(await eli.send(again, more)).toEqual([
        taken(again, 2),
        refused(more, { problem: 'too_many_fields' }),
      ]);
    }, 60_000);

    it('an answer that will not count is taken, and its receipt says why', async () => {
      // Fay removed the first row and ticked "Nothing more"; Eli, offline, wrote into both.
      const noteId = await noteWith({
        [`${entry(1)}.entryAt`]: at,
        [`${entry(1)}.entryRemoved`]: true,
        [`${entry(2)}.entryAt`]: at,
        'more.none': true,
      });
      const sets = [
        await setOn(eli, noteId, `data.${entry(1)}.text`, 'Demo: the first row'),
        await setOn(eli, noteId, `data.${entry(1)}.entryAt`, at, 1),
        await setOn(eli, noteId, 'data.more.detail', 'Demo: more to say'),
        // In an entry that is there, and in a field that shows: nothing to say.
        await setOn(eli, noteId, `data.${entry(2)}.text`, 'Demo: the second row'),
        await setOn(eli, noteId, 'data.care.plan', 'Demo: rest'),
        // A clear holds no answer to count. The removal itself is what it says.
        await setOn(eli, noteId, 'data.more.detail', null, 1),
        await setOn(eli, noteId, `data.${entry(2)}.entryRemoved`, true),
        await setOn(eli, noteId, `data.${entry(2)}.text`, 'Demo: the second row, again', 1),
      ];
      const answered = await eli.send(...sets);
      expect(answered).toEqual([
        taken(sets[0]!, 1, { notCounted: 'removed_entry' }),
        taken(sets[1]!, 1, { notCounted: 'removed_entry' }),
        taken(sets[2]!, 1, { notCounted: 'hidden_field' }),
        taken(sets[3]!, 1),
        taken(sets[4]!, 1),
        taken(sets[5]!, 2),
        taken(sets[6]!, 1),
        taken(sets[7]!, 2, { notCounted: 'removed_entry' }),
      ]);
      // Kept on the chart as sent: shown again if the field shows again.
      expect(await noteRow(noteId)).toMatchObject({
        data: { [`${entry(1)}.text`]: 'Demo: the first row', [`${entry(2)}.entryRemoved`]: true },
      });
      // Sent twice, it answers the same, from its receipt.
      expect(await eli.send(...sets)).toEqual(answered);

      // Only a value on the chart is told so: a conflict, or the answer to one that keeps the
      // server's value, says nothing of it.
      const fays = await setOn(fay, noteId, 'data.more.detail', 'Demo: from Fay', 2);
      expect(await fay.send(fays)).toEqual([taken(fays, 3, { notCounted: 'hidden_field' })]);
      const unseen = await setOn(eli, noteId, 'data.more.detail', 'Demo: from Eli', 2);
      const [conflict] = await eli.send(unseen);
      expect(conflict).toMatchObject({ status: 'conflict' });
      expect(conflict!.details).toBeUndefined();
      const keep = await setOn(eli, noteId, 'data.more.detail', 'Demo: from Eli', 3, {
        conflictOf: unseen.changeId,
        resolution: 'keep_server',
      });
      expect(await eli.send(keep)).toEqual([taken(keep, 3)]);
      // The same value again is still a value that does not count.
      const same = await setOn(fay, noteId, 'data.more.detail', 'Demo: from Fay', 3);
      expect(await fay.send(same)).toEqual([taken(same, 3, { notCounted: 'hidden_field' })]);
    });

    it('a hidden field in an entry that is there is hidden, not removed', async () => {
      const [testNote] = TEST_NOTE_TYPES;
      const wounds = {
        ...testNote!,
        key: 'test_wounds',
        sections: [
          {
            id: 'wounds',
            title: 'Wounds',
            repeat: { max: 20, itemTitle: 'Wound {n}' },
            fields: [
              { id: 'healed', kind: 'flag', label: 'Healed' },
              {
                id: 'size_cm',
                kind: 'number',
                label: 'Size',
                min: 0,
                max: 99.9,
                decimals: 1,
                showWhen: { not: { field: './healed', filled: true } },
              },
            ],
          },
        ],
      } as unknown as ResolvedNoteType;
      expect(validate(wounds, { noteType: () => undefined })).toEqual([]);
      await installNoteTypes(h, t.teamId, [wounds]);
      const wound = 'wounds.e0000001';
      const create = await noteCreate(eli, {
        noteTypeKey: 'test_wounds',
        noteTypeVersion: 1,
        data: { [`${wound}.entryAt`]: at, [`${wound}.healed`]: true },
      });
      expect((await eli.send(create)).map((r) => r.status)).toEqual(['accepted']);
      const size = await setOn(fay, create.recordId, `data.${wound}.size_cm`, 2.5);
      expect(await fay.send(size)).toEqual([taken(size, 1, { notCounted: 'hidden_field' })]);
    });

    it('a rule that throws on a definition is refused definition_error, writes nothing, and the queue goes on', async () => {
      const [testNote] = TEST_NOTE_TYPES;
      // A row whose hash is not its definition's (D79): 0017 checks only the hash's form.
      const forged = { ...testNote!, key: 'test_forged' };
      await h.scratch.owner`
        insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
        values (${t.teamId}, 'test_forged', 1, ${JSON.stringify(forged)}::text::jsonb,
                ${await sha256Hex(canonicalJson(testNote))}, 'preset', 1)`;
      // A definition the validator refuses, two fields that each show only while the other is filled,
      // installed under its own hash: the interpreter throws on it.
      const looped = {
        ...testNote!,
        key: 'test_looped',
        sections: [
          {
            id: 'loop',
            title: 'Loop',
            fields: [
              {
                id: 'a',
                kind: 'text',
                label: 'A',
                lines: 'one',
                maxLength: 200,
                showWhen: { field: 'loop.b', filled: true },
              },
              {
                id: 'b',
                kind: 'text',
                label: 'B',
                lines: 'one',
                maxLength: 200,
                showWhen: { field: 'loop.a', filled: true },
              },
            ],
          },
        ],
      } as unknown as ResolvedNoteType;
      expect(validate(looped, { noteType: () => undefined }).map((p) => p.rule)).toContain(
        'validate.condition_cycle',
      );
      await installNoteTypes(h, t.teamId, [looped]);
      const loopedNote = await noteCreate(eli, { noteTypeKey: 'test_looped', noteTypeVersion: 1 });
      expect((await eli.send(loopedNote)).map((r) => r.status)).toEqual(['accepted']);
      // A note naming a version the team does not hold, from before any check: none can be made now.
      const strayId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, note_type_version, author_user_id)
        values (${strayId}, ${t.teamId}, ${encounterId}, 'test_note', 9, ${eli.id})`;

      const mark = await auditMark(h);
      const throwing = [
        await noteCreate(eli, { noteTypeKey: 'test_forged', noteTypeVersion: 1 }),
        await setOn(eli, loopedNote.recordId, 'data.loop.a', 'Demo: round and round'),
        await setOn(eli, strayId, 'data.care.plan', 'Demo: rest'),
      ];
      const after = await noteCreate(eli, TEST_NOTE);
      expect(await eli.send(...throwing, after)).toEqual([
        ...throwing.map((c) => refused(c, { problem: 'definition_error' })),
        taken(after, 1),
      ]);
      expect(await noteRow(throwing[0]!.recordId)).toBeUndefined();
      expect(await noteRow(loopedNote.recordId)).toMatchObject({ data: {} });
      const events = await h.scratch.owner<{ action: string; problem: string | null }[]>`
        select action, details->>'problem' as problem from sineobex.audit_events
        where id > ${mark}::bigint order by id`;
      expect(events).toEqual([
        ...throwing.map(() => ({ action: 'sync.rejected', problem: 'definition_error' })),
        { action: 'note.created', problem: null },
      ]);
    });
  });

  describe('the encounter’s fields (lifecycle 4.3)', () => {
    let ash: Awaited<ReturnType<typeof clinician>>;
    let bo: Awaited<ReturnType<typeof clinician>>;

    beforeAll(async () => {
      ash = await clinician('ash@example.com', 'Ash (demo)', 'none');
      bo = await clinician('bo@example.com', 'Bo (demo)', 'none');
    });

    const setOn = (
      c: Awaited<ReturnType<typeof clinician>>,
      encounterId: string,
      field: string,
      value: unknown,
      baseVersion: number,
      more: Partial<Change> = {},
    ) =>
      c.phone.change({
        entity: 'encounter',
        recordId: encounterId,
        op: 'set',
        field,
        value,
        baseVersion,
        ...more,
      });

    const encounterRow = async (id: string) =>
      (
        await h.scratch.owner<
          {
            kind: string;
            patientId: string | null;
            locationText: string | null;
            summary: string | null;
            status: string;
            fieldVersions: Record<string, number>;
          }[]
        >`
          select kind, patient_id as "patientId", location_text as "locationText", summary, status,
                 field_versions as "fieldVersions"
          from sineobex.encounters where id = ${id}`
      )[0]!;

    const historyOf = (id: string, field: string) =>
      h.scratch.owner<{ version: number; value: unknown; kind: string }[]>`
        select version, value, kind from sineobex.field_history
        where record_id = ${id} and field = ${field} order by id`;

    it('a create takes a place typed by hand; kind, place and summary are fields, and status is not', async () => {
      const p = await createPatient(h, t.teamId, t.adminId);
      const create = await ash.phone.change({
        entity: 'encounter',
        op: 'create',
        value: {
          kind: 'non_medical',
          patientId: p.id,
          location: { lat: 42.33, lng: -83.05 },
          locationText: 'Demo: by the river steps',
        },
      });
      expect(await ash.send(create)).toEqual([
        expect.objectContaining({ status: 'accepted', serverVersion: 1 }),
      ]);
      expect(await encounterRow(create.recordId)).toMatchObject({
        kind: 'non_medical',
        patientId: p.id,
        locationText: 'Demo: by the river steps',
        summary: null,
        status: 'draft',
        fieldVersions: { patientId: 1, location: 1, locationText: 1, kind: 1 },
      });
      expect(Object.keys((await encounterRow(create.recordId)).fieldVersions).sort()).toEqual([
        'kind',
        'location',
        'locationText',
        'patientId',
      ]);
      const created = await h.scratch.owner<{ field: string }[]>`
        select field from sineobex.field_history where record_id = ${create.recordId} and kind = 'created'
        order by field`;
      expect(created.map((r) => r.field)).toEqual(['kind', 'location', 'locationText', 'patientId']);

      const read = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: ash.token,
        teamId: t.teamId,
        json: { records: [{ entity: 'encounter', id: create.recordId }] },
      });
      expect(read.status).toBe(200);
      const [snapshot] = read.body.records as {
        status: string;
        attributes: Record<string, unknown>;
        fields: Record<string, { value: unknown; version: number }>;
      }[];
      expect(snapshot!.status).toBe('draft');
      expect(Object.keys(snapshot!.attributes).sort()).toEqual([
        'clockVerified',
        'startedAt',
        'startedDeviceTime',
      ]);
      expect(Object.keys(snapshot!.fields).sort()).toEqual([
        'kind',
        'location',
        'locationText',
        'patientId',
        'summary',
      ]);
      expect(snapshot!.fields.kind).toMatchObject({ value: 'non_medical', version: 1 });
      expect(snapshot!.fields.locationText).toMatchObject({ value: 'Demo: by the river steps', version: 1 });
      expect(snapshot!.fields.summary).toMatchObject({ value: null, version: 0 });
    });

    it('summary and place are set by the draft rule: what was seen is replaced, what was not is a conflict', async () => {
      const encounterId = await encounterOf(ash);
      const summary = await setOn(ash, encounterId, 'summary', 'Demo: cough for a week, no fever', 0);
      const place = await setOn(ash, encounterId, 'locationText', 'Demo: north parking lot', 1);
      expect(await ash.send(summary, place)).toEqual([
        expect.objectContaining({ status: 'accepted', serverVersion: 1 }),
        expect.objectContaining({ status: 'accepted', serverVersion: 2 }),
      ]);
      // Bo never saw Ash's summary: a different one is shown beside it, never written over it.
      const other = await setOn(bo, encounterId, 'summary', 'Demo: seen at the shelter door', 0);
      expect(await bo.send(other)).toEqual([
        expect.objectContaining({
          status: 'conflict',
          server: expect.objectContaining({ value: 'Demo: cough for a week, no fever', version: 1 }),
        }),
      ]);
      expect(await encounterRow(encounterId)).toMatchObject({
        summary: 'Demo: cough for a week, no fever',
        locationText: 'Demo: north parking lot',
        fieldVersions: { summary: 1, locationText: 2 },
      });
      // Cleared by the person who saw it.
      const cleared = await setOn(ash, encounterId, 'summary', null, 1);
      expect(await ash.send(cleared)).toEqual([
        expect.objectContaining({ status: 'accepted', serverVersion: 2 }),
      ]);
      expect((await encounterRow(encounterId)).summary).toBeNull();
    });

    it('a summary holds 1 to 4,000 characters and a place 1 to 200, with no space at either end', async () => {
      const encounterId = await encounterOf(ash);
      const refused: [string, unknown][] = [
        ['summary', ''],
        ['summary', 'x'.repeat(4001)],
        ['summary', ' Demo: a space before'],
        ['summary', 'Demo: a line end after\n'],
        ['summary', 42],
        ['locationText', ''],
        ['locationText', 'y'.repeat(201)],
        ['locationText', 'Demo: a space after '],
        ['kind', 'telehealth'],
        ['kind', null],
      ];
      // Refused by the value's schema, naming the path: the database's own check never answers first.
      const bySchema = expect.objectContaining({
        status: 'rejected',
        reason: 'validation',
        details: { problems: [expect.objectContaining({ path: '' })] },
      });
      for (const [field, value] of refused) {
        const change = await setOn(ash, encounterId, field, value, 0);
        expect([field, value, await ash.send(change)]).toEqual([field, value, [bySchema]]);
      }
      const longest = await setOn(ash, encounterId, 'summary', `Demo:${'é'.repeat(3995)}`, 0);
      const widest = await setOn(ash, encounterId, 'locationText', `Demo:${'y'.repeat(195)}`, 1);
      expect((await ash.send(longest, widest)).map((r) => r.status)).toEqual(['accepted', 'accepted']);

      for (const locationText of ['', 'y'.repeat(201), ' Demo: padded']) {
        const create = await ash.phone.change({
          entity: 'encounter',
          op: 'create',
          value: { kind: 'medical', locationText },
        });
        expect(await ash.send(create)).toEqual([
          expect.objectContaining({
            status: 'rejected',
            reason: 'validation',
            details: { problems: [expect.objectContaining({ path: 'locationText' })] },
          }),
        ]);
      }
      // The summary is written on the summary screen, never with the create.
      const withSummary = await ash.phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'medical', summary: 'Demo: early' },
      });
      expect(await ash.send(withSummary)).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'validation' }),
      ]);
    });

    it('status is no longer a field: the database works it out from the notes', async () => {
      const encounterId = await encounterOf(ash);
      for (const value of ['completed', 'draft']) {
        const status = await setOn(ash, encounterId, 'status', value, 1);
        expect(await ash.send(status)).toEqual([
          expect.objectContaining({
            status: 'rejected',
            reason: 'validation',
            details: { problem: 'unknown_field' },
          }),
        ]);
      }
      expect(await encounterRow(encounterId)).toMatchObject({ status: 'draft' });
      expect(await historyOf(encounterId, 'status')).toEqual([]);

      // An encounter from phase 2 still carries a status field's bookkeeping: a snapshot shows its
      // status, and no status field, and its kind as a field at version 0.
      const old = randomUUID();
      const at = h.clock.now.toISOString();
      await h.scratch.owner`
        insert into sineobex.encounters (id, team_id, kind, author_user_id, started_at, field_versions, field_meta)
        values (${old}, ${t.teamId}, 'medical', ${ash.id}, ${at},
          ${h.scratch.owner.json({ patientId: 1, location: 1, status: 2 })},
          ${h.scratch.owner.json({ status: { by: ash.id, at, changeId: null } })})`;
      const read = await call(h, '/v1/sync/records', {
        method: 'POST',
        token: ash.token,
        teamId: t.teamId,
        json: { records: [{ entity: 'encounter', id: old }] },
      });
      const [snapshot] = read.body.records as {
        status: string;
        fields: Record<string, { value: unknown; version: number }>;
      }[];
      expect(snapshot!.status).toBe('draft');
      expect(Object.keys(snapshot!.fields).sort()).toEqual([
        'kind',
        'location',
        'locationText',
        'patientId',
        'summary',
      ]);
      expect(snapshot!.fields.kind).toMatchObject({ value: 'medical', version: 0 });
    });

    it('kind goes to Medical from any version, and a move back is kept in history, not applied', async () => {
      const create = await ash.phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'non_medical' },
      });
      expect((await ash.send(create)).map((r) => r.status)).toEqual(['accepted']);
      const encounterId = create.recordId;

      const mark = await auditMark(h);
      // Bo never saw the kind (version 0): the switch applies all the same, since it only goes one way.
      const medical = await setOn(bo, encounterId, 'kind', 'medical', 0);
      expect(await bo.send(medical)).toEqual([
        expect.objectContaining({ status: 'accepted', serverVersion: 2 }),
      ]);
      expect(await encounterRow(encounterId)).toMatchObject({ kind: 'medical', fieldVersions: { kind: 2 } });
      const [switched] = await expectAudit(h, 'encounter.updated', { after: mark, count: 1 });
      expect(switched!.details).toMatchObject({ changeId: medical.changeId, field: 'kind', version: 2 });

      const back = await setOn(ash, encounterId, 'kind', 'non_medical', 2);
      const [kept] = await ash.send(back);
      expect(kept).toEqual({
        changeId: back.changeId,
        status: 'accepted',
        serverVersion: 2,
        hash: back.valueHash,
        server: expect.objectContaining({ value: 'medical', version: 2, changedBy: bo.id }),
        details: { outcome: 'history_only', problem: 'kind_cannot_go_back' },
      });
      expect(await encounterRow(encounterId)).toMatchObject({ kind: 'medical', fieldVersions: { kind: 2 } });
      expect(await historyOf(encounterId, 'kind')).toEqual([
        { version: 1, value: 'non_medical', kind: 'created' },
        { version: 2, value: 'medical', kind: 'set' },
        { version: 2, value: 'non_medical', kind: 'kept_both' },
      ]);
      const [keptEvent] = await expectAudit(h, 'encounter.kept_in_history', { after: mark, count: 1 });
      expect(keptEvent!.details).toMatchObject({
        changeId: back.changeId,
        field: 'kind',
        problem: 'kind_cannot_go_back',
      });
      // Sent twice, it answers the same.
      expect(await ash.send(back)).toEqual([kept]);

      // Medical again changes nothing; a kind never conflicts, so there is nothing to resolve.
      const again = await setOn(ash, encounterId, 'kind', 'medical', 1);
      const resolved = await setOn(ash, encounterId, 'kind', 'medical', 2, { resolution: 'replace' });
      expect(await ash.send(again, resolved)).toEqual([
        { changeId: again.changeId, status: 'accepted', serverVersion: 2, hash: again.valueHash },
        expect.objectContaining({
          status: 'rejected',
          reason: 'validation',
          details: { problem: 'nothing_to_resolve' },
        }),
      ]);
      expect(await historyOf(encounterId, 'kind')).toHaveLength(3);
    });

    /** A note of the visit, on the chart. */
    async function noteOn(
      c: Awaited<ReturnType<typeof clinician>>,
      encounterId: string,
      type: object = TEST_NOTE,
    ) {
      const create = await c.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId, ...type, data: { 'care.plan': 'Demo: rest and fluids' } },
      });
      expect((await c.send(create)).map((r) => r.status)).toEqual(['accepted']);
      return create.recordId;
    }

    /** Finished as a sign-off with effect `completed` leaves it (the database's own rules, 0018). */
    const finish = (noteId: string) => h.scratch.owner`
      update sineobex.encounter_notes set status = 'completed', completed_at = now(), completed_by = author_user_id
      where id = ${noteId}`;

    /** Signed as the database requires (0018, 0019): the sign-off row first, then the note. */
    async function sign(noteId: string) {
      const signoffId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.note_signoffs (id, team_id, note_id, act, effect, content_hash, signer_user_id,
          signer_name, signer_credential, needs_attestation, statement_version, signed_at, clock_verified)
        select ${signoffId}, team_id, id, 'sign', 'signed', ${'cd'.repeat(32)}, author_user_id, 'Demo Signer',
          'attending', false, 'demo-1', now(), true
        from sineobex.encounter_notes where id = ${noteId}`;
      await h.scratch.owner`
        update sineobex.encounter_notes
        set status = 'signed', completed_at = now(), completed_by = author_user_id, first_signed_at = now(),
            signoff_id = ${signoffId}
        where id = ${noteId}`;
    }

    const noticesOn = (recordId: string) =>
      h.scratch.owner<{ userId: string; kind: string; entity: string }[]>`
        select user_id as "userId", kind, entity from sineobex.user_notices where record_id = ${recordId}
        order by created_at, id`;

    const late = { outcome: 'history_only', problem: 'encounter_has_finished_note' };

    it('once a note is finished, a change to the patient, place or summary is kept in history, and the sender is told', async () => {
      const [first, second] = [
        await createPatient(h, t.teamId, t.adminId),
        await createPatient(h, t.teamId, t.adminId),
      ];
      const encounterId = await encounterOf(ash, first.id);
      await finish(await noteOn(ash, encounterId));
      const before = await encounterRow(encounterId);

      const mark = await auditMark(h);
      const changes = [
        await setOn(bo, encounterId, 'summary', 'Demo: written after the note was done', 0),
        await setOn(bo, encounterId, 'locationText', 'Demo: south parking lot', 1),
        await setOn(bo, encounterId, 'location', { lat: 42.3, lng: -83.0 }, 1),
        await setOn(bo, encounterId, 'patientId', second.id, 1),
        // The answer to a conflict, which saw the value it replaces, is kept all the same.
        await setOn(bo, encounterId, 'locationText', 'Demo: by the clinic van', 1, { resolution: 'replace' }),
      ];
      const answered = await bo.send(...changes);
      const held = { summary: null, locationText: null, location: null, patientId: first.id };
      expect(answered).toEqual(
        changes.map((c) => ({
          changeId: c.changeId,
          status: 'accepted',
          serverVersion: c.field === 'summary' ? 0 : 1,
          hash: c.valueHash,
          server: expect.objectContaining({
            value: held[c.field as keyof typeof held],
            version: c.field === 'summary' ? 0 : 1,
          }),
          details: late,
        })),
      );
      expect(await encounterRow(encounterId)).toEqual(before);
      const kept = await h.scratch.owner<{ field: string; value: unknown; kind: string }[]>`
        select field, value, kind from sineobex.field_history
        where record_id = ${encounterId} and kind <> 'created' order by id`;
      expect(kept).toEqual(changes.map((c) => ({ field: c.field, value: c.value, kind: 'kept_both' })));
      expect(await noticesOn(encounterId)).toEqual(
        changes.map(() => ({ userId: bo.id, kind: 'late_change_kept', entity: 'encounter' })),
      );
      const events = await expectAudit(h, 'encounter.kept_in_history', {
        after: mark,
        count: changes.length,
      });
      expect(events.map((e) => e.details)).toEqual(
        changes.map((c) =>
          expect.objectContaining({
            changeId: c.changeId,
            field: c.field,
            problem: 'encounter_has_finished_note',
          }),
        ),
      );
      expect(events.every((e) => e.patientId === first.id)).toBe(true);
      await expectAudit(h, 'encounter.updated', { after: mark, count: 0 });

      // Sent twice, it answers the same, and nothing more is kept or told.
      expect(await bo.send(...changes)).toEqual(answered);
      expect(await noticesOn(encounterId)).toHaveLength(changes.length);
      await expectAudit(h, 'encounter.kept_in_history', { after: mark, count: changes.length });
    });

    it('a signed visit keeps a late change too, and takes a new note: an encounter is never locked whole', async () => {
      const dana = await clinician('dana.e@example.com', 'Dana E (demo)', 'attending');
      const p = await createPatient(h, t.teamId, t.adminId);
      const encounterId = await encounterOf(dana, p.id);
      await sign(await noteOn(dana, encounterId, TEST_MEDICAL));
      expect(await encounterRow(encounterId)).toMatchObject({ status: 'signed' });
      const summary = await setOn(dana, encounterId, 'summary', 'Demo: one more line', 0);
      expect(await dana.send(summary)).toEqual([
        expect.objectContaining({ status: 'accepted', serverVersion: 0, details: late }),
      ]);
      expect(await noticesOn(encounterId)).toEqual([
        { userId: dana.id, kind: 'late_change_kept', entity: 'encounter' },
      ]);
      // The note is the unit (4.4): a teammate's new note on the signed visit is taken, and the visit
      // is a draft again while it is.
      await noteOn(ash, encounterId);
      expect(await encounterRow(encounterId)).toMatchObject({ status: 'draft' });
    });

    it('while every note of the visit is a draft, the draft rule applies; another visit’s finished note is no lock', async () => {
      const finished = await encounterOf(ash);
      await finish(await noteOn(ash, finished));
      const open = await encounterOf(ash);
      await noteOn(ash, open);
      const summary = await setOn(ash, open, 'summary', 'Demo: still writing', 0);
      expect(await ash.send(summary)).toEqual([
        { changeId: summary.changeId, status: 'accepted', serverVersion: 1, hash: summary.valueHash },
      ]);
      expect(await encounterRow(open)).toMatchObject({ summary: 'Demo: still writing' });
      expect(await noticesOn(open)).toEqual([]);
    });

    it('the kind still goes to Medical after a finished note, and still never back', async () => {
      const create = await ash.phone.change({
        entity: 'encounter',
        op: 'create',
        value: { kind: 'non_medical' },
      });
      expect((await ash.send(create)).map((r) => r.status)).toEqual(['accepted']);
      await finish(await noteOn(ash, create.recordId));
      const medical = await setOn(ash, create.recordId, 'kind', 'medical', 1);
      const back = await setOn(ash, create.recordId, 'kind', 'non_medical', 2);
      expect(await ash.send(medical, back)).toEqual([
        { changeId: medical.changeId, status: 'accepted', serverVersion: 2, hash: medical.valueHash },
        expect.objectContaining({ details: { outcome: 'history_only', problem: 'kind_cannot_go_back' } }),
      ]);
      expect(await encounterRow(create.recordId)).toMatchObject({ kind: 'medical' });
      expect(await noticesOn(create.recordId)).toEqual([]);
    });

    it('a visit with no patient can be given one after a finished note; one with the same value is no change', async () => {
      const p = await createPatient(h, t.teamId, t.adminId);
      const encounterId = await encounterOf(ash);
      await finish(await noteOn(ash, encounterId));
      // Bo never saw the blank (version 0): a blank holds nothing to overwrite.
      const named = await setOn(bo, encounterId, 'patientId', p.id, 0);
      const same = await setOn(bo, encounterId, 'locationText', null, 0);
      expect(await bo.send(named, same)).toEqual([
        { changeId: named.changeId, status: 'accepted', serverVersion: 2, hash: named.valueHash },
        { changeId: same.changeId, status: 'accepted', serverVersion: 1, hash: same.valueHash },
      ]);
      expect(await encounterRow(encounterId)).toMatchObject({ patientId: p.id });
      expect((await historyOf(encounterId, 'patientId')).map((r) => r.kind)).toEqual([
        'created',
        'filled_blank',
      ]);
      expect(await noticesOn(encounterId)).toEqual([]);
      // Named now, it is held like the rest of the envelope.
      const other = await createPatient(h, t.teamId, t.adminId);
      const moved = await setOn(bo, encounterId, 'patientId', other.id, 2);
      expect(await bo.send(moved)).toEqual([expect.objectContaining({ status: 'accepted', details: late })]);
      expect(await encounterRow(encounterId)).toMatchObject({ patientId: p.id });
    });

    it('a patient is never taken off a visit', async () => {
      const p = await createPatient(h, t.teamId, t.adminId);
      const named = await encounterOf(ash, p.id);
      const off = await setOn(ash, named, 'patientId', null, 1);
      const [kept] = await ash.send(off);
      expect(kept).toEqual({
        changeId: off.changeId,
        status: 'accepted',
        serverVersion: 1,
        hash: off.valueHash,
        server: expect.objectContaining({ value: p.id, version: 1 }),
        details: { outcome: 'history_only', problem: 'patient_cannot_be_removed' },
      });
      expect(await encounterRow(named)).toMatchObject({ patientId: p.id });
      expect(await noticesOn(named)).toEqual([]);
      // A move to another patient, before any note is finished, is the draft rule's.
      const other = await createPatient(h, t.teamId, t.adminId);
      const moved = await setOn(ash, named, 'patientId', other.id, 1);
      expect((await ash.send(moved)).map((r) => [r.status, r.serverVersion])).toEqual([['accepted', 2]]);
      // Nobody to take off: nothing changes.
      const nobody = await encounterOf(ash);
      const none = await setOn(ash, nobody, 'patientId', null, 1);
      expect(await ash.send(none)).toEqual([
        { changeId: none.changeId, status: 'accepted', serverVersion: 1, hash: none.valueHash },
      ]);
    });

    it('a visit moves its patient’s last seen to when it started: later only, and never past the server’s clock', async () => {
      const lastSeen = async (id: string) =>
        (
          await h.scratch.owner<
            { at: Date }[]
          >`select last_seen_at as at from sineobex.patients where id = ${id}`
        )[0]!.at.toISOString();
      const earlier = new Date('2026-10-01T10:00:00.000Z');
      const p = await createPatient(h, t.teamId, t.adminId, { at: earlier });
      const visit = (patientId: string | null, time: { deviceTime?: string; correctedTime?: string }) =>
        ash.phone.change({
          entity: 'encounter',
          op: 'create',
          value: { kind: 'medical', ...(patientId ? { patientId } : {}) },
          ...time,
        });

      // Started later than it was last seen (clock-corrected time): moved to the start.
      const seen = await visit(p.id, { correctedTime: '2026-10-20T14:30:04.000Z' });
      // Started earlier: not moved back. Stamped after the server's clock (15:00): not moved.
      const older = await visit(p.id, { correctedTime: '2026-10-15T09:00:00.000Z' });
      const ahead = await visit(p.id, { deviceTime: '2026-10-21T09:00:00.000Z' });
      expect((await ash.send(seen, older, ahead)).map((r) => r.status)).toEqual([
        'accepted',
        'accepted',
        'accepted',
      ]);
      expect(await lastSeen(p.id)).toBe('2026-10-20T14:30:04.000Z');

      // A patient set that applies moves the new patient's last seen to the visit's start.
      const q = await createPatient(h, t.teamId, t.adminId, { at: earlier });
      const unnamed = await visit(null, { correctedTime: '2026-10-19T12:00:00.000Z' });
      expect((await ash.send(unnamed)).map((r) => r.status)).toEqual(['accepted']);
      await finish(await noteOn(ash, unnamed.recordId));
      const named = await setOn(ash, unnamed.recordId, 'patientId', q.id, 1);
      expect((await ash.send(named)).map((r) => r.status)).toEqual(['accepted']);
      expect(await lastSeen(q.id)).toBe('2026-10-19T12:00:00.000Z');

      // One kept in history moves nothing.
      const r = await createPatient(h, t.teamId, t.adminId, { at: earlier });
      const moved = await setOn(ash, unnamed.recordId, 'patientId', r.id, 2);
      expect(await ash.send(moved)).toEqual([expect.objectContaining({ details: late })]);
      expect(await lastSeen(r.id)).toBe(earlier.toISOString());
    });
  });

  describe('a finished note, and its reopen (lifecycle 4.4)', () => {
    let gil: Awaited<ReturnType<typeof clinician>>;
    let hal: Awaited<ReturnType<typeof clinician>>;
    let ivy: Awaited<ReturnType<typeof clinician>>;
    let patientId: string;

    beforeAll(async () => {
      gil = await clinician('gil@example.com', 'Gil (demo)', 'attending');
      hal = await clinician('hal@example.com', 'Hal (demo)', 'resident');
      ivy = await clinician('ivy@example.com', 'Ivy (demo)', 'student');
      patientId = (await createPatient(h, t.teamId, t.adminId)).id;
    });

    type Who = Awaited<ReturnType<typeof clinician>>;

    /** A visit of the patient with one draft note of [type], on the chart. */
    async function noteBy(c: Who, type: object = TEST_NOTE, data: Record<string, unknown> = {}) {
      const encounterId = await encounterOf(c, patientId);
      const create = await c.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId, ...type, data: { 'care.plan': 'Demo: rest and fluids', ...data } },
      });
      expect((await c.send(create)).map((r) => r.status)).toEqual(['accepted']);
      return { encounterId, noteId: create.recordId };
    }

    /** Completed and never signed, as a sign-off with effect `completed` or `saved_unsigned` leaves it. */
    const complete = (noteId: string) => h.scratch.owner`
      update sineobex.encounter_notes set status = 'completed', completed_at = now(), completed_by = author_user_id
      where id = ${noteId}`;

    /** Signed as the database requires (0018, 0019): the sign-off row first, then the note. */
    async function signed(noteId: string) {
      const signoffId = randomUUID();
      await h.scratch.owner`
        insert into sineobex.note_signoffs (id, team_id, note_id, act, effect, content_hash, signer_user_id,
          signer_name, signer_credential, needs_attestation, statement_version, signed_at, clock_verified)
        select ${signoffId}, team_id, id, 'sign', 'signed', ${'ef'.repeat(32)}, author_user_id, 'Demo Signer',
          'attending', false, 'demo-1', now(), true
        from sineobex.encounter_notes where id = ${noteId}`;
      await h.scratch.owner`
        update sineobex.encounter_notes
        set status = 'signed', completed_at = now(), completed_by = author_user_id, first_signed_at = now(),
            signoff_id = ${signoffId}
        where id = ${noteId}`;
    }

    const setOn = (c: Who, noteId: string, field: string, value: unknown, baseVersion = 1, more = {}) =>
      c.phone.change({
        entity: 'encounter_note',
        recordId: noteId,
        op: 'set',
        field,
        value,
        baseVersion,
        ...more,
      });

    const noteState = async (id: string) =>
      (
        await h.scratch.owner<
          {
            status: string;
            completedAt: Date | null;
            completedBy: string | null;
            version: number;
            data: Record<string, unknown>;
            fieldVersions: Record<string, number>;
          }[]
        >`
          select status, completed_at as "completedAt", completed_by as "completedBy", version, data,
                 field_versions as "fieldVersions"
          from sineobex.encounter_notes where id = ${id}`
      )[0]!;

    const noticesOn = (recordId: string) =>
      h.scratch.owner<{ userId: string; kind: string; entity: string }[]>`
        select user_id as "userId", kind, entity from sineobex.user_notices where record_id = ${recordId}
        order by created_at, id`;

    /** Who was told what about a record, in no order: two notices of one change share a time. */
    const told = async (recordId: string) =>
      (await noticesOn(recordId)).map((n) => `${n.userId} ${n.kind}`).sort();

    const historyOf = (id: string, field: string) =>
      h.scratch.owner<{ version: number; value: unknown; previousValue: unknown; kind: string }[]>`
        select version, value, previous_value as "previousValue", kind from sineobex.field_history
        where record_id = ${id} and field = ${field} and kind <> 'created' order by id`;

    /** Kept in history, not applied: the field as the note holds it, and why. */
    const kept = (c: Change, value: unknown, version: number, problem: string) => ({
      changeId: c.changeId,
      status: 'accepted',
      serverVersion: version,
      hash: c.valueHash,
      server: expect.objectContaining({ value, version }),
      details: { outcome: 'history_only', problem },
    });
    const taken = (c: Change, serverVersion: number) => ({
      changeId: c.changeId,
      status: 'accepted',
      serverVersion,
      hash: c.valueHash,
    });

    it('a late change to a finished note is kept in history: the sender is told, and the author when it is someone else', async () => {
      const { noteId } = await noteBy(gil, TEST_MEDICAL);
      await complete(noteId);
      const before = await noteState(noteId);

      const mark = await auditMark(h);
      const theirs = [
        await setOn(hal, noteId, 'data.care.plan', 'Demo: written after it was done'),
        await setOn(hal, noteId, 'data.vitals.pulse', 90, 0),
      ];
      const own = await setOn(gil, noteId, 'data.care.plan', 'Demo: the author, late');
      const answered = [...(await hal.send(...theirs)), ...(await gil.send(own))];
      expect(answered).toEqual([
        kept(theirs[0]!, 'Demo: rest and fluids', 1, 'note_finished'),
        kept(theirs[1]!, null, 0, 'note_finished'),
        kept(own, 'Demo: rest and fluids', 1, 'note_finished'),
      ]);
      expect(await noteState(noteId)).toEqual(before);
      expect(await historyOf(noteId, 'data.care.plan')).toEqual([
        { version: 1, value: theirs[0]!.value, previousValue: 'Demo: rest and fluids', kind: 'kept_both' },
        { version: 1, value: own.value, previousValue: 'Demo: rest and fluids', kind: 'kept_both' },
      ]);
      // Each person once a change: the sender, and the acting author when the sender is someone else.
      expect(await told(noteId)).toEqual(
        [hal.id, gil.id, hal.id, gil.id, gil.id].map((id) => `${id} late_change_kept`).sort(),
      );
      expect((await noticesOn(noteId)).every((n) => n.entity === 'encounter_note')).toBe(true);
      const events = await expectAudit(h, 'note.kept_in_history', { after: mark, count: 3 });
      expect(events.map((e) => e.details)).toEqual(
        [...theirs, own].map((c) =>
          expect.objectContaining({ changeId: c.changeId, field: c.field, problem: 'note_finished' }),
        ),
      );
      expect(events.every((e) => e.patientId === patientId)).toBe(true);
      await expectAudit(h, 'note.updated', { after: mark, count: 0 });

      // Sent twice, it answers the same, and nothing more is kept or told.
      expect([...(await hal.send(...theirs)), ...(await gil.send(own))]).toEqual(answered);
      expect(await noticesOn(noteId)).toHaveLength(5);
    });

    it('a signed note keeps a late change as a completed one does: record_locked is gone', async () => {
      const { noteId } = await noteBy(gil, TEST_MEDICAL);
      await signed(noteId);
      const late = await setOn(gil, noteId, 'data.care.plan', 'Demo: after signing');
      expect(await gil.send(late)).toEqual([kept(late, 'Demo: rest and fluids', 1, 'note_finished')]);
      expect(await noticesOn(noteId)).toEqual([
        { userId: gil.id, kind: 'late_change_kept', entity: 'encounter_note' },
      ]);
    });

    it('the person who acts as the author is the one told: the assignee, once a note is assigned', async () => {
      const { noteId } = await noteBy(gil, TEST_MEDICAL);
      await complete(noteId);
      await h.scratch
        .owner`update sineobex.encounter_notes set assigned_user_id = ${hal.id} where id = ${noteId}`;
      const late = await setOn(ivy, noteId, 'data.care.plan', 'Demo: from Ivy');
      const assignees = await setOn(hal, noteId, 'data.care.plan', 'Demo: from Hal');
      expect((await ivy.send(late)).map((r) => r.details)).toEqual([
        { outcome: 'history_only', problem: 'note_finished' },
      ]);
      expect((await hal.send(assignees)).map((r) => r.details)).toEqual([
        { outcome: 'history_only', problem: 'note_finished' },
      ]);
      expect(await told(noteId)).toEqual(
        [ivy.id, hal.id, hal.id].map((id) => `${id} late_change_kept`).sort(),
      );
    });

    it('a late change is kept before its answer is checked, and says nothing of whether it would count', async () => {
      const { noteId } = await noteBy(gil, TEST_NOTE, { 'more.none': true });
      await complete(noteId);
      const changes = [
        // Refused on a draft: the type takes no such value, or has no such path.
        await setOn(gil, noteId, 'data.vitals.pulse', 'fast', 0),
        await setOn(gil, noteId, 'data.vitals.bp', 120, 0),
        // Taken on a draft with notCounted: hidden while "Nothing more" is ticked.
        await setOn(gil, noteId, 'data.more.detail', 'Demo: one more thing', 0),
      ];
      expect(await gil.send(...changes)).toEqual(changes.map((c) => kept(c, null, 0, 'note_finished')));
      // Phase 2's open pattern still answers first, before the note is loaded.
      const badPath = await setOn(gil, noteId, 'data.Vitals', 1, 0);
      expect(await gil.send(badPath)).toEqual([
        expect.objectContaining({ status: 'rejected', details: { problem: 'unknown_field' } }),
      ]);
    });

    it('a late change goes through the draft rule’s first steps: the same value, and the answer to a conflict', async () => {
      const { noteId } = await noteBy(gil, TEST_NOTE);
      await complete(noteId);
      // The value the note holds: nothing to keep and nobody to tell.
      const same = await setOn(hal, noteId, 'data.care.plan', 'Demo: rest and fluids', 0);
      // The person kept the note's value: phase 2's keep_server, which applies nothing.
      const keep = await setOn(hal, noteId, 'data.care.plan', 'Demo: theirs', 1, {
        resolution: 'keep_server',
      });
      // The person chose their own value: kept in history all the same.
      const replace = await setOn(hal, noteId, 'data.care.plan', 'Demo: theirs', 1, {
        resolution: 'replace',
      });
      expect(await hal.send(same, keep, replace)).toEqual([
        taken(same, 1),
        taken(keep, 1),
        kept(replace, 'Demo: rest and fluids', 1, 'note_finished'),
      ]);
      expect((await noteState(noteId)).data).toEqual({ 'care.plan': 'Demo: rest and fluids' });
      // The keep_server answer tells the author as phase 2's draft rule does; the kept value, both.
      expect(await told(noteId)).toEqual(
        [`${gil.id} conflict_resolved`, `${gil.id} late_change_kept`, `${hal.id} late_change_kept`].sort(),
      );
    });

    it('a late change at a new path is kept however many answers the note holds', async () => {
      // A finished note at the bound, written as a create of MAX_NOTE_FIELDS answers leaves it.
      const encounterId = await encounterOf(gil, patientId);
      const noteId = randomUUID();
      const paths = Array.from(
        { length: MAX_NOTE_FIELDS },
        (_, i) => `rows.e${String(i).padStart(7, '0')}.n`,
      );
      await h.scratch.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, note_type_version,
          author_user_id, data, field_versions, status, completed_at, completed_by)
        values (${noteId}, ${t.teamId}, ${encounterId}, 'test_note', 1, ${gil.id},
          ${h.scratch.owner.json(Object.fromEntries(paths.map((p, i) => [p, i])))},
          ${h.scratch.owner.json(Object.fromEntries([['status', 1], ...paths.map((p) => [`data.${p}`, 1])]))},
          'completed', now(), ${gil.id})`;
      const late = await setOn(gil, noteId, 'data.care.plan', 'Demo: one more', 0);
      expect(await gil.send(late)).toEqual([kept(late, null, 0, 'note_finished')]);
    });

    describe('the reopen: a set of status to draft', () => {
      const reopen = (c: Who, noteId: string, baseVersion = 1, more = {}) =>
        setOn(c, noteId, 'status', 'draft', baseVersion, more);

      it('applies for the author of a Medical note that waits for a co-signer and was never signed', async () => {
        const { encounterId, noteId } = await noteBy(gil, TEST_MEDICAL);
        await complete(noteId);
        const encounterStatus = async () =>
          (
            await h.scratch.owner<{ status: string }[]>`
              select status from sineobex.encounters where id = ${encounterId}`
          )[0]!.status;
        expect(await encounterStatus()).toBe('completed');

        const mark = await auditMark(h);
        // The phone holds the status at its own version: a reopen never conflicts.
        const back = await reopen(gil, noteId, 0);
        expect(await gil.send(back)).toEqual([taken(back, 2)]);
        expect(await noteState(noteId)).toMatchObject({
          status: 'draft',
          completedAt: null,
          completedBy: null,
          fieldVersions: { status: 2 },
        });
        expect(await encounterStatus()).toBe('draft');
        expect(await historyOf(noteId, 'status')).toEqual([
          { version: 2, value: 'draft', previousValue: 'completed', kind: 'set' },
        ]);
        const [event] = await expectAudit(h, 'note.reopened', { after: mark, count: 1 });
        expect(event).toMatchObject({ patientId, details: { changeId: back.changeId } });
        await expectAudit(h, 'note.updated', { after: mark, count: 0 });
        expect(await noticesOn(noteId)).toEqual([]);

        // Now a draft: a reopen from anyone changes nothing, and the draft rule is back.
        const again = await reopen(hal, noteId, 0);
        const edit = await setOn(gil, noteId, 'data.care.plan', 'Demo: one more look');
        expect(await hal.send(again)).toEqual([taken(again, 2)]);
        expect(await gil.send(edit)).toEqual([taken(edit, 2)]);
        expect(await historyOf(noteId, 'status')).toHaveLength(1);
        // Sent twice, it answers the same.
        expect(await gil.send(back)).toEqual([taken(back, 2)]);
      });

      it('keeps the rest in history: a note ever signed, a completed Non-Medical note, and someone else’s reopen', async () => {
        const signedNote = (await noteBy(gil, TEST_MEDICAL)).noteId;
        await signed(signedNote);
        // A student's correction leaves a co-signed note completed: it was signed once.
        const onceSigned = (await noteBy(gil, TEST_MEDICAL)).noteId;
        await h.scratch.owner`
          update sineobex.encounter_notes
          set status = 'completed', completed_at = now(), completed_by = author_user_id, first_signed_at = now()
          where id = ${onceSigned}`;
        const nonMedical = (await noteBy(gil, TEST_NOTE)).noteId;
        await complete(nonMedical);
        const waiting = (await noteBy(gil, TEST_MEDICAL)).noteId;
        await complete(waiting);

        const mark = await auditMark(h);
        const own = [
          await reopen(gil, signedNote),
          await reopen(gil, onceSigned),
          await reopen(gil, nonMedical),
        ];
        const theirs = [
          await reopen(hal, signedNote),
          await reopen(hal, nonMedical),
          await reopen(hal, waiting),
        ];
        const answered = [...(await gil.send(...own)), ...(await hal.send(...theirs))];
        expect(answered).toEqual([
          kept(own[0]!, 'signed', 1, 'note_finished'),
          kept(own[1]!, 'completed', 1, 'note_finished'),
          kept(own[2]!, 'completed', 1, 'note_finished'),
          kept(theirs[0]!, 'signed', 1, 'note_finished'),
          kept(theirs[1]!, 'completed', 1, 'note_finished'),
          kept(theirs[2]!, 'completed', 1, 'not_author'),
        ]);
        for (const id of [signedNote, onceSigned, nonMedical, waiting]) {
          expect((await noteState(id)).status).not.toBe('draft');
          expect(await historyOf(id, 'status')).toEqual(
            expect.arrayContaining([expect.objectContaining({ value: 'draft', kind: 'kept_both' })]),
          );
        }
        const late = (...ids: string[]) => ids.map((id) => `${id} late_change_kept`).sort();
        expect(await told(signedNote)).toEqual(late(gil.id, hal.id, gil.id));
        expect(await told(onceSigned)).toEqual(late(gil.id));
        expect(await told(nonMedical)).toEqual(late(gil.id, hal.id, gil.id));
        // "Only the note’s author can do that. Nothing was changed.": to the sender alone.
        expect(await noticesOn(waiting)).toEqual([
          { userId: hal.id, kind: 'change_not_applied', entity: 'encounter_note' },
        ]);
        await expectAudit(h, 'note.kept_in_history', { after: mark, count: 6 });
        await expectAudit(h, 'note.reopened', { after: mark, count: 0 });
        expect([...(await gil.send(...own)), ...(await hal.send(...theirs))]).toEqual(answered);
      });

      it('the acting author reopens: the assignee once a note is assigned, and no longer its writer', async () => {
        const { noteId } = await noteBy(gil, TEST_MEDICAL);
        await complete(noteId);
        await h.scratch
          .owner`update sineobex.encounter_notes set assigned_user_id = ${hal.id} where id = ${noteId}`;
        const writers = await reopen(gil, noteId);
        const assignees = await reopen(hal, noteId);
        expect(await gil.send(writers)).toEqual([kept(writers, 'completed', 1, 'not_author')]);
        expect(await hal.send(assignees)).toEqual([taken(assignees, 2)]);
        expect((await noteState(noteId)).status).toBe('draft');
      });

      it('a status of completed is kept in history: Complete is a sign-off, and nothing else finishes a note', async () => {
        const draft = (await noteBy(gil, TEST_MEDICAL)).noteId;
        const done = (await noteBy(gil, TEST_NOTE)).noteId;
        await complete(done);
        const changes = [
          await setOn(gil, draft, 'status', 'completed'),
          await setOn(gil, done, 'status', 'completed'),
        ];
        expect(await gil.send(...changes)).toEqual([
          kept(changes[0]!, 'draft', 1, 'use_signoff'),
          kept(changes[1]!, 'completed', 1, 'use_signoff'),
        ]);
        expect((await noteState(draft)).status).toBe('draft');
        expect(await noticesOn(draft)).toEqual([]);
        expect(await noticesOn(done)).toEqual([]);
      });

      it('a status set never conflicts, so there is nothing to resolve', async () => {
        const { noteId } = await noteBy(gil, TEST_MEDICAL);
        await complete(noteId);
        const answers = [
          await reopen(gil, noteId, 1, { resolution: 'replace' }),
          await reopen(gil, noteId, 1, { resolution: 'keep_server' }),
        ];
        expect(await gil.send(...answers)).toEqual(
          answers.map((c) =>
            expect.objectContaining({
              changeId: c.changeId,
              status: 'rejected',
              reason: 'validation',
              details: { problem: 'nothing_to_resolve' },
            }),
          ),
        );
        expect((await noteState(noteId)).status).toBe('completed');
      });
    });
  });

  describe('offline reads of a visit (lifecycle 4.8, 10.1)', () => {
    it('the EMS handoff shown and the notes to finish are reads a phone logs offline, each naming its patients', async () => {
      const ash = await clinician('offline-reads@example.com', 'Ash (demo)', 'resident');
      const p = await createPatient(h, t.teamId, ash.id);
      const encounterId = await encounterOf(ash, p.id);
      const mark = await auditMark(h);
      const shown = await ash.phone.change({
        entity: 'audit',
        op: 'append',
        value: { action: 'ems_handoff.shown', entity: 'encounter', entityId: encounterId, patientId: p.id },
      });
      const others = [randomUUID(), randomUUID()];
      const listed = await ash.phone.change({
        entity: 'audit',
        op: 'append',
        value: { action: 'notes_to_finish.viewed', patientIds: [p.id, ...others], resultCount: 3 },
      });
      // The export is the online route's (5.7): a phone never logs it.
      const exported = await ash.phone.change({
        entity: 'audit',
        op: 'append',
        value: {
          action: 'ems_handoff.exported',
          entity: 'encounter',
          entityId: encounterId,
          patientId: p.id,
        },
      });
      const [a, b, c] = await ash.send(shown, listed, exported);
      expect([a!.status, b!.status]).toEqual(['accepted', 'accepted']);
      expect(c).toMatchObject({ status: 'rejected', reason: 'validation' });

      const [handoff] = await expectAudit(h, 'ems_handoff.shown', { after: mark, patientId: p.id, count: 1 });
      expect(handoff).toMatchObject({ actorUserId: ash.id, entity: 'encounter', entityId: encounterId });
      expect(handoff!.details).toMatchObject({ offline: true, changeId: shown.changeId });
      const [list] = await expectAudit(h, 'notes_to_finish.viewed', { after: mark, count: 1 });
      expect(list!.details).toMatchObject({ offline: true, patientIds: [p.id, ...others], resultCount: 3 });
      await expectAudit(h, 'ems_handoff.exported', { after: mark, count: 0 });
    });
  });

  describe('the team lock (lifecycle 4.2)', () => {
    it('every encounter, note and sign-off change takes it first, a create naming no patient included', () => {
      const change = (c: Partial<Change> & Pick<Change, 'entity' | 'op' | 'value'>) =>
        ({
          changeId: randomUUID(),
          seq: 1,
          recordId: randomUUID(),
          baseVersion: 0,
          valueHash: '',
          deviceTime: '',
          clockVerified: true,
          ...c,
        }) as Change;
      const encounterId = randomUUID();
      const changes = [
        change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } }),
        change({
          entity: 'encounter',
          op: 'create',
          value: { kind: 'non_medical', patientId: randomUUID() },
        }),
        change({ entity: 'encounter', op: 'create', value: null }),
        ...['patientId', 'location', 'locationText', 'summary', 'status', 'kind'].map((field) =>
          change({ entity: 'encounter', op: 'set', field, value: null }),
        ),
        change({ entity: 'encounter_note', op: 'create', value: { encounterId, ...TEST_NOTE } }),
        change({ entity: 'encounter_note', op: 'set', field: 'data.vitals.pulse', value: 80 }),
        change({ entity: 'encounter_note', op: 'set', field: 'status', value: 'draft' }),
        // A sign-off writes the note and, through the trigger of 0018, the visit.
        change({ entity: 'note_signoff', op: 'create', value: { noteId: randomUUID(), act: 'sign' } }),
        change({ entity: 'note_signoff', op: 'create', value: null }),
      ];
      expect(changes.map((c) => takesTeamLock(c as never))).toEqual(changes.map(() => true));
    });

    it('an encounter naming no patient waits for another writer of the team before it writes', async () => {
      // Every audited write waits for the same lock at its audit event; taken first, the push waits
      // before it has written or locked anything of the encounter.
      const phone = await FakePhone.create();
      await register(h, phone, t.aToken, t.teamId);
      const encounter = await phone.change({ entity: 'encounter', op: 'create', value: { kind: 'medical' } });
      const other = await h.scratch.owner.reserve();
      try {
        await other`begin`;
        await other`set local lock_timeout = '3s'`;
        await other`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${t.teamId}::uuid::text, 0))`;
        const pushing = push(h, phone, t.aToken, t.teamId, [encounter]);
        let waiting: { pid: number } | undefined;
        for (let i = 0; i < 400 && !waiting; i++) {
          [waiting] = await h.scratch.owner<{ pid: number }[]>`
            select pid from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
          if (!waiting) await new Promise((r) => setTimeout(r, 10));
        }
        expect(waiting).toBeDefined();
        const [held] = await h.scratch.owner<{ n: number }[]>`
          select count(*)::int as n from pg_locks
          where pid = ${waiting!.pid} and relation = 'sineobex.encounters'::regclass`;
        expect(held!.n).toBe(0);
        await other`commit`;
        expect(results((await pushing).body).map((r) => r.status)).toEqual(['accepted']);
      } finally {
        await other`rollback`.catch(() => {});
        other.release();
      }
    });
  });
});
