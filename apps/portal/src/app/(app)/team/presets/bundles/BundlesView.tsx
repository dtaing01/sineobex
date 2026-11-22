import Link from 'next/link';
import { Fragment } from 'react';
import { addBundleAction } from '@/app/actions/presets-bundles';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import type { ItemChoice } from '@/components/presets/ItemLines';
import { aToZ } from '@/components/presets/order';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import styles from '@/components/presets/presets.module.css';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RemovedList } from '@/components/presets/RemovedList';
import { BundleFields, bundleSummary, type Bundle } from './BundleFields';

const KIND = 'bundle';

/** Add a bundle of the team's own: its name, its tag, its lines and its prompt, with a reason. */
function AddBundle({ items }: { items: readonly ItemChoice[] }) {
  return (
    <section aria-labelledby="add-bundle" className="px-panel">
      <h2 id="add-bundle" className="px-h2">
        Add a bundle
      </h2>
      <ActionForm id="new-bundle" action={addBundleAction} label="Add a bundle">
        <BundleFields items={items} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add bundle</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * Bundles (phase 5 design 8.1; PRD main 439-447): the team's bundles A to Z, each opening its own
 * page with a line of what it is and "Update available" when Sineobex offers one; Add a bundle; the
 * Removed list with Restore. `bundles` is the API's list, archived ones included, and `items` the
 * items a new bundle's lines may name.
 */
export function BundlesView({
  bundles,
  items,
  done,
  preset,
}: {
  bundles: readonly Bundle[];
  items: readonly ItemChoice[];
  done?: string;
  preset?: string;
}) {
  const active = aToZ(bundles.filter((b) => b.state === 'active'));
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Bundles</h1>
      <p className="px-lede">
        Items staff give together, such as everything for basic wound care. Open a bundle to change it, remove
        it or see its history.
      </p>
      <PresetNotice done={done} preset={preset} presets={bundles} />
      {active.length === 0 ? (
        <p className="px-panel">No bundle is on your team’s list. Add one below.</p>
      ) : (
        <section aria-labelledby="bundle-list" className="px-panel">
          <h2 id="bundle-list" className="px-h2">
            Your team’s bundles
          </h2>
          <ul className={styles.entries}>
            {active.map((b) => (
              <li key={b.id}>
                <span className={styles.entryName}>
                  <Link href={`/team/presets/bundles/${b.id}`}>{b.name}</Link>
                  {b.updateOnOffer && <span className="sx-pill sx-pill--info">Update available</span>}
                </span>
                <span className="sx-help">{bundleSummary(b.body)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <AddBundle items={items} />
      <RemovedList kind={KIND} presets={bundles} />
    </Fragment>
  );
}
