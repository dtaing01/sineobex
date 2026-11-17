import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/interp/check-answer.ts';
import type { Answers } from '../src/interp/conditions.ts';
import { effectiveAnswers } from '../src/interp/effective.ts';
import { normalAnswers } from '../src/interp/normal.ts';
import { noteTypeFile, resolve, type DefinitionFiles, type ResolvedNoteType } from '../src/resolve.ts';

// What a clinician meets on the real definitions, which the plans' tests (definitions.test.ts)
// cannot say: what one-tap Normal fills beside answers already charted, which findings can be held
// together, and what counts once a finding hands off to another note. Each case is a fault the
// review of wave D found in a plan; the interpreter is the one the server and the golden file use.

const root = fileURLToPath(new URL('../definitions/', import.meta.url));

function definitionFiles(): DefinitionFiles {
  const files = { noteTypes: {}, modules: {}, lists: {} } as Record<
    keyof DefinitionFiles,
    Record<string, unknown>
  >;
  for (const path of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (path.startsWith('spec/') || !statSync(join(root, path)).isFile()) continue;
    const kind = path.startsWith('note-types/')
      ? 'noteTypes'
      : path.startsWith('modules/')
        ? 'modules'
        : 'lists';
    files[kind][path] = JSON.parse(readFileSync(join(root, path), 'utf8'));
  }
  return files as unknown as DefinitionFiles;
}

const files = definitionFiles();
const definition = (key: string): ResolvedNoteType => {
  const resolution = resolve(noteTypeFile(key, 1), files);
  if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
  return resolution.definition;
};

const general = definition('general_primary_care');
const ENTRY = 'e1aaaaaa';
const AT = '2026-11-17T10:00:00Z';
/** A General note with these exam systems picked, and these answers. */
const exam = (systems: string[], answers: Answers = {}): Answers => ({ 'exam.systems': systems, ...answers });
/** What counts once one-tap Normal is tapped on a section (an entry of it, for a repeating one). */
const afterNormal = (d: ResolvedNoteType, section: string, answers: Answers, entry?: string) =>
  effectiveAnswers(d, { ...answers, ...normalAnswers(d, section, answers, entry) });

describe('one-tap Normal on the real definitions', () => {
  // GEN-1: PRD main 414 records left and right where it matters, and Normal fills the findings of
  // what was examined: a right knee examined says nothing of the left.
  it.each([
    ['knee', 'right', ['right']],
    ['shoulder', 'left', ['left']],
    ['hip', 'bilateral', ['left', 'right']],
  ])('records MSK strength only for the side examined (%s, %s)', (region, side, sides) => {
    const answers = exam(['msk'], {
      [`msk.${ENTRY}.entryAt`]: AT,
      [`msk.${ENTRY}.region`]: region,
      [`msk.${ENTRY}.side`]: side,
    });
    const strength = Object.entries(afterNormal(general, 'msk', answers, ENTRY)).filter(([path]) =>
      path.startsWith(`msk.${ENTRY}.strength`),
    );
    expect(strength.map(([, value]) => value)).toEqual(sides.map(() => 5));
    expect(strength.map(([path]) => (/right/.test(path) ? 'right' : 'left')).sort()).toEqual(sides);
  });
  // SEN-2: Normal never writes intact skin beside a wound the clinician has said is there.
  it('leaves the foot’s Inspection empty beside Wound present? Yes', () => {
    const after = afterNormal(
      general,
      'diabetic_foot',
      exam(['diabetic_foot'], { 'diabetic_foot.wound': 'yes' }),
    );
    expect(after['diabetic_foot.wound']).toBe('yes');
    expect(after['diabetic_foot.inspection']).toBeUndefined();
  });
  // SEN-3: a measured refill of 4 seconds and a Normal "Less than 2 seconds" never stand together.
  it('never holds a capillary refill under 2 seconds beside a refill time of 2 or more', () => {
    const after = afterNormal(
      general,
      'peripheral_vascular',
      exam(['peripheral_vascular'], { 'peripheral_vascular.refill_time': 4 }),
    );
    const time = after['peripheral_vascular.refill_time'] as number | undefined;
    expect(
      after['peripheral_vascular.refill'] === 'less_than_2_seconds' && time !== undefined && time >= 2,
    ).toBe(false);
    expect(checkAnswer(general, 'peripheral_vascular.refill_time', 1.5)).not.toBeNull();
  });
});

