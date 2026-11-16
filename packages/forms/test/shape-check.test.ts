import { describe, expect, it } from 'vitest';
import { checkShapes, shapeOf } from '../src/shape-check.ts';
import { readPieces, type Piece } from '../src/spec-check.ts';
import { exampleBlocks } from './fixtures/example-doc.ts';
import { definitionFiles, specTexts, type LooseFiles } from './fixtures/load.ts';

// The shape check (design 4.2): everything about the sections that name a piece, except the words
// of their options, against the piece's shape file. The main fixture is the worked example of the
// transcription recipe; each failing case is that example with one change to the definition.

const NOTE = 'note-types/harm_reduction_example/v1.json';
const PIECE = 'harm-reduction-2';
const SHAPE = `spec/${PIECE}.shape.json`;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- files are changed as plain JSON */
type Loose = any;
type Tree = { files: LooseFiles; pieces: Record<string, Piece & { shape?: Loose }> };
type Expected = [file: string, path: string, rule: string];
const sorted = (found: Expected[]) => found.map((p) => p.join('  ')).sort();

function example(): Tree {
  return { files: definitionFiles('example'), pieces: readPieces(specTexts('example')).pieces };
}
function found({ files, pieces }: Tree): string[] {
  const problems = checkShapes(pieces, files);
  for (const p of problems) expect(p.message.length, p.rule).toBeGreaterThan(10);
  return sorted(problems.map((p): Expected => [p.file, p.path, p.rule]));
}
/** The worked example with one change, and exactly the problems that change should give. */
function broken(name: string, change: (tree: Tree) => void, ...expected: Expected[]) {
  it(name, () => {
    const tree = example();
    change(tree);
    expect(found(tree)).toEqual(sorted(expected));
  });
}
const note = (tree: Tree): Loose => tree.files.noteTypes[NOTE];
const shape = (tree: Tree): Loose => tree.pieces[PIECE]!.shape;
const field = (tree: Tree, section: number, id: string): Loose =>
  note(tree).sections[section].fields.find((f: Loose) => f.id === id);
/** Where a field of the example is in its file. */
const at = (section: number, id: string): string => {
  const fields: Loose[] = definitionFiles('example').noteTypes[NOTE].sections[section].fields;
  return `$.sections[${section}].fields[${fields.findIndex((f) => f.id === id)}]`;
};
/** One change to a field of the example, and the one property the check should name. */
function differs(
  name: string,
  section: number,
  id: string,
  property: string,
  change: (field: Loose) => void,
) {
  broken(name, (t) => change(field(t, section, id)), [
    NOTE,
    `${at(section, id)}.${property}`,
    'shape.field_differs',
  ]);
}

describe('the worked example', () => {
  it('passes the shape check', () => {
    expect(found(example())).toEqual([]);
  });

  it('has the shape file the recipe shows', () => {
    expect(exampleBlocks()[6]!.map((block) => JSON.parse(block))).toEqual([shape(example())]);
  });

  it('has the shape its definition works out to', () => {
    const tree = example();
    expect(shapeOf(PIECE, note(tree))).toEqual(shape(tree));
  });

  it('names the field and the property, and says what each side has', () => {
    const tree = example();
    field(tree, 1, 'interested_in').showWhen = { field: 'treatment.interested', is: 'yes' };
    delete field(tree, 0, 'naloxone_doses').unit;
    expect(checkShapes(tree.pieces, tree.files).map((p) => p.message)).toEqual([
      `"provided.naloxone_doses": unit is not set here, and ${SHAPE} says "doses"`,
      `"treatment.interested_in": showWhen is {"field":"treatment.interested","is":"yes"} here, and ${SHAPE} says {"field":"treatment.interested","is":["yes","maybe"]}`,
    ]);
  });
});

