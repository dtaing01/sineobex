import type { Schemas } from '@sineobex/contract';
import { who } from '@/components/SideBySide';

// Words for pairs, shared by the queue and the pair page.

type Pair = Schemas['DuplicatePairSummary'];

export const BAND: Record<Schemas['MatchBand'], string> = {
  likely: 'Likely the same person',
  possible: 'Possibly the same person',
  weak: 'Weak match',
};

export const SOURCE: Record<Schemas['DuplicateSource'], string> = {
  sync: 'when a phone synced a record',
  edit: 'after an edit',
  merge_rematch: 'after a merge',
  correction: 'after a correction',
  staff_report: 'reported by staff',
};

export const PAIR_STATUS: Record<Schemas['DuplicateStatus'], string> = {
  open: 'Waiting for a decision',
  not_sure: 'Not sure',
  keep_separate: 'Kept separate',
  merged: 'Merged',
  superseded: 'Settled by another merge',
};

/** "Jon, born 1962, and Johnny, born 1962": a row's link names both records. */
export function pairName(p: Pair): string {
  return `${who(p.a.summary)}, and ${who(p.b.summary)}`;
}
