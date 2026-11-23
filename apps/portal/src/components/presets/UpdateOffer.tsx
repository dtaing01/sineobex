import type { PresetKind, PresetRow } from '@/lib/presets';
import { OfferForm } from './OfferForm';
import styles from './presets.module.css';
import { ScrollTable } from './ScrollTable';
import { reviewRows, type Described, type ReviewRow } from './review';

/** A field's value in words (review.ts): a text, or a list of lines, or None for a list of none. */
export function DescribedValue({ value }: { value: Described }) {
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

/**
 * The copy's body beside the update's, every field of the kind, each the update changes marked, its
 * words whole in a ScrollTable. `id` is the preset's, for the caption's ID.
 */
export function ReviewTable({ rows, name, id }: { rows: readonly ReviewRow[]; name: string; id: string }) {
  return (
    <ScrollTable caption={`review-${id}`}>
      <table className={`px-table ${styles.review}`}>
        <caption id={`review-${id}`}>What taking the update changes in {name}</caption>
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
                <DescribedValue value={row.now} />
              </td>
              <td>
                <DescribedValue value={row.update} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/**
 * The update offer of 8.1, for one preset the page shows: "Sineobex updated this preset. Your
 * edited copy hasn’t changed." (the second sentence only of a copy the team edited), with Review,
 * the list row's `update.body` against its current body, rank included, and Replace with the new
 * version; or, for an update that changes a field fixed at creation, Add as new with its sentence.
 * A take sends back the version shown and the update's platform version, so only what was reviewed
 * is taken (5.1).
 *
 * Place it for every preset the page shows, removed ones too, whether or not one is on offer: it
 * draws nothing while none is, and a take refused stale stays to say so when the page is read
 * again. A removed copy is offered its update as a new preset only, since the API refuses it in
 * place (`archived`) and takes it as new from a removed copy (5.1): so a copy that can't be
 * restored (its name taken since, say) can still take Sineobex's version. `names` names the team's
 * presets the bodies name (an item's category, a line's item), from the lists the page read;
 * `back` is the page to land on after an update taken as new, when not this one.
 */
export function UpdateOffer({
  kind,
  preset,
  names,
  back,
  headingLevel = 2,
}: {
  kind: PresetKind;
  preset: Pick<PresetRow, 'id' | 'name' | 'state' | 'version' | 'customized' | 'body' | 'update'>;
  names: Readonly<Record<string, string>>;
  back?: string;
  headingLevel?: 2 | 3;
}) {
  const { update } = preset;
  const removed = preset.state === 'archived';
  return (
    <OfferForm
      kind={kind}
      id={preset.id}
      name={preset.name}
      version={preset.version}
      offer={
        update
          ? {
              platformVersion: update.platformVersion,
              asNew: removed || update.changesFixed.length > 0,
              customized: preset.customized,
              removed,
            }
          : null
      }
      review={
        update ? (
          <ReviewTable
            rows={reviewRows(kind, preset.body, update.body, names)}
            name={preset.name}
            id={preset.id}
          />
        ) : null
      }
      {...(back ? { back } : {})}
      headingLevel={headingLevel}
    />
  );
}
