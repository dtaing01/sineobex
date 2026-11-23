/**
 * A team's edit of one of its note types (phase 5 design 5.4): fixed operations on its newest
 * resolved definition, never a definition the admin writes. The server applies the operations of
 * one publish in order (applyNoteTypeEdits), names the result as the type's next version (4.3), and
 * checks it with phase 4's validate, versionProblems against every earlier version and the size
 * limit before it is stored. The JSON Schema check cannot run in the API's bundle, so every
 * operation builds only shapes the schema takes: packages/forms/test/edit.test.ts runs checkFile on
 * every result of packages/contract/test-vectors/note-type-edit.json, and the phone reads each one.
 *
 * The five rules (5.4), each pinned in note-type-edit.json:
 *  1. No operation writes a mark: sensitiveExam, treatmentRecord, needs, required, noNormal,
 *     showWhen, handoff, mapsTo and an option's marks are copied as they are.
 *  2. kinds, group, sensitivity, quick and auto never change after creation.
 *  3. An id or a code the server makes (`t_` and a number) is never reused in the note type,
 *     hidden and retired ones included: each is the lowest `t_<n>` above every one any version of
 *     the type has used, and a copied section keeps its ids only where the target never used them.
 *  4. A note is read on its own version, so what is hidden or retired stays readable in every note
 *     that has it: an edit only ever makes a new version.
 *  5. One master list per field: an option operation also reaches, through `mapsTo`, the field the
 *     edited one maps to and every field that maps to that one (edit-fanout.ts), never in an `auto`
 *     note type.
 *
 * Renaming the type, hiding and showing, and rewording a label are here; the option operations are
 * edit-options.ts's, and adding and copying edit-add.ts's. What none of them may touch is
 * edit-protected.ts's, which each asks.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import { applyAddEdit } from './edit-add.ts';
import { applyOptionEdit } from './edit-options.ts';
import {
  copyPart,
  fieldPlace,
  fieldsAt,
  holdsProtected,
  isProtected,
  isWords,
  typeProtected,
  withFields,
  type NoteTypePart,
} from './edit-protected.ts';
import { leafAt, pathModel, pathsOf } from './paths.ts';
import type { FieldNode, SectionNode } from './paths.ts';
import type { FileProblem, ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import type { Condition, Rename } from './types.ts';

/**
 * A field an operation adds: text, a choice (Yes or No is a choice with two options) or a number.
 * Its id, and each option's code, are made by the server (rule 3). It carries no mark (rule 1): in
 * a marked section the section's mark covers it, as visibleAnswers reads the section.
 */
export type NewField =
  | { kind: 'text'; label: string; lines: 'one' | 'many'; maxLength: number }
  | { kind: 'choice'; label: string; many: boolean; options: string[] }
  | { kind: 'number'; label: string; min: number; max: number; decimals: 0 | 1 | 2; unit?: string };

/**
 * One operation of a publish (5.4). A path is a field's path with the entry part of a repeating
 * section left out; a section is named by its id. `afterSectionId` null puts a section first.
 */
export type NoteTypeEdit =
  /** The type's title: 1 to 80 characters. */
  | { op: 'rename_type'; title: string }
  /**
   * `path` is a field's path or a section's id. Hidden leaves it out of the new version; shown
   * copies it back, unchanged, from the last version that had it, after the part it followed there.
   */
  | { op: 'set_hidden'; path: string; hidden: boolean }
  /** A field's label, or with a section's id the section's title. */
  | { op: 'rename_label'; path: string; label: string }
  /** A new option at the end of a choice field, its code made by the server. */
  | { op: 'add_option'; path: string; label: string }
  | { op: 'rename_option'; path: string; code: string; label: string }
  /** Leaves the option out of the new version; every earlier note keeps it. */
  | { op: 'retire_option'; path: string; code: string }
  /** Puts the option just before `before`, or with null at the end. */
  | { op: 'move_option'; path: string; code: string; before: string | null }
  /** A new field at the end of the section. */
  | ({ op: 'add_field'; sectionId: string } & NewField)
  /** A new section, with the fields it starts with: a section always holds one (forms 2.2). */
  | { op: 'add_section'; title: string; afterSectionId: string | null; fields: NewField[] }
  /**
   * One section copied unchanged, with its fields, ids, options and marks: from the newest
   * released version of a platform note type when the platform ships `fromKey`, else from the
   * current version of another of the team's note types.
   */
  | { op: 'copy_section'; fromKey: string; sectionId: string; afterSectionId: string | null };

