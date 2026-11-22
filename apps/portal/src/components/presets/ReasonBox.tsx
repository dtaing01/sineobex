'use client';

import { useFieldId, useFormState } from '@/components/ActionForm';

/** The API's PresetReason: 3 to 300 characters once trimmed. The API counts it, and refuses. */
const REASON_MAX = 300;

/**
 * The Reason box every preset write asks for (phase 5 design 8.1; PL-14): required, kept in the
 * preset's history and never in the audit log, with the warning every free-text box carries. Inside
 * an ActionForm, posted as `reason`.
 */
export function ReasonBox({ label = 'Reason' }: { label?: string }) {
  const state = useFormState();
  const name = 'reason';
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  const sent = state.values?.[name] ?? '';
  return (
    <div className="px-field">
      <label htmlFor={id}>{label}</label>
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
          aria-describedby={[error ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(' ')}
          autoComplete="off"
          maxLength={REASON_MAX}
          defaultValue={sent}
          // A refused form comes back with the reason it sent; a saved one with none.
          key={sent}
        />
      </div>
      <p id={`${id}-hint`} className="sx-help">
        Don’t put patient names here.
      </p>
    </div>
  );
}
