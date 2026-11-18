import {
  canonicalJson,
  checkAnswer,
  effectiveAnswers,
  finishCheck,
  PRESETS,
  sha256Hex,
  type Answers,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The API's own rules, pure functions all: the seed charts its visits as sync would, and these
// tests hold it to the rules sync applies rather than to a second copy of them.
import { CAPABILITIES, type Credential } from '../../services/api/src/auth/permissions.ts';
import { noteContentHash } from '../../services/api/src/encounters/content-hash.ts';
import {
  attestEffect,
  correctionEffect,
  encounterStatus,
  noteIsEmpty,
  signoffEffect,
  type Attestation,
  type NoteStatus,
} from '../../services/api/src/encounters/rules.ts';
import { demoVisitId } from '../seed/demo-encounters.ts';
import { demoPatientId, NEIGHBOUR_TEAM_ID } from '../seed/demo-patients.ts';
import { DEMO_TEAM_ID, seed } from '../seed/seed.ts';
import { migrate, setEnvironment } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';

// The demo visits of the seed (lifecycle card L2-seed; lifecycle 10.2, "Demo data only"). Made-up
// patients and staff only.

interface Visit {
  id: string;
  teamId: string;
  patientId: string | null;
  kind: string;
  status: string;
  authorUserId: string;
  startedAt: Date;
  clockVerified: boolean;
  locationText: string | null;
  summary: string | null;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, { by: string; at: string; changeId: string | null }>;
}

interface Note {
  id: string;
  encounterId: string;
  noteTypeKey: string;
  noteTypeVersion: number;
  medical: boolean;
  status: NoteStatus;
  attestation: Attestation;
  authorUserId: string;
  assignedUserId: string | null;
  data: Answers;
  completedAt: Date | null;
  completedBy: string | null;
  firstSignedAt: Date | null;
  signoffId: string | null;
  createdAt: Date;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, { by: string; at: string; changeId: string | null }>;
}

interface Signoff {
  id: string;
  noteId: string;
  act: 'complete' | 'sign' | 'cosign';
  effect: string;
  contentHash: string;
  signerUserId: string;
  signerName: string;
  signerCredential: Credential;
  signerNpi: string | null;
  signerFields: Record<string, string>;
  claimedCredential: Credential | null;
  needsAttestation: boolean;
  statementVersion: string;
  signedAt: Date;
  signedDeviceTime: Date | null;
  clockVerified: boolean;
  receivedAt: Date;
}

interface Correction {
  id: string;
  noteId: string;
  changes: { field: string; oldValue: unknown; newValue: unknown; historyId: string | null }[];
  outcome: string;
  reason: string;
  requestedByPatient: boolean;
  correctorUserId: string;
  correctorName: string;
  correctorCredential: Credential;
  claimedCredential: Credential | null;
  correctedAt: Date;
}

interface Attested {
  id: string;
  noteId: string;
  signoffId: string;
  contentHash: string;
  attendingUserId: string;
  attendingName: string;
  attendingNpi: string;
  attendingFields: Record<string, string>;
  statementVersion: string;
  attestedAt: Date;
}

interface Member {
  userId: string;
  email: string;
  displayName: string;
  credential: Credential;
  fields: Record<string, string>;
}

const visitsOf = (sql: Sql, teamId = DEMO_TEAM_ID) => sql<Visit[]>`
  select id, team_id as "teamId", patient_id as "patientId", kind, status, author_user_id as "authorUserId",
         started_at as "startedAt", clock_verified as "clockVerified", location_text as "locationText", summary,
         field_versions as "fieldVersions", field_meta as "fieldMeta"
  from sineobex.encounters where team_id = ${teamId} order by started_at, id`;

const notesOf = (sql: Sql) => sql<Note[]>`
  select id, encounter_id as "encounterId", note_type_key as "noteTypeKey", note_type_version as "noteTypeVersion",
         medical, status, attestation, author_user_id as "authorUserId", assigned_user_id as "assignedUserId", data,
         completed_at as "completedAt", completed_by as "completedBy", first_signed_at as "firstSignedAt",
         signoff_id as "signoffId", created_at as "createdAt", field_versions as "fieldVersions",
         field_meta as "fieldMeta"
  from sineobex.encounter_notes where team_id = ${DEMO_TEAM_ID} order by created_at, id`;

const signoffsOf = (sql: Sql) => sql<Signoff[]>`
  select id, note_id as "noteId", act, effect, content_hash as "contentHash", signer_user_id as "signerUserId",
         signer_name as "signerName", signer_credential as "signerCredential", signer_npi as "signerNpi",
         signer_fields as "signerFields", claimed_credential as "claimedCredential",
         needs_attestation as "needsAttestation", statement_version as "statementVersion", signed_at as "signedAt",
         signed_device_time as "signedDeviceTime", clock_verified as "clockVerified", received_at as "receivedAt"
  from sineobex.note_signoffs where team_id = ${DEMO_TEAM_ID} order by signed_at, id`;

const correctionsOf = (sql: Sql) => sql<Correction[]>`
  select id, note_id as "noteId", changes, outcome, reason, requested_by_patient as "requestedByPatient",
         corrector_user_id as "correctorUserId", corrector_name as "correctorName",
         corrector_credential as "correctorCredential", claimed_credential as "claimedCredential",
         corrected_at as "correctedAt"
  from sineobex.note_corrections where team_id = ${DEMO_TEAM_ID} order by corrected_at, id`;

const attestationsOf = (sql: Sql) => sql<Attested[]>`
  select id, note_id as "noteId", signoff_id as "signoffId", content_hash as "contentHash",
         attending_user_id as "attendingUserId", attending_name as "attendingName", attending_npi as "attendingNpi",
         attending_fields as "attendingFields", statement_version as "statementVersion", attested_at as "attestedAt"
  from sineobex.note_attestations where team_id = ${DEMO_TEAM_ID} order by attested_at, id`;

const membersOf = (sql: Sql) => sql<Member[]>`
  select u.id as "userId", u.email, u.display_name as "displayName", m.credential, m.credential_fields as fields
  from sineobex.team_memberships m join sineobex.users u on u.id = m.user_id
  where m.team_id = ${DEMO_TEAM_ID}`;

/** Every row the visits wrote, as JSON, so two runs of the seed can be compared whole. */
async function snapshotOf(sql: Sql): Promise<unknown> {
  const rows = (table: string, where = sql`team_id = ${DEMO_TEAM_ID}`) =>
    sql<{ row: unknown }[]>`select to_jsonb(t) as row from ${sql(`sineobex.${table}`)} t where ${where}
                            order by to_jsonb(t)::text`;
  return {
    encounters: await rows('encounters'),
    notes: await rows('encounter_notes'),
    signoffs: await rows('note_signoffs'),
    attestations: await rows('note_attestations'),
    corrections: await rows('note_corrections'),
    addenda: await rows('note_addenda'),
    history: await rows(
      'field_history',
      sql`team_id = ${DEMO_TEAM_ID} and entity in ('encounter', 'encounter_note')`,
    ),
    patients: await sql`select id, last_seen_at, updated_at from sineobex.patients order by id`,
    notices: await rows('user_notices'),
  };
}

/** The released definition of a note, as the team holds it. */
async function definitionsOf(sql: Sql): Promise<Map<string, ResolvedNoteType>> {
  const rows = await sql<{ key: string; version: number; definition: ResolvedNoteType }[]>`
    select key, version, definition from sineobex.note_type_versions where team_id = ${DEMO_TEAM_ID}`;
  return new Map(rows.map((r) => [`${r.key}@${r.version}`, r.definition]));
}

const MEDICAL = demoPatientId(15);
const OUTREACH = demoPatientId(24);
const WOUND = demoPatientId(21);

describe('demo visits in the seed', () => {
  let db: ScratchDatabase;
  let afterFirst: unknown;
  let lastSeenBefore: Map<string, Date>;
  let visits: Visit[];
  let notes: Note[];
  let signoffs: Signoff[];
  let corrections: Correction[];
  let attestations: Attested[];
  let members: Map<string, Member>;
  let definitions: Map<string, ResolvedNoteType>;
  const definitionOf = (n: Note) => definitions.get(`${n.noteTypeKey}@${n.noteTypeVersion}`)!;
  const visitOf = (n: Note) => visits.find((v) => v.id === n.encounterId)!;

  /** What the note held when it was signed: its answers now, with each later correction undone. */
  const answersAt = (n: Note, at: Date): Answers => {
    const answers: Record<string, unknown> = { ...n.data };
    const later = corrections.filter((c) => c.noteId === n.id && c.correctedAt > at).reverse();
    for (const c of later) {
      for (const ch of c.changes) {
        const path = ch.field.slice('data.'.length);
        if (ch.oldValue === null) delete answers[path];
        else answers[path] = ch.oldValue;
      }
    }
    return answers;
  };
  const hashOf = (n: Note, answers: Answers) => {
    const v = visitOf(n);
    return noteContentHash({
      noteId: n.id,
      encounterId: v.id,
      patientId: v.patientId,
      summary: v.summary,
      definition: definitionOf(n),
      answers,
    });
  };

  beforeAll(async () => {
    db = await createScratchDatabase();
    // The seeded patients' last seen, before any visit: a run with no note types charts nothing.
    await seed(db.owner, { presets: [] });
    lastSeenBefore = new Map(
      (
        await db.owner<{ id: string; lastSeen: Date }[]>`
          select id, last_seen_at as "lastSeen" from sineobex.patients`
      ).map((r) => [r.id, r.lastSeen]),
    );
    await seed(db.owner);
    afterFirst = await snapshotOf(db.owner);
    await seed(db.owner);
    visits = await visitsOf(db.owner);
    notes = await notesOf(db.owner);
    signoffs = await signoffsOf(db.owner);
    corrections = await correctionsOf(db.owner);
    attestations = await attestationsOf(db.owner);
    members = new Map((await membersOf(db.owner)).map((m) => [m.userId, m]));
    definitions = await definitionsOf(db.owner);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('charts a Medical visit, a Non-Medical outreach visit and a wound visit with a correction', () => {
    const shape = visits.map((v) => ({
      id: v.id,
      patientId: v.patientId,
      kind: v.kind,
      status: v.status,
      author: members.get(v.authorUserId)?.email,
      notes: notes
        .filter((n) => n.encounterId === v.id)
        .map((n) => ({
          key: n.noteTypeKey,
          version: n.noteTypeVersion,
          medical: n.medical,
          status: n.status,
          attestation: n.attestation,
          author: members.get(n.authorUserId)?.email,
          corrections: corrections.filter((c) => c.noteId === n.id).map((c) => c.outcome),
        })),
    }));
    expect(shape).toEqual([
      {
        id: demoVisitId(1),
        patientId: MEDICAL,
        kind: 'medical',
        status: 'signed',
        author: 'resident@example.com',
        notes: [
          {
            key: 'red_flags_disposition',
            version: 1,
            medical: true,
            status: 'signed',
            attestation: 'attested',
            author: 'resident@example.com',
            corrections: [],
          },
          {
            key: 'social_needs',
            version: 1,
            medical: false,
            status: 'completed',
            attestation: 'not_needed',
            author: 'resident@example.com',
            corrections: [],
          },
        ],
      },
      {
        id: demoVisitId(2),
        patientId: OUTREACH,
        kind: 'non_medical',
        status: 'completed',
        author: 'logistics@example.com',
        notes: [
          {
            key: 'outreach',
            version: 1,
            medical: false,
            status: 'completed',
            attestation: 'not_needed',
            author: 'logistics@example.com',
            corrections: [],
          },
        ],
      },
      {
        id: demoVisitId(3),
        patientId: WOUND,
        kind: 'medical',
        status: 'signed',
        author: 'clinician@example.com',
        notes: [
          {
            key: 'red_flags_disposition',
            version: 1,
            medical: true,
            status: 'signed',
            attestation: 'not_needed',
            author: 'clinician@example.com',
            corrections: [],
          },
          {
            key: 'wound_care',
            version: 1,
            medical: true,
            status: 'signed',
            attestation: 'not_needed',
            author: 'clinician@example.com',
            corrections: ['corrected'],
          },
        ],
      },
    ]);
    expect(attestations).toHaveLength(1);
  });

  it('changes nothing when it runs again', async () => {
    expect(await snapshotOf(db.owner)).toEqual(afterFirst);
  });

  it('puts no visit in the neighbouring team', async () => {
    expect(await visitsOf(db.owner, NEIGHBOUR_TEAM_ID)).toEqual([]);
  });

  it('charts on the released note types, each answer one its type takes', () => {
    for (const n of notes) {
      const released = PRESETS.find((p) => p.key === n.noteTypeKey && p.version === n.noteTypeVersion);
      expect(definitionOf(n), n.noteTypeKey).toEqual(released?.definition);
      for (const [path, value] of Object.entries(n.data)) {
        expect(checkAnswer(definitionOf(n), path, value), `${n.noteTypeKey} ${path}`).toBeNull();
      }
      expect(noteIsEmpty(n.data)).toBe(false);
      // A finished note holds only the answers that count (lifecycle 4.6), and passes its check.
      expect(n.data).toEqual(effectiveAnswers(definitionOf(n), n.data));
      expect(finishCheck(definitionOf(n), n.data)).toEqual([]);
      // Medical through its type (lifecycle 3.1).
      expect(n.medical).toBe(!definitionOf(n).kinds.includes('non_medical'));
    }
  });

  it('drops an answer that does not count when its note is signed', async () => {
    const redFlags = notes.find(
      (n) => n.encounterId === demoVisitId(3) && n.noteTypeKey === 'red_flags_disposition',
    )!;
    expect(Object.keys(redFlags.data)).not.toContain('red_flags.ems_activated');
    expect(redFlags.fieldVersions['data.red_flags.ems_activated']).toBe(2);
    const rows = await db.owner<{ version: number; value: unknown; previous: unknown }[]>`
      select version, value, previous_value as previous from sineobex.field_history
      where record_id = ${redFlags.id} and field = 'data.red_flags.ems_activated' order by version`;
    expect(rows).toEqual([
      { version: 1, value: 'no', previous: null },
      { version: 2, value: null, previous: 'no' },
    ]);
  });

  it('gives each visit the status its notes give it', () => {
    for (const v of visits) {
      const own = notes.filter((n) => n.encounterId === v.id);
      expect(v.status).toBe(
        encounterStatus(
          own.map((n) => ({ status: n.status, medical: n.medical, empty: noteIsEmpty(n.data) })),
        ),
      );
      expect(v.clockVerified).toBe(true);
    }
  });

  it('makes each sign-off as sync applies it', async () => {
    // One sign-off for each note: every note was finished once, by one Complete.
    expect(signoffs.map((s) => s.noteId).sort()).toEqual(notes.map((n) => n.id).sort());
    // The order sync applied them in: each note's history row for its status at version 2.
    const finished = new Map(
      (
        await db.owner<{ recordId: string; id: string }[]>`
          select record_id as "recordId", id::text from sineobex.field_history
          where team_id = ${DEMO_TEAM_ID} and entity = 'encounter_note' and field = 'status' and version = 2`
      ).map((r) => [r.recordId, BigInt(r.id)]),
    );
    for (const s of signoffs) {
      const n = notes.find((x) => x.id === s.noteId)!;
      const definition = definitionOf(n);
      const signer = members.get(s.signerUserId)!;
      const { npi, ...fields } = signer.fields;
      // The signer is loaded, not carried (lifecycle 4.2): name, credential, NPI and fields now.
      expect(s).toMatchObject({
        signerName: signer.displayName,
        signerCredential: signer.credential,
        signerNpi: npi ?? null,
        // What the phone sends: the credential its profile holds, for a signature.
        claimedCredential: s.act === 'sign' ? signer.credential : null,
        needsAttestation: CAPABILITIES[signer.credential].billingNeedsAttestation,
        statementVersion: s.act === 'sign' ? 'sign-2026-11' : 'complete-2026-11',
        clockVerified: true,
      });
      expect(s.signerFields).toEqual(fields);
      expect(s.signedDeviceTime).toEqual(s.signedAt);
      // A time the server believes (signedUnder): after the note, and not after its receipt.
      expect(s.signedAt.getTime()).toBeGreaterThanOrEqual(n.createdAt.getTime());
      expect(s.receivedAt.getTime()).toBeGreaterThanOrEqual(s.signedAt.getTime());

      const answers = answersAt(n, s.signedAt);
      expect(s.contentHash).toBe(await hashOf(n, answers));
      const redFlagsDone =
        definition.auto === 'medical' ||
        notes.some(
          (o) =>
            o.encounterId === n.encounterId &&
            o.id !== n.id &&
            definitionOf(o).auto === 'medical' &&
            finished.get(o.id)! < finished.get(n.id)!,
        );
      const effect = signoffEffect({
        noteStatus: 'draft',
        medicalNote: n.medical,
        act: s.act as 'complete' | 'sign',
        actsAsAuthor: s.signerUserId === (n.assignedUserId ?? n.authorUserId),
        canSign: CAPABILITIES[signer.credential].sign,
        needsAttestation: s.needsAttestation,
        hashMatches: true,
        finishOk: finishCheck(definition, answers).length === 0,
        redFlagsDone,
      });
      if ('refuse' in effect || effect.effect === 'none')
        throw new Error(`${n.noteTypeKey}: ${JSON.stringify(effect)}`);
      expect(s.effect).toBe(effect.effect);
      // The note as the sign-off left it (lifecycle 4.6): finished at the signature's time, by the signer.
      const signed = effect.effect === 'signed';
      expect(n).toMatchObject({
        completedAt: s.signedAt,
        completedBy: s.signerUserId,
        firstSignedAt: signed ? s.signedAt : null,
        signoffId: signed ? s.id : null,
      });
      const [status] = await db.owner<{ value: unknown; previous: unknown }[]>`
        select value, previous_value as previous from sineobex.field_history
        where entity = 'encounter_note' and record_id = ${n.id} and field = 'status' and version = 2`;
      expect(status).toEqual({ value: effect.statusAfter, previous: 'draft' });
      const attestedLater = attestations.some((a) => a.noteId === n.id);
      if (!attestedLater && !corrections.some((c) => c.noteId === n.id)) {
        expect([n.status, n.attestation]).toEqual([effect.statusAfter, effect.attestationAfter]);
      }
      if (attestedLater) expect(effect.attestationAfter).toBe('waiting');
    }
  });

  it('makes the attestation as an online attest writes it', async () => {
    for (const a of attestations) {
      const n = notes.find((x) => x.id === a.noteId)!;
      const attending = members.get(a.attendingUserId)!;
      const signoff = signoffs.find((s) => s.id === n.signoffId)!;
      const { npi, ...fields } = attending.fields;
      expect(a).toMatchObject({
        signoffId: n.signoffId,
        attendingName: attending.displayName,
        attendingNpi: npi,
        statementVersion: 'attest-2026-11',
      });
      expect(a.attendingFields).toEqual(fields);
      expect(a.attestedAt.getTime()).toBeGreaterThan(signoff.signedAt.getTime());
      expect(a.contentHash).toBe(await hashOf(n, answersAt(n, a.attestedAt)));
      expect(
        attestEffect({
          noteStatus: 'signed',
          attestation: 'waiting',
          actsAsAuthor: a.attendingUserId === (n.assignedUserId ?? n.authorUserId),
          isSigner: a.attendingUserId === signoff.signerUserId,
          canAttest: CAPABILITIES[attending.credential].attest,
          seesAllThatCounts: true,
          hashMatches: true,
        }),
      ).toEqual({ attestationAfter: n.attestation });
    }
    expect(attestations.map((a) => members.get(a.attendingUserId)!.email)).toEqual(['clinician@example.com']);
  });

  it('makes the correction as sync applies it', async () => {
    expect(corrections).toHaveLength(1);
    for (const c of corrections) {
      const n = notes.find((x) => x.id === c.noteId)!;
      const corrector = members.get(c.correctorUserId)!;
      expect(c.correctorUserId).toBe(n.assignedUserId ?? n.authorUserId);
      expect(c).toMatchObject({
        outcome: 'corrected',
        requestedByPatient: false,
        correctorName: corrector.displayName,
        correctorCredential: corrector.credential,
        claimedCredential: corrector.credential,
      });
      expect(c.reason).toMatch(/^Demo: /);
      const signoff = signoffs.find((s) => s.noteId === n.id)!;
      expect(c.correctedAt.getTime()).toBeGreaterThan(signoff.signedAt.getTime());
      const before = answersAt(n, signoff.signedAt);
      for (const ch of c.changes) {
        const path = ch.field.slice('data.'.length);
        expect(ch.oldValue).toEqual(before[path] ?? null);
        expect(n.data[path]).toEqual(ch.newValue);
        expect(ch.newValue).not.toEqual(ch.oldValue);
        expect(checkAnswer(definitionOf(n), path, ch.newValue)).toBeNull();
        const [h] = await db.owner<{ version: number; value: unknown; previous: unknown; kind: string }[]>`
          select version, value, previous_value as previous, kind from sineobex.field_history
          where id = ${ch.historyId}`;
        expect(h).toEqual({
          version: n.fieldVersions[ch.field],
          value: ch.newValue,
          previous: ch.oldValue,
          kind: 'corrected',
        });
      }
      const effect = correctionEffect({
        noteStatus: 'signed',
        attestation: signoff.needsAttestation ? 'waiting' : 'not_needed',
        correctorCanSign: CAPABILITIES[corrector.credential].sign,
        correctorNeedsAttestation: CAPABILITIES[corrector.credential].billingNeedsAttestation,
      });
      expect([n.status, n.attestation, n.signoffId]).toEqual([
        effect.statusAfter,
        effect.attestationAfter,
        effect.clearSignoff ? null : signoff.id,
      ]);
    }
  });

  it('keeps every field’s history, as sync writes it', async () => {
    const history = await db.owner<
      {
        entity: string;
        recordId: string;
        field: string;
        version: number;
        value: unknown;
        changedBy: string;
      }[]
    >`
      select entity, record_id as "recordId", field, version, value, changed_by as "changedBy"
      from sineobex.field_history
      where team_id = ${DEMO_TEAM_ID} and entity in ('encounter', 'encounter_note')
      order by entity, record_id, field, version`;
    const check = (
      entity: string,
      id: string,
      versions: Record<string, number>,
      meta: Record<string, { by: string }>,
      valueOf: (field: string) => unknown,
    ) => {
      const own = history.filter((h) => h.entity === entity && h.recordId === id);
      expect(new Set(own.map((h) => h.field))).toEqual(new Set(Object.keys(versions)));
      for (const [field, version] of Object.entries(versions)) {
        const rows = own.filter((h) => h.field === field);
        expect(
          rows.map((h) => h.version),
          `${entity} ${field}`,
        ).toEqual(Array.from({ length: version }, (_, i) => i + 1));
        expect(rows.at(-1)!.value, `${entity} ${field}`).toEqual(valueOf(field) ?? null);
        expect(meta[field]!.by).toBe(rows.at(-1)!.changedBy);
      }
    };
    for (const v of visits) {
      const columns: Record<string, unknown> = {
        patientId: v.patientId,
        location: null,
        locationText: v.locationText,
        kind: v.kind,
        summary: v.summary,
      };
      check('encounter', v.id, v.fieldVersions, v.fieldMeta, (f) => columns[f]);
      expect(Object.keys(v.fieldVersions)).not.toContain('status');
    }
    for (const n of notes) {
      check('encounter_note', n.id, n.fieldVersions, n.fieldMeta, (f) =>
        f === 'status' ? n.status : n.data[f.slice('data.'.length)],
      );
    }
  });

  it('moves each patient’s last seen to their visit', async () => {
    const rows = await db.owner<{ id: string; lastSeen: Date }[]>`
      select id, last_seen_at as "lastSeen" from sineobex.patients where id in ${db.owner([MEDICAL, OUTREACH, WOUND])}`;
    for (const r of rows) {
      const started = visits.find((v) => v.patientId === r.id)!.startedAt;
      expect(lastSeenBefore.get(r.id)!.getTime()).toBeLessThan(started.getTime());
      expect(r.lastSeen).toEqual(started);
    }
  });

  it('holds made-up text only', () => {
    const texts: string[] = [];
    for (const v of visits) {
      if (v.locationText !== null) texts.push(v.locationText);
      if (v.summary !== null) texts.push(v.summary);
    }
    for (const n of notes) {
      for (const value of Object.values(n.data))
        if (typeof value === 'string' && /\s/.test(value)) texts.push(value);
    }
    for (const c of corrections) texts.push(c.reason);
    expect(texts.length).toBeGreaterThanOrEqual(6);
    for (const t of texts) expect(t).toMatch(/^Demo: /);
    // A Medical visit's summary, a Non-Medical one's place.
    expect(visits.map((v) => [v.kind, v.summary !== null, v.locationText !== null])).toEqual([
      ['medical', true, true],
      ['non_medical', false, true],
      ['medical', true, true],
    ]);
  });
});

describe('where the seed charts no visit', () => {
  let db: ScratchDatabase;
  beforeAll(async () => {
    db = await createScratchDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it('charts none when the team does not hold the released note types', async () => {
    await seed(db.owner, { presets: [] });
    expect(await visitsOf(db.owner)).toEqual([]);
    // The patients are there, and the next seed with the note types charts the visits.
    await seed(db.owner);
    expect((await visitsOf(db.owner)).map((v) => v.id)).toEqual([
      demoVisitId(1),
      demoVisitId(2),
      demoVisitId(3),
    ]);
  });

  it('charts none when the team holds another definition under a released key and version', async () => {
    const other = await createScratchDatabase();
    try {
      const presets = await Promise.all(
        PRESETS.map(async (p) => {
          if (p.key !== 'outreach') return p;
          const definition = { ...p.definition, title: 'Demo: outreach, worded otherwise' };
          return { ...p, definition, hash: await sha256Hex(canonicalJson(definition)) };
        }),
      );
      await seed(other.owner, { presets });
      expect(await visitsOf(other.owner)).toEqual([]);
    } finally {
      await other.drop();
    }
  });

  it('charts none in the preview, which has no seeded staff to sign them', async () => {
    const preview = await createScratchDatabase({ migrate: false });
    try {
      await migrate(preview.owner);
      await setEnvironment(preview.owner, 'preview');
      await seed(preview.owner);
      expect(await visitsOf(preview.owner)).toEqual([]);
    } finally {
      await preview.drop();
    }
  });
});
