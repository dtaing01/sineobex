import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import schema from '../schema/definition.schema.json' with { type: 'json' };
import { checkFile, FILE_KINDS, type FileKind } from '../src/schema.ts';
import {
  KEY,
  MAX_REPEAT,
  MAX_TEXT_LENGTH,
  OPTION_CODE,
  PATH_PART,
  type Field,
  type FieldKind,
} from '../src/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- failing files are valid ones broken on purpose, and the schema is walked as plain JSON */

const fixture = (name: string): any =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

type Expected = [path: string, rule: string];
const sorted = (list: Expected[]) => list.map((p) => p.join('  ')).sort();
const found = (kind: FileKind, file: unknown) =>
  sorted(checkFile(kind, file).map((p): Expected => [p.path, p.rule]));

const MISSING = 'schema.missing_key';
const UNKNOWN_KEY = 'schema.unknown_key';
const WRONG_TYPE = 'schema.wrong_type';
const UNKNOWN_KIND = 'schema.unknown_kind';
const NOT_ALLOWED = 'schema.not_allowed';
const BAD_FORMAT = 'schema.bad_format';
const LIMIT = 'schema.limit';
const DUPLICATE = 'schema.duplicate';
const BAD_CONDITION = 'schema.bad_condition';

// The example of design 2.5, character for character.
const designExample = fixture('design-example');

/** The 2.5 example: a fresh copy each time, for one change. */
const example = (): any => structuredClone(designExample);

describe('the example of design 2.5', () => {
  it('is the fixture, character for character', () => {
    const design = readFileSync(new URL('../../../docs/design/phase-4/forms.md', import.meta.url), 'utf8');
    const block = /### 2\.5 [^\n]*\n\n```json\n([\s\S]*?)```/.exec(design);
    expect(block?.[1]).toBe(readFileSync(new URL('./fixtures/design-example.json', import.meta.url), 'utf8'));
  });

  it('passes as written', () => {
    expect(checkFile('noteType', designExample)).toEqual([]);
  });

  // 2.2 requires the timeline group of every note type, and the chart reads it for every note
  // (lifecycle 5.2). The example was once written without one.
  it('does not pass without its timeline group', () => {
    const file = example();
    delete file.group;
    const problems = checkFile('noteType', file);
    expect(problems.map((p) => [p.path, p.rule])).toEqual([['$', MISSING]]);
    expect(problems[0]!.message).toContain('"group"');
  });
});

