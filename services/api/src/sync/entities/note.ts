import type { z } from '@hono/zod-openapi';
import {
  bookkeeping,
  fieldSchema,
  initialFieldState,
  isLocked,
  jsonb,
  NoteCreate,
  rejected,
  storeCreate,
  type EntityRules,
  type FieldMeta,
} from '../records.ts';
import { loadEncounter } from './encounter.ts';
import { valueParents } from './values.ts';

/** Notes on an encounter, one per care type (phase 2, Oct 19). Unchanged by phase 3. */

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
  takesTeamLock: () => false,
  create: NoteCreate,
  parents: (v) => valueParents('encounter_note', 'create', undefined, v),
  parentsOfSet: () => [],

  async applyCreate(ctx, value) {
    const encounter = await loadEncounter(ctx.tx, value.encounterId, false);
    return storeCreate(ctx, 'encounter_note', {
      check: async () => (encounter && isLocked(encounter) ? rejected('record_locked') : null),
      insert: async (input) => {
        const data = value.data ?? {};
        const initial: Record<string, unknown> = { status: 'draft' };
        for (const [k, v] of Object.entries(data)) initial[`data.${k}`] = v;
        const { versions, meta } = initialFieldState(initial, input);
        const rows = await ctx.tx`
          insert into sineobex.encounter_notes
            (id, team_id, encounter_id, note_type_key, note_type_version, status, author_user_id, data,
             field_versions, field_meta)
          values (${input.id}, ${input.teamId}, ${value.encounterId}, ${value.noteTypeKey},
                  ${value.noteTypeVersion ?? null}, 'draft', ${input.authorUserId}, ${jsonb(ctx.tx, data)},
                  ${jsonb(ctx.tx, versions)}, ${jsonb(ctx.tx, meta)})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : initial;
      },
      patientId: encounter?.patientId ?? null,
      action: 'note.created',
    });
  },

  fieldClass: (field) => (fieldSchema('encounter_note', field) ? 'draft' : null),
  fieldSchema: (field) => fieldSchema('encounter_note', field),

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
      internal: {},
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
