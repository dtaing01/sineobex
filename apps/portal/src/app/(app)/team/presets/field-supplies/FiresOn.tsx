'use client';

import { useState } from 'react';
import { useFieldId, useFormState } from '@/components/ActionForm';
import { answerKey } from '@/components/presets/answer';
import styles from '@/components/presets/presets.module.css';
import { choiceKey, type AnswerChoice } from './fields';

/** 8.1's hint, under the field a mapping fires on. */
export const FIELD_HINT =
  'Map the answer that means something was given, not the question that asks about it.';

/** A field or grid cell a new mapping may fire on, with the answers the form offers for it. */
export interface OfferedPlace {
  path: string;
  section: string;
  label: string;
  answers: readonly AnswerChoice[];
}

/** A note type a new mapping may be for, with its fields in the order its notes show them. */
export interface OfferedNoteType {
  key: string;
  title: string;
  places: readonly OfferedPlace[];
}

/** The answer a refused form sent, as a choice, or null when it sent none. */
function sentChoice(sent: Record<string, string> | undefined): Pick<AnswerChoice, 'kind' | 'value'> | null {
  const kind = sent?.['when.kind'] ?? '';
  return kind === '' ? null : { kind: kind as AnswerChoice['kind'], value: sent?.['when.value'] ?? '' };
}

/**
 * The answers offered at a field, with the one a refused form sent there when it is none of them,
 * so the form keeps what it sent and the API's answer about it reads against it.
 */
function withSent(
  answers: readonly AnswerChoice[],
  sent: Pick<AnswerChoice, 'kind' | 'value'> | null,
): AnswerChoice[] {
  if (!sent || answers.some((a) => choiceKey(a) === choiceKey(sent))) return [...answers];
  return [...answers, { ...sent, label: sent.value || 'Any answer' }];
}

/**
 * Where a new mapping fires (design 4.4, 8.1): its note type, then a field or a grid's cell and the
 * answer there, or Every note of this type. The fields a note type offers change with the note type
 * chosen, and the answers with the field, so the three are chosen here, in the browser; what is
 * posted is the body's own fields, `noteTypeKey`, `path`, `when.kind` and `when.value`, so the API's
 * answer about each is said beside it. A refused form starts again from what it sent, an added one
 * from nothing.
 */
export function FiresOn({ noteTypes }: { noteTypes: readonly OfferedNoteType[] }) {
  const state = useFormState();
  return <Choices key={answerKey(state)} noteTypes={noteTypes} />;
}

/**
 * Each select is drawn with its choice and left to the browser after, its changes followed here: React
 * resets a form once its action answers, which takes a select it controls back to its first option,
 * and one drawn with its choice back to that one, the choice a refused form sent. A select whose
 * options follow another's is drawn afresh when they change.
 */
function Choices({ noteTypes }: { noteTypes: readonly OfferedNoteType[] }) {
  const sent = useFormState().values;
  const [noteTypeKey, setNoteTypeKey] = useState(sent?.noteTypeKey ?? '');
  const [path, setPath] = useState(sent?.path ?? '');
  const [answer, setAnswer] = useState(() => {
    const was = sentChoice(sent);
    return was ? choiceKey(was) : '';
  });
  const noteType = noteTypes.find((n) => n.key === noteTypeKey);
  const place = noteType?.places.find((p) => p.path === path);
  // What a refused form sent at its field is offered there while that field is the one chosen.
  const answers =
    path === ''
      ? []
      : withSent(
          place?.answers ?? [],
          path === (sent?.path ?? '') && noteTypeKey === (sent?.noteTypeKey ?? '') ? sentChoice(sent) : null,
        );
  const chosen = answers.find((a) => choiceKey(a) === answer) ?? answers[0];
  return (
    <>
      <NoteTypeField
        noteTypes={noteTypes}
        value={noteTypeKey}
        onChange={(key) => {
          setNoteTypeKey(key);
          setPath('');
          setAnswer('');
        }}
      />
      <PlaceField
        // Drawn afresh with each note type's fields, from Every note of this type.
        key={noteTypeKey}
        places={noteType?.places ?? []}
        value={path}
        onChange={(to) => {
          setPath(to);
          setAnswer('');
        }}
      />
      {path !== '' && (
        <AnswerField
          key={`${noteTypeKey}|${path}`}
          answers={answers}
          value={chosen ? choiceKey(chosen) : ''}
          onChange={setAnswer}
        />
      )}
      <input type="hidden" name="when.kind" value={chosen?.kind ?? ''} />
      <input type="hidden" name="when.value" value={chosen?.value ?? ''} />
    </>
  );
}