describe('files that fit', () => {
  const everyKind = fixture('every-kind');

  it('a note type with every kind of field, a module and a shared list', () => {
    expect(checkFile('noteType', everyKind)).toEqual([]);
    expect(checkFile('module', fixture('module'))).toEqual([]);
    expect(checkFile('list', fixture('list'))).toEqual([]);
  });

  // Otherwise "every kind passes" would hold only for the kinds and keys someone remembered.
  it('between them use every kind and every key the schema has', () => {
    const used = new Set<string>();
    const kinds = new Set<string>();
    const walk = (value: any) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value === null || typeof value !== 'object') return;
      if (typeof value.kind === 'string') kinds.add(value.kind);
      for (const [key, child] of Object.entries(value)) {
        used.add(key);
        walk(child);
      }
    };
    [everyKind, fixture('module'), fixture('list')].forEach(walk);
    const keys = new Set<string>();
    for (const def of Object.values(schema.$defs) as any[])
      for (const key of Object.keys(def.properties ?? {})) keys.add(key);
    expect([...keys].filter((key) => !used.has(key))).toEqual([]);
    expect([...kinds].sort()).toEqual([...schema.$defs.field.properties.kind.enum].sort());
  });

  it('a file of one kind does not pass as another', () => {
    const files: Record<FileKind, unknown> = {
      noteType: example(),
      module: fixture('module'),
      list: fixture('list'),
    };
    for (const kind of FILE_KINDS)
      for (const other of FILE_KINDS)
        expect(checkFile(kind, files[other]).length === 0, `${other} as ${kind}`).toBe(kind === other);
  });

  // The schema file can also be used whole, by an editor: it tells the three kinds apart by their keys.
  it('the schema used whole takes each kind of file, and refuses a broken one', () => {
    const whole = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true }).compile(schema);
    for (const file of [example(), everyKind, fixture('module'), fixture('list')])
      expect(whole(file)).toBe(true);
    const { group: _group, ...withoutGroup } = example();
    for (const broken of [
      withoutGroup,
      [],
      { ...fixture('module'), version: 0 },
      { ...fixture('list'), options: [] },
    ])
      expect(whole(broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Failing files. Each is a valid file with one change, and names the rule it breaks.

type Case = { name: string; kind: FileKind; file: unknown; problems: Expected[] };
const failing: Case[] = [];
const fitting: Omit<Case, 'problems'>[] = [];

const S = '$.sections[0]';
const F = `${S}.fields[1]`;
const C = `${F}.showWhen`;

/** One change to the example. */
function broken(name: string, change: (file: any) => void, ...problems: Expected[]) {
  const file = example();
  change(file);
  failing.push({ name, kind: 'noteType', file, problems });
}
function fits(name: string, change: (file: any) => void) {
  const file = example();
  change(file);
  fitting.push({ name, kind: 'noteType', file });
}

const TEXT: Field = { id: 'x', kind: 'text', label: 'X', lines: 'one', maxLength: 10 };
const OPTIONS = [
  { code: 'a', label: 'A' },
  { code: 'b', label: 'B' },
];
/** The smallest field of each kind: nothing in it is optional. */
const SMALLEST: { [K in FieldKind]: Extract<Field, { kind: K }> } = {
  choice: { id: 'x', kind: 'choice', label: 'X', many: false, options: OPTIONS },
  text: { id: 'x', kind: 'text', label: 'X', lines: 'one', maxLength: 10 },
  number: { id: 'x', kind: 'number', label: 'X', min: 0, max: 1, decimals: 0 },
  flag: { id: 'x', kind: 'flag', label: 'X' },
  date: { id: 'x', kind: 'date', label: 'X', range: 'any' },
  time: { id: 'x', kind: 'time', label: 'X' },
  duration: { id: 'x', kind: 'duration', label: 'X' },
  group: { id: 'x', kind: 'group', label: 'X', layout: 'stack', fields: [TEXT] },
  grid: { id: 'x', kind: 'grid', label: 'X', rows: OPTIONS, cell: TEXT },
  region: { id: 'x', kind: 'region', label: 'X', options: OPTIONS },
  problem: { id: 'x', kind: 'problem', label: 'X' },
  photo: { id: 'x', kind: 'photo', label: 'X', max: 1 },
  action: { id: 'x', kind: 'action', label: 'X', action: 'show_handoff' },
  info: { id: 'x', kind: 'info', label: 'X' },
};
const KINDS = Object.keys(SMALLEST) as FieldKind[];

const withField = (kind: FieldKind, change: (field: any) => void) => (file: any) => {
  const field = structuredClone(SMALLEST[kind]);
  change(field);
  file.sections[0].fields[1] = field;
};
/** The example's second field replaced by the smallest field of a kind, with one change to it. */
function brokenField(name: string, kind: FieldKind, change: (field: any) => void, ...problems: Expected[]) {
  broken(name, withField(kind, change), ...problems);
}
function fittingField(name: string, kind: FieldKind, change: (field: any) => void) {
  fits(name, withField(kind, change));
}
/** The example's condition replaced. */
function brokenCondition(name: string, condition: unknown, ...problems: Expected[]) {
  broken(name, (file) => (file.sections[0].fields[1].showWhen = condition), ...problems);
}
function fittingCondition(name: string, condition: unknown) {
  fits(name, (file) => (file.sections[0].fields[1].showWhen = condition));
}
function brokenFile(
  name: string,
  kind: 'module' | 'list',
  change: (file: any) => void,
  ...problems: Expected[]
) {
  const file = fixture(kind);
  change(file);
  failing.push({ name, kind, file, problems });
}

// The rules the design names (4.2), then the limits of 2.4.
broken(
  'a misspelt key',
  (f) => {
    f.sections[0].fields[1].showwhen = f.sections[0].fields[1].showWhen;
    delete f.sections[0].fields[1].showWhen;
  },
  [`${F}.showwhen`, UNKNOWN_KEY],
);
broken('a missing label', (f) => delete f.sections[0].fields[0].label, [`${S}.fields[0]`, MISSING]);
broken('a wrong type', (f) => (f.sections[0].fields[1].max = '20'), [`${F}.max`, WRONG_TYPE]);
broken('an unknown kind', (f) => (f.sections[0].fields[1].kind = 'slider'), [`${F}.kind`, UNKNOWN_KIND]);
broken('a key on a kind that may not carry it', (f) => (f.sections[0].fields[0].unit = 'doses'), [
  `${S}.fields[0].unit`,
  UNKNOWN_KEY,
]);
fittingField('a text of 4,000 characters', 'text', (f) => (f.maxLength = MAX_TEXT_LENGTH));
brokenField('a text longer than 4,000 characters', 'text', (f) => (f.maxLength = MAX_TEXT_LENGTH + 1), [
  `${F}.maxLength`,
  LIMIT,
]);
fits('a section of 20 entries', (f) => (f.sections[0].repeat = { max: MAX_REPEAT, itemTitle: 'Entry {n}' }));
broken(
  'a section of more than 20 entries',
  (f) => (f.sections[0].repeat = { max: MAX_REPEAT + 1, itemTitle: 'Entry {n}' }),
  [`${S}.repeat.max`, LIMIT],
);

// The file itself.
failing.push({
  name: 'a note type that is a list',
  kind: 'noteType',
  file: [example()],
  problems: [['$', WRONG_TYPE]],
});
failing.push({
  name: 'a module that is not an object',
  kind: 'module',
  file: null,
  problems: [['$', WRONG_TYPE]],
});
failing.push({
  name: 'a shared list that is not an object',
  kind: 'list',
  file: 'x',
  problems: [['$', WRONG_TYPE]],
});

// A note type's own keys.
for (const key of ['key', 'version', 'title', 'kinds', 'group', 'sensitivity', 'sections'])
  broken(`a note type without ${key}`, (f) => delete f[key], ['$', MISSING]);
broken('a note type key with a capital letter', (f) => (f.key = 'Harm_reduction'), ['$.key', BAD_FORMAT]);
broken('a note type key of one letter', (f) => (f.key = 'h'), ['$.key', BAD_FORMAT]);
broken('a key that is not a string', (f) => (f.key = 7), ['$.key', WRONG_TYPE]);
broken('version 0', (f) => (f.version = 0), ['$.version', LIMIT]);
fits('the highest version the database holds', (f) => (f.version = 2147483647));
broken('a version the database cannot hold', (f) => (f.version = 3000000000), ['$.version', LIMIT]);
broken('a title of spaces only', (f) => (f.title = '   '), ['$.title', BAD_FORMAT]);
broken(
  'a label holding a NUL, which the database refuses',
  (f) => (f.sections[0].fields[0].label = 'a\u0000b'),
  [`${S}.fields[0].label`, BAD_FORMAT],
);
broken('a label with a line break', (f) => (f.sections[0].fields[0].label = 'one\ntwo'), [
  `${S}.fields[0].label`,
  BAD_FORMAT,
]);
broken('a label holding half of a surrogate pair', (f) => (f.sections[0].fields[0].label = 'x\ud800'), [
  `${S}.fields[0].label`,
  BAD_FORMAT,
]);
fits(
  'a label with spaces around words, an accent and an emoji',
  (f) => (f.sections[0].fields[0].label = ' Café 😀 '),
);
broken('a version that is not a whole number', (f) => (f.version = 1.5), ['$.version', WRONG_TYPE]);
broken('an empty title', (f) => (f.title = ''), ['$.title', LIMIT]);
broken('a title that is not a string', (f) => (f.title = 5), ['$.title', WRONG_TYPE]);
broken('a note type offered for no kind of encounter', (f) => (f.kinds = []), ['$.kinds', LIMIT]);
broken('one kind of encounter named twice', (f) => (f.kinds = ['medical', 'medical']), [
  '$.kinds',
  DUPLICATE,
]);
broken('an unknown kind of encounter', (f) => (f.kinds = ['dental']), ['$.kinds[0]', NOT_ALLOWED]);
broken('kinds that are not a list', (f) => (f.kinds = 'medical'), ['$.kinds', WRONG_TYPE]);
broken('a timeline group the chart has no filter for', (f) => (f.group = 'referrals'), [
  '$.group',
  NOT_ALLOWED,
]);
broken('an unknown sensitivity', (f) => (f.sensitivity = 'high'), ['$.sensitivity', NOT_ALLOWED]);
broken('a marker set to false', (f) => (f.quick = false), ['$.quick', NOT_ALLOWED]);
broken('a note type added by itself for Non-Medical', (f) => (f.auto = 'non_medical'), [
  '$.auto',
  NOT_ALLOWED,
]);
broken('a key the format does not have', (f) => (f.sensitive = true), ['$.sensitive', UNKNOWN_KEY]);
broken('no sections', (f) => (f.sections = []), ['$.sections', LIMIT]);
broken('sections that are not a list', (f) => (f.sections = {}), ['$.sections', WRONG_TYPE]);

// The renames a version declares (2.6).
const RENAME = { path: 'naloxone.offer', code: 'accepted', from: 'Took it', to: 'Accepted' };
fits('a rename of an option', (f) => (f.renames = [RENAME]));
fits(
  'a rename of a field’s own label, without a code',
  (f) => (f.renames = [{ path: 'naloxone.offer', from: 'Offer', to: 'Offered' }]),
);
broken('renames that are not a list', (f) => (f.renames = RENAME), ['$.renames', WRONG_TYPE]);
broken('an empty list of renames', (f) => (f.renames = []), ['$.renames', LIMIT]);
broken('a rename that is not an object', (f) => (f.renames = ['offer']), ['$.renames[0]', WRONG_TYPE]);
for (const key of ['path', 'from', 'to'])
  broken(
    `a rename without ${key}`,
    (f) => {
      const rename: any = { ...RENAME };
      delete rename[key];
      f.renames = [rename];
    },
    ['$.renames[0]', MISSING],
  );
broken('a rename with a key it does not have', (f) => (f.renames = [{ ...RENAME, why: 'clearer' }]), [
  '$.renames[0].why',
  UNKNOWN_KEY,
]);
broken('a rename whose path starts from an entry', (f) => (f.renames = [{ ...RENAME, path: './offer' }]), [
  '$.renames[0].path',
  BAD_FORMAT,
]);
broken('a rename whose path is not a string', (f) => (f.renames = [{ ...RENAME, path: 3 }]), [
  '$.renames[0].path',
  WRONG_TYPE,
]);
broken('a rename to an empty label', (f) => (f.renames = [{ ...RENAME, to: '' }]), [
  '$.renames[0].to',
  LIMIT,
]);
broken('a rename of a code that is no code', (f) => (f.renames = [{ ...RENAME, code: 'Took' }]), [
  '$.renames[0].code',
  BAD_FORMAT,
]);
brokenFile(
  'a module with renames, which only a note type declares',
  'module',
  (f) => (f.renames = [RENAME]),
  ['$.renames', UNKNOWN_KEY],
);

// Sections and includes.
broken('a section that is not an object', (f) => (f.sections[0] = 'naloxone'), [S, WRONG_TYPE]);
for (const key of ['id', 'title', 'fields'])
  broken(`a section without ${key}`, (f) => delete f.sections[0][key], [S, MISSING]);
broken('a section id that cannot be a path part', (f) => (f.sections[0].id = 'Naloxone'), [
  `${S}.id`,
  BAD_FORMAT,
]);
broken('a section id with a dot', (f) => (f.sections[0].id = 'naloxone.kit'), [`${S}.id`, BAD_FORMAT]);
broken('an id that is not a string', (f) => (f.sections[0].id = 1), [`${S}.id`, WRONG_TYPE]);
broken('a section with no fields', (f) => (f.sections[0].fields = []), [`${S}.fields`, LIMIT]);
broken('fields that are not a list', (f) => (f.sections[0].fields = {}), [`${S}.fields`, WRONG_TYPE]);
broken('a misspelt section key', (f) => (f.sections[0].titel = 'Naloxone'), [`${S}.titel`, UNKNOWN_KEY]);
broken('a capability no credential has', (f) => (f.sections[0].needs = 'prescribe'), [
  `${S}.needs`,
  NOT_ALLOWED,
]);
broken('a repeat that is not an object', (f) => (f.sections[0].repeat = true), [`${S}.repeat`, WRONG_TYPE]);
broken('a repeat without its entry title', (f) => (f.sections[0].repeat = { max: 3 }), [
  `${S}.repeat`,
  MISSING,
]);
broken('a repeat without its limit', (f) => (f.sections[0].repeat = { itemTitle: 'Entry {n}' }), [
  `${S}.repeat`,
  MISSING,
]);
broken('a repeat of no entries', (f) => (f.sections[0].repeat = { max: 0, itemTitle: 'Entry {n}' }), [
  `${S}.repeat.max`,
  LIMIT,
]);
broken(
  'a repeat limit that is not a whole number',
  (f) => (f.sections[0].repeat = { max: 2.5, itemTitle: 'E' }),
  [`${S}.repeat.max`, WRONG_TYPE],
);
broken(
  'a repeat with a key it does not have',
  (f) => (f.sections[0].repeat = { max: 2, min: 1, itemTitle: 'E' }),
  [`${S}.repeat.min`, UNKNOWN_KEY],
);
broken('a spec piece that is a path', (f) => (f.sections[0].spec = '../harm-reduction'), [
  `${S}.spec`,
  BAD_FORMAT,
]);
broken('a spec piece that is not a string', (f) => (f.sections[0].spec = 3), [`${S}.spec`, WRONG_TYPE]);

const INCLUDE = '$.sections[1]';
fits('an include', (f) => f.sections.push({ include: 'demo_module', version: 1 }));
broken('an include without its version', (f) => f.sections.push({ include: 'demo_module' }), [
  INCLUDE,
  MISSING,
]);
broken('an include of version 0', (f) => f.sections.push({ include: 'demo_module', version: 0 }), [
  `${INCLUDE}.version`,
  LIMIT,
]);
broken('an include whose name cannot be a module', (f) => f.sections.push({ include: 'Demo', version: 1 }), [
  `${INCLUDE}.include`,
  BAD_FORMAT,
]);
broken(
  'an include that also has a section key',
  (f) => f.sections.push({ include: 'demo_module', version: 1, title: 'Eyes' }),
  [`${INCLUDE}.title`, UNKNOWN_KEY],
);

// What every field carries.
broken('a field that is not an object', (f) => (f.sections[0].fields[1] = 'doses'), [F, WRONG_TYPE]);
broken('a field without a kind', (f) => delete f.sections[0].fields[1].kind, [F, MISSING]);
broken('a kind that is not a string', (f) => (f.sections[0].fields[1].kind = 5), [`${F}.kind`, UNKNOWN_KIND]);
broken('a field id that cannot be a path part', (f) => (f.sections[0].fields[1].id = '_doses'), [
  `${F}.id`,
  BAD_FORMAT,
]);
broken('an empty label', (f) => (f.sections[0].fields[1].label = ''), [`${F}.label`, LIMIT]);
broken('empty help', (f) => (f.sections[0].fields[1].help = ''), [`${F}.help`, LIMIT]);
broken('required set to false', (f) => (f.sections[0].fields[1].required = false), [
  `${F}.required`,
  NOT_ALLOWED,
]);
broken('recap set to true', (f) => (f.sections[0].fields[1].recap = true), [`${F}.recap`, NOT_ALLOWED]);
broken('mapsTo without a note type', (f) => (f.sections[0].fields[1].mapsTo = 'wounds.type'), [
  `${F}.mapsTo`,
  BAD_FORMAT,
]);
broken(
  'mapsTo that is not a string',
  (f) => (f.sections[0].fields[1].mapsTo = ['wound_care', 'wounds.type']),
  [`${F}.mapsTo`, WRONG_TYPE],
);
fits(
  'mapsTo with a note type and a path',
  (f) => (f.sections[0].fields[1].mapsTo = 'wound_care:wounds.type'),
);

// Each kind: it fits at its smallest, needs every key of its smallest, and takes no other key.
for (const kind of KINDS) {
  fittingField(`the smallest ${kind}`, kind, () => {});
  for (const key of Object.keys(SMALLEST[kind]))
    brokenField(`a ${kind} without ${key}`, kind, (f) => delete f[key], [F, MISSING]);
  brokenField(`a ${kind} with a key it does not have`, kind, (f) => (f.zzz = 1), [`${F}.zzz`, UNKNOWN_KEY]);
}

// Options, inline or from a shared list.
const O = `${F}.options`;
brokenField('options that are neither a list nor a reference', 'choice', (f) => (f.options = 'a, b'), [
  O,
  WRONG_TYPE,
]);
brokenField('no options', 'choice', (f) => (f.options = []), [O, LIMIT]);
brokenField('an option that is not an object', 'choice', (f) => (f.options[0] = 'a'), [
  `${O}[0]`,
  WRONG_TYPE,
]);
brokenField('an option without a code', 'choice', (f) => delete f.options[0].code, [`${O}[0]`, MISSING]);
brokenField('an option without a label', 'choice', (f) => delete f.options[0].label, [`${O}[0]`, MISSING]);
brokenField('an option code with a capital letter', 'choice', (f) => (f.options[1].code = 'Declined'), [
  `${O}[1].code`,
  BAD_FORMAT,
]);
brokenField('an option code that is not a string', 'choice', (f) => (f.options[1].code = 2), [
  `${O}[1].code`,
  WRONG_TYPE,
]);
brokenField('a misspelt option key', 'choice', (f) => (f.options[0].exclusiv = true), [
  `${O}[0].exclusiv`,
  UNKNOWN_KEY,
]);
brokenField('an option marker set to false', 'choice', (f) => (f.options[0].exclusive = false), [
  `${O}[0].exclusive`,
  NOT_ALLOWED,
]);
brokenField('an empty icon name', 'choice', (f) => (f.options[0].icon = ''), [`${O}[0].icon`, LIMIT]);
brokenField(
  'an option that suggests no note type key',
  'choice',
  (f) => (f.options[0].suggests = 'Wound care'),
  [`${O}[0].suggests`, BAD_FORMAT],
);
fittingField('options from a shared list', 'choice', (f) => (f.options = { list: 'demo_scale' }));
brokenField('a reference without a list', 'choice', (f) => (f.options = {}), [O, MISSING]);
brokenField(
  'a reference with another key',
  'choice',
  (f) => (f.options = { list: 'demo_scale', version: 1 }),
  [`${O}.version`, UNKNOWN_KEY],
);
brokenField('a list name that cannot be one', 'choice', (f) => (f.options = { list: 'Demo scale' }), [
  `${O}.list`,
  BAD_FORMAT,
]);

// choice
brokenField('many that is not true or false', 'choice', (f) => (f.many = 'no'), [`${F}.many`, WRONG_TYPE]);
fittingField('a pair that cannot be held together', 'choice', (f) => (f.excludes = [['a', 'b']]));
brokenField('excludes that is not a list', 'choice', (f) => (f.excludes = 'a,b'), [
  `${F}.excludes`,
  WRONG_TYPE,
]);
brokenField('excludes with no pair', 'choice', (f) => (f.excludes = []), [`${F}.excludes`, LIMIT]);
brokenField('a pair that is not a list', 'choice', (f) => (f.excludes = ['ab']), [
  `${F}.excludes[0]`,
  WRONG_TYPE,
]);
brokenField('a pair of one', 'choice', (f) => (f.excludes = [['a']]), [`${F}.excludes[0]`, LIMIT]);
brokenField('a pair of three', 'choice', (f) => (f.excludes = [['a', 'b', 'a']]), [
  `${F}.excludes[0]`,
  LIMIT,
]);
brokenField('a pair that names no code', 'choice', (f) => (f.excludes = [['a', 'B']]), [
  `${F}.excludes[0][1]`,
  BAD_FORMAT,
]);

// text
brokenField('lines that is neither one nor many', 'text', (f) => (f.lines = 'two'), [
  `${F}.lines`,
  NOT_ALLOWED,
]);
brokenField('a text of no characters', 'text', (f) => (f.maxLength = 0), [`${F}.maxLength`, LIMIT]);
brokenField('a text length that is not a whole number', 'text', (f) => (f.maxLength = 10.5), [
  `${F}.maxLength`,
  WRONG_TYPE,
]);

// number
brokenField('a minimum that is not a number', 'number', (f) => (f.min = '0'), [`${F}.min`, WRONG_TYPE]);
brokenField('a maximum that is not a number', 'number', (f) => (f.max = null), [`${F}.max`, WRONG_TYPE]);
brokenField('three decimals', 'number', (f) => (f.decimals = 3), [`${F}.decimals`, NOT_ALLOWED]);
fittingField('what one-tap Normal fills', 'number', (f) => (f.normal = 1));
brokenField('a Normal that is not a number', 'number', (f) => (f.normal = '5'), [`${F}.normal`, WRONG_TYPE]);
brokenField('a step, which a number does not have', 'number', (f) => (f.step = 0.5), [
  `${F}.step`,
  UNKNOWN_KEY,
]);
brokenField('an empty unit', 'number', (f) => (f.unit = ''), [`${F}.unit`, LIMIT]);
brokenField('an unknown display', 'number', (f) => (f.display = 'slider'), [`${F}.display`, NOT_ALLOWED]);
fittingField('a second unit', 'number', (f) => (f.altUnit = { unit: 'in', perUnit: 2.54 }));
brokenField('a second unit that is not an object', 'number', (f) => (f.altUnit = 'in'), [
  `${F}.altUnit`,
  WRONG_TYPE,
]);
brokenField('a second unit without its name', 'number', (f) => (f.altUnit = { perUnit: 2.54 }), [
  `${F}.altUnit`,
  MISSING,
]);
brokenField('a second unit without its size', 'number', (f) => (f.altUnit = { unit: 'in' }), [
  `${F}.altUnit`,
  MISSING,
]);
brokenField('a second unit of size zero', 'number', (f) => (f.altUnit = { unit: 'in', perUnit: 0 }), [
  `${F}.altUnit.perUnit`,
  LIMIT,
]);
brokenField(
  'a second unit whose size is not a number',
  'number',
  (f) => (f.altUnit = { unit: 'in', perUnit: '2.54' }),
  [`${F}.altUnit.perUnit`, WRONG_TYPE],
);
brokenField(
  'a second unit with a key it does not have',
  'number',
  (f) => (f.altUnit = { unit: 'in', perUnit: 2.54, decimals: 1 }),
  [`${F}.altUnit.decimals`, UNKNOWN_KEY],
);

// flag
fittingField('a flag that clears a sibling', 'flag', (f) => (f.clears = ['length']));
brokenField('clears that is not a list', 'flag', (f) => (f.clears = 'length'), [`${F}.clears`, WRONG_TYPE]);
brokenField('clears that names nothing', 'flag', (f) => (f.clears = []), [`${F}.clears`, LIMIT]);
brokenField('clears that names a field twice', 'flag', (f) => (f.clears = ['length', 'length']), [
  `${F}.clears`,
  DUPLICATE,
]);
brokenField('clears that names a path, not a sibling', 'flag', (f) => (f.clears = ['wound.length']), [
  `${F}.clears[0]`,
  BAD_FORMAT,
]);

// date
brokenField('an unknown date range', 'date', (f) => (f.range = 'today'), [`${F}.range`, NOT_ALLOWED]);

// group
brokenField('an unknown layout', 'group', (f) => (f.layout = 'grid'), [`${F}.layout`, NOT_ALLOWED]);
brokenField('a group with no fields', 'group', (f) => (f.fields = []), [`${F}.fields`, LIMIT]);
brokenField('a group whose fields are not a list', 'group', (f) => (f.fields = TEXT), [
  `${F}.fields`,
  WRONG_TYPE,
]);
brokenField('a broken field inside a group', 'group', (f) => delete f.fields[0].label, [
  `${F}.fields[0]`,
  MISSING,
]);

// grid
fittingField('rows from a shared list', 'grid', (f) => (f.rows = { list: 'demo_scale' }));
fittingField('rows picked in another field', 'grid', (f) => (f.rows = { pickedIn: 'naloxone.offer' }));
brokenField('rows that are neither a list nor a reference', 'grid', (f) => (f.rows = 3), [
  `${F}.rows`,
  WRONG_TYPE,
]);
brokenField('no rows', 'grid', (f) => (f.rows = []), [`${F}.rows`, LIMIT]);
brokenField('a rows reference that names nothing', 'grid', (f) => (f.rows = {}), [`${F}.rows`, LIMIT]);
brokenField(
  'rows from a list and from a field at once',
  'grid',
  (f) => (f.rows = { list: 'demo_scale', pickedIn: 'naloxone.offer' }),
  [`${F}.rows`, LIMIT],
);
brokenField(
  'a rows reference with a key it does not have',
  'grid',
  (f) => (f.rows = { from: 'naloxone.offer' }),
  [`${F}.rows.from`, UNKNOWN_KEY],
);
brokenField('rows picked in something that is not a path', 'grid', (f) => (f.rows = { pickedIn: 'Offer' }), [
  `${F}.rows.pickedIn`,
  BAD_FORMAT,
]);
brokenField('a cell that is not a field', 'grid', (f) => (f.cell = 'text'), [`${F}.cell`, WRONG_TYPE]);
brokenField('a cell of an unknown kind', 'grid', (f) => (f.cell.kind = 'slider'), [
  `${F}.cell.kind`,
  UNKNOWN_KIND,
]);

// region
fittingField('a side from any shared list, Skin’s with Midline', 'region', (f) => (f.side = 'side_rlm'));
brokenField('a side list that is no list name', 'region', (f) => (f.side = 'Side RL'), [
  `${F}.side`,
  BAD_FORMAT,
]);
brokenField('a surface named as a list', 'region', (f) => (f.surface = 'surface'), [
  `${F}.surface`,
  NOT_ALLOWED,
]);
fittingField('a grid closed until tapped', 'grid', (f) => (f.collapsed = true));
brokenField('a grid open marked as collapsed false', 'grid', (f) => (f.collapsed = false), [
  `${F}.collapsed`,
  NOT_ALLOWED,
]);

// photo
brokenField('room for no photo', 'photo', (f) => (f.max = 0), [`${F}.max`, LIMIT]);
brokenField('a photo count that is not a whole number', 'photo', (f) => (f.max = 1.5), [
  `${F}.max`,
  WRONG_TYPE,
]);

// action
brokenField('an unknown action', 'action', (f) => (f.action = 'call_ems'), [`${F}.action`, NOT_ALLOWED]);
fittingField('an action that opens a note type', 'action', (f) => {
  f.action = 'open_note_type';
  f.noteType = 'wound_care';
});
brokenField('an action that opens no note type', 'action', (f) => (f.action = 'open_note_type'), [
  F,
  MISSING,
]);
brokenField('a note type on an action that opens none', 'action', (f) => (f.noteType = 'wound_care'), [
  `${F}.noteType`,
  UNKNOWN_KEY,
]);
brokenField(
  'an action that opens something that is not a note type key',
  'action',
  (f) => {
    f.action = 'open_note_type';
    f.noteType = 'Wound care';
  },
  [`${F}.noteType`, BAD_FORMAT],
);

// Conditions: exactly one of five forms.
const IS = { field: 'naloxone.offer', is: 'accepted' };
fittingCondition('a field that holds one of several codes', {
  field: 'naloxone.offer',
  is: ['accepted', 'declined'],
});
fittingCondition('a field that is filled', { field: 'naloxone.offer', filled: true });
fittingCondition('all of', { all: [IS, { field: 'naloxone.offer', filled: true }] });
fittingCondition('any of', { any: [IS] });
fittingCondition('not', { not: IS });
fittingCondition('a path relative to the entry', { field: './offer', is: 'accepted' });
fittingCondition('a path of four parts', { field: 'wounds.e1234567.size.right', filled: true });
brokenCondition('a condition that is not an object', 'accepted', [C, WRONG_TYPE]);
brokenCondition('an empty condition', {}, [C, BAD_CONDITION]);
brokenCondition('a field with nothing asked of it', { field: 'naloxone.offer' }, [C, BAD_CONDITION]);
brokenCondition('a code with no field', { is: 'accepted' }, [C, BAD_CONDITION]);
brokenCondition('two questions about one field', { ...IS, filled: true }, [C, BAD_CONDITION]);
brokenCondition('all and any side by side', { all: [IS], any: [IS] }, [C, BAD_CONDITION]);
brokenCondition('a field beside all', { field: 'naloxone.offer', all: [IS] }, [C, BAD_CONDITION]);
brokenCondition('a field beside not', { field: 'naloxone.offer', not: IS }, [C, BAD_CONDITION]);
brokenCondition(
  'a misspelt condition key',
  { ...IS, when: 'now' },
  [`${C}.when`, UNKNOWN_KEY],
  [C, BAD_CONDITION],
);
brokenCondition('a path with a capital first letter', { field: 'Naloxone.offer', filled: true }, [
  `${C}.field`,
  BAD_FORMAT,
]);
brokenCondition('a path of five parts', { field: 'a.b.c.d.e', filled: true }, [`${C}.field`, BAD_FORMAT]);
brokenCondition('a path that is not a string', { field: 4, filled: true }, [`${C}.field`, WRONG_TYPE]);
brokenCondition('a code that is not a string', { field: 'naloxone.offer', is: 1 }, [`${C}.is`, WRONG_TYPE]);
brokenCondition('a code with a capital letter', { field: 'naloxone.offer', is: 'Accepted' }, [
  `${C}.is`,
  BAD_FORMAT,
]);
brokenCondition('one of no codes', { field: 'naloxone.offer', is: [] }, [`${C}.is`, LIMIT]);
brokenCondition('one code named twice', { field: 'naloxone.offer', is: ['accepted', 'accepted'] }, [
  `${C}.is`,
  DUPLICATE,
]);
brokenCondition(
  'a list with something that is not a code',
  { field: 'naloxone.offer', is: ['accepted', 'No'] },
  [`${C}.is[1]`, BAD_FORMAT],
);
brokenCondition('filled set to false', { field: 'naloxone.offer', filled: false }, [
  `${C}.filled`,
  NOT_ALLOWED,
]);
// An empty `all` would be true and an empty `any` false, by a rule two interpreters must share:
// neither is allowed, so neither interpreter has to decide.
brokenCondition('all of nothing', { all: [] }, [`${C}.all`, LIMIT]);
brokenCondition('any of nothing', { any: [] }, [`${C}.any`, LIMIT]);
brokenCondition('all that is not a list', { all: IS }, [`${C}.all`, WRONG_TYPE]);
brokenCondition('any that is not a list', { any: IS }, [`${C}.any`, WRONG_TYPE]);
brokenCondition('not of a list', { not: [IS] }, [`${C}.not`, WRONG_TYPE]);
brokenCondition('a broken condition inside another', { any: [IS, { all: [{ field: 'naloxone.offer' }] }] }, [
  `${C}.any[1].all[0]`,
  BAD_CONDITION,
]);

// A module and a shared list.
for (const key of ['name', 'version', 'sections'])
  brokenFile(`a module without ${key}`, 'module', (f) => delete f[key], ['$', MISSING]);
brokenFile('a module name that cannot be one', 'module', (f) => (f.name = 'Demo module'), [
  '$.name',
  BAD_FORMAT,
]);
brokenFile('a module with a note type key', 'module', (f) => (f.title = 'Eyes'), ['$.title', UNKNOWN_KEY]);
brokenFile('a module with no sections', 'module', (f) => (f.sections = []), ['$.sections', LIMIT]);
brokenFile('a module whose sections are not a list', 'module', (f) => (f.sections = 'eyes'), [
  '$.sections',
  WRONG_TYPE,
]);
brokenFile(
  'a module that includes a module',
  'module',
  (f) => (f.sections[0] = { include: 'demo_module_two', version: 1 }),
  // Read as a section, it lacks all three of a section's keys.
  ['$.sections[0]', MISSING],
  ['$.sections[0]', MISSING],
  ['$.sections[0]', MISSING],
  ['$.sections[0].include', UNKNOWN_KEY],
  ['$.sections[0].version', UNKNOWN_KEY],
);
brokenFile('a broken field in a module', 'module', (f) => (f.sections[0].fields[0].lines = 3), [
  '$.sections[0].fields[0].lines',
  NOT_ALLOWED,
]);
for (const key of ['name', 'options'])
  brokenFile(`a shared list without ${key}`, 'list', (f) => delete f[key], ['$', MISSING]);
brokenFile('a shared list with no options', 'list', (f) => (f.options = []), ['$.options', LIMIT]);
brokenFile('a shared list of a shared list', 'list', (f) => (f.options = { list: 'demo_sites' }), [
  '$.options',
  WRONG_TYPE,
]);
brokenFile('a shared list with a version', 'list', (f) => (f.version = 1), ['$.version', UNKNOWN_KEY]);
brokenFile('a broken option in a shared list', 'list', (f) => (f.options[2].normal = 'yes'), [
  '$.options[2].normal',
  NOT_ALLOWED,
]);

describe('one change to a file that fits', () => {
  it.each(fitting)('still fits: $name', ({ kind, file }) => {
    expect(checkFile(kind, file)).toEqual([]);
  });

  it.each(failing)('is refused: $name', ({ kind, file, problems }) => {
    expect(found(kind, file)).toEqual(sorted(problems));
    for (const problem of checkFile(kind, file)) expect(problem.message).not.toBe('');
  });

  it('says what is wrong in words that name the key or the kind', () => {
    const message = (change: (file: any) => void) => {
      const file = example();
      change(file);
      return checkFile('noteType', file).map((p) => p.message);
    };
    expect(message((f) => (f.sections[0].fields[0].unit = 'doses'))).toEqual([
      'a field of kind "choice" has no key "unit"',
    ]);
    expect(message((f) => delete f.sections[0].fields[0].label)).toEqual([
      'a field of kind "choice" needs "label"',
    ]);
    expect(message((f) => delete f.title)).toEqual(['this needs "title"']);
    expect(message((f) => (f.version = '1'))).toEqual(['must be a whole number']);
    expect(message((f) => (f.sections[0].fields[1].kind = 'slider'))[0]).toMatch(
      /^is not a kind of field; the kinds are "choice", "text", /,
    );
    expect(message(withField('text', (f) => (f.maxLength = 4001)))).toEqual(['must be <= 4000']);
    expect(message(withField('action', (f) => (f.noteType = 'wound_care')))).toEqual([
      'a field of kind "action" cannot carry "noteType" with its other keys as they are',
    ]);
  });

  it('writes a key that is not a plain word so that the path still reads as one', () => {
    const file = example();
    file['needs review'] = true;
    expect(checkFile('noteType', file).map((p) => p.path)).toEqual(['$["needs review"]']);
  });
});

// ---------------------------------------------------------------------------------------------
// Every rule in the schema has a failing file above. A rule added to the schema with no file that
// breaks it fails here, by name.

type Rule = { at: string; holder: object; keyword: string; name?: string };

/** Every keyword of the schema that can refuse a file, with the object that holds it. */
function rulesOf(root: any): Rule[] {
  const rules: Rule[] = [];
  const KEYWORDS = [
    'type',
    'enum',
    'const',
    'pattern',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'minLength',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minProperties',
    'maxProperties',
    'oneOf',
  ];
  const KNOWN = new Set([...KEYWORDS, ...'$schema title description $defs $ref'.split(' ')]);
  const SUBSCHEMAS = [
    'properties',
    'items',
    'allOf',
    'if',
    'then',
    'else',
    'required',
    'additionalProperties',
  ];
  const walk = (node: any, at: string) => {
    if (node === false) return rules.push({ at, holder: node, keyword: 'false schema' });
    // A keyword this walk does not know could hold a rule it would never count.
    for (const key of Object.keys(node))
      expect(KNOWN.has(key) || SUBSCHEMAS.includes(key), `${at}/${key}`).toBe(true);
    for (const keyword of KEYWORDS)
      if (keyword in node) rules.push({ at: `${at}/${keyword}`, holder: node, keyword });
    if (node.additionalProperties === false)
      rules.push({ at: `${at}/additionalProperties`, holder: node, keyword: 'additionalProperties' });
    else expect(node.additionalProperties, `${at}/additionalProperties`).toBeUndefined();
    for (const name of node.required ?? []) {
      rules.push({ at: `${at}/required/${name}`, holder: node, keyword: 'required', name });
      // The library is not asked to check this (strictRequired is off, for the `if`s).
      if (node.properties) expect(Object.keys(node.properties), `${at}/required`).toContain(name);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${at}/properties/${key}`);
    for (const [key, child] of Object.entries(node.$defs ?? {})) walk(child, `${at}/$defs/${key}`);
    if (node.items) walk(node.items, `${at}/items`);
    (node.allOf ?? []).forEach((child: any, i: number) => walk(child, `${at}/allOf/${i}`));
    // An `if` asks a question and a oneOf branch is one form of a condition: neither refuses a
    // file by itself. The oneOf as a whole does, and is counted above.
    if (node.then) walk(node.then, `${at}/then`);
    if (node.else) walk(node.else, `${at}/else`);
  };
  walk(root, '#');
  return rules;
}

describe('every rule in the schema', () => {
  // Rules no file can reach through checkFile, each for a reason.
  const unreachable = (at: string): boolean =>
    // `field` sends an object to the definition of its kind, so there it is always an object of that kind.
    /^#\/\$defs\/[a-z]+Field\/(type|required\/kind|properties\/kind\/const)$/.test(at) ||
    // Reached only through an `if` that has already seen an object, or the key itself.
    [
      '#/$defs/include/type',
      '#/$defs/include/required/include',
      '#/$defs/listRef/type',
      '#/$defs/rowsRef/type',
    ].includes(at);

  it('is broken by at least one of the failing files', () => {
    const ajv = new Ajv2020({
      allErrors: true,
      verbose: true,
      strict: true,
      strictRequired: false,
      allowUnionTypes: true,
    });
    ajv.addSchema(schema, 'definition');
    const rules = rulesOf(schema);
    const broken = new Set<Rule>();
    for (const { kind, file } of failing) {
      const validate = ajv.compile({ $ref: `definition#/$defs/${kind}` });
      expect(validate(file)).toBe(false);
      for (const error of validate.errors ?? []) {
        for (const rule of rules) {
          if (rule.keyword !== error.keyword) continue;
          if (rule.keyword === 'false schema' ? error.schema !== false : rule.holder !== error.parentSchema)
            continue;
          if (rule.name !== undefined && rule.name !== error.params.missingProperty) continue;
          broken.add(rule);
        }
      }
    }
    expect(rules.length).toBeGreaterThan(150);
    const never = rules.filter((rule) => !broken.has(rule)).map((rule) => rule.at);
    expect(never.filter((at) => !unreachable(at))).toEqual([]);
    // And the list of exceptions holds nothing a file did reach.
    expect(rules.filter((rule) => broken.has(rule) && unreachable(rule.at)).map((rule) => rule.at)).toEqual(
      [],
    );
  });

  it('is in a definition that something uses', () => {
    const text = JSON.stringify(schema);
    for (const name of Object.keys(schema.$defs)) expect(text, name).toContain(`"#/$defs/${name}"`);
  });
});