describe('the shape of every kind of field', () => {
  // The fixture tree of the other tests has every kind; here its sections name a piece.
  const CHECKS = 'note-types/checks_demo/v1.json';
  function checks(): Loose {
    const file = definitionFiles().noteTypes[CHECKS];
    // Its last section, Injury, is the quick form's mapping and names no piece.
    for (const section of file.sections)
      if (!('include' in section) && section.id !== 'injury') section.spec = 'checks';
    return file;
  }
  const entry = (path: string): Loose => shapeOf('checks', checks()).fields.find((f) => f.path === path);

  it('lists the sections that name the piece with everything but their fields, and passes an include over', () => {
    expect(shapeOf('checks', checks()).sections).toEqual([
      { id: 'visit', title: 'Visit' },
      {
        id: 'findings',
        title: 'Findings',
        showWhen: { field: 'visit.systems', is: 'skin' },
        repeat: { max: 5, itemTitle: 'Finding {n}' },
      },
      { id: 'status', title: 'Status' },
    ]);
    expect(shapeOf('another', checks())).toEqual({ piece: 'another', sections: [], fields: [] });
  });

  it('lists every field at every depth, in the order written, by the ids from its section down', () => {
    expect(shapeOf('checks', checks()).fields.map((f) => `${f.path}: ${f.kind}`)).toEqual([
      'visit.systems: choice',
      'visit.concern: choice',
      'visit.story: text',
      'visit.length: number',
      'visit.unable: flag',
      'visit.onset: date',
      'visit.called: time',
      'visit.lasting: duration',
      'visit.pressure: group',
      'visit.pressure.upper: number',
      'visit.pressure.lower: number',
      'visit.plan: choice',
      'visit.photos: photo',
      'visit.handoff: action',
      'visit.wound: action',
      'visit.guidance: info',
      'findings.where: region',
      'findings.diagnosis: problem',
      'findings.type: choice',
      'findings.depth: number',
      'findings.pulses: grid',
      // A grid's cell, by its own id after the grid's.
      'findings.pulses.strength: choice',
      'status.each: grid',
      'status.each.detail: group',
      'status.each.detail.seen: choice',
      'status.each.detail.note: text',
      'status.reflexes: grid',
      'status.reflexes.grade: choice',
    ]);
  });

  it('writes options as their number and the codes that carry each flag', () => {
    expect(entry('visit.systems')).toEqual({
      path: 'visit.systems',
      kind: 'choice',
      many: true,
      label: 'What did you examine?',
      options: 5,
      flags: { exclusive: ['none'], suggests: { skin: 'full_demo' }, other: ['other'] },
    });
    expect(entry('visit.plan')).toEqual({
      path: 'visit.plan',
      kind: 'choice',
      many: true,
      label: 'Plan',
      options: 3,
      excludes: [['sent', 'declined']],
    });
  });

  it('keeps a shared list by its name, and every other key as the file writes it', () => {
    expect(entry('visit.concern')).toEqual({
      path: 'visit.concern',
      kind: 'choice',
      many: false,
      label: 'New concern?',
      required: true,
      options: { list: 'demo_yes_no' },
    });
    expect(entry('findings.where')).toEqual({
      path: 'findings.where',
      kind: 'region',
      label: 'Where',
      options: { list: 'demo_regions' },
      side: 'side_rl',
      surface: true,
    });
    expect(entry('visit.pressure')).toEqual({
      path: 'visit.pressure',
      kind: 'group',
      label: 'Blood pressure',
      layout: 'row',
      mapsTo: 'full_demo:history.pressure',
    });
  });

  it('writes the rows of a grid as their number, their list or the field they are picked in', () => {
    expect(entry('status.reflexes')).toEqual({
      path: 'status.reflexes',
      kind: 'grid',
      label: 'Reflexes',
      sides: true,
      rows: 2,
    });
    expect(entry('findings.pulses').rows).toEqual({ list: 'demo_sites' });
    expect(entry('status.each').rows).toEqual({ pickedIn: 'visit.systems' });
    expect(entry('status.each.detail.note').showWhen).toEqual({ field: './seen', is: 'yes' });
  });

  it('a tree whose shape files are worked out from it passes; a change deep in a shape file is found', () => {
    const files = definitionFiles();
    files.noteTypes[CHECKS] = checks();
    const made = shapeOf('checks', files.noteTypes[CHECKS]) as Loose;
    const pieces = { checks: { shape: made } };
    expect(checkShapes(pieces, files)).toEqual([]);

    made.fields.find((f: Loose) => f.path === 'status.each.detail.note').required = undefined;
    made.fields.find((f: Loose) => f.path === 'findings.pulses.strength').many = true;
    made.fields.find((f: Loose) => f.path === 'visit.pressure.lower').max = 200;
    made.fields.find((f: Loose) => f.path === 'status.reflexes').rows = 3;
    made.fields.find((f: Loose) => f.path === 'findings.where').side = 'side';
    made.fields.find((f: Loose) => f.path === 'visit.systems').flags.suggests = { skin: 'checks_demo' };
    expect(found({ files, pieces })).toEqual(
      sorted([
        [CHECKS, '$.sections[3].fields[0].cell.fields[1].required', 'shape.field_differs'],
        [CHECKS, '$.sections[2].fields[4].cell.many', 'shape.field_differs'],
        [CHECKS, '$.sections[0].fields[8].fields[1].max', 'shape.field_differs'],
        [CHECKS, '$.sections[3].fields[1].rows', 'shape.field_differs'],
        [CHECKS, '$.sections[2].fields[0].side', 'shape.field_differs'],
        [CHECKS, '$.sections[0].fields[0].flags', 'shape.field_differs'],
      ]),
    );
  });
});