/** The name of each operation, as the admin's request and the audit event write it. */
export type NoteTypeEditOp = NoteTypeEdit['op'];

export const NOTE_TYPE_EDIT_OPS: readonly NoteTypeEditOp[] = [
  'rename_type',
  'set_hidden',
  'rename_label',
  'add_option',
  'rename_option',
  'retire_option',
  'move_option',
  'add_field',
  'add_section',
  'copy_section',
];

/** The operations rule 5 carries along `mapsTo`. */
export const OPTION_EDIT_OPS: readonly NoteTypeEditOp[] = [
  'add_option',
  'rename_option',
  'retire_option',
  'move_option',
];

/**
 * Why an operation was refused:
 *  - `protected`: the part, or for an option operation a field it reaches through `mapsTo`, may not
 *    be edited (edit-protected.ts); hiding a section or group that holds a protected field too;
 *  - `in_use`: what a hide would take away is named from outside it: by a condition, a grid's
 *    `pickedIn`, a flag's `clears`, or a field of another of the team's note types that maps to it;
 *  - `not_found`: no such section, field, option, choice field or note type to edit or copy from;
 *  - `title_invalid`: a type's title that is empty, only spaces, or over 80 characters;
 *  - `label_invalid`: a label, an option's label or a section's title the schema refuses (empty,
 *    only spaces, or holding a control character);
 *  - `last_option`, `last_field`, `last_section`: a retire or a hide would leave a choice with no
 *    option, a section or a group with no field, or the type with no section;
 *  - `too_many_fields`, `too_many_sections`: more than 40 fields, or 10 sections, made by the team
 *    (ids `t_` and a number) in the type (section 11, row 39);
 *  - `not_copyable`: the source type's kinds, group, sensitivity, quick or auto is not the
 *    target's, or the section has `needs`;
 *  - `id_taken`: a copied section's id, or a `t_` id or code in it, was used in a version of the
 *    target;
 *  - `invalid`: a copied section leaves a definition phase 4's validator refuses, with what it
 *    found; or a field to add whose shape the schema refuses (a length, a range, a unit, no
 *    options), or a hide that is neither true nor false, with what is wrong.
 */
export type NoteTypeEditCode =
  | 'protected'
  | 'in_use'
  | 'not_found'
  | 'title_invalid'
  | 'label_invalid'
  | 'last_option'
  | 'last_field'
  | 'last_section'
  | 'too_many_fields'
  | 'too_many_sections'
  | 'not_copyable'
  | 'id_taken'
  | 'invalid';

export type NoteTypeEditRefusal = {
  code: NoteTypeEditCode;
  /** The note type whose field refused an option operation that reached it through `mapsTo`. */
  noteTypeKey?: string;
  /** For `invalid`: what phase 4's validator found, or what the schema would refuse. */
  problems?: FileProblem[];
};

/** What one operation reads besides the definition it changes. */
export type NoteTypeEditContext = {
  /**
   * Every version of the note type, oldest first, the newest last: what Show again copies back,
   * and every id and code the type ever used (rule 3).
   */
  versions: readonly ResolvedNoteType[];
  /**
   * The team's other active note types, each at its current version, by key: a field that maps
   * to this one (`in_use`), a section to copy, and what the validator looks another key up in.
   * Within a publish that changes several types (edit-fanout.ts), each at the version the publish
   * has made of it so far.
   */
  team: Readonly<Record<string, ResolvedNoteType>>;
  /** The platform's note types, each at its newest released version, by key: a section to copy. */
  platform: Readonly<Record<string, ResolvedNoteType>>;
  /**
   * Definitions whose made ids and codes count as used too: every version of the other note types
   * an option operation reaches (edit-fanout.ts), so a new code is the same in each.
   */
  taken?: readonly ResolvedNoteType[];
};

/** One operation's answer: the definition after it, with the renames it yields, or its refusal. */
export type NoteTypeEditStep =
  { ok: true; definition: ResolvedNoteType; renames: Rename[] } | { ok: false; refusal: NoteTypeEditRefusal };

/** The most characters a note type's title has, as the admin list and the timeline show it. */
export const NOTE_TYPE_TITLE_MAX = 80;