// ---------------------------------------------------------------------------------------------
// src/types.ts and the schema say the same thing. The types are read with the compiler, so
// nothing has to be kept in step by hand: a key, a kind or a value added to one side only fails.

/**
 * What a key may hold. `forms` is each form of value it takes: `string`, `number`, `boolean`, a
 * list of something (`list:…`), a pair or other fixed-length list (`tuple2:…`), and an object by
 * the names of every key it may have (`{a,b}`; the members of a union of objects as one). So a key
 * that is one value on one side and a list on the other, or a list whose objects have other keys,
 * does not pass for the same.
 */
type Shape = Record<
  string,
  { optional: boolean; values?: string[]; primitive?: string; keys?: string[]; forms: string[] }
>;

const typesFile = fileURLToPath(new URL('../src/types.ts', import.meta.url));
const program = ts.createProgram([typesFile], {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
});
const checker = program.getTypeChecker();
const aliases = new Map<string, ts.Type>();
for (const symbol of checker.getExportsOfModule(
  checker.getSymbolAtLocation(program.getSourceFile(typesFile)!)!,
))
  if (symbol.flags & ts.SymbolFlags.TypeAlias)
    aliases.set(symbol.name, checker.getDeclaredTypeOfSymbol(symbol));

const membersOf = (type: ts.Type): ts.Type[] => (type.isUnion() ? type.types : [type]);
const isObject = (type: ts.Type): boolean =>
  (type.flags & ts.TypeFlags.Object) !== 0 || type.isIntersection()
    ? !checker.isArrayType(type) && !checker.isTupleType(type)
    : false;
