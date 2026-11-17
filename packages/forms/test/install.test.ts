import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installPresets, PRESETS, PresetDiffers, type InstallSql } from '../src/index.ts';

// The installer's own rules are tested against a scratch database in db/test/install-presets.test.ts:
// this package's tests run where there is none. Here, what it installs and what it says.

describe('the presets the installer installs', () => {
  it('are generated/presets.json as the export wrote it', () => {
    const file = JSON.parse(readFileSync(new URL('../generated/presets.json', import.meta.url), 'utf8'));
    expect(PRESETS).toEqual(file);
  });

  it('ask the database nothing when there are none', async () => {
    const asked: string[] = [];
    const sql: InstallSql = async (template) => {
      asked.push(template.join('?'));
      return [] as never;
    };
    expect(await installPresets(sql, '00000000-0000-4000-8000-000000000000', { presets: [] })).toEqual({
      installed: [],
      differing: [],
    });
    expect(asked).toEqual([]);
  });

  it('name a differing version by its key and version alone', () => {
    const error = new PresetDiffers([
      { key: 'wound_care', version: 1 },
      { key: 'vitals', version: 3 },
    ]);
    expect(error.message).toBe(
      "The team holds wound_care v1, vitals v3 with a definition that is not the preset's: a released version was edited.",
    );
    expect(error.differing).toEqual([
      { key: 'wound_care', version: 1 },
      { key: 'vitals', version: 3 },
    ]);
  });
});