describe('a field that differs from the shape file', () => {
  differs('its kind', 1, 'discussed', 'kind', (f) => (f.kind = 'region'));
  differs('choose-many where the shape says choose-one', 0, 'naloxone', 'many', (f) => (f.many = true));
  differs('choose-one where the shape says choose-many', 0, 'supplies', 'many', (f) => (f.many = false));
  differs('an option too few', 0, 'supplies', 'options', (f) => f.options.splice(0, 1));
  differs('an option too many', 1, 'discussed', 'options', (f) =>
    f.options.push({ code: 'later', label: 'Later' }),
  );
  differs('a shared list where the shape counts options', 1, 'discussed', 'options', (f) => {
    f.options = { list: 'demo_yes_no' };
  });
  differs('a flag that is missing', 0, 'supplies', 'flags', (f) => delete f.options[5].other);
  differs('a flag on the wrong option', 0, 'education', 'flags', (f) => {
    delete f.options[4].other;
    f.options[3].other = true;
  });
  differs('a flag the shape does not have', 1, 'receiving', 'flags', (f) => (f.options[2].exclusive = true));
  differs('another flag on the right option', 1, 'interested_in', 'flags', (f) => {
    delete f.options[3].other;
    f.options[3].exclusive = true;
  });
  differs('a condition that names another answer', 0, 'naloxone_doses', 'showWhen', (f) => {
    f.showWhen = { field: 'provided.naloxone', is: 'offered' };
  });
  differs('a condition with its codes in another order', 1, 'interested_in', 'showWhen', (f) => {
    f.showWhen.is.reverse();
  });
  differs('a condition that is missing', 0, 'naloxone_doses', 'showWhen', (f) => delete f.showWhen);
  differs('a condition the shape does not have', 1, 'connect', 'showWhen', (f) => {
    f.showWhen = { field: 'treatment.interested', is: 'yes' };
  });
  differs('required where the shape does not say so', 1, 'receiving', 'required', (f) => (f.required = true));
  differs('sides where the shape does not say so', 0, 'naloxone_doses', 'sides', (f) => (f.sides = true));
  differs('noNormal where the shape does not say so', 0, 'naloxone', 'noNormal', (f) => (f.noNormal = true));
  differs('its label', 1, 'discussed', 'label', (f) => (f.label = 'Treatment Discussed?'));
  differs('a number’s range', 0, 'naloxone_doses', 'max', (f) => (f.max = 2));
  differs('a number’s display', 0, 'naloxone_doses', 'display', (f) => delete f.display);
  differs('what an action does', 1, 'connect', 'action', (f) => (f.action = 'show_handoff'));

  for (const [key, value] of [
    ['required', true],
    ['sides', true],
    ['noNormal', true],
    ['showWhen', { field: 'treatment.discussed', is: 'yes' }],
  ] as const)
    broken(`${key} in the shape file and not in the definition`, (t) => (shape(t).fields[4][key] = value), [
      NOTE,
      `${at(1, 'receiving')}.${key}`,
      'shape.field_differs',
    ]);

  broken(
    'every property that differs is named',
    (t) => Object.assign(field(t, 0, 'supplies'), { many: false, required: true, label: 'Supplies given' }),
    [NOTE, `${at(0, 'supplies')}.many`, 'shape.field_differs'],
    [NOTE, `${at(0, 'supplies')}.required`, 'shape.field_differs'],
    [NOTE, `${at(0, 'supplies')}.label`, 'shape.field_differs'],
  );
});

