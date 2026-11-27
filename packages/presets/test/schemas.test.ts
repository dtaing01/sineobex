import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODY_SCHEMAS, FLAG_COLORS, PRESET_KINDS } from '../src/index.ts';
import type { PresetKind } from '../src/index.ts';

// The body of each preset kind (phase 5 design 4.4) is data: packages/contract/test-vectors/
// preset-bodies.json, which the phone's parsers read too (P2-models). This reader holds no answer of
// its own. The schemas validate: a body is stored as it was sent, but for the defaults the file
// names (`filled`), so an older body and a newer one read the same.
//
// The exports these tests are written to, in packages/presets/src/schemas.ts and exported from the
// package index (P0-schemas-catalog, then P0-schemas-rest):
//
//   export const PRESET_KINDS: readonly ['order_category', 'item', 'bundle', 'flag',
//     'field_supply_map', 'condition_supply_map', 'bag', 'settings'];
//   export type PresetKind = (typeof PRESET_KINDS)[number];
//   /** The eight colours a flag may have: its body holds `color`, a pill shows `name` first. */
//   export const FLAG_COLORS: readonly { color: string; name: string }[];
//   /** One zod schema per kind, each object strict; parse fills the defaults. */
//   export const BODY_SCHEMAS: { readonly [K in PresetKind]: z.ZodType };
//
// Each kind's body type (OrderCategoryBody, ItemBody, BundleBody, FlagBody, FieldSupplyMapBody,
// ConditionSupplyMapBody, BagBody, SettingsBody, and PresetBody for any of them) is the schema's
// output, z.output<typeof BODY_SCHEMAS[K]>; validate.test.ts and supplies.test.ts name them.

interface Valid {
  name: string;
  kind: PresetKind;
  body: Record<string, unknown>;
  filled?: Record<string, unknown>;
}
interface Invalid {
  name: string;
  kind: PresetKind;
  body: unknown;
  paths: string[];
}
interface UnknownField {
  name: string;
  kind: PresetKind;
  body: Record<string, unknown>;
  at: string;
  key: string;
  known: Record<string, unknown>;
  filled?: Record<string, unknown>;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/preset-bodies.json', import.meta.url), 'utf8'),
) as {
  kinds: PresetKind[];
  colors: { color: string; name: string }[];
  valid: Valid[];
  invalid: Invalid[];
  unknownFields: UnknownField[];
  unknownKinds: { name: string; kind: string; body: unknown }[];
};

/** Whether an issue's path lies at or under `at`, '' being the body itself. */
const under = (path: string, at: string) => at === '' || path === at || path.startsWith(`${at}.`);

const issuesOf = (kind: PresetKind, body: unknown) => {
  const parsed = BODY_SCHEMAS[kind].safeParse(body);
  expect(parsed.success, 'the body is refused').toBe(false);
  return parsed.error!.issues;
};

describe('the preset body schemas', () => {
  it('are exported from the package index', () => {
    expect(PRESET_KINDS).toBeDefined();
    expect(BODY_SCHEMAS).toBeDefined();
    expect(FLAG_COLORS).toBeDefined();
  });

  it('are the eight kinds, one schema each, and nothing else', () => {
    expect([...PRESET_KINDS]).toEqual(vectors.kinds);
    expect(Object.keys(BODY_SCHEMAS).sort()).toEqual([...vectors.kinds].sort());
  });

  it('give a flag the eight named colours, in the palette’s order', () => {
    expect(FLAG_COLORS.map(({ color, name }) => ({ color, name }))).toEqual(vectors.colors);
    expect(new Set(vectors.colors.map((c) => c.color)).size).toBe(8);
  });

  it('have valid and invalid cases for every kind, each with its own name', () => {
    for (const kind of vectors.kinds) {
      expect(
        vectors.valid.some((c) => c.kind === kind),
        kind,
      ).toBe(true);
      expect(
        vectors.invalid.some((c) => c.kind === kind),
        kind,
      ).toBe(true);
    }
    const names = [
      ...vectors.valid,
      ...vectors.invalid,
      ...vectors.unknownFields,
      ...vectors.unknownKinds,
    ].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    // Each colour is taken by a flag.
    for (const { color } of vectors.colors)
      expect(
        vectors.valid.some((c) => c.kind === 'flag' && c.body.color === color),
        color,
      ).toBe(true);
  });

  for (const c of vectors.valid)
    it(`accepts ${c.kind}: ${c.name}`, () => {
      const parsed = BODY_SCHEMAS[c.kind].safeParse(c.body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      // Validate, never transform, but for the defaults.
      expect(parsed.data).toEqual({ ...c.body, ...c.filled });
    });

  for (const c of vectors.invalid)
    it(`refuses ${c.kind}: ${c.name}`, () => {
      const paths = [...new Set(issuesOf(c.kind, c.body).map((i) => i.path.join('.')))];
      for (const path of paths)
        expect(
          c.paths.some((at) => under(path, at)),
          `an issue at "${path}", outside ${JSON.stringify(c.paths)}`,
        ).toBe(true);
      for (const at of c.paths)
        expect(
          paths.some((path) => under(path, at)),
          `no issue at "${at}"; issues at ${JSON.stringify(paths)}`,
        ).toBe(true);
    });

  for (const c of vectors.unknownFields)
    it(`refuses a key it does not name, for ${c.kind}: ${c.name}`, () => {
      const issues = issuesOf(c.kind, c.body);
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'unrecognized_keys',
          keys: [c.key],
          path: c.at === '' ? [] : c.at.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
        }),
      ]);
      // That key is all that is wrong: without it the body is valid, and reads as the phone reads it.
      const parsed = BODY_SCHEMAS[c.kind].safeParse(c.known);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(parsed.data).toEqual({ ...c.known, ...c.filled });
    });

  it('have no schema for a kind they do not know', () => {
    for (const c of vectors.unknownKinds) {
      expect((PRESET_KINDS as readonly string[]).includes(c.kind), c.kind).toBe(false);
      expect(Object.hasOwn(BODY_SCHEMAS, c.kind), c.kind).toBe(false);
    }
  });

  it('leave the body they are given as it was', () => {
    for (const c of vectors.valid) {
      const body = structuredClone(c.body);
      BODY_SCHEMAS[c.kind].safeParse(body);
      expect(body).toEqual(c.body);
    }
  });
});