const literalOf = (type: ts.Type): string | undefined =>
  type.isStringLiteral() || type.isNumberLiteral()
    ? JSON.stringify(type.value)
    : type.flags & ts.TypeFlags.BooleanLiteral
      ? checker.typeToString(type)
      : undefined;
const valuesOf = (types: ts.Type[]): string[] | undefined => {
  const values = types.map(literalOf);
  return values.length > 0 && values.every((v) => v !== undefined) ? (values as string[]).sort() : undefined;
};

/** The forms of value a type takes (`Shape`). */
function typeForms(types: ts.Type[]): string[] {
  const forms = new Set<string>();
  const keys = new Set<string>();
  let object = false;
  for (const type of types.flatMap(membersOf)) {
    if (checker.isTupleType(type)) {
      const items = checker.getTypeArguments(type as ts.TypeReference);
      forms.add(`tuple${items.length}:${typeForms([...items]).join('|')}`);
    } else if (checker.isArrayType(type))
      forms.add(`list:${typeForms([checker.getTypeArguments(type as ts.TypeReference)[0]!]).join('|')}`);
    else if (type.flags & ts.TypeFlags.StringLike) forms.add('string');
    else if (type.flags & ts.TypeFlags.NumberLike) forms.add('number');
    else if (type.flags & ts.TypeFlags.BooleanLike) forms.add('boolean');
    else if (isObject(type)) {
      object = true;
      for (const property of checker.getPropertiesOfType(type)) keys.add(property.name);
    } else forms.add(checker.typeToString(type));
  }
  if (object) forms.add(`{${[...keys].sort().join(',')}}`);
  return [...forms].sort();
}

