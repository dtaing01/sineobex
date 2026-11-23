/**
 * The four option operations of a team's edit (phase 5 design 5.4): add an option to a choice
 * field (its code made by the server, rule 3), rename one, retire one, move one. Each is refused on
 * a protected field, and on an option carrying `exclusive`, `normal`, `unable`, `other`, `suggests`
 * or `sensitiveExam` (edit-protected.ts); a retire is refused when it would leave no option. Only a
 * choice field outside a grid's cell takes them. applyNoteTypeEdit (edit.ts) hands them here;
 * edit-fanout.ts carries each along `mapsTo` (rule 5).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 *
 * Written ahead of its code (card P4-tests): it throws until card P4-edit-options builds it.
 */
import type { NoteTypeEdit, NoteTypeEditContext, NoteTypeEditStep } from './edit.ts';
import type { ResolvedNoteType } from './resolve.ts';

/** One of the four option operations on `definition`, as applyNoteTypeEdit answers it. */
export function applyOptionEdit(
  definition: ResolvedNoteType,
  edit: Extract<NoteTypeEdit, { op: 'add_option' | 'rename_option' | 'retire_option' | 'move_option' }>,
  context: NoteTypeEditContext,
): NoteTypeEditStep {
  void definition;
  void edit;
  void context;
  throw new Error('P4-edit-options');
}
