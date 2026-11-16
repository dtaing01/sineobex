/**
 * The rules of a note's life (phase 4 design, lifecycle 3.12). Pure: no database, no clock, no
 * network. packages/contract/test-vectors/note-lifecycle.json holds every answer; the phone's
 * apps/mobile/lib/encounters/rules.dart must give the same ones.
 */
export type NoteStatus = 'draft' | 'completed' | 'signed';
export type Attestation = 'not_needed' | 'waiting' | 'attested';

/** A note still a draft this long after its visit started is overdue (PRD main 99; lifecycle 3.9). */
export const INCOMPLETE_AFTER_HOURS = 24;

export type SignoffRefusal = 'content_changed' | 'incomplete' | 'red_flags_first';
export type SignoffEffect =
  | { refuse: SignoffRefusal }
  | { effect: 'none'; reason: 'already_finished' | 'not_author' }
  | {
      effect: 'completed' | 'signed' | 'saved_unsigned';
      statusAfter: NoteStatus;
      attestationAfter: Attestation;
    };

/**
 * What a `complete` or a `sign` does to a note (lifecycle 3.4). The first check that applies
 * decides, so the order below is the rule: a finished note is never looked at again, and a note
 * that changed since the person read it is refused before anything is said about its content.
 */
export function signoffEffect(i: {
  noteStatus: NoteStatus;
  medicalNote: boolean;
  act: 'complete' | 'sign';
  actsAsAuthor: boolean;
  canSign: boolean;
  needsAttestation: boolean;
  hashMatches: boolean;
  finishOk: boolean;
  /** The visit has a finished Red flags note, or this note is one. */
  redFlagsDone: boolean;
}): SignoffEffect {
  if (i.noteStatus !== 'draft') return { effect: 'none', reason: 'already_finished' };
  if (!i.actsAsAuthor) return { effect: 'none', reason: 'not_author' };
  if (!i.hashMatches) return { refuse: 'content_changed' };
  if (!i.finishOk) return { refuse: 'incomplete' };
  if (i.medicalNote && !i.redFlagsDone) return { refuse: 'red_flags_first' };
  // A Non-Medical note is never signed (lifecycle 3.1), so `sign` on one is a `complete`.
  // PLAN-OPEN: is a Social needs or Outreach note inside a Medical visit signed and attested
  // (lifecycle 12.1 #19)? No.
  if (!i.medicalNote || i.act === 'complete') {
    return { effect: 'completed', statusAfter: 'completed', attestationAfter: 'not_needed' };
  }
  if (i.canSign) {
    return {
      effect: 'signed',
      statusAfter: 'signed',
      attestationAfter: i.needsAttestation ? 'waiting' : 'not_needed',
    };
  }
  // The credential was lowered while the phone was offline: kept, and routed to a co-signer.
  return { effect: 'saved_unsigned', statusAfter: 'completed', attestationAfter: 'not_needed' };
}

/**
 * What a `set` of a note's status to `draft` does (the table in lifecycle 4.4). Only a Medical
 * note that waits for a co-signer and was never signed goes back, and only for its acting author.
 *
 * PLAN-OPEN: can a co-signer send a note back to its author (lifecycle 12.1 #8)? No: only the
 * author reopens it, while it was never signed.
 */
export function reopenEffect(i: {
  noteStatus: NoteStatus;
  everSigned: boolean;
  medicalNote: boolean;
  actsAsAuthor: boolean;
}): 'apply' | 'nothing' | 'keep_in_history' {
  if (i.noteStatus === 'draft') return 'nothing';
  if (i.noteStatus === 'signed' || i.everSigned) return 'keep_in_history';
  if (!i.medicalNote) return 'keep_in_history';
  if (i.actsAsAuthor) return 'apply';
  return 'keep_in_history';
}

/**
 * What a correction that changed a finished note does to its state (the table in lifecycle 3.6).
 * A note is signed only while someone who may sign covers what it says now.
 */
export function correctionEffect(i: {
  noteStatus: 'completed' | 'signed';
  attestation: Attestation;
  correctorCanSign: boolean;
  correctorNeedsAttestation: boolean;
}): { statusAfter: 'completed' | 'signed'; attestationAfter: Attestation; clearSignoff: boolean } {
  if (i.noteStatus === 'completed') {
    return { statusAfter: 'completed', attestationAfter: i.attestation, clearSignoff: false };
  }
  if (!i.correctorCanSign) {
    return { statusAfter: 'completed', attestationAfter: 'not_needed', clearSignoff: true };
  }
  if (i.correctorNeedsAttestation) {
    return { statusAfter: 'signed', attestationAfter: 'waiting', clearSignoff: false };
  }
  // A note that was waiting stays waiting: an attending who corrects one answer has not attested
  // the rest.
  return { statusAfter: 'signed', attestationAfter: i.attestation, clearSignoff: false };
}

export type CosignRefusal =
  'not_waiting' | 'is_author' | 'cannot_sign' | 'cannot_see_all' | 'content_changed';

/**
 * One note of an online co-sign (lifecycle 5.3). The refusals are checked in the order listed.
 *
 * PLAN-OPEN: may a resident, NP or PA co-sign a student's note, or only an attending (lifecycle
 * 12.1 #6)? Any credential that signs; the note then waits for attestation if that credential
 * needs it.
 */
