'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { domId, newFieldKind, quoted } from '@/app/(app)/team/presets/note-types/[key]/held';
import editor from '@/app/(app)/team/presets/note-types/[key]/editor.module.css';
import type { NoteTypeSection } from '@/lib/presets';
import type { HeldActs } from './OptionEditor';
import styles from './presets.module.css';

/**
 * A field a team adds to a note type (phase 5 design 5.4): words, a choice (Yes or No is a choice
 * with two answers) or a number. Its id and each answer's code are made by the server (rule 3), and
 * it carries no mark (rule 1). Words are sent without the spaces around them; a number is sent as a
 * number when it reads as one, else as typed, so the API answers which change to fix (D114).
 */
export type NewField =
  | { kind: 'text'; label: string; lines: 'one' | 'many'; maxLength: number }
  | { kind: 'choice'; label: string; many: boolean; options: string[] }
  | {
      kind: 'number';
      label: string;
      min: number | string;
      max: number | string;
      decimals: 0 | 1 | 2;
      unit?: string;
    };

/** The lengths a text answer is offered at: phase 4's own, a line of 200 and several of 2,000. */
const LENGTHS = {
  short: { lines: 'one', maxLength: 200, label: 'Short answer, one line' },
  long: { lines: 'many', maxLength: 2000, label: 'Long answer, several lines' },
} as const;

const KINDS = [
  { value: 'text', label: 'Words' },
  { value: 'choice', label: 'A choice of answers' },
  { value: 'yesno', label: 'Yes or No' },
  { value: 'number', label: 'A number' },
] as const;
type Kind = (typeof KINDS)[number]['value'];

const DECIMALS = [
  { value: '0', label: 'Whole numbers' },
  { value: '1', label: 'One decimal place' },
  { value: '2', label: 'Two decimal places' },
] as const;

/** A number as typed: a number when it reads as one, else the text, for the API to answer. */
const typedNumber = (typed: string): number | string => {
  const raw = typed.trim();
  return /^-?\d{1,9}(\.\d{1,6})?$/.test(raw) ? Number(raw) : raw;
};

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

/** The field a form's inputs describe, under `prefix`. */
export function readNewField(form: FormData, prefix: string): NewField {
  const label = text(form, `${prefix}label`).trim();
  const kind = text(form, `${prefix}kind`) as Kind;
  switch (kind) {
    case 'choice':
      return {
        kind: 'choice',
        label,
        many: text(form, `${prefix}many`) === 'many',
        options: form
          .getAll(`${prefix}answer`)
          .map((a) => (typeof a === 'string' ? a.trim() : ''))
          .filter((a) => a !== ''),
      };
    case 'yesno':
      return { kind: 'choice', label, many: false, options: ['Yes', 'No'] };
    case 'number': {
      const unit = text(form, `${prefix}unit`).trim();
      return {
        kind: 'number',
        label,
        min: typedNumber(text(form, `${prefix}min`)),
        max: typedNumber(text(form, `${prefix}max`)),
        decimals: Number(text(form, `${prefix}decimals`) || '0') as 0 | 1 | 2,
        ...(unit ? { unit } : {}),
      };
    }
    default: {
      const length = LENGTHS[text(form, `${prefix}length`) === 'long' ? 'long' : 'short'];
      return { kind: 'text', label, lines: length.lines, maxLength: length.maxLength };
    }
  }
}

/** A choice of a few, as radio buttons, the first chosen to start with. */
function Radios({
  id,
  name,
  legend,
  options,
  onChange,
}: {
  id: string;
  name: string;
  legend: string;
  options: readonly { value: string; label: string }[];
  onChange?: (value: string) => void;
}) {
  return (
    <fieldset className="px-fieldset">
      <legend>{legend}</legend>
      {options.map((o, i) => (
        <div key={o.value} className="px-check">
          <input
            id={`${id}-${o.value}`}
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={i === 0}
            {...(onChange ? { onChange: () => onChange(o.value) } : {})}
          />
          <label htmlFor={`${id}-${o.value}`}>{o.label}</label>
        </div>
      ))}
    </fieldset>
  );
}

