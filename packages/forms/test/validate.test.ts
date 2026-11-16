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
const VISIT = '$.sections[0]';
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
    checks(f).sections[0].fields.push(GROUP('extra', TEXT('onset')));
  });
  fits('a group’s field with the id of the group', (f) => {
    checks(f).sections[0].fields.push(GROUP('extra', TEXT('extra')));
  });

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
  broken(
    'a reserved id in a group',
    (f) => checks(f).sections[0].fields.push(GROUP('extra', TEXT('entryAt'))),
    [CHECKS, `${VISIT}.fields[14].fields[0].id`, 'validate.reserved_id'],
  );
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

// ---------------------------------------------------------------------------------------------
// Paths (2.3): every path a definition can produce has at most four parts, each one the server
// takes (services/api/src/sync/records.ts, DATA_PATH), and no two answers share one.

const TEXT = (id: string) => ({ id, kind: 'text', label: 'Text', lines: 'one', maxLength: 10 });
const GROUP = (id: string, ...fields: unknown[]) => ({
  id,
  kind: 'group',
  label: 'Group',
  layout: 'stack',
  fields,
});
const LONG = 'path_too_long';
const rule = (name: string) => `validate.${name}`;

describe('a path of five parts', () => {
  // The design's own example: section, entry, grid, row, side.
  broken('a grid with sides in a repeating section', (f) => (findings(f, 'pulses').sides = true), [
    CHECKS,
    `${F('pulses')}.cell`,
    rule(LONG),
  ]);
  broken('a sided cell of a grid in a repeating section', (f) => (findings(f, 'pulses').cell.sides = true), [
    CHECKS,
    `${F('pulses')}.cell`,
    rule(LONG),
  ]);
  // The Status section's grids are four parts deep as written; an entry part makes five.
  broken(
    'a section that starts to repeat: each field that stores too deep is named',
    (f) => (checks(f).sections[3].repeat = { max: 2, itemTitle: 'Status {n}' }),
    [CHECKS, `${S('each')}.cell.fields[0]`, rule(LONG)],
    [CHECKS, `${S('each')}.cell.fields[1]`, rule(LONG)],
    [CHECKS, `${S('reflexes')}.cell`, rule(LONG)],
  );
  broken(
    'a group in a group in a repeating section',
    (f) => checks(f).sections[2].fields.push(GROUP('outer', GROUP('inner', TEXT('deep')))),
    [CHECKS, `${FINDINGS}.fields[5].fields[0].fields[0]`, rule(LONG)],
  );
  broken(
    'three groups deep in a section that does not repeat',
    (f) => checks(f).sections[0].fields.push(GROUP('one', GROUP('two', GROUP('three', TEXT('deep'))))),
    [CHECKS, `${VISIT}.fields[14].fields[0].fields[0].fields[0]`, rule(LONG)],
  );
  broken(
    'a sided field in a group in a repeating section',
    (f) => checks(f).sections[2].fields.push(GROUP('outer', { ...TEXT('deep'), sides: true })),
    [CHECKS, `${FINDINGS}.fields[5].fields[0]`, rule(LONG)],
  );
  // A region stores at three paths under its own, a problem at two.
  broken(
    'a region in a group in a repeating section',
    (f) => {
      const region = { id: 'deep', kind: 'region', label: 'Where', options: [{ code: 'arm', label: 'Arm' }] };
      checks(f).sections[2].fields.push(GROUP('outer', region));
    },
    [CHECKS, `${FINDINGS}.fields[5].fields[0]`, rule(LONG)],
  );
  broken(
    'a problem in a group in a repeating section',
    (f) =>
      checks(f).sections[2].fields.push(GROUP('outer', { id: 'deep', kind: 'problem', label: 'Diagnosis' })),
    [CHECKS, `${FINDINGS}.fields[5].fields[0]`, rule(LONG)],
  );

  // Its fields are four parts deep; a side is a fifth. The condition in the row then names no answer.
  broken(
    'a grid of picked rows with sides, around a group',
    (f) => (status(f, 'each').sides = true),
    [CHECKS, `${S('each')}.cell.fields[0]`, rule(LONG)],
    [CHECKS, `${S('each')}.cell.fields[1]`, rule(LONG)],
    [CHECKS, `${S('each')}.cell.fields[1].showWhen.field`, rule('condition_unknown_field')],
  );

  fits('a group in a repeating section: four parts', (f) => {
    checks(f).sections[2].fields.push(GROUP('outer', TEXT('deep')));
  });
  fits('two groups deep in a section that does not repeat: four parts', (f) => {
    checks(f).sections[0].fields.push(GROUP('one', GROUP('two', TEXT('deep'))));
  });
  // The text of an Other option changes the last part; it adds none.
  fits('an Other option on a cell four parts deep', (f) => {
    findings(f, 'pulses').cell.options = [{ code: 'other', label: 'Other', other: true }];
  });
  // Nothing is stored by these three, so nothing is stored too deep.
  fits('a field that stores nothing, any depth', (f) => {
    const info = { id: 'deep', kind: 'info', label: 'Guidance' };
    checks(f).sections[2].fields.push(GROUP('one', GROUP('two', GROUP('three', info))));
  });
});

