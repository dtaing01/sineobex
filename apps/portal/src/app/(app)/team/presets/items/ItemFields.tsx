'use client';

import { useState } from 'react';
import { useFieldId, useFormState } from '@/components/ActionForm';
import { answerKey } from '@/components/presets/answer';
import { FixedFact } from '@/components/presets/FixedFact';
import { FreeText } from '@/components/presets/FreeText';
import styles from '@/components/presets/presets.module.css';
import type { LabResult } from '@/lib/presets';

/**
 * The fields of an item's forms that the shared parts don't draw (phase 5 design 4.4, 8.1): its
 * category, and the result a test records. Each is named by its body path (`categoryId`,
 * `result.options.1`), so the API's answer about it is said beside it.
 */

/** A category an item may be in, with what it holds, as the select groups them. */
export interface CategoryChoice {
  id: string;
  name: string;
  /** What it holds, in the pages' words: Supplies, Medications or Tests. */
  holds: string;
  /** Archived: offered only to the item already in it. */
  removed?: boolean;
}

/**
 * Category: the team's categories, grouped by what each holds, in the categories' own order. An
 * archived one is shown only to the item in it; an ID the page doesn't know is kept as it is.
 */
export function CategorySelect({
  categories,
  defaultValue = '',
}: {
  categories: readonly CategoryChoice[];
  defaultValue?: string;
}) {
  const state = useFormState();
  const id = useFieldId('categoryId');
  const error = state.fieldErrors?.categoryId;
  const value = state.values?.categoryId ?? defaultValue;
  const offered = categories.filter((c) => !c.removed || c.id === value);
  const known = value === '' || offered.some((c) => c.id === value);
  const groups = [...new Set(offered.map((c) => c.holds))];
  return (
    <div className="px-field">
      <label htmlFor={id}>Category</label>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <select
        id={id}
        name="categoryId"
        className={`px-select ${styles.choose}`}
        defaultValue={value}
        key={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">Choose a category</option>
        {!known && <option value={value}>A category no longer on the list</option>}
        {groups.map((holds) => (
          <optgroup key={holds} label={holds}>
            {offered
              .filter((c) => c.holds === holds)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.removed ? `${c.name} (removed)` : c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

const RESULT_HINT =
  'Only an item in a category that holds tests records a result. What kind of result it records can’t be changed later.';

/** The options of a result that is a choice: the API takes 2 to 12, and the form offers no more. */
const MOST_OPTIONS = 12;

interface Option {
  key: number;
  text: string;
}

let nextKey = 0;
const optionOf = (text: string): Option => ({ text, key: nextKey++ });

/** The options a refused form sent, from the values it came back with; null when it sent none. */
function sentOptions(values: Record<string, string> | undefined): string[] | null {
  const count = Number(values?.['result.options.count']);
  if (!values || !Number.isInteger(count) || count < 0) return null;
  return Array.from({ length: count }, (_, i) => values[`result.options.${i}`] ?? '');
}

/**
 * The answers a test's result is chosen from, one box each, with Add an option and Take out. A
 * refused form keeps the options it sent; a saved one starts from what is stored.
 */
function OptionList({ stored }: { stored: readonly string[] }) {
  const state = useFormState();
  const sent = sentOptions(state.values);
  const start = sent ?? stored;
  return <Options key={JSON.stringify([sent ? 'sent' : 'stored', start])} start={start} />;
}

function Options({ start }: { start: readonly string[] }) {
  const state = useFormState();
  const [options, setOptions] = useState<Option[]>(() => start.map(optionOf));
  const id = useFieldId('result.options');
  const error = state.fieldErrors?.['result.options'];
  return (
    <fieldset
      id={id}
      className={`px-fieldset ${styles.group}`}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
    >
      <legend>Options</legend>
      <p id={`${id}-hint`} className="sx-help">
        The answers staff choose from, such as Positive and Negative: 2 to 12 of them.
      </p>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <input type="hidden" name="result.options.count" value={options.length} />
      <ol className={styles.lines}>
        {options.map((option, i) => (
          <li key={option.key}>
            <OptionBox
              index={i}
              text={option.text}
              warning={`${id}-warning`}
              onTakeOut={() => setOptions((now) => now.filter((o) => o.key !== option.key))}
            />
          </li>
        ))}
      </ol>
      <p id={`${id}-warning`} className="sx-help">
        Don’t put patient names here.
      </p>
      {options.length < MOST_OPTIONS && (
        <div className="px-actions">
          <button
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={() => setOptions((now) => [...now, optionOf('')])}
          >
            Add an option
          </button>
        </div>
      )}
    </fieldset>
  );
}

function OptionBox({
  index,
  text,
  warning,
  onTakeOut,
}: {
  index: number;
  text: string;
  warning: string;
  onTakeOut: () => void;
}) {
  const state = useFormState();
  const name = `result.options.${index}`;
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  return (
    <div className={styles.line}>
      <div className={`px-field ${styles.item}`}>
        <label htmlFor={id}>Option {index + 1}</label>
        {error && (
          <p id={`${id}-error`} className="sx-help sx-help--error">
            {error}
          </p>
        )}
        <div className={`sx-input${error ? ' sx-input--error' : ''}`}>
          <input
            id={id}
            name={name}
            type="text"
            autoComplete="off"
            size={10}
            defaultValue={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={[error ? `${id}-error` : null, warning].filter(Boolean).join(' ')}
          />
        </div>
      </div>
      <button type="button" className="sx-btn sx-btn--ghost" onClick={onTakeOut}>
        Take out option {index + 1}
      </button>
    </div>
  );
}

const KINDS = [
  { value: 'none', label: 'None' },
  { value: 'choice', label: 'A choice from a list', hint: 'Such as Positive or Negative.' },
  { value: 'number', label: 'A number', hint: 'With its unit, such as mg/dL.' },
] as const;

/**
 * Result, on the add form: None, a choice from a list, or a number with its unit, and the fields
 * of the kind chosen. None is chosen to start with, which every item but a test records: the API
 * refuses a test without a result, and a result on anything else (4.4), so the start never stands.
 */
export function NewResult() {
  const state = useFormState();
  const sent = state.values?.['result.type'];
  // Each answer starts it again: a refused form from what it sent, an added item's from None.
  return (
    <NewResultFields
      key={state.values ? `sent:${sent ?? ''}` : `answer:${answerKey(state)}`}
      start={sent ?? 'none'}
    />
  );
}

function NewResultFields({ start }: { start: string }) {
  const state = useFormState();
  const [kind, setKind] = useState(start);
  const id = useFieldId('result');
  const error = state.fieldErrors?.result ?? state.fieldErrors?.['result.type'];
  return (
    <fieldset
      id={id}
      className={`px-fieldset ${styles.group}`}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
    >
      <legend>Result</legend>
      <p id={`${id}-hint`} className="sx-help">
        {RESULT_HINT}
      </p>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      {KINDS.map((k) => (
        <div key={k.value} className="px-check">
          <input
            id={`${id}-${k.value}`}
            type="radio"
            name="result.type"
            value={k.value}
            checked={kind === k.value}
            onChange={() => setKind(k.value)}
            aria-describedby={'hint' in k ? `${id}-${k.value}-hint` : undefined}
          />
          <label htmlFor={`${id}-${k.value}`}>{k.label}</label>
          {'hint' in k && (
            <span id={`${id}-${k.value}-hint`} className="sx-help">
              {k.hint}
            </span>
          )}
        </div>
      ))}
      {kind === 'choice' && <OptionList stored={['', '']} />}
      {kind === 'number' && <FreeText name="result.unit" label="Unit of the result" />}
    </fieldset>
  );
}

/**
 * Result, on an item's own form: what kind of result it records is fixed at creation (4.4), so it
 * is shown and never sent; a choice's options and a number's unit can change. `described` is the
 * result in the pages' words, for an item that records none or a kind this page doesn't know.
 */
export function ResultNow({ result, described }: { result: LabResult | null; described: string }) {
  const id = useFieldId('result');
  const state = useFormState();
  const error = state.fieldErrors?.result;
  if (result === null || (result.type !== 'choice' && result.type !== 'number'))
    return <FixedFact name="result" label="Result" value={described} hint={RESULT_HINT} />;
  return (
    <fieldset
      id={id}
      className={`px-fieldset ${styles.group}`}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
    >
      <legend>Result</legend>
      <p id={`${id}-hint`} className="sx-help">
        {result.type === 'choice'
          ? 'It records a choice from a list. What kind of result it records can’t be changed later; its options can.'
          : 'It records a number. What kind of result it records can’t be changed later; its unit can.'}
      </p>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      {result.type === 'choice' ? (
        <OptionList stored={result.options} />
      ) : (
        <FreeText name="result.unit" label="Unit of the result" defaultValue={result.unit} />
      )}
    </fieldset>
  );
}
