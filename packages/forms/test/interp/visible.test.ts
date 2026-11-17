import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { visibleAnswers } from '../../src/interp/visible.ts';
import type { NoteReader } from '../../src/interp/visible.ts';
import type { ResolvedNoteType } from '../../src/resolve.ts';

// What the vectors cannot say: a JSON reader compares objects without their key order, and never
// sees whether a value was copied. The sync read and the content hash rest on both.

const vectors = JSON.parse(
  readFileSync(new URL('../../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
) as { definitions: Record<string, ResolvedNoteType> };
const exam = vectors.definitions.exam!;
const reader: NoteReader = {
  actsAsAuthor: false,
  viewSensitive: true,
  viewSensitiveExams: false,
  readsMedical: true,
  chartsMedical: true,
  ordersMedications: true,
  sensitiveCodes: [],
};

describe('visibleAnswers', () => {
  it('gives the paths in code-unit order, as effectiveAnswers does', () => {
    const answers = {
      'heart.rhythm': 'regular',
      'systems.picked': ['heart', 'gu'],
      'gu.consent': 'yes',
      'heart.murmur': 'none',
    };
    expect(Object.keys(visibleAnswers(exam, answers, reader)!)).toEqual([
      'heart.murmur',
      'heart.rhythm',
      'systems.picked',
    ]);
  });

  it('leaves the answers it is given as they were', () => {
    const picked = ['heart', 'gu'];
    const answers = { 'systems.picked': picked, 'gu.consent': 'yes' };
    const before = structuredClone(answers);
    const seen = visibleAnswers(exam, answers, reader)!;
    expect(answers).toEqual(before);
    expect(seen['systems.picked']).toEqual(['heart']);
    expect(picked).toEqual(['heart', 'gu']);
  });
});
