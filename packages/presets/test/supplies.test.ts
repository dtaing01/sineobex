import { readFileSync } from 'node:fs';
import { checkAnswer, effectiveAnswers, validate, type ResolvedNoteType } from '@sineobex/forms';
import { describe, expect, it } from 'vitest';
import { BODY_SCHEMAS, bundleLines, suggestSupplies } from '../src/index.ts';
import type { BundleBody, FieldSupplyMapBody } from '../src/index.ts';

// The supplies a note suggests and the lines a bundle applies (phase 5 design 5.3) are data:
// packages/contract/test-vectors/supply-suggest.json, which the phone's supplies read too
// (P2-supplies). This reader holds no answer of its own. Phase 6 calls both functions.
//
// The signatures these tests are written to, in packages/presets/src/supplies.ts and exported from
// the package index (P0-supplies):
//
//   export type ItemState = { state: 'active' | 'archived' };
//   export type SupplySuggestion = { itemId: string; qty: number; mapId: string };
//   export function suggestSupplies(input: {
//     /** The team's active field supply maps. */
//     maps: readonly { id: string; body: FieldSupplyMapBody }[];
//     /** The team's items by id. */
//     items: Readonly<Record<string, ItemState>>;
//     noteTypeKey: string;
//     /** The note's own version. */
//     definition: ResolvedNoteType;
//     /** What the suggesting person may see of the note: visibleAnswers (forms 7.1). */
//     answers: Readonly<Record<string, unknown>>;
//   }): SupplySuggestion[];
//
//   export type BundleLine = { itemId: string; qty: number; checked: boolean };
//   export function bundleLines(
//     bundle: BundleBody,
//     items: Readonly<Record<string, ItemState>>,
//     multiplier: number,
//   ): BundleLine[];

interface SuggestCase {
  name: string;
  maps: { id: string; body: unknown }[];
  noteTypeKey: string;
  definition: string;
  answers: Record<string, unknown>;
  expected: { itemId: string; qty: number; mapId: string }[];
}
interface BundleCase {
  name: string;
  bundle: unknown;
  multiplier: number;
  expected: { itemId: string; qty: number; checked: boolean }[];
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/supply-suggest.json', import.meta.url), 'utf8'),
) as {
  items: Record<string, { state: 'active' | 'archived' }>;
  definitions: Record<string, ResolvedNoteType>;
  suggestSupplies: SuggestCase[];
  bundleLines: BundleCase[];
};

const definition = (name: string) => vectors.definitions[name]!;

const mapsOf = (c: SuggestCase) =>
  c.maps.map(({ id, body }) => {
    const parsed = BODY_SCHEMAS.field_supply_map.safeParse(body);
    expect(parsed.success, `${id} passes its schema: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    return { id, body: parsed.data as FieldSupplyMapBody };
  });

describe('suggestSupplies and bundleLines', () => {
  it('are exported from the package index', () => {
    expect(typeof suggestSupplies).toBe('function');
    expect(typeof bundleLines).toBe('function');
  });

  it('read definitions that pass forms’ validator, and answers each of them takes', () => {
    const noteType = (key: string) => vectors.definitions[key];
    for (const [key, d] of Object.entries(vectors.definitions)) {
      expect(d.key).toBe(key);
      expect(validate(d, { noteType }), key).toEqual([]);
    }
    for (const c of vectors.suggestSupplies) {
      const d = definition(c.definition);
      for (const [path, value] of Object.entries(c.answers))
        expect(checkAnswer(d, path, value), `${c.name}: ${path}`).toBeNull();
      // What the suggesting person may see counts by itself, as visibleAnswers' answers do.
      expect(effectiveAnswers(d, c.answers), c.name).toEqual(c.answers);
    }
  });

  it('have one name per case', () => {
    for (const cases of [vectors.suggestSupplies, vectors.bundleLines])
      expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  describe('suggestSupplies', () => {
    for (const c of vectors.suggestSupplies)
      it(c.name, () => {
        const input = {
          maps: mapsOf(c),
          items: vectors.items,
          noteTypeKey: c.noteTypeKey,
          definition: definition(c.definition),
          answers: c.answers,
        };
        const before = structuredClone({ maps: input.maps, answers: input.answers });
        expect(suggestSupplies(input)).toEqual(c.expected);
        expect({ maps: input.maps, answers: input.answers }).toEqual(before);
      });
  });

  describe('bundleLines', () => {
    for (const c of vectors.bundleLines)
      it(c.name, () => {
        const parsed = BODY_SCHEMAS.bundle.safeParse(c.bundle);
        expect(parsed.success).toBe(true);
        const bundle = parsed.data as BundleBody;
        const before = structuredClone(bundle);
        expect(bundleLines(bundle, vectors.items, c.multiplier)).toEqual(c.expected);
        expect(bundle).toEqual(before);
      });
  });
});
