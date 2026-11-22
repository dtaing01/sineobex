'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';

/** One of a choice's options, with an optional line under it on what choosing it means. */
export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * One choice from a few, as radio buttons with nothing chosen beforehand, and a sentence for the
 * whole group read with it: for a choice made once that a preset keeps, such as what a category
 * holds ("What it holds can’t be changed later."), where a default would make the choice for the
 * person (phase 5 design 4.4, 8.1). Inside an ActionForm, posted as `name`. A refused form keeps
 * the choice it sent; the error summary's link focuses the group.
 */
export function ChoiceGroup({
  name,
  legend,
  hint,
  options,
}: {
  name: string;
  legend: string;
  /** Said of the whole choice, such as that it can't be changed later. */
  hint: string;
  options: readonly ChoiceOption[];
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  const sent = state.values?.[name];
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
            // A refused form comes back with the choice it sent; an added one with none.
            key={sent ?? ''}
          />
          <label htmlFor={`${id}-${o.value}`}>{o.label}</label>
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
