import { NICKNAME_GROUPS } from './generated/nicknames.ts';
import {
  ALIAS_WEIGHT,
  DESCRIPTOR_WEIGHT,
  DOB_CONFLICT_CAP,
  DOB_MONTH_YEAR,
  DOB_ONLY_CAP,
  DOB_SWAPPED,
  DOB_YEAR,
  DOB_YEAR_SLIP,
  ESTIMATE_NEAR,
  ESTIMATE_RANGE,
  INITIAL_SIM,
  MATCH_LIKELY,
  MATCH_POSSIBLE,
  NAME_FLOOR,
  NICKNAME_SIM,
  NO_DOB_FACTOR,
  PHONETIC_SIM,
  PREFIX_SIM,
  SEARCH_DOB_WEIGHT,
  SINGLE_NAME_CAP,
  W_DOB,
  W_NAME,
  YEAR_NEAR,
  YEAR_SAME,
} from './match-constants.ts';
import { normalizeName, scoringTokens } from './normalize.ts';
import type { MatchReasonValue } from './schemas.ts';
import { trigramSimilarity } from './trigram.ts';

/**
 * The search and duplicate-matching score (phase 3 design 5.2): one formula, implemented here and
 * in the phone's lib/patients/matching.dart. Postgres and the phone's FTS5 table only find
 * candidates; this decides. packages/contract/test-vectors/match.json, written by
 * services/api/scripts/gen-match-vectors.ts, pins the two implementations to each other: every
 * case records the phone's score (no sound-alike term) and the server's (with Double Metaphone
 * codes from Postgres), both to 1e-9.
 *
 * Pure functions over normalized strings (normalize.ts). Everything that could depend on the order
 * of the inputs (which string is "best", which reason is given on a tie) is decided over a fixed
 * order: keys by source (preferred, legal, alias, descriptor) then by text, births by precision then
 * value, and a later candidate replaces an earlier one only when strictly better.
 */

export type NameSource = 'legal' | 'preferred' | 'alias' | 'descriptor';

/** One searchable string of a patient, normalized. */
export interface NameKey {
  source: NameSource;
  norm: string;
}

/** A birth as recorded (the sync value `birth`). */
export type BirthValue =
  { precision: 'day'; date: string } | { precision: 'year' | 'estimated'; year: number };

/** A birth to search by: a full date, a year and month, or a year (`BirthQuery`). */
export type QueryBirth = BirthValue | { precision: 'month'; year: number; month: number };

/** A canonical patient and every record merged into it, as scoring sees them. */
export interface CandidateGroup {
  keys: readonly NameKey[];
  /** The group's births; unknown ones may be left out or given as null. */
  births: readonly (BirthValue | null)[];
}

/** Double Metaphone codes per token, from `sineobex.name_codes()`. Server only: the phone has none. */
export type PhoneticCodes = ReadonlyMap<string, readonly string[]>;

export type MatchBandValue = 'likely' | 'possible' | 'weak';

export interface Scored {
  score: number;
  band: MatchBandValue;
  /** Why, as MatchReason values in the enum's order; never a name. */
  reasons: MatchReasonValue[];
}

// ------------------------------------------------------------------------------------------------
// Nicknames
// ------------------------------------------------------------------------------------------------

const GROUPS_OF = new Map<string, number[]>();
NICKNAME_GROUPS.forEach((group, i) => {
  for (const t of group.split(' ')) {
    const list = GROUPS_OF.get(t);
    if (list) list.push(i);
    else GROUPS_OF.set(t, [i]);
  }
});

/** Two different tokens on one line of the nickname list ("mike" and "michael"). */
export function areNicknames(a: string, b: string): boolean {
  if (a === b) return false;
  const ga = GROUPS_OF.get(a);
  const gb = GROUPS_OF.get(b);
  if (!ga || !gb) return false;
  return ga.some((g) => gb.includes(g));
}

/** Every token that shares a line with `t`, sorted. Expanded at query time only, so no reindex. */
export function nicknamePartners(t: string): string[] {
  const out = new Set<string>();
  for (const g of GROUPS_OF.get(t) ?? []) for (const p of NICKNAME_GROUPS[g]!.split(' ')) out.add(p);
  out.delete(t);
  return [...out].sort();
}

/**
 * The tokens candidate retrieval looks for (`patient_candidates`' p_tokens): the scoring tokens of
 * every query string plus their nickname partners, sorted.
 */