describe('a path part the server would refuse', () => {
  const full = (f: LooseFiles): Loose => f.noteTypes[FULL];
  // 61 characters is the longest part. An Other option stores its text at the id with `_other` added.
  it('an id so long that the text of its Other option has no path', () => {
    const files = definitionFiles();
    full(files).sections[1].fields[1].id = 'a'.repeat(56);
    expect(found(files, FULL)).toEqual(sorted([[FULL, '$.sections[1].fields[1]', rule('bad_path_part')]]));
    full(files).sections[1].fields[1].id = 'a'.repeat(55);
    expect(found(files, FULL)).toEqual([]);
  });
  // The schema refuses these first. The validator is also handed definitions no schema has seen.
  broken('a field id that does not start with a lower-case letter', (f) => (visit(f, 'onset').id = 'Onset'), [
    CHECKS,
    V('onset'),
    rule('bad_path_part'),
  ]);
  broken('a section id with a character no path may hold', (f) => (checks(f).sections[3].id = 'status-now'), [
    CHECKS,
    `${STATUS}.id`,
    rule('bad_path_part'),
  ]);
  broken('a row code that is no path part', (f) => (status(f, 'reflexes').rows[0].code = 'knee.left'), [
    CHECKS,
    `${S('reflexes')}.cell`,
    rule('bad_path_part'),
  ]);
});

describe('two answers at one path', () => {
  const COLLISION = rule('path_collision');
  // visit.systems has an Other option: its text is stored at visit.systems_other.
  broken(
    'a field with the id that the text of an Other option takes',
    (f) => {
      visit(f, 'onset').id = 'systems_other';
    },
    [CHECKS, V('onset'), COLLISION],
  );
  const otherId = (f: LooseFiles) => (visit(f, 'onset').id = 'plan_other');
  fits('an id that ends in _other beside a field with no Other option', otherId);
  broken(
    'that id, once the field beside it has an Other option: the second of the two is named',
    (f) => {
      otherId(f);
      visit(f, 'plan').options[2].other = true;
    },
    [CHECKS, V('plan'), COLLISION],
  );
  broken(
    'a group whose fields would store under the text of an Other option',
    (f) => (visit(f, 'pressure').id = 'systems_other'),
    [CHECKS, `${V('pressure')}.fields[0]`, COLLISION],
    [CHECKS, `${V('pressure')}.fields[1]`, COLLISION],
  );
  const otherRows = (f: LooseFiles) => {
    status(f, 'reflexes').rows[1].code = 'knee_other';
  };
  fits('a row whose code ends in _other', otherRows);
  broken(
    'that row, once the cell has an Other option: its text for one row is the other row’s answer',
    (f) => {
      otherRows(f);
      status(f, 'reflexes').cell.options = [{ code: 'other', label: 'Other', other: true }];
    },
    [CHECKS, `${S('reflexes')}.cell`, COLLISION],
  );
});

