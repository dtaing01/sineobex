import type { PresetRow } from '@/lib/presets';

export type Flag = PresetRow<'flag'>;
export type Tier = Flag['body']['tier'];

/** A flag of a tier's list, as the server read it and the list draws it. */
export interface ListedFlag {
  id: string;
  /** The version the list shows it at: a move sends it back, as an edit does (design 7). */
  version: number;
  name: string;
  color: string;
  /** The colour's plain name, which its pill reads first ("Red · High"). */
  colorName: string;
  sensitive: boolean;
  updateOnOffer: boolean;
}

/** What the tiers are called on the page, as one and as many: the lists' own names (8.1). */
export const TIERS: Readonly<Record<Tier, { title: string; one: string; many: string }>> = {
  primary: { title: 'Risk level', one: 'risk level', many: 'risk levels' },
  secondary: { title: 'Conditions', one: 'condition', many: 'conditions' },
};

/** The way and the flag a move's button names (`up:<id>`, `down:<id>`); null for anything else. */
export function parseMove(value: unknown): { way: 'up' | 'down'; id: string } | null {
  const m = typeof value === 'string' ? /^(up|down):(.+)$/.exec(value) : null;
  return m ? { way: m[1] as 'up' | 'down', id: m[2]! } : null;
}

/** 1st, 2nd, 3rd, 4th, …, 11th, 12th, 13th, …, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/**
 * Where a move left its flag, said once the list is read again: "Frost risk moved up. It’s now 1st
 * of 3 conditions." A flag the list no longer holds (another admin removed it just after) is said
 * to have moved, without a place.
 */
export function movedSentence(
  move: { way: 'up' | 'down'; id: string },
  flags: readonly Pick<ListedFlag, 'id' | 'name'>[],
  tier: Tier,
): string {
  const at = flags.findIndex((f) => f.id === move.id);
  if (at < 0) return 'The flag moved.';
  return `${flags[at]!.name} moved ${move.way}. It’s now ${ordinal(at + 1)} of ${flags.length} ${TIERS[tier].many}.`;
}
