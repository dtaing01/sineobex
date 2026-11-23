import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentFlags } from '../src/index.ts';
import type { CurrentFlags, FlagChangeRef, FlagRef } from '../src/index.ts';

// A patient's current flags (phase 5 design 5.3, 4.5; D135) are data: the answers live in
// packages/contract/test-vectors/flag-current.json, which the phone's copy reads too
// (P5-current-dart). This reader holds no answer of its own. The chart, the team index and search
// call the function with the reader's flag rule.
//
// Written ahead of P5-current-ts: every case fails until its code lands. The signature these tests
// are written to, in packages/presets/src/current-flags.ts and exported from the package index:
//
//   export type FlagTier = 'primary' | 'secondary';
//   export type FlagRef = {
//     tier: FlagTier;
//     rank: number;
//     name: string;
//     sensitive: boolean;
//     state: 'active' | 'archived';
//   };
//   export type FlagChangeRef = {
//     id: string;
//     flagId: string;
//     action: 'set' | 'clear';
//     effectiveAt: Date;
//     enteredInError: boolean;
//   };
//   export type CurrentFlags = { primary: string | null; secondary: string[] };
//   export function currentFlags(input: {
//     changes: readonly FlagChangeRef[];
//     flags: Readonly<Record<string, FlagRef>>;
//     hidden: (flag: FlagRef) => boolean;
//   }): CurrentFlags;

interface Case {
  name: string;
  seesSensitive: boolean;
  changes: {
    id: string;
    flagId: string;
    action: 'set' | 'clear';
    effectiveAt: string;
    enteredInError: boolean;
  }[];
  expected: CurrentFlags;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/flag-current.json', import.meta.url), 'utf8'),
) as { flags: Record<string, FlagRef>; cases: Case[] };

const changesOf = (c: Case): FlagChangeRef[] =>
  c.changes.map((x) => ({ ...x, effectiveAt: new Date(x.effectiveAt) }));

/** The reader's flag rule for a flag of the team, as the server's flagHidden is (design 6.2). */
const ruleOf =
  (c: Case) =>
  (flag: FlagRef): boolean =>
    flag.sensitive && !c.seesSensitive;

describe('currentFlags', () => {
  it('is exported from the package index', () => {
    expect(typeof currentFlags).toBe('function');
  });

  it('has one name per case, both tiers, both acts, both readers, and changes entered in error', () => {
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
    expect(new Set(vectors.cases.map((c) => c.seesSensitive))).toEqual(new Set([true, false]));
    const changes = vectors.cases.flatMap((c) => c.changes);
    expect(new Set(changes.map((x) => x.action))).toEqual(new Set(['set', 'clear']));
    expect(changes.some((x) => x.enteredInError)).toBe(true);
    const tiers = new Set(changes.flatMap((x) => vectors.flags[x.flagId]?.tier ?? []));
    expect(tiers).toEqual(new Set(['primary', 'secondary']));
    // An archived flag, a sensitive one and one the team does not hold are each named by a change.
    expect(changes.some((x) => vectors.flags[x.flagId]?.state === 'archived')).toBe(true);
    expect(changes.some((x) => vectors.flags[x.flagId]?.sensitive === true)).toBe(true);
    expect(changes.some((x) => !Object.hasOwn(vectors.flags, x.flagId))).toBe(true);
    // A time written with an offset other than UTC's.
    expect(changes.some((x) => !x.effectiveAt.endsWith('Z'))).toBe(true);
  });

  for (const c of vectors.cases)
    it(c.name, () => {
      expect(currentFlags({ changes: changesOf(c), flags: vectors.flags, hidden: ruleOf(c) })).toEqual(
        c.expected,
      );
    });

  it('answers the same whatever order the changes arrive in', () => {
    for (const c of vectors.cases) {
      const reversed = changesOf(c).reverse();
      expect(currentFlags({ changes: reversed, flags: vectors.flags, hidden: ruleOf(c) }), c.name).toEqual(
        c.expected,
      );
    }
  });

  it('leaves the changes and the flags it is given as they were', () => {
    for (const c of vectors.cases) {
      const changes = changesOf(c);
      const before = JSON.stringify(changes);
      const flags = structuredClone(vectors.flags);
      currentFlags({ changes, flags, hidden: ruleOf(c) });
      expect(JSON.stringify(changes), c.name).toBe(before);
      expect(flags, c.name).toEqual(vectors.flags);
    }
  });

  it('a rule that hides every flag leaves nothing, and is asked only of the team’s flags', () => {
    const asked: FlagRef[] = [];
    for (const c of vectors.cases) {
      expect(
        currentFlags({
          changes: changesOf(c),
          flags: vectors.flags,
          hidden: (flag) => {
            asked.push(flag);
            return true;
          },
        }),
        c.name,
      ).toEqual({ primary: null, secondary: [] });
    }
    const known = new Set(Object.values(vectors.flags));
    expect(asked.length).toBeGreaterThan(0);
    for (const flag of asked) expect(known.has(flag)).toBe(true);
  });
});