describe('a condition', () => {
  const story = (f: LooseFiles) => visit(f, 'story');
  const WHEN = `${V('story')}.showWhen`;
  const depth = (f: LooseFiles) => findings(f, 'depth');
  const DEPTH = `${F('depth')}.showWhen`;
  const UNKNOWN = rule('condition_unknown_field');
  /** The condition of the Story field replaced. */
  const brokenWhen = (name: string, condition: unknown, ...expected: [string, string][]) =>
    broken(
      name,
      (f) => (story(f).showWhen = condition),
      ...expected.map(([path, r]): Expected => [CHECKS, path, r]),
    );
  const fitsWhen = (name: string, condition: unknown) => fits(name, (f) => (story(f).showWhen = condition));
  /** The condition of the Depth field, which is in an entry of a repeating section. */
  const brokenInEntry = (name: string, condition: unknown, ...expected: [string, string][]) =>
    broken(
      name,
      (f) => (depth(f).showWhen = condition),
      ...expected.map(([path, r]): Expected => [CHECKS, path, r]),
    );
  const fitsInEntry = (name: string, condition: unknown) =>
    fits(name, (f) => (depth(f).showWhen = condition));

  brokenWhen('that names no field', { field: 'visit.concerns', is: 'yes' }, [`${WHEN}.field`, UNKNOWN]);
  brokenWhen('that names no section', { field: 'visits.concern', is: 'yes' }, [`${WHEN}.field`, UNKNOWN]);
  brokenWhen('that names a section', { field: 'visit', filled: true }, [`${WHEN}.field`, UNKNOWN]);
  // A group stores nothing: whether it is "filled" has no answer to read.
  brokenWhen('that names a group', { field: 'visit.pressure', filled: true }, [`${WHEN}.field`, UNKNOWN]);
  brokenWhen('that names a field that stores nothing', { field: 'visit.guidance', filled: true }, [
    `${WHEN}.field`,
    UNKNOWN,
  ]);
  fitsWhen('that names a field of a group', { field: 'visit.pressure.upper', filled: true });
  fitsWhen('that names a field of an included module', { field: 'eyes.pupils', is: 'two' });
  fitsWhen('that names the text of an Other option', { field: 'visit.systems_other', filled: true });
  brokenWhen(
    'that names the Other text of a field with no Other option',
    { field: 'visit.plan_other', filled: true },
    [`${WHEN}.field`, UNKNOWN],
  );

  // A sided field stores at `right` and `left`, and at nothing else.
  brokenWhen('that names a sided field without the side', { field: 'ears.hearing', is: 'intact' }, [
    `${WHEN}.field`,
    UNKNOWN,
  ]);
  fitsWhen('that names one side of a sided field', { field: 'ears.hearing.left', is: 'decreased' });
  brokenWhen('that names a side of a field that has none', { field: 'visit.concern.left', is: 'yes' }, [
    `${WHEN}.field`,
    UNKNOWN,
  ]);

  brokenWhen('with a code the field does not offer', { field: 'visit.concern', is: 'yess' }, [
    `${WHEN}.is`,
    rule('condition_unknown_code'),
  ]);
  brokenWhen(
    'with one code of several that the field does not offer',
    { field: 'visit.systems', is: ['eyes', 'nose'] },
    [`${WHEN}.is[1]`, rule('condition_unknown_code')],
  );
  brokenWhen('that asks a text field for a code', { field: 'visit.lasting', is: 'yes' }, [
    `${WHEN}.field`,
    rule('condition_not_a_choice'),
  ]);
  fitsWhen('that asks whether a text field is filled', { field: 'visit.lasting', filled: true });
  brokenWhen(
    'inside all, any and not: the place is the condition that is wrong',
    {
      all: [
        { field: 'visit.concern', is: 'yes' },
        { any: [{ not: { field: 'visit.nothing', filled: true } }] },
      ],
    },
    [`${WHEN}.all[1].any[0].not.field`, UNKNOWN],
  );

  broken('on a section', (f) => (checks(f).sections[2].showWhen.field = 'visit.system'), [
    CHECKS,
    `${FINDINGS}.showWhen.field`,
    UNKNOWN,
  ]);
  broken(
    'on a field in a group',
    (f) => {
      visit(f, 'pressure').fields[1].showWhen = { field: 'visit.pressure.uper', filled: true };
    },
    [CHECKS, `${V('pressure')}.fields[1].showWhen.field`, UNKNOWN],
  );
  broken(
    'in a module: the module’s file is named',
    (f) => {
      exam(f).sections[0].fields[1].showWhen.is = ['zero', 'won'];
    },
    [EXAM, '$.sections[0].fields[1].showWhen.is[1]', rule('condition_unknown_code')],
  );
  // The include's condition is copied onto both sections of the module. It is one fault, at the include.
  broken(
    'on an include: the note type’s file is named, at the include, once',
    (f) => {
      checks(f).sections[1].showWhen.is = 'maybe';
    },
    [CHECKS, '$.sections[1].showWhen.is', rule('condition_unknown_code')],
  );

  describe('inside an entry of a repeating section', () => {
    brokenInEntry('that names no field of the entry', { field: './kind', is: 'burn' }, [
      `${DEPTH}.field`,
      UNKNOWN,
    ]);
    fitsInEntry('that names a field outside the section', { field: 'visit.concern', is: 'yes' });
    // Which entry? A field of a repeating section has one answer for each.
    brokenInEntry(
      'that names its own section from the top: no entry is named',
      { field: 'findings.type', is: 'burn' },
      [`${DEPTH}.field`, rule('path_into_repeat')],
    );
    fitsInEntry('that names a part of a region', { field: './where.region', is: 'arm' });
    brokenInEntry('that names a region without the part', { field: './where', filled: true }, [
      `${DEPTH}.field`,
      UNKNOWN,
    ]);
    // The region of the fixture takes its sides from side_rl, which has no Bilateral.
    brokenInEntry('with a side the region’s list does not have', { field: './where.side', is: 'bilateral' }, [
      `${DEPTH}.is`,
      rule('condition_unknown_code'),
    ]);
    fitsInEntry('with a side the region’s list has', { field: './where.side', is: 'left' });
    fitsInEntry('that asks whether a region’s surface is filled', { field: './where.surface', filled: true });
    brokenInEntry('that asks a region’s surface for a code', { field: './where.surface', is: 'front' }, [
      `${DEPTH}.field`,
      rule('condition_not_a_choice'),
    ]);
    fitsInEntry('that names the code of a problem', { field: './diagnosis.code', filled: true });
    brokenInEntry('that names a problem without the part', { field: './diagnosis', filled: true }, [
      `${DEPTH}.field`,
      UNKNOWN,
    ]);
    fitsInEntry('that names one row of a grid', { field: './pulses.radial', is: 'two' });
    brokenInEntry('that names a row the grid does not have', { field: './pulses.ulnar', is: 'two' }, [
      `${DEPTH}.field`,
      UNKNOWN,
    ]);
    brokenInEntry('with a code the grid’s cell does not offer', { field: './pulses.radial', is: 'three' }, [
      `${DEPTH}.is`,
      rule('condition_unknown_code'),
    ]);
    brokenInEntry('that names an entry’s own answers', { field: './entryAt', filled: true }, [
      `${DEPTH}.field`,
      UNKNOWN,
    ]);
  });

  describe('outside every entry', () => {
    brokenWhen(
      'that names a field of a repeating section: which entry?',
      { field: 'findings.type', is: 'burn' },
      [`${WHEN}.field`, rule('path_into_repeat')],
    );
    brokenWhen('written from an entry where there is none', { field: './concern', is: 'yes' }, [
      `${WHEN}.field`,
      rule('relative_outside_entry'),
    ]);
    // A repeating section is shown or hidden whole, before it has an entry.
    broken(
      'written from an entry, on the repeating section itself',
      (f) => {
        checks(f).sections[2].showWhen = { field: './type', is: 'burn' };
      },
      [CHECKS, `${FINDINGS}.showWhen.field`, rule('relative_outside_entry')],
    );
  });

  describe('inside the cell of a grid, where ./ is the row', () => {
    const note = (f: LooseFiles) => status(f, 'each').cell.fields[1];
    const NOTE = `${S('each')}.cell.fields[1].showWhen`;
    // The cell's own id is no path part: its fields follow the row's code.
    broken('that puts the cell’s id in the path', (f) => (note(f).showWhen.field = './detail.seen'), [
      CHECKS,
      `${NOTE}.field`,
      UNKNOWN,
    ]);
    broken('with a code the field in the row does not offer', (f) => (note(f).showWhen.is = 'maybe'), [
      CHECKS,
      `${NOTE}.is`,
      rule('condition_unknown_code'),
    ]);
    fits('that names another row of its own grid from the top', (f) => {
      note(f).showWhen = { field: 'status.each.eyes.seen', is: 'yes' };
    });
    broken(
      'that names a row that is no option of the field the rows are picked in',
      (f) => {
        note(f).showWhen = { field: 'status.each.nose.seen', is: 'yes' };
      },
      [CHECKS, `${NOTE}.field`, UNKNOWN],
    );
    // In a repeating section too, ./ in a cell is the row and not the entry.
    broken(
      'that reaches for a field of the entry the grid is in',
      (f) => {
        findings(f, 'pulses').cell.showWhen = { field: './type', is: 'burn' };
      },
      [CHECKS, `${F('pulses')}.cell.showWhen.field`, UNKNOWN],
    );
    // The grid itself is not in a row: its own condition is read from the entry.
    fits('on the grid itself, read from the entry', (f) => {
      findings(f, 'pulses').showWhen = { field: './type', is: 'burn' };
    });
    fits('that names a side of the cell in one row', (f) => {
      visit(f, 'story').showWhen = { field: 'status.reflexes.ankle.right', is: 'two' };
    });
  });
});

