import type { z } from '@hono/zod-openapi';
import type { Tx } from '../../db/database.ts';
import { SENSITIVE_CODE_RANGES } from '../../patients/generated/sensitive-codes.ts';
import {
  bookkeeping,
  initialFieldState,
  invalid,
  jsonb,
  storeCreate,
  when,
  type EntityRules,
  type FieldMeta,
  type Outcome,
  type SetContext,
  type StoredRecord,
} from '../records.ts';
import { keepInHistory, keepServer, writeValue } from './fields.ts';
import { groupOf } from './patient.ts';
import { patientFieldSchema, ProblemCreate, valueParents } from './values.ts';

/**
 * The problem list (module 5; phase 3 design section 9). Title and code never change: a wrong
 * entry is marked entered in error (its author, or patients.reverse_resolved) and added again.
 * Status is an observation with a time: the latest observation wins, every observation is a
 * history row, and only an admin moves a problem out of Resolved (D36). Work that arrives for a
 * problem marked entered in error is kept in its history, never refused (review finding 7).
 */

type Value = z.infer<typeof ProblemCreate>;
type StatusValue = { status: 'new' | 'ongoing' | 'resolved'; encounterId: string | null };

const RANK = { new: 0, ongoing: 1, resolved: 2 } as const;

/** Sensitive by default (design 9.5): the code's first characters sort inside a listed range. */
export function isSensitiveCode(code: string): boolean {
  return SENSITIVE_CODE_RANGES.some((r) => {
    const head = code.slice(0, r.from.length);
    return head >= r.from && head <= r.to;
  });
}

