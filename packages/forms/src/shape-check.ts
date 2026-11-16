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
 * field with every key the definition writes, an option list as its number and its flags.
 *
 * Pure: the export reads the files of definitions/spec and hands them over (`readPieces`).
 */
import { canonicalJson } from './canonical.ts';
import type { DefinitionFiles, FileProblem } from './resolve.ts';
import { definitionsOf, pieceShape, sectionsByPiece } from './spec-check.ts';
import type { Pieces } from './spec-check.ts';
import type { Field, Module, NoteType, Section } from './types.ts';

/** A section of a shape file: every key of the section but its fields and the piece it names. */
export type ShapeSection = { id: string } & Record<string, unknown>;

/**
 * A field of a shape file. `path` is the ids from the section down to the field, joined by dots:
 * a field in a group after the group's id, the cell of a grid after the grid's. Then every key of
 * the field but its id and its children, which have entries of their own. An option list
 * (`options`, or the `rows` of a grid) is its number, or the shared list or picked field as the
 * definition names it; `flags` says which codes carry each key an option has beside its code and
 * label: `{ "other": ["other"], "suggests": { "skin": "wound_care" } }`.
 */
export type ShapeField = { path: string; kind: string } & Record<string, unknown>;

/** <piece>.shape.json. Sections and fields are in the order the definition writes them. */
export type Shape = { piece: string; sections: ShapeSection[]; fields: ShapeField[] };

/** The shape of the sections of a file that name the piece: what its shape file has to say. */
export function shapeOf(piece: string, file: NoteType | Module): Shape {
  const { shape } = placedShape(piece, sectionsByPiece(file).get(piece) ?? []);
  return shape;
}

/** A shape, and where in the file each of its sections (by id) and fields (by path) is written. */
function placedShape(
  piece: string,
  sections: { section: Section; at: string }[],
): { shape: Shape; places: Map<string, string> } {
  const shape: Shape = { piece, sections: [], fields: [] };
  const places = new Map<string, string>();
  const add = (field: Field, path: string, at: string) => {
    const { id: _id, fields, cell, ...keys } = field as Field & { fields?: Field[]; cell?: Field };
    const entry: ShapeField = { path, ...keys };
    for (const key of ['options', 'rows']) {
      const options = entry[key];
      if (!Array.isArray(options)) continue;
      entry[key] = options.length;
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
  const keys = ['piece', 'sections', 'fields'];
  for (const key of Object.keys(shape)) if (!keys.includes(key)) bad(`$.${key}`, 'is no key of a shape file');
  for (const key of keys) if (!(key in shape)) bad('$', `has no "${key}"`);
  if ('piece' in shape && shape.piece !== piece) bad('$.piece', `must be "${piece}", the name of the file`);

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
      for (const key of ['options', 'rows'])
        if (Array.isArray(field[key]))
          bad(
            `${at}.${key}`,
            'must be the number of options, or the list they come from; the options themselves are typed in the definition',
          );
    });
  return problems.length > 0 ? problems : (shape as Shape);
}

/**
 * Every file whose sections name a piece, against the piece's shape file. The rules:
 *  - `shape.missing_file`: a section names a piece that has no shape file
 *  - `shape.bad_file`: the shape file's form
 *  - `shape.missing_section`, `shape.extra_section`, `shape.section_order`
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
      const { shape, places } = placedShape(name, sections);
      for (const found of compare(expected, shape, places))
        problems.push({ file, path: found.path, rule: `shape.${found.rule}`, message: found.message });
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
