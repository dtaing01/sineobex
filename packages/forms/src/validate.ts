/**
 * The semantic validator (docs/design/phase-4/forms.md, 4.2): what the JSON Schema cannot say about
 * a definition. It reads a resolved definition, so a module is checked as part of each note type
 * that includes it: its conditions name that note type's fields.
 *
 * Definitions are typed by hand. What passes here is what the server, the phone and the reports
 * rely on without looking again: every path is one the server takes, every condition names an
 * answer that exists, and nothing is ambiguous enough for two readers to differ on.
 *
 * Each problem names the file, the place in it and the rule, by a code that does not change.
 * Pure, like the resolver, and loaded by the API: nothing here may import a package.
 */
import { locate, noteTypeFile } from './resolve.ts';
import type { FileProblem, Origin, ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import type { Option } from './types.ts';

export type ValidateContext = {
  /** From `resolve`: lets a problem name the file and the place where the fault was written. */
  origins?: readonly Origin[];
  /**
   * The newest resolved version of another note type, for what names one: `mapsTo`, `suggests`
   * and the `open_note_type` action. Undefined when there is no such note type.
   */
  noteType: (key: string) => ResolvedNoteType | undefined;
};

/** An entry's own answers in a repeating section (2.3). No field may take their place. */
export const RESERVED_IDS: readonly string[] = ['entryAt', 'entryRemoved'];

/**
 * Every fault in a resolved definition; empty when it can be trusted. Without `origins` a place is
 * a place in the resolved definition, in the file a note type of that key and version would have.
 */
export function validate(definition: ResolvedNoteType, context: ValidateContext): FileProblem[] {
  const model = modelOf(definition);
  const found: Found[] = [...model.found];
  const report: Report = (at, rule, message) => found.push({ at, rule, message });
  checkCodes(model, report);

  const origins = context.origins ?? [
    { at: '$', file: noteTypeFile(definition.key, definition.version), path: '$' },
  ];
  // A list used by five fields is one file: its fault is found five times and reported once.
  const problems = new Map<string, FileProblem>();
  for (const { at, rule, message } of found) {
    const { file, path } = locate(origins, at);
    const key = `${file}  ${path}  ${rule}`;
    if (!problems.has(key)) problems.set(key, { file, path, rule: `validate.${rule}`, message });
  }
  return [...problems.values()];
}

/** A fault at a place in the resolved definition, before it is traced to its file. */
type Found = { at: string; rule: string; message: string };
type Report = (at: string, rule: string, message: string) => void;

// ---------------------------------------------------------------------------------------------
// The model: the definition's sections and fields as a tree, each with its place.

type SectionNode = {
  section: ResolvedSection;
  at: string;
  /** The fields written directly in the section. */
  nodes: Node[];
};

type Node = {
  field: ResolvedField;
  at: string;
  section: SectionNode;
  /** The group or grid it is written in; null for a field of the section itself. */
  parent: Node | null;
  /** The fields written beside it, itself among them. A grid's cell stands alone. */
  siblings: Node[];
  /** A group's fields. */
  children: Node[];
  /** A grid's cell. */
  cell: Node | null;
};

type Model = {
  definition: ResolvedNoteType;
  sections: SectionNode[];
  /** Every field at every depth, in the order written. */
  nodes: Node[];
  /** What building the model found: a section or a field that takes an id already used. */
  found: Found[];
};

function modelOf(definition: ResolvedNoteType): Model {
  const model: Model = { definition, sections: [], nodes: [], found: [] };
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
    const node: SectionNode = { section, at, nodes: [] };
    node.nodes = fieldNodes(model, section.fields, at, node, null);
    model.sections.push(node);
  });
  return model;
}

function fieldNodes(
  model: Model,
  fields: ResolvedField[],
  at: string,
  section: SectionNode,
  parent: Node | null,
): Node[] {
  const siblings: Node[] = [];
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
  model: Model,
  field: ResolvedField,
  at: string,
  section: SectionNode,
  parent: Node | null,
  siblings: Node[],
): Node {
  const node: Node = { field, at, section, parent, siblings, children: [], cell: null };
  model.nodes.push(node);
  if (RESERVED_IDS.includes(field.id))
    model.found.push({
      at: `${at}.id`,
      rule: 'reserved_id',
      message: `"${field.id}" is kept for an entry's own answers in a repeating section; no field may use it`,
    });
  if (field.kind === 'group') node.children = fieldNodes(model, field.fields, at, section, node);
  if (field.kind === 'grid') {
    const alone: Node[] = [];
    node.cell = fieldNode(model, field.cell, `${at}.cell`, section, node, alone);
    alone.push(node.cell);
  }
  return node;
}

// ---------------------------------------------------------------------------------------------
// Option codes.

/** Every option list a field holds, with its place. */
function optionLists(node: Node): { key: string; options: Option[] }[] {
  const { field } = node;
  if (field.kind === 'choice') return [{ key: 'options', options: field.options }];
  if (field.kind === 'grid') return Array.isArray(field.rows) ? [{ key: 'rows', options: field.rows }] : [];
  if (field.kind === 'region')
    return [
      { key: 'options', options: field.options },
      ...(field.side ? [{ key: 'side', options: field.side }] : []),
    ];
  return [];
}

function checkCodes(model: Model, report: Report) {
  for (const node of model.nodes) {
    for (const { key, options } of optionLists(node)) {
      const codes = new Set<string>();
      options.forEach((option, index) => {
        // Reports and supply mappings read a code as one meaning (2.6); an answer of it could be either.
        if (codes.has(option.code))
          report(
            `${node.at}.${key}[${index}].code`,
            'duplicate_code',
            `"${option.code}" is already the code of an option in this list`,
          );
        codes.add(option.code);
      });
    }
    if (node.field.kind === 'choice') checkExcludes(node, node.field, report);
  }
}

/** A blocked pair that names no option blocks nothing, and nobody would see that it does not. */
function checkExcludes(node: Node, field: Extract<ResolvedField, { kind: 'choice' }>, report: Report) {
  if (!field.excludes) return;
  const at = `${node.at}.excludes`;
  if (!field.many) {
    report(at, 'excludes_in_choose_one', 'a choose-one field holds one option: no two can be held together');
    return;
  }
  const codes = new Set(field.options.map((option) => option.code));
  field.excludes.forEach((pair, index) => {
    pair.forEach((code, side) => {
      if (!codes.has(code))
        report(
          `${at}[${index}][${side}]`,
          'excludes_unknown_code',
          `"${code}" is not the code of an option of this field`,
        );
    });
    if (pair[0] === pair[1])
      report(
        `${at}[${index}]`,
        'excludes_same_code',
        `"${pair[0]}" cannot be blocked from being held with itself`,
      );
  });
}
