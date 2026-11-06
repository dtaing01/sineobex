import type { TeamScope } from '../auth/context.ts';
import { findSearchHits } from './candidates.ts';
import { searchBirth, type SearchQuery } from './matching.ts';
import { normalizeName } from './normalize.ts';
import { loadSummaries, projectionFor, projectSummary } from './projection.ts';
import type { PatientSearchInput, PatientSearchResultValue } from './schemas.ts';

/** What a search was by, as the audit log and the phone's offline entries name it (D41: never the text). */
export type SearchCriterion = 'name' | 'birth_full' | 'birth_year';

/**
 * POST /v1/patients/search (phase 3 design 3.1, 5.2-5.4). Candidates from patient_candidates (or
 * patient_candidates_by_birth for a full birth date alone), scored in TypeScript, projected, cut at
 * the limit. Audited in the same transaction as `patient.searched {resultCount, patientIds,
 * criteria, surface}`; the search text never enters the audit log (D41).
 */
// PLAN-OPEN: search terms in the audit log (design 14.1, #9, for counsel). Never stored; if counsel
// wants them, a separate restricted column with its own retention, never `details`.
export async function searchPatients(
  scope: TeamScope,
  input: PatientSearchInput,
): Promise<PatientSearchResultValue> {
  const projection = projectionFor(scope.team.permissions, input.surface);
  const birth = input.birth ? searchBirth(input.birth) : null;
  const query: SearchQuery = { norm: input.name === undefined ? null : normalizeName(input.name), birth };
  const criteria: SearchCriterion[] = [];
  if (input.name !== undefined) criteria.push('name');
  if (birth) criteria.push(birth.precision === 'day' ? 'birth_full' : 'birth_year');
  // A name that normalizes to nothing ("!!!") finds nobody, unless a full birth date came with it.
  const searchable = query.norm !== null || birth?.precision === 'day';

  return scope.tx(async (tx, audit) => {
    const { hits, truncated } = searchable
      ? await findSearchHits(tx, query, { sources: projection.sources, limit: input.limit })
      : { hits: [], truncated: false };
    const summaries = await loadSummaries(
      tx,
      scope,
      hits.map((h) => h.canonicalId),
    );
    const shown = hits.flatMap((h) => {
      const summary = summaries.get(h.canonicalId);
      if (!summary) return [];
      return [
        {
          patientId: h.canonicalId,
          score: h.score,
          band: h.band,
          reasons: h.reasons,
          summary: projectSummary(scope, summary, input.surface),
        },
      ];
    });
    await audit({
      action: 'patient.searched',
      patientId: null,
      details: {
        resultCount: shown.length,
        patientIds: shown.map((h) => h.patientId),
        criteria,
        surface: input.surface,
      },
    });
    return { hits: shown, truncated };
  });
}
