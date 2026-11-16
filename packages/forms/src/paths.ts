/**
 * The paths of a definition (docs/design/phase-4/forms.md, 2.3): where a note written on it stores
 * each answer, and what may be stored there. One copy of these rules: the validator refuses the
 * paths the server would not take, the version rules compare what a path means from one version to
 * the next, and the interpreter reads a note's answers by them.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import { PATH_PART } from './types.ts';
import type { Option } from './types.ts';

/** A fault at a place in the resolved definition, before it is traced to its file. */
export type Found = { at: string; rule: string; message: string };

/** An entry's own answers in a repeating section (2.3). No field may take their place. */
export const RESERVED_IDS: readonly string[] = ['entryAt', 'entryRemoved'];

/** Right and left: the last part of the path of a field with `sides`. */
export const SIDES: readonly string[] = ['right', 'left'];

// ---------------------------------------------------------------------------------------------
// The model: the definition's sections and fields as a tree, each with its place.

export type SectionNode = {
  section: ResolvedSection;
  at: string;
  /** The fields written directly in the section. */
  nodes: FieldNode[];
};

export type FieldNode = {
  field: ResolvedField;
  at: string;
  section: SectionNode;
  /** The group or grid it is written in; null for a field of the section itself. */
  parent: FieldNode | null;
  /** The fields written beside it, itself among them. A grid's cell stands alone. */
  siblings: FieldNode[];
  /** A group's fields. */
  children: FieldNode[];
  /** A grid's cell. */
  cell: FieldNode | null;
  /** The grid whose cell it is, or is in. Such a field stores once for each row. */
  grid: FieldNode | null;
  /**
   * The path of the field itself, an entry part left out: the section's id, the ids of the groups
   * around it, its own. Null in a grid's cell, where the path depends on the row.
   */
  base: string[] | null;
  /** A grid's row codes. Empty until they are known, and when they cannot be. */
  rows: string[];
  /** The choose-many answer a grid's rows are picked in. */
  picked: Leaf | null;
  /** Every answer stored by it or inside it. */
  leaves: Leaf[];
};

/** What an answer at a path may be. */
export type Holds =
  | { type: 'codes'; many: boolean; options: Option[]; excludes: [string, string][] }
  | { type: 'text'; maxLength: number }
  | { type: 'number'; min: number; max: number; decimals: number; unit?: string }
  | { type: 'date'; range: 'past' | 'future' | 'any' }
  | { type: 'flag' | 'time' | 'duration' | 'surface' | 'problemCode' | 'problemLabel' };

/** One path a note on this definition can have an answer at (2.3). */
export type Leaf = {
  /** The path, the entry part of a repeating section left out: what a condition and a mapsTo write. */
  key: string;
  parts: string[];
  /** The field that stores it. */
  node: FieldNode;
  /** The row it is in, for an answer in a grid. */
  row: string | null;
  holds: Holds;
  /** Where the options of a code answer are written, in the resolved definition. */
  optionsAt: string | null;
};

export type PathModel = {
  definition: ResolvedNoteType;
  sections: SectionNode[];
  /** Every field at every depth, in the order written. */
  nodes: FieldNode[];
  leaves: Map<string, Leaf>;
  /** What building the model found: ids used twice, and paths that cannot be. */
  found: Found[];
};

/** The text of an Other option (2.3). */
const OTHER_TEXT: Holds = { type: 'text', maxLength: 200 };
const MAX_PATH_PARTS = 4;

