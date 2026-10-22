import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type { FieldHistoryPageValue, HistoryQueryValue } from './schemas.ts';

/**
 * GET /v1/patients/{patientId}/history (phase 3 design 3.1, 11.7): every accepted write to the
 * group's records, old and new value, newest first, projected like the chart (problems need
 * mayViewProblems, sensitive ones patients.view_sensitive). Audited as `patient.history_viewed {field}`.
 */
export async function fieldHistory(
  _scope: TeamScope,
  _patientId: string,
  _query: HistoryQueryValue,
): Promise<FieldHistoryPageValue> {
  throw notImplemented();
}
