import type { Metadata } from 'next';
import { listNoteTypes, listPresets, presetHistory } from '@/lib/presets';
import { FieldSuppliesView } from './FieldSuppliesView';

export const metadata: Metadata = { title: 'Field supplies' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = 'field_supply_map';

/**
 * Team setup's field supplies (phase 5 design 8.1). Only team.manage_presets opens it: the API
 * refuses anyone else, logged once, and the portal sends them home as from every refused page. The
 * note types come from their own list (GET /v1/admin/note-types), so each mapping is named in the
 * words of its note type's current version. Reading the lists and each history is not audited
 * (PL-13): presets hold no patient data.
 */
export default async function FieldSuppliesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === 'string' ? v : undefined;
  };
  const preset = one('preset');
  // The list first and alone: a refused visit is refused there, before anything else is asked.
  const maps = await listPresets(KIND);
  const active = maps.filter((m) => m.state === 'active');
  const [noteTypes, items, categories, histories] = await Promise.all([
    listNoteTypes(),
    listPresets('item'),
    listPresets('order_category'),
    Promise.all(active.map(async (m) => [m.id, await presetHistory(KIND, m.id)] as const)),
  ]);
  return (
    <FieldSuppliesView
      rows={maps}
      noteTypes={noteTypes}
      items={items}
      categories={categories}
      histories={Object.fromEntries(histories)}
      done={one('done')}
      refused={one('refused')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
