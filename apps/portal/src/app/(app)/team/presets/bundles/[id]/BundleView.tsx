import Link from 'next/link';
import { Fragment } from 'react';
import { saveBundleAction } from '@/app/actions/presets-bundles';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import type { ItemChoice } from '@/components/presets/ItemLines';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RestorePresetForm } from '@/components/presets/RemovedList';
import { RemoveForm } from '@/components/presets/RemoveForm';
import { UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { PresetEvent } from '@/lib/presets';
import { BundleFields, bundleSummary, type Bundle } from '../BundleFields';

const KIND = 'bundle';
const LIST = '/team/presets/bundles';

/** The bundle's form: its name, its tag, its lines and its prompt, at the version shown, with a reason. */
function EditBundle({ bundle, items }: { bundle: Bundle; items: readonly ItemChoice[] }) {
  return (
    <section aria-labelledby="edit-bundle-heading" className="px-panel">
      <h2 id="edit-bundle-heading" className="px-h2">
        Edit
      </h2>
      <ActionForm id="edit-bundle" action={saveBundleAction} label={`Edit ${bundle.name}`}>
        <input type="hidden" name="id" value={bundle.id} />
        <BaseVersion version={bundle.version} />
        <BundleFields items={items} bundle={bundle.body} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * A bundle's own page (phase 5 design 8.1; PRD main 439-447): what it is; Sineobex's update when one
 * is on offer, its review naming each line's item; its form; Remove; and its history. A removed
 * bundle says so and offers Restore instead, which the API refuses for a bundle that would come
 * back Non-Medical holding a medication, in 8.1's words. Remove and an update taken land on the
 * Bundles list, which says what was done; a restore lands here. `names` names every item a line
 * may name, removed ones too, for the review.
 */
export function BundleView({
  bundle,
  items,
  names,
  history,
  done,
  preset,
}: {
  bundle: Bundle;
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
  history: readonly PresetEvent[];
  done?: string;
  preset?: string;
}) {
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <p>
        <Link href={LIST}>← Bundles</Link>
      </p>
      <h1 className="px-h1">{bundle.name}</h1>
      <p className="px-lede">{bundleSummary(bundle.body)}</p>
      <PresetNotice done={done} preset={preset} presets={[bundle]} />
      {bundle.state === 'active' ? (
        <>
          <UpdateOffer kind={KIND} preset={bundle} names={names} back={LIST} />
          <EditBundle bundle={bundle} items={items} />
          <section aria-labelledby="remove-bundle" className="px-panel">
            <h2 id="remove-bundle" className="px-h2">
              Remove
            </h2>
            <p>
              A removed bundle isn’t offered for new work. It keeps its history, and can be restored from the
              Bundles list.
            </p>
            <RemoveForm kind={KIND} preset={bundle} back={LIST} />
          </section>
        </>
      ) : (
        <section aria-labelledby="removed-bundle" className="px-panel">
          <h2 id="removed-bundle" className="px-h2">
            Removed
          </h2>
          <p>This bundle isn’t offered for new work. Restore it to offer it again.</p>
          <RestorePresetForm kind={KIND} preset={bundle} />
        </section>
      )}
      <HistoryTable events={history} id={bundle.id} />
    </Fragment>
  );
}
