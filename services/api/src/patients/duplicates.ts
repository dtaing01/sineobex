import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { findMatches, loadMatchSubject, suppressedCanonicals } from './candidates.ts';
import { canonicalOf } from './charts.ts';
import { CANDIDATE_LIMIT, QUEUE_THRESHOLD } from './match-constants.ts';
import { notImplemented } from './pending.ts';
import type {
  DecideDuplicateInput,
  DuplicateDecisionResultValue,
  DuplicatePageValue,
  DuplicatePairDetailValue,
  DuplicatePairSummaryValue,
  DuplicateQueryValue,
  FlagDuplicateInput,
} from './schemas.ts';

/** Why a patient is matched again (duplicate_pairs.sources). */
export type RematchSource = 'sync' | 'edit' | 'merge_rematch' | 'correction';

export interface RematchOptions {
  /** Patients the creator was shown at intake (matchCheck.shown). */
  shown?: readonly string[];
  /** Patients the creator dismissed as "Not them" (matchCheck.dismissed): marked creator_dismissed. */
  dismissed?: readonly string[];
}

export interface RematchResult {
  /** Pairs inserted, or refreshed while open or not sure, with the other canonical patient. */
  flagged: { pairId: string; otherId: string; score: number; created: boolean }[];
  /** A pair was flagged against a patient the creator was not shown (receipt details.possibleDuplicate). */
  possibleDuplicate: boolean;
}

/** Every candidate at or above QUEUE_THRESHOLD is queued, not only the few the intake panel shows. */
const REMATCH_LIMIT = CANDIDATE_LIMIT;

/**
 * The server's re-run of matching (phase 3 design 8.2), inside the caller's transaction with the
 * team lock already held (lockTeamWrites): every accepted patient create ('sync'), every accepted
 * change to preferredName, legalName, birth or an alias ('edit'), every correction and identity
 * review decision ('correction'), and for the survivor after a merge ('merge_rematch'). Skips the
 * patient's own group and suppressed pairs, upserts every candidate at or above QUEUE_THRESHOLD and
 * audits `duplicate.flagged {pairId, score, sources}` with both IDs in details.patientIds.
 *
 * It takes no lock of its own (D32): pair rows are only written under the team lock, which the
 * caller holds. A patient the team doesn't have, or one with no name to match, flags nothing.
 * Refreshing an open or not-sure pair keeps the higher score, adds the source and moves
 * last_flagged_at; a decided pair is left alone. A creator's "Not them" never suppresses a pair.
 */
export async function rematchPatient(
  tx: Tx,
  audit: AuditFn,
  patientId: string,
  source: RematchSource,
  options: RematchOptions = {},
): Promise<RematchResult> {
  const none: RematchResult = { flagged: [], possibleDuplicate: false };
  const [own] = await tx<{ teamId: string; canonicalId: string }[]>`
    select team_id, canonical_id from sineobex.patients
    where team_id = sineobex.current_team_id() and id = ${patientId}`;
  if (!own) return none;
  const self = own.canonicalId;
  const subject = await loadMatchSubject(tx, self);
  if (!subject || subject.names.length === 0) return none;
  const exclude = await suppressedCanonicals(tx, self);
  exclude.add(self);
  const found = await findMatches(tx, subject, { exclude, minScore: QUEUE_THRESHOLD, limit: REMATCH_LIMIT });
  if (found.length === 0) return none;

  // What the creator saw may name a patient merged since: compare groups, not IDs.
  const intake = await canonicalOf(tx, [...(options.shown ?? []), ...(options.dismissed ?? [])]);
  const groups = (ids: readonly string[] = []) =>
    new Set(ids.flatMap((id) => (intake.has(id) ? [intake.get(id)!] : [])));
  const dismissed = groups(options.dismissed);
  const shown = new Set([...groups(options.shown), ...dismissed]);

  const flagged: RematchResult['flagged'] = [];
  for (const f of found) {
    const [a, b] = self < f.canonicalId ? [self, f.canonicalId] : [f.canonicalId, self];
    // A decided pair (keep separate, merged, superseded) is left as it is: the `where` returns no row.
    const [row] = await tx<{ id: string; created: boolean; score: string; sources: string[] }[]>`
      insert into sineobex.duplicate_pairs as d
        (team_id, patient_a, patient_b, score, reasons, sources, creator_dismissed)
      values (${own.teamId}, ${a}, ${b}, ${f.score}, ${f.reasons}::text[], ${[source]}::text[],
        ${dismissed.has(f.canonicalId)})
      on conflict (team_id, patient_a, patient_b) do update set
        score = greatest(d.score, excluded.score),
        reasons = case when excluded.score > d.score then excluded.reasons else d.reasons end,
        sources = case when ${source}::text = any (d.sources) then d.sources else d.sources || excluded.sources end,
        creator_dismissed = d.creator_dismissed or excluded.creator_dismissed,
        last_flagged_at = now()
      where d.status in ('open', 'not_sure')
      returning d.id, (xmax = 0) as created, d.score, d.sources`;
    if (!row) continue;
    flagged.push({ pairId: row.id, otherId: f.canonicalId, score: Number(row.score), created: row.created });
    if (row.created) {
      await audit({
        action: 'duplicate.flagged',
        entity: 'duplicate_pair',
        entityId: row.id,
        patientId: null,
        details: { pairId: row.id, score: Number(row.score), sources: row.sources, patientIds: [a, b] },
      });
    }
  }
  return { flagged, possibleDuplicate: flagged.some((f) => !shown.has(f.otherId)) };
}

/** GET /v1/team/duplicates: open and not-sure pairs (or decided ones), oldest flagged first. */
export async function listDuplicates(
  _scope: TeamScope,
  _query: DuplicateQueryValue,
): Promise<DuplicatePageValue> {
  throw notImplemented();
}

/** GET /v1/team/duplicates/{pairId}: both records side by side; one `duplicate.pair_viewed` per patient. */
export async function getDuplicatePair(
  _scope: TeamScope,
  _pairId: string,
): Promise<DuplicatePairDetailValue> {
  throw notImplemented();
}

/**
 * POST /v1/team/duplicates/{pairId}/decision: merge, keep separate or not sure, with a comment and
 * the versions the reviewer saw (409 pair_changed, 409 already_decided). A merge runs in this
 * transaction, team lock first (design 8.4).
 */
export async function decideDuplicate(
  _scope: TeamScope,
  _pairId: string,
  _input: DecideDuplicateInput,
): Promise<DuplicateDecisionResultValue> {
  throw notImplemented();
}

/** POST /v1/team/duplicates: staff who know two charts are one person (source staff_report). */
export async function flagDuplicate(
  _scope: TeamScope,
  _input: FlagDuplicateInput,
): Promise<DuplicatePairSummaryValue> {
  throw notImplemented();
}
