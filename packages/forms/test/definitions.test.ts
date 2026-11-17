import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listFile, moduleFile, noteTypeFile, SURFACE_LIST } from '../src/resolve.ts';
import { checkFile } from '../src/schema.ts';
import { codeOf, readShape, type Shape, type ShapeField, type ShapeOption } from '../src/shape-check.ts';
import { LEFT_OUT, readDiff, readPieces, specWords, type Diff } from '../src/spec-check.ts';
import { OPTION_CODE, type Condition, type OptionList } from '../src/types.ts';

// The files of packages/forms/definitions are well formed before any definition names them: each
// piece of the field specification is read without a problem and is the inventories' range, and
// each shared list, shape file and diff file passes the checks of its form. The export checks
// definitions against these files; a fault here would pass that check in silence or fail it far
// from its cause.

const root = fileURLToPath(new URL('../definitions/', import.meta.url));
const filesIn = (folder: string): string[] => readdirSync(`${root}${folder}`).sort();
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/**
 * The 37 pieces and the lines of the field specification each one holds: forms-inventory.md
 * section 8 for the note types, forms-inventory-focused-exam.md section 7, in its order, for the
 * exam. A piece of two ranges holds the first, then the second.
 */
const PIECES: Record<string, [number, number][]> = {
  'general-1': [[5, 28]],
  'general-2': [
    [29, 35],
    [61, 62],
  ],
  'red-flags': [[36, 60]],
  'wound-1': [[63, 103]],
  'wound-2': [[104, 119]],
  'harm-reduction': [[120, 148]],
  psychological: [[150, 171]],
  'sexrepro-1': [[173, 203]],
  'sexrepro-2': [[204, 243]],
  'sexrepro-3': [[244, 251]],
  'social-needs': [[252, 267]],
  outreach: [[268, 282]],
  'quick-1': [[283, 307]],
  'quick-2': [[308, 332]],
  'exam-general-appearance': [[336, 386]],
  'exam-heent-eyes': [[388, 462]],
  'exam-heent-ears': [[464, 522]],
  'exam-heent-nose': [[524, 552]],
  'exam-heent-mouth': [[554, 608]],
  'exam-cv-rhythm': [[610, 668]],
  'exam-cv-perfusion': [[670, 732]],
  'exam-pulmonary': [[734, 820]],
  'exam-abdominal': [[822, 910]],
  'exam-msk-1': [[912, 994]],
  'exam-msk-2': [[996, 1068]],
  'exam-neuro-1': [[1070, 1150]],
  'exam-neuro-2': [[1152, 1222]],
  'exam-skin': [[1224, 1330]],
  'exam-gu': [[1332, 1396]],
  'exam-lymphatic': [[1398, 1434]],
  'exam-peripheral-vascular': [[1436, 1508]],
  'exam-breast': [[1510, 1564]],
  'exam-rectal': [[1566, 1596]],
  'exam-psychiatric': [[1598, 1662]],
  'exam-foot': [[1664, 1742]],
  'exam-neck': [[1744, 1778]],
  'exam-picker': [
    [1780, 1836],
    [2032, 2036],
  ],
};

/** The lines that name a real organization (SPEC 263 to 265, inventory A51) are never copied. */
const LEFT_OUT_AT: Record<string, number[]> = { 'social-needs': [12, 13, 14] };

const specTexts = (): Record<string, string> =>
  Object.fromEntries(filesIn('spec').map((name) => [`spec/${name}`, read(`spec/${name}`)]));

describe('the pieces of the field specification', () => {
  const { pieces, problems } = readPieces(specTexts());

  it('are read with no problem, and are exactly the 37 of the inventories', () => {
    expect(problems).toEqual([]);
    expect(Object.keys(pieces).sort()).toEqual(Object.keys(PIECES).sort());
    for (const [name, piece] of Object.entries(pieces)) expect(piece.text, name).toBeDefined();
  });

  it.each(Object.entries(PIECES))('%s holds the lines of its range, every bracket closed', (name, ranges) => {
    const text = pieces[name]?.text ?? '';
    const { lines, unclosed } = specWords(text);
    expect(lines).toBe(ranges.reduce((sum, [first, last]) => sum + last - first + 1, 0));
    expect(unclosed).toEqual([]);
    const marked = text.split('\n').flatMap((line, index) => (line.includes(LEFT_OUT) ? [index + 1] : []));
    expect(marked).toEqual(LEFT_OUT_AT[name] ?? []);
    for (const line of marked) expect(text.split('\n')[line - 1]).toBe(LEFT_OUT);
  });
});