describe('the fields of a piece', () => {
  broken(
    'a field of the shape file that the definition does not have',
    (t) => note(t).sections[0].fields.splice(3, 1),
    [NOTE, '$.sections[0].fields', 'shape.missing_field'],
  );
  broken(
    'a field the shape file does not have',
    (t) =>
      note(t).sections[1].fields.push({
        id: 'notes',
        kind: 'text',
        label: 'Notes',
        lines: 'many',
        maxLength: 2000,
      }),
    [NOTE, '$.sections[1].fields[5]', 'shape.extra_field'],
  );
  broken(
    'a field under another id is one missing and one too many',
    (t) => (field(t, 1, 'discussed').id = 'talked'),
    [NOTE, '$.sections[1].fields', 'shape.missing_field'],
    [NOTE, at(1, 'discussed'), 'shape.extra_field'],
  );
  broken(
    'a field written in the other section',
    (t) => note(t).sections[1].fields.unshift(note(t).sections[0].fields.pop()),
    [NOTE, '$.sections[0].fields', 'shape.missing_field'],
    [NOTE, '$.sections[1].fields[0]', 'shape.extra_field'],
  );
  broken(
    'fields in another order: the first one out of place is named',
    (t) => note(t).sections[1].fields.reverse(),
    [NOTE, '$.sections[1].fields[0]', 'shape.field_order'],
  );
  broken(
    'a field moved into a group is at another path, and so is the group',
    (t) => {
      const [naloxone, doses, ...others] = note(t).sections[0].fields;
      const group = { id: 'kit', kind: 'group', label: 'Kit', layout: 'stack', fields: [doses] };
      note(t).sections[0].fields = [naloxone, group, ...others];
    },
    [NOTE, '$.sections[0].fields', 'shape.missing_field'],
    [NOTE, '$.sections[0].fields[1]', 'shape.extra_field'],
    [NOTE, '$.sections[0].fields[1].fields[0]', 'shape.extra_field'],
  );
});

describe('the sections of a piece', () => {
  const sectionDiffers = (name: string, key: string, change: (section: Loose) => void) =>
    broken(name, (t) => change(note(t).sections[1]), [NOTE, `$.sections[1].${key}`, 'shape.section_differs']);
  sectionDiffers('a title that differs', 'title', (s) => (s.title = 'Treatment'));
  sectionDiffers('a section that repeats where the shape does not say so', 'repeat', (s) => {
    s.repeat = { max: 5, itemTitle: 'Treatment {n}' };
  });
  sectionDiffers('a condition the shape does not have', 'showWhen', (s) => {
    s.showWhen = { field: 'provided.naloxone', is: 'accepted' };
  });
  for (const key of ['sensitiveExam', 'treatmentRecord', 'normal'])
    sectionDiffers(`${key} where the shape does not say so`, key, (s) => (s[key] = true));
  sectionDiffers('needs where the shape does not say so', 'needs', (s) => (s.needs = 'orderMedications'));
  broken(
    'treatmentRecord in the shape file and not in the definition',
    (t) => (shape(t).sections[1].treatmentRecord = true),
    [NOTE, '$.sections[1].treatmentRecord', 'shape.section_differs'],
  );

  broken(
    'a section of the shape file that does not name the piece: its fields are not listed one by one',
    (t) => delete note(t).sections[1].spec,
    [NOTE, '$.sections', 'shape.missing_section'],
  );
  broken(
    'a section the shape file does not have: its fields are not listed one by one',
    (t) =>
      note(t).sections.push({
        id: 'follow_up',
        title: 'Follow up',
        spec: PIECE,
        fields: [{ id: 'notes', kind: 'text', label: 'Notes', lines: 'many', maxLength: 2000 }],
      }),
    [NOTE, '$.sections[2]', 'shape.extra_section'],
  );
  broken(
    'sections in another order: the first one out of place is named, and their fields are not',
    (t) => note(t).sections.reverse(),
    [NOTE, '$.sections[0]', 'shape.section_order'],
  );
  it('a section of another piece between them changes nothing', () => {
    const tree = example();
    const other = {
      id: 'between',
      title: 'Between',
      fields: [{ id: 'note', kind: 'info', label: 'A note' }],
    };
    note(tree).sections.splice(1, 0, other);
    expect(found(tree)).toEqual([]);
    // Places are those of the file, not of the piece.
    note(tree).sections[2].title = 'Treatment';
    expect(found(tree)).toEqual(sorted([[NOTE, '$.sections[2].title', 'shape.section_differs']]));
  });
});

