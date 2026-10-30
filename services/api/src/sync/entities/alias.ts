import type { z } from '@hono/zod-openapi';
import { rematchPatient } from '../../patients/duplicates.ts';
import { bookkeeping, invalid, storeCreate, type EntityRules, type FieldMeta } from '../records.ts';
import { groupOf } from './patient.ts';
import { AliasCreate, patientFieldSchema, valueParents } from './values.ts';

/**
 * Street names (module 2; phase 3 design 2.3): one row each, so two phones adding aliases offline
 * union. Removal, with a reason, is set once and one-way: re-adding is a new alias. Either re-runs
 * matching for the patient's group. An alias named for a merged patient is stored as sent and shown
 * on the survivor by group (2.7).
 */

type Value = z.infer<typeof AliasCreate>;

/** Active street names one patient may have. */
export const MAX_ACTIVE_ALIASES = 20;

interface AliasRow {
  id: string;
  teamId: string;
  patientId: string;
  alias: string;
  status: 'active' | 'removed';
  removedReason: string | null;
  authorUserId: string;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

export const aliasRules: EntityRules<Value> = {
  entity: 'patient_alias',
  auditPrefix: 'alias',
  permission: () => 'patients.edit',
  takesTeamLock: () => true,
  create: AliasCreate,
  parents: (v) => valueParents('patient_alias', 'create', undefined, v),
  parentsOfSet: () => [],

  applyCreate: (ctx, v) =>
    storeCreate(ctx, 'patient_alias', {
      // An alias equal to an active one (normalized) is stored anyway and shown once.
      check: async () => {
        const [row] = await ctx.tx<{ n: number }[]>`
          select count(*)::int as n from sineobex.patient_aliases
          where team_id = ${ctx.actor.teamId} and patient_id = ${v.patientId} and status = 'active'`;
        return row!.n >= MAX_ACTIVE_ALIASES ? invalid('too_many_aliases') : null;
      },
      insert: async (input) => {
        const rows = await ctx.tx`
          insert into sineobex.patient_aliases (id, team_id, patient_id, alias, author_user_id, created_device_id)
          values (${input.id}, ${input.teamId}, ${v.patientId}, ${v.alias}, ${input.authorUserId}, ${input.deviceId})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : {};
      },
      patientId: v.patientId,
      action: 'alias.created',
      after: async () => {
        await rematchPatient(ctx.tx, ctx.audit, (await groupOf(ctx.tx, v.patientId))!, 'edit');
        return undefined;
      },
    }),

  fieldClass: (field) => (field === 'removal' ? 'set_once' : null),
  fieldSchema: (field) => patientFieldSchema('patient_alias', field),

  async load(tx, id, lock) {
    const rows = await tx<AliasRow[]>`
      select id, team_id, patient_id, alias, status, removed_reason, author_user_id, version, field_versions,
             field_meta, created_at, updated_at
      from sineobex.patient_aliases where id = ${id}
      ${lock ? tx`for no key update` : tx``}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'patient_alias',
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      authorUserId: r.authorUserId,
      version: r.version,
      patientId: r.patientId,
      fieldVersions: r.fieldVersions,
      fieldMeta: r.fieldMeta,
      values: { removal: r.status === 'removed' ? { reason: r.removedReason } : null },
      attributes: { patientId: r.patientId, alias: r.alias },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  async write(tx, rec, field, value, version, meta) {
    const { reason } = value as { reason: string };
    const rows = await tx<{ version: number }[]>`
      update sineobex.patient_aliases
      set status = 'removed', removed_reason = ${reason}, removed_by = ${meta.by}, removed_at = ${meta.at},
          ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },

  writeAction: () => 'alias.removed',

  async afterWrite(s) {
    await rematchPatient(s.tx, s.audit, (await groupOf(s.tx, s.rec.patientId!))!, 'edit');
  },
};
