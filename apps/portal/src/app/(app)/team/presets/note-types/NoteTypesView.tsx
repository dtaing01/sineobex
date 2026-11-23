import type { NoteTypeRow } from '@/lib/presets';

/**
 * Note types (phase 5 design 8.1), as the page first draws them from GET /v1/admin/note-types: a
 * section for each active note type, its kinds, Edit and Remove, and Sineobex's update when one is
 * on offer; the Removed list with Restore; Add, a copy of one or a blank one.
 *
 * Written ahead of its code (card P4-tests): it throws until card P4-list-page builds it, as
 * NoteTypesView.test.ts holds.
 */
export function NoteTypesView(props: {
  rows: readonly NoteTypeRow[];
  done?: string;
  refused?: string;
  noteType?: string;
}): React.ReactNode {
  void props;
  throw new Error('P4-list-page');
}
