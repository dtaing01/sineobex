import type { z } from '@hono/zod-openapi';
import { storeCreate, type EntityRules } from '../records.ts';
import { ConsentCreate, valueParents } from './values.ts';

/**
 * A later consent decision ("Record consent now"), or a privacy notice offered again (phase 3
 * design 11.2). Append-only rows: a changed decision is a new row, so two phones never reconcile.
 */

type Value = z.infer<typeof ConsentCreate>;

interface ConsentRow {
  id: string;
  teamId: string;
  patientId: string;
  kind: string;
  decision: string;
  method: string;
  scriptVersion: string;
  language: string;
  reason: string | null;
  recordedBy: string;
  recordedAt: Date;
  createdAt: Date;
}

export const consentRules: EntityRules<Value> = {
  entity: 'patient_consent',
  auditPrefix: 'consent',
  permission: () => 'patients.edit',
  takesTeamLock: () => true,
  create: ConsentCreate,
  parents: (v) => valueParents('patient_consent', 'create', undefined, v),
  parentsOfSet: () => [],

  applyCreate: (ctx, v) =>
    storeCreate(ctx, 'patient_consent', {
      insert: async (input) => {
        const rows = await ctx.tx`
          insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method, script_version,
            language, reason, recorded_by, recorded_at, clock_verified, device_id, change_id)
          values (${input.id}, ${input.teamId}, ${v.patientId}, ${v.kind}, ${v.decision}, ${v.method},
                  ${v.scriptVersion}, ${v.language}, ${v.reason ?? null}, ${input.authorUserId}, ${input.at},
                  ${input.clockVerified}, ${input.deviceId}, ${input.changeId})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : {};
      },
      patientId: v.patientId,
      action: 'consent.recorded',
      auditDetails: { kind: v.kind, decision: v.decision },
    }),

  fieldClass: () => null,
  fieldSchema: () => null,

  async load(tx, id) {
    const rows = await tx<ConsentRow[]>`
      select id, team_id, patient_id, kind, decision, method, script_version, language, reason, recorded_by,
             recorded_at, created_at
      from sineobex.patient_consents where id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'patient_consent',
      id: r.id,
      teamId: r.teamId,
      status: 'recorded',
      authorUserId: r.recordedBy,
      version: 1,
      patientId: r.patientId,
      fieldVersions: {},
      fieldMeta: {},
      values: {},
      attributes: {
        patientId: r.patientId,
        kind: r.kind,
        decision: r.decision,
        method: r.method,
        scriptVersion: r.scriptVersion,
        language: r.language,
        reason: r.reason,
        recordedAt: r.recordedAt.toISOString(),
      },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    };
  },

  write: () => Promise.reject(new Error('a consent is never changed')),
};
