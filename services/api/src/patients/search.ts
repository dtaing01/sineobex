import type { TeamScope } from '../auth/context.ts';
import { forbidden, type ApiError } from '../lib/errors.ts';
import { flagHidden, teamFlags } from '../sync/read-rules.ts';
import { findSearchHits } from './candidates.ts';
import { searchBirth, type SearchQuery } from './matching.ts';
import { normalizeName } from './normalize.ts';
import { currentFlagsOf, loadSummaries, projectionFor, projectSummary } from './projection.ts';
import type { PatientSearchInput, PatientSearchResultValue } from './schemas.ts';

/** What a search was by, as the audit log and the phone's offline entries name it (D41: never the text). */
export type SearchCriterion = 'name' | 'birth_full' | 'birth_year';

/**
 * POST /v1/patients/search (phase 3 design 3.1, 5.2-5.4). Candidates from patient_candidates (or
 * patient_candidates_by_birth for a full birth date alone), scored in TypeScript, projected, cut at
 * the limit. Audited in the same transaction as `patient.searched {resultCount, patientIds,
 * criteria, surface}`; the search text never enters the audit log (D41).
 *
 * `flagIds` (phase 5 design 7) keeps the hits carrying every flag named among their current flags,
 * as the reader may see them (currentFlagsOf), before the cut, so a narrowed search still fills its
 * limit; the event counts the flags (`flagCount`) and never names one. A flag the flag rule hides
 * from the caller, one the team does not hold among them, is refused before anything is searched:
 * 403, logged as access.denied without the flag, and no search event.
 */
// PLAN-OPEN: search terms in the audit log (design 14.1, #9, for counsel). Never stored; if counsel
// wants them, a separate restricted column with its own retention, never `details`.
export async function searchPatients(
  scope: TeamScope,
  input: PatientSearchInput,
  route: string,
): Promise<PatientSearchResultValue> {
  const projection = projectionFor(scope.team.permissions, input.surface);
  const birth = input.birth ? searchBirth(input.birth) : null;
  const query: SearchQuery = { norm: input.name === undefined ? null : normalizeName(input.name), birth };
  const criteria: SearchCriterion[] = [];
  if (input.name !== undefined) criteria.push('name');
  if (birth) criteria.push(birth.precision === 'day' ? 'birth_full' : 'birth_year');
  // A name that normalizes to nothing ("!!!") finds nobody, unless a full birth date came with it.
  const searchable = query.norm !== null || birth?.precision === 'day';
  const flagIds =
    input.flagIds === undefined ? null : [...new Set(input.flagIds.map((id) => id.toLowerCase()))];

  type Outcome = { answer: PatientSearchResultValue } | { refused: ApiError };
  const outcome = await scope.tx(async (tx, audit): Promise<Outcome> => {
    // The flags named, as the team holds them: each one the caller may see, by the flag rule.
    const named = flagIds === null ? null : { ids: flagIds, flags: await teamFlags(tx, scope.team.teamId) };
    if (named?.ids.some((id) => flagHidden(scope.team.permissions, named.flags.get(id) ?? null))) {
      await audit({ action: 'access.denied', details: { permission: 'patients.view_sensitive', route } });
      return { refused: forbidden('Your role can’t search by one of these flags.', 'flag_hidden') };
    }
    const found = searchable
      ? await findSearchHits(tx, query, {
          sources: projection.sources,
          limit: named ? Infinity : input.limit,
        })
      : { hits: [], truncated: false };
    let { hits, truncated } = found;
    if (named) {
      // Narrowed before the cut, so a search by flags still fills its limit.
      const current = await currentFlagsOf(
        tx,
        scope,
        hits.map((h) => h.canonicalId),
        named.flags,
      );
      const carrying = hits.filter((h) => {
        const held = current.get(h.canonicalId)!;
        return named.ids.every((id) => held.primary === id || held.secondary.includes(id));
      });
      hits = carrying.slice(0, input.limit);
      truncated = carrying.length > input.limit;
    }
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
        ...(named ? { flagCount: named.ids.length } : {}),
      },
    });
    return { answer: { hits: shown, truncated } };
  });
  if ('answer' in outcome) return outcome.answer;
  throw outcome.refused;
}
