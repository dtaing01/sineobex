import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
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

/**
 * The server's re-run of matching (phase 3 design 8.2), inside the caller's transaction with the
 * team lock already held (lockTeamWrites): every accepted patient create ('sync'), every accepted
 * change to preferredName, legalName, birth or an alias ('edit'), every correction and identity
 * review decision ('correction'), and for the survivor after a merge ('merge_rematch'). Skips the
 * patient's own group and suppressed pairs, upserts every candidate at or above QUEUE_THRESHOLD and
 * audits `duplicate.flagged {pairId, score, sources}` with both IDs in details.patientIds.
 */
export async function rematchPatient(
  _tx: Tx,
  _audit: AuditFn,
  _patientId: string,
  _source: RematchSource,
  _options: RematchOptions = {},
): Promise<RematchResult> {
  throw notImplemented();
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