export function retrievalTokens(norms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of norms) {
    for (const t of scoringTokens(n)) {
      out.add(t);
      for (const p of nicknamePartners(t)) out.add(p);
    }
  }
  return [...out].sort();
}

// ------------------------------------------------------------------------------------------------
// Tokens
// ------------------------------------------------------------------------------------------------

/** Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps. */
export function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++)
    d.push(Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

/** How two tokens matched. `exact` and `prefix` give no reason of their own. */
export type How = 'exact' | 'nickname' | 'typo' | 'initial' | 'prefix' | 'sounds_like';

export interface TokenMatch {
  sim: number;
  how: How | null;
}

/** Search scores what is being typed ("smi" finds Smitty); a match compares two whole names. */
export type ScoreMode = 'search' | 'match';

const sharesCode = (codes: PhoneticCodes, q: string, c: string) => {
  const cq = codes.get(q);
  const cc = codes.get(c);
  return cq !== undefined && cc !== undefined && cq.some((x) => cc.includes(x));
};

/**
 * tokSim(q, c) of design 5.2: 1 when equal, else the best of nickname, edit distance, trigrams, an
 * initial, a prefix (search only) and a shared Double Metaphone code (server only, when `codes` is
 * given). Evaluated in that order; a later term wins only when strictly higher.
 */
export function tokSim(q: string, c: string, mode: ScoreMode, codes?: PhoneticCodes): TokenMatch {
  if (q === c) return { sim: 1, how: 'exact' };
  let best: TokenMatch = { sim: 0, how: null };
  const consider = (sim: number, how: How) => {
    if (sim > best.sim) best = { sim, how };
  };
  if (areNicknames(q, c)) consider(NICKNAME_SIM, 'nickname');
  const shorter = Math.min(q.length, c.length);
  const longer = Math.max(q.length, c.length);
  if (shorter >= 3) consider(1 - osaDistance(q, c) / longer, 'typo');
  consider(trigramSimilarity(q, c), 'typo');
  if ((q.length === 1 && c.startsWith(q)) || (c.length === 1 && q.startsWith(c)))
    consider(INITIAL_SIM, 'initial');
  if (mode === 'search' && q.length >= 3 && c.startsWith(q)) consider(PREFIX_SIM, 'prefix');
  if (codes && shorter >= 3 && sharesCode(codes, q, c)) consider(PHONETIC_SIM, 'sounds_like');
  return best;
}

/** A token match counts toward the reasons only when it is at least a weak name match. */
const counts = (m: TokenMatch) => m.sim >= NAME_FLOOR;

function bestOf(q: string, cs: readonly string[], mode: ScoreMode, codes?: PhoneticCodes): TokenMatch {
  let best: TokenMatch = { sim: 0, how: null };
  for (const c of cs) {
    const m = tokSim(q, c, mode, codes);
    if (m.sim > best.sim) best = m;
  }
  return best;
}

interface Similarity {
  sim: number;
  hows: How[];
}

/** coverage(Q, C): the mean over the typed tokens of their best match, so every typed word is found. */
export function coverage(
  qs: readonly string[],
  cs: readonly string[],
  mode: ScoreMode,
  codes?: PhoneticCodes,
): Similarity {
  if (qs.length === 0 || cs.length === 0) return { sim: 0, hows: [] };
  let sum = 0;
  const hows: How[] = [];
  for (const q of qs) {
    const m = bestOf(q, cs, mode, codes);
    sum += m.sim;
    if (m.how && counts(m)) hows.push(m.how);
  }
  return { sim: sum / qs.length, hows };
}

/** symSim(A, B): coverage both ways, weighted by the number of tokens on each side. */
export function symSim(as: readonly string[], bs: readonly string[], codes?: PhoneticCodes): Similarity {
  if (as.length === 0 || bs.length === 0) return { sim: 0, hows: [] };
  let sum = 0;
  const hows: How[] = [];
  for (const [xs, ys] of [
    [as, bs],
    [bs, as],
  ] as const) {
    for (const x of xs) {
      const m = bestOf(x, ys, 'match', codes);
      sum += m.sim;
      if (m.how && counts(m)) hows.push(m.how);
    }
  }
  return { sim: sum / (as.length + bs.length), hows };
}

/** nameSim(a, b): the whole strings' trigram similarity, or symSim of their tokens, whichever is higher. */
export function nameSim(as: readonly string[], bs: readonly string[], codes?: PhoneticCodes): Similarity {
  const sym = symSim(as, bs, codes);
  const whole = trigramSimilarity(as.join(' '), bs.join(' '));
  return whole > sym.sim ? { sim: whole, hows: whole >= NAME_FLOOR ? ['typo'] : [] } : sym;
}

// ------------------------------------------------------------------------------------------------
// Births
// ------------------------------------------------------------------------------------------------

export interface DobMatch {
  sim: number;
  /** Null when the births disagree (sim 0). */
  reason: MatchReasonValue | null;
}

const ymd = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
};

