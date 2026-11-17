import { readFileSync } from 'node:fs';
import { effectiveAnswers, type Answers, type ResolvedNoteType } from '@sineobex/forms';
import { describe, expect, it } from 'vitest';
import { noteContent, noteContentHash } from '../src/encounters/content-hash.ts';
import { canonicalJson } from '../src/sync/canonical.ts';

// The hash a sign-off carries is data (phase 4 design, lifecycle 4.5): the answers live in
// packages/contract/test-vectors/note-content-hash.json, and the phone's content_hash_test.dart
// reads the same file. A phone that hashed otherwise would have every Complete refused with
// content_changed. This reader holds no answer of its own.

interface Case {
  name: string;
  why?: string;
  definition: string;
  noteId: string;
  encounterId: string;
  patientId: string | null;
  summary: string | null;
  answers: Answers;
  effective: Record<string, unknown>;
  content: string;
  hash: string;
  sameHashAs?: string;
}

const vector = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/contract/test-vectors/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

const file = vector('note-content-hash.json');
const cases = file.cases as Case[];
const definitions = vector('forms-conformance.json').definitions as Record<string, ResolvedNoteType>;

// The keys a case has, the optional ones ending in '?'. A case with another key would be read
// without what it meant to say.
const KEYS = [
  'name',
  'why?',
  'definition',
  'noteId',
  'encounterId',
  'patientId',
  'summary',
  'answers',
  'effective',
  'content',
  'hash',
  'sameHashAs?',
];

function keyFaults(c: Record<string, unknown>): string[] {
  const known = KEYS.map((k) => k.replace('?', ''));
  return [
    ...Object.keys(c)
      .filter((k) => !known.includes(k))
      .map((k) => `has no use for ${k}`),
    ...KEYS.filter((k) => !k.endsWith('?') && !Object.hasOwn(c, k)).map((k) => `needs ${k}`),
  ];
}

const definitionOf = (c: Case) => {
  if (!Object.hasOwn(definitions, c.definition)) throw new Error(`no definition ${c.definition}`);
  return definitions[c.definition]!;
};

const inputOf = (c: Case) => ({
  noteId: c.noteId,
  encounterId: c.encounterId,
  patientId: c.patientId,
  summary: c.summary,
  definition: definitionOf(c),
  answers: c.answers,
});

describe('note content hash', () => {
  it('holds a note and cases, each with exactly the keys it is read by', () => {
    expect(Object.keys(file).sort()).toEqual(['cases', 'note']);
    expect(cases.length).toBeGreaterThan(15);
    expect(new Set(cases.map((c) => c.name)).size, 'one name per case').toBe(cases.length);
    for (const c of cases) {
      expect(keyFaults(c as unknown as Record<string, unknown>), c.name).toEqual([]);
      expect(
        Object.hasOwn(definitions, c.definition),
        `${c.name}: a definition of forms-conformance.json`,
      ).toBe(true);
      expect(c.hash, c.name).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('says which cases hash the same, and every other case hashes otherwise', () => {
    const byName = new Map(cases.map((c) => [c.name, c]));
    for (const c of cases.filter((c) => c.sameHashAs !== undefined)) {
      const other = byName.get(c.sameHashAs!);
      expect(other, `${c.name}: sameHashAs names a case`).toBeDefined();
      expect(c.hash, c.name).toBe(other!.hash);
    }
    const apart = cases.filter((c) => c.sameHashAs === undefined).map((c) => c.hash);
    expect(new Set(apart).size).toBe(apart.length);
  });

  // Vectors cannot hold undefined, so this rule lives here. A later unit builds the input from a
  // stored record, where a summary never set reads as undefined; canonical JSON drops an undefined
  // key, while the phone always writes "summary":null, and every Complete would then be refused.
  it('hashes a missing patient or summary as null, as the phone writes it', async () => {
    const c = cases[0]!;
    const stored: Record<string, unknown> = {};
    const missing = {
      ...inputOf(c),
      patientId: stored.patientId as string | null,
      summary: stored.summary as string | null,
    };
    const nulls = { ...inputOf(c), patientId: null, summary: null };
    expect(canonicalJson(noteContent(missing))).toBe(canonicalJson(noteContent(nulls)));
    expect(canonicalJson(noteContent(missing))).toContain('"patientId":null');
    expect(canonicalJson(noteContent(missing))).toContain('"summary":null');
    expect(await noteContentHash(missing)).toBe(await noteContentHash(nulls));
  });

  for (const c of cases) {
    it(c.name, async () => {
      // The answers that count are the forms interpreter's: a case whose effective answers it does
      // not give would pin a hash over something no signer sees.
      const effective = effectiveAnswers(definitionOf(c), c.answers);
      expect(effective).toEqual(c.effective);
      expect(Object.keys(effective)).toEqual(Object.keys(c.effective));

      expect(canonicalJson(noteContent(inputOf(c)))).toBe(c.content);
      expect(await noteContentHash(inputOf(c))).toBe(c.hash);
    });
  }
});
