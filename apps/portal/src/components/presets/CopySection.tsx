'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { quoted } from '@/app/(app)/team/presets/note-types/[key]/held';
import editor from '@/app/(app)/team/presets/note-types/[key]/editor.module.css';
import type { NoteTypeSection } from '@/lib/presets';
import { WhereBox } from './AddField';
import type { HeldActs } from './OptionEditor';
import styles from './presets.module.css';

/** A note type a section can be copied from: its key, title and sections, as the list gave them. */
export interface CopySource {
  key: string;
  title: string;
  sections: readonly Pick<NoteTypeSection, 'id' | 'title'>[];
}

/**
 * Copy a section (design 5.4's `copy_section`; BM-75): one section, unchanged with its fields,
 * answers and marks, from a platform note type or another of the team's, held until Publish. Every
 * other note type is offered, and each of its sections: whether one can be copied here is the API's
 * to say (D114). It refuses a section from a note type for other visits, another timeline group or
 * other readers with 8.1's sentence ("This section comes from a note type for other visits or other
 * readers, so it can’t be copied here."), one only a credential may fill, and one this note type
 * held before, each beside the change.
 */
export function CopySection({
  sources,
  sections,
  acts,
}: {
  sources: readonly CopySource[];
  /** This note type's sections, for where the copy goes. */
  sections: readonly NoteTypeSection[];
  acts: HeldActs;
}) {
  const [shown, setShown] = useState(false);
  const [from, setFrom] = useState(sources[0]?.key ?? '');
  const opener = useRef<HTMLButtonElement>(null);
  const firstBox = useRef<HTMLSelectElement>(null);
  const focus = useRef<'opener' | 'form' | null>(null);
  useEffect(() => {
    const to = focus.current;
    if (to === null) return;
    focus.current = null;
    if (to === 'opener') opener.current?.focus();
    else firstBox.current?.focus();
  }, [shown]);
  const source = sources.find((s) => s.key === from);
  const hold = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const sectionId = String(form.get('sectionId') ?? '');
    const copied = source?.sections.find((s) => s.id === sectionId);
    const after = String(form.get('after') ?? '');
    const where = sections.find((s) => s.id === after);
    if (!source || !copied) return;
    acts.hold(
      {
        op: 'copy_section',
        fromKey: source.key,
        sectionId: copied.id,
        afterSectionId: where ? where.id : null,
      },
      `Copy the section ${quoted(copied.title)} from ${quoted(source.title)} ${where ? `after ${quoted(where.title)}` : 'at the start'}`,
    );
    focus.current = 'opener';
    setShown(false);
  };
  return (
    <section aria-labelledby="copy-section-heading" className="px-panel">
      <h2 id="copy-section-heading" className="px-h2">
        Copy a section
      </h2>
      <p className="sx-help">
        From one of Sineobex’s note types or another of your team’s. It comes as it is, with its fields and
        answers.
      </p>
      <div className={styles.disclosure}>
        <button
          ref={opener}
          type="button"
          className="sx-btn sx-btn--secondary"
          aria-expanded={shown}
          {...(shown ? { 'aria-controls': 'copy-section' } : {})}
          onClick={() => {
            focus.current = shown ? null : 'form';
            setShown((now) => !now);
          }}
        >
          Copy a section
          <span className="sr-only"> from another note type</span>
        </button>
        {shown && (
          <div id="copy-section">
            <form className={editor.form} onSubmit={hold} aria-label="Copy a section" noValidate>
              <div className="px-field">
                <label htmlFor="copy-from">From the note type</label>
                <select
                  id="copy-from"
                  ref={firstBox}
                  className={`px-select ${styles.choose}`}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  {sources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="px-field">
                <label htmlFor="copy-section-id">The section</label>
                {/* A new list for each note type chosen, its first section chosen to start. */}
                <select
                  key={from}
                  id="copy-section-id"
                  name="sectionId"
                  className={`px-select ${styles.choose}`}
                >
                  {(source?.sections ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <WhereBox id="copy-after" sections={sections} />
              <div className="px-actions">
                <button type="submit" className="sx-btn sx-btn--primary">
                  Hold this copy
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
    </section>
  );
}
