import { readdirSync, readFileSync } from 'node:fs';
import { createScratchDatabase, type ScratchDatabase } from '@sineobex/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVectorFiles, MAP_FILE, normalizeNameFunction } from '../scripts/gen-match-vectors.ts';
import type { Tx } from '../src/db/database.ts';
import {
  ALL_SOURCES,
  findMatches,
  findSearchHits,
  loadMatchSubject,
  suppressedCanonicals,
} from '../src/patients/candidates.ts';
import * as constants from '../src/patients/match-constants.ts';
import { MATCH_CONSTANTS } from '../src/patients/match-constants.ts';
import {
  areNicknames,
  bestDob,
  dobSim,
  matchSubject,
  nicknamePartners,
  osaDistance,
  retrievalTokens,
  scoreMatch,
  scoreSearch,
  searchBirth,
  tokSim,
  type BirthValue,
  type CandidateGroup,
  type NameSource,
  type QueryBirth,
  type Scored,
  type ScoreMode,
} from '../src/patients/matching.ts';
import { normalizeName, scoringTokens } from '../src/patients/normalize.ts';
import { trigramSimilarity, trigrams } from '../src/patients/trigram.ts';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, createTeam, memberWith, mergeDirect } from './patient-fixtures.ts';

// The scorer, the normalizer and the trigram similarity against the vectors the phone shares
// (phase 3 design 5, 13.2), and the vectors against Postgres: regenerated here, they must equal the
// committed files byte for byte.

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const vector = <T>(name: string) => JSON.parse(read(`packages/contract/test-vectors/${name}`)) as T;

interface GroupInput {
  keys: { source: NameSource; text: string }[];
  births: BirthValue[];
}
const groupOf = (g: GroupInput): CandidateGroup => ({
  keys: g.keys.flatMap((k) => {
    const norm = normalizeName(k.text);
    return norm === null ? [] : [{ source: k.source, norm }];
  }),
  births: g.births,
});

interface MatchVectors {
  tolerance: number;
  constants: Record<string, number>;
  codes: Record<string, string[]>;
  tokens: {
    q: string;
    c: string;
    mode: ScoreMode;
    phone: { sim: number; how: string | null };
    server: { sim: number; how: string | null };
  }[];
  dob: {
    x: QueryBirth | null;
    y: BirthValue | null;
    expected: { sim: number; reason: string | null } | null;
  }[];
  searches: {
    name: string;
    query: { text: string | null; birth: { year: number; month?: number; day?: number } | null };
    group: GroupInput;
    phone: Scored;
    server: Scored;
  }[];
  matches: {
    name: string;
    subject: Parameters<typeof matchSubject>[0];
    group: GroupInput;
    phone: Scored;
    server: Scored;
  }[];
}

const normalize = vector<{ vectors: { input: string; expected: string | null }[] }>('normalize.json');
const trigram = vector<{ tolerance: number; vectors: { a: string; b: string; similarity: number }[] }>(
  'trigram.json',
);
const match = vector<MatchVectors>('match.json');
const codes = new Map(Object.entries(match.codes));

const expectScored = (actual: Scored, expected: Scored, tolerance: number) => {
  expect(Math.abs(actual.score - expected.score)).toBeLessThanOrEqual(tolerance);
  expect(actual.band).toBe(expected.band);
  expect(actual.reasons).toEqual(expected.reasons);
};

describe('normalize.json', () => {
  it('reproduces normalize_name for every vector', () => {
    expect(normalize.vectors.length).toBeGreaterThan(30);
    for (const v of normalize.vectors)
      expect(normalizeName(v.input), JSON.stringify(v.input)).toBe(v.expected);
  });

  it('drops weak words unless nothing else is left', () => {
    expect(scoringTokens('big mike')).toEqual(['mike']);
    expect(scoringTokens('big')).toEqual(['big']);
    expect(scoringTokens('mr big jr')).toEqual(['mr', 'big', 'jr']);
  });
});

