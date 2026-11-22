import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { itemChoices, namesOf } from '@/components/presets/order';
import { listPresets, presetHistory } from '@/lib/presets';
import { BundleView } from './BundleView';

// The screen's name only: a bundle's name is the team's own text, kept out of the tab's title.
export const metadata: Metadata = { title: 'Bundle' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One bundle of Team setup (phase 5 design 8.1), by its ID. Only team.manage_presets opens it: the
 * API refuses anyone else at the list, logged once, and the portal sends them home as from every
 * refused page. An ID that is none of the team's bundles is no page. Reading is not audited (PL-13).
 */
export default async function BundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const one = (key: string) => {
    const v = query[key];
    return typeof v === 'string' ? v : undefined;
  };
  // The list first and alone: a refused visit is refused there, before anything else is asked.
  const bundle = (await listPresets('bundle')).find((b) => b.id === id.toLowerCase());
  if (!bundle) notFound();
  const [items, categories, history] = await Promise.all([
    listPresets('item'),
    listPresets('order_category'),
    presetHistory('bundle', bundle.id),
  ]);
  const preset = one('preset');
  return (
    <BundleView
      bundle={bundle}
      items={itemChoices(items, categories)}
      names={namesOf(items)}
      history={history}
      done={one('done')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
