import type { Tx } from '../db/database.ts';
import {
  CANDIDATE_BRANCH_LIMIT,
  CANDIDATE_LIMIT,
  CANDIDATE_TRGM,
  CANDIDATE_WORD_TRGM,
  ESTIMATE_RANGE,
  MATCH_LIMIT,
  MATCH_POSSIBLE,
  SEARCH_MIN,
} from './match-constants.ts';
import {
  phoneticTokens,
  retrievalTokens,
  scoreMatch,
  scoreSearch,
  type BirthValue,
  type CandidateGroup,
  type MatchSubject,
  type NameKey,
  type NameSource,
  type PhoneticCodes,
  type QueryBirth,
  type Scored,
  type SearchQuery,
} from './matching.ts';

/**
 * Server-side candidate retrieval and ranking (phase 3 design 5.4), inside the caller's transaction.
 * Postgres finds candidates (`patient_candidates`, which ranks before it cuts, or
 * `patient_candidates_by_birth`); matching.ts scores them; this sorts by score, then the most
 * recently seen, then ID, and cuts. Every query is led by the team (`current_team_id()`), and row-level
 * security filters again. Search and match return canonical patients only: a merged record's names
 * and births count for its survivor.
 *
 * The search and match routes use it, and so does the server's re-run at sync (duplicates.ts).
 */

export const ALL_SOURCES: readonly NameSource[] = ['legal', 'preferred', 'alias', 'descriptor'];

/** A canonical patient and its group, loaded for scoring. */
export interface LoadedGroup extends CandidateGroup {
  canonicalId: string;
  /** The group's most recent last-seen time; orders equal scores. */
  lastSeenAt: Date | null;
}

export interface RankedCandidate extends Scored {
  canonicalId: string;
  lastSeenAt: Date | null;
}

/**
 * The birth years that order retrieval's ties (never retrieve on their own): a year either side of
 * a date or a year, ESTIMATE_RANGE either side of an estimate.
 */
export function yearRange(birth: QueryBirth | null): { lo: number; hi: number } | null {
  if (!birth) return null;
  const year = birth.precision === 'day' ? Number(birth.date.slice(0, 4)) : birth.year;
  const spread = birth.precision === 'estimated' ? ESTIMATE_RANGE : 1;
  return { lo: year - spread, hi: year + spread };
}

/** `patient_candidates`: canonical IDs in rank order, at most `limit`. */
export async function retrieveCandidates(
  tx: Tx,
  q: {
    norms: readonly string[];
    tokens: readonly string[];
    years: { lo: number; hi: number } | null;
    sources: readonly NameSource[];
    limit?: number;
  },
): Promise<string[]> {
  if (q.norms.length === 0 || q.sources.length === 0) return [];
  const rows = await tx<{ canonicalId: string }[]>`
    select canonical_id from sineobex.patient_candidates(
      ${[...q.norms]}::text[], ${[...q.tokens]}::text[], ${q.years?.lo ?? null}::int, ${q.years?.hi ?? null}::int,
      ${[...q.sources]}::text[], ${CANDIDATE_TRGM}::real, ${CANDIDATE_WORD_TRGM}::real,
      ${CANDIDATE_BRANCH_LIMIT}::int, ${q.limit ?? CANDIDATE_LIMIT}::int)`;
  return rows.map((r) => r.canonicalId);
}

/** `patient_candidates_by_birth`: a full date and no name, exact dates first. */
export async function retrieveByBirth(tx: Tx, date: string, limit = CANDIDATE_LIMIT): Promise<string[]> {
  const rows = await tx<{ canonicalId: string }[]>`
    select canonical_id from sineobex.patient_candidates_by_birth(${date}::date, ${ESTIMATE_RANGE}::int, ${limit}::int)`;
  return rows.map((r) => r.canonicalId);
}

const birthOf = (r: {
  birthPrecision: string | null;
  birthDate: string | null;
  birthYear: number | null;
}): BirthValue | null => {
  if (r.birthPrecision === 'day' && r.birthDate) return { precision: 'day', date: r.birthDate };
  if ((r.birthPrecision === 'year' || r.birthPrecision === 'estimated') && r.birthYear !== null)
    return { precision: r.birthPrecision, year: r.birthYear };
  return null;
};

