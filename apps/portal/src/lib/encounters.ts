import type { Schemas } from '@sineobex/contract';
import { formatDay } from '@/app/(app)/patients/format';
import { CREDENTIAL_LABELS, formatDateTime } from './labels';

/**
 * A visit and its notes as the portal's pages say them (phase 4 design, lifecycle 3.1, 3.5, 9.7,
 * 9.11). Pure functions of what the API returned: what a reader may see, and what each note waits
 * for, the API has already decided; these only word it.
 */

type VisitNote = Schemas['VisitNote'];

export const ENCOUNTER_KIND: Record<Schemas['EncounterKind'], string> = {
  medical: 'Medical',
  non_medical: 'Non-Medical',
};

/** A note's state, in the words the apps show (lifecycle 3.1, the table's first column). */
export function noteState(note: {
  status: Schemas['NoteStatus'];
  attestation: Schemas['NoteAttestation'];
  medical: boolean;
}): string {
  if (note.status === 'draft') return 'Draft';
  if (note.status === 'completed') return note.medical ? 'Waiting for a co-signer' : 'Complete';
  if (note.attestation === 'waiting') return 'Signed, waiting for attestation';
  if (note.attestation === 'attested') return 'Signed and attested';
  return 'Signed';
}

/**
 * Why a note that waits for a co-signature or an attestation waits for someone other than the
 * reader, when the API says it is about the note (`heldBecause`, lifecycle 5.1). Someone a note was
 * assigned to acts as its author without having written it, and is told so (review of unit L6's
 * earlier build). A reason about the reader's credential or role is never given: the page then
 * offers no action, as the API decides.
 */
export function heldBecauseText(note: Pick<VisitNote, 'status' | 'heldBecause'>): string | null {
  return heldReasonText(note.heldBecause, note.status === 'completed' ? 'cosign' : 'attest');
}

/**
 * The same sentence for a note known to wait for [act]: a queue's note, which says why in the visit
 * page's words (lifecycle 5.4).
 */
export function heldReasonText(
  reason: VisitNote['heldBecause'],
  signAct: 'cosign' | 'attest',
): string | null {
  const act = signAct === 'cosign' ? 'co-sign' : 'attest';
  switch (reason) {
    case 'wrote':
      return `You wrote this note, so someone else has to ${act} it.`;
    case 'acts_as_author':
      return `This note was assigned to you, so someone else has to ${act} it.`;
    case 'completed':
      return `You completed this note, so someone else has to ${act} it.`;
    case 'signed':
      return `You signed this note, so someone else has to ${act} it.`;
    case 'cannot_see_all':
      return 'This note has a part you can’t open. Ask a Program Admin.';
    default:
      return null;
  }
}

/** A moment, with "time not verified" when the phone's clock had not been checked (lifecycle 3.5). */
function when(at: string, clockVerified = true): string {
  const time = Number.isNaN(Date.parse(at)) ? at : formatDateTime(at);
  return clockVerified ? time : `${time}, time not verified`;
}

export function startedText(startedAt: string, clockVerified: boolean): string {
  return when(startedAt, clockVerified);
}

/** "Casey Nguyen (demo), Resident": a person and the credential a record keeps, when it is one. */
function who(name: string, credential: string | null | undefined): string {
  const words = credential && credential !== 'none' ? CREDENTIAL_LABELS[credential] : undefined;
  return words ? `${name}, ${words}` : name;
}

export interface TrailEntry {
  id: string;
  at: string;
  /** The line itself: who, under which credential, and when. */
  text: string;
  /** An addendum's text. */
  body?: string;
  /** A correction's reason. */
  reason?: string;
}

function signoffText(s: Schemas['SignoffView']): string {
  const by = who(s.signer.displayName, s.credential);
  const at = when(s.signedAt, s.clockVerified);
  if (s.effect === 'none') return `Sent again by ${s.signer.displayName}, ${at}. It changed nothing.`;
  if (s.effect === 'saved_unsigned') return `Saved unsigned for a co-signer by ${by}, ${at}`;
  if (s.act === 'cosign') return `Co-signed by ${by}, ${at}`;
  if (s.effect === 'completed') return `Completed by ${by}, ${at}`;
  return `Signed by ${by}, ${at}`;
}

