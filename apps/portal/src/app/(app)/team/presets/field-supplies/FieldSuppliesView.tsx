import { Fragment } from 'react';
import { addFieldSupplyAction, saveFieldSupplyAction } from '@/app/actions/presets-field-supplies';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import { Disclosure } from '@/components/presets/Disclosure';
import { FixedFact } from '@/components/presets/FixedFact';
import { FreeText } from '@/components/presets/FreeText';
import { ItemLines, type ItemChoice } from '@/components/presets/ItemLines';
import { aToZ, itemChoices, namesOf } from '@/components/presets/order';
import { noticeKey, PresetNotice } from '@/components/presets/PresetNotice';
import { ReasonBox } from '@/components/presets/ReasonBox';
import { RemovedList } from '@/components/presets/RemovedList';
import { RemoveForm } from '@/components/presets/RemoveForm';
import { FIELD_LABELS } from '@/components/presets/review';
import { UpdateOffer } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { FieldSupplyBody, NoteTypeRow, PresetEvent, PresetRow } from '@/lib/presets';
import {
  answerChoices,
  choiceKey,
  choiceOf,
  describeAnswer,
  placeAt,
  placesOf,
  type AnswerPlace,
} from './fields';
import { EditAnswer, FiresOn, type OfferedNoteType } from './FiresOn';

export type FieldSupply = PresetRow<'field_supply_map'>;

const KIND = 'field_supply_map';
const LABELS = FIELD_LABELS.field_supply_map;

/** The lines a mapping holds at most (packages/presets/src/schemas.ts): the form offers no more. */
const MOST_LINES = 10;

export const EVERY_NOTE = 'Every note of this type';

export const LINES_HINT =
  'Suggested on the supply screen after the note, for staff to confirm or change before they sign.';

/**
 * Why a mapping suggests nothing now (8.1's warning row): its note type, field or answer has left the
 * note type's current version. A note started on an earlier version is read on that version, and
 * still has them (5.4, rule 4).
 */
export const WARNINGS = {
  noteTypeUnknown: 'This note type isn’t on your team’s list, so this mapping suggests nothing.',
  noteTypeRemoved: 'This note type was removed, so this mapping suggests nothing.',
  fieldHidden: 'This field is hidden in the note type’s current version, so this mapping suggests nothing.',
  answerRetired:
    'This answer was retired from the note type’s current version, so this mapping suggests nothing.',
} as const;

/** What a mapping fires on, in the words of its note type's current version. */
interface Read {
  noteType: NoteTypeRow | undefined;
  /** Null for a mapping on every note of the type, or one whose field the version lacks. */
  place: AnswerPlace | null;
  noteTypeWords: string;
  fieldWords: string;
  answerWords: string | null;
  warning: string | null;
}

function readMapping(body: FieldSupplyBody, noteTypes: readonly NoteTypeRow[]): Read {
  const noteType = noteTypes.find((n) => n.key === body.noteTypeKey);
  const place = noteType && body.path !== undefined ? placeAt(noteType.definition, body.path) : null;
  const holds = place?.holds ?? null;
  const code =
    body.when === undefined
      ? null
      : 'includes' in body.when
        ? body.when.includes
        : 'equals' in body.when && typeof body.when.equals === 'string'
          ? body.when.equals
          : null;
  const retired = code !== null && holds?.type === 'choice' && !holds.options.some((o) => o.code === code);
  const warning = !noteType
    ? WARNINGS.noteTypeUnknown
    : noteType.state === 'archived'
      ? WARNINGS.noteTypeRemoved
      : body.path !== undefined && !place
        ? WARNINGS.fieldHidden
        : retired
          ? WARNINGS.answerRetired
          : null;
  return {
    noteType,
    place,
    // A key the list doesn't hold is shown as it is stored.
    noteTypeWords: noteType?.title ?? body.noteTypeKey,
    fieldWords: body.path === undefined ? EVERY_NOTE : place ? `${place.section}: ${place.label}` : body.path,
    answerWords: body.when === undefined ? null : describeAnswer(body.when, holds),
    warning,
  };
}

