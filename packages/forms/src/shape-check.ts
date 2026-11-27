/**
 * The shape check (docs/design/phase-4/forms.md, 4.2). The field specification gives the words of
 * the options and little else. Everything else about a piece (which fields there are, their kinds
 * and labels, choose-one or choose-many, how many options, which option carries which flag, what
 * shows when, what is required) is decided once, by the planner, in definitions/spec/<piece>.shape.json.
 * This check holds the sections that name the piece to that file, so the person or model typing the
 * definition has nothing to decide and nothing to get wrong unseen. The words of the options are
 * the spec check's (src/spec-check.ts).
 *
 * A shape file is the definition's sections without their options' words: each section and each
 * field with every key the definition writes, an option list as its codes in order and its flags.
 * A code is the recipe's rule applied to its label (`codeOf`); where the planner gives a code the
 * rule would not make, the shape file gives the code and the label together. So a code crossed
 * with its label, invented, typed twice, moved to another field or put out of order is found.
 * Where the lines spell one word in two ways ("Yes" and "YES"), the rule makes one code of both,
 * and the shape file pins the label beside the code all the same: then the definition's label is
 * held to it too.
 *
 * Pure: the export reads the files of definitions/spec and hands them over (`readPieces`).
 */
import { canonicalJson } from './canonical.ts';
import type { DefinitionFiles, FileProblem } from './resolve.ts';
import { definitionsOf, pieceShape, sectionsByPiece } from './spec-check.ts';
import type { Pieces } from './spec-check.ts';
import { OPTION_CODE } from './types.ts';
import type { Field, Module, NoteType, Option, Section } from './types.ts';

/** A section of a shape file: every key of the section but its fields and the piece it names. */
export type ShapeSection = { id: string } & Record<string, unknown>;

/**
 * A field of a shape file. `path` is the ids from the section down to the field, joined by dots:
 * a field in a group after the group's id, the cell of a grid after the grid's. Then every key of
 * the field but its id and its children, which have entries of their own. An option list
 * (`options`, or the `rows` of a grid) is its codes in order (`ShapeOption`), or the shared list or
 * picked field as the definition names it; `flags` says which codes carry each key an option has
 * beside its code and label: `{ "other": ["other"], "suggests": { "skin": "wound_care" } }`.
 */
export type ShapeField = { path: string; kind: string } & Record<string, unknown>;

/**
 * An option in a shape file: its code, which must be the recipe's rule applied to the option's
 * label; or, where the rule gives no valid code, the planner gives another or the planner pins the
 * label, the code and the label it is given for.
 */
export type ShapeOption = string | { code: string; label: string };

/**
 * The recipe's code rule (docs/plan/patterns/form-definition.md, step 5): the label in lower case,
 * every run of characters that are not a-z or 0-9 one `_`, and no `_` at either end. "Safer-use
 * supplies" is `safer_use_supplies`. What it makes is not always a valid code ("<1 wk" is `1_wk`);
 * then the shape file gives the code.
 */
export const codeOf = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * <piece>.shape.json. Sections and fields are in the order the definition writes them.
 *  - `file`: the definition file the piece is typed into, by its path under definitions/. Once it
 *    exists, the piece must be named by a section of it, and each of its sections must name a piece
 *    or be listed in `outside` (by id) by one of the shape files for it: so a definition typed
 *    without "spec" is not checked against nothing.
 *  - `header`: a note type's every top-level key but `sections` and `renames`, as it must be
 *    written. Exactly one shape file for a note type file carries it; none for a module.
 */
export type Shape = {
  piece: string;
  file: string;
  header?: Record<string, unknown>;
  outside?: string[];
  sections: ShapeSection[];
  fields: ShapeField[];
};

/**
 * The shape of the sections of a file that name the piece: what its shape file has to say. `path`
 * is the file's path under definitions/. The first piece a note type names carries its header and
 * the sections that name no piece. Given the piece's plan, the labels it pins are kept.
 */