interface ProblemRow {
  id: string;
  teamId: string;
  patientId: string;
  title: string;
  codeSystem: string | null;
  code: string | null;
  codeDisplay: string | null;
  sensitive: boolean;
  status: StatusValue['status'];
  statusEncounterId: string | null;
  recurrenceOf: string | null;
  resolvedInErrorOf: string | null;
  statusChangedAt: Date;
  statusCheckedAt: Date;
  reversalRequest: string | null;
  mergedInto: string | null;
  errorReason: string | null;
  errorAt: Date | null;
  source: string;
  createdEncounterId: string | null;
  onsetDate: string | null;
  authorUserId: string;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

export async function loadProblem(tx: Tx, id: string, lock: boolean): Promise<StoredRecord | null> {
  const rows = await tx<ProblemRow[]>`
    select id, team_id, patient_id, title, code_system, code, code_display, sensitive, status,
           status_encounter_id, status_changed_at, status_checked_at, recurrence_of, resolved_in_error_of,
           reversal_request, merged_into, error_reason, error_at, source, created_encounter_id,
           onset_date::text as onset_date, author_user_id, version, field_versions, field_meta, created_at,
           updated_at
    from sineobex.problems where id = ${id}
    ${lock ? tx`for no key update` : tx``}`;
  const r = rows[0];
  if (!r) return null;
  // The shape the chart routes give a problem (patients/charts.ts), so the phone sees one shape
  // whichever route it comes through.
  return {
    entity: 'problem',
    id: r.id,
    teamId: r.teamId,
    status: r.status,
    authorUserId: r.authorUserId,
    version: r.version,
    patientId: r.patientId,
    fieldVersions: r.fieldVersions,
    fieldMeta: r.fieldMeta,
    values: {
      status: { status: r.status, encounterId: r.statusEncounterId },
      enteredInError: r.errorReason === null ? null : { reason: r.errorReason },
    },
    attributes: {
      patientId: r.patientId,
      title: r.title,
      code: r.code === null ? null : { system: r.codeSystem, code: r.code, display: r.codeDisplay },
      sensitive: r.sensitive,
      source: r.source,
      createdEncounterId: r.createdEncounterId,
      onsetDate: r.onsetDate,
      recurrenceOf: r.recurrenceOf,
      resolvedInErrorOf: r.resolvedInErrorOf,
      reversalRequest: r.reversalRequest,
      mergedInto: r.mergedInto,
      statusChangedAt: r.statusChangedAt.toISOString(),
      statusCheckedAt: r.statusCheckedAt.toISOString(),
    },
    internal: { mergedInto: r.mergedInto, retracted: r.errorAt !== null },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Where a status was observed against what the server holds (design 9.2). `saw`: the phone saw
 * the current version. Otherwise the observation's time decides: an older one is history, a newer
 * one that moves forward is progress, and a newer one that moves out of Resolved is a conflict
 * the worker answers with the problem card (9.3).
 */
async function applyStatus(s: SetContext): Promise<Outcome> {
  // Kept, and the problem stays retracted: nothing for the worker to fix.
  if (s.rec.internal.retracted) return keepInHistory(s);
  if (s.change.resolution === 'keep_server') return keepServer(s, false);
  if (s.change.resolution === 'replace' && !s.saw) return { status: 'conflict', server: s.cur };
  const cur = s.cur.value as StatusValue;
  const next = s.value as StatusValue;
  // Every observation counts, so module 5's 90-day check knows when someone last looked.
  if (next.status === cur.status) return writeValue(s, 'confirmed');
  const forward = RANK[next.status] > RANK[cur.status];
  if (s.saw) {
    if (forward) return writeValue(s, 'set');
    // The phone never offers either: Resolved back is an admin's, and Ongoing never goes back to New.
    return invalid(cur.status === 'resolved' ? 'resolved_needs_admin' : 'status_backwards');
  }
  const observedAt = s.rec.fieldMeta.status?.at;
  if (observedAt && when(s.change).getTime() < Date.parse(observedAt)) return keepInHistory(s);
  if (forward) return writeValue(s, 'set');
  if (cur.status === 'resolved') return { status: 'conflict', server: s.cur };
  return keepInHistory(s);
}

export const problemRules: EntityRules<Value> = {
  entity: 'problem',
  auditPrefix: 'problem',
  permission: () => 'encounters.chart',
  // Entered in error: its author, or someone who may reverse a resolution (design 9.5).
  mayChange: (actor, rec, field) =>
    field !== 'enteredInError' ||
    rec.authorUserId === actor.authorId ||
    actor.permissions.has('patients.reverse_resolved'),
  takesTeamLock: () => true,
  create: ProblemCreate,
  parents: (v) => valueParents('problem', 'create', undefined, v),
  parentsOfSet: (field, v) => valueParents('problem', 'set', field, v),

  applyCreate(ctx, v) {
    const { tx } = ctx;
    const origin = v.recurrenceOf ?? v.resolvedInErrorOf;
    return storeCreate(ctx, 'problem', {
      // A recurrence, or a reversal request, stands beside a Resolved entry of the same person.
      check: async () => {
        if (!origin) return null;
        const [earlier] = await tx<{ status: string; canonicalId: string }[]>`
          select pr.status, p.canonical_id from sineobex.problems pr
          join sineobex.patients p on p.team_id = pr.team_id and p.id = pr.patient_id
          where pr.team_id = ${ctx.actor.teamId} and pr.id = ${origin}`;
        const group = await groupOf(tx, v.patientId);
        return earlier?.status === 'resolved' && earlier.canonicalId === group
          ? null
          : invalid('not_resolved');
      },
      insert: async (input) => {
        const initial = { status: { status: v.status, encounterId: v.encounterId ?? null } };
        const { versions, meta } = initialFieldState(initial, input);
        const sensitive = v.sensitive === true || (v.code ? isSensitiveCode(v.code.code) : false);
        const rows = await tx`
          insert into sineobex.problems (id, team_id, patient_id, title, code_system, code, code_display,
            sensitive, status, status_encounter_id, status_changed_at, status_changed_by, status_checked_at,
            recurrence_of, resolved_in_error_of, reversal_request, created_encounter_id, onset_date,
            author_user_id, created_device_id, field_versions, field_meta)
          values (${input.id}, ${input.teamId}, ${v.patientId}, ${v.title}, ${v.code?.system ?? null},
                  ${v.code?.code ?? null}, ${v.code?.display ?? null}, ${sensitive}, ${v.status},
                  ${v.encounterId ?? null}, ${input.at}, ${input.authorUserId}, ${input.at},
                  ${v.recurrenceOf ?? null}, ${v.resolvedInErrorOf ?? null},
                  ${v.resolvedInErrorOf ? 'open' : null}, ${v.encounterId ?? null}, ${v.onsetDate ?? null}::date,
                  ${input.authorUserId}, ${input.deviceId}, ${jsonb(tx, versions)}, ${jsonb(tx, meta)})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : initial;
      },
      patientId: v.patientId,
      action: 'problem.created',
      after: async () => {
        if (v.resolvedInErrorOf) {
          // The new entry is the request an admin reverses or declines (design 9.4).
          await ctx.audit({
            action: 'problem.reversal_requested',
            entity: 'problem',
            entityId: ctx.change.recordId,
            patientId: v.patientId,
            deviceTime: new Date(ctx.change.deviceTime),
            details: {
              ...ctx.actor.auditDetails,
              changeId: ctx.change.changeId,
              resolvedInErrorOf: v.resolvedInErrorOf,
            },
          });
        }
        return undefined;
      },
    });
  },

  fieldClass: (field) => (field === 'status' ? 'status' : field === 'enteredInError' ? 'set_once' : null),
  fieldSchema: (field) => patientFieldSchema('problem', field),
  load: loadProblem,

  async write(tx, rec, field, value, version, meta) {
    let set;
    if (field === 'status') {
      const v = value as StatusValue;
      // A confirmation moves only the check date; status_changed_* say when the status last changed.
      // (Every expression reads the row as it was before this update.)
      set = tx`
        status_changed_at = case when status is distinct from ${v.status} then ${meta.at}::timestamptz
                                 else status_changed_at end,
        status_changed_by = case when status is distinct from ${v.status} then ${meta.by}::uuid
                                 else status_changed_by end,
        status = ${v.status}, status_encounter_id = ${v.encounterId}, status_checked_at = ${meta.at}`;
    } else {
      const { reason } = value as { reason: string };
      set = tx`error_reason = ${reason}, error_by = ${meta.by}, error_at = ${meta.at}`;
    }
    const rows = await tx<{ version: number }[]>`
      update sineobex.problems set ${set}, ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },

  // A status sent for an entry merged into another applies to the survivor (design 9.2, 9.4). A
  // retraction stays on the record it names.
  async redirect(tx, rec, field) {
    if (field !== 'status' || !rec.internal.mergedInto) return null;
    let to = rec;
    for (let hops = 0; to.internal.mergedInto && hops < 20; hops++) {
      to = (await loadProblem(tx, to.internal.mergedInto as string, true))!;
    }
    return { to, details: { redirectedTo: to.id } };
  },

  applyStatus,
  writeAction: (field) => (field === 'enteredInError' ? 'problem.entered_in_error' : null),
};
