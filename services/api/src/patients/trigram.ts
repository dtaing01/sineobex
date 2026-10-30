/**
 * pg_trgm's similarity(), for scoring (phase 3 design 5.1). Postgres uses it only to retrieve
 * candidates; the scorer needs the same number in TypeScript and Dart, so both implement the
 * definition and packages/contract/test-vectors/trigram.json, generated from Postgres
 * `similarity()`, pins them to it. The phone mirrors this in lib/patients/trigram.dart.
 *
 * Inputs are normalized names (normalize.ts): lower-case [a-z0-9] words separated by single spaces,
 * which is exactly how pg_trgm splits words.
 */

/**
 * The set of trigrams of a normalized string: each word padded with two leading spaces and one
 * trailing, every 3-character window, duplicates dropped.
 */
export function trigrams(norm: string): Set<string> {
  const out = new Set<string>();
  for (const word of norm.split(' ')) {
    if (word === '') continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** |A∩B| / |A∪B| over the two trigram sets; 0 when either string has none. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}