/** A line in words: "Gauze × 2", or the number a field of the note holds. */
function lineWords(
  line: FieldSupplyBody['lines'][number],
  names: Readonly<Record<string, string>>,
  noteType: NoteTypeRow | undefined,
): string {
  const item = names[line.itemId] ?? 'Not on your team’s list';
  if (typeof line.qty === 'number') return `${item} × ${line.qty}`;
  const from = noteType ? placeAt(noteType.definition, line.qty.fromPath) : null;
  return `${item} × the number in “${from ? from.label : line.qty.fromPath}”`;
}

/**
 * A mapping's form at the version shown: its name, its answer and its lines. Its note type and its
 * field are fixed when it is made (4.4), so they are shown and never sent. Lines that take their
 * quantity from the note are shown and never sent, since the lines' form takes a count only: the
 * edit keeps them as the API holds them.
 */
export function EditMapping({
  row,
  noteTypes,
  items,
  names,
}: {
  row: FieldSupply;
  noteTypes: readonly NoteTypeRow[];
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
}) {
  const read = readMapping(row.body, noteTypes);
  const { body } = row;
  const counted = body.lines.every((l) => typeof l.qty === 'number');
  return (
    <ActionForm id={`edit-${row.id}`} action={saveFieldSupplyAction} label={`Edit ${row.name}`}>
      <input type="hidden" name="id" value={row.id} />
      <BaseVersion version={row.version} />
      <FreeText name="name" label={LABELS.name} defaultValue={body.name} />
      <FixedFact
        name="noteTypeKey"
        label={LABELS.noteTypeKey}
        value={read.noteTypeWords}
        hint="Which note type a mapping is for can’t be changed later."
      />
      <FixedFact
        name="path"
        label={LABELS.path}
        value={read.fieldWords}
        hint="Which field a mapping fires on can’t be changed later."
      />
      {body.when !== undefined && (
        <EditAnswer
          answers={answerChoices(read.place?.holds ?? null, body.when)}
          current={choiceKey(choiceOf(body.when))}
        />
      )}
      {counted ? (
        <ItemLines
          name="lines"
          legend={LABELS.lines}
          hint={LINES_HINT}
          items={items}
          lines={body.lines.map((l) => ({ itemId: l.itemId, quantity: l.qty as number }))}
          quantity={{ field: 'qty', label: 'Quantity' }}
          max={MOST_LINES}
        />
      ) : (
        <FixedFact
          name="lines"
          label={LABELS.lines}
          value={body.lines.map((l) => lineWords(l, names, read.noteType)).join('; ')}
          hint="Some quantities here come from the note, which this form can’t change."
        />
      )}
      <ReasonBox />
      <div className="px-actions">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One mapping: what it fires on and what it suggests, any warning, its acts, any update, its history. */
function MappingSection({
  row,
  noteTypes,
  items,
  names,
  history,
}: {
  row: FieldSupply;
  noteTypes: readonly NoteTypeRow[];
  items: readonly ItemChoice[];
  names: Readonly<Record<string, string>>;
  history: readonly PresetEvent[];
}) {
  const heading = `mapping-${row.id}`;
  const read = readMapping(row.body, noteTypes);
  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {row.name}
      </h2>
      <dl className="px-facts">
        <div>
          <dt>{LABELS.noteTypeKey}</dt>
          <dd>{read.noteTypeWords}</dd>
        </div>
        <div>
          <dt>{LABELS.path}</dt>
          <dd>{read.fieldWords}</dd>
        </div>
        {read.answerWords !== null && (
          <div>
            <dt>{LABELS.when}</dt>
            <dd>{read.answerWords}</dd>
          </div>
        )}
        <div>
          <dt>{LABELS.lines}</dt>
          <dd>
            <ul className="px-list">
              {row.body.lines.map((l, i) => (
                <li key={i}>{lineWords(l, names, read.noteType)}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      {read.warning && <p className="px-alert px-alert--info">{read.warning}</p>}
      <Disclosure id={`edit-${row.id}-form`} label="Edit" name={row.name}>
        <EditMapping row={row} noteTypes={noteTypes} items={items} names={names} />
      </Disclosure>
      <RemoveForm kind={KIND} preset={row} />
      <UpdateOffer kind={KIND} preset={row} names={names} headingLevel={3} />
      <HistoryTable events={history} id={row.id} heading={`History of ${row.name}`} headingLevel={3} flat />
    </section>
  );
}

/**
 * The note types a new mapping may be for: the team's active ones, as the API lists them, each with
 * the fields and grid cells its current version holds that a mapping fires on, and their answers.
 */
function offered(noteTypes: readonly NoteTypeRow[]): OfferedNoteType[] {
  return noteTypes
    .filter((n) => n.state === 'active')
    .map((n) => ({
      key: n.key,
      title: n.title,
      places: placesOf(n.definition).flatMap((p) =>
        p.holds === null
          ? []
          : [{ path: p.path, section: p.section, label: p.label, answers: answerChoices(p.holds) }],
      ),
    }));
}

/** Add a mapping of the team's own (8.1): its name, its note type, field and answer, and its lines. */
function AddMapping({
  noteTypes,
  items,
}: {
  noteTypes: readonly NoteTypeRow[];
  items: readonly ItemChoice[];
}) {
  return (
    <section aria-labelledby="add-mapping" className="px-panel">
      <h2 id="add-mapping" className="px-h2">
        Add a mapping
      </h2>
      <ActionForm id="new-mapping" action={addFieldSupplyAction} label="Add a mapping">
        <FreeText
          name="name"
          label={LABELS.name}
          hint="What the mapping is called, such as Wound care: Xeroform applied."
        />
        <FiresOn noteTypes={offered(noteTypes)} />
        <ItemLines
          name="lines"
          legend={LABELS.lines}
          hint={LINES_HINT}
          items={items}
          lines={[]}
          quantity={{ field: 'qty', label: 'Quantity' }}
          max={MOST_LINES}
        />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add mapping</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

/**
 * Field supplies (phase 5 design 4.4, 8.1; PRD main 424-431, 470): the team's mappings A to Z, each
 * with its note type, its field and answer or Every note of this type, and its items, named in the
 * words of the note type's current version; a warning where that version hides the field or retired
 * the answer; Edit, Remove, Sineobex's update when one is on offer, and its history; Add a mapping;
 * the Removed list with Restore. `rows` is the API's list, archived ones included, `noteTypes` the
 * team's note types (GET /v1/admin/note-types), removed ones too, `items` and `categories` what a
 * line may name, and `histories` each active mapping's.
 */
export function FieldSuppliesView({
  rows,
  noteTypes,
  items,
  categories = [],
  histories,
  done,
  refused,
  preset,
}: {
  rows: readonly FieldSupply[];
  noteTypes: readonly NoteTypeRow[];
  items: readonly PresetRow<'item'>[];
  categories?: readonly PresetRow<'order_category'>[];
  histories: Readonly<Record<string, readonly PresetEvent[]>>;
  done?: string;
  /** A refusal another admin's Remove or Restore caused, which the page says (PresetNotice). */
  refused?: string;
  preset?: string;
}) {
  const active = aToZ(rows.filter((m) => m.state === 'active'));
  const choices = itemChoices(items, categories);
  const names = namesOf(items);
  // A new view starts afresh after each act the page is sent back to (CategoriesView).
  const view = noticeKey(done, refused, preset);
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Field supplies</h1>
      <p className="px-lede">
        When a note holds an answer mapped here, the supply screen after it suggests these items, for staff to
        confirm or change. Nothing is counted until they do.
      </p>
      <PresetNotice done={done} refused={refused} preset={preset} presets={rows} />
      {active.length === 0 ? (
        <p className="px-panel">No field supply mapping is on your team’s list. Add one below.</p>
      ) : (
        active.map((row) => (
          <MappingSection
            key={row.id}
            row={row}
            noteTypes={noteTypes}
            items={choices}
            names={names}
            history={histories[row.id] ?? []}
          />
        ))
      )}
      <AddMapping noteTypes={noteTypes} items={choices} />
      <RemovedList kind={KIND} presets={rows} names={names} />
    </Fragment>
  );
}