/**
 * Each group's searchable keys (only `sources`) and births, the merged records' included. A group
 * with no key of those sources still has its births (a search by birth date).
 */
export async function loadGroups(
  tx: Tx,
  canonicalIds: readonly string[],
  sources: readonly NameSource[],
): Promise<Map<string, LoadedGroup>> {
  const groups = new Map<string, LoadedGroup>();
  if (canonicalIds.length === 0) return groups;
  const ids = [...canonicalIds];
  const patients = await tx<
    {
      canonicalId: string;
      birthPrecision: string | null;
      birthDate: string | null;
      birthYear: number | null;
      lastSeenAt: Date | null;
    }[]
  >`
    select p.canonical_id, p.birth_precision, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date, p.birth_year,
           p.last_seen_at
    from sineobex.patients p
    where p.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
    order by p.canonical_id, p.id`;
  for (const p of patients) {
    let g = groups.get(p.canonicalId);
    if (!g) {
      g = { canonicalId: p.canonicalId, keys: [], births: [], lastSeenAt: null };
      groups.set(p.canonicalId, g);
    }
    const birth = birthOf(p);
    if (birth && !g.births.some((b) => JSON.stringify(b) === JSON.stringify(birth)))
      (g.births as BirthValue[]).push(birth);
    if (p.lastSeenAt && (!g.lastSeenAt || p.lastSeenAt > g.lastSeenAt)) g.lastSeenAt = p.lastSeenAt;
  }
  if (sources.length === 0) return groups;
  const keys = await tx<{ canonicalId: string; source: NameSource; norm: string }[]>`
    select p.canonical_id, k.source, k.norm
    from sineobex.patient_name_keys k
    join sineobex.patients p on p.team_id = k.team_id and p.id = k.patient_id
    where k.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
      and k.source = any (${[...sources]}::text[])`;
  for (const k of keys) {
    const g = groups.get(k.canonicalId);
    if (g && !g.keys.some((x) => x.source === k.source && x.norm === k.norm))
      (g.keys as NameKey[]).push({ source: k.source, norm: k.norm });
  }
  return groups;
}

/** Double Metaphone codes for each token, in one call (`name_codes`, server only). */
export async function phoneticCodes(tx: Tx, tokens: readonly string[]): Promise<PhoneticCodes> {
  const codes = new Map<string, string[]>();
  if (tokens.length === 0) return codes;
  const rows = await tx<{ t: string; codes: string[] }[]>`
    select t, sineobex.name_codes(t) as codes from unnest(${[...tokens]}::text[]) as t`;
  for (const r of rows) codes.set(r.t, r.codes);
  return codes;
}

/**
 * Canonical patients a person decided are not this one (design 8.6): a keep_separate pair whose
 * two sides now have these canonical IDs. Evaluated at match time, so it survives merges and comes
 * back correctly after an undo.
 */
export async function suppressedCanonicals(tx: Tx, canonicalId: string): Promise<Set<string>> {
  const rows = await tx<{ other: string }[]>`
    select distinct case when pa.canonical_id = ${canonicalId}::uuid then pb.canonical_id else pa.canonical_id end as other
    from sineobex.duplicate_pairs d
    join sineobex.patients pa on pa.team_id = d.team_id and pa.id = d.patient_a
    join sineobex.patients pb on pb.team_id = d.team_id and pb.id = d.patient_b
    where d.team_id = sineobex.current_team_id() and d.status = 'keep_separate'
      and (pa.canonical_id = ${canonicalId}::uuid or pb.canonical_id = ${canonicalId}::uuid)`;
  return new Set(rows.map((r) => r.other));
}

/**
 * A stored patient as the subject of a match (the server's re-run): every name of its group
 * (legal, preferred, street names; never the descriptor) and the canonical record's birth. Null
 * when the team has no such patient.
 */