/** Whether `title` may name a note type: words the schema takes, 1 to 80 characters (code points). */
export const isNoteTypeTitle = (title: unknown): title is string =>
  isWords(title) && [...title].length <= NOTE_TYPE_TITLE_MAX;

const refused = (code: NoteTypeEditCode): NoteTypeEditStep => ({ ok: false, refusal: { code } });
const changed = (definition: ResolvedNoteType, renames: Rename[] = []): NoteTypeEditStep => ({
  ok: true,
  definition,
  renames,
});

/**
 * Applies one operation to `definition`, the type's newest version with the publish's earlier
 * operations applied, whose version and key it keeps. `rename_label` of a field that stores an
 * answer and `rename_option` yield the renames versionProblems reads (forms 2.6): a field's at its
 * own path, an option's at each path its answers are stored at (each side of a field with
 * `sides`); a section's title, a group's label and every other operation yield none. Nothing it is
 * given is changed: the definition it answers shares every part it did not change with
 * `definition`.
 */
export function applyNoteTypeEdit(
  definition: ResolvedNoteType,
  edit: NoteTypeEdit,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  // Every part of an auto note type, its title too, whatever the operation names (5.4).
  if (typeProtected(definition)) return refused('protected');
  switch (edit.op) {
    case 'rename_type':
      return isNoteTypeTitle(edit.title)
        ? changed({ ...definition, title: edit.title })
        : refused('title_invalid');
    case 'set_hidden':
      // A JSON value that is neither: a "false" sent as text would otherwise hide what it names.
      if (edit.hidden === true) return hide(definition, edit.path, context);
      if (edit.hidden === false) return show(definition, edit.path, context);
      return refused('invalid');
    case 'rename_label':
      return renameLabel(definition, edit.path, edit.label);
    case 'add_option':
    case 'rename_option':
    case 'retire_option':
    case 'move_option':
      return applyOptionEdit(definition, edit, context);
    case 'add_field':
    case 'add_section':
    case 'copy_section':
      return applyAddEdit(definition, edit, context);
  }
}

/** A publish's answer: the next version with the renames it declares, or the first refusal. */
export type NoteTypeEditOutcome =
  | { ok: true; definition: ResolvedNoteType; renames: Rename[] }
  | { ok: false; opIndex: number; refusal: NoteTypeEditRefusal };

/**
 * Applies every operation of one publish, in order, to the newest of `context.versions`, and names
 * the result as the next version: its key the type's, its version one more than the newest. The
 * first refusal refuses the publish, with the index of its operation. The renames are those of the
 * result: two renames of one label are one, from the first label to the last; one back to the label
 * it had, or of a part the publish then hides, is none.
 */
export function applyNoteTypeEdits(
  edits: readonly NoteTypeEdit[],
  context: NoteTypeEditContext,
): NoteTypeEditOutcome {
  const newest = context.versions.at(-1);
  if (!newest) throw new Error('a note type is edited from its newest version, and there is none');
  let definition = newest;
  const renamed: Rename[] = [];
  for (const [opIndex, edit] of edits.entries()) {
    const step = applyNoteTypeEdit(definition, edit, context);
    if (!step.ok) return { ok: false, opIndex, refusal: step.refusal };
    definition = step.definition;
    renamed.push(...step.renames);
  }
  // Its own copy: the steps share what they did not change with the versions they were given.
  const next = copyPart({ ...definition, key: newest.key, version: newest.version + 1 });
  return { ok: true, definition: next, renames: declaredRenames(context.versions, next, renamed) };
}

/**
 * The renames a version declares for what a publish reworded (forms 2.6), as versionProblems reads
 * them: for each part a step renamed, in the order first renamed, from the label it last had in
 * `earlier` to the one it has in `next`. So two renames of one label are one; one back to the label
 * it had, of a part `next` no longer has, or of one no earlier version had, is none. edit-fanout.ts
 * declares each note type's the same way.
 */
