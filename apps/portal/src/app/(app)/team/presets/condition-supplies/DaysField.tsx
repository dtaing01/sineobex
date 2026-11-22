'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';
import styles from '@/components/presets/presets.module.css';

/**
 * A number of days a setting holds, such as how long a problem may go without an update before it
 * is due a status check (phase 5 design 8.1: "Check problems not updated in [90] days"): its label
 * before the box and "days" in it, read with the box. Inside an ActionForm, posted as `name` and
 * sent as typed: the API holds it to its range, and the form says its sentence beside it. A
 * refused form keeps what was typed; one that went through comes back with `defaultValue`.
 */
export function DaysField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? defaultValue;
  return (
    <div className="px-field">
      <label htmlFor={id}>{label}</label>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <div className={`sx-input ${styles.days}${error ? ' sx-input--error' : ''}`}>
        <input
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          aria-required
          size={4}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-unit`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
          defaultValue={value}
          key={value}
        />
        <span id={`${id}-unit`} className="unit">
          days
        </span>
      </div>
    </div>
  );
}
