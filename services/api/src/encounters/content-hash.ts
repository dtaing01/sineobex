/**
 * The hash a sign-off carries (phase 4 design, lifecycle 4.5): what the person saw when they
 * pressed Complete, which the server works out again over what it holds. Pure: no database, no
 * clock, no network. packages/contract/test-vectors/note-content-hash.json holds every answer; the
 * phone's apps/mobile/lib/encounters/content_hash.dart must give the same ones.
 */
import { effectiveAnswers, type Answers, type ResolvedNoteType } from '@sineobex/forms';
import { canonicalJson, sha256Hex } from '../sync/canonical.ts';

export interface NoteContentInput {
  noteId: string;
  encounterId: string;
  /** The encounter's patient, or null. */
  patientId: string | null;
  /** The encounter's summary, or null. */
  summary: string | null;
  /** The note's own version of its note type: its key and version are what is hashed. */
  definition: ResolvedNoteType;
  /** The note's data as stored, every answer in it. */
  answers: Answers;
}

/**
 * What is hashed. The patient and the summary are on the screen where Complete is pressed, so a
 * visit moved to another patient, or a summary rewritten, between what the signer saw and what the
 * server holds refuses the signature. The answers are only those that count: a signer is never
 * shown an answer in a hidden field or a removed entry, and a field cleared is a field never
 * touched (effectiveAnswers leaves blanks out). Not in it: the kind, addenda, later corrections,
 * the time, the device.
 */
export function noteContent(i: NoteContentInput) {
  return {
    v: 1,
    noteId: i.noteId,
    encounterId: i.encounterId,
    // ?? null: canonical JSON drops an undefined key, and the phone always writes both keys.
    patientId: i.patientId ?? null,
    noteTypeKey: i.definition.key,
    noteTypeVersion: i.definition.version,
    summary: i.summary ?? null,
    answers: effectiveAnswers(i.definition, i.answers),
  };
}

/** Lowercase hex SHA-256 of noteContent's canonical JSON: the change hashes' own two functions. */
export function noteContentHash(i: NoteContentInput): Promise<string> {
  return sha256Hex(canonicalJson(noteContent(i)));
}