export function declaredRenames(
  earlier: readonly ResolvedNoteType[],
  next: ResolvedNoteType,
  renamed: readonly Rename[],
): Rename[] {
  if (renamed.length === 0) return [];
  // A path holds no space, so a field's label and an option's are kept apart.
  const keyOf = (path: string, code: string | undefined) => (code === undefined ? path : `${path} ${code}`);
  const labelsOf = (definitions: readonly ResolvedNoteType[]) => {
    const labels = new Map<string, string>();
    for (const definition of definitions)
      for (const stored of pathsOf(definition)) {
        if (stored.field) labels.set(stored.field.path, stored.field.label);
        for (const option of stored.options ?? []) labels.set(keyOf(stored.path, option.code), option.label);
      }
    return labels;
  };
  const was = labelsOf(earlier);
  const now = labelsOf([next]);
  const declared: Rename[] = [];
  const seen = new Set<string>();
  for (const { path, code } of renamed) {
    const key = keyOf(path, code);
    if (seen.has(key)) continue;
    seen.add(key);
    const from = was.get(key);
    const to = now.get(key);
    if (from === undefined || to === undefined || from === to) continue;
    declared.push(code === undefined ? { path, from, to } : { path, code, from, to });
  }
  return declared;
}

// ------------------------------------------------------------------------------------------------
// Rewording a label

function renameLabel(definition: ResolvedNoteType, path: string, label: string): NoteTypeEditStep {
  // A section's id is one path part: a path with no dot names a section, and its title.
  if (!path.includes('.')) {
    const section = definition.sections.find((s) => s.id === path);
    if (!section) return refused('not_found');
    if (isProtected(definition, { section: path })) return refused('protected');
    if (!isWords(label)) return refused('label_invalid');
    return changed({
      ...definition,
      sections: definition.sections.map((s) => (s === section ? { ...section, title: label } : s)),
    });
  }
  const place = fieldPlace(definition, path);
  if (!place) return refused('not_found');
  if (isProtected(definition, { path })) return refused('protected');
  if (!isWords(label)) return refused('label_invalid');
  const { field } = place;
  // A group stores no answer: no earlier note reads its label.
  const renames =
    field.kind === 'group' || field.label === label ? [] : [{ path, from: field.label, to: label }];
  return changed(
    withFields(definition, place, (fields) => fields.map((f) => (f === field ? { ...field, label } : f))),
    renames,
  );
}

// ------------------------------------------------------------------------------------------------
// Hiding and showing

const partOf = (path: string): NoteTypePart => (path.includes('.') ? { path } : { section: path });

/**
 * Leaves the section or field at `path` out of the new version. Every earlier version keeps it, so
 * every note that has it still reads it (rule 4).
 */
function hide(definition: ResolvedNoteType, path: string, context: NoteTypeEditContext): NoteTypeEditStep {
  const part = partOf(path);
  const section = 'section' in part ? definition.sections.find((s) => s.id === part.section) : undefined;
  const place = 'path' in part ? fieldPlace(definition, part.path) : undefined;
  if (!section && !place) return refused('not_found');
  if (holdsProtected(definition, part)) return refused('protected');
  if (namedFromOutside(definition, part, context)) return refused('in_use');
  if (section) {
    // A definition has no empty lists (forms 2.2): the type keeps a section, a section a field.
    if (definition.sections.length === 1) return refused('last_section');
    return changed({ ...definition, sections: definition.sections.filter((s) => s !== section) });
  }
  if (place!.siblings.length === 1) return refused('last_field');
  return changed(withFields(definition, place!, (fields) => fields.filter((f) => f !== place!.field)));
}

/**
 * Whether anything outside the part names what is inside it: a condition, a grid's `pickedIn`, a
 * flag's `clears`, or a field of another of the team's note types that maps to it. Hidden, the
 * part would leave each naming nothing (forms 2.2; Expand, lifecycle 6.4).
 */