describe('trigram.json', () => {
  it('reproduces pg_trgm similarity for every pair', () => {
    for (const v of trigram.vectors)
      expect(Math.abs(trigramSimilarity(v.a, v.b) - v.similarity), `${v.a} / ${v.b}`).toBeLessThanOrEqual(
        trigram.tolerance,
      );
  });

  it('pads each word with two spaces before and one after', () => {
    expect([...trigrams('smity')].sort()).toEqual(['  s', ' sm', 'ity', 'mit', 'smi', 'ty '].sort());
    expect(trigramSimilarity('smity', 'smitty')).toBe(0.625);
  });
});

describe('match.json', () => {
  it('lists the constants of match-constants.ts, each one exported', () => {
    expect(match.constants).toEqual(MATCH_CONSTANTS);
    const exported = Object.fromEntries(
      Object.entries(constants).filter(([k, v]) => /^[A-Z_]+$/.test(k) && typeof v === 'number'),
    );
    expect(exported).toEqual(MATCH_CONSTANTS);
  });

  it('reproduces every token similarity, phone and server', () => {
    for (const t of match.tokens) {
      expect(tokSim(t.q, t.c, t.mode), `${t.q}/${t.c}`).toEqual(t.phone);
      expect(tokSim(t.q, t.c, t.mode, codes), `${t.q}/${t.c}`).toEqual(t.server);
    }
  });

  it('reproduces every birth comparison', () => {
    for (const d of match.dob) expect(dobSim(d.x, d.y)).toEqual(d.expected);
  });

  for (const s of match.searches) {
    it(`search: ${s.name}`, () => {
      const query = {
        norm: s.query.text === null ? null : normalizeName(s.query.text),
        birth: s.query.birth ? searchBirth(s.query.birth) : null,
      };
      expectScored(scoreSearch(query, groupOf(s.group)), s.phone, match.tolerance);
      expectScored(scoreSearch(query, groupOf(s.group), codes), s.server, match.tolerance);
    });
  }

  for (const m of match.matches) {
    it(`match: ${m.name}`, () => {
      expectScored(scoreMatch(matchSubject(m.subject), groupOf(m.group)), m.phone, match.tolerance);
      expectScored(scoreMatch(matchSubject(m.subject), groupOf(m.group), codes), m.server, match.tolerance);
    });
  }

  it('holds the done-when’s expected scores and reasons (done-when.json)', () => {
    const dw = vector<{
      search: { text: string; expected: { reasons: string[]; phoneScore: number } };
      match: {
        expected: {
          band: string;
          reasons: string[];
          phoneScore: number;
          tolerance: number;
          serverScoreAtLeast: number;
        };
      };
    }>('done-when.json');
    const search = match.searches.find((s) => s.name.startsWith('done-when: a misspelled'))!;
    expect(search.query.text).toBe(dw.search.text);
    expect(search.phone.reasons).toEqual(dw.search.expected.reasons);
    expect(search.phone.score).toBeCloseTo(dw.search.expected.phoneScore, 12);
    const phone = match.matches.find((m) => m.name.startsWith('done-when: the intake'))!;
    expect(phone.phone.band).toBe(dw.match.expected.band);
    expect(phone.phone.reasons).toEqual(dw.match.expected.reasons);
    expect(Math.abs(phone.phone.score - dw.match.expected.phoneScore)).toBeLessThanOrEqual(
      dw.match.expected.tolerance,
    );
    const server = match.matches.find((m) => m.name.startsWith('done-when: the server'))!;
    expect(server.server.score).toBeGreaterThanOrEqual(dw.match.expected.serverScoreAtLeast);
    expect(server.server.reasons).toContain('dob_swapped');
  });
});

