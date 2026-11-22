import type { Metadata } from 'next';
import { itemChoices, namesOf } from '@/components/presets/order';
import { listPresets, presetHistory, teamSettings } from '@/lib/presets';
import { ConditionSuppliesView } from './ConditionSuppliesView';

export const metadata: Metadata = { title: 'Condition supplies' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = 'condition_supply_map';

/**
 * Team setup's condition supplies (phase 5 design 8.1). Only team.manage_presets opens it: the API
 * refuses anyone else, logged once, and the portal sends them home as from every refused page.
 * Reading the lists and each history is not audited (PL-13): presets hold no patient data.
 */
export default async function ConditionSuppliesPage({
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
  const [items, categories, settings, histories] = await Promise.all([
    listPresets('item'),
    listPresets('order_category'),
    teamSettings(),
    Promise.all(active.map(async (m) => [m.id, await presetHistory(KIND, m.id)] as const)),
  ]);
  return (
    <ConditionSuppliesView
      maps={maps}
      histories={Object.fromEntries(histories)}
      settings={settings?.row ?? null}
      settingsHistory={settings?.history ?? []}
      items={itemChoices(items, categories)}
      names={namesOf(items)}
      done={one('done')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