/** What the types say an object holds. A union of objects is read as one: a key is optional when any member lacks it. */
function typeShape(type: ts.Type): Shape {
  const members = membersOf(type);
  const names = new Set(members.flatMap((m) => checker.getPropertiesOfType(m).map((p) => p.name)));
  const shape: Shape = {};
  for (const name of [...names].sort()) {
    const symbols = members.map((m) => checker.getPropertyOfType(m, name));
    // The same type in two members of a union (a condition's `field`) is one type.
    const types = [
      ...new Set(
        symbols
          .filter((s) => s !== undefined)
          .flatMap((s) => membersOf(checker.getNonNullableType(checker.getTypeOfSymbol(s)))),
      ),
    ];
    const entry: Shape[string] = {
      optional: symbols.some((s) => s === undefined || (s.flags & ts.SymbolFlags.Optional) !== 0),
      forms: typeForms(types),
    };
    const only = types.length === 1 ? types[0]! : undefined;
    const values =
      only && checker.isArrayType(only)
        ? valuesOf(membersOf(checker.getTypeArguments(only as ts.TypeReference)[0]!))
        : valuesOf(types);
    if (values?.join() === 'false,true') entry.primitive = 'boolean';
    else if (values) entry.values = [...new Set(values)];
    else if (only && only.flags & ts.TypeFlags.String) entry.primitive = 'string';
    else if (only && only.flags & ts.TypeFlags.Number) entry.primitive = 'number';
    const keys = new Set(
      types.filter(isObject).flatMap((t) => checker.getPropertiesOfType(t).map((p) => p.name)),
    );
    if (keys.size > 0) entry.keys = [...keys].sort();
    shape[name] = entry;
  }
  return shape;
}

