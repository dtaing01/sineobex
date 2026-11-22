import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listPresets, presetHistory } from '@/lib/presets';
import { FlagView } from './FlagView';

// The screen's name only: a flag's name is the team's own text, kept out of the tab's title.
export const metadata: Metadata = { title: 'Flag' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One flag of Team setup (phase 5 design 8.1), by its ID. Only team.manage_presets opens it: the API
 * refuses anyone else at the list, logged once, and the portal sends them home as from every
 * refused page. An ID that is none of the team's flags is no page. Reading is not audited (PL-13).
 */
export default async function FlagPage({
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
  // The list first and alone: a refused visit is refused there, before the history is asked.
  const flag = (await listPresets('flag')).find((f) => f.id === id.toLowerCase());
  if (!flag) notFound();
  const history = await presetHistory('flag', flag.id);
  const preset = one('preset');
  return (
    <FlagView
      flag={flag}
      history={history}
      done={one('done')}
      preset={preset && UUID.test(preset) ? preset : undefined}
    />
  );
}