describe('the shape and diff files', () => {
  const { pieces } = readPieces(specTexts());

  it.each(Object.keys(PIECES))('of %s pass the form rules of their checks', (name) => {
    const { text = '', diff, shape } = pieces[name] ?? {};
    const faults = (read: unknown) => (Array.isArray(read) ? read : []);
    if (diff !== undefined) expect(faults(readDiff(name, diff, specWords(text).lines))).toEqual([]);
    if (shape !== undefined) expect(faults(readShape(name, shape))).toEqual([]);
  });
});

/**
 * The note type pieces (forms-inventory.md section 8) and the definition file each is typed into.
 * Their shape and diff files are written before any definition (forms 4.1, step 3), so what the
 * export can only find once a definition names a piece is held here first: a slip in a plan would
 * otherwise reach a transcription card as an instruction.
 */
const NOTE_PIECES: Record<string, string> = {
  'general-1': 'note-types/general_primary_care/v1.json',
  'general-2': 'note-types/general_primary_care/v1.json',
  'red-flags': 'note-types/red_flags_disposition/v1.json',
  'wound-1': 'note-types/wound_care/v1.json',
  'wound-2': 'note-types/wound_care/v1.json',
  'harm-reduction': 'note-types/harm_reduction/v1.json',
  psychological: 'note-types/psychological/v1.json',
  'sexrepro-1': 'note-types/sexual_reproductive/v1.json',
  'sexrepro-2': 'note-types/sexual_reproductive/v1.json',
  'sexrepro-3': 'note-types/sexual_reproductive/v1.json',
  'social-needs': 'note-types/social_needs/v1.json',
  outreach: 'note-types/outreach/v1.json',
  'quick-1': 'note-types/quick_encounter/v1.json',
  'quick-2': 'note-types/quick_encounter/v1.json',
};

const GENERAL = 'note-types/general_primary_care/v1.json';

/**
 * The exam pieces whose plans are written (forms-inventory-focused-exam.md section 7, in its
 * order). Each is one module, named as the piece with underscores, which the General note type
 * includes (forms 6.3); the exam picker is a section of General itself.
 */
const EXAM_PIECES = [
  'exam-general-appearance',
  'exam-heent-eyes',
  'exam-heent-ears',
  'exam-heent-nose',
  'exam-heent-mouth',
  'exam-cv-rhythm',
  'exam-cv-perfusion',
  'exam-pulmonary',
  'exam-abdominal',
  'exam-msk-1',
  'exam-msk-2',
];
const examModule = (piece: string): string => moduleFile(piece.replaceAll('-', '_'), 1);

/**
 * The exam picker's codes, one per system: the ids of the focused-exam inventory, section 2
 * (default 10). Each exam section shows when its system is picked (forms 6.3).
 */
const EXAM_SYSTEMS = [
  'general_appearance',
  'heent',
  'cardiovascular',
  'pulmonary',
  'abdominal',
  'msk',
  'neurologic',
  'skin',
  'gu',
  'lymphatic',
  'peripheral_vascular',
  'breast',
  'rectal',
  'psych_observation',
  'diabetic_foot',
  'neck_thyroid',
];
const PICKER = 'exam.systems';

/** Every planned piece and the definition file it is typed into. */
const PLANNED: Record<string, string> = {
  ...NOTE_PIECES,
  ...Object.fromEntries(EXAM_PIECES.map((piece) => [piece, examModule(piece)])),
};
/** The note type whose answers a piece's fields become: a module's are General's, which includes it. */
const noteTypeOf = (piece: string): string => NOTE_PIECES[piece] ?? GENERAL;

const isListRef = (value: unknown): value is { list: string } =>
  value !== null && typeof value === 'object' && 'list' in value;

const listOf = (name: string): OptionList => JSON.parse(read(listFile(name))) as OptionList;

/** A choice's codes, and those that carry a flag, whether the options are written out or a shared list. */
function optionsOf(field: ShapeField | undefined): { codes: string[]; flagged: (flag: string) => string[] } {
  const options = field?.options;
  if (isListRef(options)) {
    const list = listOf(options.list).options;
    return {
      codes: list.map((option) => option.code),
      flagged: (flag) =>
        list.filter((option) => (option as Record<string, unknown>)[flag] === true).map((o) => o.code),
    };
  }
  const codes = Array.isArray(options)
    ? options.map((o: ShapeOption) => (typeof o === 'string' ? o : o.code))
    : [];
  const flags = (field?.flags ?? {}) as Record<string, unknown>;
  return { codes, flagged: (flag) => (Array.isArray(flags[flag]) ? (flags[flag] as string[]) : []) };
}

