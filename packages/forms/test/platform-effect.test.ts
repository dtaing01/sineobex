import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { platformUpdateEffect } from '../src/index.ts';
import type { PlatformEffect, PlatformUpdateInput } from '../src/index.ts';

// What a platform update does to a team's copy (phase 5 design 5.2, D133) is data: the answers live
// in packages/contract/test-vectors/platform-update.json, which the preset installer's tests read
// too. This reader holds no answer of its own.
//
// The signature these tests are written to, in packages/forms/src/platform-effect.ts and exported
// from the package index (the presets package imports it from '@sineobex/forms', and forms never
// imports presets):
//
//   export type PlatformEffect = 'install' | 'skip' | 'update' | 'offer';
//   export type PlatformUpdateInput = {
//     exists: boolean;
//     state: 'active' | 'archived' | null;
//     customized: boolean;
//     originVersion: number | null;
//     platformVersion: number;
//     changesFixed: boolean;
//   };
//   export function platformUpdateEffect(input: PlatformUpdateInput): PlatformEffect;

interface Case {
  name: string;
  input: PlatformUpdateInput;
  expected: PlatformEffect;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/platform-update.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

describe('platformUpdateEffect', () => {
  it('is exported from the package index', () => {
    expect(typeof platformUpdateEffect).toBe('function');
  });

  it('has one name per case, and a case for each of the four outcomes', () => {
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
    expect([...new Set(vectors.cases.map((c) => c.expected))].sort()).toEqual([
      'install',
      'offer',
      'skip',
      'update',
    ]);
  });

  for (const c of vectors.cases)
    it(c.name, () => {
      expect(platformUpdateEffect(c.input)).toBe(c.expected);
    });

  it('reads nothing but its argument, and changes nothing in it', () => {
    for (const c of vectors.cases) {
      const input = Object.freeze({ ...c.input });
      expect(platformUpdateEffect(input)).toBe(c.expected);
      expect(platformUpdateEffect(input)).toBe(c.expected);
    }
  });
});
