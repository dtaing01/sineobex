import type { z } from '@hono/zod-openapi';
import type { ResolvedNoteType } from '@sineobex/forms';
import { chartsMedical, loadSigner } from '../../encounters/signer.ts';
import { definitionFor } from '../../forms/definitions.ts';
import {
  bookkeeping,
  fieldSchema,
  initialFieldState,
  isLocked,
  jsonb,
  NoteCreate,
  rejected,
  storeCreate,
  type ChangeContext,
  type EntityRules,
  type FieldMeta,
  type Outcome,
} from '../records.ts';
import { loadEncounter } from './encounter.ts';
import { applyField } from './fields.ts';
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
 * Every change to a Medical note passes the Medical gate (4.2). A set reaches it through the note's
 * own rule (the `status` class, the hook a problem's status uses): the gate needs the loaded note and
 * the sender's credential, which neither apply.ts's checks nor the field rules load. The rule then
 * applies the draft rule unchanged.
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
    const medical = await medicalNote(ctx, value);
    return storeCreate(ctx, 'encounter_note', {
      check: async () =>
        (encounter && isLocked(encounter) ? rejected('record_locked') : null) ??
        (await medicalGate(ctx, medical)),
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
      patientId: encounter?.patientId ?? null,
      action: 'note.created',
    });
  },

  fieldClass: (field) => (fieldSchema('encounter_note', field) ? 'status' : null),
  fieldSchema: (field) => fieldSchema('encounter_note', field),
  applyStatus: async (s) => (await medicalGate(s, s.rec.internal.medical === true)) ?? applyField('draft', s),

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
 * Whether a new note is a Medical note, from its type: set at the create and never changed (lifecycle
 * 2.2). A note with no version is a phase 2 preview row and counts as Non-Medical (4.4). A key or
 * version the team does not have makes no Medical note either; the create checks of 4.4 refuse it
 * before this is asked.
 */
async function medicalNote(ctx: ChangeContext, value: Value): Promise<boolean> {
  if (value.noteTypeVersion === null || value.noteTypeVersion === undefined) return false;
  const stored = await definitionFor(ctx.tx, ctx.actor.teamId, value.noteTypeKey, value.noteTypeVersion);
  return stored !== undefined && isMedicalType(stored.definition);
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