describe('rows picked in another field', () => {
  const PICKED = `${S('each')}.rows.pickedIn`;
  const brokenRows = (name: string, path: string, r: string) =>
    broken(name, (f) => (status(f, 'each').rows.pickedIn = path), [CHECKS, PICKED, rule(r)]);
  brokenRows('that does not exist', 'visit.system', 'picked_in_unknown_field');
  // One option picked is one row: a grid of one row is a group.
  brokenRows('that is choose-one', 'visit.concern', 'picked_in_not_choose_many');
  brokenRows('that is no choice', 'visit.lasting', 'picked_in_not_choose_many');
  brokenRows('that is in a repeating section: which entry?', 'findings.type', 'path_into_repeat');
  brokenRows('written from an entry where there is none', './systems', 'relative_outside_entry');
  fits('that is in the same entry', (f) => {
    const many = {
      id: 'kinds',
      kind: 'choice',
      many: true,
      label: 'Kinds',
      options: [{ code: 'a', label: 'A' }],
    };
    checks(f).sections[2].fields.push(many, {
      id: 'each',
      kind: 'grid',
      label: 'Each',
      rows: { pickedIn: './kinds' },
      cell: TEXT('note'),
    });
  });
  // A grid's rows come from a field whose options are fixed, not from another grid of picked rows.
  broken(
    'that is in the cell of a grid whose own rows are picked',
    (f) => {
      status(f, 'each').cell.fields[0].many = true;
      checks(f).sections[3].fields.push({
        id: 'more',
        kind: 'grid',
        label: 'More',
        rows: { pickedIn: 'status.each.eyes.seen' },
        cell: TEXT('note'),
      });
    },
    [CHECKS, `${STATUS}.fields[2].rows.pickedIn`, rule('picked_in_unknown_field')],
  );
});

