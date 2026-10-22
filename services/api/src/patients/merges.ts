import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type { MergePageValue, PageQueryValue, UndoMergeInput, UndoMergeResultValue } from './schemas.ts';

/**
 * GET /v1/team/merges: recent merges, newest first. `undoable` only for a caller with
 * patients.correct_identity. Audited as `merges.viewed {count, patientIds}` with both patients of
 * every listed merge (D33).
 */
export async function listMerges(_scope: TeamScope, _query: PageQueryValue): Promise<MergePageValue> {
  throw notImplemented();
}

/**
 * POST /v1/team/merges/{mergeId}/undo (phase 3 design 8.5): an identity correction, so
 * patients.correct_identity with a recent sign-in. Refused with 409 undo_later_merge_first while a
 * later live merge involves the survivor's group. Each record gets its own ID links back (D39).
 */
export async function undoMerge(
  _scope: TeamScope,
  _mergeId: string,
  _input: UndoMergeInput,
): Promise<UndoMergeResultValue> {
  throw notImplemented();
}
