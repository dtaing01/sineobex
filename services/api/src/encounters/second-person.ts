import { effectiveAnswers } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import { CAPABILITIES } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { actingAuthor } from '../sync/entities/note.ts';
import { byDefinition, DefinitionError, sameValue, type StoredRecord } from '../sync/records.ts';
import { medicalHidden, noteAsRead, type NoteRead } from './read.ts';
import { attestEffect, cosignEffect, type Attestation, type NoteStatus } from './rules.ts';

/**
 * Who may co-sign or attest a note (lifecycle 3.7, 5.3, 5.4, 6.4 rule 4), decided here alone: the
 * acts (cosign.ts, attest.ts), the queues' canAct (queues.ts) and the visit read's canCosign,
 * canAttest and heldBecause (read.ts) all ask it, so the act, the queue and the page never disagree.
 * The rules are cosignEffect's and attestEffect's (rules.ts); this module loads what they ask of a
 * note and of the person asking.
 */

/**
 * How the caller stands to a note as its author, the first that is true: they wrote it; they act as
 * its author now without having written it (an assignee, 3.8); or they completed it, as whoever
 * acted as its author then. Each makes them no second person to it (is_author).
 */
export type Authorship = 'wrote' | 'acts_as_author' | 'completed';

/** A note as a second person finds it: what cosignEffect and attestEffect ask of the note. */
export interface ActNote {
  note: StoredRecord;
  /** Null when the caller may not read the note at all, or the server cannot read its definition. */
  read: NoteRead | null;
  /** Null when the caller is none of the note's authors. */
  authorship: Authorship | null;
  /**
   * The caller is no second person to the note (3.7): they act as its author now, wrote it, or
   * completed it. What the rules call actsAsAuthor (is_author): a note's writer whose note was
   * assigned away while they were gone is still its writer when they come back (review findings
   * LPM-1, LAC-3).
   */
  actsAsAuthor: boolean;
  /**
   * The caller sees every answer that counts (lifecycle 6.4 rule 4): what visibleAnswers gives them
   * is all of effectiveAnswers, and the summary the hash covers is theirs to read.
   */
  seesAllThatCounts: boolean;
  /** Who made the note's current signature, or null for a note it does not name one. */
  signerUserId: string | null;
}

/**
 * The note as the caller finds it as a second person. [read] is the caller's read of the note
 * (noteAsRead) when the caller has it already, so the visit read does not read each note twice.
 */
export async function actNote(
  tx: Tx,
  scope: TeamScope,
  visit: StoredRecord,
  note: StoredRecord,
  read?: NoteRead | null,
): Promise<ActNote> {
  const caller = scope.principal.userId;
  const [writer] = await tx<{ completedBy: string | null }[]>`
    select completed_by from sineobex.encounter_notes where team_id = ${note.teamId} and id = ${note.id}`;
  const authorship: Authorship | null =
    note.authorUserId === caller
      ? 'wrote'
      : actingAuthor(note) === caller
        ? 'acts_as_author'
        : writer?.completedBy === caller
          ? 'completed'
          : null;
  const signoffId = note.attributes.signoffId as string | null;
  const [signature] = signoffId
    ? await tx<{ signerUserId: string }[]>`
        select signer_user_id from sineobex.note_signoffs where team_id = ${note.teamId} and id = ${signoffId}`
    : [];
  const signerUserId = signature?.signerUserId ?? null;
  const asRead = read === undefined ? await noteAsRead(tx, scope, note) : read;
  const found = { note, read: asRead, authorship, actsAsAuthor: authorship !== null, signerUserId };
  if (!asRead || asRead.type === undefined || medicalHidden(scope.team.permissions, visit.values.kind)) {
    return { ...found, seesAllThatCounts: false };
  }
  const { type, answers, seen } = asRead;
  let seesAllThatCounts: boolean;
  try {
    seesAllThatCounts = byDefinition(() => sameValue(seen, effectiveAnswers(type, answers)));
  } catch (err) {
    if (!(err instanceof DefinitionError)) throw err;
    seesAllThatCounts = false;
  }
  return { ...found, seesAllThatCounts };
}

/** What co-sign asks of one note; `hashMatches` true when only asking whether the caller may act. */
export function cosignOf(scope: TeamScope, n: ActNote, hashMatches: boolean) {
  const can = CAPABILITIES[scope.team.credential];
  return cosignEffect({
    noteStatus: n.note.status as NoteStatus,
    medicalNote: n.note.internal.medical === true,
    actsAsAuthor: n.actsAsAuthor,
    canSign: can.sign,
    needsAttestation: can.billingNeedsAttestation,
    seesAllThatCounts: n.seesAllThatCounts,
    hashMatches,
  });
}

/** What attest asks of one note; `hashMatches` true when only asking whether the caller may act. */
export function attestOf(scope: TeamScope, n: ActNote, hashMatches: boolean) {
  return attestEffect({
    noteStatus: n.note.status as NoteStatus,
    attestation: n.note.internal.attestation as Attestation,
    actsAsAuthor: n.actsAsAuthor,
    isSigner: n.signerUserId === scope.principal.userId,
    canAttest: CAPABILITIES[scope.team.credential].attest,
    seesAllThatCounts: n.seesAllThatCounts,
    hashMatches,
  });
}

/** The caller's role charts and their credential co-signs or attests: who may be a second person at all. */
export const maySecondSign = (scope: TeamScope) => {
  const can = CAPABILITIES[scope.team.credential];
  return scope.can('encounters.chart') && (can.sign || can.attest);
};

/**
 * Why a note that waits for a second person waits for someone other than the reader, so a page
 * words it truly: they wrote it, act as its author (an assignee is never told they wrote it),
 * completed it, made its current signature, or cannot see all of it (6.4 rule 4).
 */
export type HeldBecause = Authorship | 'signed' | 'cannot_see_all';

export interface SecondPersonView {
  canCosign: boolean;
  canAttest: boolean;
  heldBecause?: HeldBecause;
}

/**
 * What the reader may do to a note as a second person, as the acts would answer if the hash they
 * send matched: the queues' canAct, for each act. A note waits for one act at most, so heldBecause is
 * that act's refusal of the reader for this note, when it is about the note and not their credential
 * (which the page shows by offering no action at all). Nothing to a role that does not chart, which
 * the routes refuse.
 */
export function secondPersonView(scope: TeamScope, n: ActNote): SecondPersonView {
  if (!scope.can('encounters.chart')) return { canCosign: false, canAttest: false };
  const cosign = cosignOf(scope, n, true);
  const attest = attestOf(scope, n, true);
  const view: SecondPersonView = { canCosign: !('refuse' in cosign), canAttest: !('refuse' in attest) };
  const refusal = [cosign, attest]
    .map((effect) => ('refuse' in effect ? effect.refuse : null))
    .find((r) => r !== null && r !== 'not_waiting');
  if (refusal === 'is_author') view.heldBecause = n.authorship!;
  else if (refusal === 'is_signer') view.heldBecause = 'signed';
  else if (refusal === 'cannot_see_all') view.heldBecause = 'cannot_see_all';
  return view;
}
