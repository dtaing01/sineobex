import { describe, expect, it } from 'vitest';
import { resolve } from '../src/resolve.ts';
import { pathsOf } from '../src/paths.ts';
import { checkVersions, type Rename } from '../src/versions.ts';
import { definitionFiles, type LooseFiles } from './fixtures/load.ts';

// A path or an option code is never reused for another meaning in a later version of the same
// note type (design 2.6). Each test adds one later version to the fixture tree, with one change.

const V1 = 'note-types/checks_demo/v1.json';
const V2 = 'note-types/checks_demo/v2.json';
const V3 = 'note-types/checks_demo/v3.json';
const FULL = 'note-types/full_demo/v1.json';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a file is changed as plain JSON */
type Loose = any;
type Expected = [file: string, path: string, rule: string];
const sorted = (found: Expected[]) => found.map((p) => p.join('  ')).sort();

function found(files: LooseFiles, renames: Record<string, Rename[]> = {}): string[] {
  const problems = checkVersions(files, renames);
  for (const p of problems) expect(p.message.length, p.rule).toBeGreaterThan(10);
  return sorted(problems.map((p): Expected => [p.file, p.path, p.rule]));
}

/** Adds a version of checks_demo: the version before it, copied, with one change. */
function next(files: LooseFiles, version: number, change: (file: Loose) => void = () => {}): Loose {
  const before = files.noteTypes[`note-types/checks_demo/v${version - 1}.json`];
  const file = structuredClone(before);
  file.version = version;
  change(file);
  files.noteTypes[`note-types/checks_demo/v${version}.json`] = file;
  return file;
}
const visit = (file: Loose, id: string): Loose => file.sections[0].fields.find((f: Loose) => f.id === id);
const findings = (file: Loose, id: string): Loose => file.sections[2].fields.find((f: Loose) => f.id === id);
const status = (file: Loose, id: string): Loose => file.sections[3].fields.find((f: Loose) => f.id === id);
const base = definitionFiles().noteTypes[V1];
const at = (section: number, id: string) =>
  `$.sections[${section}].fields[${base.sections[section].fields.findIndex((f: Loose) => f.id === id)}]`;

/** A second version with one change, and exactly the problems it should give. */
function refused(name: string, change: (file: Loose, files: LooseFiles) => void, ...expected: Expected[]) {
  it(name, () => {
    const files = definitionFiles();
    next(files, 2, (file) => change(file, files));
    expect(found(files)).toEqual(sorted(expected));
  });
}
function allowed(name: string, change: (file: Loose, files: LooseFiles) => void) {
  refused(name, change);
}

describe('every path a note type stores at', () => {
  it('is worked out as design 2.3 lays it out, for every kind', () => {
    const files = definitionFiles();
    const result = resolve(V1, files);
    if (!result.ok) throw new Error('the fixture does not resolve');
    const paths = pathsOf(result.definition).map((p) => `${p.path}: ${p.holds}`);
    expect(paths).toEqual([
      'visit.systems: a list of codes',
      'visit.systems_other: text',
      'visit.concern: one code',
      'visit.story: text',
      'visit.length.right: a number',
      'visit.length.left: a number',
      'visit.unable: a tick',
      'visit.onset: a date',
      'visit.called: a time',
      'visit.lasting: a duration',
      'visit.pressure.upper: a number',
      'visit.pressure.lower: a number',
      'visit.plan: a list of codes',
      'eyes.pupils: one code',
      'eyes.notes: text',
      'ears.hearing.right: one code',
      'ears.hearing.left: one code',
      // In a repeating section, without the entry's part: as a condition writes it.
      'findings.where.region: one code',
      'findings.where.side: one code',
      'findings.where.surface: a surface',
      'findings.diagnosis.code: a problem code',
      'findings.diagnosis.label: a problem label',
      'findings.type: one code',
      'findings.depth: a number',
      'findings.pulses: the rows of a grid',
      'findings.pulses.radial: one code',
      'findings.pulses.pedal: one code',
      'status.reflexes: the rows of a grid',
      'status.reflexes.knee.right: one code',
      'status.reflexes.knee.left: one code',
      'status.reflexes.ankle.right: one code',
      'status.reflexes.ankle.left: one code',
      // The rows of this grid are the options picked in visit.systems, so it comes after every other path.
      'status.each: the rows of a grid',
      'status.each.none.seen: one code',
      'status.each.none.note: text',
      'status.each.eyes.seen: one code',
      'status.each.eyes.note: text',
      'status.each.ears.seen: one code',
      'status.each.ears.note: text',
      'status.each.skin.seen: one code',
      'status.each.skin.note: text',
      'status.each.other.seen: one code',
      'status.each.other.note: text',
    ]);
  });
});

