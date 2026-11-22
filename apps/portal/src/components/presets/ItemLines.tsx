'use client';

import { useState } from 'react';
import { useFieldId, useFormState } from '@/components/ActionForm';
import type { LineQuantity } from '@/lib/presets';
import styles from './presets.module.css';

/** An item a line may name: the team's items, an archived one shown only on the lines that hold it. */
export interface ItemChoice {
  id: string;
  name: string;
  /** Archived: never offered for a new line (design 5.1). */
  removed?: boolean;
  /** Its category's name, to group the choices by. */
  group?: string;
}

/** A line as the body holds it: its item, its quantity, and for a bundle whether it is core. */
export interface ItemLine {
  itemId: string;
  quantity: number | string;
  core?: boolean;
}

interface Row extends ItemLine {
  key: number;
}

let nextKey = 0;
const rowOf = (line: ItemLine): Row => ({ ...line, key: nextKey++ });

/**
 * The lines a refused form sent, from the values it came back with; null when it sent none, so the
 * stored lines stand. The count travels with them, so a form that took every line out is kept so.
 */
function sentLines(
  values: Record<string, string> | undefined,
  name: string,
  quantity: LineQuantity,
): ItemLine[] | null {
  const count = Number(values?.[`${name}.count`]);
  if (!values || !Number.isInteger(count) || count < 0) return null;
  return Array.from({ length: count }, (_, i) => ({
    itemId: values[`${name}.${i}.itemId`] ?? '',
    quantity: values[`${name}.${i}.${quantity}`] ?? '',
    core: values[`${name}.${i}.core`] === 'on',
  }));
}

export interface ItemLinesProps {
  /** The body field the lines are: `lines`, `minimums` or `newBagMinimums`. */
  name: string;
  /** What the group is called, such as "Items" or "Minimums". */
  legend: string;
  items: readonly ItemChoice[];
  /** The lines as stored, or none for a new preset. */
  lines: readonly ItemLine[];
  /** The body's word for a line's quantity, and what the form calls it ("Quantity", "Minimum"). */
  quantity: { field: LineQuantity; label: string };
  /** A bundle's lines are each core or optional (PRD main 441). */
  core?: boolean;
  /** How many lines the kind holds at most: the API refuses more, and the form offers no more. */
  max: number;
}

/**
 * An item, a quantity and, for a bundle, Core, on each line (phase 5 design 8.1), for bundles and
 * every list that names items. Posted as `<name>.<i>.itemId`, `<name>.<i>.<quantity>` and
 * `<name>.<i>.core`, the body's own paths, so the API's answer about a line is shown beside it, and
 * read back by readLines (lib/presets.ts). A refused form keeps the lines it sent.
 */
export function ItemLines(props: ItemLinesProps) {
  const state = useFormState();
  const sent = sentLines(state.values, props.name, props.quantity.field);
  // A refused form starts again from what it sent; a saved one from what is stored now.
  const key = sent ? `sent:${JSON.stringify(sent)}` : `stored:${JSON.stringify(props.lines)}`;
  return <Lines key={key} {...props} start={sent ?? props.lines} />;
}