/** A box for words, with the warning every free-text box carries. */
function WordsBox({ id, name, label, hint }: { id: string; name: string; label: string; hint?: string }) {
  return (
    <div className="px-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="sx-help">
          {hint}
        </p>
      )}
      <div className="sx-input">
        <input
          id={id}
          name={name}
          type="text"
          autoComplete="off"
          size={10}
          aria-describedby={[hint ? `${id}-hint` : null, `${id}-warning`].filter(Boolean).join(' ')}
        />
      </div>
      <p id={`${id}-warning`} className="sx-help">
        Don’t put patient names here.
      </p>
    </div>
  );
}

/** What a field needs, by its kind: the kind first, then its length, its answers or its numbers. */
function FieldInputs({ id, prefix }: { id: string; prefix: string }) {
  const [kind, setKind] = useState<Kind>('text');
  const [answers, setAnswers] = useState([0, 1]);
  const next = useRef(2);
  const answerBoxes = useRef(new Map<number, HTMLInputElement>());
  const focusAnswer = useRef<number | null>(null);
  useEffect(() => {
    const to = focusAnswer.current;
    if (to === null) return;
    focusAnswer.current = null;
    answerBoxes.current.get(to)?.focus();
  }, [answers]);
  return (
    <>
      <WordsBox id={`${id}-label`} name={`${prefix}label`} label="What it asks" />
      <Radios
        id={`${id}-kind`}
        name={`${prefix}kind`}
        legend="Kind of answer"
        options={KINDS}
        onChange={(v) => setKind(v as Kind)}
      />
      {kind === 'text' && (
        <Radios
          id={`${id}-length`}
          name={`${prefix}length`}
          legend="How long"
          options={[
            { value: 'short', label: LENGTHS.short.label },
            { value: 'long', label: LENGTHS.long.label },
          ]}
        />
      )}
      {kind === 'choice' && (
        <>
          <Radios
            id={`${id}-many`}
            name={`${prefix}many`}
            legend="How many can be chosen"
            options={[
              { value: 'one', label: 'One answer' },
              { value: 'many', label: 'Any number of answers' },
            ]}
          />
          <fieldset className="px-fieldset">
            <legend>Its answers, in order</legend>
            <ol className={editor.options}>
              {answers.map((n, i) => (
                <li key={n} className={editor.option}>
                  <div className="px-field">
                    <label htmlFor={`${id}-answer-${n}`}>Answer {i + 1}</label>
                    <div className="sx-input">
                      <input
                        id={`${id}-answer-${n}`}
                        ref={(el) => {
                          if (el) answerBoxes.current.set(n, el);
                          else answerBoxes.current.delete(n);
                        }}
                        name={`${prefix}answer`}
                        type="text"
                        autoComplete="off"
                        size={10}
                        aria-describedby={`${id}-answers-warning`}
                      />
                    </div>
                  </div>
                  {answers.length > 1 && (
                    <div className={styles.moves}>
                      <button
                        type="button"
                        className="sx-btn sx-btn--secondary"
                        onClick={() => {
                          focusAnswer.current = answers[i + 1] ?? answers[i - 1] ?? null;
                          setAnswers(answers.filter((x) => x !== n));
                        }}
                      >
                        Take out<span className="sr-only"> answer {i + 1}</span>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <p id={`${id}-answers-warning`} className="sx-help">
              Don’t put patient names here.
            </p>
            <div className={styles.moves}>
              <button
                type="button"
                className="sx-btn sx-btn--secondary"
                onClick={() => {
                  const n = next.current++;
                  focusAnswer.current = n;
                  setAnswers([...answers, n]);
                }}
              >
                Add another answer
              </button>
            </div>
          </fieldset>
        </>
      )}
      {kind === 'number' && (
        <>
          <div className="px-field">
            <label htmlFor={`${id}-min`}>Lowest it takes</label>
            <div className="sx-input">
              <input
                id={`${id}-min`}
                name={`${prefix}min`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                size={6}
              />
            </div>
          </div>
          <div className="px-field">
            <label htmlFor={`${id}-max`}>Highest it takes</label>
            <div className="sx-input">
              <input
                id={`${id}-max`}
                name={`${prefix}max`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                size={6}
              />
            </div>
          </div>
          <Radios id={`${id}-decimals`} name={`${prefix}decimals`} legend="How exact" options={DECIMALS} />
          <WordsBox
            id={`${id}-unit`}
            name={`${prefix}unit`}
            label="Unit (optional)"
            hint="Such as cm or days."
          />
        </>
      )}
    </>
  );
}

/** A form the editor opens in place behind a button, giving focus back to it once held or cancelled. */
function OpenedForm({
  id,
  label,
  open,
  name,
  onHold,
  holdWord,
  children,
}: {
  id: string;
  label: string;
  open: string;
  name: string;
  onHold: (form: FormData) => boolean;
  holdWord: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const focus = useRef<'opener' | 'form' | null>(null);
  useEffect(() => {
    const to = focus.current;
    if (to === null) return;
    focus.current = null;
    if (to === 'opener') opener.current?.focus();
    else first.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [shown]);
  const hold = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onHold(new FormData(e.currentTarget))) {
      focus.current = 'opener';
      setShown(false);
    }
  };
  return (
    <div className={styles.disclosure}>
      <button
        ref={opener}
        type="button"
        className="sx-btn sx-btn--secondary"
        aria-expanded={shown}
        {...(shown ? { 'aria-controls': id } : {})}
        onClick={() => {
          focus.current = shown ? null : 'form';
          setShown((now) => !now);
        }}
      >
        {open}
        <span className="sr-only"> {name}</span>
      </button>
      {shown && (
        <div id={id} ref={first}>
          <form className={editor.form} onSubmit={hold} aria-label={label} noValidate>
            {children}
            <div className="px-actions">
              <button type="submit" className="sx-btn sx-btn--primary">
                {holdWord}
              </button>
              <button
                type="button"
                className="sx-btn sx-btn--secondary"
                onClick={() => {
                  focus.current = 'opener';
                  setShown(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * Add a field at the end of a section (design 5.4's `add_field`), held until Publish. The API
 * refuses one past the team's limit, or in a section only a credential may fill, with a sentence
 * beside the change (D114).
 */
export function AddField({ section, acts }: { section: NoteTypeSection; acts: HeldActs }) {
  const id = `add-field-${domId(section.id)}`;
  return (
    <OpenedForm
      id={id}
      label={`Add a field to ${quoted(section.title)}`}
      open="Add a field"
      name={`to ${quoted(section.title)}`}
      holdWord="Hold this field"
      onHold={(form) => {
        const field = readNewField(form, '');
        acts.hold(
          { op: 'add_field', sectionId: section.id, ...field },
          `Add the field ${quoted(field.label)} (${newFieldKind(field)}) to ${quoted(section.title)}`,
        );
        return true;
      }}
    >
      <FieldInputs id={id} prefix="" />
    </OpenedForm>
  );
}

/**
 * Add a section (design 5.4's `add_section`), with its title, where it goes and the field it starts
 * with: a section always holds one (forms 2.2). The team adds more fields once it is published.
 */
export function AddSection({ sections, acts }: { sections: readonly NoteTypeSection[]; acts: HeldActs }) {
  const id = 'add-section';
  return (
    <section aria-labelledby={`${id}-heading`} className="px-panel">
      <h2 id={`${id}-heading`} className="px-h2">
        Add a section
      </h2>
      <OpenedForm
        id={id}
        label="Add a section"
        open="Add a section"
        name="of your own"
        holdWord="Hold this section"
        onHold={(form) => {
          const title = String(form.get('title') ?? '').trim();
          const after = String(form.get('after') ?? '');
          const field = readNewField(form, 'field.');
          const where = sections.find((s) => s.id === after);
          acts.hold(
            { op: 'add_section', title, afterSectionId: where ? where.id : null, fields: [field] },
            `Add the section ${quoted(title)} ${where ? `after ${quoted(where.title)}` : 'at the start'}, starting with the field ${quoted(field.label)} (${newFieldKind(field)})`,
          );
          return true;
        }}
      >
        <WordsBox id={`${id}-title`} name="title" label="Its title" />
        <WhereBox id={`${id}-after`} sections={sections} />
        <fieldset className="px-fieldset">
          <legend>The field it starts with</legend>
          <FieldInputs id={`${id}-field`} prefix="field." />
        </fieldset>
      </OpenedForm>
    </section>
  );
}

/** Where a new or copied section goes: at the start, or after a section, the last one chosen to start. */
export function WhereBox({ id, sections }: { id: string; sections: readonly NoteTypeSection[] }) {
  return (
    <div className="px-field">
      <label htmlFor={id}>Where it goes</label>
      <select
        id={id}
        name="after"
        className={`px-select ${styles.choose}`}
        defaultValue={sections.at(-1)?.id ?? ''}
      >
        <option value="">At the start</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            After {s.title}
          </option>
        ))}
      </select>
    </div>
  );
}
