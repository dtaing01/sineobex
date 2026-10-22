import type { TeamScope } from '../auth/context.ts';
import { notImplemented } from './pending.ts';
import type { IdentityCorrectionInput, PatientChartValue } from './schemas.ts';

/**
 * POST /v1/patients/{patientId}/corrections (phase 3 design 3.2, 11.6): correct a legal name or
 * birth date with a reason, or record a declined HIPAA §164.526 amendment request with the chart
 * unchanged. One transaction, team lock first: check baseVersion (409 field_changed {field,
 * version}, no value), write the field (history `corrected`), a patient_corrections row, close any
 * open review on the field, re-run matching ('correction'). Audited as `patient.identity_corrected
 * {field, version, correctionId, requestedByPatient}` or `patient.amendment_declined {field, correctionId}`.
 */
export async function correctIdentity(
  _scope: TeamScope,
  _patientId: string,
  _input: IdentityCorrectionInput,
): Promise<PatientChartValue> {
  throw notImplemented();
}
