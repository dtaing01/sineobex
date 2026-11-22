'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';

/**
 * A tick box a preset form sends as `on` or not at all, such as an item's Medical (phase 5 design
 * 8.1), with a line under it on what ticking it means. Inside an ActionForm, posted as `name`. A
 * refused form keeps what it sent, ticked or not; one that went through comes back with
 * `defaultChecked`, the preset as it is now. The API judges what may be ticked (D114).
 */
export function CheckField({
  name,
  label,
  hint,
  defaultChecked = false,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  // A refused form sent every field it holds, so a box it sent unticked is not in its values.
  const checked = state.values ? state.values[name] === 'on' : defaultChecked;
  return (
    <div className="px-check">
      <input
        id={id}
        name={name}
        type="checkbox"
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
        }
        defaultChecked={checked}
        key={`${state.values ? 'sent' : 'stored'}:${checked}`}
      />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={`${id}-hint`} className="sx-help">
          {hint}
        </span>
      )}
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
    </div>
  );
}
