import { randomUUID } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import { effectiveAnswers } from '@sineobex/forms';
import type { AuditFn, TeamScope } from '../auth/context.ts';
import { CAPABILITIES } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { ApiError, conflict, notFound } from '../lib/errors.ts';
import { VisitNote } from '../patients/schemas.ts';
import { Uuid } from '../routes/schemas.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { actingAuthor, noteRules } from '../sync/entities/note.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import {
  appendHistory,
  bookkeeping,
  byDefinition,
  DefinitionError,
  jsonb,
  sameValue,
  type StoredRecord,
} from '../sync/records.ts';
import { noteContentHash } from './content-hash.ts';
import { medicalHidden, noteAsRead, type NoteRead } from './read.ts';
import {
  cosignEffect,
  type AttestRefusal,
  type Attestation,
  type CosignRefusal,
  type NoteStatus,
} from './rules.ts';

/**
 * Co-sign (lifecycle 3.7, 5.3): a second person signs a visit's Medical notes that wait for a
 * co-signer, online, in one action, since the timeline shows one entry per visit (PRD main 97).
 * The rule is cosignEffect's (rules.ts); this module loads what it asks, under the team lock, and
 * writes what it says. What co-sign and attest share (the body, the checks of every note named and
 * of every note left out, the refusals) is here too; attest.ts and queues.ts build on it.
 */

/** A visit holds a few notes (forms 6.2); a list longer than this is not a visit's. */
const MAX_ACT_NOTES = 50;