describe('the versions of a note type', () => {
  it('pass when each has one version', () => {
    expect(found(definitionFiles())).toEqual([]);
  });

  allowed('a second version that changes nothing', () => {});

  allowed('a second version may add, remove and reword', (file) => {
    file.title = 'Checks, second';
    file.sections[0].title = 'The visit';
    visit(file, 'story').label = 'Tell the story';
    visit(file, 'story').maxLength = 500;
    visit(file, 'pressure').fields[0].max = 250;
    visit(file, 'onset').range = 'any';
    file.sections[0].fields = file.sections[0].fields.filter((f: Loose) => f.id !== 'called');
    file.sections[0].fields.push({
      id: 'weight',
      kind: 'number',
      label: 'Weight',
      min: 0,
      max: 400,
      decimals: 1,
    });
    visit(file, 'systems').options.splice(2, 1);
    visit(file, 'systems').options.push({ code: 'feet', label: 'Feet' });
    visit(file, 'plan').options.reverse();
    file.sections.splice(2, 1);
  });

  allowed('a field that moves into a group, or drops its sides, stores at a new path', (file) => {
    const lasting = visit(file, 'lasting');
    file.sections[0].fields = file.sections[0].fields.filter((f: Loose) => f.id !== 'lasting');
    visit(file, 'pressure').fields.push({ ...lasting, kind: 'text', lines: 'one', maxLength: 50 });
    delete visit(file, 'length').sides;
  });

  it('are each their own: another note type may store something else at the same path', () => {
    const files = definitionFiles();
    const other = structuredClone(files.noteTypes[V1]);
    other.key = 'other_demo';
    Object.assign(visit(other, 'onset'), { kind: 'time' });
    delete visit(other, 'onset').range;
    visit(other, 'systems').options[1].label = 'Vision';
    files.noteTypes['note-types/other_demo/v1.json'] = other;
    expect(found(files)).toEqual([]);
  });
});

