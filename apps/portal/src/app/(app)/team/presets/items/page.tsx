import type { Metadata } from 'next';
import { listPresets } from '@/lib/presets';
import { ItemsView } from './ItemsView';

export const metadata: Metadata = { title: 'Items' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Team setup's items (phase 5 design 8.1). Only team.manage_presets opens it: the API refuses
 * anyone else, logged once, and the portal sends them home as from every refused page. Reading the
 * lists is not audited (PL-13): presets hold no patient data.
 */
export default async function ItemsPage({
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
  // The list first and alone: a refused visit is refused there, before the categories are asked.
  const items = await listPresets('item');
  const categories = await listPresets('order_category');
  return (
    <ItemsView
      items={items}
      categories={categories}
      done={one('done')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
