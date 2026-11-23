import { formatDateTime } from '@/lib/labels';
import { presetHistory, type PresetEvent, type PresetKind } from '@/lib/presets';
import styles from './presets.module.css';
import { ScrollTable } from './ScrollTable';

/** Each act the history keeps (0023), as a person reads it. */
const ACTS: Readonly<Record<PresetEvent['act'], string>> = {
  created: 'Added',
  updated: 'Edited',
  archived: 'Removed',
  restored: 'Restored',
  update_taken: 'Sineobex’s update taken',
  reordered: 'Moved in its list',
  installed: 'Added by Sineobex',
  platform_updated: 'Updated by Sineobex',
};

/**
 * A preset's history as the history route answers it (phase 5 design 7, 8.1): every act, oldest
 * first, with who, when, whether the version is the platform's or the team's, and the reason.
 * The platform installer acts with no person and no reason; a person who takes a platform version
 * is named, with theirs. A reason is admin text, shown here and kept nowhere else (9).
 *
 * `flat` draws it without a panel of its own, for a page that places it in the preset's own panel
 * (a list page, such as Categories, where each preset is a panel): a panel in a panel leaves the
 * table too little width at 320 px. Its words stay whole, in a ScrollTable.
 */
export function HistoryTable({
  events,
  id,
  heading = 'History',
  headingLevel = 2,
  flat = false,
}: {
  events: readonly PresetEvent[];
  id: string;
  heading?: string;
  headingLevel?: 2 | 3;
  flat?: boolean;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby={`history-${id}`} className={flat ? styles.flat : 'px-panel'}>
      <Heading id={`history-${id}`} className={headingLevel === 2 ? 'px-h2' : 'px-h3'}>
        {heading}
      </Heading>
      <ScrollTable caption={`history-${id}-caption`}>
        <table className={`px-table ${styles.review}`}>
          <caption id={`history-${id}-caption`} className="sr-only">
            Every change to it, oldest first
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Who</th>
              <th scope="col">Whose version</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={`${e.version}:${e.at}:${i}`}>
                <td>{formatDateTime(e.at)}</td>
                <td>
                  {ACTS[e.act] ?? e.act}, version {e.version}
                </td>
                <td>{e.by?.displayName ?? 'Sineobex'}</td>
                <td>{e.source === 'platform' ? 'Sineobex’s' : 'Your team’s'}</td>
                <td>{e.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </section>
  );
}

/** The history of one preset, read when the page draws it; reading it is not audited (PL-13). */
export async function VersionHistory({
  kind,
  id,
  heading,
  headingLevel,
  flat,
}: {
  kind: PresetKind;
  id: string;
  heading?: string;
  headingLevel?: 2 | 3;
  flat?: boolean;
}) {
  const events = await presetHistory(kind, id);
  return (
    <HistoryTable
      events={events}
      id={id}
      {...(heading ? { heading } : {})}
      {...(headingLevel ? { headingLevel } : {})}
      {...(flat ? { flat } : {})}
    />
  );
}
