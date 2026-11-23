import { Fragment } from 'react';
import {
  addConditionSupplyAction,
  saveConditionSupplyAction,
  saveProblemCheckAction,
} from '@/app/actions/presets-condition-supplies';
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
import { TextList } from '@/components/presets/TextList';
import { DescribedValue, UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { ConditionSupplyBody, PresetEvent, PresetRow } from '@/lib/presets';
import { DaysField } from './DaysField';

export type ConditionSupply = PresetRow<'condition_supply_map'>;
export type Settings = PresetRow<'settings'>;

const KIND = 'condition_supply_map';
const LABELS = FIELD_LABELS.condition_supply_map;

/** The codes a mapping counts at most (packages/presets/src/schemas.ts): the form offers no more. */
const MOST_CODES = 20;
/** The lines a mapping holds at most. */
const MOST_LINES = 10;

// A mapping counts exact codes only, as the body's schema says (design 11, row 13): the hint says so.
export const CODES_HINT =
  'ICD-10-CM codes, such as R21 or L30.9: 1 to 20 of them. A problem counts only when its code is one of these exactly, so L30 doesn’t count L30.9.';

export const LINES_HINT =
  'For each patient on a route with one of these conditions, New or Ongoing, the bag check counts this many of each item.';

/** 8.1's words for the team's window, with the number in its box. */
export const WINDOW_LABEL = FIELD_LABELS.settings.problemCheckDays;

const WINDOW_TEXT =
  'A problem that is New or Ongoing and not updated in this many days, from 7 to 365, is marked Status check due, so staff check its status at the patient’s next visit.';

/** A mapping's fields, empty for a new one or as `mapping` holds them now. */
function MappingFields({ items, mapping }: { items: readonly ItemChoice[]; mapping?: ConditionSupplyBody }) {
  return (
    <>
      <FreeText
        name="name"
        label={LABELS.name}
        hint="What the condition is called, such as Rash or dermatitis."
        {...(mapping ? { defaultValue: mapping.name } : {})}
      />
      <TextList
        name="codes"
        legend={LABELS.codes}
        hint={CODES_HINT}
        entry="Condition code"
        addLabel="Add a code"
        // A new mapping starts with one box to type its first code in.
        stored={mapping?.codes ?? ['']}
        max={MOST_CODES}
      />
      <ItemLines
        name="lines"
        legend={LABELS.lines}
        hint={LINES_HINT}
        items={items}
        lines={(mapping?.lines ?? []).map((l) => ({ itemId: l.itemId, quantity: l.qtyPerPatient }))}
        quantity={{ field: 'qtyPerPatient', label: 'Quantity per patient' }}
        max={MOST_LINES}
      />
    </>
  );
}

/** A mapping's form: its name, its codes and its lines, at the version shown, with a reason. */
function EditMapping({ row, items }: { row: ConditionSupply; items: readonly ItemChoice[] }) {
  return (
    <ActionForm id={`edit-${row.id}`} action={saveConditionSupplyAction} label={`Edit ${row.name}`}>
      <input type="hidden" name="id" value={row.id} />
      <BaseVersion version={row.version} />
      <MappingFields items={items} mapping={row.body} />
      <ReasonBox />
      <div className="px-actions">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One mapping: its codes and its items per patient, its acts, any update, and its history. */
function MappingSection({
  row,
  items,
  names,
  history,
}: {
  row: ConditionSupply;
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
  history: readonly PresetEvent[];
}) {
  const heading = `mapping-${row.id}`;
  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {row.name}
      </h2>
      <dl className="px-facts">
        <div>
          <dt>{LABELS.codes}</dt>
          <dd>
            <DescribedValue value={describeField(KIND, 'codes', row.body.codes, names)} />
          </dd>
        </div>
        <div>
          <dt>{LABELS.lines}</dt>
          <dd>
            <DescribedValue value={describeField(KIND, 'lines', row.body.lines, names)} />
          </dd>
        </div>
      </dl>
      <Disclosure id={`edit-${row.id}-form`} label="Edit" name={row.name}>
        <EditMapping row={row} items={items} />
      </Disclosure>
      <RemoveForm kind={KIND} preset={row} />
      <UpdateOffer kind={KIND} preset={row} names={names} headingLevel={3} />
      <HistoryTable events={history} id={row.id} heading={`History of ${row.name}`} headingLevel={3} flat />
    </section>
  );
}

/** Add a condition mapping of the team's own: a name, its codes and its items per patient. */
function AddMapping({ items }: { items: readonly ItemChoice[] }) {
  return (
    <section aria-labelledby="add-mapping" className="px-panel">
      <h2 id="add-mapping" className="px-h2">
        Add a mapping
      </h2>
      <ActionForm id="new-mapping" action={addConditionSupplyAction} label="Add a mapping">
        <MappingFields items={items} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add mapping</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * The team's status check window (8.1: "Check problems not updated in [90] days"), its field of the
 * team's settings, saved with a reason of its own; the settings' update when Sineobex offers one,
 * and their history, which holds Bag minimums' edits of them too.
 */
function StatusCheck({
  settings,
  history,
  names,
}: {
  settings: Settings | null;
  history: readonly PresetEvent[];
  names: Readonly<Record<string, string>>;
}) {
  return (
    <section aria-labelledby="status-check" className="px-panel">
      <h2 id="status-check" className="px-h2">
        Status check
      </h2>
      {settings === null ? (
        <p>Your team’s settings can’t be found. Reload the page to try again.</p>
      ) : (
        <>
          <p>{WINDOW_TEXT}</p>
          <ActionForm id="status-check-form" action={saveProblemCheckAction} label="Status check">
            <input type="hidden" name="id" value={settings.id} />
            <BaseVersion version={settings.version} />
            <DaysField
              name="problemCheckDays"
              label={WINDOW_LABEL}
              defaultValue={String(settings.body.problemCheckDays)}
            />
            <ReasonBox />
            <div className="px-actions">
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
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

/**
 * Condition supplies (phase 5 design 8.1; PRD main 476): the team's condition mappings A to Z, each
 * with its codes and its items per patient, Edit, Remove, Sineobex's update when one is on offer,
 * and its history; Add a mapping; the Removed list with Restore; and the status check window, the
 * team's settings. `maps` is the API's list, archived ones included, `histories` each active
 * one's, `items` what a line may name and `names` every item's name, removed ones too.
 */
export function ConditionSuppliesView({
  maps,
  histories,
  settings,
  settingsHistory,
  items,
  names,
  done,
  preset,
}: {
  maps: readonly ConditionSupply[];
  histories: Readonly<Record<string, readonly PresetEvent[]>>;
  settings: Settings | null;
  settingsHistory: readonly PresetEvent[];
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
  done?: string;
  preset?: string;
}) {
  const active = aToZ(maps.filter((m) => m.state === 'active'));
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = isPresetDone(done) ? `${done}:${preset ?? ''}` : '';
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Condition supplies</h1>
      <p className="px-lede">
        Before a route, the bag check counts the patients on it who have each condition, New or Ongoing, and
        warns when the route’s bags hold too few of the items they need.
      </p>
      <PresetNotice done={done} preset={preset} presets={settings ? [...maps, settings] : maps} />
      {active.length === 0 ? (
        <p className="px-panel">No condition mapping is on your team’s list. Add one below.</p>
      ) : (
        active.map((row) => (
          <MappingSection
            key={row.id}
            row={row}
            items={items}
            names={names}
            history={histories[row.id] ?? []}
          />
        ))
      )}
      <AddMapping items={items} />
      <RemovedList kind={KIND} presets={maps} names={names} />
      <StatusCheck settings={settings} history={settingsHistory} names={names} />
    </Fragment>
  );
}
