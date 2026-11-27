'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  domId,
  quoted,
  shownOptions,
  valueOf,
  type HeldOp,
} from '@/app/(app)/team/presets/note-types/[key]/held';
import editor from '@/app/(app)/team/presets/note-types/[key]/editor.module.css';
import type { NoteTypeEdit, NoteTypeOption } from '@/lib/presets';
import { NOTE_TYPE_SENTENCES } from '@/lib/refusals';
import styles from './presets.module.css';

/** What the editor lends its parts: what is held, and how to hold and take back a change. */
export interface HeldActs {
  held: readonly HeldOp[];
  hold: (op: NoteTypeEdit, said: string, replacing?: HeldOp) => void;
  undo: (h: HeldOp, said?: string) => void;
}

/** Where focus goes once the last added answer is undone: the box for a new one. */
const ADD_BOX = 'add-box';

/** "1st", "2nd", "3rd", "4th": where an answer now is, said after a move. */
function nth(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * A box for an answer's words, opened in place of its acts: Keep or Cancel gives focus back. The words
 * are held without the spaces around them, which the API refuses (item 14).
 */
function WordsForm({
  id,
  label,
  current,
  keepWord,
  onKeep,
  onCancel,
}: {
  id: string;
  label: string;
  current: string;
  keepWord: string;
  onKeep: (words: string) => void;
  onCancel?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // A box opened in place of its acts (one that can be cancelled) takes focus as it opens.
  const focusOnOpen = useRef(onCancel !== undefined);
  useEffect(() => {
    if (focusOnOpen.current) input.current?.focus();
  }, []);
  const keep = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onKeep((input.current?.value ?? '').trim());
    if (!onCancel && input.current) {
      // A box that stays open for the next answer starts empty, with focus kept in it.
      input.current.value = '';
      input.current.focus();
    }
  };
  return (
    <form className={editor.inline} onSubmit={keep}>
      <div className="px-field">
        <label htmlFor={id}>{label}</label>
        <div className="sx-input">
          <input
            id={id}
            ref={input}
            type="text"
            defaultValue={current}
            autoComplete="off"
            size={10}
            aria-describedby={`${id}-warning`}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && onCancel) {
                e.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <p id={`${id}-warning`} className="sx-help">
          Don’t put patient names here.
        </p>
      </div>
      <div className="px-actions">
        <button type="submit" className="sx-btn sx-btn--primary">
          {keepWord}
        </button>
        {onCancel && (
          <button type="button" className="sx-btn sx-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * A choice field's answers in the note type editor (phase 5 design 5.4, 8.1): each with Rename,
 * Retire, Move up and Move down (not offered at the ends), or "This part can’t be changed." for an
 * answer the list marks protected; the answers held to be retired, with Keep it; the ones held to be
 * added, with Undo; and Add an answer. Every change is held until Publish, and shown where it puts
 * the answer. Keyboard first: an answer moved keeps focus on its own Move button, or the other one
 * at an end; a retired one gives focus to its Keep it, and Keep it gives it back to Retire; an
 * added one's Undo gives it to the next added one's Undo, else to the box for a new answer; Rename
 * opens a box with its words and gives focus back once kept or cancelled. The API applies each
 * change, also to every field mapped to this one (rule 5), and refuses any it may not make (D114).
 */
export function OptionEditor({
  path,
  label,
  options,
  fieldProtected,
  protectedCodes,
  acts,
}: {
  path: string;
  label: string;
  options: readonly NoteTypeOption[];
  /** The whole field is protected: its answers are listed, and none can be changed. */
  fieldProtected: boolean;
  /** The answers of it the list marks protected. */
  protectedCodes: ReadonlySet<string>;
  acts: HeldActs;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The button to focus once the list is drawn again after a change: `<code>:<act>`.
  const focusNext = useRef<string | null>(null);
  const id = domId(path);
  const { live, retired, added } = shownOptions(options, acts.held, path);
  const field = quoted(label);

  useEffect(() => {
    const to = focusNext.current;
    if (to === null) return;
    focusNext.current = null;
    if (to === ADD_BOX) document.getElementById(`add-answer-${id}`)?.focus();
    else buttons.current.get(to)?.focus();
  });

  const button = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(key, el);
    else buttons.current.delete(key);
  };
  const shown = (o: { label: string; renamed?: HeldOp }) =>
    o.renamed ? String(valueOf(o.renamed, 'label')) : o.label;

  const move = (code: string, up: boolean) => {
    const at = live.findIndex((o) => o.code === code);
    const target = up ? at - 1 : at + 1;
    if (target < 0 || target >= live.length) return;
    // Just before the answer it passes going up; going down, before the one after that, or the end.
    const before = up ? live[at - 1]!.code : (live[at + 2]?.code ?? null);
    const words = quoted(shown(live[at]!));
    acts.hold(
      { op: 'move_option', path, code, before },
      `Move the answer ${words} ${up ? 'up' : 'down'} in ${field}, to ${nth(target + 1)} of ${live.length}`,
    );
    const atEnd = up ? target === 0 : target === live.length - 1;
    focusNext.current = `${code}:${atEnd ? (up ? 'down' : 'up') : up ? 'up' : 'down'}`;
  };

  return (
    <div className={editor.controls}>
      <div>
        <button
          type="button"
          className="sx-btn sx-btn--ghost"
          aria-expanded={open}
          {...(open ? { 'aria-controls': `answers-${id}` } : {})}
          onClick={() => setOpen((now) => !now)}
        >
          {open ? 'Close its answers' : `Show its answers (${options.length})`}
          <span className="sr-only"> {`of ${field}`}</span>
        </button>
      </div>
      {open && (
        <div id={`answers-${id}`} className={editor.open}>
          <ol className={editor.options} aria-label={`Answers of ${field}, in order`}>
            {live.map((o, i) => {
              const words = shown(o);
              const name = quoted(words);
              const isProtected = fieldProtected || protectedCodes.has(o.code);
              return (
                <li key={o.code} className={editor.option}>
                  <span>{o.label}</span>
                  {o.renamed && <p className={editor.held}>Renamed to {name} when you publish.</p>}
                  {fieldProtected ? null : isProtected ? (
                    <p className="sx-help">{NOTE_TYPE_SENTENCES.protectedPart}</p>
                  ) : renaming === o.code ? (
                    <WordsForm
                      id={`rename-${id}-${o.code}`}
                      label={`New words for the answer ${quoted(o.label)}`}
                      current={words}
                      keepWord="Keep this change"
                      onKeep={(next) => {
                        if (next === o.label) {
                          if (o.renamed)
                            acts.undo(o.renamed, `Undone: rename of the answer ${quoted(o.label)}`);
                        } else if (next !== words || !o.renamed)
                          acts.hold(
                            { op: 'rename_option', path, code: o.code, label: next },
                            `Rename the answer ${quoted(o.label)} to ${quoted(next)} in ${field}`,
                            o.renamed,
                          );
                        focusNext.current = `${o.code}:rename`;
                        setRenaming(null);
                      }}
                      onCancel={() => {
                        focusNext.current = `${o.code}:rename`;
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <div className={styles.moves}>
                      <button
                        ref={button(`${o.code}:rename`)}
                        type="button"
                        className="sx-btn sx-btn--secondary"
                        onClick={() => setRenaming(o.code)}
                      >
                        Rename<span className="sr-only"> the answer {name}</span>
                      </button>
                      <button
                        ref={button(`${o.code}:retire`)}
                        type="button"
                        className="sx-btn sx-btn--secondary"
                        onClick={() => {
                          acts.hold(
                            { op: 'retire_option', path, code: o.code },
                            `Retire the answer ${name} from ${field}`,
                          );
                          focusNext.current = `${o.code}:keep`;
                        }}
                      >
                        Retire<span className="sr-only"> the answer {name}</span>
                      </button>
                      {i > 0 && (
                        <button
                          ref={button(`${o.code}:up`)}
                          type="button"
                          className="sx-btn sx-btn--secondary"
                          onClick={() => move(o.code, true)}
                        >
                          Move up<span className="sr-only"> the answer {name}</span>
                        </button>
                      )}
                      {i < live.length - 1 && (
                        <button
                          ref={button(`${o.code}:down`)}
                          type="button"
                          className="sx-btn sx-btn--secondary"
                          onClick={() => move(o.code, false)}
                        >
                          Move down<span className="sr-only"> the answer {name}</span>
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {retired.length > 0 && (
            <>
              <p className={editor.held}>Retired when you publish. Notes that have them keep them.</p>
              <ul className={editor.options}>
                {retired.map(({ option, op }) => (
                  <li key={option.code} className={editor.option}>
                    <span>{option.label}</span>
                    <div className={styles.moves}>
                      <button
                        ref={button(`${option.code}:keep`)}
                        type="button"
                        className="sx-btn sx-btn--secondary"
                        onClick={() => {
                          acts.undo(op, `Kept: the answer ${quoted(option.label)}`);
                          focusNext.current = `${option.code}:retire`;
                        }}
                      >
                        Keep it<span className="sr-only"> the answer {quoted(option.label)}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {added.length > 0 && (
            <>
              <p className={editor.held}>Added at the end when you publish.</p>
              <ul className={editor.options}>
                {added.map((h, i) => (
                  <li key={h.id} className={editor.option}>
                    <span>{String(valueOf(h, 'label'))}</span>
                    <div className={styles.moves}>
                      <button
                        ref={button(`added:${h.id}`)}
                        type="button"
                        className="sx-btn sx-btn--secondary"
                        onClick={() => {
                          // The button goes with it: focus moves on to the next added answer's Undo,
                          // else to the box for a new one, never to the page.
                          const next = added[i + 1];
                          focusNext.current = next ? `added:${next.id}` : ADD_BOX;
                          acts.undo(h);
                        }}
                      >
                        Undo<span className="sr-only"> {h.said}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!fieldProtected && (
            <WordsForm
              id={`add-answer-${id}`}
              label={`A new answer for ${field}`}
              current=""
              keepWord="Add answer"
              onKeep={(words) =>
                acts.hold(
                  { op: 'add_option', path, label: words },
                  `Add the answer ${quoted(words)} to ${field}`,
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
