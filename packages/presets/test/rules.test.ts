import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedFixedFields, FIXED_FIELDS, presetWriteEffect, reorderRanks } from '../src/index.ts';
import type { PresetWriteInput } from '../src/index.ts';

// What each act on a preset does and refuses (phase 5 design 5.1, 5.3), and what is fixed at
// creation (4.4), are data: packages/contract/test-vectors/preset-rules.json. This reader holds no
// answer of its own: the routes (P1) refuse by these functions, and the installer and the platform
// data's check read changedFixedFields.
//
// The exports these tests are written to, in packages/presets/src/rules.ts and exported from the
// package index (P0-rules):
//
//   export type PresetAct = 'create' | 'edit' | 'archive' | 'restore' | 'take_update' | 'take_update_as_new';
//   export type PresetWriteInput = {
//     act: PresetAct;
//     kind: PresetKind;
//     state: 'active' | 'archived' | null;
//     baseVersion: number | null;
//     currentVersion: number | null;
//     changedFixed: boolean;
//     sameBody: boolean;
//     referencedBy: Partial<Record<PresetKind, number>>;
//     archivedRefs: number;
//     nameTaken: boolean;
//     updateOnOffer: boolean;
//     updateChangesFixed: boolean;
//   };
//   export type PresetHeadAfter = { stateAfter: 'active' | 'archived'; versionAfter: number; customizedAfter: boolean };
//   export type PresetWriteEffect =
//     | { refuse: 'archived' | 'not_archived' | 'stale' | 'no_change' | 'fixed_field' | 'name_taken'
//           | 'reference_archived' | 'referenced' | 'not_removable' | 'no_update' }
//     | (PresetHeadAfter & { created?: PresetHeadAfter });
//   export function presetWriteEffect(input: PresetWriteInput): PresetWriteEffect;
//
//   export function reorderRanks(
//     current: readonly { id: string; rank: number }[],
//     ordered: readonly string[],
//   ): { id: string; rank: number }[] | { refuse: 'ids_mismatch' };
//
//   /** Each kind's fields fixed at creation, in the order changedFixedFields reports them. */
//   export const FIXED_FIELDS: { readonly [K in PresetKind]: readonly string[] };
//   export function changedFixedFields(kind: PresetKind, before: PresetBody, after: PresetBody): string[];

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/preset-rules.json', import.meta.url), 'utf8'),
) as { cases: Record<'presetWriteEffect' | 'reorderRanks' | 'changedFixedFields', Case[]> };

const RULES: Record<string, (input: never) => unknown> = {
  presetWriteEffect: (input: PresetWriteInput) => presetWriteEffect(input),
  reorderRanks: ({ current, ordered }: { current: { id: string; rank: number }[]; ordered: string[] }) =>
    reorderRanks(current, ordered),
  changedFixedFields: ({ kind, before, after }: { kind: never; before: never; after: never }) =>
    changedFixedFields(kind, before, after),
};

/** The refusals a function's cases show, so a list that lost one fails here and not in review. */
const refusals = (cases: Case[]) =>
  [...new Set(cases.map((c) => (c.expected as { refuse?: string } | null)?.refuse))]
    .filter((r) => r !== undefined)
    .sort();

describe('the rules of a preset’s acts', () => {
  it('are exported from the package index', () => {
    expect(typeof presetWriteEffect).toBe('function');
    expect(typeof reorderRanks).toBe('function');
    expect(typeof changedFixedFields).toBe('function');
    expect(FIXED_FIELDS).toBeDefined();
  });

  it('has cases for each of the three functions and for nothing else, one name each', () => {
    expect(Object.keys(vectors.cases).sort()).toEqual(Object.keys(RULES).sort());
    for (const [rule, cases] of Object.entries(vectors.cases)) {
      expect(cases.length, rule).toBeGreaterThan(5);
      expect(new Set(cases.map((c) => c.name)).size, `${rule}: one name per case`).toBe(cases.length);
    }
  });

  it('shows every refusal each act can give, and every act', () => {
    expect(refusals(vectors.cases.presetWriteEffect)).toEqual([
      'archived',
      'fixed_field',
      'name_taken',
      'no_change',
      'no_update',
      'not_archived',
      'not_removable',
      'reference_archived',
      'referenced',
      'stale',
    ]);
    expect(refusals(vectors.cases.reorderRanks)).toEqual(['ids_mismatch']);
    const acts = new Set(vectors.cases.presetWriteEffect.map((c) => c.input.act));
    expect([...acts].sort()).toEqual([
      'archive',
      'create',
      'edit',
      'restore',
      'take_update',
      'take_update_as_new',
    ]);
  });

  it('fixes the fields of 4.4 and no others', () => {
    expect(FIXED_FIELDS).toEqual({
      order_category: ['behaviour'],
      item: ['unit', 'result.type'],
      bundle: [],
      flag: ['tier', 'sensitive'],
      field_supply_map: ['noteTypeKey', 'path'],
      condition_supply_map: [],
      bag: [],
      settings: [],
    });
    const kinds = new Set(vectors.cases.changedFixedFields.map((c) => c.input.kind));
    expect(kinds.size).toBe(8);
  });

  for (const [rule, cases] of Object.entries(vectors.cases))
    describe(rule, () => {
      for (const c of cases)
        it(c.name, () => {
          const input = structuredClone(c.input);
          expect(RULES[rule]!(input as never)).toEqual(c.expected);
          // Pure: the input is read, never changed.
          expect(input).toEqual(c.input);
        });
    });
});
