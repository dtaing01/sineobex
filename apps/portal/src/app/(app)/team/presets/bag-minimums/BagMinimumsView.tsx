import { Fragment } from 'react';
import {
  addBagAction,
  saveBagAction,
  saveBagTemplateAction,
  switchBagMinimumsAction,
} from '@/app/actions/presets-bags';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import { Disclosure } from '@/components/presets/Disclosure';
import { FreeText } from '@/components/presets/FreeText';
import { ItemLines, type ItemChoice } from '@/components/presets/ItemLines';
import { aToZ } from '@/components/presets/order';
import { isPresetDone, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RemovedList } from '@/components/presets/RemovedList';
import { RemoveForm } from '@/components/presets/RemoveForm';
import { describeField, FIELD_LABELS } from '@/components/presets/review';
import { DescribedValue, UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { Minimum, PresetEvent, PresetRow } from '@/lib/presets';
import { NewBagMinimums, TEMPLATE, type MinimumsSource } from './NewBagMinimums';

export type Bag = PresetRow<'bag'>;
export type Settings = PresetRow<'settings'>;

const KIND = 'bag';
const LABELS = FIELD_LABELS.bag;

/** The minimums a bag, or the template, holds at most (packages/presets/src/schemas.ts). */
const MOST_MINIMUMS = 200;

/** 8.1's words for the team's switch while it is off. */
export const OFF = 'Bag minimums are off. Nobody is reminded to restock.';
export const ON =
  'Bag minimums are on. When a bag drops below a minimum, after a visit or a count, the team is reminded to restock it, whether or not a route is planned.';

export const MINIMUMS_HINT =
  'The least of each item a bag should hold. While bag minimums are on, the team is reminded to restock a bag that holds fewer.';

const lines = (minimums: readonly Minimum[]) => minimums.map((m) => ({ itemId: m.itemId, quantity: m.min }));

/**
 * Bag minimums on or off for the team (PRD main 477), with a reason: the switch is the team's
 * settings, and the form says which way it turns them.
 */
function Reminders({ settings }: { settings: Settings }) {
  const on = settings.body.bagMinimumsOn;
  return (
    <>
      <h3 className="px-h3">Restock reminders</h3>
      <p>{on ? ON : OFF}</p>
      <ActionForm
        id="bag-minimums-switch"
        action={switchBagMinimumsAction}
        label={on ? 'Turn bag minimums off' : 'Turn bag minimums on'}
      >
        <input type="hidden" name="id" value={settings.id} />
        <BaseVersion version={settings.version} />
        <input type="hidden" name="bagMinimumsOn" value={on ? 'false' : 'true'} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton variant={on ? 'secondary' : 'primary'}>{on ? 'Turn off' : 'Turn on'}</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}

/** The template a new bag's minimums start from (8.1), saved with a reason of its own. */
function Template({ settings, items }: { settings: Settings; items: readonly ItemChoice[] }) {
  return (
    <>
      <h3 className="px-h3">{FIELD_LABELS.settings.newBagMinimums}</h3>
      <p>A new bag starts with these minimums, unless they are copied from another bag.</p>
      <ActionForm id="bag-template" action={saveBagTemplateAction} label="Template for new bags">
        <input type="hidden" name="id" value={settings.id} />
        <BaseVersion version={settings.version} />
        <ItemLines
          name="newBagMinimums"
          legend="Minimums"
          hint={MINIMUMS_HINT}
          items={items}
          lines={lines(settings.body.newBagMinimums)}
          quantity={{ field: 'min', label: 'Minimum' }}
          max={MOST_MINIMUMS}
        />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}

/**
 * The team's settings this page edits: the switch and the template for new bags, each with its own
 * reason; the settings' update when Sineobex offers one, and their history, which holds Condition
 * supplies' edits of them too.
 */
function TeamSettings({
  settings,
  history,
  items,
  names,
}: {
  settings: Settings | null;
  history: readonly PresetEvent[];
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
}) {
  return (
    <section aria-labelledby="team-settings" className="px-panel">
      <h2 id="team-settings" className="px-h2">
        Your team’s settings
      </h2>
      {settings === null ? (
        <p>Your team’s settings can’t be found. Reload the page to try again.</p>
      ) : (
        <>
          <Reminders settings={settings} />
          <Template settings={settings} items={items} />
          <UpdateOffer kind="settings" preset={settings} names={names} headingLevel={3} />
          <HistoryTable
            events={history}
            id={settings.id}
            heading="History of the team’s settings"
            headingLevel={3}
            flat
          />
        </>
      )}
    </section>
  );
}

/** A bag's form: its name and its minimums, at the version shown, with a reason. */
function EditBag({ bag, items }: { bag: Bag; items: readonly ItemChoice[] }) {
  return (
    <ActionForm id={`edit-${bag.id}`} action={saveBagAction} label={`Edit ${bag.name}`}>
      <input type="hidden" name="id" value={bag.id} />
      <BaseVersion version={bag.version} />
      <FreeText name="name" label={LABELS.name} defaultValue={bag.body.name} />
      <ItemLines
        name="minimums"
        legend={LABELS.minimums}
        hint={MINIMUMS_HINT}
        items={items}
        lines={lines(bag.body.minimums)}
        quantity={{ field: 'min', label: 'Minimum' }}
        max={MOST_MINIMUMS}
      />
      <ReasonBox />
      <div className="px-actions">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One bag: its minimums, its acts, any update, and its history. */
function BagSection({
  bag,
  items,
  names,
  history,
}: {
  bag: Bag;
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
  history: readonly PresetEvent[];
}) {
  const heading = `bag-${bag.id}`;
  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {bag.name}
      </h2>
      <dl className="px-facts">
        <div>
          <dt>{LABELS.minimums}</dt>
          <dd>
            <DescribedValue value={describeField(KIND, 'minimums', bag.body.minimums, names)} />
          </dd>
        </div>
      </dl>
      <Disclosure id={`edit-${bag.id}-form`} label="Edit" name={bag.name}>
        <EditBag bag={bag} items={items} />
      </Disclosure>
      <RemoveForm kind={KIND} preset={bag} />
      <UpdateOffer kind={KIND} preset={bag} names={names} headingLevel={3} />
      <HistoryTable events={history} id={bag.id} heading={`History of ${bag.name}`} headingLevel={3} flat />
    </section>
  );
}

/** Add a bag of the team's own (PRD main 930): a name, and minimums filled from Copy from. */
function AddBag({ items, sources }: { items: readonly ItemChoice[]; sources: readonly MinimumsSource[] }) {
  return (
    <section aria-labelledby="add-bag" className="px-panel">
      <h2 id="add-bag" className="px-h2">
        Add a bag
      </h2>
      <ActionForm id="new-bag" action={addBagAction} label="Add a bag">
        <FreeText name="name" label={LABELS.name} hint="Such as Wound care bag or Harm reduction bag." />
        <NewBagMinimums items={items} sources={sources} hint={MINIMUMS_HINT} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add bag</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * Bag minimums (phase 5 design 8.1; PRD main 477, 930), the PRD's name for the page: the team's
 * switch and its template for new bags, both the team's settings; each bag A to Z with its
 * minimums, Edit, Remove, Sineobex's update when one is on offer, and its history; Add bag, filled
 * from the template or a bag chosen under Copy from; the Removed list with Restore. `bags` is the
 * API's list, archived ones included, `histories` each active one's, `items` what a line may name
 * and `names` every item's name, removed ones too.
 */
export function BagMinimumsView({
  bags,
  histories,
  settings,
  settingsHistory,
  items,
  names,
  done,
  preset,
}: {
  bags: readonly Bag[];
  histories: Readonly<Record<string, readonly PresetEvent[]>>;
  settings: Settings | null;
  settingsHistory: readonly PresetEvent[];
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
  done?: string;
  preset?: string;
}) {
  const active = aToZ(bags.filter((b) => b.state === 'active'));
  const sources: MinimumsSource[] = [
    { id: TEMPLATE, label: 'The template for new bags', minimums: settings?.body.newBagMinimums ?? [] },
    ...active.map((b) => ({ id: b.id, label: b.name, minimums: b.body.minimums })),
  ];
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Bag minimums</h1>
      <p className="px-lede">
        What each of the team’s bags should hold at least, and the template a new bag starts from.
      </p>
      <PresetNotice done={done} preset={preset} presets={settings ? [...bags, settings] : bags} />
      <TeamSettings settings={settings} history={settingsHistory} items={items} names={names} />
      {active.length === 0 ? (
        <p className="px-panel">No bag is on your team’s list. Add one below.</p>
      ) : (
        active.map((bag) => (
          <BagSection key={bag.id} bag={bag} items={items} names={names} history={histories[bag.id] ?? []} />
        ))
      )}
      <AddBag items={items} sources={sources} />
      <RemovedList kind={KIND} presets={bags} />
    </Fragment>
  );
}
