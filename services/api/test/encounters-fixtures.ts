import { randomUUID } from 'node:crypto';
import type { ResolvedNoteType } from '@sineobex/forms';
import { expect } from 'vitest';
import { noteContentHash } from '../src/encounters/content-hash.ts';
import type { Harness } from './harness.ts';
import { createPatient } from './patient-fixtures.ts';
import {
  addMember,
  call,
  clinician,
  installNoteTypes,
  noteOn,
  setupTeam,
  signoffOf,
  TEST_NOTE_TYPES,
  TEST_RED_FLAGS_TYPE,
  TEST_RESTRICTED_TYPE,
  TEST_RESTRICTED_TYPES,
  type Clinician,
  type HeldNote,
  type Json,
  type Team,
  type Visit,
} from './sync-fixtures.ts';

/**
 * Shared helpers for the tests of phase 4's online routes (lifecycle 5, 6; unit L2). They chart
 * through sync, as a phone does, and read the rows straight from the database, so each route's test
 * holds what it writes. Every person and value here is made up.
 *
 * The answers the tests pin, where lifecycle 5 names the content and not the keys:
 *
 *  - GET /v1/encounters/{id} (5.1): `{ encounterId, patientId, kind, status, startedAt,
 *    clockVerified, locationText, summary?, addenda, notes }`. Each note: `{ noteId, noteTypeKey,
 *    noteTypeVersion, status, attestation, author, actingAuthor, read, signoffs, addenda,
 *    corrections, attestations, contentHash? }`; `author` and `actingAuthor` are `{ userId,
 *    displayName }`; each record that hangs off a note, and each of the visit's own addenda, has
 *    its `id`; a sign-off's `contentHash` is there or not by the sync read's rule. What a reader
 *    may not see is absent, never null.
 *  - The queues (5.4): rows `{ encounterId, patientId, preferredName, startedAt, notes }`, each
 *    note `{ noteId, noteTypeKey, author, completedAt, signedBefore, attestedBefore, canAct }`,
 *    `signedBefore` and `attestedBefore` `{ userId, displayName }` or null.
 *  - Co-sign and attest (5.3, 5.4): `{ notes: [{ noteId, status, attestation }] }`; a refusal's
 *    `error.details.noteIds` names the notes it is about.
 *  - Notes to finish and the team's incomplete notes (5.6): `{ notes: [...] }`, each `{ noteId,
 *    encounterId, patientId, noteTypeKey, startedAt, overdue }`, the team's with `author` and
 *    `authorActive`.
 *  - The counts (5.6): `{ notesToFinish, notesOverdue, cosignWaiting?, attestationWaiting?,
 *    teamIncomplete? }`, each optional one absent for a caller who may not open its list.
 */

const [NOTE_TYPE, MEDICAL_TYPE] = TEST_NOTE_TYPES as [ResolvedNoteType, ResolvedNoteType];

/** A Non-Medical note type: completed, never signed. */
export const TEST_NOTE_TYPE: ResolvedNoteType = NOTE_TYPE;

/** A Medical note type with nothing a reader of Medical notes may not see. */
export const TEST_MEDICAL_TYPE: ResolvedNoteType = MEDICAL_TYPE;

/**
 * A Medical note type (offered for Medical encounters only, so it is signed) with every kind of
 * content 6.4 hides: test_restricted's sections, a sensitive exam (`exam`), a treatment record
 * (`moud`), a section an ordering credential changes (`meds`), a picker with a sensitive exam's
 * option (`systems.seen`, gu) and a repeating section of diagnoses (`dx`). Installed by
 * createWorld; the sync-only types are all offered for both kinds.
 */
export const TEST_MEDICAL_EXAM_TYPE: ResolvedNoteType = {
  ...TEST_RESTRICTED_TYPE,
  key: 'test_medical_exam',
  title: 'Test Medical exam note',
  kinds: ['medical'],
};

export const COSIGN_STATEMENT = 'cosign-2026-11';
export const ATTEST_STATEMENT = 'attest-2026-11';

/** The answers of a plain Medical note. */
export const PLAN = { 'care.plan': 'Demo: rest and fluids', 'vitals.pulse': 88 } as const;

