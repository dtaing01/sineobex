import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPatientData, csvFields, inRange } from '../scripts/gen-patient-data.ts';

// The generated patient data modules must match what packages/contract/data gives, the way the
// contract drift check holds openapi.json: run `pnpm contract:generate` and commit the result.

const root = resolve(import.meta.dirname, '../../..');

describe('generated patient data', () => {
  it('is committed as the data files give it', async () => {
    const files = await buildPatientData();
    expect(Object.keys(files)).toHaveLength(7);
    for (const [path, content] of Object.entries(files)) {
      expect(await readFile(resolve(root, path), 'utf8'), path).toBe(content);
    }
  });

  it('marks sensitive codes by range', async () => {
    const asset = JSON.parse(
      await readFile(resolve(root, 'apps/mobile/assets/problem_codes.json'), 'utf8'),
    ) as {
      codes: { code: string; sensitive: boolean }[];
    };
    const sensitive = (code: string) => asset.codes.find((c) => c.code === code)!.sensitive;
    expect(sensitive('F11.20')).toBe(true);
    expect(sensitive('O09.90')).toBe(true);
    expect(sensitive('Z30.011')).toBe(true);
    expect(sensitive('Z71.41')).toBe(true);
    expect(sensitive('B20')).toBe(true);
    expect(sensitive('A53.9')).toBe(true);
    expect(sensitive('T22.112A')).toBe(false);
    expect(sensitive('Z71.51')).toBe(false);
    expect(asset.codes.length).toBeGreaterThan(350);
    expect(new Set(asset.codes.map((c) => c.code)).size).toBe(asset.codes.length);
  });

  it('reads ranges and quoted CSV fields', () => {
    expect(inRange('O9A.111', { from: 'O00', to: 'O9A' })).toBe(true);
    expect(inRange('P00', { from: 'O00', to: 'O9A' })).toBe(false);
    expect(inRange('Z71.42', { from: 'Z71.4', to: 'Z71.4' })).toBe(true);
    expect(inRange('Z71.5', { from: 'Z71.4', to: 'Z71.4' })).toBe(false);
    expect(csvFields('T22.112A,"Burn, ""first"" degree",burns')).toEqual([
      'T22.112A',
      'Burn, "first" degree',
      'burns',
    ]);
  });
});
