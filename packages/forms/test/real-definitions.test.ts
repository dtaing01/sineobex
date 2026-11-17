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
  ];
  it.each(REFUSED)('%s refuses %j', (path, value) => {
    expect(checkAnswer(general, path, value)).not.toBeNull();
  });
});