/** A Medical exam note with something in a sensitive exam section and nothing else hidden. */
export const WITH_EXAM = {
  'general.notes': 'Demo: walked over from the shelter',
  'exam.findings': 'Demo: no lesions seen',
} as const;

/** A Medical exam note whose answers every reader of Medical notes sees. */
export const WITHOUT_EXAM = { 'general.notes': 'Demo: walked over from the shelter' } as const;

export interface World {
  h: Harness;
  t: Team;
  patientId: string;
  /** The patient's preferred name, as createPatient leaves it. */
  preferredName: string;
  /** Attending, Healthcare Staff: signs, co-signs, attests; sees no sensitive exam. */
  ana: Clinician;
  /** Resident, Healthcare Staff: signs and needs attestation; may co-sign (PLAN-OPEN 12.1 #6). */
  rae: Clinician;
  /** Student, Healthcare Staff: completes a Medical note for a co-signer. */
  sol: Clinician;
  /** Attending in a role with every key that hides an answer: sees every answer of any note. */
  vic: Clinician;
  /** NP, Healthcare Staff: signs, needs attestation, rank 3. */
  nia: Clinician;
  /** Billing/Data, no credential: reads Medical notes; no sensitive note types; charts nothing. */
  bea: { id: string; token: string; membershipId: string };
  /** The CHW preset: patients.view and no Medical notes; no encounters.chart. */
  kim: { id: string; token: string };
  /** A role with encounters.chart alone, an attending: no patients.view, so no Medical note. */
  eli: Clinician;
  /** The key of vic's role. */
  examsRole: string;
}

/** A role of the team with exactly these keys, made by its admin; returns its key. */
export async function roleWith(h: Harness, t: Team, name: string, permissions: string[]): Promise<string> {
  const r = await call(h, '/v1/team/roles', {
    method: 'POST',
    token: t.adminToken,
    teamId: t.teamId,
    json: { name, permissions },
  });
  expect(r.status).toBe(201);
  return r.body.key as string;
}

/** A team with the people above, the note types the tests chart on and one registered patient. */
export async function createWorld(h: Harness): Promise<World> {
  const t = await setupTeam(h);
  await installNoteTypes(h, t.teamId, [
    ...TEST_RESTRICTED_TYPES,
    TEST_RED_FLAGS_TYPE,
    TEST_MEDICAL_EXAM_TYPE,
  ]);
  const preferredName = 'Demo Robin';
  const patientId = (await createPatient(h, t.teamId, t.adminId, { preferredName })).id;
  const examsRole = await roleWith(h, t, 'Exam charting', [
    'patients.view',
    'patients.view_sensitive',
    'patients.view_sensitive_exams',
    'encounters.chart',
  ]);
  const chartOnly = await roleWith(h, t, 'Charting only', ['encounters.chart']);
  const bea = await addMember(h, t, 'bea@example.com', 'Bea (demo)', 'billing_data');
  return {
    h,
    t,
    patientId,
    preferredName,
    ana: await clinician(h, t, 'ana@example.com', 'Ana (demo)', 'attending'),
    rae: await clinician(h, t, 'rae@example.com', 'Rae (demo)', 'resident'),
    sol: await clinician(h, t, 'sol@example.com', 'Sol (demo)', 'student'),
    vic: await clinician(h, t, 'vic@example.com', 'Vic (demo)', 'attending', examsRole),
    nia: await clinician(h, t, 'nia@example.com', 'Nia (demo)', 'np'),
    bea: { id: bea.id, token: bea.token, membershipId: bea.membershipId },
    kim: { id: t.chwId, token: t.chwToken },
    eli: await clinician(h, t, 'eli@example.com', 'Eli (demo)', 'attending', chartOnly),
    examsRole,
  };
}

// ------------------------------------------------------------------------------------------------
// Calling the routes
// ------------------------------------------------------------------------------------------------

export function get(w: World, token: string, path: string) {
  return call(w.h, path, { token, teamId: w.t.teamId });
}

export function post(w: World, token: string, path: string, json: unknown) {
  return call(w.h, path, { method: 'POST', token, teamId: w.t.teamId, json });
}

/** A token for this person whose sign-in is older than a recent one (RECENT_AUTH_MINUTES). */
export function staleToken(h: Harness, email: string) {
  return h.tokenFor(email, { authTime: new Date(h.clock.now.getTime() - 60 * 60_000) });
}

