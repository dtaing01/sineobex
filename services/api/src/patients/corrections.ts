import type { TeamScope } from '../auth/context.ts';
import { conflict, invalid, notFound } from '../lib/errors.ts';
import { sha256Hex } from '../sync/canonical.ts';
import { birthProblem } from '../sync/entities/values.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { jsonb, sameValue } from '../sync/records.ts';
import { loadChart } from './charts.ts';
import {
  appendPatientHistory,
  loadPatientRecord,
  patientFieldState,
  rematchAfter,
  writePatientField,
} from './field-reviews.ts';
import type { IdentityCorrectionInput, PatientChartValue } from './schemas.ts';

/** The value as sync carries it: a birth holds a date or a year, never both. */
function syncValue(input: IdentityCorrectionInput): Record<string, unknown> {
  const v = input.value as Record<string, unknown>;
  if (input.field === 'legalName') return { given: v.given, family: v.family };
  return v.precision === 'day'
    ? { precision: 'day', date: v.date }
    : { precision: v.precision, year: v.year };
}

/**
 * POST /v1/patients/{patientId}/corrections (phase 3 design 3.2, 11.6): correct a legal name or
 * birth date with a reason, or record a declined HIPAA §164.526 amendment request with the chart
 * unchanged. One transaction, team lock first: check baseVersion (409 field_changed {field,
 * version}, no value), write the field (history `corrected`), a patient_corrections row, close any
 * open review on the field, re-run matching ('correction'). Audited as `patient.identity_corrected
 * {field, version, correctionId, requestedByPatient}` or `patient.amendment_declined {field, correctionId}`.
 *
 * A merged ID corrects the chart that is kept, as the portal shows it.
 */
export async function correctIdentity(
  scope: TeamScope,
  patientId: string,
  input: IdentityCorrectionInput,
): Promise<PatientChartValue> {
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, scope.team.teamId);
    const named = await loadPatientRecord(tx, patientId, false);
    if (!named) throw notFound('patient');
    const rec = await loadPatientRecord(tx, named.canonicalId, true);
    if (!rec) throw notFound('patient');
    const field = input.field;
    const current = patientFieldState(rec, field);
    if (input.baseVersion !== current.version) {
      throw conflict('field_changed', 'This field changed since you opened the chart. Look again.', {
        field,
        version: current.version,
      });
    }
    const value = syncValue(input);
    const now = scope.deps.now();
    // A request is recorded as the patient made it; only a value written to the chart is checked.
    const problem =
      field === 'birth' && input.outcome === 'corrected'
        ? birthProblem(value as never, now.toISOString().slice(0, 10))
        : null;
    if (problem) throw invalid(problem, 'That birth date is in the future.');
    const admin = scope.principal.userId;
    const reasonSha256 = await sha256Hex(input.reason);

    if (input.outcome === 'declined') {
      // The request and the decision are kept; the chart is not touched.
      const [row] = await tx<{ id: string }[]>`
        insert into sineobex.patient_corrections
          (team_id, patient_id, kind, entity, record_id, field, old_value, new_value, reason,
           requested_by_patient, decided_by, decided_at)
        values (${rec.teamId}, ${rec.id}, 'amendment_declined', 'patient', ${rec.id}, ${field},
                ${jsonb(tx, current.value)}, ${jsonb(tx, value)}, ${input.reason}, true, ${admin}, ${now})
        returning id`;
      await audit({
        action: 'patient.amendment_declined',
        entity: 'patient',
        entityId: rec.id,
        patientId: rec.id,
        details: { field, version: current.version, correctionId: row!.id, commentSha256: reasonSha256 },
      });
    } else if (sameValue(current.value, value)) {
      // Already the chart's value: nothing to correct, and the chart is shown as it is.
      await audit({ action: 'patient.viewed', patientId: rec.id, details: { source: 'correction' } });
    } else {
      const version = current.version + 1;
      await writePatientField(tx, rec, field, value, version, {
        by: admin,
        at: now.toISOString(),
        changeId: null,
      });
      const historyId = await appendPatientHistory(tx, {
        teamId: rec.teamId,
        recordId: rec.id,
        field,
        version,
        value,
        previousValue: current.value,
        kind: 'corrected',
        changedBy: admin,
        approvedBy: admin,
      });
      const [row] = await tx<{ id: string }[]>`
        insert into sineobex.patient_corrections
          (team_id, patient_id, kind, entity, record_id, field, old_value, new_value, reason,
           requested_by_patient, history_id, decided_by, decided_at)
        values (${rec.teamId}, ${rec.id}, 'identity', 'patient', ${rec.id}, ${field}, ${jsonb(tx, current.value)},
                ${jsonb(tx, value)}, ${input.reason}, ${input.requestedByPatient}, ${historyId}::bigint, ${admin},
                ${now})
        returning id`;
      const correctionId = row!.id;
      // The correction answers any open review of the field: its alternates stay in history.
      await tx`
        update sineobex.field_reviews
        set status = 'decided', decided_at = ${now}, decided_by = ${admin},
            decision = ${jsonb(tx, { kept: 'corrected', correctionId })}
        where team_id = ${rec.teamId} and entity = 'patient' and record_id = ${rec.id} and field = ${field}
          and status = 'open'`;
      await rematchAfter(tx, audit, rec, field);
      await audit({
        action: 'patient.identity_corrected',
        entity: 'patient',
        entityId: rec.id,
        patientId: rec.id,
        details: {
          field,
          version,
          correctionId,
          requestedByPatient: input.requestedByPatient,
          commentSha256: reasonSha256,
        },
      });
    }
    const chart = await loadChart(tx, scope, rec.id);
    if (!chart) throw notFound('patient');
    return chart;
  });
}
