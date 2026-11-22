'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';

/**
 * A box a preset form takes text in, such as a preset's name (phase 5 design 8.1, 9). What an
 * admin types here reaches every phone of the team, so it carries the warning every free-text box
 * carries, under it, and the browser never fills it in. Inside an ActionForm, posted as `name`. A
 * refused form keeps what was typed; one that went through comes back with `defaultValue`, the
 * preset as it is now.
 */
export function FreeText({
  name,
  label,
  defaultValue = '',
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  /** Said above the box, before the warning under it. */
  hint?: string;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? defaultValue;
  return (
    <div className="px-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="sx-help">
          {hint}
        </p>
      )}
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
          required
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null, `${id}-warning`]
            .filter(Boolean)
            .join(' ')}
          autoComplete="off"
          // As wide as its box lets it be, so it fits wherever a page places it at 320 px.
          size={10}
          defaultValue={value}
          key={value}
        />
      </div>
      <p id={`${id}-warning`} className="sx-help">
        Don’t put patient names here.
      </p>
    </div>
  );
}
