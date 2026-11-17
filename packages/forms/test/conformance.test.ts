import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/interp/check-answer.ts';
import type { Answers } from '../src/interp/conditions.ts';
import { effectiveAnswers } from '../src/interp/effective.ts';
import { expandQuick } from '../src/interp/expand.ts';
import type { NewEntries } from '../src/interp/expand.ts';
import { finishCheck } from '../src/interp/finish.ts';
import { handoffLines } from '../src/interp/handoff.ts';
import { normalAnswers } from '../src/interp/normal.ts';
import { readModel } from '../src/interp/read-model.ts';
import type { NoteCorrection } from '../src/interp/read-model.ts';
import { recapLines } from '../src/interp/recap.ts';
import { suggestions } from '../src/interp/suggestions.ts';
import { visibleAnswers } from '../src/interp/visible.ts';
import type { NoteReader } from '../src/interp/visible.ts';
import { fieldAt } from '../src/interp/field-at.ts';
import { pathModel } from '../src/paths.ts';
import type { ResolvedNoteType } from '../src/resolve.ts';
import type { Condition, Option } from '../src/types.ts';
import { validate } from '../src/validate.ts';
import * as forms from '../src/index.ts';

// The interpreter's answers are data (docs/design/phase-4/forms.md, 7.2): they live in
// packages/contract/test-vectors/forms-conformance.json, and the phone's conformance_test.dart reads
// the same file. This reader holds no answer of its own.

type Case = { name: string; definition: string; expected: unknown } & Record<string, unknown>;
type Vectors = {
  definitions: Record<string, ResolvedNoteType>;
  cases: Record<string, Case[]>;
};

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
) as Vectors;

// The newest version of each note type: what a mapsTo, suggests or action names (forms.md 6.4). The
// file holds an older version of the quick note type too, which the validator does not hold to the
// newest full note types, as Expand from an old draft must cope with.
const byKey = new Map<string, ResolvedNoteType>();
for (const d of Object.values(vectors.definitions))
  if ((byKey.get(d.key)?.version ?? 0) < d.version) byKey.set(d.key, d);

/** Each function, called with a case's definition and its other inputs. */
const FUNCTIONS: Record<string, (definition: ResolvedNoteType, c: Case) => unknown> = {
  // What a path points at, as plain data both readers can give: the place in the definition is
  // written as the path model writes it ($.sections[0].fields[2].cell.options[1]).
  fieldAt: (definition, c) => {
    const target = fieldAt(definition, c.path as string);
    if (!target) return null;
    const { points, at, entry, row, side, part, holds } = target;
    return { points, at, entry, row, side, part, stores: holds !== null };
  },
  checkAnswer: (definition, c) => checkAnswer(definition, c.path as string, c.value),
  effectiveAnswers: (definition, c) => effectiveAnswers(definition, c.answers as Answers),
  finishCheck: (definition, c) => finishCheck(definition, c.answers as Answers),
  normalAnswers: (definition, c) =>
    normalAnswers(definition, c.section as string, c.answers as Answers, c.entry as string | undefined),
  recapLines: (definition, c) => recapLines(definition, c.answers as Answers),
  readModel: (definition, c) =>
    readModel(definition, c.answers as Answers, c.corrections as NoteCorrection[]),
  visibleAnswers: (definition, c) => visibleAnswers(definition, c.answers as Answers, c.reader as NoteReader),
  suggestions: (definition, c) => suggestions(definition, c.answers as Answers),
  // `full` names the full note type's definition: the newest version, as Expand writes into.
  expandQuick: (definition, c) =>
    expandQuick(
      definition,
      c.answers as Answers,
      vectors.definitions[c.full as string]!,
      c.newEntryIds as NewEntries,
    ),
  // A handoff reads every note of a visit: `notes` names each one's definition, and the case's own
  // `definition` is the first's.
  handoffLines: (_, c) => {
    const notes = c.notes as { definition: string; answers: Answers | null }[];
    return handoffLines(
      notes.map((n) => vectors.definitions[n.definition]!),
      notes.map((n) => n.answers),
    );
  },
};

