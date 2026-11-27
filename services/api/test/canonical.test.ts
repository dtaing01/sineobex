import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/sync/canonical.ts';
import { vectorsFile } from '../src/sync/canonical-vectors.ts';

describe('canonical JSON', () => {
  it('matches the committed vectors the phone is tested against', async () => {
    const file = await readFile(
      new URL('../../../packages/contract/test-vectors/canonical-json.json', import.meta.url),
      'utf8',
    );
    // Stale file: run `node scripts/canonical-vectors.ts` in services/api.
    expect(file).toBe(await vectorsFile());
  });

  it('sorts keys by UTF-16 code unit, drops undefined, keeps null', () => {
    expect(canonicalJson({ b: 1, a: undefined, A: null, é: 2, e: 3 })).toBe('{"A":null,"b":1,"e":3,"é":2}');
  });

  it('refuses values JSON cannot carry', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});
