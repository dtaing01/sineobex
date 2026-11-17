import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listFile, moduleFile, noteTypeFile, SURFACE_LIST } from '../src/resolve.ts';
import { checkFile } from '../src/schema.ts';
import {
  codeOf,
  readShape,
  type Shape,
  type ShapeField,
  type ShapeOption,
  type ShapeSection,
} from '../src/shape-check.ts';
import { LEFT_OUT, readDiff, readPieces, specWords, type Diff } from '../src/spec-check.ts';
import { OPTION_CODE, type Condition, type NoteType, type OptionList } from '../src/types.ts';

// The files of packages/forms/definitions are well formed before any definition names them: each
// piece of the field specification is read without a problem and is the inventories' range, and
// each shared list, shape file and diff file passes the checks of its form. The export checks
// definitions against these files; a fault here would pass that check in silence or fail it far
// from its cause.

const root = fileURLToPath(new URL('../definitions/', import.meta.url));
const filesIn = (folder: string): string[] => readdirSync(`${root}${folder}`).sort();
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/**
 * The 35 pieces and the lines of the field specification each one holds: forms-inventory.md
 * section 8 for the note types, forms-inventory-focused-exam.md section 7, in its order, for the
 * exam, but that Wound care (SPEC 63 to 119) and MSK (SPEC 912 to 1068) are each one piece, so that
 * each is one repeating section with all its parts in the entry (inventory A26; focused-exam
 * default 16). A piece of two ranges holds the first, then the second.
 */
