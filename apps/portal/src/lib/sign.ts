import type { Schemas } from '@sineobex/contract';
import { refusalRedirect } from './refusals';

/**
 * Co-sign and Attest on the visit page (phase 4 design, lifecycle 3.5, 3.7, 5.3, 5.4, 9.11): which
 * notes a press sends, what the route handler takes, and where an answer sends the person. Which
 * notes may be co-signed or attested, and by whom, the API decides (`canCosign`, `canAttest`); these
 * only carry its answer.
 */

export type SignAct = 'cosign' | 'attest';

const these = (notes: number) => (notes === 1 ? 'this note' : `these ${notes} notes`);

/**
 * What a second person is shown above the button, and the version stored with each act.
 *
 * PLAN-OPEN: the wording a signer, a co-signer and an attester are shown (lifecycle 12.1 #5): the
 * sentences of 3.5, each with its version, as the phone shows them.
 */
export const SIGN_ACTS = {
  cosign: {
    heading: 'Co-sign',
    statement: 'I reviewed this note and agree with it.',
    statementVersion: 'cosign-2026-11',
    done: 'cosigned',
    lead: (notes: number) => `Co-sign signs ${these(notes)} with your name and credential:`,
  },
  attest: {
    heading: 'Attest',
    statement: 'I reviewed this note and agree with the assessment and plan.',
    statementVersion: 'attest-2026-11',
    done: 'attested',
    // PRD main 216: "Attesting adds a dated statement below the note and doesn't change it".
    lead: (notes: number) =>
      `Attest adds your dated attestation below ${these(notes)}, and changes nothing in ${notes === 1 ? 'it' : 'them'}:`,
  },
} as const;

/** A note a press sends, with the hash of the note as the visit read gave it. */
export interface PlanNote {
  noteId: string;
  contentHash: string;
}

export interface SignPlan {
  notes: PlanNote[];
  /** Each note's title, in the same order: what the section says it covers. */
  titles: string[];
}

/**
 * Every note of the visit the read marks for the act, in the read's order, each with the hash the
 * read gave (5.3: the list must hold every waiting note the person may act on). Null when there is
 * none, and when a marked note came without its hash: the API refuses a plan that leaves one out.
 */
export function signPlan(
  notes: Pick<Schemas['VisitNote'], 'noteId' | 'title' | 'canCosign' | 'canAttest' | 'contentHash'>[],
  act: SignAct,
): SignPlan | null {
  const marked = notes.filter((n) => (act === 'cosign' ? n.canCosign : n.canAttest));
  if (marked.length === 0 || marked.some((n) => !n.contentHash)) return null;
  return {
    notes: marked.map((n) => ({ noteId: n.noteId, contentHash: n.contentHash! })),
    titles: marked.map((n) => n.title || 'Note'),
  };
}

/** The same notes, in the same order, with the same hashes. */
export function samePlan(a: readonly PlanNote[], b: readonly PlanNote[]): boolean {
  return (
    a.length === b.length &&
    a.every((n, i) => n.noteId === b[i]!.noteId && n.contentHash === b[i]!.contentHash)
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
// The API's NoteActInput: one to 50 notes, each named once.
const MAX_NOTES = 50;

/**
 * What the visit page posts to its route handler: the act, and the plan the person read. Anything
 * else in it is dropped; the statement's version is the portal's, never the browser's.
 */
export function signRequest(body: unknown): { act: SignAct; notes: PlanNote[] } | null {
  const b = body as { act?: unknown; notes?: unknown } | null;
  if (typeof b !== 'object' || b === null) return null;
  if (b.act !== 'cosign' && b.act !== 'attest') return null;
  if (!Array.isArray(b.notes) || b.notes.length === 0 || b.notes.length > MAX_NOTES) return null;
  const notes: PlanNote[] = [];
  for (const n of b.notes as { noteId?: unknown; contentHash?: unknown }[]) {
    if (typeof n?.noteId !== 'string' || !UUID.test(n.noteId)) return null;
    if (typeof n.contentHash !== 'string' || !HASH.test(n.contentHash)) return null;
    if (notes.some((m) => m.noteId === n.noteId)) return null;
    notes.push({ noteId: n.noteId, contentHash: n.contentHash });
  }
  return { act: b.act, notes };
}

/** What the visit page says when it is loaded again after a press (`?signed=`). */
export const SIGNED_STATES = {
  cosigned: { tone: 'ok', text: 'Co-signed. Your co-signature is on each note below.' },
  attested: { tone: 'ok', text: 'Attested. Your attestation is on each note below.' },
  // The design's sentence (lifecycle 9.9).
  changed: { tone: 'info', text: 'This visit changed. Read it again.' },
  cannot_sign: { tone: 'info', text: 'Your credential can’t co-sign notes now.' },
  cannot_attest: { tone: 'info', text: 'Your credential can’t attest notes now.' },
} as const;

export type SignedState = keyof typeof SIGNED_STATES;

export function signedState(value: unknown): SignedState | null {
  return typeof value === 'string' && Object.hasOwn(SIGNED_STATES, value) ? (value as SignedState) : null;
}

/** The visit page, loaded again with what to say. */
export function visitAfter(encounterId: string, state: SignedState): string {
  return `/encounters/${encounterId}?signed=${state}`;
}

export type SignAnswer = { go: string } | { problem: string };

/**
 * Where the API's answer to a press sends the person. Every outcome but a failure loads the visit
 * again, whole: the page then shows what the API holds now, which the person reads before a second
 * press. A 409 is the design's "This visit changed. Read it again." So is a refusal about a note that
 * became theirs since the read (`is_author`, `is_signer`) or now holds a part they can't open: the
 * visit loaded again says why under each note, in words that never tell an assignee they wrote it.
 */
export function signAnswer(encounterId: string, act: SignAct, status: number, code: string): SignAnswer {
  const visit = `/encounters/${encounterId}`;
  if (status >= 200 && status < 300) return { go: visitAfter(encounterId, SIGN_ACTS[act].done) };
  const to = refusalRedirect(code, visit);
  if (to) return { go: to };
  if (status === 409 || ['is_author', 'is_signer', 'cannot_see_all'].includes(code))
    return { go: visitAfter(encounterId, 'changed') };
  if (code === 'cannot_sign' || code === 'cannot_attest') return { go: visitAfter(encounterId, code) };
  if (status === 404) return { go: visit };
  if (status === 400 || status === 422)
    return { problem: 'Something about this request was wrong. Load the visit again.' };
  return { problem: 'Something went wrong. Try again.' };
}