const yearOf = (b: QueryBirth) => (b.precision === 'day' ? ymd(b.date).y : b.year);

/** 1946/1964: the four digits with one adjacent pair swapped. */
function digitsTransposed(a: number, b: number): boolean {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length || x === y) return false;
  for (let i = 0; i + 1 < x.length; i++) {
    if (
      x[i] === y[i + 1] &&
      x[i + 1] === y[i] &&
      x.slice(0, i) === y.slice(0, i) &&
      x.slice(i + 2) === y.slice(i + 2)
    )
      return true;
  }
  return false;
}

/** Years 1, 10 or 100 apart, or with two digits transposed: a slip of the pen. */
const yearSlip = (a: number, b: number) => [1, 10, 100].includes(Math.abs(a - b)) || digitsTransposed(a, b);

const yearRule = (a: number, b: number): DobMatch =>
  a === b
    ? { sim: YEAR_SAME, reason: 'dob_year' }
    : Math.abs(a - b) === 1
      ? { sim: YEAR_NEAR, reason: 'dob_year' }
      : { sim: 0, reason: null };

/**
 * dobSim(x, y) of design 5.2; null when either is unknown. `x` is the query or the new patient,
 * `y` a stored birth. A year-and-month query (search only) against a full date counts as a partial
 * date: the same year and month DOB_MONTH_YEAR, the same year only DOB_YEAR, otherwise 0; against a
 * year it is a year.
 */
export function dobSim(x: QueryBirth | null | undefined, y: BirthValue | null | undefined): DobMatch | null {
  if (!x || !y) return null;
  if (x.precision === 'estimated' || y.precision === 'estimated') {
    return Math.abs(yearOf(x) - yearOf(y)) <= ESTIMATE_RANGE
      ? { sim: ESTIMATE_NEAR, reason: 'dob_estimate' }
      : { sim: 0, reason: null };
  }
  if ((x.precision !== 'day' && x.precision !== 'month') || y.precision !== 'day')
    return yearRule(yearOf(x), yearOf(y));
  const b = ymd(y.date);
  if (x.precision === 'month') {
    if (x.year === b.y && x.month === b.m) return { sim: DOB_MONTH_YEAR, reason: 'dob_month_year' };
    if (x.year === b.y) return { sim: DOB_YEAR, reason: 'dob_year' };
    return { sim: 0, reason: null };
  }
  const a = ymd(x.date);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return { sim: 1, reason: 'dob_exact' };
  if (a.y === b.y && a.d <= 12 && a.d !== a.m && a.m === b.d && a.d === b.m)
    return { sim: DOB_SWAPPED, reason: 'dob_swapped' };
  if (a.y === b.y && a.m === b.m) return { sim: DOB_MONTH_YEAR, reason: 'dob_month_year' };
  if (a.m === b.m && a.d === b.d && yearSlip(a.y, b.y))
    return { sim: DOB_YEAR_SLIP, reason: 'dob_year_slip' };
  if (a.y === b.y) return { sim: DOB_YEAR, reason: 'dob_year' };
  return { sim: 0, reason: null };
}

const PRECISION_ORDER = { day: 0, year: 1, estimated: 2 } as const;
const birthKey = (b: BirthValue) => (b.precision === 'day' ? b.date : String(b.year).padStart(4, '0'));

/** Births in a fixed order, unknown ones dropped. */
function sortedBirths(births: readonly (BirthValue | null)[]): BirthValue[] {
  return births
    .filter((b): b is BirthValue => b !== null && b !== undefined)
    .sort(
      (a, b) =>
        PRECISION_ORDER[a.precision] - PRECISION_ORDER[b.precision] ||
        (birthKey(a) < birthKey(b) ? -1 : birthKey(a) > birthKey(b) ? 1 : 0),
    );
}

