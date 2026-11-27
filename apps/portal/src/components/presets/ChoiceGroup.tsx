'use client';

import type { ReactNode } from 'react';
import { useFieldId, useFormState } from '@/components/ActionForm';
import styles from './presets.module.css';

/** One of a choice's options, with an optional line under it on what choosing it means. */
export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
  /** Drawn before the label, such as a colour's swatch (aria-hidden): the label alone names it. */
  mark?: ReactNode;
}

/**
 * One choice from a few, as radio buttons with nothing chosen beforehand, and a sentence for the
 * whole group read with it: for a choice made once that a preset keeps, such as what a category
 * holds ("What it holds can’t be changed later."), where a default would make the choice for the
 * person (phase 5 design 4.4, 8.1), or a choice a new preset makes, such as whether a bundle is
 * Medical. An edit form passes the preset's own choice as `defaultValue`. Inside an ActionForm,
 * posted as `name`. A refused form keeps the choice it sent; the error summary's link focuses the
 * group.
 */
export function ChoiceGroup({
  name,
  legend,
  hint,
  options,
  defaultValue,
}: {
  name: string;
  legend: string;
  /** Said of the whole choice, such as that it can't be changed later. */
  hint: string;
  options: readonly ChoiceOption[];
  /** The preset's choice now, on an edit form; none on an add form. */
  defaultValue?: string;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  // A refused form sent every field it holds, so a choice it sent as none is none.
  const sent = state.values ? state.values[name] : defaultValue;
  return (
    <fieldset
      id={id}
      className="px-fieldset"
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
      {options.map((o) => (
        // The hint is outside the label: inside, it would be read twice, as name and description.
        <div key={o.value} className="px-check">
          <input
            id={`${id}-${o.value}`}
            type="radio"
            name={name}
            value={o.value}
            required
            aria-describedby={o.hint ? `${id}-${o.value}-hint` : undefined}
            defaultChecked={sent === o.value}
            // A refused form comes back with the choice it sent; a saved one with its own, and an
            // added one with none.
            key={`${state.values ? 'sent' : 'stored'}:${sent ?? ''}`}
          />
          <label htmlFor={`${id}-${o.value}`} className={o.mark ? styles.marked : undefined}>
            {o.mark}
            {o.label}
          </label>
          {o.hint && (
            <span id={`${id}-${o.value}-hint`} className="sx-help">
              {o.hint}
            </span>
          )}
        </div>
      ))}
    </fieldset>
  );
}
