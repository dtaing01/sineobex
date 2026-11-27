import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical.ts';

type Vector = { input: unknown; canonical: string; sha256: string };

describe('canonical JSON', () => {
  it('reproduces every committed vector the API and the phone are tested against', async () => {
    const file = JSON.parse(
      await readFile(new URL('../../contract/test-vectors/canonical-json.json', import.meta.url), 'utf8'),
    ) as { vectors: Vector[] };
    expect(file.vectors.length).toBeGreaterThan(30);
    for (const v of file.vectors) {
      expect(canonicalJson(v.input), v.canonical).toBe(v.canonical);
      expect(await sha256Hex(canonicalJson(v.input)), v.canonical).toBe(v.sha256);
    }
  });

  // The vector file is JSON, which can carry neither undefined nor -0: these rules are pinned here.
  it('sorts keys by UTF-16 code unit, drops undefined, keeps null', () => {
    expect(canonicalJson({ b: 1, a: undefined, A: null, é: 2, e: 3 })).toBe('{"A":null,"b":1,"e":3,"é":2}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('writes -0 as 0', () => {
    expect(canonicalJson(-0)).toBe('0');
  });

  it('refuses values JSON cannot carry', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});
