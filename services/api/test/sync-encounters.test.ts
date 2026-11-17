import { canonicalJson, checkAnswer, sha256Hex, validate } from '@sineobex/forms';
import { checkFile } from '@sineobex/forms/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { setupTeam, TEST_NOTE, TEST_MEDICAL, TEST_NOTE_TYPES, type Team } from './sync-fixtures.ts';

// Phase 4's sync rules for encounters and notes (lifecycle 4), each held by a case here. Every
// person and value is made up.

describe('phase 4 sync: encounters and notes', () => {
  let h: Harness;
  let t: Team;

  beforeAll(async () => {
    h = await createHarness();
    t = await setupTeam(h);
  });
  afterAll(() => h.close());

  describe('the test-only note types (lifecycle 4.4)', () => {
    const byKey = new Map(TEST_NOTE_TYPES.map((d) => [d.key, d]));

    it('are definitions the export would take: the schema, then the validator', () => {
      expect([...byKey.keys()]).toEqual([TEST_NOTE.noteTypeKey, TEST_MEDICAL.noteTypeKey]);
      for (const definition of TEST_NOTE_TYPES) {
        expect(definition.version).toBe(1);
        expect(checkFile('noteType', definition)).toEqual([]);
        expect(validate(definition, { noteType: (key) => byKey.get(key) })).toEqual([]);
      }
    });

    it('one is Non-Medical and one Medical, and neither asks for an answer before Complete', () => {
      expect(byKey.get('test_note')!.kinds).toEqual(['medical', 'non_medical']);
      expect(byKey.get('test_medical')!.kinds).toEqual(['medical']);
      expect(JSON.stringify(TEST_NOTE_TYPES)).not.toContain('"required"');
    });

    it('take every answer phase 2’s sync tests send', () => {
      const rows = (i: number) => `rows.e${String(i).padStart(7, '0')}`;
      const answers: [string, unknown][] = [
        ['vitals.temp_c', 38.2],
        ['vitals.pulse', 96],
        ['care.plan', 'Demo: rest and fluids'],
        ['care.followup', 'Demo: clinic Friday'],
        ['care.allergies', 'Demo: penicillin'],
        ['care.history', `Demo: ${'h'.repeat(3990)}`],
        ['wound.site', 'Demo: left forearm'],
        ['wound.length_cm', 2.5],
        ...[...'abcdefg'].map((x): [string, unknown] => [`extra.${x}`, 'ok']),
        [`${rows(0)}.n`, 0],
        [`${rows(300)}.n`, 300],
        [`${rows(999)}.text`, 'Demo: a row'],
        [`${rows(999)}.entryAt`, '2026-10-20T14:50:00.000Z'],
      ];
      for (const definition of TEST_NOTE_TYPES) {
        for (const [path, value] of answers)
          expect([path, checkAnswer(definition, path, value)]).toEqual([path, null]);
      }
    });

    it('every test team holds both, at the hash of the file’s definition', async () => {
      const held = await h.scratch.owner<{ key: string; version: number; hash: string }[]>`
        select key, version, hash from sineobex.note_type_versions where team_id = ${t.teamId} order by key desc`;
      expect(held).toEqual(
        await Promise.all(
          TEST_NOTE_TYPES.map(async (d) => ({
            key: d.key,
            version: d.version,
            hash: await sha256Hex(canonicalJson(d)),
          })),
        ),
      );
    });
  });
});
