import { describe, expect, it } from 'vitest';
import { resolve } from '../src/resolve.ts';
import { checkFile } from '../src/schema.ts';
import {
  checkSpec,
  LEFT_OUT,
  readPieces,
  specWords,
  unnamedPieces,
  type Piece,
  type SpecWord,
} from '../src/spec-check.ts';
import { validate } from '../src/validate.ts';
import { exampleBlocks } from './fixtures/example-doc.ts';
import { definitionFiles, specTexts, type LooseFiles } from './fixtures/load.ts';

// The spec check (design 4.2): the option words of a piece of the field specification against the
// option labels of the sections that name it. The main fixture is the worked example of the
// transcription recipe (docs/plan/patterns/form-definition-example.md); each failing case is that
// example with one change.

const NOTE = 'note-types/harm_reduction_example/v1.json';
const PIECE = 'harm-reduction-2';
const TXT = `spec/${PIECE}.txt`;
const DIFF = `spec/${PIECE}.diff.json`;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- files are changed as plain JSON */
type Loose = any;
type Tree = { files: LooseFiles; pieces: Record<string, Piece & { diff?: Loose }> };
type Expected = [file: string, path: string, rule: string];
const sorted = (found: Expected[]) => found.map((p) => p.join('  ')).sort();

function example(): Tree {
  const { pieces, problems } = readPieces(specTexts('example'));
  expect(problems).toEqual([]);
  return { files: definitionFiles('example'), pieces };
}
function found({ files, pieces }: Tree): string[] {
  const problems = checkSpec(pieces, files);
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
function fits(name: string, change: (tree: Tree) => void) {
  broken(name, change);
}
const note = (tree: Tree): Loose => tree.files.noteTypes[NOTE];
const field = (tree: Tree, section: number, id: string): Loose =>
  note(tree).sections[section].fields.find((f: Loose) => f.id === id);
const diff = (tree: Tree): Loose => tree.pieces[PIECE]!.diff;
const words = (text: string): string[] =>
  specWords(text).words.map((w: SpecWord) => `${w.line} ${w.from}: ${w.text}`);
/** The lines of a piece, as the export of the specification writes them. */
const lines = (...written: string[]): string => written.map((line) => `${line}\n`).join('');

describe('the words of a piece', () => {
  it('reads every bracketed word, with the export’s noise undone', () => {
    expect(
      words(
        lines(
          '   1. Demo row',
          '      1. Buttons: \\[ First word \\] \\[ Second \\]\\[ Third-one \\]\u00a0 \\[ Other \\] \u00a0 \u00a0',
          '      2. &#91; Fourth \\] \\[Fifth\\]&#32;',
          '      3. &#32;Buttons:\u00a0\\[ <1 wk \\] \\[ 1–4\u00a0\u00a0wk \\] \\[ 🏠 Home \\] \\[ \\_\\_\\_ cm \\]',
        ),
      ),
    ).toEqual([
      '2 bracket: First word',
      '2 bracket: Second',
      '2 bracket: Third-one',
      '2 bracket: Other',
      '3 bracket: Fourth',
      '3 bracket: Fifth',
      '4 bracket: <1 wk',
      '4 bracket: 1–4 wk',
      '4 bracket: 🏠 Home',
      '4 bracket: ___ cm',
    ]);
  });

  it('reads a row that runs over several lines, and a list item broken with backslashes', () => {
    expect(
      words(
        lines(
          '         1. Buttons: \\[ One \\] \\[ Two \\]\u00a0 \u00a0',
          '',
          '            &#91; Three \\] \\[ Four \\]',
          '         2. Buttons: \\[ Five \\]\\',
          '&#91; Six \\] \u00a0\\[ Seven \\]',
          '         3. A question?\\',
          '&#91; YES \\] \\[ NO \\]\\',
          '\\',
          'A VALUE: \\[ 10:52 AM \\]',
        ),
      ),
    ).toEqual([
      '1 bracket: One',
      '1 bracket: Two',
      '3 bracket: Three',
      '3 bracket: Four',
      '4 bracket: Five',
      '5 bracket: Six',
      '5 bracket: Seven',
      '7 bracket: YES',
      '7 bracket: NO',
      '9 bracket: 10:52 AM',
    ]);
  });

  it('skips a bracket with nothing in it', () => {
    expect(words(lines('      Right', '      &#91; \\]', '      &#91;\u00a0\\]'))).toEqual([]);
  });

  it('reads each bullet line, and no heading around it', () => {
    expect(
      words(
        lines(
          '      1\\. Demo system',
          '',
          '      Hidden by default unless picked.',
          '',
          '      A. First part',
          '',
          '      &#32;&#32;&#32;&#32;•   Well',
          '',
          '      &#32;&#32;&#32;&#32;•   Not\u00a0 so well',
          '',
          '      &#32;&#32;&#32;&#32;◦   Right',
          '',
          '      &#32;&#32;&#32;&#32;◦   Left',
          '',
          '      &#32;&#32;&#32;&#32;•&#32;&#32;&#32;',
          '',
          '      &#32;&#32;&#32;&#32;•   Size: \\_\\_\\_\\_\\_ cm',
          '',
          '      Grade',
          '',
          '      0 / 1+ / 2+',
          '',
          '      \\- Free text: *\\_\\_*\\_\\_\\_',
          '',
          '      UI notes: quick taps.',
          '',
          // A heading, though with its backslash undone it would read as a numbered line.
          '      2\\. Next system',
        ),
      ),
    ).toEqual([
      '7 bullet: Well',
      '9 bullet: Not so well',
      '11 bullet: Right',
      '13 bullet: Left',
      '17 bullet: Size: _____ cm',
    ]);
  });

  it('reads the bracket of a bullet line and not the line; a bracket on a later line leaves the bullet a word', () => {
    expect(
      words(
        lines(
          '      &#32;&#32;&#32;&#32;•   \\[ + ADD FINDING \\]',
          '      &#32;&#32;&#32;&#32;•   Last one',
          '',
          '      &#91; + ADD EXAM \\]',
        ),
      ),
    ).toEqual(['1 bracket: + ADD FINDING', '2 bullet: Last one', '4 bracket: + ADD EXAM']);
  });

  it('reads a numbered line with no bracket and nothing nested under it: a list written without brackets', () => {
    expect(
      words(
        lines(
          '               2. A list of plain options&#32;',
          '                  1. First plain&#32;',
          '                  2. Second / plain',
          '                  9. Ninth',
          '                  10. Tenth',
          '                  11. Other',
          '                      1. &#91; Text box \\]&#32;',
          '                  12. None known&#32;',
          '               3. A heading with a row',
          '                  1. Buttons: \\[ One \\]',
          '               4. Text box titled Something',
          '4) Another top entry&#32;',
          '   1. Its last line',
          '   2. &#32;',
          '   3. A line that ends in a break\\',
          'and goes on',
          '5) A plain entry after a bracket',
          '6.\u00a0After a hard space',
        ),
      ),
    ).toEqual([
      '2 line: First plain',
      '3 line: Second / plain',
      '4 line: Ninth',
      '5 line: Tenth',
      // "Other" has a line nested under it, so it reads as a heading.
      '7 bracket: Text box',
      '8 line: None known',
      '10 bracket: One',
      '11 line: Text box titled Something',
      '13 line: Its last line',
      '15 line: A line that ends in a break',
      '17 line: A plain entry after a bracket',
      '18 line: After a hard space',
    ]);
  });

  it('a numbered line is no word when a line that continues it holds a bracket, or a bullet is nested under it', () => {
    expect(
      words(
        lines(
          '            1. Length \u00a0 \u00a0 Width',
          '',
          '               &#32;\\[ \\_\\_\\_ cm \\] \u00a0 \\[ \\_\\_\\_ cm \\]',
          '            2. A heading over bullets',
          '               • Under it',
          '            3. A heading whose bullet is no deeper',
          '            • Beside it',
        ),
      ),
    ).toEqual([
      '3 bracket: ___ cm',
      '3 bracket: ___ cm',
      '5 bullet: Under it',
      '6 line: A heading whose bullet is no deeper',
      '7 bullet: Beside it',
    ]);
  });

  it(`skips a line that holds ${LEFT_OUT}, and still counts it`, () => {
    const text = lines(
      '         2. Example:&#32;',
      `            1. ${LEFT_OUT}`,
      LEFT_OUT,
      `${LEFT_OUT} \\[ NOT READ \\]`,
      '         3. After',
    );
    expect(words(text)).toEqual(['1 line: Example:', '5 line: After']);
    expect(specWords(text).lines).toBe(5);
  });

  it('counts lines from 1, with or without a last line break, and reads Windows line ends', () => {
    expect(specWords('\\[ A \\]\n\\[ B \\]\n').lines).toBe(2);
    expect(specWords('\\[ A \\]\n\\[ B \\]').lines).toBe(2);
    expect(words('1. Plain\r\n2. \\[ B \\]\r\n')).toEqual(['1 line: Plain', '2 bracket: B']);
  });

  it('says which lines have a bracket with no partner', () => {
    const { words: read, unclosed } = specWords(
      lines(
        '1. Buttons: \\[ One \\] \\[ Two',
        '2. Three \\] \\[ Four \\]',
        '3. \\[ Five \\]',
        '4. \\[ \\[ Six \\] \\]',
      ),
    );
    expect(unclosed).toEqual([1, 2, 4]);
    expect(read.map((w) => w.text)).toEqual(['One', 'Four', 'Five', 'Six']);
  });
});

describe('the files of a piece', () => {
  it('are found by their names, and the two JSON files are parsed', () => {
    const { pieces, problems } = readPieces(specTexts('example'));
    expect(problems).toEqual([]);
    expect(Object.keys(pieces)).toEqual([PIECE]);
    expect(pieces[PIECE]!.text).toContain('HARM REDUCTION PROVIDED');
    expect((pieces[PIECE]!.diff as Loose).piece).toBe(PIECE);
    expect((pieces[PIECE]!.shape as Loose).piece).toBe(PIECE);
  });

  it('a file that is none of the three, and one that does not parse, are refused', () => {
    const { pieces, problems } = readPieces({
      'spec/demo.txt': 'lines\n',
      'spec/demo.diff.json': '{ "piece": ',
      'spec/demo.shape.json': '[1]',
      'spec/demo.md': 'notes',
      'spec/Demo.txt': 'capital',
      'spec/sub/demo.txt': 'nested',
      'old/spec/demo.txt': 'elsewhere',
      'lists/demo.json': '{}',
    });
    expect(pieces).toEqual({ demo: { text: 'lines\n', shape: [1] } });
    expect(sorted(problems.map((p): Expected => [p.file, p.path, p.rule]))).toEqual(
      sorted([
        ['spec/demo.diff.json', '$', 'spec.bad_json'],
        ['spec/demo.md', '$', 'spec.unknown_file'],
        ['spec/Demo.txt', '$', 'spec.unknown_file'],
        ['spec/sub/demo.txt', '$', 'spec.unknown_file'],
        ['old/spec/demo.txt', '$', 'spec.unknown_file'],
        ['lists/demo.json', '$', 'spec.unknown_file'],
      ]),
    );
  });

  it('a piece that no section names is listed, and nothing is checked against it', () => {
    const tree = example();
    tree.pieces['not-yet'] = { text: lines('1. Buttons: \\[ Unused \\]') };
    tree.pieces['also-not-yet'] = {};
    expect(found(tree)).toEqual([]);
    expect(unnamedPieces(tree.pieces, tree.files)).toEqual(['also-not-yet', 'not-yet']);
    for (const section of note(tree).sections) delete section.spec;
    expect(found(tree)).toEqual([]);
    expect(unnamedPieces(tree.pieces, tree.files)).toEqual(['also-not-yet', PIECE, 'not-yet']);
  });
});

describe('the worked example', () => {
  it('is a definition that fits the schema, resolves and passes the validator', () => {
    const files = definitionFiles('example');
    expect(checkFile('noteType', files.noteTypes[NOTE])).toEqual([]);
    const resolved = resolve(NOTE, files);
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.problems));
    expect(validate(resolved.definition, { origins: resolved.origins, noteType: () => undefined })).toEqual(
      [],
    );
  });

  it('passes the spec check', () => {
    expect(found(example())).toEqual([]);
  });

  it('is the example the recipe shows: its lines, its definition and its diff file', () => {
    const tree = example();
    const blocks = exampleBlocks();
    expect(blocks[1]).toEqual([tree.pieces[PIECE]!.text]);
    expect(blocks[5]!.map((block) => JSON.parse(block))).toEqual([diff(tree)]);
    // The recipe shows the first section without one of its fields, and two fields of the second.
    const [first, others] = [JSON.parse(blocks[4]![0]!), JSON.parse(`[${blocks[4]![1]!}]`)];
    const { fields, ...header } = first;
    const { fields: _, ...written } = note(tree).sections[0];
    expect(header).toEqual(written);
    expect(fields.length).toBe(3);
    for (const shown of fields) expect(shown).toEqual(field(tree, 0, shown.id));
    expect(others.length).toBe(2);
    for (const shown of others) expect(shown).toEqual(field(tree, 1, shown.id));
  });
});

