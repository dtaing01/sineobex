import type { z } from '@hono/zod-openapi';
import { checkAnswer, finishCheck } from '@sineobex/forms';
import { correctionEffect, type Attestation } from '../../encounters/rules.ts';
import { signedUnder, type SignedUnder } from '../../encounters/signed-under.ts';
import { credentialChangesAfter, loadSigner } from '../../encounters/signer.ts';
import {
  signoffOfOther,
  createReceivedAt,
  appendHistory,
  byDefinition,
  DefinitionError,
  fieldState,
  historyOf,
  invalid,
  isBlank,
  jsonb,
  MAX_NOTE_FIELDS,
  notify,
  receivedAtOf,
  sameValue,
  when,
  type ChangeContext,
  type EntityRules,
  type FieldMeta,
  type HistoryKind,
  type Outcome,
  type StoredRecord,
} from '../records.ts';
import {
  actingAuthor,
  answersOf,
  medicalGate,
  needsGate,
  noteRules,
  noteTypeOf,
  unreadableBySender,
} from './note.ts';
import { NoteCorrectionCreate, valueParents } from './values.ts';

/**
 * Corrections (phase 4 design, lifecycle 3.6, 4.7): "the author picks the wrong field, enters the
 * right value and gives a reason. The note shows the new value, and the old one stays visible struck
 * through with who changed it and when" (PRD main 460). One correction changes one to ten answers
 * together, since one answer can open another. A patient's amendment request is the same record
 * (PRD main 463): accepting it is a correction, declining it is stored and changes nothing.
 *
 * Each step of 4.7 decides in turn, under the team lock and from the one loaded note: whoever does
 * not act as the note's author is told and nothing changes; the Medical gate (4.2) holds the rest of
 * a Medical note's corrections from someone who may not chart one; a declined request is stored
 * as it is; every new value must be one the note type takes; a note reopened since is edited as a
 * draft is; then each answer must still be at the version the person saw, or blank and never seen
 * by them (D109), else `field_changed`; a correction that changes nothing is stored as such, and one
 * that would leave the note failing its finish check is refused (`incomplete`). A refusal is the
 * worker's to fix and stores nothing; the phone sends the same record again.
 *
 * Otherwise the answers are written with history kind `corrected`, through the guard of 0018, which
 * lets a finished note's answers change only while `app.note_correction` names it; then the row,
 * naming those history rows. The corrector's credential is signedUnder's (3.5), as a signature's is,
 * and correctionEffect (3.12) says what is left of the note's signature: a note is signed only while
 * someone who may sign covers what it says now. A co-signer or attester whose work a correction
 * undoes is told.
 *
 * PLAN-OPEN: does a correction record the wording its corrector was shown (lifecycle 12.1 #24; plan
 * section 6)? No: it carries no statement version, and the row's corrector, credential, time and
 * reason stand as their signature on the change.
 */

type Value = z.infer<typeof NoteCorrectionCreate>;
type CorrectionOutcome = 'corrected' | 'declined' | 'no_change' | 'draft_edit' | 'not_author';

interface CorrectionRow {
  id: string;
  teamId: string;
  noteId: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  outcome: string;
  reason: string;
  requestedByPatient: boolean;
  correctorUserId: string;
  correctorName: string;
  correctorCredential: string;
  claimedCredential: string | null;
  correctedAt: Date;
  clockVerified: boolean;
  createdAt: Date;
  patientId: string | null;
}