function Lines({
  name,
  legend,
  items,
  start,
  quantity,
  core,
  max,
}: ItemLinesProps & { start: readonly ItemLine[] }) {
  const state = useFormState();
  const [rows, setRows] = useState<Row[]>(() => start.map(rowOf));
  const groupId = useFieldId(name);
  const error = state.fieldErrors?.[name];
  return (
    <fieldset
      id={groupId}
      className={`px-fieldset ${styles.group}`}
      tabIndex={-1}
      aria-describedby={error ? `${groupId}-error` : undefined}
    >
      <legend>{legend}</legend>
      {error && (
        <p id={`${groupId}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <input type="hidden" name={`${name}.count`} value={rows.length} />
      {rows.length === 0 ? (
        <p className="sx-help">None yet.</p>
      ) : (
        <ol className={styles.lines}>
          {rows.map((row, i) => (
            <li key={row.key}>
              <Line
                name={name}
                index={i}
                row={row}
                items={items}
                quantity={quantity}
                core={core}
                onTakeOut={() => setRows((now) => now.filter((r) => r.key !== row.key))}
              />
            </li>
          ))}
        </ol>
      )}
      {rows.length < max && (
        <div className="px-actions">
          <button
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={() =>
              setRows((now) => [...now, rowOf({ itemId: '', quantity: 1, ...(core ? { core: true } : {}) })])
            }
          >
            Add an item
          </button>
        </div>
      )}
    </fieldset>
  );
}

function Line({
  name,
  index,
  row,
  items,
  quantity,
  core,
  onTakeOut,
}: {
  name: string;
  index: number;
  row: Row;
  items: readonly ItemChoice[];
  quantity: ItemLinesProps['quantity'];
  core?: boolean;
  onTakeOut: () => void;
}) {
  const state = useFormState();
  const at = (field: string) => `${name}.${index}.${field}`;
  const itemId = useFieldId(at('itemId'));
  const qtyId = useFieldId(at(quantity.field));
  const coreId = useFieldId(at('core'));
  const itemError = state.fieldErrors?.[at('itemId')];
  const qtyError = state.fieldErrors?.[at(quantity.field)];
  // Offered: the team's items, and an archived one only on the line that already holds it.
  const offered = items.filter((i) => !i.removed || i.id === row.itemId);
  const known = row.itemId === '' || offered.some((i) => i.id === row.itemId);
  const groups = [...new Set(offered.map((i) => i.group ?? ''))];
  const option = (i: ItemChoice) => (
    <option key={i.id} value={i.id}>
      {i.removed ? `${i.name} (removed)` : i.name}
    </option>
  );
  return (
    <fieldset className={styles.line}>
      <legend>Line {index + 1}</legend>
      <div className={`px-field ${styles.item}`}>
        <label htmlFor={itemId}>Item</label>
        {itemError && (
          <p id={`${itemId}-error`} className="sx-help sx-help--error">
            {itemError}
          </p>
        )}
        <select
          id={itemId}
          name={at('itemId')}
          className="px-select"
          defaultValue={row.itemId}
          aria-invalid={itemError ? true : undefined}
          aria-describedby={itemError ? `${itemId}-error` : undefined}
        >
          <option value="">Choose an item</option>
          {!known && <option value={row.itemId}>An item no longer on the list</option>}
          {groups.length > 1 || groups[0] !== ''
            ? groups.map((g) => (
                <optgroup key={g} label={g || 'Other'}>
                  {offered.filter((i) => (i.group ?? '') === g).map(option)}
                </optgroup>
              ))
            : offered.map(option)}
        </select>
      </div>
      <div className={`px-field ${styles.quantity}`}>
        <label htmlFor={qtyId}>{quantity.label}</label>
        {qtyError && (
          <p id={`${qtyId}-error`} className="sx-help sx-help--error">
            {qtyError}
          </p>
        )}
        <div className={`sx-input${qtyError ? ' sx-input--error' : ''}`}>
          <input
            id={qtyId}
            name={at(quantity.field)}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            // As wide as its box lets it be; left to its own width (20 characters), a line would
            // be wider than a phone held upright.
            size={4}
            defaultValue={String(row.quantity)}
            aria-invalid={qtyError ? true : undefined}
            aria-describedby={qtyError ? `${qtyId}-error` : undefined}
          />
        </div>
      </div>
      {core && (
        <div className="px-check">
          <input id={coreId} type="checkbox" name={at('core')} defaultChecked={row.core === true} />
          <label htmlFor={coreId}>Core</label>
        </div>
      )}
      <button type="button" className="sx-btn sx-btn--ghost" onClick={onTakeOut}>
        Take out line {index + 1}
      </button>
    </fieldset>
  );
}
