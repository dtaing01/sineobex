/**
 * Adding to a team's note type (phase 5 design 5.4): a field at the end of a section, a section
 * with the fields it starts with, and one section copied unchanged from a platform note type or
 * another of the team's (BM-75). Every id and code the server makes is `t_` and the lowest number
 * above every one the type has used (rule 3). A team may add 40 fields and 10 sections to a type,
 * each counted over its fields and sections whose id the server made (section 11, row 39; BM-84). A
 * copy keeps every mark (rule 1), and is refused from a type of other kinds, group, sensitivity,
 * quick or auto, or of a section with `needs` (`not_copyable`), when an id it brings was used in a
 * version of the target (`id_taken`), and when phase 4's validator refuses the result (`invalid`).
 * applyNoteTypeEdit (edit.ts) hands them here.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 *
 * Written ahead of its code (card P4-tests): it throws until card P4-edit-add builds it.
 */
import type { NoteTypeEdit, NoteTypeEditContext, NoteTypeEditStep } from './edit.ts';
import type { ResolvedNoteType } from './resolve.ts';

/** add_field, add_section or copy_section on `definition`, as applyNoteTypeEdit answers it. */
export function applyAddEdit(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'add_field' | 'add_section' | 'copy_section' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  void definition;
  void edit;
  void context;
  throw new Error('P4-edit-add');
}
