import { readFileSync } from 'node:fs';
import { PRESETS, validate, type ResolvedNoteType } from '@sineobex/forms';
import { describe, expect, it } from 'vitest';
import { BODY_SCHEMAS, validatePreset } from '../src/index.ts';
import type { PresetBody, PresetKind, PresetProblem, PresetRef } from '../src/index.ts';

// What a preset body's schema cannot hold (phase 5 design 4.4) is data:
// packages/contract/test-vectors/preset-validate.json. This reader holds no answer of its own. The
// admin routes (P1) answer 422 invalid with these problems' paths, 409 for reference_archived, and
// the installer skips and counts a platform entry this refuses.
//
// The signature these tests are written to, in packages/presets/src/validate.ts and exported from
// the package index (P0-validate):
//
//   /** A category's behaviour, or an item's category's; a preset of another kind has none. */
//   export type PresetRef =
//     | { kind: 'order_category' | 'item'; state: 'active' | 'archived'; behaviour: 'supply' | 'medication' | 'lab' }
//     | { kind: Exclude<PresetKind, 'order_category' | 'item'>; state: 'active' | 'archived' };
//   export type PresetProblemCode = 'unknown_reference' | 'wrong_kind' | 'reference_archived'
//     | 'result_mismatch' | 'medical_mismatch' | 'bundle_not_medical' | 'primary_sensitive'
//     | 'unknown_note_type' | 'unknown_path' | 'path_kind' | 'when_invalid' | 'from_path'
//     | 'sensitive_path' | 'settings_taken';
//   export type PresetProblem = { path: string; code: PresetProblemCode };
//   export function validatePreset(input: {
//     kind: PresetKind;
//     /** A body BODY_SCHEMAS[kind] accepted, as it parsed. */
//     body: PresetBody;
//     /** The team's presets by id. */
//     refs: Readonly<Record<string, PresetRef>>;
//     /** The current definition of each of the team's active note types, by key. */
//     definitions: Readonly<Record<string, ResolvedNoteType>>;
//     /** The preset's own id; null for one not made yet. */
//     id: string | null;
//   }): PresetProblem[];
//
// sensitive_path is mayBeHidden's (packages/forms/src/interp/may-be-hidden.ts), which
// packages/forms/test/interp/may-be-hidden.test.ts holds to visibleAnswers.

interface Case {
  name: string;
  kind: PresetKind;
  body: unknown;
  id: string | null;
  refs?: Record<string, PresetRef>;
  expected: PresetProblem[];
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/preset-validate.json', import.meta.url), 'utf8'),
) as {
  codes: string[];
  refs: Record<string, PresetRef>;
  definitions: Record<string, ResolvedNoteType | { released: number }>;
  cases: Case[];
};

/** The file's definitions, a released one read from the forms package's presets. */
const definitions: Record<string, ResolvedNoteType> = Object.fromEntries(
  Object.entries(vectors.definitions).map(([key, d]) => {
    if (!('released' in d)) return [key, d];
    const preset = PRESETS.find((p) => p.key === key && p.version === d.released);
    expect(preset, `${key} v${d.released} is released`).toBeDefined();
    return [key, preset!.definition];
  }),
);

const sorted = (problems: readonly PresetProblem[]) =>
  [...problems].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );

function parse(c: Case): PresetBody {
  const parsed = BODY_SCHEMAS[c.kind].safeParse(c.body);
  expect(parsed.success, `the body passes its schema: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  return parsed.data as PresetBody;
}

describe('validatePreset', () => {
  it('is exported from the package index', () => {
    expect(typeof validatePreset).toBe('function');
  });

  it('reads definitions that are real: each made-up one passes forms’ validator, each released one is the newest', () => {
    const noteType = (key: string) => definitions[key];
    for (const [key, d] of Object.entries(vectors.definitions)) {
      if ('released' in d) {
        const newest = Math.max(...PRESETS.filter((p) => p.key === key).map((p) => p.version));
        expect(d.released, `${key}: the cases were written against its newest version`).toBe(newest);
      } else expect(validate(d, { noteType }), key).toEqual([]);
    }
  });

  it('has one name per case, a case for every code, and cases for every kind', () => {
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
    const shown = [...new Set(vectors.cases.flatMap((c) => c.expected.map((p) => p.code)))].sort();
    expect(shown).toEqual([...vectors.codes].sort());
    expect(new Set(vectors.cases.map((c) => c.kind)).size).toBe(8);
  });

  it('holds 4.4’s exam picker cases: includes skin accepted; includes gu, equals gu and answered refused', () => {
    const on = (when: unknown) =>
      vectors.cases.find(
        (c) =>
          c.kind === 'field_supply_map' &&
          (c.body as { noteTypeKey: string }).noteTypeKey === 'general_primary_care' &&
          (c.body as { path?: string }).path === 'exam.systems' &&
          JSON.stringify((c.body as { when?: unknown }).when) === JSON.stringify(when),
      )!.expected;
    expect(on({ includes: 'skin' })).toEqual([]);
    for (const when of [{ includes: 'gu' }, { equals: 'gu' }, { answered: true }])
      expect(on(when), JSON.stringify(when)).toEqual([{ path: 'path', code: 'sensitive_path' }]);
  });

  for (const c of vectors.cases)
    it(`${c.kind}: ${c.name}`, () => {
      const refs = c.refs ?? vectors.refs;
      const input = { kind: c.kind, body: parse(c), refs, definitions, id: c.id };
      const before = structuredClone({ body: input.body, refs });
      expect(sorted(validatePreset(input))).toEqual(sorted(c.expected));
      // Pure: nothing it is given is changed.
      expect({ body: input.body, refs }).toEqual(before);
    });
});