describe('mapsTo', () => {
  const MAPS = (place: string) => `${place}.mapsTo`;
  const full = (f: LooseFiles): Loose => f.noteTypes[FULL];
  const history = (f: LooseFiles, id: string): Loose =>
    full(f).sections[0].fields.find((x: Loose) => x.id === id);
  const wounds = (f: LooseFiles, id: string): Loose =>
    full(f).sections[1].fields.find((x: Loose) => x.id === id);
  const MISMATCH = rule('maps_to_mismatch');

  broken(
    'that names a note type that does not exist',
    (f) => (visit(f, 'story').mapsTo = 'missing_demo:history.story'),
    [CHECKS, MAPS(V('story')), rule('unknown_note_type')],
  );
  broken('that names no field', (f) => (visit(f, 'story').mapsTo = 'full_demo:history.storey'), [
    CHECKS,
    MAPS(V('story')),
    rule('maps_to_unknown_field'),
  ]);
  broken('that names a section', (f) => (visit(f, 'story').mapsTo = 'full_demo:history'), [
    CHECKS,
    MAPS(V('story')),
    rule('maps_to_unknown_field'),
  ]);
  // A field of a repeating section is named without the entry part (6.4), and only so.
  broken(
    'that names a part of a field',
    (f) => (findings(f, 'where').mapsTo = 'full_demo:wounds.where.region'),
    [CHECKS, MAPS(F('where')), rule('maps_to_unknown_field')],
  );
  fits('to a field of the note type itself', (f) => (visit(f, 'onset').mapsTo = 'checks_demo:visit.onset'));
  broken('on the cell of a grid', (f) => (findings(f, 'pulses').cell.mapsTo = 'full_demo:wounds.type'), [
    CHECKS,
    MAPS(`${F('pulses')}.cell`),
    rule('maps_to_in_grid'),
  ]);

  // Expand writes each mapped answer into the full note, where the server checks it against the
  // full definition. An answer the full field cannot hold would be a rejected change on the phone.
  broken('to a field of another kind', (f) => (visit(f, 'story').mapsTo = 'full_demo:history.length'), [
    CHECKS,
    MAPS(V('story')),
    MISMATCH,
  ]);
  broken(
    'to a field at the same place that holds another kind of answer',
    (f) => {
      visit(f, 'onset').mapsTo = 'full_demo:history.story';
    },
    [CHECKS, MAPS(V('onset')), MISMATCH],
  );
  broken(
    'with an option the full field does not have',
    (f) => {
      findings(f, 'type').options.push({ code: 'scrape', label: 'Scrape' });
    },
    [CHECKS, MAPS(F('type')), MISMATCH],
  );
  broken('from choose-one to choose-many', (f) => (wounds(f, 'type').many = true), [
    CHECKS,
    MAPS(F('type')),
    MISMATCH,
  ]);
  broken('from a text longer than the full field takes', (f) => (history(f, 'story').maxLength = 1000), [
    CHECKS,
    MAPS(V('story')),
    MISMATCH,
  ]);
  broken('from a number the full field’s range does not cover', (f) => (history(f, 'length').max = 50), [
    CHECKS,
    MAPS(V('length')),
    MISMATCH,
  ]);
  broken('from a number below the full field’s range', (f) => (history(f, 'length').min = 1), [
    CHECKS,
    MAPS(V('length')),
    MISMATCH,
  ]);
  broken(
    'from a number with more decimals than the full field keeps',
    (f) => (history(f, 'length').decimals = 0),
    [CHECKS, MAPS(V('length')), MISMATCH],
  );
  broken('from a sided field to one with no sides', (f) => delete history(f, 'length').sides, [
    CHECKS,
    MAPS(V('length')),
    MISMATCH,
  ]);
  broken('from a region with a surface to one without', (f) => delete wounds(f, 'where').surface, [
    CHECKS,
    MAPS(F('where')),
    MISMATCH,
  ]);
  // The quick form's region has Right and Left; the full one adds Bilateral, and takes both.
  fits('from a region with fewer sides', () => {});
  broken(
    'from a region with a side the full one does not have',
    (f) => {
      findings(f, 'where').side = 'side';
      wounds(f, 'where').side = 'side_rl';
    },
    [CHECKS, MAPS(F('where')), MISMATCH],
  );
  broken(
    'from a group to a group without one of its fields',
    (f) => (history(f, 'pressure').fields[1].id = 'low'),
    [CHECKS, MAPS(V('pressure')), MISMATCH],
  );
  const quickOther = (f: LooseFiles) => (findings(f, 'type').options[0].other = true);
  fits('with an Other option, to a field that has one', quickOther);
  broken(
    'with an Other option, to a field that has none: its text has nowhere to go',
    (f) => {
      quickOther(f);
      wounds(f, 'type').options.pop();
    },
    [CHECKS, MAPS(F('type')), MISMATCH],
  );
  fits('from a date to a date of any range', (f) => {
    history(f, 'story').kind = 'date';
    history(f, 'story').range = 'any';
    visit(f, 'onset').mapsTo = 'full_demo:history.story';
    delete visit(f, 'story').mapsTo;
  });
  broken(
    'from a past date to a future one',
    (f) => {
      history(f, 'story').kind = 'date';
      history(f, 'story').range = 'future';
      visit(f, 'onset').mapsTo = 'full_demo:history.story';
      delete visit(f, 'story').mapsTo;
    },
    [CHECKS, MAPS(V('onset')), MISMATCH],
  );
});

