import type { Metadata } from 'next';
import { Suspense } from 'react';
import { readHub } from '@/lib/presets';
import { AreaCards, AreasLoading } from './AreaCards';

export const metadata: Metadata = { title: 'Presets' };

/** The cards, read once the page's heading is on screen: the loading state stands in until then. */
async function Areas() {
  return <AreaCards areas={await readHub()} />;
}

/**
 * Team setup's hub (phase 5 design 8.1): one card per area. Only team.manage_presets opens it: the
 * API refuses anyone else, and the portal sends them home as it does from every refused page.
 */
export default function PresetsPage() {
  return (
    <>
      <h1 className="px-h1">Presets</h1>
      <p className="px-lede">
        The lists your team’s phones offer when staff chart, give out supplies and flag patients. Each change
        asks for a reason, is kept in its history, and reaches the phones the next time they sync.
      </p>
      <Suspense fallback={<AreasLoading />}>
        <Areas />
      </Suspense>
    </>
  );
}
