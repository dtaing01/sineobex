import type { z } from '@hono/zod-openapi';
import type { Tx } from '../../db/database.ts';
import {
  bookkeeping,
  EncounterCreate,
  fieldSchema,
  initialFieldState,
  jsonb,
  storeCreate,
  type EntityRules,
  type FieldMeta,
  type StoredRecord,
} from '../records.ts';
import { valueParents } from './values.ts';

/**
 * Encounters (phase 2, module 4). Unchanged but for the patient they name, which must now be a
 * patient of the team (phase 3 design 2.3, migration 0013): checked as a parent of the create and
 * of a `set patientId`, so the foreign key never answers first, and with the team lock taken
 * first, because the insert's foreign key check takes FOR KEY SHARE on the patient row (D32).
 */

type Value = z.infer<typeof EncounterCreate>;

interface EncounterRow {
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  patientId: string | null;
  location: Record<string, unknown> | null;
  kind: string;
  startedAt: Date;
  startedDeviceTime: Date | null;
  clockVerified: boolean;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

/** Whether a value names a patient (read as sent, before it is checked). */
const namesPatient = (v: unknown) => typeof v === 'string';

export const encounterRules: EntityRules<Value> = {
  entity: 'encounter',
  auditPrefix: 'encounter',
  permission: () => 'encounters.chart',
  takesTeamLock: (c) =>
    c.op === 'create'
      ? namesPatient((c.value as { patientId?: unknown } | null)?.patientId)
      : c.op === 'set' && c.field === 'patientId' && namesPatient(c.value),
  create: EncounterCreate,
  parents: (v) => valueParents('encounter', 'create', undefined, v),
  parentsOfSet: (field, v) => valueParents('encounter', 'set', field, v),

  applyCreate: (ctx, value) =>
    storeCreate(ctx, 'encounter', {
      insert: async (input) => {
        const initial: Record<string, unknown> = {
          patientId: value.patientId ?? null,
          location: value.location ?? null,
          status: 'draft',
        };
        const { versions, meta } = initialFieldState(initial, input);
        const rows = await ctx.tx`
          insert into sineobex.encounters
            (id, team_id, patient_id, kind, status, author_user_id, started_at, started_device_time,
             clock_verified, location, created_device_id, field_versions, field_meta)
          values (${input.id}, ${input.teamId}, ${initial.patientId as string | null}, ${value.kind}, 'draft',
                  ${input.authorUserId}, ${input.at}, ${input.deviceTime}, ${input.clockVerified},
                  ${jsonb(ctx.tx, initial.location)}, ${input.deviceId}, ${jsonb(ctx.tx, versions)},
                  ${jsonb(ctx.tx, meta)})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : initial;
      },
      patientId: value.patientId ?? null,
      action: 'encounter.created',
    }),

  fieldClass: (field) => (fieldSchema('encounter', field) ? 'draft' : null),
  fieldSchema: (field) => fieldSchema('encounter', field),
  load: loadEncounter,

  async write(tx, rec, field, value, version, meta) {
    const set =
      field === 'status'
        ? tx`status = ${value as string}`
        : field === 'patientId'
          ? tx`patient_id = ${value as string | null}`
          : tx`location = ${jsonb(tx, value)}`;
    const rows = await tx<{ version: number }[]>`
      update sineobex.encounters set ${set}, ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },
};

/**
 * Loads an encounter; `lock` takes FOR NO KEY UPDATE, so two phones changing it are applied one
 * after the other, while a problem or allergy naming it (whose foreign key check takes FOR KEY
 * SHARE under the team lock) never waits on a change that will wait for that lock in turn.
 */
export async function loadEncounter(tx: Tx, id: string, lock: boolean): Promise<StoredRecord | null> {
  const rows = lock
    ? await tx<EncounterRow[]>`select * from sineobex.encounters where id = ${id} for no key update`
    : await tx<EncounterRow[]>`select * from sineobex.encounters where id = ${id}`;
  const r = rows[0];
  if (!r) return null;
  return {
    entity: 'encounter',
    id: r.id,
    teamId: r.teamId,
    status: r.status,
    authorUserId: r.authorUserId,
    version: r.version,
    patientId: r.patientId,
    fieldVersions: r.fieldVersions,
    fieldMeta: r.fieldMeta,
    values: { patientId: r.patientId, location: r.location, status: r.status },
    attributes: {
      kind: r.kind,
      startedAt: r.startedAt.toISOString(),
      startedDeviceTime: r.startedDeviceTime?.toISOString() ?? null,
      clockVerified: r.clockVerified,
    },
    internal: {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
