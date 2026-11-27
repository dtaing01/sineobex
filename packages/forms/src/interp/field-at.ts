/**
 * What a path of a note's answers points at (docs/design/phase-4/forms.md, 7.1): a field, a cell of
 * a grid's row, the Other option whose text is stored there, or an entry's own answers. The paths
 * themselves are worked out once, in src/paths.ts (2.3); this only looks them up, with the entry's
 * part of a repeating section taken out first.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedField, ResolvedNoteType, ResolvedSection } from '../resolve.ts';
import { pathModel, RESERVED_IDS } from '../paths.ts';
import type { FieldNode, Holds, Leaf, PathModel, SectionNode } from '../paths.ts';
import type { Option } from '../types.ts';

/** An entry's ID: the letter e and seven characters from a-z0-9, made on the phone (2.3). */
export const ENTRY_ID = /^e[a-z0-9]{7}$/;

/** What an answer at a path may be: a field's (paths.ts), or an entry's own. */
export type TargetHolds = Holds | { type: 'entryAt' | 'entryRemoved' };

/** The part of a path a field's kind adds after its own path, other than a side. */
export type AnswerPart = 'region' | 'side' | 'surface' | 'code' | 'label' | 'entryAt' | 'entryRemoved';

export type PathTarget = {
  /**
   * `field`: a field outside a grid's cell, at its own path or an answer of it. `cell`: in a grid's
   * row, the cell or a field of a group cell. `option`: the text of an Other option. `entry`: an
   * entry's `entryAt` or `entryRemoved`.
   */
  points: 'field' | 'cell' | 'option' | 'entry';
  /** Where it is written in the definition: the field, the Other option, or an entry's section. */
  at: string;
  section: ResolvedSection;
  /** The field, or the field whose Other option it is; null for an entry's own answers. */
  field: ResolvedField | null;
  /**
   * The Other option whose text is stored here. A field may mark more than one option Other; they
   * share the one text, and this is the first of them.
   */
  option: Option | null;
  /** The entry's ID in a repeating section. */
  entry: string | null;
  /** The row's code in a grid. */
  row: string | null;
  side: 'right' | 'left' | null;
  part: AnswerPart | null;
  /** The path with the entry's part left out: what a condition and a `mapsTo` write. */
  key: string;
  /** The answer stored here, from the path model; null for an entry's own answers and where nothing is stored. */
  leaf: Leaf | null;
  /** What an answer here may be; null where the path names a field but nothing is stored. */
  holds: TargetHolds | null;
};

/** A target before the entry is known. */
type Place = Omit<PathTarget, 'entry'>;
type Index = { model: PathModel; sections: Map<string, SectionNode>; places: Map<string, Place> };

// A definition does not change once resolved, and every answer of a note is looked up in it.
const indexes = new WeakMap<ResolvedNoteType, Index>();

/** The field, option or cell `path` points at in a note on `definition`, or null when it names none. */
export function fieldAt(definition: ResolvedNoteType, path: string): PathTarget | null {
  const index = indexOf(definition);
  const [sectionId = '', ...rest] = path.split('.');
  const section = index.sections.get(sectionId);
  if (!section) return null;
  let entry: string | null = null;
  if (section.section.repeat) {
    // Every path of a repeating section carries its entry's ID second (2.3).
    const id = rest.shift();
    if (id === undefined || !ENTRY_ID.test(id)) return null;
    entry = id;
    if (rest.length === 1 && RESERVED_IDS.includes(rest[0]!)) {
      const part = rest[0] as 'entryAt' | 'entryRemoved';
      return {
        points: 'entry',
        at: section.at,
        section: section.section,
        field: null,
        option: null,
        entry,
        row: null,
        side: null,
        part,
        key: `${sectionId}.${part}`,
        leaf: null,
        holds: { type: part },
      };
    }
  }
  if (rest.length === 0) return null;
  const place = index.places.get([sectionId, ...rest].join('.'));
  return place ? { ...place, entry } : null;
}

/**
 * The definition's path model (src/paths.ts), built once per resolved definition and shared by the
 * interpreter, so a leaf fieldAt returns is the same object the other functions walk from.
 */
export function definitionModel(definition: ResolvedNoteType): PathModel {
  return indexOf(definition).model;
}

function indexOf(definition: ResolvedNoteType): Index {
  let index = indexes.get(definition);
  if (index) return index;
  const model = pathModel(definition);
  index = {
    model,
    sections: new Map(model.sections.map((s) => [s.section.id, s])),
    places: new Map(),
  };
  for (const leaf of model.leaves.values()) index.places.set(leaf.key, fromLeaf(leaf));
  // A field's own path names it even where nothing is stored: a group, a grid, a region, a problem,
  // a field with sides, and the kinds that store nothing (photo, action, info).
  for (const node of model.nodes)
    for (const [key, row] of ownPaths(node))
      if (!index.places.has(key)) index.places.set(key, place(node, key, row, null, null, null, null));
  indexes.set(definition, index);
  return index;
}

/** A field's own paths, with the row of each: one in each row for a field in a grid's cell. */
function ownPaths(node: FieldNode): [key: string, row: string | null][] {
  if (node.base) return [[node.base.join('.'), null]];
  const grid = node.grid;
  if (!grid?.base) return [];
  // The cell's own id is no path part; the ids of the fields in a group cell are (2.3).
  const below: string[] = [];
  for (let at: FieldNode = node; at !== grid.cell; at = at.parent!) below.unshift(at.field.id);
  return grid.rows.map((row) => [[...grid.base!, row, ...below].join('.'), row]);
}

function fromLeaf(leaf: Leaf): Place {
  const { node } = leaf;
  const sided = node.field.sides === true || node.grid?.field.sides === true;
  const side = sided ? (leaf.parts.at(-1) as 'right' | 'left') : null;
  // Only the text of an Other option has no field path of its own (paths.ts, Leaf.fieldPath).
  if (leaf.fieldPath === null && node.field.kind === 'choice') {
    const index = node.field.options.findIndex((o) => o.other);
    return {
      ...place(node, leaf.key, leaf.row, side, null, leaf, leaf.holds),
      points: 'option',
      at: `${node.at}.options[${index}]`,
      option: node.field.options[index]!,
    };
  }
  const part =
    node.field.kind === 'region' || node.field.kind === 'problem' ? (leaf.parts.at(-1) as AnswerPart) : null;
  return place(node, leaf.key, leaf.row, side, part, leaf, leaf.holds);
}

function place(
  node: FieldNode,
  key: string,
  row: string | null,
  side: 'right' | 'left' | null,
  part: AnswerPart | null,
  leaf: Leaf | null,
  holds: Holds | null,
): Place {
  return {
    points: node.grid ? 'cell' : 'field',
    at: node.at,
    section: node.section.section,
    field: node.field,
    option: null,
    row,
    side,
    part,
    key,
    leaf,
    holds,
  };
}