// The words that only the second section of the example has: Yes, No and Unknown; Maybe; three treatments.
const SECOND_HALF: Expected[] = [12, 12, 12, 16, 18, 18, 18].map((line) => [
  TXT,
  `line ${line}`,
  'spec.not_in_definition',
]);

describe('a word in the piece and not in the definition', () => {
  broken('an option that was not typed', (t) => field(t, 0, 'supplies').options.splice(2, 1), [
    TXT,
    'line 7',
    'spec.not_in_definition',
  ]);
  broken(
    'an option typed with other words is missing, and what was typed is not in the piece',
    (t) => (field(t, 0, 'naloxone').options[3].label = 'Already has some'),
    [TXT, 'line 4', 'spec.not_in_definition'],
    [NOTE, '$.sections[0].fields[0].options[3].label', 'spec.not_in_piece'],
  );
  broken(
    'a difference in capitals is a difference',
    (t) => (field(t, 1, 'interested_in').options[1].label = 'methadone'),
    [TXT, 'line 18', 'spec.not_in_definition'],
    [NOTE, '$.sections[1].fields[3].options[1].label', 'spec.not_in_piece'],
  );
  broken('a bracketed word that is not an option must be declared', (t) => diff(t).notOptions.splice(1, 1), [
    TXT,
    'line 5',
    'spec.not_in_definition',
  ]);
  broken(
    'a word is looked for in the sections that name the piece, not in the others',
    (t) => delete note(t).sections[1].spec,
    ...SECOND_HALF,
  );
  fits(
    'a word that is an option of any field of those sections is found: it checks the words, not the fields',
    (t) => {
      // "Other" is in three rows of the piece and stays an option of two fields.
      field(t, 0, 'supplies').options.pop();
    },
  );
});