describe('a path is never reused for another kind of answer', () => {
  refused(
    'a text that becomes a number',
    (file) => {
      const story = visit(file, 'story');
      for (const key of ['lines', 'maxLength', 'mapsTo']) delete story[key];
      Object.assign(story, { kind: 'number', min: 0, max: 10, decimals: 0 });
    },
    [V2, at(0, 'story'), 'versions.kind_changed'],
  );
  refused(
    'a date that becomes a time',
    (file) => {
      delete visit(file, 'onset').range;
      visit(file, 'onset').kind = 'time';
    },
    [V2, at(0, 'onset'), 'versions.kind_changed'],
  );
  refused('a choose-one that becomes a choose-many', (file) => (visit(file, 'concern').many = true), [
    V2,
    at(0, 'concern'),
    'versions.kind_changed',
  ]);
  refused('a choose-many that becomes a choose-one', (file) => (visit(file, 'plan').many = false), [
    V2,
    at(0, 'plan'),
    'versions.kind_changed',
  ]);
  refused(
    'a new field at the path where the text of an Other option was stored',
    (file) => {
      delete visit(file, 'systems').options[4].other;
      file.sections[0].fields.push({ id: 'systems_other', kind: 'flag', label: 'Something else' });
    },
    [V2, '$.sections[0].fields[14]', 'versions.kind_changed'],
  );
  refused(
    'a group whose field takes the path of a side',
    (file) => {
      const length = visit(file, 'length');
      for (const key of Object.keys(length)) if (!['id', 'label'].includes(key)) delete length[key];
      Object.assign(length, {
        kind: 'group',
        layout: 'row',
        fields: [{ id: 'right', kind: 'text', label: 'Right', lines: 'one', maxLength: 20 }],
      });
    },
    [V2, `${at(0, 'length')}.fields[0]`, 'versions.kind_changed'],
  );
  refused(
    'the cell of a grid, reported once and not once for each row',
    (file) => (status(file, 'reflexes').cell = { id: 'grade', kind: 'flag', label: 'Present' }),
    [V2, `${at(3, 'reflexes')}.cell`, 'versions.kind_changed'],
  );
  refused(
    'a field in the cell of a grid whose rows are picked elsewhere',
    (file) => {
      const note = status(file, 'each').cell.fields[1];
      for (const key of ['lines', 'maxLength']) delete note[key];
      Object.assign(note, { kind: 'date', range: 'past' });
    },
    [V2, `${at(3, 'each')}.cell.fields[1]`, 'versions.kind_changed'],
  );
  refused(
    'a text that becomes a grid: the path is now the start of its rows’ paths',
    (file) => {
      const story = visit(file, 'story');
      for (const key of Object.keys(story)) if (!['id', 'label'].includes(key)) delete story[key];
      Object.assign(story, {
        kind: 'grid',
        rows: [{ code: 'first', label: 'First' }],
        cell: { id: 'told', kind: 'flag', label: 'Told' },
      });
    },
    [V2, at(0, 'story'), 'versions.kind_changed'],
  );
  refused(
    'a group whose field takes the path of a body map’s side',
    (file) => {
      file.sections[2].fields[0] = {
        id: 'where',
        kind: 'group',
        label: 'Where',
        layout: 'stack',
        fields: [{ id: 'side', kind: 'text', label: 'Side', lines: 'one', maxLength: 20 }],
      };
    },
    [V2, `${at(2, 'where')}.fields[0]`, 'versions.kind_changed'],
  );

  it('a path that was dropped in one version and comes back as something else in the next', () => {
    const files = definitionFiles();
    next(files, 2, (file) => {
      file.sections[0].fields = file.sections[0].fields.filter((f: Loose) => f.id !== 'onset');
    });
    next(files, 3, (file) =>
      file.sections[0].fields.push({
        id: 'onset',
        kind: 'text',
        label: 'Onset',
        lines: 'one',
        maxLength: 40,
      }),
    );
    expect(found(files)).toEqual(sorted([[V3, '$.sections[0].fields[13]', 'versions.kind_changed']]));
  });

  it('says which version last stored at the path', () => {
    const files = definitionFiles();
    next(files, 2);
    next(files, 3, (file) => (visit(file, 'concern').many = true));
    expect(checkVersions(files).map((p) => p.message)).toEqual([
      'stores a list of codes at visit.concern, which held one code in version 2: a path is never used again for another kind of answer',
    ]);
  });

  it('in a module version: the problem names the module’s file', () => {
    const files = definitionFiles();
    const exam = structuredClone(files.modules['modules/demo_exam/v1.json']);
    exam.version = 3;
    exam.sections[0].fields[1] = { id: 'notes', kind: 'flag', label: 'Seen' };
    files.modules['modules/demo_exam/v3.json'] = exam;
    next(files, 2, (file) => (file.sections[1].version = 3));
    expect(found(files)).toEqual(
      sorted([['modules/demo_exam/v3.json', '$.sections[0].fields[1]', 'versions.kind_changed']]),
    );
  });

  it('the module’s second version in the tree, which only drops fields, passes', () => {
    const files = definitionFiles();
    next(files, 2, (file) => {
      file.sections[1].version = 2;
      delete file.sections[1].showWhen;
    });
    expect(found(files)).toEqual([]);
  });
});

