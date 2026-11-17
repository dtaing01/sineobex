import type { z } from '@hono/zod-openapi';
import { checkAnswer, fieldAt, isBlank, NoteReading, type ResolvedNoteType } from '@sineobex/forms';
import { chartsMedical, loadSigner } from '../../encounters/signer.ts';
import {
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
  rejected,
  storeCreate,
  type ChangeContext,
  type EntityRules,
  type FieldMeta,
  type Outcome,
  type SetContext,
  type StoredRecord,
} from '../records.ts';
import { encounterRules, loadEncounter } from './encounter.ts';
import { applyField, writeValue } from './fields.ts';
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
 * since its checks need the loaded note: first the Medical gate (4.2), which needs the sender's
 * credential; then, for an answer of a note with a version, its type's checkAnswer (4.4), which
 * needs the note's type; then the draft rule, unchanged. The schema hooks that run before the load
 * know only phase 2's open path pattern. An answer put on the chart where it does not count says so
 * on its receipt. A note with no version is a phase 2 preview row: it keeps the open path rule and
 * is never read against a definition.
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
        return (await medicalGate(ctx, medical)) ?? answersProblem(type, value.data ?? {});
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
      attributes: {
        encounterId: r.encounterId,
        noteTypeKey: r.noteTypeKey,
        noteTypeVersion: r.noteTypeVersion,
      },
      internal: { medical: r.medical },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  async write(tx, rec, field, value, version, meta) {
    const set =
      field === 'status'
        ? tx`status = ${value as string}`
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

/** A set of a note's field: the gate, the answer's check against the note's type, the draft rule. */
async function noteSet(s: SetContext): Promise<Outcome> {
  const gated = await medicalGate(s, s.rec.internal.medical === true);
  if (gated) return gated;
  const path = s.field.startsWith('data.') ? s.field.slice('data.'.length) : null;
  const type = path === null ? undefined : await typeOfNote(s);
  if (path === null || type === undefined) return applyField('draft', s);
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
 * The definition of a loaded note's type, or undefined for a phase 2 note with no version. Its
 * create checked that the team holds it; a note that names one the team does not hold was written
 * past every check, and nothing the worker does can fix it.
 */
async function typeOfNote(s: SetContext): Promise<ResolvedNoteType | undefined> {
  const { noteTypeKey, noteTypeVersion } = s.rec.attributes as {
    noteTypeKey: string;
    noteTypeVersion: number | null;
  };
  if (noteTypeVersion === null) return undefined;
  const type = await definitionOf(s.tx, s.rec.teamId, noteTypeKey, noteTypeVersion);
  if (!type) throw new DefinitionError();
  return type;
}

/** The note's answers, by path, with `value` at `path`. */
function answersWith(rec: StoredRecord, path: string, value: unknown): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [field, held] of Object.entries(rec.values))
    if (field.startsWith('data.')) answers[field.slice('data.'.length)] = held;
  answers[path] = value;
  return answers;
}

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