describe('a note type named by a definition', () => {
  const UNKNOWN = rule('unknown_note_type');
  broken(
    'an option that suggests one that does not exist',
    (f) => {
      visit(f, 'systems').options[3].suggests = 'missing_demo';
    },
    [CHECKS, `${V('systems')}.options[3].suggests`, UNKNOWN],
  );
  broken(
    'in a shared list: the list’s file is named',
    (f) => {
      f.lists[list('demo_scale')].options[0].suggests = 'missing_demo';
    },
    [list('demo_scale'), '$.options[0].suggests', UNKNOWN],
  );
  broken(
    'a button that opens one that does not exist',
    (f) => (visit(f, 'wound').noteType = 'missing_demo'),
    [CHECKS, `${V('wound')}.noteType`, UNKNOWN],
  );
  fits('the note type itself', (f) => (visit(f, 'systems').options[3].suggests = 'checks_demo'));
  // A version that is being checked may not be among the note types the caller can look up yet.
  it('the note type itself, when nothing can be looked up', () => {
    const files = definitionFiles();
    files.noteTypes[FULL].sections[1].fields[1].options[0].suggests = 'full_demo';
    const { definition, origins } = resolved(files, FULL);
    expect(validate(definition, { origins, noteType: () => undefined })).toEqual([]);
  });
});