/** The best dobSim against any of the group's births; null when nothing can be compared. */
export function bestDob(
  x: QueryBirth | null | undefined,
  births: readonly (BirthValue | null)[],
): DobMatch | null {
  let best: DobMatch | null = null;
  for (const y of sortedBirths(births)) {
    const m = dobSim(x, y);
    if (m && (best === null || m.sim > best.sim)) best = m;
  }
  return best;
}

/** A search's birth (`BirthQuery`): a full date, a year and month, or a year. */
export function searchBirth(b: { year: number; month?: number; day?: number }): QueryBirth {
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (b.month !== undefined && b.day !== undefined)
    return { precision: 'day', date: `${String(b.year).padStart(4, '0')}-${p2(b.month)}-${p2(b.day)}` };
  if (b.month !== undefined) return { precision: 'month', year: b.year, month: b.month };
  return { precision: 'year', year: b.year };
}

// ------------------------------------------------------------------------------------------------
// Scores
// ------------------------------------------------------------------------------------------------

const SOURCE_ORDER: Record<NameSource, number> = { preferred: 0, legal: 1, alias: 2, descriptor: 3 };

/** Keys in a fixed order: by source, then by text. */
export function sortedKeys(keys: readonly NameKey[]): NameKey[] {
  return [...keys].sort(
    (a, b) =>
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0),
  );
}

const REASON_ORDER: readonly MatchReasonValue[] = [
  'name',
  'alias',
  'legal_name',
  'descriptor',
  'typo',
  'nickname',
  'sounds_like',
  'initial',
  'dob_exact',
  'dob_swapped',
  'dob_month_year',
  'dob_year_slip',
  'dob_year',
  'dob_estimate',
];

const HOW_REASON: Partial<Record<How, MatchReasonValue>> = {
  nickname: 'nickname',
  typo: 'typo',
  initial: 'initial',
  sounds_like: 'sounds_like',
};

const SOURCE_REASON: Record<NameSource, MatchReasonValue> = {
  preferred: 'name',
  legal: 'legal_name',
  alias: 'alias',
  descriptor: 'descriptor',
};

function orderedReasons(reasons: Iterable<MatchReasonValue>): MatchReasonValue[] {
  const set = new Set(reasons);
  return REASON_ORDER.filter((r) => set.has(r));
}

function addHows(out: Set<MatchReasonValue>, hows: readonly How[]) {
  for (const h of hows) {
    const r = HOW_REASON[h];
    if (r) out.add(r);
  }
}

export function bandOf(score: number): MatchBandValue {
  return score >= MATCH_LIKELY ? 'likely' : score >= MATCH_POSSIBLE ? 'possible' : 'weak';
}

export interface SearchQuery {
  /** The normalized search text; null for a search by birth date alone. */
  norm: string | null;
  birth: QueryBirth | null;
}

/**
 * The search score of one candidate group (design 5.2, "Search"): the best of its strings by
 * coverage of the typed words (the descriptor weighted by DESCRIPTOR_WEIGHT), blended with dobSim
 * when the query has a birth date and the group has one. A search by birth date alone scores dobSim.
 * Reasons: the best string's source and how its words matched, when the name counts at all
 * (NAME_FLOOR), and the birth date's reason. The caller passes only the keys the role may search.
 */
export function scoreSearch(q: SearchQuery, group: CandidateGroup, codes?: PhoneticCodes): Scored {
  const reasons = new Set<MatchReasonValue>();
  let text = 0;
  let best: { key: NameKey; hows: How[] } | null = null;
  if (q.norm !== null) {
    const qs = scoringTokens(q.norm);
    for (const key of sortedKeys(group.keys)) {
      // A description is words, not a name: no sound-alike term (it has no codes in Postgres either).
      const cov = coverage(
        qs,
        scoringTokens(key.norm),
        'search',
        key.source === 'descriptor' ? undefined : codes,
      );
      const s = cov.sim * (key.source === 'descriptor' ? DESCRIPTOR_WEIGHT : 1);
      if (s > text) {
        text = s;
        best = { key, hows: cov.hows };
      }
    }
    if (best && text >= NAME_FLOOR) {
      reasons.add(SOURCE_REASON[best.key.source]);
      addHows(reasons, best.hows);
    }
  }
  const dob = bestDob(q.birth, group.births);
  let score: number;
  if (q.norm === null) score = dob?.sim ?? 0;
  else score = dob ? (1 - SEARCH_DOB_WEIGHT) * text + SEARCH_DOB_WEIGHT * dob.sim : text;
  if (dob?.reason) reasons.add(dob.reason);
  return { score, band: bandOf(score), reasons: orderedReasons(reasons) };
}

