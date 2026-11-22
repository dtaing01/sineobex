import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  definitionModel,
  effectiveAnswers,
  fieldAt,
  isSensitiveCode,
  mayBeHidden,
  PRESETS,
  visibleAnswers,
  type AnswerTest,
  type Holds,
  type Leaf,
  type NoteReader,
  type ResolvedNoteType,
  type SensitiveCodeRange,
} from '../../src/index.ts';

// Where visibleAnswers may take an answer out (phase 5 design 4.4, D138): a supply map is refused
// (`sensitive_path`) when what it fires on lies there, since a supply line is read by people with
// inventory.view and billing.view_codes and would tell them what was found. One function decides
// it, beside visibleAnswers, and this file holds the two together: on every released note type that
// is not sensitive, and on the made-up definitions of forms-conformance.json, for every reader of
// forms 7.1 for whom visibleAnswers is not null, whatever it takes out lies where mayBeHidden
// answers true. Then the cases of 4.4, one by one.
//
// The signature these tests are written to, in packages/forms/src/interp/may-be-hidden.ts and
// exported from the package index (P0-hideable); validatePreset in the presets package calls it
// (P0-validate):
//
//   /** What a supply map fires on at its path: the presets package's `when`, which forms cannot import. */
//   export type AnswerTest = { equals: string | number | boolean } | { includes: string } | { answered: true };
//   /**
//    * Whether visibleAnswers may take out, from a reader who may read a note of this definition,
//    * what a test of `path` reads: with no path, the note type as a whole (true exactly when it is
//    * sensitive); with a path and no `when`, any answer there, as `{answered: true}` (what a
//    * `fromPath` reads). A path is an answer path without an entry part, as `mapsTo` writes one; a
//    * path the definition does not have may be hidden.
//    */
//   export function mayBeHidden(definition: ResolvedNoteType, path?: string, when?: AnswerTest): boolean;
//
// The Medical gate is not mayBeHidden's: every standard role that reads supply lines reads Medical
// notes (0002), so a Medical-only note type is not hidden for this rule.

/** The newest version of each released note type. */
const released = new Map<string, ResolvedNoteType>();
for (const preset of PRESETS)
  if ((released.get(preset.key)?.version ?? 0) < preset.version) released.set(preset.key, preset.definition);
const def = (key: string) => released.get(key)!;