describe('the plans of the pieces', () => {
  const { pieces } = readPieces(specTexts());
  const shapeOf = (name: string) => pieces[name]?.shape as Shape;
  const diffOf = (name: string) => pieces[name]?.diff as Diff;

  it.each(Object.entries(PLANNED))('%s has its shape and diff files, for %s', (name, file) => {
    expect(pieces[name]?.shape, `${name}.shape.json`).toBeDefined();
    expect(pieces[name]?.diff, `${name}.diff.json`).toBeDefined();
    expect(shapeOf(name).file).toBe(file);
  });

  it.each([...new Set(Object.values(NOTE_PIECES))])(
    'exactly one shape file gives the header of %s, a note type’s own keys',
    (file) => {
      const carriers = Object.keys(NOTE_PIECES).filter(
        (name) => NOTE_PIECES[name] === file && shapeOf(name).header !== undefined,
      );
      expect(carriers).toHaveLength(1);
      const header = shapeOf(carriers[0]!).header!;
      expect(noteTypeFile(String(header.key), Number(header.version))).toBe(file);
      // The schema reads a header only as part of a note type, so it is given one section.
      const stub = { id: 'stub', title: 'Stub', fields: [{ id: 'stub', kind: 'info', label: 'Stub' }] };
      expect(checkFile('noteType', { ...header, sections: [stub] })).toEqual([]);
    },
  );

  // What the spec check finds of a diff file without a definition: a declaration that nothing in
  // the lines needs (spec.not_option_unused, spec.added_in_piece).
  it.each(Object.keys(PLANNED))(
    '%s declares only words its lines hold, and adds only words they lack',
    (name) => {
      const words = new Set(specWords(pieces[name]?.text ?? '').words.map((word) => word.text));
      const { notOptions, added } = diffOf(name);
      expect(notOptions.filter((word) => !words.has(word))).toEqual([]);
      expect(added.filter((label) => words.has(label))).toEqual([]);
    },
  );

  it.each(Object.keys(PLANNED))('%s names only shared lists that are files of lists/', (name) => {
    const lists = filesIn('lists');
    for (const field of shapeOf(name).fields) {
      for (const key of ['options', 'rows'])
        if (isListRef(field[key])) expect(lists, field.path).toContain(`${field[key].list}.json`);
      if (typeof field.side === 'string') expect(lists, field.path).toContain(`${field.side}.json`);
      if (field.surface === true) expect(lists, field.path).toContain(`${SURFACE_LIST}.json`);
    }
  });

  // The validator finds a condition that names no answer or no code once a definition is typed;
  // in a plan the same slip would be copied into the definition first. A module's fields are
  // answers of the note type that includes it, so its conditions are read among General's.
  it.each([...new Set(Object.keys(PLANNED).map(noteTypeOf))])(
    'every condition and picked row in the plans of %s names a field of that note type and its codes',
    (file) => {
      const names = Object.keys(PLANNED).filter((name) => noteTypeOf(name) === file);
      const fields = new Map(names.flatMap((name) => shapeOf(name).fields.map((f) => [f.path, f] as const)));
      // The picker is the piece exam-picker's; until its plan is written, its codes are these.
      if (file === GENERAL && !fields.has(PICKER))
        fields.set(PICKER, { path: PICKER, kind: 'choice', many: true, options: EXAM_SYSTEMS });
      const parent = (path: string) => path.slice(0, path.lastIndexOf('.'));
      /** The answer a condition names, as a field of the plan: the field of a side or of a grid's row. */
      const fieldAt = (path: string): ShapeField | undefined => {
        const field = fields.get(path);
        if (field) return field;
        const [above, last] = [fields.get(parent(path)), path.slice(path.lastIndexOf('.') + 1)];
        if (above?.sides === true && (last === 'right' || last === 'left')) return above;
        return undefined;
      };
      /**
       * A condition's field from where it is written: `./x` is a field of the same entry, or,
       * inside the cell of a grid, of the same row (forms 2.2). A shape names a cell's fields
       * after the cell's own id, where the answers have the row's code.
       */
      const target = (path: string, from: string) => {
        if (!path.startsWith('./')) return path;
        for (let at = parent(from); at.includes('.'); at = parent(at))
          if (fields.get(parent(at))?.kind === 'grid') return `${at}.${path.slice(2)}`;
        return `${from.split('.')[0]}.${path.slice(2)}`;
      };
      const check = (condition: Condition, from: string) => {
        if ('all' in condition) return condition.all.forEach((c) => check(c, from));
        if ('any' in condition) return condition.any.forEach((c) => check(c, from));
        if ('not' in condition) return check(condition.not, from);
        const field = fieldAt(target(condition.field, from));
        expect(field, `${from}: ${condition.field}`).toBeDefined();
        if ('is' in condition)
          for (const code of [condition.is].flat())
            expect(optionsOf(field).codes, `${from}: ${condition.field} is ${code}`).toContain(code);
      };
      for (const name of names) {
        for (const section of shapeOf(name).sections)
          if (section.showWhen) check(section.showWhen as Condition, `${section.id}.`);
        for (const field of shapeOf(name).fields) {
          if (field.showWhen) check(field.showWhen as Condition, field.path);
          const rows = field.rows as { pickedIn?: string } | undefined;
          if (rows?.pickedIn) expect(fields.get(rows.pickedIn)?.many, `${field.path}: rows`).toBe(true);
        }
      }
    },
  );
});

