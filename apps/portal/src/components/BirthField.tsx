'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CorrectionState } from '@/app/actions/patients';
import { SelectField, SubmitButton, TextField, useFieldId, useFormState } from '@/components/ActionForm';

/**
 * A date of birth typed the way people say it, read back in words before it is saved (design
 * 11.3, 12.2). The server action parses it with the same rule as the phone and answers with the
 * read-back; the form then shows it under its own heading, with the rest of the form (`children`)
 * and a Save button. "Change the date" goes back to the typed text.
 */
export function BirthField({ children }: { children: ReactNode }) {
  const state = useFormState() as CorrectionState;
  // The answer the person chose to change; a new answer from the server asks again.
  const [changing, setChanging] = useState<CorrectionState | null>(null);
  const confirming = !!state.readBack && changing !== state;
  const heading = useRef<HTMLHeadingElement>(null);
  const inputId = useFieldId('birthText');

  useEffect(() => {
    if (state.readBack && !state.error) heading.current?.focus();
  }, [state]);
  useEffect(() => {
    if (changing) document.getElementById(inputId)?.focus();
  }, [changing, inputId]);

  return (
    <>
      {confirming ? (
        <div className="px-form">
          <input type="hidden" name="birthText" value={state.values?.birthText ?? ''} />
          <input type="hidden" name="birthMode" value={state.values?.birthMode ?? 'date'} />
          <input type="hidden" name="step" value="save" />
          <h3 ref={heading} tabIndex={-1} className="px-h3">
            Check the date of birth
          </h3>
          <p className="px-warn">{state.readBack}</p>
          <p>Is this what the patient gave? If not, change it before saving.</p>
          <div className="px-actions">
            <button type="button" className="sx-btn sx-btn--secondary" onClick={() => setChanging(state)}>
              Change the date
            </button>
          </div>
        </div>
      ) : (
        <div className="px-form">
          <input type="hidden" name="step" value="check" />
          <SelectField
            name="birthMode"
            label="The patient gave"
            // Short: a select is as wide as its longest option, however narrow the screen (1.4.10).
            options={[
              { value: 'date', label: 'A date or a year' },
              { value: 'age', label: 'Only their age' },
            ]}
          />
          <TextField
            name="birthText"
            label="Date of birth or age"
            hint="Month first, for example 3/7/1946, 030746 or 1946. For an age, the number of years."
            autoComplete="off"
            maxLength={12}
            required
          />
        </div>
      )}
      {children}
      <div className="px-actions">
        <SubmitButton>{confirming ? 'Save' : 'Check the date'}</SubmitButton>
      </div>
    </>
  );
}