function correctionText(c: Schemas['CorrectionView']): string {
  const by = who(c.corrector.displayName, c.credential);
  const at = when(c.correctedAt, c.clockVerified);
  switch (c.outcome) {
    case 'corrected':
      return c.requestedByPatient
        ? `Corrected at the patient’s request by ${by}, ${at}`
        : `Corrected by ${by}, ${at}`;
    case 'declined':
      return `Amendment request declined by ${by}, ${at}. The note is unchanged.`;
    case 'no_change':
      return `Correction by ${by}, ${at}. The note already held those values.`;
    case 'draft_edit':
      return `Changed by ${by}, ${at}, while the note was a draft again`;
    case 'not_author':
      return `Correction sent by ${by}, ${at}. Not applied: they don’t act as the note’s author.`;
  }
}

/**
 * What hangs off a note, in time order (lifecycle 9.7): sign-offs ("Signed by {name}, {credential},
 * {date}"), co-signatures, attestations ("Attested by {name}, {date}"), corrections and addenda.
 * Records of the same moment keep one order, by ID.
 */
export function noteTrail(note: VisitNote): TrailEntry[] {
  const entries: TrailEntry[] = [
    ...note.signoffs.map((s) => ({ id: s.id, at: s.signedAt, text: signoffText(s) })),
    ...note.attestations.map((a) => ({
      id: a.id,
      at: a.attestedAt,
      text: `Attested by ${a.attending.displayName}, ${when(a.attestedAt)}`,
    })),
    ...note.corrections.map((c) => ({
      id: c.id,
      at: c.correctedAt,
      text: correctionText(c),
      reason: c.reason,
    })),
    ...note.addenda.map((a) => addendumEntry(a)),
  ];
  return entries.sort((a, b) => cmp(Date.parse(a.at), Date.parse(b.at)) || cmp(a.id, b.id));
}

/** An addendum, to a note or to the visit itself. */
export function addendumEntry(a: Schemas['AddendumView']): TrailEntry {
  return {
    id: a.id,
    at: a.writtenAt,
    text: `Addendum by ${who(a.author.displayName, a.credential)}, ${when(a.writtenAt, a.clockVerified)}`,
    body: a.text,
  };
}

const cmp = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

/** Who replaced a corrected answer, and when (PRD main 460; forms 7.1). */
export function replacedBy(c: Schemas['ReadCorrection']): string {
  return `Changed by ${who(c.by, c.credential)}, ${when(c.at)}`;
}

// ------------------------------------------------------------------------------------------------
// The patient page's timeline (lifecycle 5.2, 9.11)
// ------------------------------------------------------------------------------------------------

/** Visits per page of the timeline: the API's TIMELINE_PAGE. A full page may have more after it. */
export const TIMELINE_PAGE = 50;

/** A visit as the timeline lists it, and nothing more: the browser gets only what is on screen. */
export interface VisitRow {
  encounterId: string;
  when: string;
  kind: string;
  notes: { noteId: string; title: string; state: string }[];
}

export function visitRow(v: Schemas['TimelineVisit']): VisitRow {
  return {
    encounterId: v.encounterId,
    when: formatDateTime(v.startedAt),
    kind: ENCOUNTER_KIND[v.kind],
    // Titles come with the timeline, so no page reads the note types list (lifecycle 5 as built).
    notes: v.notes.map((n) => ({ noteId: n.noteId, title: n.title || 'Note', state: noteState(n) })),
  };
}

/**
 * What the portal's earlier-visits route answers the timeline: the next visits, and whether a full
 * page came (so there may be more); or where to go first (sign in again, and the like); or a
 * sentence to show.
 */
