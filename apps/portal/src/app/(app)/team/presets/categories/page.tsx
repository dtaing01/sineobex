import type { Metadata } from 'next';
import { listPresets, presetHistory } from '@/lib/presets';
import { CategoriesView } from './CategoriesView';

export const metadata: Metadata = { title: 'Categories' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Team setup's categories (phase 5 design 8.1). Only team.manage_presets opens it: the API refuses
 * anyone else, logged once, and the portal sends them home as from every refused page. Reading the
 * list and each history is not audited (PL-13): presets hold no patient data.
 */
export default async function CategoriesPage({
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
  // The list first and alone: a refused visit is refused there, before any history is asked.
  const rows = await listPresets('order_category');
  const active = rows.filter((r) => r.state === 'active');
  const histories = Object.fromEntries(
    await Promise.all(active.map(async (r) => [r.id, await presetHistory('order_category', r.id)] as const)),
  );
  return (
    <CategoriesView
      rows={rows}
      histories={histories}
      done={one('done')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