describe('the score (design 5.2)', () => {
  const group = (keys: [NameSource, string][], births: BirthValue[] = []): CandidateGroup => ({
    keys: keys.map(([source, text]) => ({ source, norm: normalizeName(text)! })),
    births,
  });
  const day = (date: string): BirthValue => ({ precision: 'day', date });

  it('finds nicknames both ways, and expands them for retrieval', () => {
    expect(areNicknames('mike', 'michael')).toBe(true);
    expect(areNicknames('michael', 'mike')).toBe(true);
    expect(areNicknames('mike', 'mike')).toBe(false);
    expect(areNicknames('pepe', 'jose')).toBe(true);
    expect(nicknamePartners('mike')).toContain('michael');
    expect(retrievalTokens(['big mike'])).toContain('michael');
    expect(retrievalTokens(['big mike'])).not.toContain('big');
  });

  it('counts a typo by edit distance with adjacent swaps', () => {
    expect(osaDistance('smity', 'smitty')).toBe(1);
    expect(osaDistance('tomas', 'tomsa')).toBe(1);
    expect(osaDistance('ca', 'abc')).toBe(3);
    expect(tokSim('smity', 'smitty', 'search')).toEqual({ sim: 1 - 1 / 6, how: 'typo' });
  });

  it('hears Kathryn as Catherine on the server only', () => {
    const subject = matchSubject({ legalName: { given: 'Kathryn', family: null } });
    const stored = group([['legal', 'Catherine']]);
    const codes = new Map([
      ['kathryn', ['K0RN', 'KTRN']],
      ['catherine', ['K0RN', 'KTRN']],
    ]);
    expect(scoreMatch(subject, stored, codes).reasons).toContain('sounds_like');
    expect(scoreMatch(subject, stored).reasons).not.toContain('sounds_like');
    expect(scoreMatch(subject, stored, codes).score).toBeGreaterThan(scoreMatch(subject, stored).score);
  });

  it('matches swapped day and month, and a year against a date', () => {
    expect(dobSim(day('1946-07-03'), day('1946-03-07'))).toEqual({
      sim: constants.DOB_SWAPPED,
      reason: 'dob_swapped',
    });
    expect(dobSim({ precision: 'year', year: 1946 }, day('1946-03-07'))).toEqual({
      sim: constants.YEAR_SAME,
      reason: 'dob_year',
    });
    expect(bestDob(day('1946-03-07'), [null, { precision: 'year', year: 1946 }, day('1946-03-07')])).toEqual({
      sim: 1,
      reason: 'dob_exact',
    });
    expect(bestDob(null, [day('1946-03-07')])).toBeNull();
    expect(bestDob(day('1946-03-07'), [])).toBeNull();
  });

  it('caps two full birth dates that disagree', () => {
    const s = scoreMatch(
      matchSubject({ legalName: { given: 'John', family: 'Smith' }, birth: day('1946-03-14') }),
      group([['legal', 'John Smith']], [day('1952-08-01')]),
    );
    expect(s.score).toBe(constants.DOB_CONFLICT_CAP);
    expect(s.band).toBe('weak');
  });

  it('caps one name on each side without a birth date: possible, never queued', () => {
    const s = scoreMatch(matchSubject({ aliases: ['Smitty'] }), group([['alias', 'Smitty']]));
    expect(s.score).toBe(constants.SINGLE_NAME_CAP);
    expect(s.score).toBeLessThan(constants.QUEUE_THRESHOLD);
    expect(s.band).toBe('possible');
  });

  it('never flags anyone on a birth date alone', () => {
    const s = scoreMatch(
      matchSubject({ preferredName: 'Barb', birth: day('1946-03-07') }),
      group([['preferred', 'Del']], [day('1946-03-07')]),
    );
    expect(s.score).toBeLessThanOrEqual(constants.DOB_ONLY_CAP);
    expect(s.reasons).toEqual(['dob_exact']);
  });

  it('never matches a description, and gives the same answer whatever the input order', () => {
    expect(
      scoreMatch(matchSubject({ preferredName: 'Red cap' }), group([['descriptor', 'red cap']])).score,
    ).toBe(0);
    const keys: [NameSource, string][] = [
      ['alias', 'Del'],
      ['preferred', 'Del'],
      ['legal', 'Del Smith'],
    ];
    const a = scoreSearch({ norm: 'del', birth: null }, group(keys));
    const b = scoreSearch({ norm: 'del', birth: null }, group([...keys].reverse()));
    expect(a).toEqual(b);
    expect(a.reasons).toEqual(['name']);
  });
});

