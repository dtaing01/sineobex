import type { z } from '@hono/zod-openapi';
import { effectiveAnswers, finishCheck, type ResolvedNoteType } from '@sineobex/forms';
import type { Tx } from '../../db/database.ts';
import { noteContentHash } from '../../encounters/content-hash.ts';
import { noteIsEmpty, signoffEffect, type NoteStatus } from '../../encounters/rules.ts';
import { signedUnder } from '../../encounters/signed-under.ts';
import { credentialChangesAfter, loadSigner } from '../../encounters/signer.ts';
import {
  createReceivedAt,
  appendHistory,
  byDefinition,
  DefinitionError,
  definitionOf,
  historyOf,
  invalid,
  jsonb,
  when,
  type ChangeContext,
  type EntityRules,
  type FieldMeta,
  type Outcome,
  type StoredRecord,
} from '../records.ts';
import { loadEncounter } from './encounter.ts';
import { actingAuthor, answersOf, medicalGate, noteRules, noteTypeOf, unreadableBySender } from './note.ts';
import { NoteSignoffCreate, valueParents } from './values.ts';

/**
 * Sign-offs (phase 4 design, lifecycle 4.6): one row each time someone completes or signs a note,
 * made on the phone, append-only. It carries the hash of the note as the person saw it (4.5).
 *
 * The rule is signoffEffect's (3.4, encounters/rules.ts): this module loads its inputs, under the
 * team lock and in the change's transaction, and writes what it says. A refusal is the worker's to
 * fix (the note changed, it is missing something, the Red flags note goes first), so it is a stored
 * rejection and nothing else is written; the phone sends the same record again with the new hash.
 * A sign-off the note takes no more (it is finished, the sender does not act as its author, or the
 * draft is empty, which does not count) is stored with effect `none`. Otherwise the sign-off row is written first, then the note in one
 * statement, both from the one loaded note: the note's `signoff_id` names this row only when the
 * effect is `signed`, which the database's key cannot see (0019). A finished note holds only the
 * answers that count, which is what was hashed; each one dropped is in its history.
 *
 * The credential the act is recorded under is signedUnder's (3.5), from the signer's membership
 * as it is now, removed or not, and its later credential changes: a signature made offline keeps
 * the credential it was made under. The Medical gate (4.2) holds a sign-off of a Medical note from
 * someone who may not chart one; an admin's accept applies it as above.
 */

type Value = z.infer<typeof NoteSignoffCreate>;

interface SignoffRow {
  id: string;
  teamId: string;
  noteId: string;
  act: string;
  effect: string;
  contentHash: string;
  signerUserId: string;
  signerName: string;
  signerCredential: string;
  claimedCredential: string | null;
  needsAttestation: boolean;
  statementVersion: string;
  signedAt: Date;
  clockVerified: boolean;
  receivedAt: Date;
  patientId: string | null;
}

