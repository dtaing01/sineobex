import type { Metadata } from 'next';
import { listNoteTypes, noteTypeHistory } from '@/lib/presets';
import { NoteTypesView } from './NoteTypesView';

export const metadata: Metadata = { title: 'Note types' };

/** A note type's key, as 0017 allows it: what the address may name, never a title. */
const KEY = /^[a-z][a-z0-9_]{1,60}$/;

/**
 * Team setup's note types (phase 5 design 8.1). Only team.manage_presets opens it: the API refuses
 * anyone else, logged once, and the portal sends them home as from every refused page. Reading the
 * list and each history is not audited (PL-13): definitions hold no patient data.
 */
export default async function NoteTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === 'string' ? v : undefined;
  };
  const noteType = one('noteType');
  // The list first and alone: a refused visit is refused there, before any history is asked.
  const rows = await listNoteTypes();
  const active = rows.filter((r) => r.state === 'active');
  const histories = Object.fromEntries(
    await Promise.all(active.map(async (r) => [r.key, await noteTypeHistory(r.key)] as const)),
  );
  return (
    <NoteTypesView
      rows={rows}
      histories={histories}
      done={one('done')}
      refused={one('refused')}
      noteType={noteType && KEY.test(noteType) ? noteType : undefined}
    />
  );
}