describe('the plans of the exam pieces', () => {
  const { pieces } = readPieces(specTexts());
  const shapeOf = (name: string) => pieces[name]?.shape as Shape;

  it.each(EXAM_PIECES)('%s is a module of its own, which has no header', (name) => {
    expect(shapeOf(name).file).toBe(examModule(name));
    expect(shapeOf(name).header).toBeUndefined();
    expect(shapeOf(name).outside).toBeUndefined();
  });

  // forms 6.3: only the systems picked open, and each offers one-tap Normal.
  it.each(EXAM_PIECES)(
    '%s shows each section only when its system is picked, and offers one-tap Normal',
    (name) => {
      const systems = shapeOf(name).sections.map((section) => {
        expect(section.normal, section.id).toBe(true);
        const showWhen = section.showWhen as Condition | undefined;
        const conditions = showWhen && 'all' in showWhen ? showWhen.all : [showWhen];
        const picked = conditions.find((c) => c !== undefined && 'field' in c && c.field === PICKER);
        expect(picked, `${section.id}: shows when its system is picked`).toBeDefined();
        return (picked as { is: string }).is;
      });
      expect(EXAM_SYSTEMS).toContain(systems[0]);
      expect(new Set(systems).size, 'one system per piece').toBe(1);
    },
  );

  it('give each section of the General note type an id of its own', () => {
    const names = Object.keys(PLANNED).filter((name) => noteTypeOf(name) === GENERAL);
    const ids = names.flatMap((name) => shapeOf(name).sections.map((section) => section.id));
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  // One-tap Normal writes every normal option of a field at once (forms 6.3): a choose-one field
  // holds one, an exclusive option clears the rest, and a blocked pair cannot be held together.
  it.each(EXAM_PIECES)('%s: what one-tap Normal fills in each field can be held together', (name) => {
    for (const field of shapeOf(name).fields) {
      if (field.kind !== 'choice') continue;
      const { flagged } = optionsOf(field);
      const normal = flagged('normal');
      if (field.many !== true)
        expect(normal.length, `${field.path}: one normal option`).toBeLessThanOrEqual(1);
      else if (normal.length > 1) {
        expect(
          normal.filter((code) => flagged('exclusive').includes(code)),
          field.path,
        ).toEqual([]);
        const excludes = (field.excludes ?? []) as [string, string][];
        expect(
          excludes.filter(([a, b]) => normal.includes(a) && normal.includes(b)),
          field.path,
        ).toEqual([]);
      }
    }
  });
});

/**
 * The shared lists (forms 4.4): those it names, Skin's side list, and the lists the inventories'
 * section 5 call the same in each place they appear. A list has no shape file: a person reads its
 * codes, order, flags and count against the lines, so only its form is held here.
 */
const LISTS = [
  'body_region',
  'capillary_refill',
  'dressing',
  'drainage_amount',
  'lung_findings',
  'needs',
  'pulse_scale',
  'range_of_motion',
  'reflex_scale',
  'side',
  'side_rl',
  'side_rlm',
  'special_test_result',
  'surface',
  'wound_type',
  'yes_no',
  'yes_no_unknown',
  'yes_no_unsure',
];

describe('the shared lists', () => {
  it('are exactly the lists the definitions draw on', () => {
    expect(filesIn('lists')).toEqual(LISTS.map((name) => `${name}.json`).sort());
  });

  it.each(LISTS)('%s passes the schema, is named as its file and codes each label by the rule', (name) => {
    const list = JSON.parse(read(listFile(name))) as OptionList;
    expect(checkFile('list', list)).toEqual([]);
    expect(list.name).toBe(name);
    const codes = list.options.map((option) => option.code);
    const labels = list.options.map((option) => option.label);
    expect(new Set(codes).size, 'a code twice').toBe(codes.length);
    expect(new Set(labels).size, 'a label twice').toBe(labels.length);
    // The recipe's rule, unless it makes no valid code ("1+"): then the list gives one.
    for (const { code, label } of list.options)
      if (OPTION_CODE.test(codeOf(label))) expect(code, label).toBe(codeOf(label));
  });
});
