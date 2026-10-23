import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
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
 */

/**
 * GET /v1/team/problem-reversals: open requests, the original's history beside the new entry.
 * Audited as `problem.reversals_viewed {count}` and `patient.viewed {source: 'reversal_queue'}`.
 */
export async function listReversals(
  _scope: TeamScope,
  _query: PageQueryValue,
): Promise<ReversalRequestPageValue> {
  throw notImplemented();
}

/**
 * POST /v1/problems/{problemId}/reverse: Resolved back to Ongoing (history `entered_in_error`, a
 * patient_corrections row, the request marked reversed, a notice to the requester), then the merge
 * offer. Audited as `problem.reversed {historyId, correctionId}`.
 */
export async function reverseResolved(
  _scope: TeamScope,
  _problemId: string,
  _input: ReverseResolvedInput,
): Promise<ReverseResolvedResultValue> {
  throw notImplemented();
}

/**
 * POST /v1/team/problem-reversals/{problemId}/decline: the request stays a separate problem.
 * Audited as `problem.reversal_declined {correctionId}`.
 */
export async function declineReversal(
  _scope: TeamScope,
  _problemId: string,
  _input: DeclineReversalInput,
): Promise<ProblemViewValue> {
  throw notImplemented();
}

/**
 * POST /v1/problems/{problemId}/merge: the entry is absorbed into another (merged_into); its history
 * and notes show in the survivor's timeline. Audited as `problem.merged {mergedId, intoId}`.
 */
export async function mergeProblems(
  _scope: TeamScope,
  _problemId: string,
  _input: MergeProblemsInput,
): Promise<ProblemViewValue> {
  throw notImplemented();
}
