import type { Metadata } from 'next';
import { itemChoices } from '@/components/presets/order';
import { listPresets } from '@/lib/presets';
import { BundlesView } from './BundlesView';

export const metadata: Metadata = { title: 'Bundles' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Team setup's bundles (phase 5 design 8.1). Only team.manage_presets opens it: the API refuses
 * anyone else, logged once, and the portal sends them home as from every refused page. Reading the
 * lists is not audited (PL-13): presets hold no patient data.
 */
export default async function BundlesPage({
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
  // The list first and alone: a refused visit is refused there, before the items are asked.
  const bundles = await listPresets('bundle');
  const [items, categories] = await Promise.all([listPresets('item'), listPresets('order_category')]);
  return (
    <BundlesView
      bundles={bundles}
      items={itemChoices(items, categories)}
      done={one('done')}
      refused={one('refused')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
