import { describe, expect, it } from 'vitest';
import { resolve, type ResolvedNoteType } from '../src/resolve.ts';
import { validate } from '../src/validate.ts';
import { definitionFiles, type LooseFiles } from './fixtures/load.ts';

// Every rule of the validator, the same way: the fixture tree passes, and the tree with exactly
// one change fails with that rule's code, in the file and at the place where the change was made.

const CHECKS = 'note-types/checks_demo/v1.json';
const FULL = 'note-types/full_demo/v1.json';
const EXAM = 'modules/demo_exam/v1.json';
const list = (name: string) => `lists/${name}.json`;

/** The newest version of a note type among the files, resolved: what the export hands the validator. */
const newest = (files: LooseFiles) => (key: string) => {
  const versions = Object.keys(files.noteTypes)
    .filter((file) => file.startsWith(`note-types/${key}/`))
    .sort((a, b) => files.noteTypes[a].version - files.noteTypes[b].version);
  const file = versions.at(-1);
  return file ? resolved(files, file).definition : undefined;
};

function resolved(files: LooseFiles, file: string) {
  const result = resolve(file, files);
  if (!result.ok) throw new Error(`${file} did not resolve: ${JSON.stringify(result.problems)}`);
  return result;
}

type Expected = [file: string, path: string, rule: string];
const sorted = (found: Expected[]) => found.map((p) => p.join('  ')).sort();

function problems(files: LooseFiles, file = CHECKS) {
  const { definition, origins } = resolved(files, file);
  return validate(definition, { origins, noteType: newest(files) });
}
const found = (files: LooseFiles, file = CHECKS) =>
  sorted(problems(files, file).map((p): Expected => [p.file, p.path, p.rule]));

/** The fixture tree with one change, and exactly the problems that change should give. */
function broken(name: string, change: (files: LooseFiles) => void, ...expected: Expected[]) {
  it(name, () => {
    const files = definitionFiles();
    change(files);
    expect(found(files)).toEqual(sorted(expected));
    for (const p of problems(files)) expect(p.message.length, p.rule).toBeGreaterThan(10);
  });
}
/** The fixture tree with one change that every rule still allows. */
function fits(name: string, change: (files: LooseFiles) => void) {
  it(name, () => {
    const files = definitionFiles();
    change(files);
    expect(found(files)).toEqual([]);
  });
}

// Places in checks_demo, as its file writes them.
const FINDINGS = '$.sections[2]';
const STATUS = '$.sections[3]';
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a file is changed as plain JSON */
type Loose = any;
const checks = (files: LooseFiles): Loose => files.noteTypes[CHECKS];
const visit = (files: LooseFiles, field: string): Loose =>
  checks(files).sections[0].fields.find((f: Loose) => f.id === field);
const findings = (files: LooseFiles, field: string): Loose =>
  checks(files).sections[2].fields.find((f: Loose) => f.id === field);
const status = (files: LooseFiles, field: string): Loose =>
  checks(files).sections[3].fields.find((f: Loose) => f.id === field);
const exam = (files: LooseFiles): Loose => files.modules[EXAM];
/** Where a field of the Visit section is, by its id. */
const at = (files: LooseFiles, section: number, field: string) =>
  `$.sections[${section}].fields[${checks(files).sections[section].fields.findIndex((f: Loose) => f.id === field)}]`;
const base = definitionFiles();
const V = (field: string) => at(base, 0, field);
const F = (field: string) => at(base, 2, field);
const S = (field: string) => at(base, 3, field);

describe('the fixture tree', () => {
  it('passes: both note types, with every kind of field between them', () => {
    expect(found(definitionFiles(), CHECKS)).toEqual([]);
    expect(found(definitionFiles(), FULL)).toEqual([]);
    const kinds = new Set<string>();
    const walk = (fields: Loose[]) =>
      fields.forEach((f) => {
        kinds.add(f.kind);
        walk(f.fields ?? (f.cell ? [f.cell] : []));
      });
    for (const file of [CHECKS, FULL])
      (resolved(definitionFiles(), file).definition as ResolvedNoteType).sections.forEach((s) =>
        walk(s.fields),
      );
    expect(kinds.size).toBe(14);
  });

  it('without origins, a problem is placed in the resolved definition, in the file its key and version give', () => {
    const files = definitionFiles();
    exam(files).sections[1].id = 'visit';
    const { definition } = resolved(files, CHECKS);
    expect(validate(definition, { noteType: newest(files) }).map((p) => [p.file, p.path, p.rule])).toEqual([
      [CHECKS, '$.sections[2].id', 'validate.duplicate_section_id'],
    ]);
  });
});