describe('findings a clinician charts together on the real definitions', () => {
  // GEN-2, GEN-3 and SEN-1: a normal option that describes one part of its list is held beside a
  // finding of another part, as Moist and Flat are (a reading of focused-exam default 13): only its
  // true opposite is refused.
  const HELD: [string, string[]][] = [
    ['heart.sounds', ['normal_s1_s2', 'murmur']],
    ['heart.sounds', ['normal_s1_s2', 'gallop']],
    ['mouth.airway', ['patent', 'swelling']],
    ['mouth.airway', ['patent', 'difficulty_managing_secretions']],
    ['neck_thyroid.neck', ['supple', 'lymphadenopathy']],
    ['neck_thyroid.neck', ['supple', 'mass']],
    ['neck_thyroid.neck', ['supple', 'tender']],
    ['neck_thyroid.neck', ['supple', 'jvd']],
    ['breast.finding', ['no_mass', 'tenderness']],
    ['diabetic_foot.inspection', ['intact_skin', 'callus']],
    ['diabetic_foot.inspection', ['intact_skin', 'deformity', 'nail_abnormality']],
  ];
  it.each(HELD)('%s takes %j', (path, value) => {
    expect(checkAnswer(general, path, value)).toBeNull();
  });

  const REFUSED: [string, string[]][] = [
    ['neck_thyroid.neck', ['supple', 'stiff']],
    ['breast.finding', ['no_mass', 'mass']],
    ['breast.finding', ['no_mass', 'nodule']],
    ['diabetic_foot.inspection', ['intact_skin', 'ulcer']],
    ['diabetic_foot.inspection', ['intact_skin', 'fissure']],
    ['diabetic_foot.inspection', ['intact_skin', 'blister']],
    ['diabetic_foot.inspection', ['intact_skin', 'necrosis']],
    // GEN-5: PERRLA is the normal pupils as PERRL is, and holds no abnormal pupil beside it.
    ['eyes.pupils', ['perrla', 'unequal_pupils']],
    ['eyes.pupils', ['perrla', 'sluggish_reaction']],
    ['eyes.pupils', ['perrla', 'nonreactive']],
  ];
  it.each(REFUSED)('%s refuses %j', (path, value) => {
    expect(checkAnswer(general, path, value)).not.toBeNull();
  });
});

describe('what hands off to another note on the real definitions', () => {
  // SEN-4: open skin hands off to Wound care "so nothing is charted twice" (PRD main 416, forms
  // 6.7): a Skin finding of Ulcer or Abscess keeps its location and type, and its measurements,
  // characteristics and photos are the wound's.
  const finding = (type: string[]) =>
    effectiveAnswers(
      general,
      exam(['skin'], {
        [`skin_findings.${ENTRY}.entryAt`]: AT,
        [`skin_findings.${ENTRY}.type`]: type,
        [`skin_findings.${ENTRY}.characteristics`]: ['draining'],
        [`skin_findings.${ENTRY}.size.length`]: 2,
        [`skin_findings.${ENTRY}.size.width`]: 1,
      }),
    );
  it.each([[['ulcer']], [['abscess']], [['rash', 'ulcer']]])(
    'charts no size or characteristics for %j',
    (type) => {
      const counted = Object.keys(finding(type)).filter((path) => path.startsWith(`skin_findings.${ENTRY}.`));
      expect(counted.sort()).toEqual([`skin_findings.${ENTRY}.entryAt`, `skin_findings.${ENTRY}.type`]);
    },
  );
  // TYP-2: the foot exam hands a foot wound to Wound care (PRD main 416), which must then be able to
  // say where it is; the quick form draws on the same list (PRD main 410).
  it.each([
    ['wound_care', `wound.${ENTRY}.location.region`],
    ['quick_encounter', 'wound.location.region'],
  ])('lets %s place a wound on the feet, the face or the groin', (key, path) => {
    for (const region of ['feet', 'face', 'groin'])
      expect(checkAnswer(definition(key), path, region), region).toBeNull();
  });
  it('charts them for a finding that stays in Skin', () => {
    expect(finding(['rash'])[`skin_findings.${ENTRY}.size.length`]).toBe(2);
  });
});

describe('what a later phase reads on the real definitions', () => {
  const redFlags = definition('red_flags_disposition');

  // TYP-3: the quick encounter's follow-up note (PRD main 404) has its one home in the Red flags
  // and disposition note, beside the date, where the phase 7 follow-up task reads it.
  it('keeps a follow-up note beside the follow-up the Red flags note records', () => {
    const note = 'Demo: recheck the wound at the camp on Friday';
    const after = effectiveAnswers(redFlags, {
      'follow_up.when': 'next_street_clinic',
      'follow_up.details': note,
    });
    expect(after['follow_up.details']).toBe(note);
  });
});
