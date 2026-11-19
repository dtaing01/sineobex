import {
  readModel,
  recapLines,
  visibleAnswers,
  type NoteCorrection,
  type NoteReader,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { AuditFn, TeamScope } from '../auth/context.ts';
import { mayViewProblems, type Credential, type Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { notFound } from '../lib/errors.ts';
import type { VisitNoteValue, VisitReadValue } from '../patients/schemas.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { RULES } from '../sync/entities/index.ts';
import { actingAuthor, answersOf, noteRules, noteTypeOf } from '../sync/entities/note.ts';
import {
  answerHidden,
  byDefinition,
  DefinitionError,
  noteReader,
  snapshot,
  type StoredRecord,
} from '../sync/records.ts';
import type { AnyRecordEntityName } from '../sync/schemas.ts';
import { noteContentHash } from './content-hash.ts';
import { encounterStatus, noteIsEmpty, type NoteStatus } from './rules.ts';
import { showsHandoff } from './handoff.ts';
import { actNote, maySecondSign, secondPersonView } from './second-person.ts';

/**
 * Reading a visit online (lifecycle 5.1, 6.4): the rules that decide what of a note, and of what
 * hangs off it, a reader is given. There is one copy of each: the sync read (`fetchRecords`,
 * sync/review.ts), the timeline and the queues call these, so a fix lands once (the coordinator's
 * decision on the review). A note the reader may not read is absent with everything that hangs off
 * it (noteAsRead); its answers are what visibleAnswers keeps (seenBy); a Medical visit's summary
 * goes with its notes (medicalHidden); a correction is absent when its old or its new value at any
 * field it changes is hidden from the reader in any state the note has held (hiddenCorrections); a
 * sign-off's hash goes only to whoever acts as the author, its signer and a reader who sees every
 * answer of any note (signoffHashShown, readsWhole; D86); and a visit's status is worked out from
 * the notes the reader is shown (statusShown).
 */

/**
 * A reader who sees every answer that counts in any note (lifecycle 6.4 rule 4): every key that
 * hides an answer and a credential that charts Medical. Asked of the reader, never of what the
 * note holds, so whether a sign-off's hash is sent tells nothing of the note.
 */
export const readsWhole = (reader: NoteReader) =>
  reader.readsMedical && reader.viewSensitive && reader.viewSensitiveExams && reader.chartsMedical;

/**
 * A Medical visit's summary, and its own addenda, are Medical content (lifecycle 6.4 row 1, D37):
 * read, as its notes are, with patients.view and encounters.chart or billing.view_codes (RD-7).
 */
export const medicalHidden = (permissions: ReadonlySet<Permission>, kind: unknown) =>
  kind === 'medical' && !mayViewProblems(permissions);

/** A note as a reader may read it: its type, the answers it holds, the reader, and what they see. */
export interface NoteRead {
  note: StoredRecord;
  /** Undefined for a phase 2 note with no version, which has no definition and is read whole. */
  type: ResolvedNoteType | undefined;
  /** Every answer the note holds, as stored. */
  answers: Record<string, unknown>;
  reader: NoteReader;
  /** The answers that count that the reader may see (visibleAnswers); every answer of a phase 2 note. */
  seen: Record<string, unknown>;
}

/** The caller as visibleAnswers reads them, for a note whose acting author is [actingAuthorId]. */
export const readerOf = (scope: TeamScope, actingAuthorId: string): NoteReader =>
  noteReader(scope.team.permissions, scope.team.credential, scope.principal.userId === actingAuthorId);

/**
 * What [reader] sees of a note of [type] that holds [answers]: the answers that count that they may
 * see (visibleAnswers), or null when they may not read the note, or when the interpreter cannot
 * read it, since what it would hide cannot be told.
 */
export function seenBy(
  type: ResolvedNoteType,
  answers: Record<string, unknown>,
  reader: NoteReader,
): Record<string, unknown> | null {
  try {
    return byDefinition(() => visibleAnswers(type, answers, reader));
  } catch (err) {
    if (err instanceof DefinitionError) return null;
    throw err;
  }
}

/**
 * A note as this reader may read it (lifecycle 4.4, 6.4), or null when they may not: a type they
 * may not read, or a definition the server cannot read, since what it would hide cannot be told.
 *
 * With [authorsDraftAsStored], whoever acts as the author of a draft is given every answer it
 * holds, without the interpreter, as the sync read sends it: so an answer whose field is hidden for
 * now comes back when it shows again, and a draft its author holds is sent even when the
 * interpreter cannot read it. The visit read lays a note out by the answers that count, so it
 * asks visibleAnswers of the author too.
 */
export async function noteAsRead(
  tx: Tx,
  scope: TeamScope,
  note: StoredRecord | null,
  { authorsDraftAsStored = false }: { authorsDraftAsStored?: boolean } = {},
): Promise<NoteRead | null> {
  if (!note) return null;
  const reader = readerOf(scope, actingAuthor(note));
  const answers = answersOf(note);
  let type: ResolvedNoteType | undefined;
  try {
    type = await noteTypeOf(tx, note);
  } catch (err) {
    if (err instanceof DefinitionError) return null;
    throw err;
  }
  if (type === undefined || (authorsDraftAsStored && reader.actsAsAuthor && note.status === 'draft'))
    return { note, type, answers, reader, seen: answers };
  const seen = seenBy(type, answers, reader);
  return seen && { note, type, answers, reader, seen };
}

/** A note as statusShown counts it. */
export interface StatusNote {
  status: NoteStatus;
  medical: boolean;
  answers: Record<string, unknown>;
}

/** A note the reader may read, as statusShown counts it. */
export const statusNote = (read: Pick<NoteRead, 'note' | 'answers'>): StatusNote => ({
  status: read.note.status as NoteStatus,
  medical: read.note.internal.medical === true,
  answers: read.answers,
});

/**
 * A visit's status as the reader is shown it: encounterStatus over the notes they are shown, an
 * empty draft not counted, so it says nothing of a note left out (6.4 rule 2; review finding LRD-2).
 */
export const statusShown = (shown: readonly StatusNote[]): NoteStatus =>
  encounterStatus(
    shown.map((n) => ({
      status: n.status,
      medical: n.medical,
      empty: n.status === 'draft' && noteIsEmpty(n.answers),
    })),
  );

/** A correction of a note as stored (note_corrections): what it named, and whether it wrote. */
export interface StoredCorrection {
  id: string;
  outcome: string;
  changes: readonly { field: string; oldValue: unknown; newValue: unknown }[];
}

/** The outcomes of a correction that wrote its new values into the note (note-correction.ts). */
const WROTE = new Set(['corrected', 'draft_edit']);

/**
 * The corrections of a note the reader may read that are hidden from them (lifecycle 5.1): those
 * whose old or new value, at any field they change, visibleAnswers would hide from the reader in
 * any state the note has held. Missing whole rather than stripped, since a correction's field alone
 * names the hidden answer. A phase 2 note's are all shown.
 *
 * Asked only of the note as it is now, a correction made while its entry held a sensitive
 * diagnosis was shown once a later correction moved the code off the sensitive list (review finding
 * LRD-1). So each is asked of the note now; of the note with the later corrections undone, in the
 * order they were applied ([corrections] is that order); and, since corrections received in one
 * push share their time and so their order is not certain, of the note now with each correction's
 * old values, or its new values, put back.
 */
export function hiddenCorrections(
  read: Pick<NoteRead, 'type' | 'answers' | 'reader'>,
  corrections: readonly StoredCorrection[],
): Set<string> {
  const { type, answers, reader } = read;
  const hidden = new Set<string>();
  if (type === undefined) return hidden;
  const placed = (on: Record<string, unknown>, values: [string, unknown][]) => {
    const out = { ...on };
    for (const [field, value] of values) {
      const path = field.slice('data.'.length);
      if (value === null || value === undefined) delete out[path];
      else out[path] = value;
    }
    return out;
  };
  const states: Record<string, unknown>[] = [answers];
  let after = answers;
  for (const c of [...corrections].reverse()) {
    if (!WROTE.has(c.outcome)) continue;
    after = placed(
      after,
      c.changes.map((x) => [x.field, x.oldValue]),
    );
    states.push(after);
  }
  for (const c of corrections) {
    states.push(
      placed(
        answers,
        c.changes.map((x) => [x.field, x.oldValue]),
      ),
    );
    states.push(
      placed(
        answers,
        c.changes.map((x) => [x.field, x.newValue]),
      ),
    );
  }
  for (const c of corrections) {
    const shows = c.changes.every((x) => {
      const path = x.field.slice('data.'.length);
      try {
        return byDefinition(() =>
          states.every(
            (state) =>
              !answerHidden(type, state, path, x.oldValue, reader) &&
              !answerHidden(type, state, path, x.newValue, reader),
          ),
        );
      } catch (err) {
        if (err instanceof DefinitionError) return false;
        throw err;
      }
    });
    if (!shows) hidden.add(c.id);
  }
  return hidden;
}

/**
 * Whether a sign-off of a note the reader may read goes to them with its hash (6.4 rule 4, D86): to
 * whoever acts as the author, its signer and a reader who sees every answer of any note. Never when
 * the visit's summary is withheld from the reader: the hash covers it, as the note's own does
 * (review finding LRD-5). The sync read asks the same (sync/review.ts).
 */
export const signoffHashShown = (
  read: Pick<NoteRead, 'reader'>,
  signerUserId: string,
  userId: string,
  summaryHidden: boolean,
) => !summaryHidden && (read.reader.actsAsAuthor || signerUserId === userId || readsWhole(read.reader));

/**
 * The preferred name of each patient as a visit's reader is shown it: their chart's, or the chart's
 * they were merged into, as the chart itself answers a merged ID. A preferred name is in every
 * summary patients.view reads (phase 3 design 4.3), so a reader without it gets none. The visit
 * read, the queues and the team's incomplete notes name a patient this way.
 */
export async function preferredNames(
  tx: Tx,
  scope: TeamScope,
  patientIds: readonly (string | null)[],
): Promise<Map<string, string | null>> {
  const wanted = [...new Set(patientIds.filter((id) => id !== null))];
  if (wanted.length === 0 || !scope.can('patients.view')) return new Map();
  const rows = await tx<{ id: string; preferredName: string | null }[]>`
    select p.id, c.preferred_name from sineobex.patients p
    join sineobex.patients c on c.team_id = p.team_id and c.id = p.canonical_id
    where p.team_id = ${scope.team.teamId} and p.id = any (${wanted}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.preferredName]));
}

// ------------------------------------------------------------------------------------------------
// GET /v1/encounters/{encounterId}
// ------------------------------------------------------------------------------------------------

/**
 * Where a visit was read, for its audit events: a registered phone of this person, the portal, or
 * the phone's cached chart that carried it as a recent visit.
 */
export type ReadSource = 'phone' | 'portal' | 'cache';

/** GET /v1/encounters/{encounterId}: the visit as the reader may see it, logged in its transaction. */
export async function readVisit(scope: TeamScope, encounterId: string): Promise<VisitReadValue> {
  return scope.tx(async (tx, audit) => {
    const visit = await visitAsRead(tx, scope, audit, encounterId, scope.meta.deviceId ? 'phone' : 'portal');
    if (!visit) throw notFound('encounter');
    return visit;
  });
}

interface SignoffRow {
  id: string;
  noteId: string;
  act: 'complete' | 'sign' | 'cosign';
  effect: 'signed' | 'completed' | 'saved_unsigned' | 'none';
  contentHash: string;
  signerUserId: string;
  signerName: string;
  signerCredential: Credential;
  claimedCredential: Credential | null;
  needsAttestation: boolean;
  statementVersion: string;
  signedAt: Date;
  clockVerified: boolean;
}

interface AddendumRow {
  id: string;
  noteId: string | null;
  text: string;
  authorUserId: string;
  authorName: string;
  authorCredential: Credential;
  writtenAt: Date;
  clockVerified: boolean;
}

interface CorrectionRow {
  id: string;
  noteId: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  outcome: NoteCorrection['outcome'];
  reason: string;
  requestedByPatient: boolean;
  correctorUserId: string;
  correctorName: string;
  correctorCredential: Credential;
  correctedAt: Date;
  clockVerified: boolean;
}

interface AttestationRow {
  id: string;
  noteId: string;
  signoffId: string;
  attendingUserId: string;
  attendingName: string;
  statementVersion: string;
  attestedAt: Date;
}

/**
 * The visit as this reader may see it, every record shown logged as the sync read logs it (10.1):
 * `encounter.viewed` for the visit, `note.viewed` for each note and for each sign-off, addendum,
 * correction and attestation, and `patient.viewed` for each record made at the visit, each on its
 * entity and ID and with its patient. Null when the team has no such visit.
 *
 * Left out besides what 6.4 hides: an empty draft, which counts as not there (3.1), and a phase 2
 * note with no version, which has no definition to lay it out by. The visit's status is worked out
 * from the notes shown (encounterStatus), as the timeline's is.
 */
export async function visitAsRead(
  tx: Tx,
  scope: TeamScope,
  audit: AuditFn,
  encounterId: string,
  source: ReadSource,
): Promise<VisitReadValue | null> {
  const visit = await loadEncounter(tx, encounterId, false);
  if (!visit || visit.teamId !== scope.team.teamId) return null;
  const permissions = scope.team.permissions;
  const hideMedical = medicalHidden(permissions, visit.values.kind);
  const patientId = visit.patientId;
  const viewed = (action: string, entity: string, entityId: string, about: string | null = patientId) =>
    audit({ action, entity, entityId, patientId: about, details: { source } });
  await viewed('encounter.viewed', 'encounter', visit.id);

  const signoffs = await tx<SignoffRow[]>`
      select s.id, s.note_id, s.act, s.effect, s.content_hash, s.signer_user_id, s.signer_name,
             s.signer_credential, s.claimed_credential, s.needs_attestation, s.statement_version, s.signed_at,
             s.clock_verified
      from sineobex.note_signoffs s
      join sineobex.encounter_notes n on n.team_id = s.team_id and n.id = s.note_id
      where n.team_id = ${visit.teamId} and n.encounter_id = ${visit.id}
      order by s.received_at, s.id`;
  const addenda = await tx<AddendumRow[]>`
      select id, note_id, text, author_user_id, author_name, author_credential, written_at, clock_verified
      from sineobex.note_addenda where team_id = ${visit.teamId} and encounter_id = ${visit.id}
      order by written_at, created_at, id`;
  // In the order they were applied, so each one's old value is what the one before it left.
  const corrections = await tx<CorrectionRow[]>`
      select c.id, c.note_id, c.changes, c.outcome, c.reason, c.requested_by_patient, c.corrector_user_id,
             c.corrector_name, c.corrector_credential, c.corrected_at, c.clock_verified
      from sineobex.note_corrections c
      join sineobex.encounter_notes n on n.team_id = c.team_id and n.id = c.note_id
      where n.team_id = ${visit.teamId} and n.encounter_id = ${visit.id}
      order by c.created_at, c.id`;
  const attestations = await tx<AttestationRow[]>`
      select a.id, a.note_id, a.signoff_id, a.attending_user_id, a.attending_name, a.statement_version,
             a.attested_at
      from sineobex.note_attestations a
      join sineobex.encounter_notes n on n.team_id = a.team_id and n.id = a.note_id
      where n.team_id = ${visit.teamId} and n.encounter_id = ${visit.id}
      order by a.attested_at, a.id`;

  const noteRows = await tx<{ id: string }[]>`
    select id from sineobex.encounter_notes
    where team_id = ${visit.teamId} and encounter_id = ${visit.id} order by created_at, id`;
  const reads: (NoteRead & { type: ResolvedNoteType })[] = [];
  let hasHandoff = false;
  for (const { id } of noteRows) {
    const read = await noteAsRead(tx, scope, await noteRules.load(tx, id, false));
    if (!read || read.type === undefined) continue;
    const typed = read as NoteRead & { type: ResolvedNoteType };
    // Asked of every Red flags note the reader reads, as the export asks it (handoff.ts).
    hasHandoff ||= showsHandoff(typed);
    if (read.note.status === 'draft' && noteIsEmpty(read.answers)) continue;
    reads.push(typed);
  }
  const names = await displayNames(
    tx,
    reads.flatMap((r) => [r.note.authorUserId, actingAuthor(r.note)]),
  );
  const user = (id: string) => ({ userId: id, displayName: names.get(id) ?? '' });

  const notes: VisitNoteValue[] = [];
  for (const read of reads) {
    const { note, type, answers, reader, seen } = read;
    const second = await actNote(tx, scope, visit, note, read);
    await viewed('note.viewed', 'encounter_note', note.id);
    const shownSignoffs = signoffs.filter((s) => s.noteId === note.id);
    const shownAddenda = addenda.filter((a) => a.noteId === note.id);
    const ofNote = corrections.filter((c) => c.noteId === note.id);
    const hidden = hiddenCorrections(read, ofNote);
    const shownCorrections = ofNote.filter((c) => !hidden.has(c.id));
    const shownAttestations = attestations.filter((a) => a.noteId === note.id);
    for (const s of shownSignoffs) await viewed('note.viewed', 'note_signoff', s.id);
    for (const a of shownAddenda) await viewed('note.viewed', 'note_addendum', a.id);
    for (const c of shownCorrections) await viewed('note.viewed', 'note_correction', c.id);
    for (const a of shownAttestations) await viewed('note.viewed', 'note_attestation', a.id);

    // The hash to co-sign or attest with: whoever may act on the note and sees all of it (lifecycle
    // 5.1, 5.3, 5.4; second-person.ts), besides those who get every sign-off's. Never over a summary
    // the reader may not read.
    //
    // Unlike D86's rule for the sign-offs' hashes, this one asks what the note holds: a reader who
    // may co-sign or attest learns from a missing hash that the note holds content they may not
    // see. The queue's canAct already tells them that (5.4 rule 4), and the online act needs the
    // hash, so the coordinator kept it (review finding LRD-3). The sync read keeps D86: it sends no
    // note's hash, and a sign-off's only by signoffHashShown.
    const hashShown =
      !hideMedical &&
      (reader.actsAsAuthor || readsWhole(reader) || (maySecondSign(scope) && second.seesAllThatCounts));
    const attrs = note.attributes as {
      noteTypeKey: string;
      noteTypeVersion: number;
      attestation: VisitNoteValue['attestation'];
      completedAt: string | null;
    };
    notes.push({
      noteId: note.id,
      noteTypeKey: attrs.noteTypeKey,
      noteTypeVersion: attrs.noteTypeVersion,
      title: type.title,
      group: type.group,
      medical: note.internal.medical === true,
      status: note.status as VisitNoteValue['status'],
      attestation: attrs.attestation,
      completedAt: attrs.completedAt,
      author: user(note.authorUserId),
      actingAuthor: user(actingAuthor(note)),
      read: byDefinition(() => readModel(type, seen, shownCorrections.map(asNoteCorrection))),
      // Over what the reader sees, as the read model is: the phone shows the recap of a visit read
      // here or from the cached chart, and holds no answers to work it out from (lifecycle 8.1, D108).
      recap: byDefinition(() => recapLines(type, seen)),
      signoffs: shownSignoffs.map((s) => ({
        id: s.id,
        act: s.act,
        effect: s.effect,
        signer: { userId: s.signerUserId, displayName: s.signerName },
        credential: s.signerCredential,
        claimedCredential: s.claimedCredential,
        needsAttestation: s.needsAttestation,
        statementVersion: s.statementVersion,
        signedAt: s.signedAt.toISOString(),
        clockVerified: s.clockVerified,
        ...(signoffHashShown(read, s.signerUserId, scope.principal.userId, hideMedical)
          ? { contentHash: s.contentHash }
          : {}),
      })),
      addenda: shownAddenda.map(addendumView),
      corrections: shownCorrections.map((c) => ({
        id: c.id,
        outcome: c.outcome,
        fields: c.changes.map((x) => x.field),
        requestedByPatient: c.requestedByPatient,
        reason: c.reason,
        corrector: { userId: c.correctorUserId, displayName: c.correctorName },
        credential: c.correctorCredential,
        correctedAt: c.correctedAt.toISOString(),
        clockVerified: c.clockVerified,
      })),
      attestations: shownAttestations.map((a) => ({
        id: a.id,
        signoffId: a.signoffId,
        attending: { userId: a.attendingUserId, displayName: a.attendingName },
        statementVersion: a.statementVersion,
        attestedAt: a.attestedAt.toISOString(),
      })),
      ...(hashShown
        ? {
            contentHash: await byDefinition(() =>
              noteContentHash({
                noteId: note.id,
                encounterId: visit.id,
                patientId,
                summary: visit.values.summary as string | null,
                definition: type,
                answers,
              }),
            ),
          }
        : {}),
      // What the reader may do to it as a second person, and why not (second-person.ts), so the
      // page sends exactly the notes the act takes and words a held note truly.
      ...secondPersonView(scope, second),
    });
  }

  // An addendum to the visit itself is read with the visit: with its summary, on a Medical one.
  const ownAddenda = hideMedical ? [] : addenda.filter((a) => a.noteId === null);
  for (const a of ownAddenda) await viewed('note.viewed', 'note_addendum', a.id);

  const records = await recordsMadeAt(tx, scope, visit);
  for (const r of records) await viewed('patient.viewed', r.entity, r.record.id, r.record.patientId);

  return {
    encounterId: visit.id,
    patientId,
    kind: visit.values.kind as VisitReadValue['kind'],
    status: statusShown(reads.map(statusNote)),
    startedAt: visit.attributes.startedAt as string,
    clockVerified: visit.attributes.clockVerified as boolean,
    locationText: visit.values.locationText as string | null,
    preferredName: patientId ? ((await preferredNames(tx, scope, [patientId])).get(patientId) ?? null) : null,
    hasHandoff,
    ...(hideMedical ? {} : { summary: visit.values.summary as string | null }),
    addenda: ownAddenda.map(addendumView),
    notes,
    records: records.map((r) => snapshot(r.record)),
  };
}

const asNoteCorrection = (c: CorrectionRow): NoteCorrection => ({
  outcome: c.outcome,
  reason: c.reason,
  correctorName: c.correctorName,
  correctorCredential: c.correctorCredential,
  correctedAt: c.correctedAt.toISOString(),
  changes: c.changes,
});

const addendumView = (a: AddendumRow) => ({
  id: a.id,
  noteId: a.noteId,
  text: a.text,
  author: { userId: a.authorUserId, displayName: a.authorName },
  credential: a.authorCredential,
  writtenAt: a.writtenAt.toISOString(),
  clockVerified: a.clockVerified,
});

async function displayNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await tx<{ id: string; displayName: string }[]>`
    select id, display_name from sineobex.users where id = any (${wanted}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/**
 * The records made at the visit (lifecycle 9.7, D91): its referrals, allergies, problems and
 * problems' notes, whichever chart they are on, since a visit moved to another patient leaves them
 * with the first (12.1 #25) and this list is how the clinician finds each to enter it in error.
 * Each as the chart shows it to the reader (phase 3 design 4.3): a problem and its notes need the
 * problem list's keys, and a sensitive one patients.view_sensitive. The route already needs
 * patients.view, which reads the rest.
 */
async function recordsMadeAt(
  tx: Tx,
  scope: TeamScope,
  visit: StoredRecord,
): Promise<{ entity: AnyRecordEntityName; record: StoredRecord }[]> {
  const problems = mayViewProblems(scope.team.permissions);
  const sensitive = scope.can('patients.view_sensitive');
  const rows = await tx<{ entity: AnyRecordEntityName; id: string }[]>`
    select 'referral' as entity, id, recorded_at as at from sineobex.referrals
    where team_id = ${visit.teamId} and encounter_id = ${visit.id}
    union all
    select 'patient_allergy', id, recorded_at from sineobex.patient_allergies
    where team_id = ${visit.teamId} and encounter_id = ${visit.id}
    ${
      problems
        ? tx`
    union all
    select 'problem', pr.id, pr.created_at from sineobex.problems pr
    where pr.team_id = ${visit.teamId} and pr.created_encounter_id = ${visit.id} ${sensitive ? tx`` : tx`and not pr.sensitive`}
    union all
    select 'problem_note', n.id, n.written_at from sineobex.problem_notes n
    join sineobex.problems pr on pr.team_id = n.team_id and pr.id = n.problem_id
    where n.team_id = ${visit.teamId} and n.encounter_id = ${visit.id} ${sensitive ? tx`` : tx`and not pr.sensitive`}`
        : tx``
    }
    order by at, id`;
  const out: { entity: AnyRecordEntityName; record: StoredRecord }[] = [];
  for (const r of rows) {
    const record = await RULES[r.entity].load(tx, r.id, false);
    if (record) out.push({ entity: r.entity, record });
  }
  return out;
}