describe('a number keeps its unit', () => {
  refused('centimetres that become millimetres', (file) => (visit(file, 'length').unit = 'mm'), [
    V2,
    at(0, 'length'),
    'versions.unit_changed',
  ]);
  allowed('a unit that is dropped, and a unit named where none was, say nothing new', (file) => {
    delete visit(file, 'length').unit;
    visit(file, 'pressure').fields[0].unit = 'mmHg';
  });
  it('against the last version that named one', () => {
    const files = definitionFiles();
    next(files, 2, (file) => delete visit(file, 'length').unit);
    next(files, 3, (file) => (visit(file, 'length').unit = 'in'));
    expect(found(files)).toEqual(sorted([[V3, at(0, 'length'), 'versions.unit_changed']]));
  });
});

describe('an option code is never reused for another meaning', () => {
  const reworded = (file: Loose) => (visit(file, 'systems').options[1].label = 'Eye exam');
  const LABEL = `${at(0, 'systems')}.options[1].label`;
  const rename: Rename = { path: 'visit.systems', code: 'eyes', from: 'Eyes', to: 'Eye exam' };

  refused('an option whose label changed', reworded, [V2, LABEL, 'versions.label_changed']);

  it('unless the version declares the rename', () => {
    const files = definitionFiles();
    next(files, 2, reworded);
    expect(found(files, { [V2]: [rename] })).toEqual([]);
  });

  for (const [what, wrong] of [
    ['another path', { path: 'visit.plan' }],
    ['another code', { code: 'ears' }],
    ['another old label', { from: 'Eye' }],
    ['another new label', { to: 'Eye exams' }],
  ] as const)
    it(`a rename of ${what} does not cover it, and is itself refused as unused`, () => {
      const files = definitionFiles();
      next(files, 2, reworded);
      expect(found(files, { [V2]: [{ ...rename, ...wrong }] })).toEqual(
        sorted([
          [V2, LABEL, 'versions.label_changed'],
          [V2, '$.renames[0]', 'versions.rename_unused'],
        ]),
      );
    });

  it('a rename declared for another version does not cover it', () => {
    const files = definitionFiles();
    next(files, 2, reworded);
    next(files, 3);
    expect(found(files, { [V3]: [rename] })).toEqual(
      sorted([
        [V2, LABEL, 'versions.label_changed'],
        [V3, '$.renames[0]', 'versions.rename_unused'],
      ]),
    );
  });

  it('a rename that renames nothing is refused', () => {
    const files = definitionFiles();
    next(files, 2);
    expect(found(files, { [V2]: [rename] })).toEqual(
      sorted([[V2, '$.renames[0]', 'versions.rename_unused']]),
    );
  });

  it('a rename declared for a file that is no version of a note type is refused', () => {
    const files = definitionFiles();
    expect(found(files, { 'note-types/checks_demo/v7.json': [rename] })).toEqual(
      sorted([['note-types/checks_demo/v7.json', '$.renames[0]', 'versions.rename_unused']]),
    );
  });

  it('a code that was dropped in one version and comes back with another label in the next', () => {
    const files = definitionFiles();
    next(files, 2, (file) => visit(file, 'systems').options.splice(3, 1));
    next(files, 3, (file) => visit(file, 'systems').options.push({ code: 'skin', label: 'Skin graft' }));
    expect(found(files)).toEqual(
      sorted([[V3, `${at(0, 'systems')}.options[4].label`, 'versions.label_changed']]),
    );
  });

  it('versions are compared in the order of their numbers, not of their names or of the files', () => {
    const files = definitionFiles();
    next(files, 2, reworded);
    const tenth = structuredClone(files.noteTypes[V2]);
    tenth.version = 10;
    // Listed first, and "v10" sorts before "v2" as text.
    const noteTypes = { 'note-types/checks_demo/v10.json': tenth, ...files.noteTypes };
    expect(found({ ...files, noteTypes }, { [V2]: [rename] })).toEqual([]);
  });

  refused(
    'the label of a row of a grid: its code is part of a path',
    (file) => (status(file, 'reflexes').rows[0].label = 'Elbow'),
    [V2, `${at(3, 'reflexes')}.rows[0].label`, 'versions.label_changed'],
  );
  it('a rename of a row names the grid’s path', () => {
    const files = definitionFiles();
    next(files, 2, (file) => (status(file, 'reflexes').rows[0].label = 'Elbow'));
    const renames = { [V2]: [{ path: 'status.reflexes', code: 'knee', from: 'Knee', to: 'Elbow' }] };
    expect(found(files, renames)).toEqual([]);
  });

  refused(
    'an option in the cell of a grid, reported once; a rename is declared for each row’s path',
    (file) => {
      status(file, 'reflexes').cell.options = [
        { code: 'zero', label: 'None at all' },
        { code: 'one', label: '1+' },
        { code: 'two', label: '2+' },
      ];
    },
    [V2, `${at(3, 'reflexes')}.cell.options[0].label`, 'versions.label_changed'],
  );
  it('and the renames for some of the rows do not cover the others', () => {
    const files = definitionFiles();
    const scale = files.lists['lists/demo_scale.json'].options;
    next(files, 2, (file) => {
      status(file, 'reflexes').cell.options = scale.map((o: Loose) =>
        o.code === 'zero' ? { ...o, label: 'None at all' } : o,
      );
    });
    const all = ['knee.right', 'knee.left', 'ankle.right', 'ankle.left'].map((row) => ({
      path: `status.reflexes.${row}`,
      code: 'zero',
      from: scale[0].label,
      to: 'None at all',
    }));
    expect(found(files, { [V2]: all })).toEqual([]);
    expect(found(files, { [V2]: all.slice(0, 3) })).toEqual(
      sorted([[V2, `${at(3, 'reflexes')}.cell.options[0].label`, 'versions.label_changed']]),
    );
  });

  it('a label that changed in a shared list: the problem names the list’s file', () => {
    const files = definitionFiles();
    files.lists['lists/demo_answers.json'] = {
      name: 'demo_answers',
      options: [
        { code: 'yes', label: 'Yes, there is' },
        { code: 'no', label: 'No' },
      ],
    };
    next(files, 2, (file) => (visit(file, 'concern').options = { list: 'demo_answers' }));
    expect(found(files)).toEqual(
      sorted([['lists/demo_answers.json', '$.options[0].label', 'versions.label_changed']]),
    );
  });

  it('the regions of a body map and its sides', () => {
    const files = definitionFiles();
    const regions = structuredClone(files.lists['lists/demo_regions.json']);
    regions.name = 'demo_regions_two';
    regions.options[0].label = `${regions.options[0].label}, upper`;
    files.lists['lists/demo_regions_two.json'] = regions;
    const sides = structuredClone(files.lists['lists/side_rl.json']);
    sides.name = 'side';
    sides.options[1].label = 'Left side';
    files.lists['lists/side.json'] = sides;
    next(files, 2, (file) => {
      findings(file, 'where').options = { list: 'demo_regions_two' };
      findings(file, 'where').side = 'side';
    });
    expect(found(files)).toEqual(
      sorted([
        ['lists/demo_regions_two.json', '$.options[0].label', 'versions.label_changed'],
        ['lists/side.json', '$.options[1].label', 'versions.label_changed'],
      ]),
    );
  });

  allowed(
    'a region that takes its sides from the list with Bilateral adds a code and changes none',
    (file) => {
      findings(file, 'where').side = 'side';
    },
  );
});

describe('a version that cannot be checked', () => {
  it('one that does not resolve is left to the resolver, and the next is compared with the last that did', () => {
    const files = definitionFiles();
    next(files, 2, (file) => {
      file.sections[1].include = 'no_such_module';
      visit(file, 'onset').kind = 'time';
    });
    next(files, 3, (file) => (file.sections[1].include = 'demo_exam'));
    expect(found(files)).toEqual(sorted([[V3, at(0, 'onset'), 'versions.kind_changed']]));
  });

  it('a file among the note types that says it is another version is not compared under its path’s number', () => {
    const files = definitionFiles();
    expect(FULL in files.noteTypes).toBe(true);
    next(files, 2, (file) => {
      file.version = 5;
      visit(file, 'concern').many = true;
    });
    expect(found(files)).toEqual([]);
  });
});
