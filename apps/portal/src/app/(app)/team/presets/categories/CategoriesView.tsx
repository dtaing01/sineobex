import { Fragment } from 'react';
import { addCategoryAction, saveCategoryAction } from '@/app/actions/presets-categories';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import { ChoiceGroup } from '@/components/presets/ChoiceGroup';
import { Disclosure } from '@/components/presets/Disclosure';
import { FreeText } from '@/components/presets/FreeText';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RemovedList } from '@/components/presets/RemovedList';
import { RemoveForm } from '@/components/presets/RemoveForm';
import { BEHAVIOURS, FIELD_LABELS } from '@/components/presets/review';
import { UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { CategoryBody, PresetEvent, PresetRow } from '@/lib/presets';
import { usedBy } from '@/lib/refusals';

export type Category = PresetRow<'order_category'>;

const KIND = 'order_category';
const LABELS = FIELD_LABELS.order_category;

/**
 * What choosing each means for the category's items: validatePreset's rules (design 4.4), said
 * before a choice that can't be changed later. The API holds every item to them.
 */
const HOLDS_HINTS: Readonly<Record<CategoryBody['behaviour'], string>> = {
  supply: 'Its items can be Medical or Non-Medical.',
  medication: 'Its items are always Medical.',
  lab: 'Its items are always Medical, and each records a result.',
};

const HOLDS = (Object.keys(BEHAVIOURS) as CategoryBody['behaviour'][]).map((value) => ({
  value,
  label: BEHAVIOURS[value],
  hint: HOLDS_HINTS[value],
}));

const PLACE_HINT = 'A whole number. Categories are listed from the lowest number up.';

// By place, then by name as the API sorts names, so two categories at one place keep one order.
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** The team's categories as the list shows them: by place in the list, lowest first. */
export function inOrder(rows: readonly Category[]): Category[] {
  return [...rows].sort(
    (a, b) =>
      a.body.sort - b.body.sort || byName.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

// The highest place the body takes (packages/presets/src/schemas.ts): a list that ends there adds
// a tie at the end, which the name settles.
const LAST_PLACE = 1_000_000;

/** Where a new category goes: after every category the team holds, removed ones too. */
export function nextPlace(rows: readonly Category[]): number {
  return Math.min(LAST_PLACE, Math.max(0, ...rows.map((r) => r.body.sort)) + 10);
}

/** Rename a category or move it in the list, with a reason; what it holds can't change. */
function EditCategoryForm({ row }: { row: Category }) {
  return (
    <ActionForm id={`edit-${row.id}`} action={saveCategoryAction} label={`Edit ${row.name}`}>
      <input type="hidden" name="id" value={row.id} />
      <BaseVersion version={row.version} />
      <FreeText name="name" label={LABELS.name} defaultValue={row.body.name} />
      <TextField
        name="sort"
        label={LABELS.sort}
        hint={PLACE_HINT}
        required
        inputMode="numeric"
        autoComplete="off"
        defaultValue={String(row.body.sort)}
      />
      <ReasonBox />
      <div className="px-actions">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One category: what it holds, its place, what uses it, its acts, any update, and its history. */
function CategorySection({ row, history }: { row: Category; history: readonly PresetEvent[] }) {
  const heading = `category-${row.id}`;
  const used = usedBy(row.referencedBy);
  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {row.name}
      </h2>
      <dl className="px-facts">
        <div>
          <dt>{LABELS.behaviour}</dt>
          {/* A kind of category a later API knows is named as it is sent. */}
          <dd>
            {(BEHAVIOURS as Readonly<Record<string, string>>)[row.body.behaviour] ?? row.body.behaviour}
          </dd>
        </div>
        <div>
          <dt>{LABELS.sort}</dt>
          <dd>{row.body.sort}</dd>
        </div>
        <div>
          <dt>Used by</dt>
          <dd>{used || 'Nothing yet'}</dd>
        </div>
      </dl>
      <Disclosure id={`edit-${row.id}-form`} label="Edit" name={row.name}>
        <EditCategoryForm row={row} />
      </Disclosure>
      {/* The API refuses a category items still use, and says how many: the page asks nothing first. */}
      <RemoveForm kind={KIND} preset={row} />
      <UpdateOffer kind={KIND} preset={row} names={{}} headingLevel={3} />
      <HistoryTable events={history} id={row.id} heading={`History of ${row.name}`} headingLevel={3} flat />
    </section>
  );
}

/** Add a category of the team's own: a name and what it holds, which is fixed from then on. */
function AddCategory({ place }: { place: number }) {
  return (
    <section aria-labelledby="add-category" className="px-panel">
      <h2 id="add-category" className="px-h2">
        Add a category
      </h2>
      <ActionForm id="new-category" action={addCategoryAction} label="Add a category">
        <FreeText name="name" label={LABELS.name} />
        <ChoiceGroup
          name="behaviour"
          legend={LABELS.behaviour}
          hint="What it holds can’t be changed later."
          options={HOLDS}
        />
        <p className="sx-help">It goes at the end of the list. Edit it to move it.</p>
        <input type="hidden" name="sort" value={place} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add category</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * Categories (phase 5 design 8.1; PRD main 104): OTC, Rx, Labs, Supplies and the team's own, each
 * with what it holds, its place in the list and what uses it, Edit, Remove, Sineobex's update when
 * one is on offer, and its history; Add a category; the Removed list with Restore. `rows` is the
 * API's list, archived ones included, and `histories` each active one's history.
 */
export function CategoriesView({
  rows,
  histories,
  done,
  preset,
}: {
  rows: readonly Category[];
  histories: Readonly<Record<string, readonly PresetEvent[]>>;
  done?: string;
  preset?: string;
}) {
  const active = inOrder(rows.filter((r) => r.state === 'active'));
  // A new view starts afresh after each act the page is sent back to: Next keeps client state, an
  // open form among it, across visits to the same page, and each act's address names its preset.
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Categories</h1>
      <p className="px-lede">
        Every item belongs to a category, and staff find items under them. Each category holds supplies,
        medications or tests.
      </p>
      <PresetNotice done={done} preset={preset} presets={rows} />
      {active.length === 0 ? (
        <p className="px-panel">No category is on your team’s list. Add one below.</p>
      ) : (
        active.map((row) => <CategorySection key={row.id} row={row} history={histories[row.id] ?? []} />)
      )}
      <AddCategory place={nextPlace(rows)} />
      <RemovedList kind={KIND} presets={rows} />
    </Fragment>
  );
}
