import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type { PatientSearchInput, PatientSearchResultValue } from './schemas.ts';

/**
 * POST /v1/patients/search (phase 3 design 3.1, 5.2-5.4). Candidates from patient_candidates (or
 * patient_candidates_by_birth for a full birth date alone), scored in TypeScript, projected, cut at
 * the limit. Audited in the same transaction as `patient.searched {resultCount, patientIds,
 * criteria, surface}`; the search text never enters the audit log (D41).
 */
export async function searchPatients(
  _scope: TeamScope,
  _input: PatientSearchInput,
): Promise<PatientSearchResultValue> {
  throw notImplemented();
}
