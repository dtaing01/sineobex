'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';

/**
 * A box for a sentence or two that a preset may leave empty, such as a bundle's prompt or a flag's
 * criteria (phase 5 design 4.4, 8.1). What an admin types here reaches every phone of the team, so
 * it carries the warning every free-text box carries, under it, after the line on what the text is
 * for; the browser never fills it in. Inside an ActionForm, posted as `name`. A refused form keeps
 * what was typed; one that went through comes back with `defaultValue`, the preset as it is now.
 */
export function LongText({
  name,
  label,
  defaultValue = '',
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  /** Said under the box, before the warning. */
  hint?: string;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? defaultValue;
  return (
    <div className="px-field">
      <label htmlFor={id}>{label} (optional)</label>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <div className={`sx-input${error ? ' sx-input--error' : ''}`}>
        <textarea
          id={id}
          name={name}
          rows={3}
          // As wide as its box lets it be, so it fits wherever a page places it at 320 px.
          cols={10}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? `${id}-error` : null, hint ? `${id}-hint` : null, `${id}-warning`]
            .filter(Boolean)
            .join(' ')}
          autoComplete="off"
          defaultValue={value}
          key={value}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="sx-help">
          {hint}
        </p>
      )}
      <p id={`${id}-warning`} className="sx-help">
        Don’t put patient names here.
      </p>
    </div>
  );
}