describe('an option in the definition and not in the piece', () => {
  const extra = { code: 'water', label: 'Water' };
  broken('an option that the lines do not have', (t) => field(t, 0, 'supplies').options.push(extra), [
    NOTE,
    '$.sections[0].fields[2].options[6].label',
    'spec.not_in_piece',
  ]);
  fits('unless the diff file lists it as added', (t) => {
    field(t, 0, 'supplies').options.push(extra);
    diff(t).added.push('Water');
  });
  broken(
    'an option that comes from a shared list: the problem names the place the list is named',
    (t) => {
      t.files.lists['lists/demo_answers.json'] = {
        name: 'demo_answers',
        options: [
          { code: 'yes', label: 'Yes' },
          { code: 'no', label: 'No' },
          { code: 'unsure', label: 'Unsure' },
          { code: 'refused', label: 'Refused' },
        ],
      };
      field(t, 1, 'discussed').options = { list: 'demo_answers' };
    },
    [NOTE, '$.sections[1].fields[1].options.list', 'spec.not_in_piece'],
    [NOTE, '$.sections[1].fields[1].options.list', 'spec.not_in_piece'],
  );
  fits('the options of a shared list count as the section’s own', (t) => {
    t.files.lists['lists/demo_answers.json'] = {
      name: 'demo_answers',
      options: [
        { code: 'yes', label: 'Yes' },
        { code: 'maybe', label: 'Maybe' },
        { code: 'no', label: 'No' },
      ],
    };
    field(t, 1, 'interested').options = { list: 'demo_answers' };
  });
});