function namedFromOutside(
  definition: ResolvedNoteType,
  part: NoteTypePart,
  context: NoteTypeEditContext,
): boolean {
  const model = pathModel(definition);
  const hidden =
    'section' in part
      ? model.sections.find((s) => s.section.id === part.section)!
      : model.nodes.find((n) => n.base?.join('.') === (part as { path: string }).path)!;
  const within = (node: FieldNode | SectionNode): boolean => {
    if (!('field' in node)) return node === hidden;
    if ('nodes' in hidden) return node.section === hidden;
    for (let at: FieldNode | null = node; at; at = at.parent) if (at === hidden) return true;
    return false;
  };
  const names = (condition: Condition | undefined, carrier: FieldNode | SectionNode, row: string | null) => {
    let named = false;
    const read = (c: Condition) => {
      if ('field' in c) {
        const found = leafAt(model, c.field, carrier, row);
        if ('leaf' in found && within(found.leaf.node)) named = true;
      } else if ('all' in c) c.all.forEach(read);
      else if ('any' in c) c.any.forEach(read);
      else read(c.not);
    };
    if (condition) read(condition);
    return named;
  };
  for (const section of model.sections)
    if (!within(section) && names(section.section.showWhen, section, null)) return true;
  for (const node of model.nodes) {
    if (within(node)) continue;
    // In a grid's cell a condition is read in each row (validate.ts reads it so).
    const rows: (string | null)[] = node.grid ? node.grid.rows : [null];
    if (rows.some((row) => names(node.field.showWhen, node, row))) return true;
    if (node.picked && within(node.picked.node)) return true;
    if (node.field.kind === 'flag')
      for (const id of node.field.clears ?? []) {
        const cleared = node.siblings.find((s) => s.field.id === id);
        if (cleared && within(cleared)) return true;
      }
  }
  const prefix = 'section' in part ? `${part.section}.` : `${part.path}.`;
  const at = 'section' in part ? null : part.path;
  for (const [key, other] of Object.entries(context.team)) {
    if (key === definition.key) continue;
    for (const target of mapsToIn(other.sections)) {
      const [toKey, toPath] = target.split(':') as [string, string];
      if (toKey === definition.key && (toPath === at || toPath.startsWith(prefix))) return true;
    }
  }
  return false;
}

/** Every `mapsTo` of a note type's fields, at any depth. */
function mapsToIn(sections: readonly ResolvedSection[]): string[] {
  const found: string[] = [];
  const walk = (fields: readonly ResolvedField[]) => {
    for (const field of fields) {
      if (field.mapsTo !== undefined) found.push(field.mapsTo);
      if (field.kind === 'group') walk(field.fields);
      if (field.kind === 'grid') walk([field.cell]);
    }
  };
  for (const section of sections) walk(section.fields);
  return found;
}

/**
 * Copies the section or field at `path` back, unchanged, from the last version that had it, after
 * the part it followed there (or, when the new version lacks that one, the nearest before it that
 * it has; else first). A part the version already has is left as it is. Nothing is shown back that
 * holds a protected field, nor into a protected section: protected parts are the platform's to add.
 */
function show(definition: ResolvedNoteType, path: string, context: NoteTypeEditContext): NoteTypeEditStep {
  const part = partOf(path);
  const versions = [...context.versions].reverse();
  if ('section' in part) {
    if (definition.sections.some((s) => s.id === part.section)) return changed(definition);
    for (const version of versions) {
      const index = version.sections.findIndex((s) => s.id === part.section);
      if (index < 0) continue;
      if (holdsProtected(version, part)) return refused('protected');
      const at = placeAfter(
        version.sections.slice(0, index).map((s) => s.id),
        definition.sections.map((s) => s.id),
      );
      const sections = [...definition.sections];
      sections.splice(at, 0, copyPart(version.sections[index]!));
      return changed({ ...definition, sections });
    }
    return refused('not_found');
  }
  if (fieldPlace(definition, part.path)) return changed(definition);
  for (const version of versions) {
    const was = fieldPlace(version, part.path);
    if (!was) continue;
    if (holdsProtected(version, part)) return refused('protected');
    const parent = fieldsAt(definition, part.path.split('.').slice(0, -1));
    if (!parent) return refused('not_found');
    if (isProtected(definition, { section: parent.section.id })) return refused('protected');
    const siblings = parent.groups.at(-1)?.fields ?? parent.section.fields;
    const at = placeAfter(
      was.siblings.slice(0, was.index).map((f) => f.id),
      siblings.map((f) => f.id),
    );
    return changed(
      withFields(definition, parent, (fields) => [
        ...fields.slice(0, at),
        copyPart(was.field),
        ...fields.slice(at),
      ]),
    );
  }
  return refused('not_found');
}

/** Where a part goes back among `now`: just after the nearest of `before` (the parts it followed) still there, else first. */
function placeAfter(before: readonly string[], now: readonly string[]): number {
  for (const id of [...before].reverse()) {
    const index = now.indexOf(id);
    if (index >= 0) return index + 1;
  }
  return 0;
}
