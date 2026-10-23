import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type { PatientMatchInput, PatientMatchResultValue } from './schemas.ts';

/**
 * POST /v1/patients/match (phase 3 design 3.1, 8.1): the intake's duplicate check before saving.
 * At most MATCH_LIMIT candidates at or above MATCH_POSSIBLE, canonical patients only, the
 * excluded patient's own group left out. Audited as `patient.match_checked {checkId, patientIds}`.
 */
export async function matchPatients(
  _scope: TeamScope,
  _input: PatientMatchInput,
): Promise<PatientMatchResultValue> {
  throw notImplemented();
}
