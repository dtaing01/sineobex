import type { TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { notImplemented } from './pending.ts';
import type { ChartBundleValue, FetchChartsInput, PatientChartValue } from './schemas.ts';

/**
 * Charts: one patient's group, read through canonical_id (phase 3 design 3.1, D27).
 *
 * A merge moves nothing, so a chart is every row whose patient has this canonical_id. A child table
 * read by `patient_id = $1` would show half a merged chart, so every table with a patient_id column
 * is listed here with how a chart reads it, and a schema test fails until a new one is registered.
 */
export const CHART_TABLES: Readonly<Record<string, 'group' | 'not_chart'>> = {
  patient_aliases: 'group',
  patient_allergies: 'group',
  patient_consents: 'group',
  patient_id_links: 'group',
  field_reviews: 'group',
  patient_corrections: 'group',
  problems: 'group',
  // Phase 4 lists a group's recent encounters; phase 2 rows may name patients that never existed.
  encounters: 'group',
  // Search keys: retrieval groups them by canonical_id (patient_candidates), never a chart.
  patient_name_keys: 'not_chart',
  // The access report reads it by patient_id and details.patientIds.
  audit_events: 'not_chart',
};

/**
 * GET /v1/patients/{patientId}: the projected chart of the patient's group. A merged ID answers the
 * survivor's chart with `redirectedFrom`. Audited as `patient.viewed {source}` with the canonical ID.
 */
export async function getChart(_scope: TeamScope, _patientId: string): Promise<PatientChartValue> {
  throw notImplemented();
}

/**
 * POST /v1/patients/charts: charts for the phone's cache, with every live redirect into or out of
 * the requested IDs and the returned groups. One `patient.viewed {source: 'cache', reason}` per chart.
 */
export async function fetchCharts(_scope: TeamScope, _input: FetchChartsInput): Promise<ChartBundleValue> {
  throw notImplemented();
}

/**
 * The projected chart of a patient's group inside the caller's transaction, without auditing (the
 * caller audits what it shows, as the duplicate pair page does). Null when the team has no such patient.
 */
export async function loadChart(
  _tx: Tx,
  _scope: TeamScope,
  _patientId: string,
): Promise<PatientChartValue | null> {
  throw notImplemented();
}
