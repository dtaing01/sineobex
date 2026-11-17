import type { z } from '@hono/zod-openapi';
import { checkAnswer, fieldAt, isBlank, NoteReading, type ResolvedNoteType } from '@sineobex/forms';
import { CAPABILITIES } from '../../auth/permissions.ts';
import type { Tx } from '../../db/database.ts';
import { reopenEffect, type NoteStatus } from '../../encounters/rules.ts';
import { chartsMedical, loadSigner } from '../../encounters/signer.ts';
import {
  answerHidden,
  bookkeeping,
  byDefinition,
  DefinitionError,
  definitionOf,
  fieldSchema,
  fieldState,
  initialFieldState,
  invalid,
  jsonb,
  NoteCreate,
  noteReader,
  rejected,
  storeCreate,
  type ApplyActor,
  type ChangeContext,
  type EntityRules,
  type FieldMeta,
  type KeptInstead,
  type Outcome,
  type SetContext,
  type StoredRecord,
} from '../records.ts';
import { encounterRules, loadEncounter } from './encounter.ts';
import { applyField, keepInHistory, NOTHING_TO_RESOLVE, writeValue } from './fields.ts';
import type { FieldStateValue } from '../schemas.ts';
import { valueParents } from './values.ts';

/**
 * Notes on an encounter, one per care type (phase 2, Oct 19).
 *
 * Every change takes the team lock first (phase 4 lifecycle 4.2). A note's create or change can move
 * its encounter's status, through the trigger of migration 0018, which locks the encounter row; two
 * such changes of one visit must not each work out the status without the other's note, and a note
 * change must not lock that row before it waits for the team lock at its audit event, while an
 * encounter set holds the team lock and waits for the row.
 *
 * A create names a note type version the team holds, and a Medical one needs a visit that names a
 * patient and makes that visit Medical (4.4). It is taken whatever state the visit's other notes are
 * in: the note is the unit, so a teammate's note added after the clinician signed is never lost.
 *
 * A set goes through the note's own rule (the `status` class, the hook a problem's status uses),
 * since its checks need the loaded note: first an answer the sender may not see (6.4), held for
 * review before anything answers with the value held there; then the Medical gate (4.2), which
 * needs the sender's credential; then, for an answer of a note with a version, its type's
 * checkAnswer (4.4), which needs the note's type; then the draft rule, unchanged. The schema hooks that run before the load
 * know only phase 2's open path pattern. An answer put on the chart where it does not count says so
 * on its receipt. A note with no version is a phase 2 preview row: it keeps the open path rule and
 * is never read against a definition.
 *
 * A finished note never changes (3.6). A late answer is kept in history, never refused, since the
 * worker has nothing to fix: its sender is told, and so is the note's acting author when the sender
 * is someone else. It reaches no chart, so its answer is not checked: the check is the draft path's.
 * The status takes one value from a phone, `draft`, the reopen, by the table of reopenEffect; a
 * `completed` from an old build is kept in history, since a note is finished only by a sign-off.
 */

type Value = z.infer<typeof NoteCreate>;

interface NoteRow {
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  encounterId: string;
  noteTypeKey: string;
  noteTypeVersion: number | null;
  medical: boolean;
  assignedUserId: string | null;
  firstSignedAt: Date | null;
  completedAt: Date | null;
  signoffId: string | null;
  attestation: string;
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
  patientId: string | null;
}

