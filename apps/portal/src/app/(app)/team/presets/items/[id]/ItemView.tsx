import Link from 'next/link';
import { Fragment } from 'react';
import { saveItemAction } from '@/app/actions/presets-items';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import { CheckField } from '@/components/presets/CheckField';
import { FixedFact } from '@/components/presets/FixedFact';
import { FreeText } from '@/components/presets/FreeText';
import { namesOf } from '@/components/presets/order';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RestorePresetForm } from '@/components/presets/RemovedList';
import { RemoveForm } from '@/components/presets/RemoveForm';
import { describeField } from '@/components/presets/review';
import { UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { PresetEvent } from '@/lib/presets';
import { usedBy } from '@/lib/refusals';
import { CategorySelect, ResultNow, type CategoryChoice } from '../ItemFields';
import type { Category, Item } from '../items';
import { categoryChoices, COUNTED_IN_HINT, LABELS, LOT_HINT, MEDICAL_HINT } from '../ItemsView';

const KIND = 'item';
const LIST = '/team/presets/items';

/**
 * The item's form: its name, its category, Medical, Capture lot and expiry, and a result's options
 * or unit, at the version shown, with a reason. What it is counted in and the kind of result it
 * records are shown, fixed at creation (4.4).
 */
function EditItem({ item, categories }: { item: Item; categories: readonly CategoryChoice[] }) {
  return (
    <section aria-labelledby="edit-item-heading" className="px-panel">
      <h2 id="edit-item-heading" className="px-h2">
        Edit
      </h2>
      <ActionForm id="edit-item" action={saveItemAction} label={`Edit ${item.name}`}>
        <input type="hidden" name="id" value={item.id} />
        <BaseVersion version={item.version} />
        <FreeText name="name" label={LABELS.name} defaultValue={item.body.name} />
        <CategorySelect categories={categories} defaultValue={item.body.categoryId} />
        <FixedFact name="unit" label={LABELS.unit} value={item.body.unit} hint={COUNTED_IN_HINT} />
        <CheckField
          name="medical"
          label={LABELS.medical}
          hint={MEDICAL_HINT}
          defaultChecked={item.body.medical}
        />
        <CheckField
          name="captureLot"
          label={LABELS.captureLot}
          hint={LOT_HINT}
          defaultChecked={item.body.captureLot}
        />
        <ResultNow
          result={item.body.result}
          described={String(describeField(KIND, 'result', item.body.result, {}))}
        />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * An item's own page (phase 5 design 8.1): where it is and what uses it; Sineobex's update when
 * one is on offer; its form; Remove; and its history. A removed item says so and offers Restore
 * instead. Remove and an update taken land on the Items list, which says what was done; a restore
 * lands here.
 */
export function ItemView({
  item,
  categories,
  history,
  done,
  preset,
}: {
  item: Item;
  categories: readonly Category[];
  history: readonly PresetEvent[];
  done?: string;
  preset?: string;
}) {
  const names = namesOf(categories);
  const category = names[item.body.categoryId] ?? 'a category no longer on your team’s list';
  const used = usedBy(item.referencedBy);
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <p>
        <Link href={LIST}>← Items</Link>
      </p>
      <h1 className="px-h1">{item.name}</h1>
      <p className="px-lede">
        In {category}, counted in {item.body.unit}. {used ? `Used by ${used}.` : 'Nothing uses it yet.'}
      </p>
      <PresetNotice done={done} preset={preset} presets={[item]} />
      {item.state === 'active' ? (
        <>
          <UpdateOffer kind={KIND} preset={item} names={names} back={LIST} />
          <EditItem item={item} categories={categoryChoices(categories)} />
          <section aria-labelledby="remove-item" className="px-panel">
            <h2 id="remove-item" className="px-h2">
              Remove
            </h2>
            <p>
              A removed item isn’t offered for new work. It keeps its history, and can be restored from the
              Items list.
            </p>
            {/* The API refuses an item a bundle, a mapping or a bag still names, and says how many. */}
            <RemoveForm kind={KIND} preset={item} back={LIST} />
          </section>
        </>
      ) : (
        <section aria-labelledby="removed-item" className="px-panel">
          <h2 id="removed-item" className="px-h2">
            Removed
          </h2>
          <p>This item isn’t offered for new work. Restore it to offer it again.</p>
          <RestorePresetForm kind={KIND} preset={item} />
        </section>
      )}
      <HistoryTable events={history} id={item.id} />
    </Fragment>
  );
}