describe('the conformance definitions', () => {
  for (const [name, definition] of Object.entries(vectors.definitions))
    it(`${name} passes the validator`, () => {
      // The other definitions of the file are the note types a mapsTo, suggests or action may name.
      expect(validate(definition, { noteType: (key) => byKey.get(key) })).toEqual([]);
    });

  it('give each version of a note type once', () => {
    const versions = Object.values(vectors.definitions).map((d) => `${d.key} v${d.version}`);
    expect(new Set(versions).size).toBe(versions.length);
  });

  // What 7.2 asks the definitions to use between them, so a later edit cannot quietly lose one.
  it('use every kind, option flag, condition form and section mark between them', () => {
    const used = new Set<string>();
    const condition = (c: Condition, where: string, relative: string): void => {
      if ('all' in c) {
        used.add(`${where} all`);
        return c.all.forEach((d) => condition(d, where, relative));
      }
      if ('any' in c) {
        used.add(`${where} any`);
        return c.any.forEach((d) => condition(d, where, relative));
      }
      if ('not' in c) {
        used.add(`${where} not`);
        return condition(c.not, where, relative);
      }
      if (c.field.startsWith('./')) used.add(`./ in ${relative}`);
      used.add('filled' in c ? `${where} filled` : `${where} is ${Array.isArray(c.is) ? 'list' : 'one'}`);
    };
    const options = (list: Option[]) =>
      list.forEach((o) =>
        Object.keys(o).forEach((k) => k !== 'code' && k !== 'label' && used.add(`option ${k}`)),
      );
    for (const definition of Object.values(vectors.definitions)) {
      used.add(`note ${definition.sensitivity}`);
      if (definition.quick) used.add('quick');
      for (const s of pathModel(definition).sections) {
        for (const mark of ['sensitiveExam', 'treatmentRecord', 'needs', 'repeat', 'normal'] as const)
          if (s.section[mark] !== undefined) used.add(`section ${mark}`);
        if (s.section.showWhen) condition(s.section.showWhen, 'section', 'section');
      }
      for (const { field, grid } of pathModel(definition).nodes) {
        used.add(`kind ${field.kind}`);
        for (const key of ['sides', 'handoff', 'mapsTo', 'required', 'noNormal', 'recap', 'help'] as const)
          if (field[key] !== undefined) used.add(`field ${key}`);
        if (field.showWhen) condition(field.showWhen, 'field', grid ? 'cell' : 'entry');
        if (field.kind === 'choice') options(field.options);
        if (field.kind === 'flag' && field.clears) used.add('flag clears');
        if (field.kind === 'number' && field.normal !== undefined) used.add('number normal');
        if (field.kind === 'number' && field.altUnit) used.add('number altUnit');
        if (field.kind === 'grid') used.add(Array.isArray(field.rows) ? 'grid rows' : 'grid pickedIn');
        if (field.kind === 'region' && field.side) used.add('region side');
        if (field.kind === 'region' && field.surface) used.add('region surface');
        if (field.kind === 'region') options(field.options);
        if (field.kind === 'grid' && Array.isArray(field.rows)) options(field.rows);
      }
    }
    const kinds = ['choice', 'text', 'number', 'flag', 'date', 'time', 'duration', 'group', 'grid', 'region'];
    const flags = ['exclusive', 'other', 'normal', 'unable', 'icon', 'suggests', 'sensitiveExam'];
    const forms = ['is one', 'is list', 'filled', 'all', 'any', 'not'];
    const wanted = [
      ...[...kinds, 'problem', 'photo', 'action', 'info'].map((k) => `kind ${k}`),
      ...flags.map((f) => `option ${f}`),
      ...forms.flatMap((f) => [`section ${f}`, `field ${f}`]),
      ...['sensitiveExam', 'treatmentRecord', 'needs', 'repeat', 'normal'].map((m) => `section ${m}`),
      './ in entry',
      './ in cell',
      'note sensitive',
      'quick',
      'field sides',
      'field handoff',
      'field mapsTo',
      'flag clears',
      'number normal',
      'number altUnit',
      'grid rows',
      'grid pickedIn',
      'region side',
      'region surface',
    ];
    expect(wanted.filter((w) => !used.has(w))).toEqual([]);
  });
});

// The table of forms.md 7.1: each function of the interpreter and how many arguments it takes.
const INTERPRETER: Record<string, number> = {
  fieldAt: 2,
  checkAnswer: 3,
  effectiveAnswers: 2,
  finishCheck: 2,
  normalAnswers: 4,
  recapLines: 2,
  readModel: 3,
  visibleAnswers: 3,
  handoffLines: 2,
  suggestions: 2,
  expandQuick: 4,
};

describe('the interpreter', () => {
  it('is every function of the table in 7.1, run by this reader', () => {
    expect(Object.keys(FUNCTIONS).sort()).toEqual(Object.keys(INTERPRETER).sort());
  });

  // The API and the scripts import the package's index, never a file inside it.
  for (const [name, arity] of Object.entries(INTERPRETER))
    it(`exports ${name} from the package, taking ${arity} arguments`, () => {
      const fn = (forms as Record<string, unknown>)[name];
      expect(typeof fn).toBe('function');
      expect((fn as (...args: unknown[]) => unknown).length).toBe(arity);
    });
});

describe('the conformance cases', () => {
  it('are for each function of the interpreter and for nothing else', () => {
    expect(Object.keys(vectors.cases).sort()).toEqual(Object.keys(FUNCTIONS).sort());
  });

  for (const [fn, cases] of Object.entries(vectors.cases))
    describe(fn, () => {
      it('has cases, each named once, each on a definition of the file', () => {
        expect(cases.length).toBeGreaterThan(0);
        expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
        for (const c of cases) {
          expect(Object.keys(vectors.definitions), c.name).toContain(c.definition);
          if (c.full !== undefined) expect(Object.keys(vectors.definitions), c.name).toContain(c.full);
          for (const n of (c.notes ?? []) as { definition: string }[])
            expect(Object.keys(vectors.definitions), c.name).toContain(n.definition);
        }
      });

      const run = FUNCTIONS[fn];
      if (run)
        for (const c of cases)
          it(c.name, () => {
            expect(run(vectors.definitions[c.definition]!, c)).toEqual(c.expected);
          });
    });
});
