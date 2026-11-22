import type { PresetKind, PresetRow } from '@/lib/presets';
import { OfferForm } from './OfferForm';
import styles from './presets.module.css';
import { reviewRows, type Described, type ReviewRow } from './review';

function Value({ value }: { value: Described }) {
  if (typeof value === 'string') return value;
  if (value.length === 0) return 'None';
  return (
    <ul className="px-list">
      {value.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

/** The copy's body beside the update's, every field of the kind, each the update changes marked. */
export function ReviewTable({ rows, name }: { rows: readonly ReviewRow[]; name: string }) {
  return (
    <table className={`px-table ${styles.review}`}>
      <caption>What taking the update changes in {name}</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Your copy now</th>
          <th scope="col">Sineobex’s new version</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field}>
            <th scope="row">
              {row.label}
              {row.changes && (
                <>
                  {' '}
                  <span className="sx-pill sx-pill--info">Changes</span>
                </>
              )}
            </th>
            <td>
              <Value value={row.now} />
            </td>
            <td>
              <Value value={row.update} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The update offer of 8.1, for one preset the page shows: "Sineobex updated this preset. Your
 * edited copy hasn’t changed.", with Review, the list row's `update.body` against its current body,
 * rank included, and Replace with the new version; or, for an update that changes a field fixed at
 * creation, Add as new with its sentence. A take sends back the version shown and the update's
 * platform version, so only what was reviewed is taken (5.1).
 *
 * Place it for every active preset the page shows, whether or not one is on offer: it draws
 * nothing while none is, and a take refused stale stays to say so when the page is read again.
 * A removed preset is offered nothing: it is restored first. `names` names the team's presets the
 * bodies name (an item's category, a line's item), from the lists the page read; `back` is the page
 * to land on after an update taken as new, when not this one.
 */
export function UpdateOffer({
  kind,
  preset,
  names,
  back,
  headingLevel = 2,
}: {
  kind: PresetKind;
  preset: Pick<PresetRow, 'id' | 'name' | 'state' | 'version' | 'body' | 'update'>;
  names: Readonly<Record<string, string>>;
  back?: string;
  headingLevel?: 2 | 3;
}) {
  if (preset.state !== 'active') return null;
  const { update } = preset;
  return (
    <OfferForm
      kind={kind}
      id={preset.id}
      name={preset.name}
      version={preset.version}
      offer={
        update ? { platformVersion: update.platformVersion, asNew: update.changesFixed.length > 0 } : null
      }
      review={
        update ? (
          <ReviewTable rows={reviewRows(kind, preset.body, update.body, names)} name={preset.name} />
        ) : null
      }
      {...(back ? { back } : {})}
      headingLevel={headingLevel}
    />
  );
}