export const NoteActInput = z
  .object({
    notes: z
      .array(
        z
          .object({
            noteId: Uuid,
            contentHash: z
              .string()
              .regex(/^[0-9a-f]{64}$/)
              .openapi({
                description:
                  'The note’s contentHash from the visit read: what the person read (lifecycle 4.5)',
              }),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ACT_NOTES)
      .refine((notes) => new Set(notes.map((n) => n.noteId)).size === notes.length, {
        message: 'Each note once.',
      }),
    // The wording the person was shown, as a sign-off names it (values.ts StatementVersion).
    statementVersion: z.string().regex(/^[a-z0-9_.-]{1,40}$/),
  })
  .strict()
  .openapi('NoteActInput', {
    description:
      'Every note of the visit that waits for this act and that the caller may act on, each with the hash of what they read',
  });

export const NoteActResult = z
  .object({
    notes: z.array(
      z.object({
        noteId: Uuid,
        status: VisitNote.shape.status,
        attestation: VisitNote.shape.attestation,
      }),
    ),
  })
  .openapi('NoteActResult');

export type NoteActInputValue = z.infer<typeof NoteActInput>;
export type NoteActResultValue = z.infer<typeof NoteActResult>;

/** A note as a second person finds it: what cosignEffect and attestEffect ask of the note. */
export interface ActNote {
  note: StoredRecord;
  /** Null when the caller may not read the note at all, or the server cannot read its definition. */
  read: NoteRead | null;
  actsAsAuthor: boolean;
  /**
   * The caller sees every answer that counts (lifecycle 6.4 rule 4): what visibleAnswers gives them
   * is all of effectiveAnswers, and the summary the hash covers is theirs to read.
   */
  seesAllThatCounts: boolean;
  /** Who made the note's current signature, or null for a note it does not name one. */
  signerUserId: string | null;
}

export async function actNote(
  tx: Tx,
  scope: TeamScope,
  visit: StoredRecord,
  note: StoredRecord,
): Promise<ActNote> {
  const actsAsAuthor = actingAuthor(note) === scope.principal.userId;
  const signoffId = note.attributes.signoffId as string | null;
  const [signature] = signoffId
    ? await tx<{ signerUserId: string }[]>`
        select signer_user_id from sineobex.note_signoffs where team_id = ${note.teamId} and id = ${signoffId}`
    : [];
  const signerUserId = signature?.signerUserId ?? null;
  const read = await noteAsRead(tx, scope, note);
  if (!read || read.type === undefined || medicalHidden(scope.team.permissions, visit.values.kind)) {
    return { note, read, actsAsAuthor, seesAllThatCounts: false, signerUserId };
  }
  const { type, answers, seen } = read;
  let seesAllThatCounts: boolean;
  try {
    seesAllThatCounts = byDefinition(() => sameValue(seen, effectiveAnswers(type, answers)));
  } catch (err) {
    if (!(err instanceof DefinitionError)) throw err;
    seesAllThatCounts = false;
  }
  return { note, read, actsAsAuthor, seesAllThatCounts, signerUserId };
}

/** The hash of the note as the server holds it (4.5), or null when it has no definition to hash by. */
async function heldHash(visit: StoredRecord, n: ActNote): Promise<string | null> {
  if (!n.read || n.read.type === undefined) return null;
  const definition = n.read.type;
  try {
    return await byDefinition(() =>
      noteContentHash({
        noteId: n.note.id,
        encounterId: visit.id,
        patientId: visit.patientId,
        summary: visit.values.summary as string | null,
        definition,
        answers: n.read!.answers,
      }),
    );
  } catch (err) {
    if (err instanceof DefinitionError) return null;
    throw err;
  }
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

export type ActRefusal = CosignRefusal | AttestRefusal;

/** One of co-sign and attest, as secondAct runs it. */
export interface SecondAct<W> {
  /** Every refusal the act's rule gives, in the order it checks them. */
  refusals: readonly ActRefusal[];
  /** What each refusal tells the person. No value, no name. */
  messages: Partial<Record<ActRefusal, string>>;
  /** The visit's notes that wait for this act. */
  waiting: (tx: Tx, visit: StoredRecord) => Promise<string[]>;
  effect: (n: ActNote, hashMatches: boolean) => { refuse: ActRefusal } | W;
  /** Writes the act for every note, with its events and notices, and answers each note's state. */
  apply: (
    tx: Tx,
    audit: AuditFn,
    visit: StoredRecord,
    acts: { n: ActNote; effect: W; contentHash: string }[],
    statementVersion: string,
  ) => Promise<NoteActResultValue>;
}

/** The refusals that are about the caller, not the note's state: 403, logged as access.denied. */
const CALLERS = new Set<ActRefusal>([
  'is_author',
  'is_signer',
  'cannot_sign',
  'cannot_attest',
  'cannot_see_all',
]);

/**
 * Runs a co-sign or an attest of a visit, all or nothing (lifecycle 5.3, 5.4). The team lock is its
 * first statement and each note named is loaded for update after it, as a push does, so a
 * correction cannot change a note between its hash check and its signature.
 *
 * Every note named is checked by the act's rule; a note of another visit, or none, does not wait.
 * The list must hold every waiting note of the visit the caller may act on: one left out is one
 * their screen did not show, so the visit changed since they read it (content_changed). When notes
 * are refused, the refusal first in the rule's order is answered, naming every note it is about, and
 * nothing is written. A refusal about the caller is logged as access.denied with its name.
 */
export async function secondAct<W>(
  scope: TeamScope,
  encounterId: string,
  input: NoteActInputValue,
  route: string,
  act: SecondAct<W>,
): Promise<NoteActResultValue> {
  type Outcome = { answer: NoteActResultValue } | { refusal: ActRefusal; noteIds: string[] };
  const outcome = await scope.tx(async (tx, audit): Promise<Outcome> => {
    await lockTeamWrites(tx, scope.team.teamId);
    const visit = await loadEncounter(tx, encounterId, false);
    if (!visit || visit.teamId !== scope.team.teamId) throw notFound('encounter');

    const refused = new Map<ActRefusal, string[]>();
    const refuse = (reason: ActRefusal, noteId: string) =>
      refused.set(reason, [...(refused.get(reason) ?? []), noteId]);
    const acts: { n: ActNote; effect: W; contentHash: string }[] = [];
    for (const { noteId, contentHash } of input.notes) {
      const note = await noteRules.load(tx, noteId, true);
      if (!note || note.teamId !== visit.teamId || note.attributes.encounterId !== visit.id) {
        refuse('not_waiting', noteId);
        continue;
      }
      const n = await actNote(tx, scope, visit, note);
      const effect = act.effect(n, (await heldHash(visit, n)) === contentHash);
      if (typeof effect === 'object' && effect !== null && 'refuse' in effect) refuse(effect.refuse, noteId);
      else acts.push({ n, effect: effect as W, contentHash });
    }
    const named = new Set(input.notes.map((n) => n.noteId));
    for (const noteId of await act.waiting(tx, visit)) {
      if (named.has(noteId)) continue;
      const note = await noteRules.load(tx, noteId, false);
      if (!note) continue;
      const effect = act.effect(await actNote(tx, scope, visit, note), true);
      if (!(typeof effect === 'object' && effect !== null && 'refuse' in effect))
        refuse('content_changed', noteId);
    }

    const reason = act.refusals.find((r) => refused.has(r));
    if (reason === undefined)
      return { answer: await act.apply(tx, audit, visit, acts, input.statementVersion) };
    const noteIds = refused.get(reason)!;
    if (!CALLERS.has(reason))
      throw conflict(reason, act.messages[reason] ?? 'Load the visit again.', { noteIds });
    // Logged in this transaction, which writes nothing else.
    await audit({
      action: 'access.denied',
      entity: 'encounter',
      entityId: visit.id,
      patientId: visit.patientId,
      details: { reason, route, noteIds },
    });
    return { refusal: reason, noteIds };
  });
  if ('answer' in outcome) return outcome.answer;
  throw new ApiError(
    403,
    outcome.refusal,
    act.messages[outcome.refusal] ?? 'Your role does not allow this.',
    {
      noteIds: outcome.noteIds,
    },
  );
}

/** A notice with no text about the visit (lifecycle 4.10): one per person per visit. */
export async function noticeOfVisit(
  tx: Tx,
  teamId: string,
  userId: string,
  kind: string,
  encounterId: string,
) {
  await tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
    values (${teamId}, ${userId}, ${kind}, 'encounter', ${encounterId})`;
}

const COSIGN_REFUSALS: readonly CosignRefusal[] = [
  'not_waiting',
  'is_author',
  'cannot_sign',
  'cannot_see_all',
  'content_changed',
];

/**
 * POST /v1/encounters/{encounterId}/cosign. For each note: a `cosign` sign-off made now under the
 * caller's credential now (an online act has no other time to be recorded under, 3.5), and the note
 * signed by it. Its answers, its author, and who completed it and when stay as they were: the sync
 * finds the signature that finished a note by them (4.6). The first signature's time is kept when
 * the note was signed before a correction sent it back. One note.cosigned per note; one notice to
 * each note's acting author, once for the visit.
 */
export function cosignVisit(scope: TeamScope, encounterId: string, input: NoteActInputValue, route: string) {
  return secondAct<Cosigned>(scope, encounterId, input, route, {
    refusals: COSIGN_REFUSALS,
    messages: {
      not_waiting: 'A note isn’t waiting for a co-signature any more. Load the visit again.',
      content_changed: 'The visit changed since you read it. Read it again before you co-sign.',
      is_author: 'You can’t co-sign a note you wrote.',
      cannot_sign: 'Your credential can’t sign notes.',
      cannot_see_all:
        'Your role can’t see every part of this note, so you can’t co-sign it. Someone who can see all of it must.',
    },
    waiting: async (tx, visit) =>
      (
        await tx<{ id: string }[]>`
          select id from sineobex.encounter_notes
          where team_id = ${visit.teamId} and encounter_id = ${visit.id} and status = 'completed' and medical
          order by created_at, id`
      ).map((r) => r.id),
    effect: (n, hashMatches) => cosignOf(scope, n, hashMatches),
    apply: (tx, audit, visit, acts, statementVersion) =>
      writeCosign(tx, scope, audit, visit, acts, statementVersion),
  });
}

type Cosigned = { statusAfter: 'signed'; attestationAfter: Attestation };

async function writeCosign(
  tx: Tx,
  scope: TeamScope,
  audit: AuditFn,
  visit: StoredRecord,
  acts: { n: ActNote; effect: Cosigned; contentHash: string }[],
  statementVersion: string,
): Promise<NoteActResultValue> {
  const signer = scope.principal.userId;
  const credential = scope.team.credential;
  const needsAttestation = CAPABILITIES[credential].billingNeedsAttestation;
  const { npi, ...fields } = scope.team.credentialFields;
  const signedAt = scope.deps.now();
  const authors = new Set<string>();
  const notes: NoteActResultValue['notes'] = [];
  for (const { n, effect, contentHash } of acts) {
    const { note } = n;
    const signoffId = randomUUID();
    await tx`
      insert into sineobex.note_signoffs
        (id, team_id, note_id, act, effect, content_hash, signer_user_id, signer_name, signer_credential, signer_npi,
         signer_fields, claimed_credential, needs_attestation, statement_version, signed_at, signed_device_time,
         clock_verified, change_id, created_device_id, approved_by)
      values (${signoffId}, ${note.teamId}, ${note.id}, 'cosign', 'signed', ${contentHash}, ${signer},
              ${scope.principal.displayName}, ${credential}, ${npi ?? null}, ${jsonb(tx, fields)}, null,
              ${needsAttestation}, ${statementVersion}, ${signedAt}, null, true, null, ${scope.meta.deviceId},
              null)`;
    const version = (note.fieldVersions.status ?? 0) + 1;
    await tx`
      update sineobex.encounter_notes set
        status = 'signed',
        signoff_id = ${signoffId},
        attestation = ${effect.attestationAfter},
        first_signed_at = coalesce(first_signed_at, ${signedAt}),
        ${bookkeeping(tx, 'status', version, { by: signer, at: signedAt.toISOString(), changeId: null })}
      where id = ${note.id}`;
    await appendHistory(tx, {
      teamId: note.teamId,
      entity: 'encounter_note',
      recordId: note.id,
      field: 'status',
      version,
      value: 'signed',
      previousValue: note.status,
      kind: 'set',
      changedBy: signer,
      approvedBy: null,
      changeId: null,
      deviceId: scope.meta.deviceId,
      deviceTime: null,
    });
    await audit({
      action: 'note.cosigned',
      entity: 'encounter_note',
      entityId: note.id,
      patientId: visit.patientId,
      details: { signoffId, credential, needsAttestation },
    });
    authors.add(actingAuthor(note));
    notes.push({ noteId: note.id, status: effect.statusAfter, attestation: effect.attestationAfter });
  }
  // "Your note was co-signed": once for the visit, however many of its notes were.
  for (const userId of authors) await noticeOfVisit(tx, visit.teamId, userId, 'note_cosigned', visit.id);
  return { notes };
}