export function shapeOf(piece: string, file: NoteType | Module, path: string, plan?: Shape): Shape {
  const byPiece = sectionsByPiece(file);
  const { shape } = placedShape(piece, byPiece.get(piece) ?? [], plan);
  const first = [...byPiece.keys()][0] === piece;
  const outside = file.sections.flatMap((s) => ('include' in s || s.spec ? [] : [s.id]));
  return {
    piece,
    file: path,
    ...('key' in file && first ? { header: headerOf(file) } : {}),
    ...(first && outside.length > 0 ? { outside } : {}),
    sections: shape.sections,
    fields: shape.fields,
  };
}

/** A note type's own keys: all but its sections and the renames it declares. */
function headerOf(file: NoteType): Record<string, unknown> {
  const { sections: _sections, renames: _renames, ...header } = file;
  return header;
}

/** A definition file's path under definitions/, as a shape file names it. */
const DEFINITION_FILE = /^(note-types|modules)\/[a-z][a-z0-9_]{1,60}\/v[1-9][0-9]*\.json$/;

/**
 * A shape, and where in the file each of its sections (by id) and fields (by path) is written. An
 * option is its code where the rule makes it from the label, unless `plan` pins its label.
 */
function placedShape(
  piece: string,
  sections: { section: Section; at: string }[],
  plan?: Shape,
): { shape: Shape; places: Map<string, string> } {
  const shape: Shape = { piece, file: '', sections: [], fields: [] };
  const places = new Map<string, string>();
  /** The codes whose label the plan pins, by the field's path and the key that lists them. */
  const pinned = new Set<string>();
  for (const field of plan?.fields ?? [])
    for (const key of ['options', 'rows']) {
      const options = field[key];
      if (Array.isArray(options))
        for (const option of options as ShapeOption[])
          if (typeof option !== 'string') pinned.add(`${field.path} ${key} ${option.code}`);
    }
  const add = (field: Field, path: string, at: string) => {
    const { id: _id, fields, cell, ...keys } = field as Field & { fields?: Field[]; cell?: Field };
    const entry: ShapeField = { path, ...keys };
    for (const key of ['options', 'rows']) {
      const options = entry[key];
      if (!Array.isArray(options)) continue;
      entry[key] = (options as Option[]).map(({ code, label }): ShapeOption =>
        code === codeOf(label) && !pinned.has(`${path} ${key} ${code}`) ? code : { code, label },
      );
      const flags = flagsOf(options);
      if (Object.keys(flags).length > 0) entry.flags = flags;
    }
    shape.fields.push(entry);
    places.set(path, at);
    fields?.forEach((child, i) => add(child, `${path}.${child.id}`, `${at}.fields[${i}]`));
    if (cell) add(cell, `${path}.${cell.id}`, `${at}.cell`);
  };
  for (const { section, at } of sections) {
    const { fields, spec: _spec, ...keys } = section;
    shape.sections.push(keys);
    places.set(section.id, at);
    fields.forEach((field, i) => add(field, `${section.id}.${field.id}`, `${at}.fields[${i}]`));
  }
  return { shape, places };
}