const defs = schema.$defs as Record<string, any>;
/** The definitions compared key by key, and those compared only by the names of their keys. */
const compared = new Set<string>();
const comparedByName = new Set<string>();
function deref(node: any, seen?: Set<string>): any {
  while (node?.$ref) {
    const name = (node.$ref as string).replace('#/$defs/', '');
    seen?.add(name);
    node = defs[name];
  }
  return node;
}
/** The keys an object may have where this schema applies, whichever branch it takes. */
function keysOf(node: any): string[] {
  const at = deref(node, comparedByName);
  if (!at || at.type === 'array') return [];
  return [
    ...Object.keys(at.properties ?? {}),
    ...(at.allOf ?? []).flatMap((branch: any) => keysOf(branch.then)),
    ...keysOf(at.then),
    ...keysOf(at.else),
  ];
}
/** The forms of value a schema takes (`Shape`). */
function schemaForms(node: any): string[] {
  const at = deref(node);
  if (!at) return [];
  const types: string[] = at.enum
    ? [...new Set<string>(at.enum.map((v: unknown) => typeof v))]
    : 'const' in at
      ? [typeof at.const]
      : Array.isArray(at.type)
        ? at.type
        : at.type
          ? [at.type]
          : at.properties || at.allOf || at.then
            ? ['object']
            : [];
  const forms = new Set<string>();
  for (const type of types) {
    if (type === 'array') {
      // A list's items are in `items`, or in the branch of an allOf that applies to a list.
      const branch = (at.allOf ?? []).find((b: any) => b.if?.type === 'array');
      const list = at.items ? at : deref(branch?.then);
      const items = schemaForms(list.items).join('|');
      forms.add(
        list.minItems !== undefined && list.minItems === list.maxItems
          ? `tuple${list.minItems}:${items}`
          : `list:${items}`,
      );
    } else if (type === 'object') forms.add(`{${[...new Set(keysOf(node))].sort().join(',')}}`);
    else forms.add(type === 'integer' ? 'number' : type);
  }
  return [...forms].sort();
}

