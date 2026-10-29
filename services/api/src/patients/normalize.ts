import UNACCENT from '../../../../packages/contract/data/unaccent-latin.json' with { type: 'json' };
import { WEAK_TOKENS } from './generated/weak-tokens.ts';

/**
 * Name normalization for search and matching (phase 3 design 5.1), exactly as
 * `sineobex.normalize_name()` does it in Postgres: accents removed, lower case, every run of
 * characters other than [a-z0-9] one space, trimmed, null when nothing is left.
 *
 * The phone has no Unicode normalization, so no side calls one: the API, the phone and Postgres all
 * read one frozen character map, packages/contract/data/unaccent-latin.json (what PostgreSQL 16's
 * `lower(unaccent(c))` left of each character, with anything outside [a-z0-9] as a space). Postgres's
 * normalize_name is generated from it (0015), because the live `unaccent` dictionary differs between
 * Postgres versions and the stored search keys must not. A character outside the map is a
 * separator. normalize.json pins this function, the phone's lib/patients/normalize.dart and
 * Postgres to each other; services/api/scripts/gen-match-vectors.ts says how to change the map.
 *
 * Non-Latin scripts normalize to nothing today (design 14.2-10).
 */

const MAP = new Map<number, string>(
  Object.entries((UNACCENT as { map: Record<string, string> }).map).map(([hex, v]) => [parseInt(hex, 16), v]),
);

const A = 0x61;
const Z = 0x7a;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const ZERO = 0x30;
const NINE = 0x39;

/** The normalized form of a name, street name or description; null when nothing is left. */
export function normalizeName(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if ((c >= A && c <= Z) || (c >= ZERO && c <= NINE)) out += ch;
    else if (c >= UPPER_A && c <= UPPER_Z) out += String.fromCharCode(c + 32);
    else if (c < 0x80) out += ' ';
    else out += MAP.get(c) ?? ' ';
  }
  const norm = out.replace(/ +/g, ' ').trim();
  return norm === '' ? null : norm;
}

/** The words of a normalized string. */
export const tokensOf = (norm: string): string[] => (norm === '' ? [] : norm.split(' '));

const WEAK = new Set(WEAK_TOKENS);

/**
 * The words that count for scoring: weak words ("big", "mr", "jr", ...) are dropped unless nothing
 * else is left, so "Big Mike" finds "Mike" and "Big" alone still searches.
 */
export function scoringTokens(norm: string): string[] {
  const all = tokensOf(norm);
  const strong = all.filter((t) => !WEAK.has(t));
  return strong.length > 0 ? strong : all;
}