/** What a co-sign or an attest sends: each note with the hash of what its phone or page showed. */
export async function actBody(notes: readonly HeldNote[], statementVersion: string) {
  return {
    notes: await Promise.all(
      notes.map(async (n) => ({ noteId: n.noteId, contentHash: await heldHashOf(n) })),
    ),
    statementVersion,
  };
}

/** The hash of what a reader was shown of [n] (lifecycle 4.5). */
export const heldHashOf = (n: HeldNote) =>
  noteContentHash({
    noteId: n.noteId,
    encounterId: n.encounterId,
    patientId: n.patientId,
    summary: n.summary,
    definition: n.type,
    answers: n.answers,
  });

export const cosign = async (
  w: World,
  c: { token: string },
  encounterId: string,
  notes: readonly HeldNote[],
) => post(w, c.token, `/v1/encounters/${encounterId}/cosign`, await actBody(notes, COSIGN_STATEMENT));

export const attest = async (
  w: World,
  c: { token: string },
  encounterId: string,
  notes: readonly HeldNote[],
) => post(w, c.token, `/v1/encounters/${encounterId}/attest`, await actBody(notes, ATTEST_STATEMENT));

// ------------------------------------------------------------------------------------------------
// Charting through sync
// ------------------------------------------------------------------------------------------------

/** A visit made through sync, started at [startedAt] (default: ten minutes before the clock). */
export async function visitAt(
  c: Clinician,
  patientId: string | null,
  o: { startedAt?: string; clockVerified?: boolean; kind?: 'medical' | 'non_medical' } = {},
): Promise<Visit> {
  const create = await c.phone.change({
    entity: 'encounter',
    op: 'create',
    value: { kind: o.kind ?? 'medical', ...(patientId ? { patientId } : {}) },
    ...(o.startedAt ? { deviceTime: o.startedAt } : {}),
    ...(o.clockVerified === undefined ? {} : { clockVerified: o.clockVerified }),
  });
  expect((await c.send(create)).map((r) => r.status)).toEqual(['accepted']);
  return { encounterId: create.recordId, patientId, summary: null };
}

export interface ChartedVisit {
  visit: Visit;
  /** The visit's Red flags note, answered. */
  flags: HeldNote;
  note: HeldNote;
}

/** A Medical visit with its Red flags note answered and a draft note of [type], both by [c]. */
export async function chartedVisit(
  w: World,
  c: Clinician,
  type: ResolvedNoteType = TEST_MEDICAL_TYPE,
  answers: Record<string, unknown> = PLAN,
  o: { startedAt?: string } = {},
): Promise<ChartedVisit> {
  const visit = await visitAt(c, w.patientId, o);
  const flags = await noteOn(c, visit, TEST_RED_FLAGS_TYPE, { 'flags.any': 'no' });
  const note = await noteOn(c, visit, type, answers);
  return { visit, flags, note };
}

/** Finishes notes through sync and checks the effect of each. */
export async function finish(c: Clinician, ...steps: [HeldNote, 'complete' | 'sign', string][]) {
  const signoffs = await Promise.all(steps.map(([n, act]) => signoffOf(c, n, act)));
  expect((await c.send(...signoffs)).map((r) => r.details?.effect)).toEqual(steps.map(([, , e]) => e));
  return signoffs;
}

/** A student's visit whose two Medical notes wait for a co-signer (lifecycle 3.1). */
export async function waitingForCosign(
  w: World,
  c: Clinician = w.sol,
  type: ResolvedNoteType = TEST_MEDICAL_TYPE,
  answers: Record<string, unknown> = PLAN,
  o: { startedAt?: string } = {},
): Promise<ChartedVisit> {
  const v = await chartedVisit(w, c, type, answers, o);
  // A student's sign is saved unsigned; anyone else's complete of a Medical note waits the same way.
  const student = c.credential === 'student';
  await finish(
    c,
    [v.flags, 'complete', 'completed'],
    [v.note, student ? 'sign' : 'complete', student ? 'saved_unsigned' : 'completed'],
  );
  return v;
}