/** What the schema says an object holds. */
function schemaShape(node: any): Shape {
  const at = deref(node, compared);
  const shape: Shape = {};
  for (const name of Object.keys(at.properties).sort()) {
    const property = deref(at.properties[name]);
    const entry: Shape[string] = {
      optional: !(at.required ?? []).includes(name),
      forms: schemaForms(at.properties[name]),
    };
    const valued = property.type === 'array' ? deref(property.items) : property;
    if (valued.enum) entry.values = valued.enum.map((v: unknown) => JSON.stringify(v)).sort();
    else if ('const' in valued) entry.values = [JSON.stringify(valued.const)];
    else if (property.type === 'integer') entry.primitive = 'number';
    else if (['string', 'number', 'boolean'].includes(property.type)) entry.primitive = property.type;
    const keys = new Set(keysOf(at.properties[name]));
    if (keys.size > 0) entry.keys = [...keys].sort();
    shape[name] = entry;
  }
  return shape;
}

/** An object written in place in the types (a repeat, a second unit) is compared too. */
function compare(type: ts.Type, node: any, where: string) {
  expect(typeShape(type), where).toEqual(schemaShape(node));
  if (type.isUnion()) return;
  for (const property of checker.getPropertiesOfType(type)) {
    const inner = checker.getNonNullableType(checker.getTypeOfSymbol(property));
    if (!inner.isUnion() && isObject(inner) && !inner.aliasSymbol)
      compare(inner, deref(node).properties[property.name], `${where}.${property.name}`);
  }
}