export function cosignEffect(i: {
  noteStatus: NoteStatus;
  medicalNote: boolean;
  actsAsAuthor: boolean;
  canSign: boolean;
  needsAttestation: boolean;
  seesAllThatCounts: boolean;
  hashMatches: boolean;
}): { refuse: CosignRefusal } | { statusAfter: 'signed'; attestationAfter: Attestation } {
  if (i.noteStatus !== 'completed' || !i.medicalNote) return { refuse: 'not_waiting' };
  if (i.actsAsAuthor) return { refuse: 'is_author' };
  if (!i.canSign) return { refuse: 'cannot_sign' };
  if (!i.seesAllThatCounts) return { refuse: 'cannot_see_all' };
  if (!i.hashMatches) return { refuse: 'content_changed' };
  return { statusAfter: 'signed', attestationAfter: i.needsAttestation ? 'waiting' : 'not_needed' };
}

export type AttestRefusal =
  'not_waiting' | 'is_author' | 'is_signer' | 'cannot_attest' | 'cannot_see_all' | 'content_changed';

/** One note of an online attestation (lifecycle 5.4). The refusals are checked in the order listed. */
export function attestEffect(i: {
  noteStatus: NoteStatus;
  attestation: Attestation;
  actsAsAuthor: boolean;
  /** The note's current signature is the caller's own. */
  isSigner: boolean;
  canAttest: boolean;
  seesAllThatCounts: boolean;
  hashMatches: boolean;
}): { refuse: AttestRefusal } | { attestationAfter: 'attested' } {
  if (i.noteStatus !== 'signed' || i.attestation !== 'waiting') return { refuse: 'not_waiting' };
  if (i.actsAsAuthor) return { refuse: 'is_author' };
  if (i.isSigner) return { refuse: 'is_signer' };
  if (!i.canAttest) return { refuse: 'cannot_attest' };
  if (!i.seesAllThatCounts) return { refuse: 'cannot_see_all' };
  if (!i.hashMatches) return { refuse: 'content_changed' };
  return { attestationAfter: 'attested' };
}

export type AssignRefusal =
  'author_active' | 'assignee_not_member' | 'assignee_cannot_chart' | 'credential_too_low' | 'cannot_see_all';

/** Whether a Program Admin may hand a departed author's note to this clinician (lifecycle 3.8, 5.5). */
export function mayAssign(i: {
  actingAuthorActive: boolean;
  assigneeActive: boolean;
  assigneeCanChart: boolean;
  assigneeRank: number;
  /** The rank the note was signed under; for an unsigned note, of its author's last credential. */
  neededRank: number;
  /** The note holds an answer that counts in a section the assignee's role cannot see today. */
  noteHasHiddenSection: boolean;
}): 'ok' | { refuse: AssignRefusal } {
  if (i.actingAuthorActive) return { refuse: 'author_active' };
  if (!i.assigneeActive) return { refuse: 'assignee_not_member' };
  if (!i.assigneeCanChart) return { refuse: 'assignee_cannot_chart' };
  if (i.assigneeRank < i.neededRank) return { refuse: 'credential_too_low' };
  if (i.noteHasHiddenSection) return { refuse: 'cannot_see_all' };
  return 'ok';
}

function isBlank(value: unknown): boolean {
  if (value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/**
 * True when every answer is null, "", [] or {}: the note counts as not there (lifecycle 3.1).
 * The database's sineobex.note_is_empty holds the same rule (migration 0018).
 */
export function noteIsEmpty(answers: Record<string, unknown>): boolean {
  return Object.values(answers).every(isBlank);
}

/**
 * An encounter's status, from its notes (lifecycle 2.2; the database works out the same in
 * sineobex.encounter_status). An empty draft does not count.
 */
export function encounterStatus(
  notes: { status: NoteStatus; medical: boolean; empty: boolean }[],
): NoteStatus {
  const counted = notes.filter((n) => !(n.status === 'draft' && n.empty));
  if (counted.length === 0) return 'draft';
  if (counted.some((n) => n.status === 'draft')) return 'draft';
  if (counted.some((n) => n.status === 'completed' && n.medical)) return 'completed';
  if (counted.some((n) => n.status === 'signed')) return 'signed';
  return 'completed';
}

/** The patient, the place and the summary are locked from the first finished note on (lifecycle 3.1). */
export function envelopeLocked(noteStatuses: NoteStatus[]): boolean {
  return noteStatuses.some((s) => s !== 'draft');
}

/**
 * Whether a note is overdue (lifecycle 3.9). Times are ISO 8601 strings in UTC. A start time the
 * phone could not verify is not believed once the server has one of its own: the time it received
 * the encounter.
 */
export function isOverdue(i: {
  noteStatus: NoteStatus;
  startedAt: string;
  startedVerified: boolean;
  /** Null on the phone for an encounter the server has not confirmed. */
  receivedAt: string | null;
  now: string;
}): boolean {
  if (i.noteStatus !== 'draft') return false;
  const start = !i.startedVerified && i.receivedAt !== null ? i.receivedAt : i.startedAt;
  return Date.parse(i.now) - Date.parse(start) > INCOMPLETE_AFTER_HOURS * 3600 * 1000;
}
