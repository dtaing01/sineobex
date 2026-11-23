/**
 * A patient's current flags (phase 5 design 5.3, 4.5; D135): a fold of the flag changes of the
 * patient's merged group. The chart (P5-chart-read), the team index (P5-index) and search (P5-search)
 * call it with the reader's flag rule, and the phone has its own copy (P5-current-dart);
 * packages/contract/test-vectors/flag-current.json pins the two.
 *
 * Written ahead of P5-current-ts, whose code replaces the stub below.
 *
 * Pure, and in the API's edge bundle: it imports nothing.
 */

export type FlagTier = 'primary' | 'secondary';

/** What the fold reads of one of the team's flags: its body's tier, rank, name and sensitive, its state. */
export type FlagRef = {
  tier: FlagTier;
  rank: number;
  name: string;
  sensitive: boolean;
  state: 'active' | 'archived';
};

/** What the fold reads of one flag change. */
export type FlagChangeRef = {
  id: string;
  flagId: string;
  action: 'set' | 'clear';
  /** The change's time (4.5): never later than when the server received it. */
  effectiveAt: Date;
  enteredInError: boolean;
};

/** The patient's risk level, or none, and their conditions by rank, then name, then id. */
export type CurrentFlags = { primary: string | null; secondary: string[] };

/**
 * A change marked entered in error is left out, and so is one whose flag is not among `flags` or that
 * `hidden` hides. The rest are folded by effectiveAt, then id: a set makes its flag the primary, and
 * a clear takes the primary off only when its flag is the primary then; a condition is carried when
 * its own last change is a set. An archived flag is answered as any other.
 */
export function currentFlags(_input: {
  /** The flag changes of the patient's merged group, in any order. */
  changes: readonly FlagChangeRef[];
  /** The team's flags by id, archived ones included. */
  flags: Readonly<Record<string, FlagRef>>;
  /** The reader's flag rule (flagHidden, design 6.2): true for a flag this reader may not see. */
  hidden: (flag: FlagRef) => boolean;
}): CurrentFlags {
  throw new Error('P5-current-ts');
}