export function pathModel(definition: ResolvedNoteType): PathModel {
  const model: PathModel = { definition, sections: [], nodes: [], leaves: new Map(), found: [] };
  const sectionIds = new Set<string>();
  definition.sections.forEach((section, index) => {
    const at = `$.sections[${index}]`;
    if (sectionIds.has(section.id)) {
      // Its paths would be the first one's. It is left out of the model, so the fault is reported once.
      model.found.push({
        at: `${at}.id`,
        rule: 'duplicate_section_id',
        message: `"${section.id}" is already the id of a section of this note type`,
      });
      return;
    }
    sectionIds.add(section.id);
    if (!PATH_PART.test(section.id))
      model.found.push({
        at: `${at}.id`,
        rule: 'bad_path_part',
        message: `"${section.id}" starts every path of the section, and the server takes no such path part`,
      });
    const node: SectionNode = { section, at, nodes: [] };
    node.nodes = fieldNodes(model, section.fields, at, node, null);
    model.sections.push(node);
  });

  // The rows of a grid can be the options of a field elsewhere, so those grids wait for every other
  // path. They do not wait for each other: rows are never picked in a grid of picked rows.
  const waiting: FieldNode[] = [];
  for (const section of model.sections)
    for (const node of section.nodes) storePaths(model, node, [section.section.id, node.field.id], waiting);
  const fixed = new Map(model.leaves);
  for (const grid of waiting) {
    const rows = (grid.field as Extract<ResolvedField, { kind: 'grid' }>).rows as { pickedIn: string };
    const picked = leafAt({ ...model, leaves: fixed }, rows.pickedIn, grid, null);
    const at = `${grid.at}.rows.pickedIn`;
    if ('fault' in picked) {
      model.found.push({
        at,
        rule: picked.fault === 'unknown_field' ? 'picked_in_unknown_field' : picked.fault,
        message: `${PATH_FAULTS[picked.fault](rows.pickedIn)}; the rows of the grid are the options picked there`,
      });
      continue;
    }
    if (picked.leaf.holds.type !== 'codes' || !picked.leaf.holds.many) {
      model.found.push({
        at,
        rule: 'picked_in_not_choose_many',
        message: `"${rows.pickedIn}" is not a choose-many field: there is no list of picked options to make rows of`,
      });
      continue;
    }
    grid.picked = picked.leaf;
    grid.rows = picked.leaf.holds.options.map((option) => option.code);
    storeRows(model, grid, grid.base!, grid.field.sides === true);
  }
  checkPrefixes(model);
  return model;
}

function fieldNodes(
  model: PathModel,
  fields: ResolvedField[],
  at: string,
  section: SectionNode,
  parent: FieldNode | null,
): FieldNode[] {
  const siblings: FieldNode[] = [];
  const ids = new Set<string>();
  fields.forEach((field, index) => {
    const place = `${at}.fields[${index}]`;
    if (ids.has(field.id)) {
      model.found.push({
        at: `${place}.id`,
        rule: 'duplicate_field_id',
        message: `"${field.id}" is already the id of a field beside this one: both would store at one path`,
      });
      return;
    }
    ids.add(field.id);
    siblings.push(fieldNode(model, field, place, section, parent, siblings));
  });
  return siblings;
}

function fieldNode(
  model: PathModel,
  field: ResolvedField,
  at: string,
  section: SectionNode,
  parent: FieldNode | null,
  siblings: FieldNode[],
): FieldNode {
  const grid = parent && (parent.field.kind === 'grid' ? parent : parent.grid);
  const node: FieldNode = {
    field,
    at,
    section,
    parent,
    siblings,
    children: [],
    cell: null,
    grid,
    base: null,
    rows: [],
    picked: null,
    leaves: [],
  };
  model.nodes.push(node);
  if (RESERVED_IDS.includes(field.id))
    model.found.push({
      at: `${at}.id`,
      rule: 'reserved_id',
      message: `"${field.id}" is kept for an entry's own answers in a repeating section; no field may use it`,
    });
  if (field.kind === 'group') node.children = fieldNodes(model, field.fields, at, section, node);
  if (field.kind === 'grid') {
    const alone: FieldNode[] = [];
    node.cell = fieldNode(model, field.cell, `${at}.cell`, section, node, alone);
    alone.push(node.cell);
  }
  return node;
}

// ---------------------------------------------------------------------------------------------
// Paths (2.3): what each kind stores, and where.

