import { Fragment } from 'react';
import { addItemAction } from '@/app/actions/presets-items';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { CheckField } from '@/components/presets/CheckField';
import { FreeText } from '@/components/presets/FreeText';
import { inPlace, namesOf } from '@/components/presets/order';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RemovedList } from '@/components/presets/RemovedList';
import { BEHAVIOURS, FIELD_LABELS } from '@/components/presets/review';
import { CategorySelect, NewResult, type CategoryChoice } from './ItemFields';
import { ItemList } from './ItemList';
import { itemGroups, type Category, type Item } from './items';

const KIND = 'item';
export const LABELS = FIELD_LABELS.item;

/** 8.1's sentence under Counted in (PRD main 127), word for word. */
export const COUNTED_IN_HINT =
  '1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later.';

/** What ticking Medical means, and validatePreset's rule for it (design 4.4), in words: the API holds items to it. */
export const MEDICAL_HINT =
  'Offered only at a Medical visit. An item in a category that holds medications or tests is always Medical.';

export const LOT_HINT = 'Staff record its lot and expiry date each time they give one.';

/**
 * The categories an item may be in, in their place in the list, each with what it holds; an
 * archived one only for an item already in it (CategorySelect).
 */
export function categoryChoices(categories: readonly Category[]): CategoryChoice[] {
  return inPlace(categories).map((c) => ({
    id: c.id,
    name: c.name,
    // A kind of category a later API knows is named as it is sent.
    holds: (BEHAVIOURS as Readonly<Record<string, string>>)[c.body.behaviour] ?? c.body.behaviour,
    ...(c.state === 'archived' ? { removed: true } : {}),
  }));
}

/**
 * Add an item of the team's own: its name, category, what it is counted in, Medical, Capture lot
 * and expiry, and for a test the result it records. What it is counted in and the kind of result
 * are fixed from then on.
 */
function AddItem({ categories }: { categories: readonly CategoryChoice[] }) {
  return (
    <section aria-labelledby="add-item" className="px-panel">
      <h2 id="add-item" className="px-h2">
        Add an item
      </h2>
      <ActionForm id="new-item" action={addItemAction} label="Add an item">
        <FreeText name="name" label={LABELS.name} />
        <CategorySelect categories={categories} />
        <FreeText name="unit" label={LABELS.unit} hint={COUNTED_IN_HINT} />
        <CheckField name="medical" label={LABELS.medical} hint={MEDICAL_HINT} />
        <CheckField name="captureLot" label={LABELS.captureLot} hint={LOT_HINT} />
        <NewResult />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add item</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * Items (phase 5 design 8.1): the team's items grouped by category, A to Z, each opening its own
 * page, with a search box that runs in the page; Add an item; the Removed list with Restore. `items`
 * and `categories` are the API's lists, archived ones included.
 */
export function ItemsView({
  items,
  categories,
  done,
  preset,
}: {
  items: readonly Item[];
  categories: readonly Category[];
  done?: string;
  preset?: string;
}) {
  const groups = itemGroups(items, categories);
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Items</h1>
      <p className="px-lede">
        The supplies, medications and tests staff give and record, by category. Open an item to change it,
        remove it or see its history.
      </p>
      <PresetNotice done={done} preset={preset} presets={items} />
      {groups.length === 0 ? (
        <p className="px-panel">No item is on your team’s list. Add one below.</p>
      ) : (
        <ItemList groups={groups} />
      )}
      <AddItem categories={categoryChoices(categories)} />
      {/* A removed item's update is reviewed against its category's name. */}
      <RemovedList kind={KIND} presets={items} names={namesOf(categories)} />
    </Fragment>
  );
}