describe('the options of every kind of field', () => {
  // A made-up piece whose words are spread over a group, two grids and a body map.
  const KINDS = 'note-types/kinds_demo/v1.json';
  function kinds(): Tree {
    const tree = example();
    tree.files.lists = definitionFiles().lists;
    tree.pieces.kinds = {
      text: lines(
        '1. Sites',
        '   1. Buttons: \\[ Radial \\] \\[ Pedal \\] \\[ 0 \\] \\[ 1+ \\] \\[ 2+ \\] \\[ Unable to assess \\]',
        '2. Reflexes',
        '   • Knee',
        '   • Ankle',
        '   • Present',
        '   • Absent',
        '3. Where',
        '   1. Buttons: \\[ Arm \\] \\[ Leg \\] \\[ Back \\] \\[ Right \\] \\[ Left \\]',
        '4. Inside a group',
        '   1. Buttons: \\[ Deep \\] \\[ Shallow \\]',
      ),
      diff: { piece: 'kinds', notOptions: [], added: [], differences: [] },
    };
    tree.files.noteTypes[KINDS] = {
      key: 'kinds_demo',
      version: 1,
      title: 'Kinds (test)',
      kinds: ['medical'],
      group: 'clinical',
      sensitivity: 'none',
      sections: [
        {
          id: 'all',
          title: 'All',
          spec: 'kinds',
          fields: [
            {
              id: 'pulses',
              kind: 'grid',
              label: 'Pulses',
              rows: { list: 'demo_sites' },
              cell: {
                id: 'strength',
                kind: 'choice',
                many: false,
                label: 'Strength',
                options: { list: 'demo_scale' },
              },
            },
            {
              id: 'reflexes',
              kind: 'grid',
              label: 'Reflexes',
              rows: [
                { code: 'knee', label: 'Knee' },
                { code: 'ankle', label: 'Ankle' },
              ],
              cell: {
                id: 'found',
                kind: 'choice',
                many: false,
                label: 'Found',
                options: [
                  { code: 'present', label: 'Present' },
                  { code: 'absent', label: 'Absent' },
                ],
              },
            },
            {
              id: 'where',
              kind: 'region',
              label: 'Where',
              options: { list: 'demo_regions' },
              side: 'side_rl',
            },
            {
              id: 'more',
              kind: 'group',
              label: 'More',
              layout: 'stack',
              fields: [
                {
                  id: 'depth',
                  kind: 'choice',
                  many: false,
                  label: 'Depth',
                  options: [
                    { code: 'deep', label: 'Deep' },
                    { code: 'shallow', label: 'Shallow' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    return tree;
  }
  const all = (tree: Tree, id: string): Loose =>
    tree.files.noteTypes[KINDS].sections[0].fields.find((f: Loose) => f.id === id);
  function without(name: string, change: (tree: Tree) => void, ...expected: Expected[]) {
    it(name, () => {
      const tree = kinds();
      change(tree);
      expect(found(tree)).toEqual(sorted(expected));
    });
  }
  const missing = (line: number): Expected => ['spec/kinds.txt', `line ${line}`, 'spec.not_in_definition'];

  without('are all read', () => {});
  without(
    'the rows of a grid, from a list',
    (t) => (all(t, 'pulses').rows = { pickedIn: 'all.where' }),
    missing(2),
    missing(2),
  );
  without(
    'the cell of a grid',
    (t) => (all(t, 'pulses').cell = { id: 'felt', kind: 'flag', label: 'Felt' }),
    missing(2),
    missing(2),
    missing(2),
    missing(2),
  );
  without('the rows of a grid, written in place', (t) => all(t, 'reflexes').rows.pop(), missing(5));
  without(
    'the options of a cell, written in place',
    (t) => all(t, 'reflexes').cell.options.pop(),
    missing(7),
  );
  without(
    'the regions of a body map',
    (t) => (all(t, 'where').options = [{ code: 'arm', label: 'Arm' }]),
    missing(9),
    missing(9),
  );
  without(
    'the list a body map takes its sides from',
    (t) => delete all(t, 'where').side,
    missing(9),
    missing(9),
  );
  without('a field in a group', (t) => all(t, 'more').fields[0].options.pop(), missing(11));
  without(
    'a side the lines do not have is an added option, named where the list is',
    (t) => (all(t, 'where').side = 'side'),
    [KINDS, '$.sections[0].fields[2].side', 'spec.not_in_piece'],
  );
  without(
    'a row and a cell’s option the lines do not have',
    (t) => {
      all(t, 'reflexes').rows.push({ code: 'elbow', label: 'Elbow' });
      all(t, 'reflexes').cell.options.push({ code: 'brisk', label: 'Brisk' });
      all(t, 'more').fields[0].options.push({ code: 'medium', label: 'Medium' });
    },
    [KINDS, '$.sections[0].fields[1].rows[2].label', 'spec.not_in_piece'],
    [KINDS, '$.sections[0].fields[1].cell.options[2].label', 'spec.not_in_piece'],
    [KINDS, '$.sections[0].fields[3].fields[0].options[2].label', 'spec.not_in_piece'],
  );
  without(
    'a list that is not among the files gives no options here; the resolver reports it',
    (t) => delete t.files.lists['lists/demo_sites.json'],
    missing(2),
    missing(2),
  );
});

describe('a piece named by more than one file', () => {
  const SECOND = 'note-types/harm_reduction_example/v2.json';
  const MODULE = 'modules/demo_part/v1.json';

  it('each file is checked on its own: a later version has every word of the piece too', () => {
    const tree = example();
    const second = structuredClone(note(tree));
    second.version = 2;
    second.sections[0].fields[2].options.splice(2, 1);
    tree.files.noteTypes[SECOND] = second;
    expect(checkSpec(tree.pieces, tree.files).map((p) => [p.file, p.path, p.rule, p.message])).toEqual([
      [
        TXT,
        'line 7',
        'spec.not_in_definition',
        `"Sharps" is no option in the sections of ${SECOND} that name this piece; type it there, or list it under notOptions in ${DIFF}`,
      ],
    ]);
  });

  it('a module’s sections are read like a note type’s, and an include is passed over', () => {
    const tree = example();
    const { sections } = note(tree);
    tree.files.modules[MODULE] = { name: 'demo_part', version: 1, sections: [sections[1]] };
    note(tree).sections = [sections[0], { include: 'demo_part', version: 1 }];
    // Each file now holds half of the piece's words, and is told of the other half.
    const problems = checkSpec(tree.pieces, tree.files);
    expect(new Set(problems.map((p) => p.rule))).toEqual(new Set(['spec.not_in_definition']));
    const told = (file: string) =>
      problems.filter((p) => p.message.includes(` of ${file} `)).map((p) => p.path);
    expect(told(NOTE).sort()).toEqual(SECOND_HALF.map((p) => p[1]));
    expect(told(MODULE).sort()).toEqual(
      [4, 4, 4, 4, 7, 7, 7, 7, 7, 9, 9, 9, 9].map((line) => `line ${line}`),
    );
  });
});

describe('the diff file', () => {
  broken(
    'a word listed as not an option that the piece does not have',
    (t) => diff(t).notOptions.push('− −'),
    [DIFF, '$.notOptions[3]', 'spec.not_option_unused'],
  );
  broken('a word listed as not an option that is one', (t) => diff(t).notOptions.push('Sharps'), [
    DIFF,
    '$.notOptions[3]',
    'spec.not_option_is_option',
  ]);
  broken('an added label that no option has', (t) => diff(t).added.push('Water'), [
    DIFF,
    '$.added[0]',
    'spec.added_unused',
  ]);
  broken('an added label that is in the piece after all', (t) => diff(t).added.push('Sharps'), [
    DIFF,
    '$.added[0]',
    'spec.added_in_piece',
  ]);

  const badDiff = (name: string, change: (diff: Loose, tree: Tree) => void, ...paths: string[]) =>
    broken(name, (t) => change(diff(t), t), ...paths.map((path): Expected => [DIFF, path, 'spec.bad_diff']));
  for (const [what, value] of [
    ['a list', []],
    ['a text', 'none'],
    ['nothing', null],
  ] as const)
    broken(`is refused when it is ${what}`, (t) => (t.pieces[PIECE]!.diff = value), [
      DIFF,
      '$',
      'spec.bad_diff',
    ]);
  badDiff('a key it does not have', (d) => (d.leftOut = []), '$.leftOut');
  for (const key of ['piece', 'notOptions', 'added', 'differences'])
    badDiff(`without ${key}`, (d) => delete d[key], '$');
  badDiff('the name of another piece', (d) => (d.piece = 'harm-reduction'), '$.piece');
  badDiff(
    'lists that are not lists',
    (d) => Object.assign(d, { notOptions: 'CONNECT', added: {}, differences: 'none' }),
    '$.notOptions',
    '$.added',
    '$.differences',
  );
  badDiff('a word that is not a text, or is empty', (d) => d.added.push(4, ''), '$.added[0]', '$.added[1]');
  badDiff(
    'a word with spaces at its ends, or two together',
    (d) => d.notOptions.push(' +', 'CONNECT  TO RESOURCE'),
    '$.notOptions[3]',
    '$.notOptions[4]',
  );
  badDiff('a word listed twice', (d) => d.notOptions.push('+'), '$.notOptions[3]');
  badDiff('a difference that is not an object', (d) => d.differences.push('line 5'), '$.differences[4]');
  badDiff(
    'a difference with a key it does not have',
    (d) => (d.differences[0].lines = [5, 6]),
    '$.differences[0].lines',
  );
  for (const line of [0, 20, 5.5, '5', undefined])
    badDiff(
      `a difference at line ${String(line)}, which is no line of the piece`,
      (d) => (d.differences[1].line = line),
      '$.differences[1].line',
    );
  fits('a difference at the first and at the last line', (t) => {
    diff(t).differences[0].line = 1;
    diff(t).differences[1].line = 19;
  });
  badDiff(
    'a difference that does not say what, or why',
    (d) => {
      d.differences[2].what = ' ';
      delete d.differences[3].why;
    },
    '$.differences[2].what',
    '$.differences[3].why',
  );

  it('its faults are reported once, however many files name the piece', () => {
    const tree = example();
    tree.files.noteTypes['note-types/harm_reduction_example/v2.json'] = {
      ...structuredClone(note(tree)),
      version: 2,
    };
    diff(tree).extra = true;
    expect(found(tree)).toEqual(sorted([[DIFF, '$.extra', 'spec.bad_diff']]));
  });
});

describe('a piece that cannot be checked', () => {
  broken('a section names a piece whose lines are not there', (t) => delete t.pieces[PIECE]!.text, [
    NOTE,
    '$.sections[0].spec',
    'spec.missing_text',
  ]);
  broken(
    'a section names a piece that has no file at all',
    (t) => (note(t).sections[1].spec = 'no-such-piece'),
    [NOTE, '$.sections[1].spec', 'spec.missing_text'],
    // And the first section alone no longer has every word of its piece.
    ...SECOND_HALF,
  );
  broken('a section names a piece that has no diff file', (t) => delete t.pieces[PIECE]!.diff, [
    NOTE,
    '$.sections[0].spec',
    'spec.missing_diff',
  ]);
  broken(
    'a line with a bracket that has no partner: nothing is compared until it is mended',
    (t) => (t.pieces[PIECE]!.text = t.pieces[PIECE]!.text!.replace('\\[ Sharps \\]', '\\[ Sharps')),
    [TXT, 'line 7', 'spec.unclosed_bracket'],
  );
});