export async function loadMatchSubject(tx: Tx, patientId: string): Promise<MatchSubject | null> {
  const [row] = await tx<{ canonicalId: string }[]>`
    select canonical_id from sineobex.patients where team_id = sineobex.current_team_id() and id = ${patientId}`;
  if (!row) return null;
  const groups = await loadGroups(tx, [row.canonicalId], ['legal', 'preferred', 'alias']);
  const [own] = await tx<
    { birthPrecision: string | null; birthDate: string | null; birthYear: number | null }[]
  >`
    select birth_precision, to_char(birth_date, 'YYYY-MM-DD') as birth_date, birth_year
    from sineobex.patients where team_id = sineobex.current_team_id() and id = ${row.canonicalId}`;
  return { names: groups.get(row.canonicalId)?.keys ?? [], birth: own ? birthOf(own) : null };
}

/** Score desc, then the most recently seen, then canonical ID: the same order on the phone. */
export function byRank(a: RankedCandidate, b: RankedCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  const sa = a.lastSeenAt?.getTime() ?? null;
  const sb = b.lastSeenAt?.getTime() ?? null;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sb - sa;
  }
  return a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0;
}

async function codesFor(
  tx: Tx,
  norms: Iterable<string>,
  groups: Iterable<LoadedGroup>,
): Promise<PhoneticCodes> {
  const all = [...norms];
  for (const g of groups) for (const k of g.keys) if (k.source !== 'descriptor') all.push(k.norm);
  return phoneticCodes(tx, phoneticTokens(all));
}

/**
 * Candidates for someone being registered or re-matched, scored by `scoreMatch`, at or above
 * `minScore` (MATCH_POSSIBLE), best first, at most `limit` (MATCH_LIMIT). `exclude` holds canonical
 * IDs left out: the patient's own group, and pairs a person kept separate. A birth date never
 * retrieves anyone on its own, so a subject with no name finds nothing.
 */
export async function findMatches(
  tx: Tx,
  subject: MatchSubject,
  options: {
    sources?: readonly NameSource[];
    exclude?: ReadonlySet<string>;
    minScore?: number;
    limit?: number;
  } = {},
): Promise<RankedCandidate[]> {
  const sources = (options.sources ?? ALL_SOURCES).filter((s) => s !== 'descriptor');
  const norms = [
    ...new Set(subject.names.filter((k) => k.source !== 'descriptor').map((k) => k.norm)),
  ].sort();
  const ids = (
    await retrieveCandidates(tx, {
      norms,
      tokens: retrievalTokens(norms),
      years: yearRange(subject.birth),
      sources,
    })
  ).filter((id) => !options.exclude?.has(id));
  const groups = await loadGroups(tx, ids, sources);
  const codes = await codesFor(tx, norms, groups.values());
  const ranked: RankedCandidate[] = [];
  for (const g of groups.values()) {
    const s = scoreMatch(subject, g, codes);
    if (s.score >= (options.minScore ?? MATCH_POSSIBLE))
      ranked.push({ ...s, canonicalId: g.canonicalId, lastSeenAt: g.lastSeenAt });
  }
  return ranked.sort(byRank).slice(0, options.limit ?? MATCH_LIMIT);
}

/**
 * Search hits at or above SEARCH_MIN, best first: at most `limit`, and whether more scored that
 * high. A name searches the keys of `sources` (what the role can see); a full birth date alone
 * searches births.
 */
export async function findSearchHits(
  tx: Tx,
  query: SearchQuery,
  options: { sources: readonly NameSource[]; limit: number },
): Promise<{ hits: RankedCandidate[]; truncated: boolean }> {
  let ids: string[] = [];
  if (query.norm !== null) {
    ids = await retrieveCandidates(tx, {
      norms: [query.norm],
      tokens: retrievalTokens([query.norm]),
      years: yearRange(query.birth),
      sources: options.sources,
    });
  } else if (query.birth?.precision === 'day') {
    ids = await retrieveByBirth(tx, query.birth.date);
  }
  const groups = await loadGroups(tx, ids, options.sources);
  const codes = await codesFor(tx, query.norm === null ? [] : [query.norm], groups.values());
  const ranked: RankedCandidate[] = [];
  for (const g of groups.values()) {
    const s = scoreSearch(query, g, codes);
    if (s.score >= SEARCH_MIN) ranked.push({ ...s, canonicalId: g.canonicalId, lastSeenAt: g.lastSeenAt });
  }
  ranked.sort(byRank);
  return { hits: ranked.slice(0, options.limit), truncated: ranked.length > options.limit };
}