const conformance = JSON.parse(
  readFileSync(new URL('../../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
) as { definitions: Record<string, ResolvedNoteType> };
const demo = (name: string) => conformance.definitions[name]!;

/** Phase 3's sensitive diagnosis codes, from the file the API's list is generated from. */
const SENSITIVE_CODES: SensitiveCodeRange[] = readFileSync(
  new URL('../../../contract/data/sensitive-code-ranges.csv', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('from,'))
  .map((line) => {
    const [from, to] = line.split(',');
    return { from: from!, to: to! };
  });

/** Every reader of forms 7.1: each of the six facts true or false, with phase 3's sensitive codes. */
const READERS: NoteReader[] = Array.from({ length: 64 }, (_, n) => ({
  actsAsAuthor: (n & 1) !== 0,
  viewSensitive: (n & 2) !== 0,
  viewSensitiveExams: (n & 4) !== 0,
  readsMedical: (n & 8) !== 0,
  chartsMedical: (n & 16) !== 0,
  ordersMedications: (n & 32) !== 0,
  sensitiveCodes: SENSITIVE_CODES,
}));

/** A reader who may read the note and sees the least of it: who loses everything any reader loses. */
const LEAST: NoteReader = {
  actsAsAuthor: false,
  viewSensitive: false,
  viewSensitiveExams: false,
  readsMedical: true,
  chartsMedical: false,
  ordersMedications: false,
  sensitiveCodes: SENSITIVE_CODES,
};

const ENTRY = 'e0000001';
const ENTRY_AT = '2026-01-01T00:00:00Z';
const SENSITIVE_CODE = 'F11.20';
const PLAIN_CODE = 'J45';

/** Every option a choose-many can hold together: no exclusive one, and of a blocked pair, the first. */
function holdable(holds: Extract<Holds, { type: 'codes' }>): string[] {
  let codes = holds.options.filter((o) => !o.exclusive).map((o) => o.code);
  for (const [one, other] of holds.excludes)
    if (codes.includes(one) && codes.includes(other)) codes = codes.filter((code) => code !== other);
  return codes.length > 0 ? codes : holds.options.slice(0, 1).map((o) => o.code);
}

function filled(holds: Holds, problemCode: string): unknown {
  switch (holds.type) {
    case 'codes':
      return holds.many ? holdable(holds) : holds.options.at(-1)?.code;
    case 'flag':
      return true;
    case 'text':
      return 'Demo'.slice(0, holds.maxLength);
    case 'number':
      return holds.min;
    case 'date':
      return '2026-01-01';
    case 'time':
      return '12:00';
    case 'duration':
      return Math.min(10, holds.max);
    case 'problemCode':
      return problemCode;
    case 'problemLabel':
      return 'Demo problem';
  }
}

/**
 * Answer sets that between them put an answer that counts at every path some answers can open:
 * every leaf filled (once with a sensitive diagnosis, once with a plain one), then each code
 * answer in turn holding each one of its options alone, so a field a single code opens shows and a
 * choose-many holding only a marked code is tried.
 */
function answerSets(definition: ResolvedNoteType): Record<string, unknown>[] {
  const model = definitionModel(definition);
  const pathOf = (leaf: Leaf) =>
    leaf.node.section.section.repeat ? [leaf.parts[0], ENTRY, ...leaf.parts.slice(1)].join('.') : leaf.key;
  const every = (problemCode: string) => {
    const answers: Record<string, unknown> = {};
    for (const section of model.sections)
      if (section.section.repeat) answers[`${section.section.id}.${ENTRY}.entryAt`] = ENTRY_AT;
    for (const leaf of model.leaves.values()) {
      const value = filled(leaf.holds, problemCode);
      if (value !== undefined) answers[pathOf(leaf)] = value;
    }
    return answers;
  };
  const sets = [every(SENSITIVE_CODE), every(PLAIN_CODE)];
  for (const leaf of model.leaves.values()) {
    if (leaf.holds.type !== 'codes') continue;
    for (const option of leaf.holds.options)
      sets.push({ ...sets[0], [pathOf(leaf)]: leaf.holds.many ? [option.code] : option.code });
  }
  return sets;
}

const codesOf = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? (value as string[]) : [];

/**
 * Each test of `key` that reads `value`, as a map's `when` would: answered, then equals and
 * includes of each code it holds, or equals of the number or tick.
 */
function testsOf(value: unknown): AnswerTest[] {
  const tests: AnswerTest[] = [{ answered: true }];
  for (const code of codesOf(value)) tests.push({ equals: code }, { includes: code });
  if (typeof value === 'number' || value === true) tests.push({ equals: value });
  return tests;
}

/**
 * What visibleAnswers takes out of `answers` (whose answers that count are `counted`) for `reader`,
 * each with the tests a map's `when` would read differently for it; null when the reader may not
 * read the note.
 */
function takenOut(
  definition: ResolvedNoteType,
  answers: Record<string, unknown>,
  counted: Record<string, unknown>,
  reader: NoteReader,
): { path: string; key: string; tests: AnswerTest[] }[] | null {
  const seen = visibleAnswers(definition, answers, reader);
  if (seen === null) return null;
  const out: { path: string; key: string; tests: AnswerTest[] }[] = [];
  for (const [path, value] of Object.entries(counted)) {
    const target = fieldAt(definition, path)!;
    // An entry's own answers are no path a map may name (validatePreset refuses them).
    if (target.points === 'entry') continue;
    if (!Object.hasOwn(seen, path)) {
      out.push({ path, key: target.key, tests: testsOf(value) });
      continue;
    }
    const left = codesOf(seen[path]);
    const lost = codesOf(value).filter((code) => !left.includes(code));
    if (lost.length > 0)
      out.push({
        path,
        key: target.key,
        // The whole answer is no longer what it was: an `equals` of any code it held reads otherwise.
        tests: [
          ...lost.map((code) => ({ includes: code })),
          ...codesOf(value).map((code) => ({ equals: code })),
        ],
      });
  }
  for (const path of Object.keys(seen)) expect(Object.hasOwn(counted, path), path).toBe(true);
  return out;
}

/**
 * Holds mayBeHidden to visibleAnswers on one definition: every reader on the two full answer
 * sets, and on the single-option ones the reader who loses the most. Answers how many tests of
 * something taken out it checked.
 */
function holdsToVisibleAnswers(definition: ResolvedNoteType): number {
  let checked = 0;
  for (const [index, answers] of answerSets(definition).entries()) {
    const counted = effectiveAnswers(definition, answers);
    for (const reader of index < 2 ? READERS : [LEAST]) {
      const out = takenOut(definition, answers, counted, reader);
      if (!out) continue;
      const who = JSON.stringify({ ...reader, sensitiveCodes: undefined });
      for (const { path, key, tests } of out)
        for (const test of tests) {
          checked++;
          if (!mayBeHidden(definition, key, test))
            expect.fail(`${definition.key}: ${path} (${JSON.stringify(test)}) is taken out for ${who}`);
        }
    }
  }
  return checked;
}

// visibleAnswers on a general primary care note of every answer, for each answer set: seconds.
const SLOW = 120_000;

const NOT_SENSITIVE = [...released.values()].filter((d) => d.sensitivity !== 'sensitive');
const MADE_UP = Object.entries(conformance.definitions).filter(([, d]) => d.sensitivity !== 'sensitive');

describe('mayBeHidden', () => {
  it('is exported from the package index', () => {
    expect(typeof mayBeHidden).toBe('function');
  });

  it('is held to visibleAnswers on enough of the right definitions', () => {
    expect(NOT_SENSITIVE.map((d) => d.key).sort()).toEqual([
      'general_primary_care',
      'outreach',
      'quick_encounter',
      'red_flags_disposition',
      'social_needs',
      'wound_care',
    ]);
    // Between them the made-up definitions mark a section, an option, a grid row, a region and an
    // Other option as sensitive exams, a section as a treatment record, and hold diagnoses.
    const json = JSON.stringify(MADE_UP.map(([, d]) => d));
    for (const mark of [
      '"sensitiveExam":true',
      '"treatmentRecord":true',
      '"kind":"problem"',
      '"kind":"region"',
    ])
      expect(json, mark).toContain(mark);
    expect(isSensitiveCode(SENSITIVE_CODE, SENSITIVE_CODES)).toBe(true);
    expect(isSensitiveCode(PLAIN_CODE, SENSITIVE_CODES)).toBe(false);
  });

  for (const definition of NOT_SENSITIVE)
    it(
      `answers true wherever visibleAnswers takes something out of a ${definition.key} note`,
      () => {
        const checked = holdsToVisibleAnswers(definition);
        // A general primary care note loses its sensitive exams and its diagnoses to some readers.
        if (definition.key === 'general_primary_care') expect(checked).toBeGreaterThan(100);
      },
      SLOW,
    );

  it(
    'answers true wherever visibleAnswers takes something out of a made-up note',
    () => {
      let checked = 0;
      for (const [, definition] of MADE_UP) checked += holdsToVisibleAnswers(definition);
      expect(checked).toBeGreaterThan(50);
    },
    SLOW,
  );

  describe('the cases of 4.4', () => {
    const gpc = () => def('general_primary_care');

    it('lets a map include an unmarked exam system, and refuses every other test of the exam picker', () => {
      // sensitive-exams.ts takes out only the marked codes, and the whole answer when nothing else is left.
      expect(mayBeHidden(gpc(), 'exam.systems', { includes: 'skin' })).toBe(false);
      expect(mayBeHidden(gpc(), 'exam.systems', { includes: 'heent' })).toBe(false);
      for (const code of ['gu', 'breast', 'rectal'])
        expect(mayBeHidden(gpc(), 'exam.systems', { includes: code }), code).toBe(true);
      expect(mayBeHidden(gpc(), 'exam.systems', { equals: 'gu' })).toBe(true);
      expect(mayBeHidden(gpc(), 'exam.systems', { equals: 'skin' })).toBe(true);
      expect(mayBeHidden(gpc(), 'exam.systems', { answered: true })).toBe(true);
      // With no `when`, any answer there, as a fromPath reads it.
      expect(mayBeHidden(gpc(), 'exam.systems')).toBe(true);
    });

    it('refuses anything in a section marked as a sensitive exam', () => {
      expect(mayBeHidden(gpc(), 'gu.general', { includes: 'dysuria' })).toBe(true);
      expect(mayBeHidden(gpc(), 'gu.performed', { answered: true })).toBe(true);
      expect(mayBeHidden(gpc(), 'breast.mass.size', { answered: true })).toBe(true);
      expect(mayBeHidden(gpc(), 'breast.mass.size')).toBe(true);
      expect(mayBeHidden(gpc(), 'rectal.findings', { includes: 'mass' })).toBe(true);
      expect(mayBeHidden(demo('exam'), 'gu.consent', { equals: 'yes' })).toBe(true);
    });

    it('refuses anything in a section that holds a diagnosis, repeating or not', () => {
      expect(mayBeHidden(gpc(), 'problems.status', { equals: 'new' })).toBe(true);
      expect(mayBeHidden(gpc(), 'problems.interventions', { includes: 'supplies' })).toBe(true);
      expect(mayBeHidden(demo('problems'), 'dx.status', { equals: 'ongoing' })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'reason.since', { answered: true })).toBe(true);
      expect(mayBeHidden(demo('rules'), 'dx.notes', { answered: true })).toBe(true);
      expect(mayBeHidden(demo('rehab'), 'assess.dx.code', { answered: true })).toBe(true);
      // A section beside it is not.
      expect(mayBeHidden(demo('rehab'), 'assessMore.more', { answered: true })).toBe(false);
    });

    it('refuses a treatment record’s answers, in a note type that is not sensitive', () => {
      expect(mayBeHidden(demo('rehab'), 'care.plan', { answered: true })).toBe(true);
      expect(mayBeHidden(demo('rehab'), 'strength.hands.grip.score', { answered: true })).toBe(false);
    });

    it('refuses a grid row marked as a sensitive exam, and only that row', () => {
      expect(mayBeHidden(demo('intake'), 'body.marks.groin', { equals: 'bruise' })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'body.marks.head', { equals: 'bruise' })).toBe(false);
      expect(mayBeHidden(demo('intake'), 'body.marks.head', { answered: true })).toBe(false);
    });

    it('refuses every part of a region one of whose regions is marked', () => {
      expect(mayBeHidden(demo('intake'), 'body.spot.region', { answered: true })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'body.spot.side', { answered: true })).toBe(true);
      expect(mayBeHidden(demo('checkup'), 'limbs.limb.region', { includes: 'arm' })).toBe(true);
      // The rest of the entry stays for the reader, so it is not hidden.
      expect(mayBeHidden(demo('checkup'), 'limbs.tone', { equals: 'normal' })).toBe(false);
    });

    it('refuses the Other text of a marked Other option, and a marked option, and lets the rest through', () => {
      expect(mayBeHidden(demo('intake'), 'body.areas', { includes: 'head' })).toBe(false);
      expect(mayBeHidden(demo('intake'), 'body.areas', { includes: 'other' })).toBe(false);
      expect(mayBeHidden(demo('intake'), 'body.areas', { includes: 'groin' })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'body.areas', { includes: 'private' })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'body.areas', { equals: 'head' })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'body.areas', { answered: true })).toBe(true);
      expect(mayBeHidden(demo('intake'), 'body.areas_other', { answered: true })).toBe(true);
    });

    it('refuses a sensitive note type as a whole, and with any path in it', () => {
      for (const key of ['harm_reduction', 'psychological', 'sexual_reproductive']) {
        expect(def(key).sensitivity, key).toBe('sensitive');
        expect(mayBeHidden(def(key)), key).toBe(true);
      }
      // The PRD's naloxone example (main 428) is in harm reduction, so it cannot be mapped (12.2).
      expect(mayBeHidden(def('harm_reduction'), 'provided.naloxone', { equals: 'accepted' })).toBe(true);
      expect(mayBeHidden(def('harm_reduction'), 'provided.naloxone_doses')).toBe(true);
      expect(
        mayBeHidden(def('sexual_reproductive'), 'prevention.provided', { includes: 'condoms_provided' }),
      ).toBe(true);
    });

    it('lets a whole note type through that is not sensitive, Medical-only ones included', () => {
      for (const definition of NOT_SENSITIVE) expect(mayBeHidden(definition), definition.key).toBe(false);
      expect(def('wound_care').kinds).toEqual(['medical']);
    });

    it('lets through the paths the platform maps, which no reader loses', () => {
      expect(mayBeHidden(gpc(), 'preventive.vaccine_status.flu', { equals: 'given_today' })).toBe(false);
      expect(mayBeHidden(gpc(), 'preventive.vaccine_status.shingles', { equals: 'given_today' })).toBe(false);
      expect(mayBeHidden(def('wound_care'), 'wound.treatment.dressing', { answered: true })).toBe(false);
      expect(mayBeHidden(def('wound_care'), 'wound.treatment.dressing', { includes: 'xeroform' })).toBe(
        false,
      );
      expect(mayBeHidden(def('quick_encounter'), 'wound.dressing', { includes: 'abd' })).toBe(false);
      expect(mayBeHidden(def('outreach'), 'outreach.support', { includes: 'food' })).toBe(false);
      expect(mayBeHidden(def('quick_encounter'), 'social.support', { includes: 'socks' })).toBe(false);
    });

    it('lets through a group cell, a number read for a quantity, and a repeating section’s fields', () => {
      expect(mayBeHidden(gpc(), 'lymphatic.node_findings.cervical.findings', { includes: 'enlarged' })).toBe(
        false,
      );
      expect(mayBeHidden(gpc(), 'lymphatic.node_findings.cervical.size')).toBe(false);
      expect(mayBeHidden(gpc(), 'vitals.hr', { answered: true })).toBe(false);
      expect(mayBeHidden(gpc(), 'msk.shoulder_tests.neer', { equals: 'positive' })).toBe(false);
      expect(mayBeHidden(def('wound_care'), 'wound.measurements.length')).toBe(false);
    });

    it('lets a section that needs a capability through: needs decides who changes an answer, not who reads it', () => {
      expect(def('quick_encounter').sections.find((s) => s.id === 'medication')?.needs).toBe(
        'orderMedications',
      );
      expect(mayBeHidden(def('quick_encounter'), 'medication.order', { includes: 'otc' })).toBe(false);
    });

    it('takes a path the definition does not have as hidden, so nothing fires on what cannot be read', () => {
      expect(mayBeHidden(gpc(), 'exam.nothing_here', { answered: true })).toBe(true);
      expect(mayBeHidden(gpc(), 'no_section.field')).toBe(true);
    });
  });
});
