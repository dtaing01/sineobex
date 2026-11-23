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
 * Pure, and loaded by the API: nothing here may import a package.
 *
 * Written ahead of its code (card P4-tests): applyNoteTypeEdit and applyNoteTypeEdits throw until
 * card P4-edit-basic builds them; the option operations are edit-options.ts's (P4-edit-options), and
 * adding and copying are edit-add.ts's (P4-edit-add).
 */
import type { FileProblem, ResolvedNoteType } from './resolve.ts';
import type { Rename } from './types.ts';

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
 *  - `invalid`: a copied section leaves a definition phase 4's validator refuses, with what it found.
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
  /** For `invalid`: what phase 4's validator found. */
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

/**
 * Applies one operation to `definition`, the type's newest version with the publish's earlier
 * operations applied, whose version and key it keeps. `rename_label` of a field that stores an
 * answer and `rename_option` yield the renames versionProblems reads (forms 2.6): a field's at its
 * own path, an option's at each path its answers are stored at (each side of a field with
 * `sides`); a section's title, a group's label and every other operation yield none.
 */
export function applyNoteTypeEdit(
  definition: ResolvedNoteType,
  edit: NoteTypeEdit,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  void definition;
  void edit;
  void context;
  throw new Error('P4-edit-basic');
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
  void edits;
  void context;
  throw new Error('P4-edit-basic');
}
