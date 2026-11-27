/**
 * A patient's current flags (phase 5 design 5.3, 4.5; D135): a fold of the flag changes of the
 * patient's merged group. The chart (P5-chart-read), the team index (P5-index) and search (P5-search)
 * call it with the reader's flag rule, and the phone has its own copy (P5-current-dart);
 * packages/contract/test-vectors/flag-current.json pins the two.
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
export function currentFlags(input: {
  /** The flag changes of the patient's merged group, in any order. */
  changes: readonly FlagChangeRef[];
  /** The team's flags by id, archived ones included. */
  flags: Readonly<Record<string, FlagRef>>;
  /** The reader's flag rule (flagHidden, design 6.2): true for a flag this reader may not see. */
  hidden: (flag: FlagRef) => boolean;
}): CurrentFlags {
  const { flags } = input;
  // PLAN-OPEN (PL-18): what happens to a flag change made on the wrong patient? It is marked entered
  // in error, and drops out of the current flags as though it had never been made.
  // The rule is asked only of the team's own flags: a flag the team does not hold names nothing the
  // reader could be shown.
  const counted = input.changes.filter(
    (c) => !c.enteredInError && Object.hasOwn(flags, c.flagId) && !input.hidden(flags[c.flagId]!),
  );
  // PLAN-OPEN (PL-24): which time orders a patient's flag changes? The change's own time, never later
  // than the server's receipt (4.5), so a phone whose clock runs ahead cannot win every change; the
  // id breaks a tie, so every reader folds two changes of one instant the same way.
  const ordered = [...counted].sort(
    (a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || byCodeUnits(a.id, b.id),
  );
  let primary: string | null = null;
  const lastOf = new Map<string, FlagChangeRef['action']>();
  for (const change of ordered) {
    if (flags[change.flagId]!.tier === 'secondary') lastOf.set(change.flagId, change.action);
    // A clear takes the risk level off only when it names the level the patient has then: a clear
    // from a phone that never saw a later level set takes nothing off (5.3's two-phone case).
    else if (change.action === 'set') primary = change.flagId;
    else if (primary === change.flagId) primary = null;
  }
  // PLAN-OPEN (BM-78): what happens to the patients who carry a flag when it is archived? Nothing: an
  // archived flag is folded as any other, so it stays on the patient until a change clears it.
  const secondary = [...lastOf]
    .filter(([, action]) => action === 'set')
    .map(([id]) => id)
    .sort((a, b) => {
      const x = flags[a]!;
      const y = flags[b]!;
      return x.rank - y.rank || byCodeUnits(x.name, y.name) || byCodeUnits(a, b);
    });
  return { primary, secondary };
}

// UTF-16 code units, as Dart's compareTo compares, so the phone and the server order alike whatever
// either one's locale; never localeCompare.
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