/** A field's label, its problem the API answered, and the ids that tie them to its control. */
function useField(name: string) {
  const state = useFormState();
  const id = useFieldId(name);
  const error = state.fieldErrors?.[name];
  return { id, error };
}

function Problem({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-error`} className="sx-help sx-help--error">
      {error}
    </p>
  ) : null;
}

function NoteTypeField({
  noteTypes,
  value,
  onChange,
}: {
  noteTypes: readonly OfferedNoteType[];
  value: string;
  onChange: (key: string) => void;
}) {
  const { id, error } = useField('noteTypeKey');
  const known = value === '' || noteTypes.some((n) => n.key === value);
  return (
    <div className="px-field">
      <label htmlFor={id}>Note type</label>
      <Problem id={id} error={error} />
      <select
        id={id}
        name="noteTypeKey"
        className={`px-select ${styles.choose}`}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <option value="">Choose a note type</option>
        {!known && <option value={value}>A note type no longer on the list</option>}
        {noteTypes.map((n) => (
          <option key={n.key} value={n.key}>
            {n.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function PlaceField({
  places,
  value,
  onChange,
}: {
  places: readonly OfferedPlace[];
  value: string;
  onChange: (path: string) => void;
}) {
  const { id, error } = useField('path');
  const sections = [...new Set(places.map((p) => p.section))];
  const known = value === '' || places.some((p) => p.path === value);
  return (
    <div className="px-field">
      <label htmlFor={id}>Field</label>
      <p id={`${id}-hint`} className="sx-help">
        {FIELD_HINT}
      </p>
      <Problem id={id} error={error} />
      <select
        id={id}
        name="path"
        className={`px-select ${styles.choose}`}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ')}
      >
        <option value="">Every note of this type</option>
        {!known && <option value={value}>A field no longer in the note type</option>}
        {sections.map((section) => (
          <optgroup key={section} label={section}>
            {places
              .filter((p) => p.section === section)
              .map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/**
 * The answer a mapping fires on at its field (8.1), posted as `when.kind` and `when.value` from the
 * choice made here; the API's answer about it (`when`) is said beside it.
 */
export function AnswerField({
  answers,
  value,
  onChange,
}: {
  answers: readonly AnswerChoice[];
  value: string;
  onChange: (key: string) => void;
}) {
  const { id, error } = useField('when');
  return (
    <div className="px-field">
      <label htmlFor={id}>Answer</label>
      <Problem id={id} error={error} />
      <select
        id={id}
        className={`px-select ${styles.choose}`}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {answers.map((a) => (
          <option key={choiceKey(a)} value={choiceKey(a)}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The answer of a mapping its edit form changes (design 4.4): its note type and field are fixed when
 * it is made, so only the answer at that field is chosen here, starting from the one it holds, or
 * from what a refused form sent.
 */
export function EditAnswer({ answers, current }: { answers: readonly AnswerChoice[]; current: string }) {
  const state = useFormState();
  return <EditAnswerChoice key={answerKey(state)} answers={answers} current={current} />;
}

function EditAnswerChoice({ answers, current }: { answers: readonly AnswerChoice[]; current: string }) {
  const sent = sentChoice(useFormState().values);
  const offered = withSent(answers, sent);
  const [answer, setAnswer] = useState(sent ? choiceKey(sent) : current);
  const chosen = offered.find((a) => choiceKey(a) === answer) ?? offered[0];
  return (
    <>
      <AnswerField answers={offered} value={chosen ? choiceKey(chosen) : ''} onChange={setAnswer} />
      <input type="hidden" name="when.kind" value={chosen?.kind ?? ''} />
      <input type="hidden" name="when.value" value={chosen?.value ?? ''} />
    </>
  );
}
