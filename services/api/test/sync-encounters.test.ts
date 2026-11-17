import { randomUUID } from 'node:crypto';
import { canonicalJson, checkAnswer, sha256Hex, validate } from '@sineobex/forms';
import { checkFile } from '@sineobex/forms/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/db/database.ts';
import { chartsMedical, credentialChangesAfter, loadSigner } from '../src/encounters/signer.ts';
import { takesTeamLock } from '../src/sync/entities/index.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit } from './patient-fixtures.ts';
import {
  addMember,
  call,
  CREDENTIAL_FIELDS,
  FakePhone,
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

    beforeAll(async () => {
      doc = await clinician('doc@example.com', 'Dana (demo)', 'attending');
      student = await clinician('stu@example.com', 'Sol (demo)', 'student');
      // Both chart (healthcare_staff holds encounters.chart); neither credential charts Medical.
      outreach = await clinician('kim@example.com', 'Kim (demo)', 'chw');
      plain = await clinician('lee@example.com', 'Lee (demo)', 'none');
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
      const encounterId = await encounterOf(doc);
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

    it('a Non-Medical note, and a note with no version, are not gated and are not Medical', async () => {
      const encounterId = await encounterOf(doc);
      const typed = await noteCreate(plain, encounterId, TEST_NOTE, { 'care.plan': 'Demo: rest' });
      const unversioned = await plain.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId, noteTypeKey: 'test_medical' },
      });
      expect((await plain.send(typed, unversioned)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
      expect(await noteRow(typed.recordId)).toMatchObject({ medical: false });
      expect(await noteRow(unversioned.recordId)).toMatchObject({ medical: false });
      const edit = await answer(plain, typed.recordId, 'data.care.plan', 'Demo: fluids');
      expect((await plain.send(edit)).map((r) => r.status)).toEqual(['accepted']);
    });

    it('a set of an answer or of the status of a Medical note is held for someone who cannot chart Medical', async () => {
      const encounterId = await encounterOf(doc);
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
        expect(await who.send(pulse, status)).toEqual([
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
      const encounterId = await encounterOf(pat);
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
  });

  describe('the team lock (lifecycle 4.2)', () => {
    it('every encounter and note change takes it first, a create naming no patient included', () => {
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