/** Someone being registered (or a stored patient's whole group, at the server's re-run). */
export interface MatchSubject {
  /** Names: legal "given family", preferred, street names. A descriptor never matches. */
  names: readonly NameKey[];
  birth: BirthValue | null;
}

/** The match subject of an intake form or a PatientMatchRequest: raw text, normalized here. */
export function matchSubject(v: {
  preferredName?: string | null;
  legalName?: { given: string | null; family: string | null } | null;
  aliases?: readonly string[];
  birth?: BirthValue | null;
}): MatchSubject {
  const names: NameKey[] = [];
  const add = (source: NameSource, raw: string | null | undefined) => {
    const norm = normalizeName(raw);
    if (norm !== null) names.push({ source, norm });
  };
  add('preferred', v.preferredName);
  if (v.legalName) add('legal', [v.legalName.given, v.legalName.family].filter((p) => p !== null).join(' '));
  for (const a of v.aliases ?? []) add('alias', a);
  return { names, birth: v.birth ?? null };
}

/**
 * The match score of design 5.2, "Match": the best name pair N (an alias on either side weighs
 * ALIAS_WEIGHT), the best birth D, the blend, and the three caps. Reasons: every name pair that would
 * be a possible match on its own (weighted nameSim ≥ MATCH_POSSIBLE) and the best pair when it counts
 * (≥ NAME_FLOOR), each as its stored source (an alias on either side is `alias`) and how its words
 * matched; then the birth date's reason.
 */
export function scoreMatch(subject: MatchSubject, group: CandidateGroup, codes?: PhoneticCodes): Scored {
  const mine = sortedKeys(subject.names.filter((k) => k.source !== 'descriptor'));
  const theirs = sortedKeys(group.keys.filter((k) => k.source !== 'descriptor'));
  interface Pair {
    s: number;
    reason: MatchReasonValue;
    hows: How[];
    single: boolean;
  }
  const pairs: Pair[] = [];
  let best: Pair | null = null;
  for (const a of mine) {
    const as = scoringTokens(a.norm);
    for (const b of theirs) {
      const bs = scoringTokens(b.norm);
      const alias = a.source === 'alias' || b.source === 'alias';
      const sim = nameSim(as, bs, codes);
      const pair: Pair = {
        s: sim.sim * (alias ? ALIAS_WEIGHT : 1),
        reason: alias ? 'alias' : SOURCE_REASON[b.source],
        hows: sim.hows,
        single: as.length === 1 && bs.length === 1,
      };
      pairs.push(pair);
      if (best === null || pair.s > best.s) best = pair;
    }
  }
  const n = best?.s ?? 0;
  const dob = bestDob(subject.birth, group.births);
  let total = dob ? W_NAME * n + W_DOB * dob.sim : n * NO_DOB_FACTOR;
  if (!dob && best?.single) total = Math.min(total, SINGLE_NAME_CAP);
  if (
    dob &&
    dob.sim === 0 &&
    subject.birth?.precision === 'day' &&
    group.births.some((b) => b?.precision === 'day')
  )
    total = Math.min(total, DOB_CONFLICT_CAP);
  if (n < NAME_FLOOR) total = Math.min(total, DOB_ONLY_CAP);

  const reasons = new Set<MatchReasonValue>();
  for (const p of pairs) {
    if (p.s >= MATCH_POSSIBLE || (p === best && n >= NAME_FLOOR)) {
      reasons.add(p.reason);
      addHows(reasons, p.hows);
    }
  }
  if (dob?.reason) reasons.add(dob.reason);
  return { score: total, band: bandOf(total), reasons: orderedReasons(reasons) };
}

/** Every token scoring may look up a Double Metaphone code for (3+ characters), sorted. */
export function phoneticTokens(norms: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const n of norms) for (const t of scoringTokens(n)) if (t.length >= 3) out.add(t);
  return [...out].sort();
}