export const noteRules: EntityRules<Value> = {
  entity: 'encounter_note',
  auditPrefix: 'note',
  permission: () => 'encounters.chart',
  takesTeamLock: () => true,
  create: NoteCreate,
  parents: (v) => valueParents('encounter_note', 'create', undefined, v),
  parentsOfSet: () => [],

  async applyCreate(ctx, value) {
    const encounter = await loadEncounter(ctx.tx, value.encounterId, false);
    if (!encounter) return rejected('stale_reference', { problem: 'encounter_missing' });
    const type = await noteType(ctx, value);
    const medical = type !== undefined && isMedicalType(type);
    return storeCreate(ctx, 'encounter_note', {
      // In this order (4.4): the type and the visit, which the worker can fix; the gate, which holds
      // the change for review; then each answer, as a set of it is checked.
      check: async () => {
        if (!type) return invalid('unknown_note_type');
        if (medical && encounter.patientId === null) return invalid('medical_note_needs_patient');
        return (
          (await medicalGate(ctx, medical)) ??
          (await needsGate(ctx, type, Object.keys(value.data ?? {}))) ??
          answersProblem(type, value.data ?? {})
        );
      },
      insert: async (input) => {
        const data = value.data ?? {};
        const initial: Record<string, unknown> = { status: 'draft' };
        for (const [k, v] of Object.entries(data)) initial[`data.${k}`] = v;
        const { versions, meta } = initialFieldState(initial, input);
        const rows = await ctx.tx`
          insert into sineobex.encounter_notes
            (id, team_id, encounter_id, note_type_key, note_type_version, medical, status, author_user_id, data,
             field_versions, field_meta)
          values (${input.id}, ${input.teamId}, ${value.encounterId}, ${value.noteTypeKey},
                  ${value.noteTypeVersion ?? null}, ${medical}, 'draft', ${input.authorUserId},
                  ${jsonb(ctx.tx, data)}, ${jsonb(ctx.tx, versions)}, ${jsonb(ctx.tx, meta)})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : initial;
      },
      patientId: encounter.patientId,
      action: 'note.created',
      after: async () => {
        if (medical) await makeMedical(ctx, encounter);
        return undefined;
      },
    });
  },

  fieldClass: (field) => (fieldSchema('encounter_note', field) ? 'status' : null),
  fieldSchema: (field) => fieldSchema('encounter_note', field),
  applyStatus: noteSet,
  keptInstead: lateChange,
  writeAction: (field) => (field === 'status' ? 'note.reopened' : null),

  async load(tx, id, lock) {
    const rows = lock
      ? await tx<NoteRow[]>`
          select n.*, e.patient_id from sineobex.encounter_notes n
          join sineobex.encounters e on e.id = n.encounter_id where n.id = ${id} for no key update of n`
      : await tx<NoteRow[]>`
          select n.*, e.patient_id from sineobex.encounter_notes n
          join sineobex.encounters e on e.id = n.encounter_id where n.id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    const values: Record<string, unknown> = { status: r.status };
    for (const [k, v] of Object.entries(r.data)) values[`data.${k}`] = v;
    return {
      entity: 'encounter_note',
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      authorUserId: r.authorUserId,
      version: r.version,
      patientId: r.patientId,
      fieldVersions: r.fieldVersions,
      fieldMeta: r.fieldMeta,
      values,
      // Its state too, so the author's phone can show the state of a note it still holds (4.4, 4.10).
      attributes: {
        encounterId: r.encounterId,
        noteTypeKey: r.noteTypeKey,
        noteTypeVersion: r.noteTypeVersion,
        attestation: r.attestation,
        actingAuthorId: r.assignedUserId ?? r.authorUserId,
        completedAt: r.completedAt?.toISOString() ?? null,
        signoffId: r.signoffId,
      },
      internal: {
        medical: r.medical,
        // Who acts as the author (3.8): the clinician an admin assigned after the author left.
        actingAuthorId: r.assignedUserId ?? r.authorUserId,
        everSigned: r.firstSignedAt !== null,
        attestation: r.attestation,
      },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  async write(tx, rec, field, value, version, meta) {
    // Only a reopen writes a status here, and a draft holds no time of finishing (0018); a sign-off
    // writes a finished status with its time (note-signoff.ts).
    const set =
      field === 'status'
        ? tx`status = ${value as string}, completed_at = null, completed_by = null`
        : tx`data = data || jsonb_build_object(${field.slice(5)}::text, ${jsonb(tx, value)})`;
    const rows = await tx<{ version: number }[]>`
      update sineobex.encounter_notes set ${set}, ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },
};

/** A Medical note type is one offered for Medical encounters only (lifecycle 3.1). */
export const isMedicalType = (definition: ResolvedNoteType): boolean =>
  !definition.kinds.includes('non_medical');

/**
 * The type a new note names, as the team holds it, or undefined: a key or version the team does not
 * have. A note with no version is a phase 2 preview row, and no new one is made (4.4). Whether the
 * note is Medical is read from it once, at the create, and never changed (2.2).
 */
async function noteType(ctx: ChangeContext, value: Value): Promise<ResolvedNoteType | undefined> {
  if (value.noteTypeVersion === null || value.noteTypeVersion === undefined) return undefined;
  return definitionOf(ctx.tx, ctx.actor.teamId, value.noteTypeKey, value.noteTypeVersion);
}

/** The first of a create's answers its type refuses, naming its path, as a set of it would be refused. */
function answersProblem(type: ResolvedNoteType, data: Record<string, unknown>): Outcome | null {
  for (const [path, answer] of Object.entries(data)) {
    const problem = byDefinition(() => checkAnswer(type, path, answer));
    if (problem) return invalid(problem, { path });
  }
  return null;
}

/**
 * A set of a note's field: an answer the sender may not see; the gate; the status's own rule; a
 * finished note's late change, kept by the draft rule (lateChange); then the answer's check against
 * the note's type, and the draft rule.
 */
async function noteSet(s: SetContext): Promise<Outcome> {
  const hidden = await hiddenFromSender(s);
  if (hidden) return hidden;
  const gated = await medicalGate(s, s.rec.internal.medical === true);
  if (gated) return gated;
  if (s.field === 'status') return statusSet(s);
  const needed = await needsGate(s, await noteTypeOf(s.tx, s.rec), [s.field.slice('data.'.length)]);
  if (needed) return needed;
  if (s.rec.status !== 'draft') return applyField('draft', s);
  const path = s.field.slice('data.'.length);
  const type = await noteTypeOf(s.tx, s.rec);
  if (type === undefined) return applyField('draft', s);
  const problem = byDefinition(() => checkAnswer(type, path, s.value));
  if (problem) return invalid(problem);
  const outcome = await applyField('draft', s);
  // Told only of a value now on the chart: not a conflict, a value kept in history, or the answer
  // to a conflict that kept the server's value.
  if (outcome.status !== 'accepted' || outcome.server || s.change.resolution === 'keep_server')
    return outcome;
  const why = byDefinition(() => notCounted(type, answersWith(s.rec, path, s.value), path));
  return why ? { ...outcome, details: { ...outcome.details, notCounted: why } } : outcome;
}

/**
 * A set of an answer the sender may not see (lifecycle 4.4, 6.4 rule 5): what the answer holds now,
 * or would hold, is hidden from them. It is held for a Program Admin, for a draft and a finished
 * note alike, before anything answers with the value held there: a conflict or a late change would
 * send it back. Whoever acts as the author sees all of their note (6.4 rule 1), and an admin's
 * accept passes, as through the Medical gate. A section that needs a capability is needsGate's.
 */
async function hiddenFromSender(s: SetContext): Promise<Outcome | null> {
  if (!s.field.startsWith('data.') || s.actor.approvedBy !== null) return null;
  if (s.actor.authorId === actingAuthor(s.rec)) return null;
  const type = await noteTypeOf(s.tx, s.rec);
  if (type === undefined) return null;
  const reader = await senderReader(s.tx, s.actor);
  const path = s.field.slice('data.'.length);
  const answers = answersOf(s.rec);
  const hidden = byDefinition(
    () =>
      (Object.hasOwn(answers, path) && answerHidden(type, answers, path, answers[path], reader)) ||
      answerHidden(type, answers, path, s.value, reader),
  );
  return hidden ? rejected('permission') : null;
}

/** The sender as visibleAnswers reads them: their role's keys and their credential now, never as the author. */
async function senderReader(tx: Tx, actor: Pick<ApplyActor, 'teamId' | 'authorId' | 'permissions'>) {
  const sender = await loadSigner(tx, actor.teamId, actor.authorId);
  return noteReader(actor.permissions, sender?.credential ?? 'none', false);
}

/** A field that holds nothing, as a retry is answered with an answer hidden from its sender. */
const NOTHING_SHOWN: FieldStateValue = { value: null, version: 0, changedBy: null, changedAt: null };

/**
 * A note's field as a retry of [sender]'s change is answered with it (apply.ts resultFromReceipt;
 * lifecycle 4.4, 6.4 rule 2). A conflict or a value kept in history shows the field as it is now,
 * which may since hold an answer the sender may not see: then it is answered as a field that holds
 * nothing, as their sync read leaves no key for it, the way a fresh set of it would be held before
 * anything answered with it. Whoever acts as the author is sent it as it is, and so is the field of
 * a phase 2 note; one whose definition cannot be read hides it.
 */
export async function fieldForSender(
  tx: Tx,
  sender: Pick<ApplyActor, 'teamId' | 'authorId' | 'permissions'>,
  note: StoredRecord,
  field: string,
): Promise<FieldStateValue> {
  const state = fieldState(note, field);
  if (!field.startsWith('data.') || sender.authorId === actingAuthor(note)) return state;
  try {
    const type = await noteTypeOf(tx, note);
    if (type === undefined) return state;
    const reader = await senderReader(tx, sender);
    const path = field.slice('data.'.length);
    const answers = answersOf(note);
    const hidden = byDefinition(
      () => Object.hasOwn(answers, path) && answerHidden(type, answers, path, answers[path], reader),
    );
    return hidden ? NOTHING_SHOWN : state;
  } catch (err) {
    if (err instanceof DefinitionError) return NOTHING_SHOWN;
    throw err;
  }
}

/** Who acts as a loaded note's author (lifecycle 3.8). */
export const actingAuthor = (note: StoredRecord) => note.internal.actingAuthorId as string;

/**
 * A finished note keeps a late change (lifecycle 3.6, 4.4), asked by the draft rule once the value
 * differs from the one held. "The note was already finished. Your change was kept in its history":
 * to its sender, and to the acting author when the sender is someone else (PRD main 100).
 */
async function lateChange(s: SetContext): Promise<KeptInstead | null> {
  return s.rec.status === 'draft' ? null : lateKept(s);
}

function lateKept(s: SetContext): KeptInstead {
  const author = actingAuthor(s.rec);
  const to = s.actor.authorId === author ? [author] : [s.actor.authorId, author];
  return { problem: 'note_finished', notice: { kind: 'late_change_kept', to } };
}

/**
 * A note's status from a phone (lifecycle 4.4). `draft` is the reopen of 3.6: reopenEffect says
 * whether it applies, and a reopen the note takes no more is a late change, or, from someone who
 * does not act as its author, a change only the author could make ("Only the note's author can do
 * that. Nothing was changed."). `completed` is an old build's Complete: a note is finished only by
 * a sign-off. A status moves by these rules alone and never conflicts, so there is nothing to
 * resolve, and the version the phone saw does not matter.
 */
async function statusSet(s: SetContext): Promise<Outcome> {
  if (s.change.resolution) return invalid(NOTHING_TO_RESOLVE);
  if (s.value === 'completed') return keepInHistory(s, { problem: 'use_signoff' });
  const note = {
    noteStatus: s.rec.status as NoteStatus,
    everSigned: s.rec.internal.everSigned === true,
    medicalNote: s.rec.internal.medical === true,
  };
  const effect = reopenEffect({ ...note, actsAsAuthor: s.actor.authorId === actingAuthor(s.rec) });
  if (effect === 'nothing') return { status: 'accepted', serverVersion: s.cur.version };
  if (effect === 'apply') return writeValue(s, 'set');
  if (reopenEffect({ ...note, actsAsAuthor: true }) === 'apply') {
    return keepInHistory(s, {
      problem: 'not_author',
      notice: { kind: 'change_not_applied', to: [s.actor.authorId] },
    });
  }
  return keepInHistory(s, lateKept(s));
}

/**
 * The definition of a loaded note's type, or undefined for a phase 2 note with no version. Its
 * create checked that the team holds it; a note that names one the team does not hold was written
 * past every check, and nothing the worker does can fix it.
 */
export async function noteTypeOf(tx: Tx, note: StoredRecord): Promise<ResolvedNoteType | undefined> {
  const { noteTypeKey, noteTypeVersion } = note.attributes as {
    noteTypeKey: string;
    noteTypeVersion: number | null;
  };
  if (noteTypeVersion === null) return undefined;
  const type = await definitionOf(tx, note.teamId, noteTypeKey, noteTypeVersion);
  if (!type) throw new DefinitionError();
  return type;
}

/** A loaded note's answers, by path, as stored. */
export function answersOf(note: StoredRecord): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [field, held] of Object.entries(note.values))
    if (field.startsWith('data.')) answers[field.slice('data.'.length)] = held;
  return answers;
}

/** The note's answers, by path, with `value` at `path`. */
const answersWith = (rec: StoredRecord, path: string, value: unknown) => ({
  ...answersOf(rec),
  [path]: value,
});

/**
 * Why an answer on the chart does not count (lifecycle 4.4), or null when it does: it is in an entry
 * that is not there (another phone removed it), or its field is hidden now (a condition, a flag that
 * clears it, a row whose option is no longer picked). It is kept all the same, and counts again when
 * the field shows again. A clear holds no answer, and a removal is what it says: neither is told.
 */
export function notCounted(
  type: ResolvedNoteType,
  answers: Record<string, unknown>,
  path: string,
): 'hidden_field' | 'removed_entry' | null {
  const target = fieldAt(type, path);
  if (!target || target.part === 'entryRemoved' || isBlank(answers[path])) return null;
  const reading = new NoteReading(type, answers);
  if (reading.counts(path)) return null;
  if (target.entry !== null) {
    const section = reading.model.sections.find((node) => node.section === target.section)!;
    if (!reading.entries(section).includes(target.entry)) return 'removed_entry';
  }
  return 'hidden_field';
}

/**
 * A Medical note makes its visit Medical if it was not (4.3, 4.4), so a note is never refused for the
 * kind of its visit. It is written as this change's switch of the visit's kind, as a phone's would
 * be: the field's next version, its history row and its audit event. The visit was read under the
 * team lock, which every encounter change takes first, so what it holds is still current.
 */
async function makeMedical(ctx: ChangeContext, visit: StoredRecord): Promise<void> {
  if (visit.values.kind === 'medical') return;
  const kind = { field: 'kind', value: 'medical', cur: fieldState(visit, 'kind'), saw: true, redirect: null };
  await writeValue({ ...ctx, rules: encounterRules, rec: visit, ...kind }, 'set');
}

/**
 * The gate of a section that needs a capability (lifecycle 4.2, 6.4 rule 5; forms.md: "changed by
 * a credential with this capability only"): an answer of the Quick encounter's Medication section,
 * in a create, a set or a correction, needs a credential that orders medications, read now from the
 * sender's membership. It is a gate on the credential, as the Medical gate is, so whoever acts as
 * the author passes it only with that credential (rule 1 is about seeing, review finding NOT-1): one
 * lowered while the phone was offline is held for a Program Admin, whose accept passes.
 */
export async function needsGate(
  ctx: ChangeContext,
  type: ResolvedNoteType | undefined,
  paths: readonly string[],
): Promise<Outcome | null> {
  if (type === undefined || ctx.actor.approvedBy !== null) return null;
  const needs = byDefinition(() =>
    paths.some((path) => fieldAt(type, path)?.section.needs === 'orderMedications'),
  );
  if (!needs) return null;
  const sender = await loadSigner(ctx.tx, ctx.actor.teamId, ctx.actor.authorId);
  return sender?.active && CAPABILITIES[sender.credential].orderMedications ? null : rejected('permission');
}

/**
 * The Medical gate (lifecycle 4.2): a change to a Medical note needs a credential that charts
 * Medical, read now from the sender's membership. The phone offers a Medical note type only to such
 * a credential, so the gate is reached when one was lowered while the phone was offline. The worker
 * has nothing to fix, so the change is held for a Program Admin, never refused: `permission` on a
 * push is held for review (apply.ts). An admin's accept carries `approvedBy`, and passes; the
 * history row and the audit event name the admin.
 */
export async function medicalGate(ctx: ChangeContext, medical: boolean): Promise<Outcome | null> {
  if (!medical || ctx.actor.approvedBy !== null) return null;
  const sender = await loadSigner(ctx.tx, ctx.actor.teamId, ctx.actor.authorId);
  return chartsMedical(sender) ? null : rejected('permission');
}
