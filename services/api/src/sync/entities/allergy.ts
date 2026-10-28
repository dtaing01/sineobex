import type { z } from '@hono/zod-openapi';
import {
  appendHistory,
  bookkeeping,
  historyOf,
  invalid,
  storeCreate,
  when,
  type ChangeContext,
  type EntityRules,
  type FieldMeta,
} from '../records.ts';
import { groupOf, loadPatient, writePatient } from './patient.ts';
import { AllergyCreate, patientFieldSchema, valueParents } from './values.ts';

/**
 * Allergies: a union, never overwritten (module 9). Never merged by text either: "PCN" and
 * "penicillin" both show, which is safer than guessing. The only change is entered in error, a
 * clinical judgment (encounters.chart), set once. An allergy outranks "No known allergies"
 * whichever arrives first (phase 3 design 2.3; the patient's allergyScreen rule is the other order).
 */

type Value = z.infer<typeof AllergyCreate>;

/** Active allergies one patient may have. */
export const MAX_ACTIVE_ALLERGIES = 30;

interface AllergyRow {
  id: string;
  teamId: string;
  patientId: string;
  substance: string;
  category: string;
  reaction: string | null;
  severity: string;
  encounterId: string | null;
  status: 'active' | 'entered_in_error';
  errorReason: string | null;
  recordedAt: Date;
  authorUserId: string;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * "No known allergies" never stands beside an allergy: the group's screen goes back to "not asked"
 * (not to an older answer, should this allergy later be marked entered in error), as the
 * allergy's author, under its change ID.
 */
async function clearNoKnownAllergies(ctx: ChangeContext, patientId: string): Promise<void> {
  const { tx, actor, change: c } = ctx;
  const patient = await loadPatient(tx, (await groupOf(tx, patientId))!, true);
  if (!patient || patient.values.allergyScreen !== 'none_known') return;
  const version = (patient.fieldVersions.allergyScreen ?? 0) + 1;
  const meta = { by: actor.authorId, at: when(c).toISOString(), changeId: c.changeId };
  await writePatient(tx, patient, 'allergyScreen', 'not_asked', version, meta);
  await appendHistory(
    tx,
    historyOf(
      ctx,
      'patient',
      patient.id,
      'allergyScreen',
      version,
      'not_asked',
      'none_known',
      'cleared_by_allergy',
    ),
  );
  await ctx.audit({
    action: 'patient.updated',
    entity: 'patient',
    entityId: patient.id,
    patientId: patient.id,
    deviceTime: new Date(c.deviceTime),
    details: {
      ...actor.auditDetails,
      changeId: c.changeId,
      field: 'allergyScreen',
      kind: 'cleared_by_allergy',
      version,
    },
  });
}

export const allergyRules: EntityRules<Value> = {
  entity: 'patient_allergy',
  auditPrefix: 'allergy',
  permission: (op) => (op === 'create' ? 'patients.edit' : 'encounters.chart'),
  takesTeamLock: () => true,
  create: AllergyCreate,
  parents: (v) => valueParents('patient_allergy', 'create', undefined, v),
  parentsOfSet: () => [],

  applyCreate: (ctx, v) =>
    storeCreate(ctx, 'patient_allergy', {
      check: async () => {
        const [row] = await ctx.tx<{ n: number }[]>`
          select count(*)::int as n from sineobex.patient_allergies
          where team_id = ${ctx.actor.teamId} and patient_id = ${v.patientId} and status = 'active'`;
        return row!.n >= MAX_ACTIVE_ALLERGIES ? invalid('too_many_allergies') : null;
      },
      insert: async (input) => {
        const rows = await ctx.tx`
          insert into sineobex.patient_allergies (id, team_id, patient_id, substance, category, reaction,
            severity, encounter_id, recorded_at, author_user_id, created_device_id)
          values (${input.id}, ${input.teamId}, ${v.patientId}, ${v.substance}, ${v.category ?? 'unknown'},
                  ${v.reaction ?? null}, ${v.severity ?? 'unknown'}, ${v.encounterId ?? null}, ${input.at},
                  ${input.authorUserId}, ${input.deviceId})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : {};
      },
      patientId: v.patientId,
      action: 'allergy.created',
      after: async () => {
        await clearNoKnownAllergies(ctx, v.patientId);
        return undefined;
      },
    }),

  fieldClass: (field) => (field === 'enteredInError' ? 'set_once' : null),
  fieldSchema: (field) => patientFieldSchema('patient_allergy', field),

  async load(tx, id, lock) {
    const rows = await tx<AllergyRow[]>`
      select id, team_id, patient_id, substance, category, reaction, severity, encounter_id, status,
             error_reason, recorded_at, author_user_id, version, field_versions, field_meta, created_at,
             updated_at
      from sineobex.patient_allergies where id = ${id}
      ${lock ? tx`for no key update` : tx``}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'patient_allergy',
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      authorUserId: r.authorUserId,
      version: r.version,
      patientId: r.patientId,
      fieldVersions: r.fieldVersions,
      fieldMeta: r.fieldMeta,
      values: { enteredInError: r.status === 'entered_in_error' ? { reason: r.errorReason } : null },
      attributes: {
        patientId: r.patientId,
        substance: r.substance,
        category: r.category,
        reaction: r.reaction,
        severity: r.severity,
        encounterId: r.encounterId,
        recordedAt: r.recordedAt.toISOString(),
      },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  async write(tx, rec, field, value, version, meta) {
    const { reason } = value as { reason: string };
    const rows = await tx<{ version: number }[]>`
      update sineobex.patient_allergies
      set status = 'entered_in_error', error_reason = ${reason}, error_by = ${meta.by}, error_at = ${meta.at},
          ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },

  writeAction: () => 'allergy.entered_in_error',
};