export const noteCorrectionRules: EntityRules<Value> = {
  entity: 'note_correction',
  auditPrefix: 'note_correction',
  permission: () => 'encounters.chart',
  // It writes the note and, through the trigger of 0018, the visit (4.2).
  takesTeamLock: () => true,
  create: NoteCorrectionCreate,
  parents: (v) => valueParents('note_correction', 'create', undefined, v),
  parentsOfSet: () => [],
  applyCreate: applyCorrection,
  fieldClass: () => null,
  fieldSchema: () => null,

  async load(tx, id) {
    const rows = await tx<CorrectionRow[]>`
      select c.id, c.team_id, c.note_id, c.changes, c.outcome, c.reason, c.requested_by_patient, c.corrector_user_id,
             c.corrector_name, c.corrector_credential, c.claimed_credential, c.corrected_at, c.clock_verified, c.created_at, e.patient_id
      from sineobex.note_corrections c
      join sineobex.encounter_notes n on n.team_id = c.team_id and n.id = c.note_id
      join sineobex.encounters e on e.id = n.encounter_id
      where c.id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'note_correction',
      id: r.id,
      teamId: r.teamId,
      status: r.outcome,
      authorUserId: r.correctorUserId,
      version: 1,
      patientId: r.patientId,
      fieldVersions: {},
      fieldMeta: {},
      values: {},
      attributes: {
        noteId: r.noteId,
        changes: r.changes.map(({ field, oldValue, newValue }) => ({ field, oldValue, newValue })),
        outcome: r.outcome,
        reason: r.reason,
        requestedByPatient: r.requestedByPatient,
        // The name and credential as they were then, as an addendum's author is kept (0019).
        correctorName: r.correctorName,
        correctorCredential: r.correctorCredential,
        claimedCredential: r.claimedCredential,
        correctedAt: r.correctedAt.toISOString(),
        clockVerified: r.clockVerified,
      },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    };
  },

  write: () => Promise.reject(new Error('a correction is never changed')),
};

/** One answer the correction names, beside what the note holds there now. */
interface Asked {
  field: string;
  path: string;
  newValue: unknown;
  baseVersion: number;
  cur: { value: unknown; version: number };
}

/** An answer to write, with the history kind it is written under. */
interface Write {
  field: string;
  value: unknown;
  previous: unknown;
  kind: HistoryKind;
}

/** Lifecycle 4.7, steps 1 to 9. The note exists: apply.ts checked it as the create's parent. */
async function applyCorrection(ctx: ChangeContext, v: Value): Promise<Outcome> {
  const { tx, actor, change: c } = ctx;
  // An applied correction writes the note before its row, which names the history rows it wrote, so
  // a record ID already taken is found first.
  const taken = await tx`select 1 from sineobex.note_corrections where id = ${c.recordId}`;
  if (taken.length > 0) return invalid('record_exists');
  const other = await signoffOfOther(tx, v.signoffId, v.noteId, null);
  if (other) return other;

  const note = (await noteRules.load(tx, v.noteId, true))!;
  const unread = await unreadableBySender(ctx, note);
  if (unread) return unread;
  const under = await correctorOf(ctx, v, note);
  const asked: Asked[] = v.changes.map((ch) => ({
    field: ch.field,
    path: ch.field.slice('data.'.length),
    newValue: ch.newValue,
    baseVersion: ch.baseVersion,
    cur: fieldState(note, ch.field),
  }));
  const unchanged = { status: note.status, attestation: note.internal.attestation as Attestation };
  const store = (outcome: CorrectionOutcome, after = unchanged, ids: Record<string, string> = {}) =>
    storeCorrection(ctx, v, note, under, asked, outcome, after, ids);

  // 1. "The original signer corrects their own note" (PRD main 461): whoever acts as its author (3.8).
  if (actor.authorId !== actingAuthor(note)) {
    // "Only the note's author can do that. Nothing was changed."
    await notify(ctx, actor.authorId, 'change_not_applied', 'encounter_note', note.id);
    return store('not_author');
  }
  // The Medical gate (4.2) comes before any outcome that is not the sender's own: a draft edit
  // changes a Medical note as any set of it does, and the gate holds every such change.
  const gated = await medicalGate(ctx, note.internal.medical === true);
  if (gated) return gated;
  // A phase 2 note has no type to check a correction by; as a draft it keeps the open path rule.
  const definition = await noteTypeOf(tx, note);
  // So does a section that needs a capability (needsGate), for the author too.
  const needed = await needsGate(
    ctx,
    definition,
    asked.map((a) => a.path),
  );
  if (needed) return needed;
  // A declined request changes nothing, whatever state the note is in.
  if (v.declined) return store('declined');

  const draft = note.status === 'draft';
  if (!definition && !draft) throw new DefinitionError();
  if (definition) {
    for (const a of asked) {
      const problem = byDefinition(() => checkAnswer(definition, a.path, a.newValue));
      if (problem) return invalid(problem, { field: a.field });
    }
  }
  // The bound is the draft rule's (records.ts MAX_NOTE_FIELDS): on what reaches the chart.
  const held = Object.keys(note.fieldVersions).filter((f) => f.startsWith('data.')).length;
  const added = asked.filter((a) => !Object.hasOwn(note.fieldVersions, a.field)).length;
  if (added > 0 && held + added > MAX_NOTE_FIELDS) return invalid('too_many_fields');

  // 2. A note reopened since is edited as a draft, by the draft rule: a value the person saw, or a
  // blank, is written; a value they did not see is never overwritten silently.
  if (draft) {
    const writes: Write[] = [];
    for (const a of asked) {
      if (sameValue(a.cur.value, a.newValue)) continue;
      const kind = a.cur.version === a.baseVersion ? 'set' : isBlank(a.cur.value) ? 'filled_blank' : null;
      if (!kind) return invalid('field_changed', { field: a.field });
      writes.push({ field: a.field, value: a.newValue, previous: a.cur.value, kind });
    }
    return store('draft_edit', unchanged, await writeAnswers(ctx, note, writes, null));
  }

  // 6. Each answer is as the person saw it: another correction may have got there first. An answer
  // blank now that they held no version of is written, as a draft edit fills a blank (D109): one
  // Complete dropped is blank at a version the note's read never sends (D107). Someone who held an
  // older version of it is still told it changed.
  const moved = asked.find(
    (a) => a.cur.version !== a.baseVersion && !(a.baseVersion === 0 && isBlank(a.cur.value)),
  );
  if (moved) return invalid('field_changed', { field: moved.field });
  // 7. Nothing to change; "Leave it" after a field_changed sends the value the note holds.
  const writes: Write[] = asked
    .filter((a) => !sameValue(a.cur.value, a.newValue))
    .map((a) => ({ field: a.field, value: a.newValue, previous: a.cur.value, kind: 'corrected' }));
  if (writes.length === 0) return store('no_change');
  // 8. "A correction can never leave a signed note without, say, the consent a sensitive exam needs."
  const answers = { ...answersOf(note), ...Object.fromEntries(asked.map((a) => [a.path, a.newValue])) };
  if (byDefinition(() => finishCheck(definition!, answers)).length > 0) return invalid('incomplete');

  // 9. The table of 3.6.
  const effect = correctionEffect({
    noteStatus: note.status as 'completed' | 'signed',
    attestation: unchanged.attestation,
    correctorCanSign: under.canSign,
    correctorNeedsAttestation: under.needsAttestation,
  });
  const told = await reviewersUndone(ctx, note, effect);
  const ids = await writeAnswers(ctx, note, writes, effect);
  const outcome = await store(
    'corrected',
    { status: effect.statusAfter, attestation: effect.attestationAfter },
    ids,
  );
  // "A note you signed was corrected. It needs your review again."
  for (const userId of told) await notify(ctx, userId, 'note_corrected', 'encounter_note', note.id);
  return outcome;
}

/**
 * The credential the correction is recorded under (3.5): signedUnder's, from the corrector's
 * membership as it is now, removed or not, and its later changes, at the correction's time, as a
 * signature made offline is checked days later.
 */
async function correctorOf(
  ctx: ChangeContext,
  v: Value,
  note: StoredRecord,
): Promise<SignedUnder & { name: string }> {
  const { tx, actor, change: c } = ctx;
  const corrector = await loadSigner(tx, actor.teamId, actor.authorId);
  // A push and an admin's accept both come from a member of the team, removed or not.
  if (!corrector) throw new Error('a correction from someone who was never a member of the team');
  const at = when(c);
  const under = signedUnder({
    current: { credential: corrector.credential, fields: corrector.fields },
    laterChanges: await credentialChangesAfter(tx, actor.teamId, actor.authorId, at),
    signedAt: at.toISOString(),
    receivedAt: (await receivedAtOf(tx, c.changeId)).toISOString(),
    clockVerified: c.clockVerified,
    notBefore: (await createReceivedAt(tx, 'encounter_note', note)).toISOString(),
    claimed: v.claimedCredential,
  });
  return { ...under, name: corrector.displayName };
}

/**
 * The co-signer and the attesters whose work this correction undoes, to be told (lifecycle 4.10): the
 * co-signer of the signature it clears, and whoever attested the note when it is no longer attested.
 * Read before the note is written, while it still names its signature. Never the corrector.
 */
async function reviewersUndone(
  ctx: ChangeContext,
  note: StoredRecord,
  effect: { attestationAfter: Attestation; clearSignoff: boolean },
): Promise<string[]> {
  const { tx, actor } = ctx;
  const told = new Set<string>();
  if (effect.clearSignoff) {
    const cosigners = await tx<{ userId: string }[]>`
      select s.signer_user_id as "userId" from sineobex.encounter_notes n
      join sineobex.note_signoffs s on s.team_id = n.team_id and s.id = n.signoff_id
      where n.id = ${note.id} and s.act = 'cosign'`;
    for (const r of cosigners) told.add(r.userId);
  }
  if (note.internal.attestation === 'attested' && effect.attestationAfter !== 'attested') {
    const attesters = await tx<{ userId: string }[]>`
      select distinct a.attending_user_id as "userId" from sineobex.encounter_notes n
      join sineobex.note_attestations a on a.team_id = n.team_id and a.note_id = n.id and a.signoff_id = n.signoff_id
      where n.id = ${note.id}`;
    for (const r of attesters) told.add(r.userId);
  }
  told.delete(actor.authorId);
  return [...told];
}

/**
 * Writes the answers in one statement, with what correctionEffect says of the status, the signature
 * and the attestation when the note is finished; then a history row for each answer, and for the
 * status when it moves. Returns each answer's history row ID. A finished note's answers change only
 * through a correction (0018's guard), so `app.note_correction` names the loaded row for this one
 * statement and no other: a push applies many changes in one transaction.
 */
async function writeAnswers(
  ctx: ChangeContext,
  note: StoredRecord,
  writes: Write[],
  effect: {
    statusAfter: 'completed' | 'signed';
    attestationAfter: Attestation;
    clearSignoff: boolean;
  } | null,
): Promise<Record<string, string>> {
  if (writes.length === 0) return {};
  const { tx, actor, change: c } = ctx;
  const moves = effect !== null && effect.statusAfter !== note.status;
  const versions: Record<string, number> = {};
  for (const field of [...writes.map((w) => w.field), ...(moves ? ['status'] : [])])
    versions[field] = (note.fieldVersions[field] ?? 0) + 1;
  const meta: FieldMeta = { by: actor.authorId, at: when(c).toISOString(), changeId: c.changeId };
  const metas = Object.fromEntries(Object.keys(versions).map((field) => [field, meta]));
  const answers = Object.fromEntries(writes.map((w) => [w.field.slice('data.'.length), w.value]));
  const finished = effect
    ? tx`status = ${effect.statusAfter}, attestation = ${effect.attestationAfter},
         signoff_id = ${effect.clearSignoff ? null : tx`signoff_id`},`
    : tx``;
  if (effect) await tx`select set_config('app.note_correction', ${note.id}, true)`;
  await tx`
    update sineobex.encounter_notes set
      data = data || ${jsonb(tx, answers)},
      ${finished}
      field_versions = field_versions || ${jsonb(tx, versions)},
      field_meta = field_meta || ${jsonb(tx, metas)},
      version = version + 1
    where id = ${note.id}`;
  if (effect) await tx`select set_config('app.note_correction', '', true)`;

  const ids: Record<string, string> = {};
  for (const w of writes) {
    ids[w.field] = await appendHistory(
      tx,
      historyOf(ctx, 'encounter_note', note.id, w.field, versions[w.field]!, w.value, w.previous, w.kind),
    );
  }
  if (moves) {
    await appendHistory(
      tx,
      historyOf(
        ctx,
        'encounter_note',
        note.id,
        'status',
        versions.status!,
        effect.statusAfter,
        note.status,
        'set',
      ),
    );
  }
  return ids;
}

/**
 * The correction's row, its audit event and its receipt. The row keeps every answer it names with
 * the value the note held and the one asked for, and the history row written for it, or null. The
 * audit event names the fields and the outcome, never a value or the reason (10.1).
 */
async function storeCorrection(
  ctx: ChangeContext,
  v: Value,
  note: StoredRecord,
  under: SignedUnder & { name: string },
  asked: Asked[],
  outcome: CorrectionOutcome,
  after: { status: string; attestation: Attestation },
  ids: Record<string, string>,
): Promise<Outcome> {
  const { tx, actor, change: c } = ctx;
  const changes = asked.map((a) => ({
    field: a.field,
    oldValue: a.cur.value,
    newValue: a.newValue,
    historyId: ids[a.field] ?? null,
  }));
  await tx`
    insert into sineobex.note_corrections
      (id, team_id, note_id, changes, outcome, reason, requested_by_patient, corrector_user_id, corrector_name,
       corrector_credential, claimed_credential, corrected_at, clock_verified, created_device_id, change_id)
    values (${c.recordId}, ${actor.teamId}, ${note.id}, ${jsonb(tx, changes)}, ${outcome}, ${v.reason},
            ${v.requestedByPatient}, ${actor.authorId}, ${under.name}, ${under.credential}, ${v.claimedCredential},
            ${when(c)}, ${c.clockVerified}, ${actor.deviceId}, ${c.changeId})`;
  await ctx.audit({
    action: outcome === 'declined' ? 'note.amendment_declined' : 'note.corrected',
    entity: 'encounter_note',
    entityId: note.id,
    patientId: note.patientId,
    deviceTime: new Date(c.deviceTime),
    details: {
      ...actor.auditDetails,
      changeId: c.changeId,
      correctionId: c.recordId,
      fields: asked.map((a) => a.field),
      outcome,
      requestedByPatient: v.requestedByPatient,
      credential: under.credential,
      ...(under.claimDiffers ? { claimedCredential: v.claimedCredential } : {}),
      statusAfter: after.status,
      attestationAfter: after.attestation,
      clockVerified: c.clockVerified,
    },
  });
  return { status: 'accepted', serverVersion: 1, details: { outcome, ...after } };
}
