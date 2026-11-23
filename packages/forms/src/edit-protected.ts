/**
 * What a team's edit of a note type may not touch (phase 5 design 5.4; BM-73). A definition has no
 * `locked` mark, so it is worked out from phase 4's marks (forms 2.2): every part of a note type
 * with `auto` (Red flags, disposition and follow-up, PRD main 409); a field with `required` or
 * `noNormal` (the red-flag question, sensitive-exam consent and chaperone, PRD main 415); a section
 * with `needs`; a field of kind `action`, `problem`, `photo` or `info`; an option carrying
 * `exclusive`, `normal`, `unable`, `other`, `suggests` or `sensitiveExam`, and every option of a
 * protected field. Every operation of edit.ts asks this file, and the admin list answers it for
 * each section, field and option (design 7).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 *
 * Written ahead of its code (card P4-tests): each function throws until card P4-protected builds
 * it, and packages/forms/test/edit.test.ts and packages/contract/test-vectors/note-type-edit.json
 * hold it.
 */
import type { ResolvedNoteType } from './resolve.ts';

/**
 * A part of a note type, as an operation and the admin list name it: a section by its id; a field
 * by its path, the entry part of a repeating section left out (`supplies.pack.bags`); an option of
 * a choice field by that field's path and the option's code.
 */
export type NoteTypePart = { section: string } | { path: string } | { path: string; code: string };

/** Every protected part of one definition, as the admin list answers it for the editor (design 7). */
export type ProtectedParts = {
  /** Section ids: a section with `needs`, and every section of an `auto` note type. */
  sections: string[];
  /**
   * Field paths, at every depth but a grid's cell, in the order written: a field protected by its
   * own marks or kind, a grid whose cell is, and every field of a protected section.
   */
  fields: string[];
  /** The options of choice fields: every option of a protected field, and each marked option. */
  options: { path: string; code: string }[];
};

/** The field kinds an edit never touches: nothing a team types can stand in for them. */
export const PROTECTED_FIELD_KINDS = ['action', 'problem', 'photo', 'info'] as const;

/** The marks that protect an option: what one-tap Normal, the exam picker and the summary read. */
export const PROTECTED_OPTION_MARKS = [
  'exclusive',
  'normal',
  'unable',
  'other',
  'suggests',
  'sensitiveExam',
] as const;

/**
 * Whether an edit may not touch `part` itself (5.4). A part the definition does not have is not
 * protected: the operation that names it is refused `not_found` instead. Hiding a section or a
 * group that holds a protected field is refused too, which `holdsProtected` answers.
 */
export function isProtected(definition: ResolvedNoteType, part: NoteTypePart): boolean {
  void definition;
  void part;
  throw new Error('P4-protected');
}

/** Whether the section or field `part` names holds a protected field at any depth, or is one. */
export function holdsProtected(definition: ResolvedNoteType, part: NoteTypePart): boolean {
  void definition;
  void part;
  throw new Error('P4-protected');
}

/** Every protected section, field and option of the definition, as `isProtected` answers each. */
export function protectedParts(definition: ResolvedNoteType): ProtectedParts {
  void definition;
  throw new Error('P4-protected');
}
