'use client';

import { useFieldId, useFormState } from './ActionForm';

export function PermissionPicker({ catalog }: { catalog: { key: string; description: string }[] }) {
  const state = useFormState();
  const error = state.fieldErrors?.permissions;
  const id = useFieldId('permissions');
  return (
    <fieldset className="px-fieldset" aria-describedby={error ? `${id}-error` : undefined} id={id}>
      <legend>Permissions</legend>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      {catalog.map((p) => (
        <div key={p.key} className="px-check">
          <input type="checkbox" id={`${id}-${p.key}`} name="permissions" value={p.key} />
          <label htmlFor={`${id}-${p.key}`}>{p.description}</label>
        </div>
      ))}
    </fieldset>
  );
}
