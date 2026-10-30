'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { decidePair } from '@/app/actions/duplicates';
import {
  ActionForm,
  ChoiceField,
  SubmitButton,
  TextField,
  useFieldId,
  useFormState,
} from '@/components/ActionForm';

/** One of the two records, as the survivor choice and the merge confirmation name it. */
export interface PairRecord {
  id: string;
  /** "Record A: Jon, born 1962, made Oct 2, 2026" */
  label: string;
  older: boolean;
  /** What a merge keeping this record would do (mergeConsequences). */
  consequences: string[];
}

/**
 * Merge, Keep separate or Not sure, with a required comment (design 8.4, 12.2). Nothing is
 * preselected. Merge asks which chart is kept (the older by default) and then shows a
 * confirmation listing what will happen, with its own danger button, before anything is sent.
 */
export function DecisionForm({
  pairId,
  versions,
  records,
}: {
  pairId: string;
  versions: { a: number; b: number };
  records: [PairRecord, PairRecord];
}) {
  return (
    <ActionForm id="decide" action={decidePair} label="Decide on this pair">
      <input type="hidden" name="pairId" value={pairId} />
      {/* The versions the reviewer is looking at: the API refuses the decision if either changed. */}
      <input type="hidden" name="versionA" value={versions.a} />
      <input type="hidden" name="versionB" value={versions.b} />
      <DecisionFields records={records} />
    </ActionForm>
  );
}

function DecisionFields({ records }: { records: [PairRecord, PairRecord] }) {
  const state = useFormState();
  // PLAN-OPEN: merge survivor default (design 14.1, #26): the older record.
  const older = records.find((r) => r.older) ?? records[0];
  const [decision, setDecision] = useState(state.values?.decision);
  const [kept, setKept] = useState(state.values?.survivorId ?? older.id);
  // Each answer from the server resets the form to what it echoed (React resets a form after its
  // action), so the parts shown follow the echo.
  const [answered, setAnswered] = useState(state);
  if (answered !== state) {
    setAnswered(state);
    setDecision(state.values?.decision);
    setKept(state.values?.survivorId ?? older.id);
  }
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const asksToConfirm = state.values?.step === 'confirm';
  useEffect(() => {
    if (state.values?.step === 'confirm') confirmHeading.current?.focus();
  }, [state]);
  const onChange = (e: ChangeEvent<HTMLDivElement>) => {
    const input = e.target as unknown as HTMLInputElement;
    if (input.name === 'decision') setDecision(input.value);
    if (input.name === 'survivorId') setKept(input.value);
  };
  const confirming = decision === 'merge' && asksToConfirm;
  const keptRecord = records.find((r) => r.id === kept) ?? older;
  const otherRecord = records.find((r) => r !== keptRecord)!;

  return (
    // Change events bubble here from the radios, to show the parts each decision needs.
    <div className="px-form" onChange={onChange}>
      <ChoiceField
        name="decision"
        legend="What should happen to this pair?"
        options={[
          {
            value: 'merge',
            label: 'Merge: they are the same person',
            hint: 'One chart is kept and the other record points to it. An admin can undo it.',
          },
          {
            value: 'keep_separate',
            label: 'Keep separate: they are different people',
            hint: 'This pair won’t be suggested again.',
          },
          {
            value: 'not_sure',
            label: 'Not sure',
            hint: 'The pair stays in the queue, with a note for field staff if you write one.',
          },
        ]}
      />
      {decision === 'merge' && <KeptChoice records={records} kept={kept} />}
      <TextField
        name="comment"
        label="Comment"
        hint="Why you decided this. Logged, and shown to anyone who reviews this pair."
        required
        autoComplete="off"
        maxLength={500}
      />
      {decision === 'not_sure' && (
        <TextField
          name="fieldNote"
          label="Note for field staff"
          hint="Shown to field staff on both charts, for example “check the ID card at the next visit”. Don’t include details of the other record."
          autoComplete="off"
          maxLength={200}
        />
      )}
      {confirming && (
        <section aria-labelledby="decide-confirm" className="px-alert px-alert--info">
          <h3 id="decide-confirm" ref={confirmHeading} tabIndex={-1} className="px-h3">
            Check before merging
          </h3>
          <p>
            Keeping {keptRecord.label}. {otherRecord.label} is merged into it.
          </p>
          <ul className="px-list">
            {keptRecord.consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p>An admin can undo the merge from Merges.</p>
          <input type="hidden" name="confirmed" value="yes" />
        </section>
      )}
      <div className="px-actions">
        {confirming ? (
          <SubmitButton variant="danger">Merge records</SubmitButton>
        ) : (
          <SubmitButton>{decision === 'merge' ? 'Continue' : 'Record decision'}</SubmitButton>
        )}
      </div>
    </div>
  );
}

/** Which chart is kept: the older by default (design 8.4), so this one choice has a default. */
function KeptChoice({ records, kept }: { records: [PairRecord, PairRecord]; kept: string }) {
  const state = useFormState();
  const id = useFieldId('survivorId');
  const error = state.fieldErrors?.survivorId;
  return (
    <fieldset
      id={id}
      className="px-fieldset"
      tabIndex={-1}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend>Which chart is kept?</legend>
      {error && (
        <p id={`${id}-error`} className="sx-help sx-help--error">
          {error}
        </p>
      )}
      {records.map((r) => (
        <div key={r.id} className="px-check">
          <input
            id={`${id}-${r.id}`}
            type="radio"
            name="survivorId"
            value={r.id}
            defaultChecked={r.id === kept}
          />
          <label htmlFor={`${id}-${r.id}`}>
            {r.label}
            {r.older ? ' (the older record)' : ''}
          </label>
        </div>
      ))}
    </fieldset>
  );
}