describe('a piece named by more than one file', () => {
  const SECOND = 'note-types/harm_reduction_example/v2.json';
  const MODULE = 'modules/demo_part/v1.json';

  it('each file is held to the shape on its own', () => {
    const tree = example();
    const second = structuredClone(note(tree));
    second.version = 2;
    second.sections[0].fields[0].many = true;
    tree.files.noteTypes[SECOND] = second;
    expect(found(tree)).toEqual(sorted([[SECOND, `${at(0, 'naloxone')}.many`, 'shape.field_differs']]));
  });

  it('a module’s sections are held to it like a note type’s', () => {
    const tree = example();
    tree.files.modules[MODULE] = {
      name: 'demo_part',
      version: 1,
      sections: structuredClone(note(tree).sections),
    };
    tree.files.modules[MODULE].sections[1].fields[4].action = 'show_handoff';
    note(tree).sections = [{ include: 'demo_part', version: 1 }];
    expect(found(tree)).toEqual(sorted([[MODULE, `${at(1, 'connect')}.action`, 'shape.field_differs']]));
  });
});

describe('the shape file', () => {
  broken('a section names a piece that has no shape file', (t) => delete t.pieces[PIECE]!.shape, [
    NOTE,
    '$.sections[0].spec',
    'shape.missing_file',
  ]);
  broken(
    'a section names a piece that has no file at all',
    (t) => (note(t).sections[1].spec = 'no-such-piece'),
    [NOTE, '$.sections[1].spec', 'shape.missing_file'],
    [NOTE, '$.sections', 'shape.missing_section'],
  );

  const bad = (name: string, change: (shape: Loose) => void, ...paths: string[]) =>
    broken(name, (t) => change(shape(t)), ...paths.map((path): Expected => [SHAPE, path, 'shape.bad_file']));
  for (const [what, value] of [
    ['a list', []],
    ['a text', 'none'],
    ['nothing', null],
  ] as const)
    broken(`is refused when it is ${what}`, (t) => (t.pieces[PIECE]!.shape = value), [
      SHAPE,
      '$',
      'shape.bad_file',
    ]);
  bad('a key it does not have', (s) => (s.notes = 'none'), '$.notes');
  for (const key of ['piece', 'sections', 'fields']) bad(`without ${key}`, (s) => delete s[key], '$');
  bad('the name of another piece', (s) => (s.piece = 'harm-reduction'), '$.piece');
  bad(
    'lists that are not lists',
    (s) => Object.assign(s, { sections: {}, fields: 'none' }),
    '$.sections',
    '$.fields',
  );
  bad('a section that is not an object', (s) => s.sections.push('follow_up'), '$.sections[2]');
  bad('a section without an id', (s) => delete s.sections[1].id, '$.sections[1].id');
  bad('a section listed twice', (s) => s.sections.push({ ...s.sections[0] }), '$.sections[2].id');
  bad(
    'a section that lists its fields or names its piece: those are not its shape',
    (s) => {
      s.sections[0].fields = [];
      s.sections[1].spec = PIECE;
    },
    '$.sections[0].fields',
    '$.sections[1].spec',
  );
  bad('a field that is not an object', (s) => s.fields.push('provided.notes'), '$.fields[9]');
  bad(
    'a field without a path, or with one that is no text',
    (s) => {
      delete s.fields[0].path;
      s.fields[1].path = 7;
    },
    '$.fields[0].path',
    '$.fields[1].path',
  );
  bad('a field without a kind', (s) => delete s.fields[2].kind, '$.fields[2].kind');
  bad('a field listed twice', (s) => s.fields.push({ ...s.fields[8] }), '$.fields[9].path');
  bad(
    'a field in no section of the shape file',
    (s) => (s.fields[8].path = 'plan.connect'),
    '$.fields[8].path',
  );
  bad('a field that is only a section’s id', (s) => (s.fields[8].path = 'treatment'), '$.fields[8].path');
  bad(
    'a field with an id, or with its children inside it: the path names it, and each child has its own entry',
    (s) => {
      s.fields[0].id = 'naloxone';
      s.fields[1].fields = [];
      s.fields[2].cell = {};
    },
    '$.fields[0].id',
    '$.fields[1].fields',
    '$.fields[2].cell',
  );
  bad(
    'options written out instead of counted',
    (s) => {
      s.fields[0].options = [{ code: 'offered', label: 'Offered' }];
      s.fields[2].rows = ['a', 'b'];
    },
    '$.fields[0].options',
    '$.fields[2].rows',
  );

  it('its faults are reported once, however many files name the piece, and nothing is compared with it', () => {
    const tree = example();
    const second = { ...structuredClone(note(tree)), version: 2 };
    second.sections[0].fields[0].many = true;
    tree.files.noteTypes['note-types/harm_reduction_example/v2.json'] = second;
    shape(tree).extra = true;
    expect(found(tree)).toEqual(sorted([[SHAPE, '$.extra', 'shape.bad_file']]));
  });
});