const PIECES: Record<string, [number, number][]> = {
  'general-1': [[5, 28]],
  'general-2': [
    [29, 35],
    [61, 62],
  ],
  'red-flags': [[36, 60]],
  wound: [[63, 119]],
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
  'exam-msk': [[912, 1068]],
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

  it('are read with no problem, and are exactly the 35 planned', () => {
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
  wound: 'note-types/wound_care/v1.json',
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
 * The note types' own keys as forms 5 sets them (and 6.2 for auto, 6.4 for quick): who is offered
 * each, its timeline group, and who may read it. A slip here would give a sensitive note to every
 * reader, so each header is held to this table and not only to the schema.
 */
const NOTE_TYPES: Record<string, Record<string, unknown>> = {
  general_primary_care: { kinds: ['medical'], group: 'clinical', sensitivity: 'none' },
  red_flags_disposition: { kinds: ['medical'], group: 'clinical', sensitivity: 'none', auto: 'medical' },
  wound_care: { kinds: ['medical'], group: 'wound', sensitivity: 'none' },
  harm_reduction: { kinds: ['medical'], group: 'harm_reduction', sensitivity: 'sensitive' },
  psychological: { kinds: ['medical'], group: 'psych', sensitivity: 'sensitive' },
  sexual_reproductive: { kinds: ['medical'], group: 'clinical', sensitivity: 'sensitive' },
  social_needs: { kinds: ['medical', 'non_medical'], group: 'social', sensitivity: 'none' },
  outreach: { kinds: ['medical', 'non_medical'], group: 'outreach', sensitivity: 'none' },
  quick_encounter: { kinds: ['medical'], group: 'clinical', sensitivity: 'none', quick: true },
};

/**
 * The marks a note type's sections and fields carry for who may read or change them: the
 * treatment record of Harm reduction (forms 5), the Quick encounter's Medication (6.4), and the
 * red-flag question and the EMS time the finish check asks for (6.2). Each is held where it is,
 * and nowhere else.
 */
/**
 * The next steps the summary screen suggests (PRD main 433): an option that names the note type a
 * clinician is likely to add next, by the piece and field that hold it.
 */
const SUGGESTS: Record<string, Record<string, Record<string, string>>> = {
  psychological: { 'reason.reasons': { substance_use: 'harm_reduction' } },
  outreach: {
    'outreach.new_need': {
      medical: 'general_primary_care',
      behavioral: 'psychological',
      social: 'social_needs',
    },
  },
};

const TREATMENT_RECORD = ['harm-reduction', 'treatment'];
const NEEDS_ORDER = ['quick-2', 'medication'];
const REQUIRED_NOTE_FIELDS = ['red_flags.emergency', 'red_flags.ems_time'];

/**
 * The exam pieces that are modules (forms-inventory-focused-exam.md section 7, in its order). Each
 * is one module, named as the piece with underscores, which the General note type includes
 * (forms 6.3); the exam picker, the 22nd piece, is a section of General itself.
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
  'exam-msk',
  'exam-neuro-1',
  'exam-neuro-2',
  'exam-skin',
  'exam-gu',
  'exam-lymphatic',
  'exam-peripheral-vascular',
  'exam-breast',
  'exam-rectal',
  'exam-psychiatric',
  'exam-foot',
  'exam-neck',
];
const PICKER_PIECE = 'exam-picker';
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

/** The sensitive exams (forms 5, 6.6): their picker options and their sections carry sensitiveExam. */
const SENSITIVE_SYSTEMS = ['gu', 'breast', 'rectal'];

/**
 * The General note type's sections in order (forms 6.3: the exam lives after Vitals): the sections
 * its pieces name, by id, and one include of version 1 for each exam module, by name, in the
 * order of the exam pieces. The shape files cannot hold an include (an include names no piece), so
 * this is the plan F6-general-assemble types, and the file is held to it once it exists.
 */
const GENERAL_PLAN: (string | { include: string; version: number })[] = [
  'reason',
  'hpi',
  'preventive',
  'vitals',
  'exam',
  ...EXAM_PIECES.map((piece) => ({ include: piece.replaceAll('-', '_'), version: 1 })),
  'problems',
];

/** Every planned piece and the definition file it is typed into. */
const PLANNED: Record<string, string> = {
  ...NOTE_PIECES,
  ...Object.fromEntries(EXAM_PIECES.map((piece) => [piece, examModule(piece)])),
  [PICKER_PIECE]: GENERAL,
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
      const { title: _title, version, key, ...rest } = header;
      expect(version).toBe(1);
      expect(rest, String(key)).toEqual(NOTE_TYPES[String(key)]);
    },
  );

  // Inventory A26: each wound has its own cleansing, dressing, photos and follow-up, so the
  // treatment is inside the repeating Wound section and never one set for the whole note.
  it('record the wound treatment once for each wound', () => {
    const wound = Object.keys(NOTE_PIECES).filter(
      (name) => NOTE_PIECES[name] === 'note-types/wound_care/v1.json',
    );
    const sections = wound.flatMap((name) => shapeOf(name).sections);
    expect(sections.map((section) => [section.id, section.repeat !== undefined])).toEqual([['wound', true]]);
    const paths = wound.flatMap((name) => shapeOf(name).fields.map((field) => field.path));
    for (const path of [
      'wound.treatment.cleansing',
      'wound.treatment.dressing',
      'wound.treatment.photos',
      'wound.treatment.follow_up',
    ])
      expect(paths).toContain(path);
  });

  it('give every note type of forms 5 a header', () => {
    const keys = Object.keys(NOTE_PIECES).flatMap((name) => {
      const key = shapeOf(name).header?.key;
      return key === undefined ? [] : [String(key)];
    });
    expect(keys.sort()).toEqual(Object.keys(NOTE_TYPES).sort());
  });

  it('suggest the next steps of PRD main 433, each a note type of forms 5, and no others', () => {
    const found: Record<string, Record<string, Record<string, string>>> = {};
    for (const name of Object.keys(PLANNED))
      for (const field of shapeOf(name).fields) {
        const suggests = (field.flags as { suggests?: Record<string, string> } | undefined)?.suggests;
        if (suggests === undefined) continue;
        (found[name] ??= {})[field.path] = suggests;
        for (const key of Object.values(suggests)) expect(Object.keys(NOTE_TYPES), field.path).toContain(key);
      }
    expect(found).toEqual(SUGGESTS);
  });

  it('mark the treatment record, the ordering section and the red-flag questions, and nothing else', () => {
    const marked = (key: string) =>
      Object.keys(NOTE_PIECES).flatMap((name) =>
        shapeOf(name)
          .sections.filter((section) => section[key] !== undefined)
          .map((section) => [name, section.id, section[key]]),
      );
    expect(marked('treatmentRecord')).toEqual([[...TREATMENT_RECORD, true]]);
    expect(marked('needs')).toEqual([[...NEEDS_ORDER, 'orderMedications']]);
    expect(marked('sensitiveExam')).toEqual([]);
    const required = Object.keys(NOTE_PIECES).flatMap((name) =>
      shapeOf(name)
        .fields.filter((field) => field.required === true)
        .map((field) => field.path),
    );
    expect(required.sort()).toEqual([...REQUIRED_NOTE_FIELDS].sort());
  });

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

  // The vitals' ranges are placeholders for the clinical team (inventory A10), but a lower limit
  // above a reading that is taken on the street would leave the one vital that matters out of the
  // EMS handoff, or have a value typed that was never measured: an opioid overdose before
  // naloxone, a night of hypothermia. The quick form's vitals map onto General's, with its ranges.
  const READINGS: Record<string, number[]> = {
    'vitals.rr': [0, 2, 60],
    'vitals.spo2': [44, 70, 100],
    'vitals.hr': [18, 30, 220],
    'vitals.temp': [59, 68, 108.5],
    'vitals.bp.systolic': [50, 260],
    'vitals.bp.diastolic': [25, 150],
  };
  it.each(['general-1', 'quick-1'])('%s takes the vitals measured in an overdose or hypothermia', (name) => {
    const at = (path: string) => (name === 'quick-1' ? path.replace(/^vitals\./, 'general.') : path);
    const numbers = new Map(shapeOf(name).fields.map((field) => [field.path, field]));
    const general = new Map(shapeOf('general-1').fields.map((field) => [field.path, field]));
    for (const [path, readings] of Object.entries(READINGS)) {
      const field = numbers.get(at(path));
      if (field === undefined && name === 'quick-1') continue;
      for (const reading of readings) {
        expect(reading, `${at(path)}: min`).toBeGreaterThanOrEqual(field?.min as number);
        expect(reading, `${at(path)}: max`).toBeLessThanOrEqual(field?.max as number);
      }
      const { min, max, decimals, unit } = general.get(path) ?? ({} as Partial<ShapeField>);
      expect({ min, max, decimals, unit }, at(path)).toEqual({
        min: field?.min,
        max: field?.max,
        decimals: field?.decimals,
        unit: field?.unit,
      });
    }
  });

  // A date's range is what the phone's picker lets through (past and future both take today).
  // A due date is past once a pregnancy runs over, so it takes any date.
  const DATE_RANGES: Record<string, string> = {
    'sexrepro-1 lmp.date': 'past',
    'sexrepro-2 pregnant.due_date': 'any',
    'sexrepro-3 testing.date': 'past',
    'red-flags follow_up.date': 'future',
    'quick-2 follow_up.date': 'future',
  };
  it('give each date the range its answers can fall in', () => {
    const ranges = Object.fromEntries(
      Object.keys(PLANNED).flatMap((name) =>
        shapeOf(name)
          .fields.filter((field) => field.kind === 'date')
          .map((field) => [`${name} ${field.path}`, field.range]),
      ),
    );
    expect(ranges).toEqual(DATE_RANGES);
  });

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

// forms 4.2: the shape check holds the order of the sections within a piece, and nothing holds
// the order of pieces within a note type. A note type of several pieces is laid out as its pieces
// follow the lines (NOTE_PIECES is in their order), and its file is held to that once it exists.
// General has its own plan (GENERAL_PLAN), with the exam's includes.
describe('the note types of several pieces', () => {
  const { pieces } = readPieces(specTexts());
  const files = [...new Set(Object.values(NOTE_PIECES))].filter((file) => file !== GENERAL);
  it.each(files)('%s lays its sections out in the order of its pieces', (file) => {
    const planned = Object.keys(NOTE_PIECES)
      .filter((name) => NOTE_PIECES[name] === file)
      .flatMap((name) => (pieces[name]?.shape as Shape).sections.map((section) => section.id));
    if (!existsSync(`${root}${file}`)) return;
    const written = JSON.parse(read(file)) as NoteType;
    expect(written.sections.map((section) => ('include' in section ? section : section.id))).toEqual(planned);
  });
});

describe('the plans of the exam pieces', () => {
  const { pieces } = readPieces(specTexts());
  const shapeOf = (name: string) => pieces[name]?.shape as Shape;
  /** The system a section shows for: the picker's code its showWhen tests, alone or in an `all`. */
  const systemOf = (section: ShapeSection): string | undefined => {
    const showWhen = section.showWhen as Condition | undefined;
    const conditions = showWhen && 'all' in showWhen ? showWhen.all : [showWhen];
    const picked = conditions.find((c) => c !== undefined && 'field' in c && c.field === PICKER);
    return (picked as { is?: string } | undefined)?.is;
  };
  const fieldsOf = (name: string, section: string) =>
    shapeOf(name).fields.filter((field) => field.path.split('.')[0] === section);

  it.each(EXAM_PIECES)('%s is a module of its own, which has no header', (name) => {
    expect(shapeOf(name).file).toBe(examModule(name));
    expect(shapeOf(name).header).toBeUndefined();
    expect(shapeOf(name).outside).toBeUndefined();
  });

  // forms 6.3: only the systems picked open, and each offers one-tap Normal, but where no field
  // has a normal answer: a Normal that fills nothing would only puzzle the clinician.
  it.each(EXAM_PIECES)(
    '%s shows each section only when its system is picked, and offers one-tap Normal where it fills something',
    (name) => {
      const systems = shapeOf(name).sections.map((section) => {
        const fills = fieldsOf(name, section.id).some(
          (field) => field.normal !== undefined || optionsOf(field).flagged('normal').length > 0,
        );
        expect(section.normal, section.id).toBe(fills ? true : undefined);
        expect(systemOf(section), `${section.id}: shows when its system is picked`).toBeDefined();
        return systemOf(section);
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

  // One-tap Normal fills only what is empty (forms 6.3), so it can never know that a wound was
  // charted elsewhere in the section: a question that opens a hand-off to another note (6.7) is
  // left for the clinician, or Normal would answer "No wound" beside an ulcer and hide the hand-off.
  it.each(EXAM_PIECES)('%s leaves to the clinician every answer that opens a hand-off', (name) => {
    const fields = new Map(shapeOf(name).fields.map((field) => [field.path, field]));
    const read = (c: Condition): string[] =>
      'all' in c
        ? c.all.flatMap(read)
        : 'any' in c
          ? c.any.flatMap(read)
          : 'not' in c
            ? read(c.not)
            : [c.field];
    for (const action of shapeOf(name).fields.filter((field) => field.action === 'open_note_type')) {
      const section = action.path.split('.')[0]!;
      for (const path of read(action.showWhen as Condition)) {
        const field = fields.get(path.startsWith('./') ? `${section}.${path.slice(2)}` : path);
        expect(field, `${action.path}: ${path}`).toBeDefined();
        expect(optionsOf(field).flagged('normal'), `${action.path}: ${path}`).toEqual([]);
      }
    }
  });

  // forms 6.3 and focused-exam default 16: MSK is one entry per region examined, each with the
  // parts that follow the region, Side for every region but Head / Neck and Back (default 4) and
  // the shoulder's tests for the shoulder; a person's gait is one answer for the exam.
  it('exam-msk is one entry for each region, and gait once for the exam', () => {
    const shape = shapeOf('exam-msk');
    expect(shape.sections.map((section) => [section.id, section.repeat !== undefined])).toEqual([
      ['msk', true],
      ['msk_gait', false],
    ]);
    const fields = new Map(shape.fields.map((field) => [field.path, field]));
    expect(fields.get('msk.region')?.many).toBe(false);
    const regions = optionsOf(fields.get('msk.region')).codes;
    expect(regions).toEqual(expect.arrayContaining(['head_neck', 'back', 'shoulder']));
    const showsFor = (path: string) => {
      const showWhen = fields.get(path)?.showWhen as { field: string; is?: string | string[] } | undefined;
      expect(showWhen?.field, path).toBe('./region');
      return [showWhen?.is ?? regions].flat();
    };
    expect([...showsFor('msk.side')].sort()).toEqual(
      regions.filter((code) => code !== 'head_neck' && code !== 'back').sort(),
    );
    expect(showsFor('msk.shoulder_tests')).toEqual(['shoulder']);
    expect(
      shape.fields.filter((field) => field.path.startsWith('msk_gait.')).map((field) => field.path),
    ).toEqual(['msk_gait.gait']);
    // No part of an entry is a grid over regions: an entry is one region.
    for (const field of shape.fields)
      expect((field.rows as { pickedIn?: string } | undefined)?.pickedIn, field.path).toBeUndefined();
  });

  // An Unable answer says the finding could not be had, so nothing else is held beside it
  // ("Bulging, Unable to visualize"): in a choose-many field it clears the others, as None does.
  it.each(Object.keys(PLANNED))('%s: an Unable option of a choose-many field clears the others', (name) => {
    for (const field of shapeOf(name).fields) {
      if (field.kind !== 'choice' || field.many !== true) continue;
      const { flagged } = optionsOf(field);
      expect(
        flagged('unable').filter((code) => !flagged('exclusive').includes(code)),
        field.path,
      ).toEqual([]);
    }
  });

  it('exam-picker is the section exam of General: one choose-many with a code for each system', () => {
    const shape = shapeOf(PICKER_PIECE);
    expect(shape.header).toBeUndefined();
    // The picker always shows, and has nothing for one-tap Normal to fill.
    expect(shape.sections.map((section) => Object.keys(section).sort())).toEqual([['id', 'title']]);
    expect(shape.sections[0]!.id).toBe(PICKER.split('.')[0]);
    expect(shape.fields.map((field) => field.path)).toEqual([PICKER, 'exam.other_findings']);
    // Other is the free-text exam (default 9): the picker's Other text names the system, in at most
    // 200 characters, and the findings have a text box of their own.
    expect(shape.fields[1]).toEqual({
      path: 'exam.other_findings',
      kind: 'text',
      label: 'Other exam findings',
      lines: 'many',
      maxLength: 2000,
      showWhen: { field: PICKER, is: 'other' },
    });
    const picker = shape.fields[0]!;
    expect([picker.kind, picker.many]).toEqual(['choice', true]);
    const { codes, flagged } = optionsOf(picker);
    expect([...codes].sort()).toEqual([...EXAM_SYSTEMS, 'other'].sort());
    // Other is kept as the free-text exam (focused-exam inventory, default 9).
    expect(flagged('other')).toEqual(['other']);
    expect([...flagged('sensitiveExam')].sort()).toEqual([...SENSITIVE_SYSTEMS].sort());
  });

  it('give every system of the picker a module, and show every module for one of them', () => {
    const systems = EXAM_PIECES.map((name) => systemOf(shapeOf(name).sections[0]!));
    expect([...new Set(systems)].sort()).toEqual([...EXAM_SYSTEMS].sort());
  });

  // forms 5 and 6.6: GU, Breast and Rectal carry sensitiveExam and the sensitive exam workflow,
  // which one-tap Normal never fills and whose consent Complete waits for. Nothing else in the exam
  // is required or kept from Normal (focused-exam inventory, default 53).
  it.each(EXAM_PIECES)('%s is a sensitive exam exactly when its system is one, with the workflow', (name) => {
    for (const section of shapeOf(name).sections) {
      const sensitive = SENSITIVE_SYSTEMS.includes(systemOf(section) ?? '');
      expect(section.sensitiveExam, section.id).toBe(sensitive ? true : undefined);
      const fields = fieldsOf(name, section.id);
      const held = fields.filter((field) => field.noNormal === true || field.required === true);
      if (!sensitive) {
        expect(held.map((field) => field.path)).toEqual([]);
        continue;
      }
      const at = (id: string) => `${section.id}.${id}`;
      const performed = { field: at('performed'), filled: true };
      expect(held).toEqual([
        { path: at('performed'), kind: 'flag', label: 'Exam performed', noNormal: true },
        {
          path: at('chaperone'),
          kind: 'choice',
          many: false,
          label: 'Chaperone present',
          options: { list: 'yes_no' },
          noNormal: true,
          showWhen: performed,
        },
        {
          path: at('consented'),
          kind: 'flag',
          label: 'Patient consented',
          required: true,
          noNormal: true,
          showWhen: performed,
        },
      ]);
    }
  });

  // What Exam performed opens: the intimate exam. In GU the general findings and the CVA are
  // charted without it (focused-exam inventory, default 35); Breast and Rectal are all intimate.
  const OPEN_WITHOUT_PERFORMED: Record<string, string[]> = {
    'exam-gu': ['gu.general', 'gu.cva', 'gu.performed'],
    'exam-breast': ['breast.performed'],
    'exam-rectal': ['rectal.performed'],
  };
  it.each(Object.entries(OPEN_WITHOUT_PERFORMED))(
    '%s shows its findings only once the exam is marked performed, but for those it names',
    (name, open) => {
      const section = shapeOf(name).sections[0]!.id;
      const fields = new Map(fieldsOf(name, section).map((field) => [field.path, field]));
      /** Whether a field can show only while Exam performed is ticked, through its group or its condition. */
      const gated = (path: string): boolean => {
        if (path === `${section}.performed`) return true;
        const above = path.slice(0, path.lastIndexOf('.'));
        if (fields.has(above) && gated(above)) return true;
        const showWhen = fields.get(path)?.showWhen as Condition | undefined;
        const tests = (c: Condition): string[] =>
          'all' in c ? c.all.flatMap(tests) : 'field' in c ? [c.field] : [];
        return showWhen !== undefined && tests(showWhen).some((field) => field !== path && gated(field));
      };
      const ungated = [...fields.keys()].filter((path) => !gated(path));
      expect(ungated).toEqual(open.filter((path) => path !== `${section}.performed`));
    },
  );

  // validate.condition_reads_restricted (forms 6.6): what a condition outside a sensitive exam
  // shows would tell a reader without the key that the exam was done, or what it found.
  it('read a sensitive exam only from inside one', () => {
    const names = Object.keys(PLANNED).filter((name) => noteTypeOf(name) === GENERAL);
    const sensitive = new Set(
      names.flatMap((name) =>
        shapeOf(name)
          .sections.filter((s) => s.sensitiveExam === true)
          .map((s) => s.id),
      ),
    );
    const reads = (condition: Condition, from: string) => {
      if ('all' in condition) return condition.all.forEach((c) => reads(c, from));
      if ('any' in condition) return condition.any.forEach((c) => reads(c, from));
      if ('not' in condition) return reads(condition.not, from);
      if (condition.field.startsWith('./')) return;
      expect(sensitive.has(condition.field.split('.')[0]!), `${from}: ${condition.field}`).toBe(false);
      if (condition.field === PICKER && 'is' in condition)
        expect(
          [condition.is].flat().filter((code) => SENSITIVE_SYSTEMS.includes(code)),
          from,
        ).toEqual([]);
    };
    for (const name of names)
      for (const section of shapeOf(name).sections) {
        if (section.sensitiveExam === true) continue;
        if (section.showWhen) reads(section.showWhen as Condition, section.id);
        for (const field of fieldsOf(name, section.id)) {
          if (field.showWhen) reads(field.showWhen as Condition, field.path);
          const rows = field.rows as { pickedIn?: string } | undefined;
          if (rows?.pickedIn) reads({ field: rows.pickedIn, filled: true }, field.path);
        }
      }
  });

  it('lay out General as its plan has it: the exam after Vitals, then one include for each module', () => {
    const own = Object.keys(PLANNED)
      .filter((name) => PLANNED[name] === GENERAL)
      .map((name) => shapeOf(name).sections.map((section) => section.id));
    const ids = GENERAL_PLAN.filter((entry) => typeof entry === 'string');
    expect([...ids].sort()).toEqual(own.flat().sort());
    // Each piece's sections keep their shape file's order.
    for (const sections of own)
      expect(sections.map((id) => ids.indexOf(id))).toEqual(
        sections.map((id) => ids.indexOf(id)).sort((a, b) => a - b),
      );
    expect(ids.indexOf('exam')).toBe(ids.indexOf('vitals') + 1);
    const at = GENERAL_PLAN.indexOf('exam');
    expect(GENERAL_PLAN.slice(at + 1, at + 1 + EXAM_PIECES.length)).toEqual(
      EXAM_PIECES.map((piece) => ({ include: piece.replaceAll('-', '_'), version: 1 })),
    );
    // Once F6-general-assemble has typed the file, it is held to the plan. An include carries no
    // showWhen: each section of a module already shows only while its system is picked.
    if (!existsSync(`${root}${GENERAL}`)) return;
    const written = JSON.parse(read(GENERAL)) as NoteType;
    expect(written.sections.map((section) => ('include' in section ? section : section.id))).toEqual(
      GENERAL_PLAN,
    );
  });
});

/**
 * The shared lists (forms 4.4): those it names, Skin's side list, and the lists the inventories'
 * section 5 call the same in each place they appear. A list has no shape file, so its codes,
 * labels, order and flags, read against the lines, are pinned here: each entry is `code=Label`,
 * then ` +flag` for each flag it carries. A list's flag decides what one-tap Normal writes in
 * every field that names it (Normal on the shoulder tests is Not performed, not Negative), and a
 * label written as a number ("2+") follows no code rule, so a slip in either would pass the shape
 * check of every piece.
 */
const LIST_PINS: Record<string, string[]> = {
  body_region: [
    'head=Head',
    'upper_body=Upper Body',
    'abdomen=Abdomen',
    'back=Back',
    'arms=Arms',
    'legs=Legs',
    'lower_body=Lower Body',
    'hands=Hands',
  ],
  capillary_refill: [
    'less_than_2_seconds=Less than 2 seconds +normal',
    'greater_than_2_seconds=Greater than 2 seconds',
  ],
  drainage_amount: ['none=None', 'scant=Scant', 'small=Small', 'moderate=Moderate', 'large=Large'],
  dressing: [
    'gauze=Gauze',
    'xeroform=Xeroform',
    'mepilex=Mepilex',
    'abd=ABD',
    'hydrocolloid=Hydrocolloid',
    'aquacel=Aquacel',
    'compression=Compression',
    'other=Other +other',
  ],
  lung_findings: [
    'clear=Clear +exclusive +normal',
    'diminished=Diminished',
    'crackles=Crackles',
    'wheezes=Wheezes',
    'rhonchi=Rhonchi',
    'stridor=Stridor',
    'bronchial=Bronchial',
  ],
  needs: [
    'housing=Housing',
    'food=Food',
    'hygiene=Hygiene',
    'clothing=Clothing',
    'phone=Phone',
    'charging=Charging',
    'transportation=Transportation',
    'medication=Medication',
    'id=ID',
    'financial=Financial',
    'legal=Legal',
    'pet=Pet',
    'benefits=Benefits',
    'other=Other +other',
  ],
  pulse_scale: [
    'zero=0',
    'one_plus=1+',
    'two_plus=2+ +normal',
    'three_plus=3+',
    'unable_to_assess=Unable to assess +unable',
  ],
  range_of_motion: [
    'full=Full +exclusive +normal',
    'limited=Limited',
    'painful=Painful',
    'unable=Unable +exclusive +unable',
  ],
  reflex_scale: ['zero=0', 'one_plus=1+', 'two_plus=2+ +normal', 'three_plus=3+', 'four_plus=4+'],
  side: ['right=Right', 'left=Left', 'bilateral=Bilateral'],
  side_rl: ['right=Right', 'left=Left'],
  side_rlm: ['right=Right', 'left=Left', 'midline=Midline'],
  special_test_result: [
    'not_performed=Not performed +normal',
    'negative=Negative',
    'positive=Positive',
    'unable=Unable +unable',
  ],
  surface: ['anterior=Anterior', 'posterior=Posterior'],
  wound_type: [
    'venous=Venous',
    'arterial=Arterial',
    'pressure=Pressure',
    'diabetic=Diabetic',
    'traumatic=Traumatic',
    'burn=Burn',
    'abscess=Abscess',
    'surgical=Surgical',
    'cellulitis=Cellulitis',
    'other=Other +other',
  ],
  yes_no: ['yes=Yes', 'no=No'],
  yes_no_unknown: ['yes=Yes', 'no=No', 'unknown=Unknown'],
};
const LISTS = Object.keys(LIST_PINS);

/** A list's options as LIST_PINS writes them. */
const pinOf = (list: OptionList): string[] =>
  list.options.map(({ code, label, ...flags }) =>
    [
      `${code}=${label}`,
      ...Object.keys(flags)
        .sort()
        .map((flag) => {
          const value = (flags as Record<string, unknown>)[flag];
          return value === true ? ` +${flag}` : ` +${flag}:${String(value)}`;
        }),
    ].join(''),
  );

describe('the shared lists', () => {
  it('are exactly the lists the definitions draw on', () => {
    expect(filesIn('lists')).toEqual(LISTS.map((name) => `${name}.json`).sort());
  });

  // The export refuses a list that no definition names: each one is named by some plan, through
  // a choice's options, a grid's rows, a region's side or its surface.
  it('are each named by the plan of some piece', () => {
    const { pieces } = readPieces(specTexts());
    const named = new Set<string>();
    for (const name of Object.keys(PLANNED))
      for (const field of (pieces[name]?.shape as Shape).fields) {
        for (const key of ['options', 'rows']) if (isListRef(field[key])) named.add(field[key].list);
        if (typeof field.side === 'string') named.add(field.side);
        if (field.surface === true) named.add(SURFACE_LIST);
      }
    expect(LISTS.filter((list) => !named.has(list))).toEqual([]);
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

  it.each(LISTS)('%s holds the codes, labels, order and flags read against the lines', (name) => {
    expect(pinOf(listOf(name))).toEqual(LIST_PINS[name]);
  });
});
