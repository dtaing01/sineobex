import type { NoteTypeRow, PresetEvent, PresetRow } from '@/lib/presets';

/**
 * Field supplies (phase 5 design 8.1): each mapping with its note type, its field and answer or
 * Every note of this type, and its items; a warning where its field is hidden or its answer retired
 * in the note type's current version; Add; the Removed list. The note types come from
 * GET /v1/admin/note-types (lib/presets.ts), so the page names each field by its label.
 *
 * Written ahead of its code (card P4-tests): it throws until card P4-field-supplies builds it, as
 * FieldSuppliesView.test.ts holds.
 */
export function FieldSuppliesView(props: {
  rows: readonly PresetRow<'field_supply_map'>[];
  noteTypes: readonly NoteTypeRow[];
  items: readonly PresetRow<'item'>[];
  histories: Readonly<Record<string, PresetEvent[]>>;
  done?: string;
  refused?: string;
  preset?: string;
}): React.ReactNode {
  void props;
  throw new Error('P4-field-supplies');
}
