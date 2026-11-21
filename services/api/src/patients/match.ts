import { randomUUID } from 'node:crypto';
import type { TeamScope } from '../auth/context.ts';
import { findMatches, suppressedCanonicals } from './candidates.ts';
import { matchSubject, type BirthValue } from './matching.ts';
import { loadSummaries, projectionFor, projectSummary } from './projection.ts';
import type { PatientMatchInput, PatientMatchResultValue } from './schemas.ts';

const birthValue = (b: NonNullable<PatientMatchInput['birth']>): BirthValue =>
  b.precision === 'day' ? { precision: 'day', date: b.date! } : { precision: b.precision, year: b.year! };

/**
 * POST /v1/patients/match (phase 3 design 3.1, 8.1): the intake's duplicate check before saving.
 * At most MATCH_LIMIT candidates at or above MATCH_POSSIBLE, canonical patients only, the
 * excluded patient's own group left out. Audited as `patient.match_checked {checkId, patientIds}`.
 *
 * It sees legal names, sound-alikes and patients the phone's index doesn't hold yet; on the phone a
 * candidate never carries a legal name (D40). Editing a patient leaves out its own group and the
 * patients a person decided are someone else (design 8.6).
 */
export async function matchPatients(
  scope: TeamScope,
  input: PatientMatchInput,
): Promise<PatientMatchResultValue> {
  const projection = projectionFor(scope.team.permissions, input.surface);
  const subject = matchSubject({
    preferredName: input.preferredName ?? null,
    legalName: input.legalName ?? null,
    aliases: input.aliases ?? [],
    birth: input.birth ? birthValue(input.birth) : null,
  });
  const checkId = randomUUID();

  return scope.tx(async (tx, audit) => {
    const exclude = new Set<string>();
    if (input.excludePatientId) {
      const [own] = await tx<{ canonicalId: string }[]>`
        select canonical_id from sineobex.patients
        where team_id = sineobex.current_team_id() and id = ${input.excludePatientId}`;
      if (own) {
        exclude.add(own.canonicalId);
        for (const id of await suppressedCanonicals(tx, own.canonicalId)) exclude.add(id);
      }
    }
    const found = await findMatches(tx, subject, { sources: projection.sources, exclude });
    const summaries = await loadSummaries(
      tx,
      scope,
      found.map((f) => f.canonicalId),
    );
    const candidates = found.flatMap((f) => {
      const summary = summaries.get(f.canonicalId);
      if (!summary) return [];
      return [
        {
          patientId: f.canonicalId,
          score: f.score,
          band: f.band,
          reasons: f.reasons,
          summary: projectSummary(scope, summary, input.surface),
        },
      ];
    });
    await audit({
      action: 'patient.match_checked',
      patientId: null,
      details: { checkId, patientIds: candidates.map((c) => c.patientId), surface: input.surface },
    });
    return { checkId, candidates };
  });
}
