'use client';

import { useState } from 'react';
import { useFieldId, useFormState } from '@/components/ActionForm';
import { answerKey } from './answer';
import styles from './presets.module.css';

/**
 * The texts a refused form sent, from the values it came back with; null when it sent none, so the
 * stored ones stand. The count travels with them, so a form that took every box out is kept so.
 */
function sentTexts(values: Record<string, string> | undefined, name: string): string[] | null {
  const count = Number(values?.[`${name}.count`]);
  if (!values || !Number.isInteger(count) || count < 0) return null;
  return Array.from({ length: count }, (_, i) => values[`${name}.${i}`] ?? '');
}

export interface TextListProps {
  /** The body field the list is: `result.options`, `codes`. */
  name: string;
  /** What the group is called, such as "Options" or "Condition codes". */
  legend: string;
  /** Said of the whole list, under its legend and read with it, such as how many it takes. */
  hint: string;
  /** What one box is called, numbered from 1: "Option 2", "Condition code 2". */
  entry: string;
  /** The button that adds a box: "Add an option". */
  addLabel: string;
  /** The texts as stored, or the boxes a new preset starts with (empty texts). */
  stored: readonly string[];
  /** How many the kind holds at most: the API refuses more, and the form offers no more. */
  max: number;
}

interface Text {
  key: number;
  text: string;
}

let nextKey = 0;
const textOf = (text: string): Text => ({ text, key: nextKey++ });

/**
 * A list of short texts a preset holds, one box each, with Add and Take out (phase 5 design 4.4,
 * 8.1), such as a test's options or a condition mapping's codes. Posted as `<name>.<i>`, the body's
 * own paths, with `<name>.count`, so the API's answer about a box is said beside it, and read back
 * by readTexts (lib/presets.ts). The warning every free-text box carries is said once, under the
 * boxes, and read with each. A refused form keeps the texts it sent; a saved one starts from what
 * is stored, and an add form, once its preset is added, from its first boxes again.
 */
export function TextList(props: TextListProps) {
  const state = useFormState();
  const sent = sentTexts(state.values, props.name);
  const key = sent
    ? `sent:${JSON.stringify(sent)}`
    : `stored:${answerKey(state)}:${JSON.stringify(props.stored)}`;
  return <Texts key={key} {...props} start={sent ?? props.stored} />;
}

function Texts({
  name,
  legend,
  hint,
  entry,
  addLabel,
  max,
  start,
}: TextListProps & { start: readonly string[] }) {
  const state = useFormState();
  const [texts, setTexts] = useState<Text[]>(() => start.map(textOf));
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  return (
    <fieldset
      id={id}
      className={`px-fieldset ${styles.group}`}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
    >
      <legend>{legend}</legend>
      <p id={`${id}-hint`} className="sx-help">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <input type="hidden" name={`${name}.count`} value={texts.length} />
      <ol className={styles.lines}>
        {texts.map((text, i) => (
          <li key={text.key}>
            <TextBox
              name={`${name}.${i}`}
              label={`${entry} ${i + 1}`}
              text={text.text}
              warning={`${id}-warning`}
              onTakeOut={() => setTexts((now) => now.filter((t) => t.key !== text.key))}
            />
          </li>
        ))}
      </ol>
      <p id={`${id}-warning`} className="sx-help">
        Don’t put patient names here.
      </p>
      {texts.length < max && (
        <div className="px-actions">
          <button
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={() => setTexts((now) => [...now, textOf('')])}
          >
            {addLabel}
          </button>
        </div>
      )}
    </fieldset>
  );
}

function TextBox({
  name,
  label,
  text,
  warning,
  onTakeOut,
}: {
  name: string;
  label: string;
  text: string;
  warning: string;
  onTakeOut: () => void;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  return (
    <div className={styles.line}>
      <div className={`px-field ${styles.item}`}>
        <label htmlFor={id}>{label}</label>
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
        {`Take out ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      </button>
    </div>
  );
}