/** A resident's or an NP's visit whose two notes are signed and wait for attestation. */
export async function waitingForAttestation(
  w: World,
  c: Clinician = w.rae,
  type: ResolvedNoteType = TEST_MEDICAL_TYPE,
  answers: Record<string, unknown> = PLAN,
  o: { startedAt?: string } = {},
): Promise<ChartedVisit> {
  const v = await chartedVisit(w, c, type, answers, o);
  await finish(c, [v.flags, 'sign', 'signed'], [v.note, 'sign', 'signed']);
  expect((await noteRow(w.h, v.note.noteId)).attestation).toBe('waiting');
  return v;
}

/**
 * A correction of one answer through sync, by whoever acts as the note's author, and the note as
 * its phone now holds it.
 */
export async function correct(c: Clinician, n: HeldNote, h: Harness, path: string, newValue: unknown) {
  const { fieldVersions } = await noteRow(h, n.noteId);
  const change = await c.phone.change({
    entity: 'note_correction',
    op: 'create',
    value: {
      noteId: n.noteId,
      changes: [{ field: `data.${path}`, newValue, baseVersion: fieldVersions[`data.${path}`] ?? 0 }],
      reason: 'Demo: the wrong field was picked',
      requestedByPatient: false,
      declined: false,
      claimedCredential: c.credential,
      signoffId: null,
    },
  });
  const [answer] = await c.send(change);
  expect(answer!.status).toBe('accepted');
  return { change, note: { ...n, answers: { ...n.answers, [path]: newValue } } as HeldNote };
}

/** An admin moves a member to another credential, as the members page does. */
export { setCredential, setRole } from './sync-fixtures.ts';

/** The team's admin removes a member, as the members page does. */
export async function removeMember(w: World, membershipId: string) {
  const r = await call(w.h, `/v1/team/members/${membershipId}/remove`, {
    method: 'POST',
    token: w.t.adminToken,
    teamId: w.t.teamId,
    json: { reason: 'Left the program' },
  });
  expect(r.status).toBe(200);
}

// ------------------------------------------------------------------------------------------------
// Straight to the database, for state a later route makes
// ------------------------------------------------------------------------------------------------

/**
 * An attestation of the note's current signature as the attest route leaves one (lifecycle 2.4),
 * for the tests of the queues that do not depend on that route.
 */