/** Works out every path stored by a field and what is in it. `base` is the path of the field itself. */
function storePaths(
  model: PathModel,
  node: FieldNode,
  base: string[],
  waiting: FieldNode[],
  row: string | null = null,
  sided = false,
) {
  const { field } = node;
  if (!node.grid) node.base = base;
  // Right and left are the last part of a path. A grid's sides are its cells'.
  const sides = sided || field.sides === true;
  const store = (parts: string[], holds: Holds) => {
    if (sides) for (const side of SIDES) storeLeaf(model, node, [...parts, side], row, holds);
    else storeLeaf(model, node, parts, row, holds);
  };
  switch (field.kind) {
    case 'choice':
      store(base, {
        type: 'codes',
        many: field.many,
        options: field.options,
        excludes: field.excludes ?? [],
      });
      // The text is stored beside the answer: at the same path, with `_other` added to its last part.
      if (field.options.some((option) => option.other))
        store([...base.slice(0, -1), `${base.at(-1)}_other`], OTHER_TEXT);
      return;
    case 'text':
      return store(base, { type: 'text', maxLength: field.maxLength });
    case 'number':
      return store(base, {
        type: 'number',
        min: field.min,
        max: field.max,
        decimals: field.decimals,
        ...(field.unit === undefined ? {} : { unit: field.unit }),
      });
    case 'date':
      return store(base, { type: 'date', range: field.range });
    case 'flag':
    case 'time':
    case 'duration':
      return store(base, { type: field.kind });
    case 'group':
      for (const child of node.children)
        storePaths(model, child, [...base, child.field.id], waiting, row, sided);
      return;
    case 'grid':
      if (!Array.isArray(field.rows)) {
        // In a grid's own cell there is no path yet to wait for.
        if (!node.grid) waiting.push(node);
        return;
      }
      node.rows = field.rows.map((option) => option.code);
      return storeRows(model, node, base, sides);
    case 'region':
      // Never sided: a region has a side of its own.
      storeLeaf(model, node, [...base, 'region'], row, {
        type: 'codes',
        many: false,
        options: field.options,
        excludes: [],
      });
      if (field.side)
        storeLeaf(
          model,
          node,
          [...base, 'side'],
          row,
          {
            type: 'codes',
            many: false,
            options: field.side,
            excludes: [],
          },
          `${node.at}.side`,
        );
      if (field.surface) storeLeaf(model, node, [...base, 'surface'], row, { type: 'surface' });
      return;
    case 'problem':
      storeLeaf(model, node, [...base, 'code'], row, { type: 'problemCode' });
      storeLeaf(model, node, [...base, 'label'], row, { type: 'problemLabel' });
      return;
    case 'photo':
    case 'action':
    case 'info':
      return;
  }
}

/** One cell for each row, at the grid's path and then the row's code. The cell's own id is no path part. */
function storeRows(model: PathModel, grid: FieldNode, base: string[], sided: boolean) {
  // A code used twice is reported as that; its second row would only repeat the first one's paths.
  for (const row of new Set(grid.rows)) storePaths(model, grid.cell!, [...base, row], [], row, sided);
}

function storeLeaf(
  model: PathModel,
  node: FieldNode,
  parts: string[],
  row: string | null,
  holds: Holds,
  optionsAt: string | null = holds.type === 'codes' ? `${node.at}.options` : null,
) {
  const key = parts.join('.');
  const leaf: Leaf = { key, parts, node, row, holds, optionsAt };
  for (let above: FieldNode | null = node; above; above = above.parent) above.leaves.push(leaf);
  // As a note would hold it: an entry's id is the second part of every path of a repeating section.
  const repeats = node.section.section.repeat !== undefined;
  const written = repeats ? [parts[0], '<entry>', ...parts.slice(1)].join('.') : key;
  if (parts.length + (repeats ? 1 : 0) > MAX_PATH_PARTS)
    model.found.push({
      at: node.at,
      rule: 'path_too_long',
      message: `stores at ${written}: a path has at most ${MAX_PATH_PARTS} parts`,
    });
  // The section's id is checked once, with the section.
  const refused = parts.slice(1).find((part) => !PATH_PART.test(part));
  if (refused !== undefined)
    model.found.push({
      at: node.at,
      rule: 'bad_path_part',
      message: `stores at ${written}, and the server takes no path part "${refused}"`,
    });
  const taken = model.leaves.get(key);
  if (taken)
    model.found.push({
      at: node.at,
      rule: 'path_collision',
      message: `stores at ${written}, where the field at ${taken.node.at} already stores`,
    });
  else model.leaves.set(key, leaf);
}

/** An answer cannot also be the start of other answers' paths: the two would be one thing to a reader. */
function checkPrefixes(model: PathModel) {
  for (const leaf of model.leaves.values())
    for (let length = leaf.parts.length - 1; length > 1; length--) {
      const above = model.leaves.get(leaf.parts.slice(0, length).join('.'));
      if (above)
        model.found.push({
          at: leaf.node.at,
          rule: 'path_collision',
          message: `stores at ${leaf.key}, under ${above.key}, where the field at ${above.node.at} stores an answer`,
        });
    }
}