describe('ids', () => {
  broken('two sections with one id', (f) => (checks(f).sections[3].id = 'visit'), [
    CHECKS,
    `${STATUS}.id`,
    'validate.duplicate_section_id',
  ]);
  broken(
    'a module’s section with the id of a section of the note type: the module’s file is named',
    (f) => (exam(f).sections[1].id = 'visit'),
    [EXAM, '$.sections[1].id', 'validate.duplicate_section_id'],
  );
  broken(
    'a section of the note type with the id of an included section before it',
    (f) => (checks(f).sections[2].id = 'ears'),
    [CHECKS, `${FINDINGS}.id`, 'validate.duplicate_section_id'],
  );

  broken('two fields of a section with one id', (f) => (visit(f, 'called').id = 'onset'), [
    CHECKS,
    `${V('called')}.id`,
    'validate.duplicate_field_id',
  ]);
  broken('two fields of a group with one id', (f) => (visit(f, 'pressure').fields[1].id = 'upper'), [
    CHECKS,
    `${V('pressure')}.fields[1].id`,
    'validate.duplicate_field_id',
  ]);
  broken(
    'two fields with one id in the group that is a grid’s cell',
    (f) => {
      status(f, 'each').cell.fields[1].id = 'seen';
    },
    [CHECKS, `${S('each')}.cell.fields[1].id`, 'validate.duplicate_field_id'],
  );
  fits('one id in two sections', (f) => (findings(f, 'diagnosis').id = 'onset'));
  fits('a field of a group with the id of a field beside the group', (f) => {
    visit(f, 'pressure').fields[0].id = 'onset';
  });
  fits('a group’s field with the id of the group', (f) => (visit(f, 'pressure').fields[0].id = 'pressure'));

  broken('a field named entryAt in a repeating section', (f) => (findings(f, 'diagnosis').id = 'entryAt'), [
    CHECKS,
    `${F('diagnosis')}.id`,
    'validate.reserved_id',
  ]);
  broken('a field named entryRemoved anywhere', (f) => (visit(f, 'onset').id = 'entryRemoved'), [
    CHECKS,
    `${V('onset')}.id`,
    'validate.reserved_id',
  ]);
  broken('a reserved id in a group', (f) => (visit(f, 'pressure').fields[0].id = 'entryAt'), [
    CHECKS,
    `${V('pressure')}.fields[0].id`,
    'validate.reserved_id',
  ]);
  broken('a reserved id on the cell of a grid', (f) => (findings(f, 'pulses').cell.id = 'entryRemoved'), [
    CHECKS,
    `${F('pulses')}.cell.id`,
    'validate.reserved_id',
  ]);
  fits('an id that only starts like a reserved one', (f) => (visit(f, 'onset').id = 'entryAtDoor'));
});

describe('option codes', () => {
  broken('a code used twice in a choice', (f) => (visit(f, 'plan').options[2].code = 'sent'), [
    CHECKS,
    `${V('plan')}.options[2].code`,
    'validate.duplicate_code',
  ]);
  // demo_yes_no is used by three fields of the note type. The fault is the list's, once.
  broken(
    'a code used twice in a shared list: the list’s file is named, once',
    (f) => {
      f.lists[list('demo_yes_no')].options.push({ code: 'yes', label: 'Yes again' });
    },
    [list('demo_yes_no'), '$.options[2].code', 'validate.duplicate_code'],
  );
  broken('a code used twice in the rows of a grid', (f) => (status(f, 'reflexes').rows[1].code = 'knee'), [
    CHECKS,
    `${S('reflexes')}.rows[1].code`,
    'validate.duplicate_code',
  ]);
  broken(
    'a code used twice in a list that gives a grid its rows',
    (f) => f.lists[list('demo_sites')].options.push({ code: 'radial', label: 'Radial again' }),
    [list('demo_sites'), '$.options[2].code', 'validate.duplicate_code'],
  );
  broken(
    'a code used twice in the options of a region',
    (f) => f.lists[list('demo_regions')].options.push({ code: 'arm', label: 'Arm again' }),
    [list('demo_regions'), '$.options[3].code', 'validate.duplicate_code'],
  );
  broken(
    'a code used twice in the sides of a region',
    (f) => f.lists[list('side_rl')].options.push({ code: 'left', label: 'Left again' }),
    [list('side_rl'), '$.options[2].code', 'validate.duplicate_code'],
  );
  fits('one code in a region’s options and in its sides', (f) => {
    f.lists[list('demo_regions')].options.push({ code: 'left', label: 'Left flank' });
  });
  fits('one code in two fields', (f) => (visit(f, 'plan').options[2].code = 'eyes'));
  fits('two options with one label', (f) => (visit(f, 'plan').options[2].label = 'Sent to ED'));

  broken(
    'a blocked pair that names a code the field does not have',
    (f) => {
      visit(f, 'plan').excludes[0][1] = 'declned';
    },
    [CHECKS, `${V('plan')}.excludes[0][1]`, 'validate.excludes_unknown_code'],
  );
  broken('a blocked pair of one code with itself', (f) => (visit(f, 'plan').excludes[0][1] = 'sent'), [
    CHECKS,
    `${V('plan')}.excludes[0]`,
    'validate.excludes_same_code',
  ]);
  broken('blocked pairs on a choose-one field', (f) => (visit(f, 'plan').many = false), [
    CHECKS,
    `${V('plan')}.excludes`,
    'validate.excludes_in_choose_one',
  ]);
  fits('a second blocked pair', (f) => visit(f, 'plan').excludes.push(['follow_up', 'declined']));
});
