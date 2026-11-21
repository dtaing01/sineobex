import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandQuick } from '../../src/interp/expand.ts';
import type { ResolvedNoteType } from '../../src/resolve.ts';
import { validate } from '../../src/validate.ts';

// What the vectors cannot say: a case never leaves out an entry the caller must make, a JSON reader
// compares objects without their key order and never sees whether a value was copied.

const vectors = JSON.parse(
  readFileSync(new URL('../../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
) as { definitions: Record<string, ResolvedNoteType> };
const { quick, quickOld, visit, wound } = vectors.definitions as Record<string, ResolvedNoteType>;
const entry = { wounds: { id: 'e7k2m9q1', at: '2026-11-17T15:04:05Z' } };

describe('expandQuick', () => {
  it('throws when an answer goes into a repeating section the caller gave no entry for', () => {
    expect(() => expandQuick(quick!, { 'vitals.woundType': 'abscess' }, wound!, {})).toThrow(/"wounds"/);
  });

  it('throws on an entry the server would not take, rather than writing it', () => {
    const bad = { wounds: { id: 'E7K2M9Q1', at: '2026-11-17T15:04:05Z' } };
    expect(() => expandQuick(quick!, { 'vitals.woundType': 'abscess' }, wound!, bad)).toThrow(/"wounds"/);
    const late = { wounds: { id: 'e7k2m9q1', at: '2026-11-17 15:04' } };
    expect(() => expandQuick(quick!, { 'vitals.woundType': 'abscess' }, wound!, late)).toThrow(/"wounds"/);
  });

  it('needs no entry when nothing goes into a repeating section', () => {
    expect(expandQuick(quick!, { 'vitals.pulse': 80 }, wound!, {})).toEqual({ answers: {}, leftOut: [] });
  });

  it('gives the paths in code-unit order, with lists copied', () => {
    const given = ['naloxone'];
    const { answers } = expandQuick(
      quick!,
      { 'meds.given': given, 'vitals.pulse': 88, 'hpi.concern': 'yes', 'hpi.details': 'Demo note' },
      visit!,
      {},
    );
    expect(Object.keys(answers)).toEqual(['meds.given', 'plan.notes', 'vitals.pulse']);
    expect(answers['meds.given']).not.toBe(given);
    const placed = expandQuick(
      quick!,
      { 'vitals.woundType': 'abscess', 'vitals.woundLength': 1 },
      wound!,
      entry,
    );
    expect(Object.keys(placed.answers)).toEqual([
      'wounds.e7k2m9q1.entryAt',
      'wounds.e7k2m9q1.length',
      'wounds.e7k2m9q1.type',
    ]);
  });

  // The vectors' older quick version is a real one: as the newest it would not pass the validator.
  it('is given an older quick version the validator would refuse as the newest', () => {
    const named: Record<string, ResolvedNoteType> = {
      demo_quick: quickOld!,
      demo_visit: visit!,
      demo_wound: wound!,
    };
    const rules = validate(quickOld!, { noteType: (key) => named[key] }).map((p) => p.rule);
    expect(rules).toEqual([
      'validate.maps_to_mismatch',
      'validate.maps_to_unknown_field',
      'validate.maps_to_mismatch',
      'validate.maps_to_mismatch',
      // The degree's Other text: the wound's burn degree has no Other option.
      'validate.maps_to_mismatch',
    ]);
  });
});
