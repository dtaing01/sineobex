'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';
import styles from './presets.module.css';

/**
 * A field of a preset that its edit form shows and never sends, because it is fixed at creation
 * (phase 5 design 4.4), such as what an item is counted in: read-only, with the line on why under
 * its label. It takes the field's ID, so a problem the API answers there (a move it refuses for
 * what this field holds) is said beside it, and the error summary's link reaches it.
 */
export function FixedFact({
  name,
  label,
  value,
  hint,
}: {
  /** The body path the field is, for the API's answer about it. */
  name: string;
  label: string;
  value: string;
  hint: string;
}) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  return (
    <div className="px-field">
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-hint`} className="sx-help">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      <div className={`sx-input ${styles.fixed}${error ? ' sx-input--error' : ''}`}>
        {/* No name: the form never sends it, and the edit sends the API's own value (4.4). */}
        <input
          id={id}
          type="text"
          readOnly
          size={10}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
        />
      </div>
    </div>
  );
}
