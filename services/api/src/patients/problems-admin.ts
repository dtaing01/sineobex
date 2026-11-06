import type { TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { conflict, invalid, notFound } from '../lib/errors.ts';
import { sha256Hex } from '../sync/canonical.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { jsonb } from '../sync/records.ts';
import { loadSummaries, projectSummary } from './projection.ts';
import type {
  DeclineReversalInput,
  MergeProblemsInput,
  PageQueryValue,
  ProblemViewValue,
  ReversalRequestPageValue,
  ReverseResolvedInput,
  ReverseResolvedResultValue,
} from './schemas.ts';

/**
 * Problems marked Resolved by mistake, and what an admin does about them (phase 3 design 3.3, 9.4).
 * Everything else about problems travels by sync.
 *
 * Only patients.reverse_resolved moves a problem out of Resolved (D36). A worker who disagrees adds
 * a new entry linked `resolvedInErrorOf`, which is the request; the admin reverses the original (a
 * history row of kind `entered_in_error` and a patient_corrections row with the reason) or declines,
 * and is then offered to merge the new entry into the original. Nothing is deleted.
 */

/** Requests per page. */
export const REVERSAL_PAGE_SIZE = 50;

interface ProblemRow {
  id: string;
  teamId: string;
  patientId: string;
  canonicalId: string;
  title: string;
  code: string | null;
  codeDisplay: string | null;
  status: 'new' | 'ongoing' | 'resolved';
  statusEncounterId: string | null;
  statusChangedAt: Date;
  sensitive: boolean;
  recurrenceOf: string | null;
  resolvedInErrorOf: string | null;
  reversalRequest: 'open' | 'reversed' | 'declined' | null;
  mergedInto: string | null;
  errorReason: string | null;
  errorBy: string | null;
  errorByName: string | null;
  errorAt: Date | null;
  fieldVersions: Record<string, number>;
  createdAt: Date;
  authorUserId: string;
  authorName: string;
}

const problemColumns = (tx: Tx) => tx`
  pr.id, pr.team_id, pr.patient_id, p.canonical_id, pr.title, pr.code, pr.code_display, pr.status,
  pr.status_encounter_id, pr.status_changed_at, pr.sensitive, pr.recurrence_of, pr.resolved_in_error_of,
  pr.reversal_request, pr.merged_into, pr.error_reason, pr.error_by, eu.display_name as error_by_name,
  pr.error_at, pr.field_versions, pr.created_at, pr.author_user_id, au.display_name as author_name`;

const problemJoins = (tx: Tx) => tx`
  join sineobex.patients p on p.team_id = pr.team_id and p.id = pr.patient_id
  join sineobex.users au on au.id = pr.author_user_id
  left join sineobex.users eu on eu.id = pr.error_by`;

/**
 * One problem the caller may see, or 404: a sensitive problem the role can't see answers exactly
 * like a missing one (design 4.3). `lock` takes the row for the decision.
 */
async function loadProblem(tx: Tx, scope: TeamScope, id: string, lock: boolean): Promise<ProblemRow> {
  const [row] = await tx<ProblemRow[]>`
    select ${problemColumns(tx)} from sineobex.problems pr ${problemJoins(tx)}
    where pr.id = ${id} ${lock ? tx`for update of pr` : tx``}`;
  if (!row || (row.sensitive && !scope.can('patients.view_sensitive'))) throw notFound('problem');
  return row;
}

/**
 * Problems as the portal shows them. An entry another was merged into reads as the union: the
 * merged entries' status history and notes are listed with it, each naming its own problem.
 */
async function problemViews(tx: Tx, scope: TeamScope, rows: ProblemRow[]): Promise<ProblemViewValue[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sensitive = scope.can('patients.view_sensitive');
  const absorbed = await tx<{ id: string; mergedInto: string }[]>`
    select id, merged_into from sineobex.problems
    where merged_into = any(${ids}::uuid[]) ${sensitive ? tx`` : tx`and not sensitive`}`;
  const all = [...ids, ...absorbed.map((a) => a.id)];
  const history = await tx<
    {
      historyId: string;
      recordId: string;
      value: { status: 'new' | 'ongoing' | 'resolved'; encounterId: string | null } | null;
      kind: ProblemViewValue['statusHistory'][number]['kind'];
      changedBy: string;
      displayName: string;
      at: Date;
    }[]
  >`
    select h.id::text as history_id, h.record_id, h.value, h.kind, h.changed_by, u.display_name,
           coalesce(h.device_time, h.recorded_at) as at
    from sineobex.field_history h join sineobex.users u on u.id = h.changed_by
    where h.entity = 'problem' and h.field = 'status' and h.record_id = any(${all}::uuid[])
    order by coalesce(h.device_time, h.recorded_at), h.id`;
  const notes = await tx<
    {
      id: string;
      problemId: string;
      text: string;
      encounterId: string | null;
      writtenAt: Date;
      authorUserId: string;
      displayName: string;
    }[]
  >`
    select n.id, n.problem_id, n.text, n.encounter_id, n.written_at, n.author_user_id, u.display_name
    from sineobex.problem_notes n join sineobex.users u on u.id = n.author_user_id
    where n.problem_id = any(${all}::uuid[])
    order by n.written_at desc, n.id`;
  return rows.map((r) => {
    const mine = new Set([r.id, ...absorbed.filter((a) => a.mergedInto === r.id).map((a) => a.id)]);
    return {
      id: r.id,
      patientId: r.canonicalId,
      title: r.title,
      code: r.code,
      codeDisplay: r.codeDisplay,
      status: r.status,
      sensitive: r.sensitive,
      statusHistory: history
        .filter((h) => mine.has(h.recordId) && h.value !== null)
        .map((h) => ({
          historyId: h.historyId,
          problemId: h.recordId,
          status: h.value!.status,
          encounterId: h.value!.encounterId ?? null,
          by: { userId: h.changedBy, displayName: h.displayName },
          at: h.at.toISOString(),
          kind: h.kind,
        })),
      notes: notes
        .filter((n) => mine.has(n.problemId))
        .map((n) => ({
          id: n.id,
          problemId: n.problemId,
          text: n.text,
          encounterId: n.encounterId,
          writtenAt: n.writtenAt.toISOString(),
          author: { userId: n.authorUserId, displayName: n.displayName },
        })),
      recurrenceOf: r.recurrenceOf,
      resolvedInErrorOf: r.resolvedInErrorOf,
      reversalRequest: r.reversalRequest,
      mergedInto: r.mergedInto,
      enteredInError:
        r.errorReason !== null && r.errorAt !== null
          ? {
              reason: r.errorReason,
              by: { userId: r.errorBy ?? r.authorUserId, displayName: r.errorByName ?? '' },
              at: r.errorAt.toISOString(),
            }
          : null,
      createdAt: r.createdAt.toISOString(),
      author: { userId: r.authorUserId, displayName: r.authorName },
    };
  });
}

const viewOf = async (tx: Tx, scope: TeamScope, row: ProblemRow) =>
  (await problemViews(tx, scope, [row]))[0]!;

/** The requester hears the decision: kind, entity and problem ID only. */
async function noticeRequester(tx: Tx, request: { teamId: string; authorUserId: string; id: string }) {
  await tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
    values (${request.teamId}, ${request.authorUserId}, 'problem_reversal_decided', 'problem', ${request.id})`;
}

/**
 * GET /v1/team/problem-reversals: open requests, oldest first, the original's history beside the
 * new entry. Audited as `problem.reversals_viewed {count}` and `patient.viewed {source:
 * 'reversal_queue'}` per patient.
 */
export async function listReversals(
  scope: TeamScope,
  query: PageQueryValue,
): Promise<ReversalRequestPageValue> {
  const sensitive = scope.can('patients.view_sensitive');
  return scope.tx(async (tx, audit) => {
    // Sensitive requests are hidden, not counted, from a role that can't see them. A request since
    // marked entered in error asks for nothing.
    const requests = await tx<ProblemRow[]>`
      select ${problemColumns(tx)} from sineobex.problems pr ${problemJoins(tx)}
      join sineobex.problems o on o.team_id = pr.team_id and o.id = pr.resolved_in_error_of
      where pr.team_id = ${scope.team.teamId} and pr.reversal_request = 'open'
        and pr.error_reason is null and pr.merged_into is null
        ${sensitive ? tx`` : tx`and not pr.sensitive and not o.sensitive`}
        ${
          query.afterId
            ? tx`and (pr.created_at, pr.id) > (
                select a.created_at, a.id from sineobex.problems a where a.id = ${query.afterId})`
            : tx``
        }
      order by pr.created_at, pr.id
      limit ${REVERSAL_PAGE_SIZE + 1}`;
    const page = requests.slice(0, REVERSAL_PAGE_SIZE);
    const originals = page.length
      ? await tx<ProblemRow[]>`
          select ${problemColumns(tx)} from sineobex.problems pr ${problemJoins(tx)}
          where pr.id = any(${page.map((r) => r.resolvedInErrorOf!)}::uuid[])`
      : [];
    const views = await problemViews(tx, scope, [...page, ...originals]);
    const byId = new Map(views.map((v) => [v.id, v]));
    const patientIds = [...new Set(page.map((r) => r.canonicalId))];
    const summaries = await loadSummaries(tx, scope, patientIds);

    await audit({ action: 'problem.reversals_viewed', details: { count: page.length } });
    for (const patientId of patientIds) {
      await audit({ action: 'patient.viewed', patientId, details: { source: 'reversal_queue' } });
    }
    return {
      requests: page.map((r) => ({
        request: byId.get(r.id)!,
        original: byId.get(r.resolvedInErrorOf!)!,
        patientId: r.canonicalId,
        patient: projectSummary(scope, summaries.get(r.canonicalId) ?? {}, 'portal'),
        requestedBy: { userId: r.authorUserId, displayName: r.authorName },
        requestedAt: r.createdAt.toISOString(),
      })),
      nextAfterId: requests.length > page.length ? page.at(-1)!.id : null,
    };
  });
}

/**
 * POST /v1/problems/{problemId}/reverse: Resolved back to Ongoing (history `entered_in_error`, a
 * patient_corrections row, the request marked reversed, a notice to the requester), then the merge
 * offer. Audited as `problem.reversed {historyId, correctionId}`.
 *
 * Without a `requestProblemId` (a reversal from the patient page) every open request for the
 * problem is answered too: none is left in the queue for a problem that is no longer Resolved.
 */
export async function reverseResolved(
  scope: TeamScope,
  problemId: string,
  input: ReverseResolvedInput,
): Promise<ReverseResolvedResultValue> {
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, scope.team.teamId);
    const problem = await loadProblem(tx, scope, problemId, true);
    if (problem.mergedInto) throw conflict('problem_merged', 'This entry was merged into another.');
    if (problem.errorReason) throw conflict('entered_in_error', 'This problem was marked entered in error.');
    if (problem.status !== 'resolved') {
      throw conflict('not_resolved', 'This problem isn’t Resolved any more.', {
        version: problem.fieldVersions.status ?? 0,
      });
    }
    const requests = await tx<{ id: string; teamId: string; authorUserId: string }[]>`
      select id, team_id, author_user_id from sineobex.problems
      where team_id = ${problem.teamId} and resolved_in_error_of = ${problem.id} and reversal_request = 'open'
        ${input.requestProblemId ? tx`and id = ${input.requestProblemId}` : tx``}
      for update`;
    if (input.requestProblemId && requests.length === 0) {
      throw invalid('not_a_request', 'That entry isn’t an open request to reverse this problem.');
    }

    const admin = scope.principal.userId;
    const now = scope.deps.now();
    const before = { status: problem.status, encounterId: problem.statusEncounterId };
    const after = { status: 'ongoing', encounterId: null };
    const version = (problem.fieldVersions.status ?? 0) + 1;
    await tx`
      update sineobex.problems
      set status = 'ongoing', status_encounter_id = null, status_changed_at = ${now},
          status_changed_by = ${admin}, status_checked_at = ${now},
          field_versions = field_versions || jsonb_build_object('status', ${version}::int),
          field_meta = field_meta || jsonb_build_object('status', ${jsonb(tx, {
            by: admin,
            at: now.toISOString(),
            changeId: null,
          })}),
          version = version + 1
      where id = ${problem.id}`;
    const [history] = await tx<{ id: string }[]>`
      insert into sineobex.field_history
        (team_id, entity, record_id, field, version, value, previous_value, kind, changed_by, approved_by)
      values (${problem.teamId}, 'problem', ${problem.id}, 'status', ${version}, ${jsonb(tx, after)},
              ${jsonb(tx, before)}, 'entered_in_error', ${admin}, ${admin})
      returning id::text as id`;
    const [correction] = await tx<{ id: string }[]>`
      insert into sineobex.patient_corrections
        (team_id, patient_id, kind, entity, record_id, field, old_value, new_value, reason, history_id,
         decided_by, decided_at)
      values (${problem.teamId}, ${problem.patientId}, 'problem_reversal', 'problem', ${problem.id}, 'status',
              ${jsonb(tx, before)}, ${jsonb(tx, after)}, ${input.reason}, ${history!.id}::bigint, ${admin}, ${now})
      returning id`;
    if (requests.length > 0) {
      await tx`update sineobex.problems set reversal_request = 'reversed'
               where id = any(${requests.map((r) => r.id)}::uuid[])`;
      for (const r of requests) await noticeRequester(tx, r);
    }
    await audit({
      action: 'problem.reversed',
      entity: 'problem',
      entityId: problem.id,
      patientId: problem.patientId,
      details: {
        historyId: history!.id,
        correctionId: correction!.id,
        version,
        requestIds: requests.map((r) => r.id),
        commentSha256: await sha256Hex(input.reason),
      },
    });

    // The merge offer: this patient's New and Ongoing entries that stand in for the original (the
    // requests first), or that were added since it was resolved with the same code or title.
    const candidates = await tx<ProblemRow[]>`
      select ${problemColumns(tx)} from sineobex.problems pr ${problemJoins(tx)}
      where pr.team_id = ${problem.teamId} and p.canonical_id = ${problem.canonicalId}
        and pr.id <> ${problem.id} and pr.status in ('new', 'ongoing')
        and pr.merged_into is null and pr.error_reason is null
        ${scope.can('patients.view_sensitive') ? tx`` : tx`and not pr.sensitive`}
        and (pr.resolved_in_error_of = ${problem.id}
             or (pr.created_at >= ${problem.statusChangedAt}
                 and ((pr.code is not null and pr.code = ${problem.code})
                      or sineobex.normalize_name(pr.title) = sineobex.normalize_name(${problem.title}))))
      order by (pr.resolved_in_error_of = ${problem.id}) is not true, pr.created_at, pr.id
      limit 20`;
    const reversed = await loadProblem(tx, scope, problem.id, false);
    return {
      problem: await viewOf(tx, scope, reversed),
      mergeCandidates: await problemViews(tx, scope, candidates),
    };
  });
}

/**
 * POST /v1/team/problem-reversals/{problemId}/decline: the request stays a separate problem.
 * Audited as `problem.reversal_declined {correctionId}`.
 */
export async function declineReversal(
  scope: TeamScope,
  problemId: string,
  input: DeclineReversalInput,
): Promise<ProblemViewValue> {
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, scope.team.teamId);
    const request = await loadProblem(tx, scope, problemId, true);
    if (request.reversalRequest === null) throw notFound('request');
    if (request.reversalRequest !== 'open') {
      throw conflict('already_decided', 'This request was already decided.');
    }
    const admin = scope.principal.userId;
    await tx`update sineobex.problems set reversal_request = 'declined' where id = ${request.id}`;
    const [correction] = await tx<{ id: string }[]>`
      insert into sineobex.patient_corrections
        (team_id, patient_id, kind, entity, record_id, reason, decided_by, decided_at)
      values (${request.teamId}, ${request.patientId}, 'reversal_declined', 'problem', ${request.id},
              ${input.reason}, ${admin}, ${scope.deps.now()})
      returning id`;
    await noticeRequester(tx, request);
    await audit({
      action: 'problem.reversal_declined',
      entity: 'problem',
      entityId: request.id,
      patientId: request.patientId,
      details: {
        correctionId: correction!.id,
        originalId: request.resolvedInErrorOf,
        commentSha256: await sha256Hex(input.reason),
      },
    });
    return viewOf(tx, scope, { ...request, reversalRequest: 'declined' });
  });
}

/**
 * POST /v1/problems/{problemId}/merge: the entry is absorbed into another (merged_into); its history
 * and notes show in the survivor's timeline. Audited as `problem.merged {mergedId, intoId}`.
 */
// PLAN-OPEN: no undo for a problem merge in phase 3 (design 9.4); the rows are never lost.
export async function mergeProblems(
  scope: TeamScope,
  problemId: string,
  input: MergeProblemsInput,
): Promise<ProblemViewValue> {
  if (problemId.toLowerCase() === input.intoProblemId.toLowerCase()) {
    throw invalid('same_problem', 'Choose another entry to merge this one into.');
  }
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, scope.team.teamId);
    const absorbed = await loadProblem(tx, scope, problemId, true);
    const into = await loadProblem(tx, scope, input.intoProblemId, true);
    if (absorbed.canonicalId !== into.canonicalId) {
      throw conflict('different_patient', 'These entries belong to different patients.');
    }
    if (absorbed.mergedInto || into.mergedInto) {
      throw conflict('problem_merged', 'One of these entries was already merged.');
    }
    if (absorbed.errorReason || into.errorReason) {
      throw conflict('entered_in_error', 'One of these entries was marked entered in error.');
    }
    // An open request is answered first: reverse the original, or decline.
    if (absorbed.reversalRequest === 'open') {
      throw conflict('reversal_open', 'Reverse or decline this request before merging it.');
    }
    // Entries already merged into this one move with it, so every merged entry points at an entry
    // that is still on the list (a late status change follows merged_into once, design 9.2).
    const moved = await tx<{ id: string }[]>`
      update sineobex.problems set merged_into = ${into.id}
      where team_id = ${absorbed.teamId} and merged_into = ${absorbed.id} returning id`;
    await tx`update sineobex.problems set merged_into = ${into.id} where id = ${absorbed.id}`;
    // The comment is kept with the other reasons (0014), on the absorbed entry's `mergedInto`.
    const [correction] = await tx<{ id: string }[]>`
      insert into sineobex.patient_corrections
        (team_id, patient_id, kind, entity, record_id, field, old_value, new_value, reason, decided_by, decided_at)
      values (${absorbed.teamId}, ${absorbed.patientId}, 'problem_merge', 'problem', ${absorbed.id},
              'mergedInto', null, ${jsonb(tx, { intoProblemId: into.id })}, ${input.comment},
              ${scope.principal.userId}, ${scope.deps.now()})
      returning id`;
    await audit({
      action: 'problem.merged',
      entity: 'problem',
      entityId: absorbed.id,
      patientId: absorbed.patientId,
      details: {
        mergedId: absorbed.id,
        intoId: into.id,
        correctionId: correction!.id,
        ...(moved.length ? { movedIds: moved.map((m) => m.id) } : {}),
        commentSha256: await sha256Hex(input.comment),
      },
    });
    return viewOf(tx, scope, into);
  });
}
