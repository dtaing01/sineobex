'use client';

import { useState } from 'react';
import { CREDENTIAL_FIELD_SETS, CREDENTIAL_LABELS } from '@/lib/labels';
import { SelectField, TextField, useFormState } from './ActionForm';

/** Credential picker that shows the fields the chosen credential needs. */
export function CredentialFields({
  defaultCredential = 'none',
  defaults = {},
}: {
  defaultCredential?: string;
  defaults?: Record<string, string>;
}) {
  const state = useFormState();
  const [credential, setCredential] = useState(state.values?.credential ?? defaultCredential);
  const fields = CREDENTIAL_FIELD_SETS[credential] ?? [];
  return (
    <fieldset
      className="px-fieldset"
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement && e.target.name === 'credential')
          setCredential(e.target.value);
      }}
    >
      <legend>Clinical credential</legend>
      <SelectField
        name="credential"
        label="Credential"
        defaultValue={credential}
        options={Object.entries(CREDENTIAL_LABELS).map(([value, label]) => ({ value, label }))}
      />
      {fields.map((f) => (
        <TextField
          key={`${credential}-${f.name}`}
          name={f.name}
          label={f.label}
          hint={f.hint}
          required
          defaultValue={defaults[f.name]}
        />
      ))}
    </fieldset>
  );
}
