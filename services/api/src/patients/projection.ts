import type { TeamScope } from '../auth/context.ts';
import type { Permission } from '../auth/permissions.ts';
import { notImplemented } from './pending.ts';
import type { PatientChartValue, PatientSummaryValue, SurfaceValue } from './schemas.ts';

/**
 * Minimum necessary as a function (phase 3 design 4.3, D33): every patient read goes through one
 * projection for the caller's role. A part the role can't see is absent, never null; sensitive
 * items are hidden, not counted; a sensitive problem the role can't see answers the same 404 as a
 * missing one. A role searches only by what it can see.
 */

/** Key sources in patient_name_keys a search may match. */
export type NameKeySource = 'legal' | 'preferred' | 'alias' | 'descriptor';

export interface Projection {
  /** Names the projection in responses and in the index version ("<counter>.<key>"). */
  key: string;
  /** mayViewProblems: titles, codes, statuses, status history and notes. */
  problems: boolean;
  /** patients.view_sensitive: sensitive problems (and, in phase 5, sensitive flags). */
  sensitive: boolean;
  /** patients.edit: ID link URLs (Show link, Copy). */
  idLinkUrls: boolean;
  /** False for result lists and the duplicate panel on the phone (D40). */
  legalName: boolean;
  /** patient_candidates' p_sources. */
  sources: readonly NameKeySource[];
}

/** The projection for a role's permissions on a surface. Pure. */
export function projectionFor(_permissions: ReadonlySet<Permission>, _surface: SurfaceValue): Projection {
  throw notImplemented();
}

/** Removes from a fully loaded chart what the caller's role may not see. */
export function projectChart(_scope: TeamScope, _chart: PatientChartValue): PatientChartValue {
  throw notImplemented();
}

/** Removes from a full summary what the caller's role may not see on that surface. */
export function projectSummary(
  _scope: TeamScope,
  _summary: PatientSummaryValue,
  _surface: SurfaceValue,
): PatientSummaryValue {
  throw notImplemented();
}
