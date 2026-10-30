'use client';

import { useFieldId, useFormState } from './ActionForm';

export function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  const state = useFormState();
  const error = state.fieldErrors?.[name];
  const id = useFieldId(name);
  return (
    <div className="px-check">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <label htmlFor={id}>{label}</label>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
    </div>
  );
}
