import Link from 'next/link';
import type { HubArea } from '@/lib/presets';

/** "4 categories", "1 bag". */
function countText(count: number, [one, many]: HubArea['noun']): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What the hub shows while the cards are read: its heading is on screen already. */
export function AreasLoading() {
  return (
    <p role="status" className="px-panel">
      Loading presets…
    </p>
  );
}

/**
 * The hub's cards (phase 5 design 8.1): each area of Team setup with how many presets it holds on
 * the team's list, and "Update available" when Sineobex offers a newer version of one of them. A
 * list the API could not answer says so on its own card; the link still opens its page.
 */
export function AreaCards({ areas }: { areas: readonly HubArea[] }) {
  return (
    <ul className="px-cards">
      {areas.map((area) => (
        <li key={area.key} className="px-card">
          <h2>
            <Link href={area.href}>{area.title}</Link>
          </h2>
          {area.loaded ? (
            <>
              <p>{countText(area.count, area.noun)}</p>
              {area.updateAvailable && (
                <p>
                  <span className="sx-pill sx-pill--info">Update available</span>
                </p>
              )}
            </>
          ) : (
            <p className="px-alert px-alert--error">
              This list couldn’t be loaded. Reload the page to try again.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
