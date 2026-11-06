import type { z } from '@hono/zod-openapi';
import type { TeamScope } from '../auth/context.ts';
import { notFound } from '../lib/errors.ts';
import { canonicalOf } from './charts.ts';
import { projectionFor } from './projection.ts';
import type { FieldHistoryPageValue, HistoryKind, HistoryQueryValue } from './schemas.ts';

/** Entries per page. */
export const HISTORY_PAGE = 50;

/**
 * GET /v1/patients/{patientId}/history (phase 3 design 3.1, 11.7): every accepted write to the
 * group's records, old and new value, newest first, projected like the chart (problems need
 * mayViewProblems, sensitive ones patients.view_sensitive). Audited as `patient.history_viewed {field}`.
 *
 * The group's patient records, street names, allergies and problems. ID links are left out: a
 * link's create carries its token, which is shown only through the audited ID card routes.
 */
export async function fieldHistory(
  scope: TeamScope,
  patientId: string,
  query: HistoryQueryValue,
): Promise<FieldHistoryPageValue> {
  const projection = projectionFor(scope.team.permissions, 'portal');
  return scope.tx(async (tx, audit) => {
    const canonical = (await canonicalOf(tx, [patientId])).get(patientId);
    if (!canonical) throw notFound('patient');
    const rows = await tx<
      {
        id: string;
        entity: string;
        recordId: string;
        field: string;
        version: number;
        value: unknown;
        previousValue: unknown;
        kind: z.infer<typeof HistoryKind>;
        changedBy: string;
        approvedBy: string | null;
        deviceTime: Date | null;
        recordedAt: Date;
        reviewId: string | null;
        correctionId: string | null;
        changedByName: string;
        approvedByName: string | null;
      }[]
    >`
      with members as (
        select id from sineobex.patients
        where team_id = sineobex.current_team_id() and canonical_id = ${canonical}
      ), records as (
        select 'patient'::text as entity, m.id as record_id from members m
        union all
        select 'patient_alias', a.id from sineobex.patient_aliases a
        where a.team_id = sineobex.current_team_id() and a.patient_id in (select id from members)
        union all
        select 'patient_allergy', a.id from sineobex.patient_allergies a
        where a.team_id = sineobex.current_team_id() and a.patient_id in (select id from members)
        union all
        select 'problem', pr.id from sineobex.problems pr
        where ${projection.problems} and pr.team_id = sineobex.current_team_id()
          and pr.patient_id in (select id from members) and (${projection.sensitive} or not pr.sensitive)
      )
      select h.id::text, h.entity, h.record_id, h.field, h.version, h.value, h.previous_value, h.kind,
             h.changed_by, h.approved_by, h.device_time, h.recorded_at, h.review_id,
             (select c.id from sineobex.patient_corrections c
              where c.team_id = h.team_id and c.history_id = h.id order by c.decided_at limit 1) as correction_id,
             cu.display_name as changed_by_name, au.display_name as approved_by_name
      from sineobex.field_history h
      join records r on r.entity = h.entity and r.record_id = h.record_id
      join sineobex.users cu on cu.id = h.changed_by
      left join sineobex.users au on au.id = h.approved_by
      where h.team_id = sineobex.current_team_id()
        ${query.field === undefined ? tx`` : tx`and h.field = ${query.field}`}
        ${query.afterId === undefined ? tx`` : tx`and h.id < ${query.afterId}::bigint`}
      order by h.id desc
      limit ${HISTORY_PAGE + 1}`;
    const page = rows.slice(0, HISTORY_PAGE);
    await audit({
      action: 'patient.history_viewed',
      entity: 'patient',
      entityId: canonical,
      patientId: canonical,
      details: { field: query.field ?? null, count: page.length },
    });
    return {
      entries: page.map((r) => ({
        id: r.id,
        entity: r.entity,
        recordId: r.recordId,
        field: r.field,
        version: r.version,
        value: r.value ?? null,
        previousValue: r.previousValue ?? null,
        kind: r.kind,
        changedBy: { userId: r.changedBy, displayName: r.changedByName },
        approvedBy:
          r.approvedBy === null ? null : { userId: r.approvedBy, displayName: r.approvedByName ?? '' },
        deviceTime: r.deviceTime?.toISOString() ?? null,
        recordedAt: r.recordedAt.toISOString(),
        reviewId: r.reviewId,
        correctionId: r.correctionId,
      })),
      nextAfterId: rows.length > HISTORY_PAGE ? page[page.length - 1]!.id : null,
    };
  });
}
