'use client';

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/forms';

const FormState = createContext<{ state: ActionState; prefix: string }>({ state: {}, prefix: 'f' });

export function useFormState(): ActionState {
  return useContext(FormState).state;
}

/** Field ids are prefixed per form, so two forms on one page never share an id. */
export function useFieldId(name: string): string {
  return `${useContext(FormState).prefix}-${name}`;
}

/**
 * A form posting to a server action. Errors appear in a summary that takes focus and links to
 * each field (WCAG 3.3.1, 3.3.3); the fields keep what was typed.
 */
export function ActionForm({
  action,
  children,
  className = 'px-form',
  label,
  id,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  label?: string;
  /** Unique on the page; prefixes every field id in the form. */
  id: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) summary.current?.focus();
  }, [state]);
  const fieldErrors = Object.entries(state.fieldErrors ?? {});
  return (
    <FormState.Provider value={{ state, prefix: id }}>
      <form id={id} action={formAction} className={className} aria-label={label} noValidate>
        {state.error && (
          <div ref={summary} tabIndex={-1} role="alert" className="px-alert px-alert--error">
            <p className="px-alert__title">{state.error}</p>
            {fieldErrors.length > 0 && (
              <ul>
                {fieldErrors.map(([name, message]) => (
                  <li key={name}>
                    <a href={`#${id}-${name}`}>{message}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {state.ok && state.message && (
          <p role="status" className="px-alert px-alert--ok">
            {state.message}
          </p>
        )}
        {children}
      </form>
    </FormState.Provider>
  );
}

export function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`sx-btn sx-btn--${variant}`} disabled={pending} aria-disabled={pending}>
      {pending ? 'Working…' : children}
    </button>
  );
}

type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'numeric' | 'text' | 'email';
  defaultValue?: string;
  maxLength?: number;
};

export function TextField({
  name,
  label,
  hint,
  type = 'text',
  required,
  autoComplete,
  inputMode,
  defaultValue,
  maxLength,
}: FieldProps) {
  const state = useFormState();
  const error = state.fieldErrors?.[name];
  const id = useFieldId(name);
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="px-field">
      <label htmlFor={id}>
        {label}
        {required ? '' : ' (optional)'}
      </label>
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
          type={type}
          required={required}
          aria-required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          defaultValue={state.values?.[name] ?? defaultValue}
          key={state.values?.[name] ?? defaultValue ?? ''}
        />
      </div>
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  hint,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
}) {
  const state = useFormState();
  const error = state.fieldErrors?.[name];
  const id = useFieldId(name);
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
      <select
        id={id}
        name={name}
        className="px-select"
        defaultValue={value}
        key={value ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One choice from a few, as radio buttons with nothing preselected: for decisions where a default
 * would be dangerous (pressing Enter submits the form's first button, so a choice of buttons
 * would make the first one the default).
 */
export function ChoiceField({
  name,
  legend,
  options,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string; hint?: string }[];
}) {
  const state = useFormState();
  const error = state.fieldErrors?.[name];
  const id = useFieldId(name);
  return (
    <fieldset
      id={id}
      className="px-fieldset"
      tabIndex={-1}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend>{legend}</legend>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      {options.map((o) => (
        <label key={o.value} className="px-check">
          <input
            type="radio"
            name={name}
            value={o.value}
            required
            aria-describedby={o.hint ? `${id}-${o.value}-hint` : undefined}
            defaultChecked={state.values?.[name] === o.value}
          />
          <span>{o.label}</span>
          {o.hint && (
            <span id={`${id}-${o.value}-hint`} className="sx-help">
              {o.hint}
            </span>
          )}
        </label>
      ))}
    </fieldset>
  );
}