describe('the types and the schema', () => {
  const capital = (kind: string) => `${kind[0]!.toUpperCase()}${kind.slice(1)}Field`;
  const kinds = [...(defs.field.properties.kind.enum as string[])];
  /** Each type that describes an object, and the schema definition that describes the same one. */
  const pairs: Record<string, string> = {
    NoteType: 'noteType',
    Module: 'module',
    OptionList: 'list',
    Include: 'include',
    Section: 'section',
    Option: 'option',
    ListRef: 'listRef',
    Condition: 'condition',
    Rename: 'rename',
    ...Object.fromEntries(kinds.map((kind) => [capital(kind), `${kind}Field`])),
  };
  // Field is the union of the kinds and FieldKind its tag: both are compared by kind, below.
  // Common is inside every kind. Problem is what a check reports, not part of a file.
  const elsewhere = ['Field', 'FieldKind', 'Common', 'Problem'];

  it.each(Object.entries(pairs))('%s has the keys, the required keys and the values of %s', (name, def) => {
    expect(aliases.has(name), name).toBe(true);
    compare(aliases.get(name)!, { $ref: `#/$defs/${def}` }, name);
  });

  it('have the same fourteen kinds, each sent to its own definition', () => {
    const typed = membersOf(aliases.get('FieldKind')!).map((t) => (t as ts.StringLiteralType).value);
    expect(typed.sort()).toEqual([...kinds].sort());
    expect(kinds).toHaveLength(14);
    expect(KINDS.sort()).toEqual([...kinds].sort());
    expect(defs.field.allOf).toHaveLength(kinds.length);
    for (const kind of kinds) {
      const branch = defs.field.allOf.find((b: any) => b.if.properties.kind.const === kind);
      expect(branch?.then, kind).toEqual({ $ref: `#/$defs/${kind}Field` });
      expect(defs[`${kind}Field`].properties.kind, kind).toEqual({ const: kind });
    }
  });

  it('give every kind the same common keys, held by the same rules', () => {
    const common = Object.keys(typeShape(aliases.get('Common')!));
    expect(common.length).toBeGreaterThan(8);
    for (const kind of kinds)
      for (const key of common)
        expect(defs[`${kind}Field`].properties[key], `${kind}.${key}`).toEqual(
          defs.textField.properties[key],
        );
  });

  it('give a condition the same five forms', () => {
    const typed = membersOf(aliases.get('Condition')!).map((m) =>
      checker
        .getPropertiesOfType(m)
        .map((p) => p.name)
        .sort()
        .join(),
    );
    const branches = defs.condition.oneOf as { required: string[]; maxProperties: number }[];
    expect(typed.sort()).toEqual(branches.map((b) => [...b.required].sort().join()).sort());
    // A branch that only required its keys would let a second form sit beside the first.
    for (const branch of branches) expect(branch.maxProperties).toBe(branch.required.length);
    expect(defs.condition.additionalProperties).toBe(false);
  });

  it('tie an action’s note type to the one action that opens one', () => {
    const forms = membersOf(aliases.get('ActionField')!).map((m) => {
      const shape = typeShape(m);
      return { actions: shape.action!.values, noteType: shape.noteType ? !shape.noteType.optional : 'none' };
    });
    expect(forms).toContainEqual({ actions: ['"open_note_type"'], noteType: true });
    expect(forms).toContainEqual({ actions: ['"add_referral"', '"show_handoff"'], noteType: 'none' });
    expect(forms).toHaveLength(2);
    expect(defs.actionField.if.properties.action).toEqual({ const: 'open_note_type' });
    expect(defs.actionField.then).toEqual({ required: ['noteType'] });
    expect(defs.actionField.else).toEqual({ properties: { noteType: false } });
  });

  it('leave no type and no definition out of the comparison', () => {
    expect([...aliases.keys()].sort()).toEqual([...Object.keys(pairs), ...elsewhere].sort());
    for (const [name, def] of Object.entries(pairs))
      compare(aliases.get(name)!, { $ref: `#/$defs/${def}` }, name);
    const described = Object.keys(defs).filter((name) => defs[name].properties);
    // `field` holds only the kind, compared with FieldKind above. The types write a grid's rows
    // reference in place, as one side of a union: its two keys are compared by name.
    const byNameOnly = described.filter((name) => !compared.has(name));
    expect(byNameOnly).toEqual(['rowsRef', 'field']);
    for (const name of byNameOnly) expect(comparedByName.has(name), name).toBe(true);
  });

  it('share the patterns and the limits the package exports', () => {
    expect(defs.key.pattern).toBe(KEY.source);
    expect(defs.pathPart.pattern).toBe(PATH_PART.source);
    expect(defs.code.pattern).toBe(OPTION_CODE.source);
    expect(defs.condition.properties.is.pattern).toBe(OPTION_CODE.source);
    const part = PATH_PART.source.slice(1, -1);
    expect(defs.path.pattern).toBe(`^(\\./)?${part}(\\.${part}){0,3}$`);
    expect(defs.mapsTo.pattern).toBe(`${KEY.source.slice(0, -1)}:${part}(\\.${part}){0,3}$`);
    expect(defs.textField.properties.maxLength.maximum).toBe(MAX_TEXT_LENGTH);
    expect(defs.repeat.properties.max.maximum).toBe(MAX_REPEAT);
  });

  // A definition's paths become the paths of answers, which the API checks at every sync
  // (design 2.3). If the API's patterns move, these must move with them.
  it('use the API’s own patterns for a note type key and an answer path', () => {
    const records = readFileSync(
      new URL('../../../services/api/src/sync/records.ts', import.meta.url),
      'utf8',
    );
    const part = PATH_PART.source.slice(1, -1);
    expect(records).toContain(`const NoteTypeKey = z.string().regex(/${KEY.source}/);`);
    expect(records).toContain(`const DATA_PATH = /^${part}(\\.${part}){0,3}$/;`);
  });
});