export const noteSignoffRules: EntityRules<Value> = {
  entity: 'note_signoff',
  auditPrefix: 'note_signoff',
  permission: () => 'encounters.chart',
  // It writes the note and, through the trigger of 0018, the visit (4.2).
  takesTeamLock: () => true,
  create: NoteSignoffCreate,
  parents: (v) => valueParents('note_signoff', 'create', undefined, v),
  parentsOfSet: () => [],
  applyCreate: applySignoff,
  fieldClass: () => null,
  fieldSchema: () => null,

  async load(tx, id) {
    const rows = await tx<SignoffRow[]>`
      select s.id, s.team_id, s.note_id, s.act, s.effect, s.content_hash, s.signer_user_id, s.signer_name,
             s.signer_credential, s.claimed_credential, s.needs_attestation, s.statement_version, s.signed_at, s.clock_verified,
             s.received_at, e.patient_id
      from sineobex.note_signoffs s
      join sineobex.encounter_notes n on n.team_id = s.team_id and n.id = s.note_id
      join sineobex.encounters e on e.id = n.encounter_id
      where s.id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'note_signoff',
      id: r.id,
      teamId: r.teamId,
      status: r.effect,
      authorUserId: r.signerUserId,
      version: 1,
      patientId: r.patientId,
      fieldVersions: {},
      fieldMeta: {},
      values: {},
      // The NPI and the credential's other fields stay with the billing export, not the phone.
      attributes: {
        noteId: r.noteId,
        act: r.act,
        effect: r.effect,
        contentHash: r.contentHash,
        // The name and credential as they were then, as an addendum's author is kept (0019).
        signerName: r.signerName,
        signerCredential: r.signerCredential,
        claimedCredential: r.claimedCredential,
        needsAttestation: r.needsAttestation,
        statementVersion: r.statementVersion,
        signedAt: r.signedAt.toISOString(),
        clockVerified: r.clockVerified,
      },
      internal: {},
      createdAt: r.receivedAt,
      updatedAt: r.receivedAt,
    };
  },

  write: () => Promise.reject(new Error('a sign-off is never changed')),
};

/** Lifecycle 4.6, steps 1 to 8. The note exists: apply.ts checked it as the create's parent. */
async function applySignoff(ctx: ChangeContext, v: Value): Promise<Outcome> {
  const { tx, actor, change: c } = ctx;
  const note = (await noteRules.load(tx, v.noteId, true))!;
  const medicalNote = note.internal.medical === true;
  // A sender who does not act as the author changes nothing (effect none) whatever their credential,
  // as a reopen and a correction from them do: not_author answers before the gate (4.1; RD-8).
  const gated =
    (await unreadableBySender(ctx, note)) ??
    (actor.authorId === actingAuthor(note) ? await medicalGate(ctx, medicalNote) : null);
  if (gated) return gated;

  const visit = (await loadEncounter(tx, note.attributes.encounterId as string, false))!;
  // A phase 2 note has no type to hash it by, and the phone can make no sign-off of one.
  const definition = await noteTypeOf(tx, note);
  if (!definition) throw new DefinitionError();
  const answers = answersOf(note);
  const holds = await byDefinition(() =>
    noteContentHash({
      noteId: note.id,
      encounterId: visit.id,
      patientId: visit.patientId,
      summary: visit.values.summary as string | null,
      definition,
      answers,
    }),
  );
  const hashMatches = holds === v.contentHash;
  const finishOk = byDefinition(() => finishCheck(definition, answers)).length === 0;
  // Asked of a Medical note only: signoffEffect reads it of no other.
  const redFlagsDone =
    !medicalNote || isRedFlags(definition) || (await finishedRedFlags(tx, note.teamId, visit.id, note.id));

  const signer = await loadSigner(tx, actor.teamId, actor.authorId);
  // A push and an admin's accept both come from a member of the team, removed or not.
  if (!signer) throw new Error('a sign-off from someone who was never a member of the team');
  const signedAt = when(c);
  const receivedAt = await receivedAtOf(tx, c.changeId);
  const under = signedUnder({
    current: { credential: signer.credential, fields: signer.fields },
    laterChanges: await credentialChangesAfter(tx, actor.teamId, actor.authorId, signedAt),
    signedAt: signedAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    clockVerified: c.clockVerified,
    notBefore: (await createReceivedAt(tx, 'encounter_note', note)).toISOString(),
    claimed: v.claimedCredential,
  });

  const effect = signoffEffect({
    noteStatus: note.status as NoteStatus,
    medicalNote,
    act: v.act,
    actsAsAuthor: actor.authorId === actingAuthor(note),
    canSign: under.canSign,
    needsAttestation: under.needsAttestation,
    hashMatches,
    // The empty test the visit's status uses (0018 note_is_empty): an empty draft does not count.
    emptyDraft: noteIsEmpty(answers),
    finishOk,
    redFlagsDone,
  });
  if ('refuse' in effect) return invalid(effect.refuse);

  const inserted = await tx`
    insert into sineobex.note_signoffs
      (id, team_id, note_id, act, effect, content_hash, signer_user_id, signer_name, signer_credential, signer_npi,
       signer_fields, claimed_credential, needs_attestation, statement_version, signed_at, signed_device_time,
       clock_verified, received_at, change_id, created_device_id, approved_by)
    values (${c.recordId}, ${actor.teamId}, ${note.id}, ${v.act}, ${effect.effect}, ${v.contentHash},
            ${actor.authorId}, ${signer.displayName}, ${under.credential}, ${under.npi}, ${jsonb(tx, under.fields)},
            ${v.claimedCredential}, ${under.needsAttestation}, ${v.statementVersion}, ${signedAt},
            ${new Date(c.deviceTime)}, ${c.clockVerified}, ${receivedAt}, ${c.changeId}, ${actor.deviceId},
            ${actor.approvedBy})
    on conflict (id) do nothing
    returning id`;
  if (inserted.length === 0) return invalid('record_exists');

  const audit = {
    entity: 'encounter_note',
    entityId: note.id,
    patientId: visit.patientId,
    deviceTime: new Date(c.deviceTime),
  };
  const base = { ...actor.auditDetails, changeId: c.changeId, signoffId: c.recordId };

  if (effect.effect === 'none') {
    // "Only the note's author can do that. Nothing was changed." A finished note's own receipt
    // says whether what was signed is what this person saw. Only to whoever acts as the author,
    // the one who completes from two phones (3.4): to anyone else it would check any guess of
    // what the note holds, a hidden answer included (review findings RD-2, NOT-6).
    const toAuthor = actor.authorId === actingAuthor(note);
    // Against the signature that finished it, not the note as it is now: giving the visit a
    // patient later moves the note's hash, and the second phone saw just what was signed (NOT-7).
    const seen =
      effect.reason === 'already_finished'
        ? ((await finishingHash(tx, note)) ?? holds) === v.contentHash
        : hashMatches;
    if (effect.reason === 'not_author') await notify(ctx, 'change_not_applied', note.id);
    await ctx.audit({
      ...audit,
      action: 'note.signoff_repeated',
      details: { ...base, reason: effect.reason, hashMatches: seen },
    });
    return {
      status: 'accepted',
      serverVersion: 1,
      details: {
        effect: 'none',
        reason: effect.reason,
        status: note.status,
        attestation: note.internal.attestation,
        ...(toAuthor ? { hashMatches: seen } : {}),
      },
    };
  }

  await finishNote(ctx, note, definition, answers, effect, signedAt);
  const signs = effect.effect !== 'completed';
  await ctx.audit({
    ...audit,
    action: `note.${effect.effect}`,
    details: {
      ...base,
      act: v.act,
      effect: effect.effect,
      clockVerified: c.clockVerified,
      ...(signs
        ? {
            credential: under.credential,
            ...(under.claimDiffers ? { claimedCredential: v.claimedCredential } : {}),
            needsAttestation: under.needsAttestation,
          }
        : {}),
    },
  });
  // "Your credential can't sign this note type. It was saved unsigned for a co-signer."
  if (effect.effect === 'saved_unsigned') await notify(ctx, 'note_saved_unsigned', note.id);
  return {
    status: 'accepted',
    serverVersion: 1,
    details: {
      effect: effect.effect,
      status: effect.statusAfter,
      attestation: effect.attestationAfter,
      hashMatches,
    },
  };
}

/**
 * Finishes the note as the effect says, in one statement after the sign-off row it may name (0019):
 * its answers become those that count, which is what was hashed, so a later correction of a
 * controlling field can never bring a hidden answer back; its status, who finished it and when;
 * and, when signed, the first signature and the sign-off that signs it. The status and each answer
 * dropped get their next version and a history row, so nothing is lost. The trigger of 0018 then
 * works out the visit's status.
 */
async function finishNote(
  ctx: ChangeContext,
  note: StoredRecord,
  definition: ResolvedNoteType,
  answers: Record<string, unknown>,
  effect: {
    effect: 'completed' | 'signed' | 'saved_unsigned';
    statusAfter: NoteStatus;
    attestationAfter: string;
  },
  signedAt: Date,
): Promise<void> {
  const { tx, actor, change: c } = ctx;
  const counting = byDefinition(() => effectiveAnswers(definition, answers));
  const dropped = Object.keys(answers).filter((path) => !Object.hasOwn(counting, path));
  const versions: Record<string, number> = {};
  for (const field of ['status', ...dropped.map((path) => `data.${path}`)])
    versions[field] = (note.fieldVersions[field] ?? 0) + 1;
  const meta: FieldMeta = { by: actor.authorId, at: signedAt.toISOString(), changeId: c.changeId };
  const metas = Object.fromEntries(Object.keys(versions).map((field) => [field, meta]));
  const signed = effect.effect === 'signed';
  await tx`
    update sineobex.encounter_notes set
      data = ${jsonb(tx, counting)},
      status = ${effect.statusAfter},
      completed_at = ${signedAt},
      completed_by = ${actor.authorId},
      first_signed_at = ${signed ? signedAt : null},
      signoff_id = ${signed ? c.recordId : null},
      attestation = ${effect.attestationAfter},
      field_versions = field_versions || ${jsonb(tx, versions)},
      field_meta = field_meta || ${jsonb(tx, metas)},
      version = version + 1
    where id = ${note.id}`;
  const history = (field: string, value: unknown, previous: unknown) =>
    appendHistory(
      tx,
      historyOf(ctx, 'encounter_note', note.id, field, versions[field]!, value, previous, 'set'),
    );
  await history('status', effect.statusAfter, note.status);
  for (const path of dropped) await history(`data.${path}`, null, answers[path]);
}

/** The Red flags and disposition note, added by itself to a Medical visit (forms 6.2). */
const isRedFlags = (definition: ResolvedNoteType) => definition.auto === 'medical';

/**
 * The visit holds a finished Red flags note other than [noteId] (lifecycle 3.3, hard stop 5). The
 * team lock keeps a sibling from being finished while this reads.
 */
async function finishedRedFlags(
  tx: Tx,
  teamId: string,
  encounterId: string,
  noteId: string,
): Promise<boolean> {
  const types = await tx<{ key: string; version: number }[]>`
    select distinct note_type_key as key, note_type_version as version from sineobex.encounter_notes
    where team_id = ${teamId} and encounter_id = ${encounterId} and id <> ${noteId} and status <> 'draft'
      and note_type_version is not null`;
  for (const t of types) {
    const definition = await definitionOf(tx, teamId, t.key, t.version);
    if (definition && isRedFlags(definition)) return true;
  }
  return false;
}

/**
 * The hash of the sign-off that finished [note]: the row by whoever completed it, at the time it
 * was completed (a correction moves neither), with an effect. The latest received wins a tie.
 */
async function finishingHash(tx: Tx, note: StoredRecord): Promise<string | null> {
  const [row] = await tx<{ hash: string }[]>`
    select s.content_hash as hash
    from sineobex.note_signoffs s
    join sineobex.encounter_notes n on n.team_id = s.team_id and n.id = s.note_id
    where s.team_id = ${note.teamId} and s.note_id = ${note.id} and s.effect <> 'none'
      and s.signer_user_id = n.completed_by and s.signed_at = n.completed_at
    order by s.received_at desc
    limit 1`;
  return row?.hash ?? null;
}

/**
 * When the server first received the change: when its push held it for review, if it was held (an
 * admin's accept applies it later), else now. signedUnder believes a signature time no more than
 * five minutes after this.
 */
async function receivedAtOf(tx: Tx, changeId: string): Promise<Date> {
  const [row] = await tx<{ at: Date }[]>`
    select coalesce((select received_at from sineobex.quarantine_items where change_id = ${changeId}), now()) as at`;
  return row!.at;
}

/** A notice with no text, about the note, to the person whose sign-off this is. */
async function notify(ctx: ChangeContext, kind: string, noteId: string): Promise<void> {
  await ctx.tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
    values (${ctx.actor.teamId}, ${ctx.actor.authorId}, ${kind}, 'encounter_note', ${noteId})`;
}
