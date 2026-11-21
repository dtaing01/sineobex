import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isBlank } from '../../src/interp/conditions.ts';
import { effectiveAnswers } from '../../src/interp/effective.ts';
import type { ResolvedNoteType } from '../../src/resolve.ts';

// What the vectors cannot say: a JSON reader compares objects without their key order, and never
// sees whether a value was copied. The content hash and a finished note's data rest on both.

const vectors = JSON.parse(
  readFileSync(new URL('../../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
) as { definitions: Record<string, ResolvedNoteType> };
const visit = vectors.definitions.visit!;

describe('effectiveAnswers', () => {
  it('gives the paths in code-unit order, whatever order the note holds them in', () => {
    const answers = {
      'vitals.pulse': 70,
      'plan.notes': 'Demo: ate today',
      'vitals.bp.systolic': 120,
      'meds.given': ['naloxone'],
      'vitals.alert': 'alert',
      'meds.doses': 1,
    };
    expect(Object.keys(effectiveAnswers(visit, answers))).toEqual([
      'meds.doses',
      'meds.given',
      'plan.notes',
      'vitals.alert',
      'vitals.bp.systolic',
      'vitals.pulse',
    ]);
  });

  it('leaves the answers it is given as they were, and shares no list with them', () => {
    const given = ['naloxone', 'ondansetron'];
    const answers = {
      'meds.given': given,
      'meds.doses': 2,
      'vitals.unableBp': true,
      'vitals.bp.systolic': 120,
    };
    const before = structuredClone(answers);
    const counted = effectiveAnswers(visit, answers);
    expect(answers).toEqual(before);
    expect(counted['meds.given']).toEqual(given);
    expect(counted['meds.given']).not.toBe(given);
  });

  it('reads only a note’s own answers, not what every object inherits', () => {
    // An inherited pick would show the doses, were it read as an answer.
    const answers = Object.create({ 'meds.given': ['naloxone'] }) as Record<string, unknown>;
    answers['meds.doses'] = 2;
    answers['vitals.alert'] = 'alert';
    expect(effectiveAnswers(visit, answers)).toEqual({ 'vitals.alert': 'alert' });
  });
});

describe('isBlank', () => {
  it('is true for the blanks of lifecycle 4.5 and for no value, and false for any answer', () => {
    for (const blank of [undefined, null, '', [], {}])
      expect(isBlank(blank), JSON.stringify(blank)).toBe(true);
    for (const answer of [0, false, true, ' ', 'a', ['a'], { a: 1 }])
      expect(isBlank(answer), JSON.stringify(answer)).toBe(false);
  });
});