describe('the vectors against Postgres', () => {
  let db: ScratchDatabase;
  beforeAll(async () => {
    db = await createScratchDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it('are what the generator writes today (run scripts/gen-match-vectors.ts and commit)', async () => {
    const files = await buildVectorFiles(db.owner);
    for (const [path, content] of Object.entries(files)) expect(read(path), path).toBe(content);
  });

  // Postgres's normalize_name is generated from the pinned map (0015), never the live `unaccent`,
  // whose rules differ between versions: stored keys and the phone's and API's agree on 16 and 17.
  it('normalize_name answers from the pinned map, for every listed character and every Latin block', async () => {
    const map = (JSON.parse(read(MAP_FILE)) as { map: Record<string, string> }).map;
    const listed = Object.keys(map).map((hex) => parseInt(hex, 16));
    const latin: number[] = [];
    for (const [from, to] of [
      [0xc0, 0x24f],
      [0x300, 0x36f],
      [0x1e00, 0x1eff],
    ] as const)
      for (let c = from; c <= to; c++) latin.push(c);
    // Unlisted characters are separators: a non-breaking space, Cyrillic, CJK, an emoji.
    const unlisted = [0xa0, 0x416, 0x65e5, 0x1f9fa];
    for (const c of unlisted) expect(listed).not.toContain(c);
    const codePoints = [...new Set([...listed, ...latin, ...unlisted])].sort((a, b) => a - b);
    const rows = await db.owner<{ c: number; n: string | null; upper: string | null }[]>`
      select c, sineobex.normalize_name('x' || chr(c) || 'y') as n, sineobex.normalize_name('X' || chr(c) || 'Y') as upper
      from unnest(${codePoints}::int[]) as c`;
    expect(rows).toHaveLength(codePoints.length);
    for (const r of rows) {
      const ch = String.fromCodePoint(r.c);
      const hex = r.c.toString(16).toUpperCase().padStart(4, '0');
      const expected = `x${map[hex] ?? ' '}y`.replace(/ +/g, ' ');
      expect(r.n, `U+${hex}`).toBe(expected);
      expect(r.upper, `U+${hex}`).toBe(expected);
      expect(normalizeName(`x${ch}y`), `U+${hex}`).toBe(expected);
    }
  });

  it('defines normalize_name last as the generator writes it from the map, without unaccent', () => {
    const dir = new URL('db/migrations/', root);
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => readFileSync(new URL(f, dir), 'utf8').includes('function sineobex.normalize_name('));
    const newest = readFileSync(new URL(defining[defining.length - 1]!, dir), 'utf8');
    const map = (JSON.parse(read(MAP_FILE)) as { map: Record<string, string> }).map;
    expect(newest).toContain(normalizeNameFunction(map));
    expect(normalizeNameFunction(map)).not.toContain('unaccent');
  });
});

describe('candidate retrieval and ranking (design 5.4)', () => {
  let h: Harness;
  let teamId: string;
  let userId: string;
  let p1: string;
  const inTeam = <T>(fn: (tx: Tx) => Promise<T>) => h.db.tx({ teamId, userId }, fn);
  const day = (date: string): BirthValue => ({ precision: 'day', date });

  beforeAll(async () => {
    h = await createHarness();
    teamId = await createTeam(h);
    userId = (await memberWith(h, teamId, ['patients.view', 'patients.edit'])).userId;
    p1 = (
      await createPatient(h, teamId, userId, {
        preferredName: 'Del',
        legalName: { given: 'Delbert', family: 'Smithfield' },
        aliases: ['Smitty'],
        birth: { precision: 'day', date: '1946-03-07' },
        visualDescriptor: 'Demo: tall, grey beard, red cap',
      })
    ).id;
    await createPatient(h, teamId, userId, {
      preferredName: 'Ray',
      birth: { precision: 'year', year: 1970 },
    });
    // The same street name in another team never appears.
    const other = await createTeam(h, 'Other Team (demo)');
    await createPatient(h, other, userId, { preferredName: 'Smitty', aliases: ['Smity'] });
  });
  afterAll(async () => {
    await h.close();
  });

  it('finds a misspelled street name, in this team only', async () => {
    const { hits, truncated } = await inTeam((tx) =>
      findSearchHits(tx, { norm: 'smity', birth: null }, { sources: ALL_SOURCES, limit: 20 }),
    );
    expect(hits.map((x) => x.canonicalId)).toEqual([p1]);
    expect(hits[0]!.reasons).toEqual(['alias', 'typo']);
    expect(truncated).toBe(false);
  });

  it('searches only the sources it is given', async () => {
    const { hits } = await inTeam((tx) =>
      findSearchHits(tx, { norm: 'smity', birth: null }, { sources: ['preferred', 'legal'], limit: 20 }),
    );
    expect(hits).toEqual([]);
  });

  it('finds the done-when intake as likely, by the server’s score', async () => {
    const subject = matchSubject({
      preferredName: 'Smitty',
      legalName: { given: 'Del', family: null },
      birth: day('1946-07-03'),
    });
    const found = await inTeam((tx) => findMatches(tx, subject));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ canonicalId: p1, band: 'likely' });
    expect(found[0]!.score).toBeGreaterThanOrEqual(constants.QUEUE_THRESHOLD);
    expect(await inTeam((tx) => findMatches(tx, subject, { exclude: new Set([p1]) }))).toEqual([]);
  });

  it('searches by a full birth date alone, and never matches on a birth date alone', async () => {
    const { hits } = await inTeam((tx) =>
      findSearchHits(tx, { norm: null, birth: day('1946-03-07') }, { sources: ALL_SOURCES, limit: 20 }),
    );
    expect(hits.map((x) => x.canonicalId)).toEqual([p1]);
    expect(await inTeam((tx) => findMatches(tx, { names: [], birth: day('1946-03-07') }))).toEqual([]);
  });

  it('loads a stored patient as a match subject; a merged record’s names count for the survivor', async () => {
    const p2 = (await createPatient(h, teamId, userId, { preferredName: 'Delly', aliases: ['Lefty'] })).id;
    await mergeDirect(h, teamId, p2, p1, userId);
    const subject = await inTeam((tx) => loadMatchSubject(tx, p2));
    expect(subject!.birth).toEqual(day('1946-03-07'));
    expect(subject!.names.map((k) => k.norm).sort()).toEqual([
      'del',
      'delbert smithfield',
      'delly',
      'lefty',
      'smitty',
    ]);
    const { hits } = await inTeam((tx) =>
      findSearchHits(tx, { norm: 'lefty', birth: null }, { sources: ALL_SOURCES, limit: 20 }),
    );
    expect(hits.map((x) => x.canonicalId)).toEqual([p1]);
  });

  it('knows which patients a person kept separate', async () => {
    const p3 = (await createPatient(h, teamId, userId, { preferredName: 'Del' })).id;
    const [a, b] = [p1, p3].sort() as [string, string];
    await h.scratch.owner`
      insert into sineobex.duplicate_pairs (team_id, patient_a, patient_b, score, sources, status)
      values (${teamId}, ${a}, ${b}, 0.9, '{sync}', 'keep_separate')`;
    expect([...(await inTeam((tx) => suppressedCanonicals(tx, p1)))]).toEqual([p3]);
    expect([...(await inTeam((tx) => suppressedCanonicals(tx, p3)))]).toEqual([p1]);
  });
});
