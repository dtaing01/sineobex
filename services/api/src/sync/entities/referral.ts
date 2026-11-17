import type { z } from '@hono/zod-openapi';
import {
  bookkeeping,
  rejected,
  storeCreate,
  visitOfOtherPatient,
  type EntityRules,
  type FieldMeta,
} from '../records.ts';
import { ReferralCreate, Retraction, valueParents, valueProblem } from './values.ts';

/**
 * Referrals (phase 4 design, lifecycle 4.7, 7): "a referral records only a date and free-text
 * details" (PRD main 113, 507). Made on the phone, by anyone who holds referrals.create, a community
 * health worker included, so a referral never needs an encounter. It copies the allergy's shape
 * (allergy.ts): never overwritten, and its one change is entered in error, set once with a reason.
 * That mark is its author's to make, or anyone's who charts: a community health worker takes back
 * their own referral, a clinician anyone's. The database wants who and when with the reason
 * (referrals_error_with_status, 0021), so all three are written with the status.
 *
 * Its date is the one the worker typed, never more than a day ahead of the server's. The visit it
 * names, when it names one, is a visit of its patient's merged group: one of someone else is a
 * stale reference the worker settles by sending it without the visit (8.4).
 */

type Value = z.infer<typeof ReferralCreate>;

interface ReferralRow {
  id: string;
  teamId: string;
  patientId: string;
  referredOn: string;
  details: string;
  encounterId: string | null;
  status: 'active' | 'entered_in_error';
  errorReason: string | null;
  recordedAt: Date;
  clockVerified: boolean;
  authorUserId: string;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

export const referralRules: EntityRules<Value> = {
  entity: 'referral',
  auditPrefix: 'referral',
  permission: () => 'referrals.create',
  mayChange: (actor, rec) => rec.authorUserId === actor.authorId || actor.permissions.has('encounters.chart'),
  // A patient-side record (D32).
  takesTeamLock: () => true,
  create: ReferralCreate,
  valueProblem: (op, field, value, today) => valueProblem('referral', op, field, value, today),
  parents: (v) => valueParents('referral', 'create', undefined, v),
  parentsOfSet: () => [],

  applyCreate: (ctx, v) =>
    storeCreate(ctx, 'referral', {
      check: async () =>
        v.encounterId !== null &&
        (await visitOfOtherPatient(ctx.tx, ctx.actor.teamId, v.patientId, v.encounterId))
          ? rejected('stale_reference', { problem: 'encounter_other_patient' })
          : null,
      insert: async (input) => {
        const rows = await ctx.tx`
          insert into sineobex.referrals (id, team_id, patient_id, referred_on, details, encounter_id, recorded_at,
            clock_verified, author_user_id, created_device_id)
          values (${input.id}, ${input.teamId}, ${v.patientId}, ${v.referredOn}, ${v.details}, ${v.encounterId},
                  ${input.at}, ${input.clockVerified}, ${input.authorUserId}, ${input.deviceId})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : {};
      },
      patientId: v.patientId,
      action: 'referral.created',
      auditDetails: { encounterId: v.encounterId },
    }),

  fieldClass: (field) => (field === 'enteredInError' ? 'set_once' : null),
  fieldSchema: (field) => (field === 'enteredInError' ? Retraction : null),

  async load(tx, id, lock) {
    const rows = await tx<ReferralRow[]>`
      select id, team_id, patient_id, to_char(referred_on, 'YYYY-MM-DD') as referred_on, details, encounter_id,
             status, error_reason, recorded_at, clock_verified, author_user_id, version, field_versions, field_meta,
             created_at, updated_at
      from sineobex.referrals where id = ${id}
      ${lock ? tx`for no key update` : tx``}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'referral',
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
        referredOn: r.referredOn,
        details: r.details,
        encounterId: r.encounterId,
        recordedAt: r.recordedAt.toISOString(),
        clockVerified: r.clockVerified,
      },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  async write(tx, rec, field, value, version, meta) {
    const { reason } = value as { reason: string };
    const rows = await tx<{ version: number }[]>`
      update sineobex.referrals
      set status = 'entered_in_error', error_reason = ${reason}, error_by = ${meta.by}, error_at = ${meta.at},
          ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },

  writeAction: () => 'referral.entered_in_error',
  // The visit it was made at, as its create's event names it (lifecycle 10.1, review finding REC-5).
  writeDetails: (s) => ({ encounterId: s.rec.attributes.encounterId }),
};