export type EarlierAnswer = { visits: VisitRow[]; more: boolean } | { go: string } | { problem: string };

export interface ReferralRow {
  id: string;
  referredOn: string;
  details: string;
  recordedBy: string;
  /** The visit it was made at, when it names one. */
  encounterId: string | null;
  /** The reason it was entered in error, or null while it stands. */
  enteredInError: string | null;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * The chart's referrals (lifecycle 7): newest first by their date, then by when they were recorded,
 * each naming who recorded it. One entered in error stays in the list, with its reason.
 */
export function referralRows(referrals: Schemas['RecordSnapshot'][]): ReferralRow[] {
  return [...referrals]
    .sort(
      (a, b) =>
        cmp(text(b.attributes.referredOn), text(a.attributes.referredOn)) ||
        cmp(text(b.attributes.recordedAt), text(a.attributes.recordedAt)) ||
        cmp(a.id, b.id),
    )
    .map((r) => {
      const referredOn = text(r.attributes.referredOn);
      const error = r.fields.enteredInError?.value as { reason?: string } | null | undefined;
      return {
        id: r.id,
        referredOn: /^\d{4}-\d{2}-\d{2}$/.test(referredOn) ? formatDay(referredOn) : referredOn,
        details: text(r.attributes.details),
        recordedBy: text(r.attributes.authorName) || 'A teammate',
        encounterId: text(r.attributes.encounterId) || null,
        enteredInError: r.status === 'entered_in_error' ? (error?.reason ?? '') : null,
      };
    });
}

// ------------------------------------------------------------------------------------------------
// The records made at a visit (lifecycle 9.7, 8.4)
// ------------------------------------------------------------------------------------------------

export interface MadeAtRow {
  id: string;
  /** "Referral, Oct 3, 2026: Demo: dental van". */
  text: string;
  enteredInError: boolean;
  /** The chart it is on: a visit moved to someone else leaves its records with the first (12.1 #25). */
  patientId: string | null;
  /** On a chart other than the visit's own now. */
  elsewhere: boolean;
}

// The order lifecycle 9.7 lists them in; the API's order, by when each was made, within a kind.
const MADE_AT_ORDER = ['referral', 'problem', 'patient_allergy', 'problem_note'];

function madeAtText(r: Schemas['RecordSnapshot']): string {
  const a = r.attributes;
  switch (r.entity) {
    case 'referral': {
      const on = text(a.referredOn);
      return `Referral, ${/^\d{4}-\d{2}-\d{2}$/.test(on) ? formatDay(on) : on}: ${text(a.details)}`;
    }
    case 'problem': {
      const code = (a.code as { code?: string } | null | undefined)?.code;
      return `Problem: ${text(a.title)}${code ? ` (${code})` : ''}`;
    }
    case 'patient_allergy':
      return `Allergy: ${text(a.substance)}`;
    case 'problem_note':
      return `Note on a problem: ${text(a.text)}`;
    default:
      return 'A record';
  }
}

/**
 * The referrals, problems, allergies and problems' notes made at the visit, whichever chart they
 * are on, as the API gives them to this reader. Each names the chart it is on, so the person can
 * open it there.
 */
export function madeAtRows(records: Schemas['RecordSnapshot'][], visitPatientId: string | null): MadeAtRow[] {
  const rank = (entity: string) => {
    const i = MADE_AT_ORDER.indexOf(entity);
    return i === -1 ? MADE_AT_ORDER.length : i;
  };
  return records
    .map((r, i) => ({ r, i }))
    .sort((x, y) => rank(x.r.entity) - rank(y.r.entity) || x.i - y.i)
    .map(({ r }) => {
      const patientId = text(r.attributes.patientId) || null;
      return {
        id: r.id,
        text: madeAtText(r),
        enteredInError: r.status === 'entered_in_error' || !!r.fields.enteredInError?.value,
        patientId,
        elsewhere: patientId !== null && patientId !== visitPatientId,
      };
    });
}