export async function attestDirect(h: Harness, teamId: string, noteId: string, attending: Clinician) {
  const sql = h.scratch.owner;
  const id = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into sineobex.note_attestations (id, team_id, note_id, signoff_id, content_hash, attending_user_id,
        attending_name, attending_npi, attending_fields, statement_version)
      select ${id}, team_id, id, signoff_id, ${'0'.repeat(64)}, ${attending.id}, ${attending.displayName},
             '1234567893', ${tx.json({ licenseNumber: 'DEMO-0001', licenseState: 'MI' })}, ${ATTEST_STATEMENT}
      from sineobex.encounter_notes where team_id = ${teamId} and id = ${noteId}`;
    await tx`update sineobex.encounter_notes set attestation = 'attested' where team_id = ${teamId} and id = ${noteId}`;
  });
  return id;
}

/**
 * Moves a visit's receipt time: when the server first had it (`createReceivedAt`). The database's
 * clock is not the harness's, so a test of the 24-hour rule sets it.
 */
export async function receivedAt(h: Harness, encounterId: string, at: Date) {
  await h.scratch.owner`update sineobex.encounters set created_at = ${at} where id = ${encounterId}`;
}

// ------------------------------------------------------------------------------------------------
// Reading what was written
// ------------------------------------------------------------------------------------------------

export interface NoteRow {
  status: string;
  attestation: string;
  signoffId: string | null;
  firstSignedAt: Date | null;
  assignedUserId: string | null;
  authorUserId: string;
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  version: number;
}

export async function noteRow(h: Harness, id: string): Promise<NoteRow> {
  const [row] = await h.scratch.owner<NoteRow[]>`
    select status, attestation, signoff_id as "signoffId", first_signed_at as "firstSignedAt",
           assigned_user_id as "assignedUserId", author_user_id as "authorUserId", data,
           field_versions as "fieldVersions", version
    from sineobex.encounter_notes where id = ${id}`;
  return row!;
}

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]),
  );

/** Every sign-off of the note, oldest first, every column by its camel-cased name. */
export async function signoffRows(h: Harness, noteId: string) {
  const rows = await h.scratch.owner<Record<string, unknown>[]>`
    select * from sineobex.note_signoffs where note_id = ${noteId} order by received_at, id`;
  return rows.map(camel);
}

/** Every attestation of the note, oldest first. */
export async function attestationRows(h: Harness, noteId: string) {
  const rows = await h.scratch.owner<Record<string, unknown>[]>`
    select * from sineobex.note_attestations where note_id = ${noteId} order by attested_at, id`;
  return rows.map(camel);
}

/** Every assignment of the note, oldest first. */
export async function assignmentRows(h: Harness, noteId: string) {
  const rows = await h.scratch.owner<Record<string, unknown>[]>`
    select * from sineobex.note_assignments where note_id = ${noteId} order by assigned_at, id`;
  return rows.map(camel);
}

export const visitStatus = async (h: Harness, id: string) =>
  (await h.scratch.owner<{ status: string }[]>`select status from sineobex.encounters where id = ${id}`)[0]!
    .status;

/** The notices of one kind a person was sent, oldest first. */
export const noticesOf = (h: Harness, userId: string, kind: string) =>
  h.scratch.owner<{ entity: string; recordId: string }[]>`
    select entity, record_id as "recordId" from sineobex.user_notices
    where user_id = ${userId} and kind = ${kind} order by created_at, id`;

export interface Event {
  action: string;
  entity: string | null;
  entityId: string | null;
  patientId: string | null;
  details: Record<string, unknown>;
}

/** Every audit event after [mark], oldest first. */
export const eventsAfter = (h: Harness, mark: string) =>
  h.scratch.owner<Event[]>`
    select action, entity, entity_id as "entityId", patient_id as "patientId", details
    from sineobex.audit_events where id > ${mark}::bigint order by id`;

/** What nothing in an answer or an audit event may hold: answers, names, free text. */
export const SECRETS = [
  'Demo: rest and fluids',
  'Demo: walked over from the shelter',
  'Demo: no lesions seen',
  'Demo Robin',
  'Demo: the wrong field was picked',
] as const;

/** The JSON of an answer holds none of [terms]. */
export function expectNoneOf(body: unknown, terms: readonly string[]) {
  const text = JSON.stringify(body).toLowerCase();
  for (const term of terms) expect(text, `the answer holds "${term}"`).not.toContain(term.toLowerCase());
}

/** A refusal's error code and the notes it names. */
export const refusal = (body: Json) => ({
  code: body.error?.code,
  noteIds: ((body.error?.details?.noteIds as string[] | undefined) ?? []).slice().sort(),
});

// ------------------------------------------------------------------------------------------------
// The team lock (lifecycle 5: every route that writes takes it first)
// ------------------------------------------------------------------------------------------------

/**
 * Runs [request] while another connection holds the team's write lock, waits until the request
 * waits on it, and answers how many locks on the note and visit tables the waiting request held by
 * then (none, if the team lock was its first statement), and the request's answer once the lock is
 * let go.
 */
export async function whileTeamLocked<T>(h: Harness, teamId: string, request: () => Promise<T>) {
  const other = await h.scratch.owner.reserve();
  try {
    await other`begin`;
    await other`set local lock_timeout = '5s'`;
    await other`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0))`;
    const answer = request();
    let waiting: { pid: number } | undefined;
    for (let i = 0; i < 400 && !waiting; i++) {
      [waiting] = await h.scratch.owner<{ pid: number }[]>`
        select pid from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
      if (!waiting) await new Promise((r) => setTimeout(r, 10));
    }
    let rowLocks: number | null = null;
    if (waiting) {
      const [held] = await h.scratch.owner<{ n: number }[]>`
        select count(*)::int as n from pg_locks
        where pid = ${waiting.pid}
          and relation in ('sineobex.encounter_notes'::regclass, 'sineobex.encounters'::regclass)`;
      rowLocks = held!.n;
    }
    await other`commit`;
    return { waited: waiting !== undefined, rowLocks, answer: await answer };
  } finally {
    await other`rollback`.catch(() => {});
    other.release();
  }
}