/** For each key an option carries beside its code and label: the codes that carry it, or what each carries. */
function flagsOf(options: Record<string, unknown>[]): Record<string, unknown> {
  const flags: Record<string, string[] | Record<string, unknown>> = {};
  for (const { code, label: _label, ...carried } of options)
    for (const [key, value] of Object.entries(carried)) {
      // A flag is `true` or absent; `icon` and `suggests` name something.
      if (value === true) ((flags[key] ??= []) as string[]).push(String(code));
      else ((flags[key] ??= {}) as Record<string, unknown>)[String(code)] = value;
    }
  return flags;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The shape file's form (`shape.bad_file`). */
export function readShape(piece: string, shape: unknown): Shape | FileProblem[] {
  const file = pieceShape(piece);
  const problems: FileProblem[] = [];
  const bad = (path: string, message: string) =>
    problems.push({ file, path, rule: 'shape.bad_file', message });
  if (!isObject(shape)) {
    bad('$', 'must be an object with the keys piece, sections and fields');
    return problems;
  }
  const keys = ['piece', 'file', 'sections', 'fields'];
  const optional = ['header', 'outside'];
  for (const key of Object.keys(shape))
    if (!keys.includes(key) && !optional.includes(key)) bad(`$.${key}`, 'is no key of a shape file');
  for (const key of keys) if (!(key in shape)) bad('$', `has no "${key}"`);
  if ('piece' in shape && shape.piece !== piece) bad('$.piece', `must be "${piece}", the name of the file`);
  if ('file' in shape && (typeof shape.file !== 'string' || !DEFINITION_FILE.test(shape.file)))
    bad(
      '$.file',
      'must be the path under definitions/ of the note type or module file the piece is typed into',
    );
  if ('header' in shape) {
    if (!isObject(shape.header)) bad('$.header', 'must be the note type’s own keys, as an object');
    else if (typeof shape.file === 'string' && !shape.file.startsWith('note-types/'))
      bad('$.header', 'a module has no header: only a note type file does');
    else
      for (const key of ['sections', 'renames'])
        if (key in shape.header) bad(`$.header.${key}`, 'is not part of a note type’s header');
  }
  if (
    'outside' in shape &&
    (!Array.isArray(shape.outside) ||
      shape.outside.length === 0 ||
      shape.outside.some((id) => typeof id !== 'string') ||
      new Set(shape.outside).size !== shape.outside.length)
  )
    bad('$.outside', 'must be the ids of the file’s sections that name no piece, each once');

  const sections = new Set<string>();
  if ('sections' in shape && !Array.isArray(shape.sections)) bad('$.sections', 'must be a list of sections');
  else
    (shape.sections as unknown[] | undefined)?.forEach((section, index) => {
      const at = `$.sections[${index}]`;
      if (!isObject(section)) return bad(at, 'must be an object: a section’s id and its other keys');
      if (typeof section.id !== 'string' || section.id === '') bad(`${at}.id`, 'must be the section’s id');
      else if (sections.has(section.id)) bad(`${at}.id`, `"${section.id}" is listed twice`);
      else sections.add(section.id);
      // What a section's shape leaves out: its fields are listed under `fields`, by path.
      for (const key of ['fields', 'spec'])
        if (key in section) bad(`${at}.${key}`, 'is not part of a section’s shape');
    });

  // A field is not also told it is in no section when the list of sections is itself at fault.
  const sectionsRead =
    Array.isArray(shape.sections) && problems.every((p) => !p.path.startsWith('$.sections'));
  const paths = new Set<string>();
  if ('fields' in shape && !Array.isArray(shape.fields)) bad('$.fields', 'must be a list of fields');
  else
    (shape.fields as unknown[] | undefined)?.forEach((field, index) => {
      const at = `$.fields[${index}]`;
      if (!isObject(field)) return bad(at, 'must be an object: a field’s path, its kind and its other keys');
      const { path } = field;
      if (typeof path !== 'string')
        bad(`${at}.path`, 'must be the ids from the section down to the field, joined by dots');
      else if (paths.has(path)) bad(`${at}.path`, `"${path}" is listed twice`);
      else if (!path.includes('.') || (sectionsRead && !sections.has(path.split('.')[0]!)))
        bad(`${at}.path`, `"${path}" must start with the id of a section of this file, then a dot`);
      else paths.add(path);
      if (typeof field.kind !== 'string') bad(`${at}.kind`, 'must be the field’s kind');
      for (const key of ['id', 'fields', 'cell'])
        if (key in field)
          bad(
            `${at}.${key}`,
            'is not part of a field’s shape: the path names it, and each field in it has an entry of its own',
          );
      for (const key of ['options', 'rows']) {
        const options = field[key];
        if (options === undefined || (isObject(options) && !Array.isArray(options))) continue;
        if (!Array.isArray(options)) {
          bad(
            `${at}.${key}`,
            'must be the codes of the options in order, or the list they come from, or the field they are picked in',
          );
          continue;
        }
        options.forEach((option, i) => {
          const fits =
            typeof option === 'string'
              ? OPTION_CODE.test(option)
              : isObject(option) &&
                Object.keys(option).sort().join() === 'code,label' &&
                typeof option.code === 'string' &&
                OPTION_CODE.test(option.code) &&
                typeof option.label === 'string';
          if (!fits)
            bad(
              `${at}.${key}[${i}]`,
              'must be an option’s code, or { "code", "label" } where the code is not the rule’s or the label is pinned',
            );
        });
      }
    });
  return problems.length > 0 ? problems : (shape as Shape);
}

/**
 * Every file whose sections name a piece, against the piece's shape file, and every definition
 * file a shape file is for. The files must have passed the schema check (checkFile): a file
 * without sections or fields is reported there, and this check reads them without looking. The
 * rules:
 *  - `shape.missing_file`: a section names a piece that has no shape file
 *  - `shape.bad_file`: the shape file's form
 *  - `shape.missing_section`: a section of the shape file is not in the definition, or the file
 *    the shape file is for names the piece in no section at all
 *  - `shape.unnamed_section`: a section of that file names no piece and is not listed as outside
 *  - `shape.missing_header`, `shape.header_differs`: a note type's header
 *  - `shape.extra_section`, `shape.section_order`
 *  - `shape.section_differs`: a key of a section that is not what the shape file says
 *  - `shape.missing_field`, `shape.extra_field`, `shape.field_order` (within its section)
 *  - `shape.field_differs`: a key of a field that is not what the shape file says. The problem's
 *    path ends in the key, and its message names the field and gives both values.
 * A problem is placed in the definition, where it is mended; the shape file is the planner's. A
 * file is held to the shape on its own: a version that departs from it names a piece of its own.
 */
export function checkShapes(pieces: Pieces, files: DefinitionFiles): FileProblem[] {
  const problems: FileProblem[] = [];
  /** The faults of a shape file, found once however many files name the piece. */
  const read = new Map<string, Shape | null>();
  const readPiece = (name: string, namedAt: { file: string; path: string }): Shape | null => {
    if (read.has(name)) return read.get(name)!;
    const written = pieces[name]?.shape;
    let shape: Shape | null = null;
    if (written === undefined)
      problems.push({
        ...namedAt,
        rule: 'shape.missing_file',
        message: `names the piece "${name}", and ${pieceShape(name)} is not among the files`,
      });
    else {
      const result = readShape(name, written);
      if (Array.isArray(result)) problems.push(...result);
      else shape = result;
    }
    read.set(name, shape);
    return shape;
  };

  for (const { name: file, file: content } of definitionsOf(files))
    for (const [name, sections] of sectionsByPiece(content)) {
      const expected = readPiece(name, { file, path: `${sections[0]!.at}.spec` });
      if (!expected) continue;
      const { shape, places } = placedShape(name, sections, expected);
      for (const found of compare(expected, shape, places))
        problems.push({ file, path: found.path, rule: `shape.${found.rule}`, message: found.message });
    }

  // Each definition file a shape file is for: the pieces it must name, the sections that must name
  // one, and the note type's header. A file not written yet is not looked for.
  const forFile = new Map<string, Shape[]>();
  for (const [name, piece] of Object.entries(pieces)) {
    if (piece.shape === undefined) continue;
    const shape = readPiece(name, { file: pieceShape(name), path: '$' });
    if (shape) forFile.set(shape.file, [...(forFile.get(shape.file) ?? []), shape]);
  }
  for (const [file, shapes] of forFile) {
    const content = Object.hasOwn(files.noteTypes, file)
      ? files.noteTypes[file]
      : Object.hasOwn(files.modules, file)
        ? files.modules[file]
        : undefined;
    if (!content) continue;
    const named = sectionsByPiece(content);
    for (const shape of shapes)
      if (!named.has(shape.piece))
        problems.push({
          file,
          path: '$.sections',
          rule: 'shape.missing_section',
          message: `${pieceShape(shape.piece)} is for this file, and no section of it names the piece "${shape.piece}"`,
        });
    const outside = new Set(shapes.flatMap((shape) => shape.outside ?? []));
    content.sections.forEach((section, index) => {
      if ('include' in section || section.spec || outside.has(section.id)) return;
      problems.push({
        file,
        path: `$.sections[${index}]`,
        rule: 'shape.unnamed_section',
        message: `the section "${section.id}" names no piece, and no shape file for this file lists it as outside the specification`,
      });
    });
    if ('key' in content) problems.push(...checkHeader(file, content, shapes));
  }
  return problems;
}

/** A note type's header, against the one shape file for it that carries one. */
function checkHeader(file: string, content: NoteType, shapes: Shape[]): FileProblem[] {
  const carriers = shapes.filter((shape) => shape.header !== undefined);
  if (carriers.length === 0)
    return [
      {
        file,
        path: '$',
        rule: 'shape.missing_header',
        message: `no shape file for this file gives its header (one of ${shapes.map((s) => pieceShape(s.piece)).join(', ')} must)`,
      },
    ];
  const problems: FileProblem[] = carriers.slice(1).map((shape) => ({
    file: pieceShape(shape.piece),
    path: '$.header',
    rule: 'shape.bad_file',
    message: `${pieceShape(carriers[0]!.piece)} already gives the header of ${file}: one shape file does`,
  }));
  const wanted = carriers[0]!.header!;
  const written = headerOf(content);
  const show = (value: unknown) => (value === undefined ? 'not set' : canonicalJson(value));
  for (const key of new Set([...Object.keys(wanted), ...Object.keys(written)])) {
    const [a, b] = [(written as Record<string, unknown>)[key], wanted[key]];
    if (show(a) !== show(b))
      problems.push({
        file,
        path: `$.${key}`,
        rule: 'shape.header_differs',
        message: `${key} is ${show(a)} here, and ${pieceShape(carriers[0]!.piece)} says ${show(b)}`,
      });
  }
  return problems;
}

type Found = { path: string; rule: string; message: string };

function compare(expected: Shape, actual: Shape, places: Map<string, string>): Found[] {
  const found: Found[] = [];
  const shapeFile = pieceShape(expected.piece);
  const show = (value: unknown) => (value === undefined ? 'not set' : canonicalJson(value));

  /** Entries of one kind, by their name: what is missing, what is too many, the order, then each key. */
  const entries = <T extends Record<string, unknown>>(
    what: 'section' | 'field',
    nameKey: 'id' | 'path',
    wanted: T[],
    written: T[],
    missingAt: string,
  ) => {
    const name = (entry: T) => String(entry[nameKey]);
    const wantedNames = new Map(wanted.map((entry) => [name(entry), entry]));
    const writtenNames = new Set(written.map(name));
    for (const entry of wanted)
      if (!writtenNames.has(name(entry)))
        found.push({
          path: missingAt,
          rule: `missing_${what}`,
          message: `${shapeFile} has the ${what} "${name(entry)}", and it is not here`,
        });
    for (const entry of written)
      if (!wantedNames.has(name(entry)))
        found.push({
          path: places.get(name(entry))!,
          rule: `extra_${what}`,
          message: `the ${what} "${name(entry)}" is not in ${shapeFile}`,
        });
    const inBoth = written.filter((entry) => wantedNames.has(name(entry)));
    const order = wanted.filter((entry) => writtenNames.has(name(entry)));
    const first = inBoth.findIndex((entry, index) => name(entry) !== name(order[index]!));
    if (first >= 0)
      found.push({
        path: places.get(name(inBoth[first]!))!,
        rule: `${what}_order`,
        message: `the ${what} "${name(inBoth[first]!)}" is where ${shapeFile} has "${name(order[first]!)}"`,
      });
    for (const entry of inBoth) {
      const wants = wantedNames.get(name(entry))!;
      for (const key of new Set([...Object.keys(wants), ...Object.keys(entry)])) {
        if (key === nameKey || show(entry[key]) === show(wants[key])) continue;
        found.push({
          path: `${places.get(name(entry))}.${key}`,
          rule: `${what}_differs`,
          message: `"${name(entry)}": ${key} is ${show(entry[key])} here, and ${shapeFile} says ${show(wants[key])}`,
        });
      }
    }
  };

  entries('section', 'id', expected.sections, actual.sections, '$.sections');
  // Field by field within each section that is in both: a section that is missing or too many is
  // reported as that, and the order of the sections is the sections' own.
  const inSection = (fields: ShapeField[], id: string) => fields.filter((f) => f.path.split('.')[0] === id);
  for (const section of actual.sections) {
    if (!expected.sections.some((wanted) => wanted.id === section.id)) continue;
    const at = `${places.get(section.id)}.fields`;
    entries(
      'field',
      'path',
      inSection(expected.fields, section.id),
      inSection(actual.fields, section.id),
      at,
    );
  }
  return found;
}
