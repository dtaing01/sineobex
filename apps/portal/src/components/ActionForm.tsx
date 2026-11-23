'use client';

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
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

/** How long the done message stays empty before it is said, so the same words are said again. */
const SAY_AFRESH_MS = 100;

/**
 * A form posting to a server action. Errors appear in a summary that takes focus and links to
 * each field (WCAG 3.3.1, 3.3.3); the fields keep what was typed. A done answer's message is said
 * in a status line, emptied and then said again at each answer, so a second save with the same
 * words as the first is heard too (WCAG 4.1.3); focus stays on the button pressed (SubmitButton),
 * and where the answer moved the form in the page, which takes focus with it, it goes to the
 * message.
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
  const status = useRef<HTMLParagraphElement>(null);
  // The message said for an answer, set a moment after it comes: until then each answer's is empty.
  const [said, setSaid] = useState<{ at: ActionState; text: string } | null>(null);
  const saying = said?.at === state ? said.text : '';
  useEffect(() => {
    if (state.error) summary.current?.focus();
    if (!(state.ok && state.message)) return;
    // A list sorted by name or place may move this form when the page is read again, and a node
    // moved in the page loses focus: then the message takes it.
    if (document.activeElement === document.body) status.current?.focus();
    const text = state.message;
    const later = window.setTimeout(() => setSaid({ at: state, text }), SAY_AFRESH_MS);
    return () => window.clearTimeout(later);
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
          <p
            ref={status}
            role="status"
            tabIndex={-1}
            className={saying ? 'px-alert px-alert--ok' : 'sr-only'}
          >
            {saying}
          </p>
        )}
        {children}
      </form>
    </FormState.Provider>
  );
}

/**
 * A form's button. Not disabled while its action is on its way, since a disabled button loses
 * focus to the page: it says so, and a second press does nothing until the answer comes.
 */
export function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();
  const wait = (e: MouseEvent) => {
    if (pending) e.preventDefault();
  };
  return (
    <button type="submit" className={`sx-btn sx-btn--${variant}`} aria-disabled={pending} onClick={wait}>
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
        // The hint is outside the label: inside, it would be read twice, as name and description.
        <div key={o.value} className="px-check">
          <input
            id={`${id}-${o.value}`}
            type="radio"
            name={name}
            value={o.value}
            required
            aria-describedby={o.hint ? `${id}-${o.value}-hint` : undefined}
            defaultChecked={state.values?.[name] === o.value}
          />
          <label htmlFor={`${id}-${o.value}`}>{o.label}</label>
          {o.hint && (
            <span id={`${id}-${o.value}-hint`} className="sx-help">
              {o.hint}
            </span>
          )}
        </div>
      ))}
    </fieldset>
  );
}