export type PathFault = 'unknown_field' | 'relative_outside_entry' | 'path_into_repeat';
export const PATH_FAULTS: Record<PathFault, (path: string) => string> = {
  unknown_field: (path) => `no answer is stored at "${path}"`,
  relative_outside_entry: (path) => `"${path}" starts from an entry or a row, and there is none here`,
  path_into_repeat: (path) =>
    `"${path}" is in a repeating section, which has one such answer for each entry; from inside an entry it is written "./<field>"`,
};

/**
 * The answer a condition's (or a grid's) path names, read from where it is written: `carrier` is
 * the field that carries it, null for a section's own condition. `./` starts from the row inside
 * the cell of a grid, and otherwise from the entry of a repeating section (2.2).
 */
export function leafAt(
  model: PathModel,
  path: string,
  carrier: FieldNode | SectionNode,
  row: string | null,
): { leaf: Leaf } | { fault: PathFault } {
  let key = path;
  if (path.startsWith('./')) {
    const node = 'field' in carrier ? carrier : null;
    let from: string[];
    if (node?.grid) {
      if (!node.grid.base || row === null) return { fault: 'unknown_field' };
      from = [...node.grid.base, row];
    } else if (node && node.section.section.repeat) from = [node.section.section.id];
    else return { fault: 'relative_outside_entry' };
    key = [...from, path.slice(2)].join('.');
  } else {
    const section = model.sections.find((s) => s.section.id === path.split('.')[0]);
    if (section?.section.repeat) return { fault: 'path_into_repeat' };
  }
  const leaf = model.leaves.get(key);
  return leaf ? { leaf } : { fault: 'unknown_field' };
}

// ---------------------------------------------------------------------------------------------
// The paths as a list, for the version rules and the interpreter.

/** What an answer at a path is. Two versions agree on a path when they say the same here. */
export type PathHolds =
  | 'one code'
  | 'a list of codes'
  | 'text'
  | 'a number'
  | 'a tick'
  | 'a date'
  | 'a time'
  | 'a duration'
  | 'a surface'
  | 'a problem code'
  | 'a problem label'
  | 'the rows of a grid';

/** One path of a definition (2.3), the entry's part of a repeating section left out. */
export type StoredPath = {
  path: string;
  holds: PathHolds;
  /** A number's unit: stored numbers are in it. */
  unit?: string;
  /** The codes that can be stored here, or that are the next part of a row's path. */
  options?: Option[];
  /** Where in the resolved definition the field is, and its options. */
  at: string;
  optionsAt?: string;
};

const SAYS: Record<Exclude<Holds['type'], 'codes'>, PathHolds> = {
  text: 'text',
  number: 'a number',
  flag: 'a tick',
  date: 'a date',
  time: 'a time',
  duration: 'a duration',
  surface: 'a surface',
  problemCode: 'a problem code',
  problemLabel: 'a problem label',
};

/**
 * Every path a note on this definition can store at, and what is stored there, in the order the
 * fields are written; a grid whose rows are picked elsewhere comes after every other path. A grid
 * is also listed at its own path, where no answer is: its rows' codes are the next part of a path,
 * so their meaning is held like an option's. The list assumes a definition the validator passed.
 */
export function pathsOf(definition: ResolvedNoteType): StoredPath[] {
  const stored: StoredPath[] = [];
  const grids = new Set<FieldNode>();
  for (const leaf of pathModel(definition).leaves.values()) {
    const grid = leaf.node.grid;
    if (grid && !grids.has(grid)) {
      grids.add(grid);
      const { rows } = grid.field as Extract<ResolvedField, { kind: 'grid' }>;
      const path = grid.base!.join('.');
      // The labels of picked rows are the picked field's, and are compared there.
      if (Array.isArray(rows))
        stored.push({
          path,
          holds: 'the rows of a grid',
          options: rows,
          optionsAt: `${grid.at}.rows`,
          at: grid.at,
        });
      else stored.push({ path, holds: 'the rows of a grid', at: grid.at });
    }
    const { holds } = leaf;
    const at = leaf.node.at;
    if (holds.type === 'codes')
      stored.push({
        path: leaf.key,
        holds: holds.many ? 'a list of codes' : 'one code',
        options: holds.options,
        optionsAt: leaf.optionsAt!,
        at,
      });
    else
      stored.push({
        path: leaf.key,
        holds: SAYS[holds.type],
        at,
        ...(holds.type === 'number' && holds.unit !== undefined ? { unit: holds.unit } : {}),
      });
  }
  return stored;
}
