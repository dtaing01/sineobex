'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { AddField, AddSection } from '@/components/presets/AddField';
import { CopySection, type CopySource } from '@/components/presets/CopySection';
import { OptionEditor } from '@/components/presets/OptionEditor';
import styles from '@/components/presets/presets.module.css';
import type { NoteTypeEdit, NoteTypeField, NoteTypeRow, NoteTypeSection } from '@/lib/presets';
import { liveAfterDrop, NOTE_TYPE_SENTENCES } from '@/lib/refusals';
import {
  answerKind,
  copyTakenWords,
  domId,
  heldHide,
  heldRename,
  heldTitle,
  kindOf,
  newFieldKind,
  quoted,
  replaceOrAdd,
  valueOf,
  type HeldOp,
} from './held';
import type { PublishAnswer } from './publish/answer';
import editor from './editor.module.css';

/** The API's PresetReason: 3 to 300 characters once trimmed. The API counts it, and refuses. */
const REASON_MAX = 300;

/**
 * What the editor says when no answer it can read came back (a dropped connection, a gateway's error
 * page): only a second Publish can tell whether the version went live.
 */
export const DROPPED =
  'The connection dropped, so we can’t tell whether this version went live. Press Publish again: if it did, you’ll be told which version is live, and nothing is published twice.';

/** A Publish the API refused, as the editor shows it until the next one. */
interface Refused {
  error: string;
  /** The held change it refused, by the editor's number for it. */
  opId?: number;
  /** Another note type whose field the change reaches refused it (rule 5): its title. */
  reachedTitle?: string;
  fieldErrors?: Record<string, string>;
  /** A stale sign-in: where to confirm it's the person, in a tab of its own. */
  reauth?: string;
  /** After a dropped connection, a newer version is live: the page loads it on request. */
  load?: number;
}

/** What the editor knows of the note type: the list row its page first drew. */
export interface EditorProps {
  row: NoteTypeRow;
  /** Every other note type's title by key: a refusal from a field another one holds names it. */
  titles: Readonly<Record<string, string>>;
  /** The other note types a section can be copied from, with their sections (CopySection). */
  sources: readonly CopySource[];
}

/** The words a person types for a label or a title, sent as typed: the API refuses empty words. */
function RenameForm({
  id,
  label,
  current,
  onKeep,
  onCancel,
}: {
  id: string;
  label: string;
  current: string;
  onKeep: (words: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Opened from its Rename button, it takes focus, so typing starts at once.
  useEffect(() => input.current?.focus(), []);
  const keep = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onKeep(input.current?.value ?? '');
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
              if (e.key === 'Escape') {
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
          Keep this change
        </button>
        <button type="button" className="sx-btn sx-btn--secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** What the editor offers on a part: its operations, or 8.1's sentence where it is protected. */
interface PartActs {
  /** Holds a change, saying it; `replacing` is a held change it takes the place of. */
  hold: (op: NoteTypeEdit, said: string, replacing?: HeldOp) => void;
  /** Takes a held change back, saying so. */
  undo: (h: HeldOp, said?: string) => void;
  held: readonly HeldOp[];
}

/**
 * Rename and Hide for one field or section, keyboard first: Rename opens a box with its words and
 * takes focus there, and Keep or Cancel gives it back to Rename; Hide holds the change and keeps
 * focus on the same button, which then says Show again and takes it back. A part a held change
 * hides offers only Show again.
 */
function PartControls({
  path,
  name,
  what,
  acts,
}: {
  path: string;
  name: string;
  /** "the section" or "the field", read after each button's word. */
  what: string;
  acts: PartActs;
}) {
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  // Set as the box closes, so focus goes back to Rename once it is drawn again.
  const focusRename = useRef(false);
  useEffect(() => {
    if (!renaming && focusRename.current) {
      focusRename.current = false;
      renameButton.current?.focus();
    }
  }, [renaming]);
  const renamed = heldRename(acts.held, path);
  const hidden = heldHide(acts.held, path);
  const now = renamed ? String(valueOf(renamed, 'label')) : name;
  const close = () => {
    focusRename.current = true;
    setRenaming(false);
  };
  const keep = (words: string) => {
    if (words === name) {
      if (renamed) acts.undo(renamed, `Undone: rename of ${what} ${quoted(name)}`);
    } else if (words !== now || !renamed)
      acts.hold(
        { op: 'rename_label', path, label: words },
        `Rename ${what} ${quoted(name)} to ${quoted(words)}`,
        renamed,
      );
    close();
  };
  return (
    <div className={editor.controls}>
      {renaming ? (
        <RenameForm
          id={`rename-${domId(path)}`}
          label={`New words for ${what} ${quoted(name)}`}
          current={now}
          onKeep={keep}
          onCancel={close}
        />
      ) : (
        <div className={styles.moves}>
          {!hidden && (
            <button
              ref={renameButton}
              type="button"
              className="sx-btn sx-btn--secondary"
              onClick={() => setRenaming(true)}
            >
              Rename<span className="sr-only"> {`${what} ${quoted(name)}`}</span>
            </button>
          )}
          {/* Its words say what a press does, Hide or Show again, so it is no toggle (no aria-pressed),
              whose name would have to stay the same (WCAG 4.1.2); the status line says what is held. */}
          <button
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={() =>
              hidden
                ? acts.undo(hidden, `Shown again: ${what} ${quoted(name)}`)
                : acts.hold({ op: 'set_hidden', path, hidden: true }, `Hide ${what} ${quoted(name)}`)
            }
          >
            {hidden ? 'Show again' : 'Hide'}
            <span className="sr-only"> {`${what} ${quoted(name)}`}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** What a held change does to a part, said under its name. */
function HeldLines({ path, acts }: { path: string; acts: PartActs }) {
  const renamed = heldRename(acts.held, path);
  const hidden = heldHide(acts.held, path);
  if (!renamed && !hidden) return null;
  return (
    <p className={editor.held}>
      {renamed && <>Renamed to {quoted(String(valueOf(renamed, 'label')))} when you publish. </>}
      {hidden && <>Hidden when you publish.</>}
    </p>
  );
}

/** The fields of a section or a group, each with its kind, what is held for it, and its acts. */
function FieldRows({
  fields,
  within,
  protectedFields,
  acts,
  options,
}: {
  fields: readonly NoteTypeField[];
  /** The path of the section or group they are in. */
  within: string;
  protectedFields: ReadonlySet<string>;
  acts: PartActs;
  /** Draws a choice field's answers (P4-editor-options), given its path. */
  options?: (field: NoteTypeField, path: string) => ReactNode;
}) {
  return (
    <ul className={editor.fields}>
      {fields.map((field) => {
        const path = `${within}.${field.id}`;
        const isProtected = protectedFields.has(path);
        return (
          <li key={field.id} className={editor.field}>
            <span className={editor.fieldName}>{field.label}</span>
            <span className="sx-help">{kindOf(field)}</span>
            <HeldLines path={path} acts={acts} />
            {isProtected ? (
              <p className="sx-help">{NOTE_TYPE_SENTENCES.protectedPart}</p>
            ) : (
              <PartControls path={path} name={field.label} what="the field" acts={acts} />
            )}
            {field.kind === 'choice' && !heldHide(acts.held, path) && options?.(field, path)}
            {field.kind === 'group' && field.fields && !heldHide(acts.held, path) && (
              <FieldRows
                fields={field.fields}
                within={path}
                protectedFields={protectedFields}
                acts={acts}
                {...(options ? { options } : {})}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One section: its title, what is held for it, Rename and Hide or 8.1's sentence, and its fields
 * behind a button, so a note type of thirty sections reads as thirty headings. `after` draws what
 * the editor places at its end (adding a field, P4-editor-options).
 */
function SectionBlock({
  section,
  protectedSections,
  protectedFields,
  acts,
  options,
  after,
}: {
  section: NoteTypeSection;
  protectedSections: ReadonlySet<string>;
  protectedFields: ReadonlySet<string>;
  acts: PartActs;
  options?: (field: NoteTypeField, path: string) => ReactNode;
  after?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = domId(section.id);
  const hidden = heldHide(acts.held, section.id);
  return (
    <section aria-labelledby={`section-${id}`} className="px-panel">
      <h2 id={`section-${id}`} className="px-h2">
        {section.title}
      </h2>
      <HeldLines path={section.id} acts={acts} />
      {protectedSections.has(section.id) ? (
        <p className="sx-help">{NOTE_TYPE_SENTENCES.protectedPart}</p>
      ) : (
        <PartControls path={section.id} name={section.title} what="the section" acts={acts} />
      )}
      {!hidden && (
        <div>
          <button
            type="button"
            className="sx-btn sx-btn--ghost"
            aria-expanded={open}
            {...(open ? { 'aria-controls': `fields-${id}` } : {})}
            onClick={() => setOpen((now) => !now)}
          >
            {open ? 'Close its fields' : `Show its fields (${section.fields.length})`}
            <span className="sr-only"> {`of ${quoted(section.title)}`}</span>
          </button>
        </div>
      )}
      {open && !hidden && (
        <div id={`fields-${id}`} className={editor.open}>
          <FieldRows
            fields={section.fields}
            within={section.id}
            protectedFields={protectedFields}
            acts={acts}
            {...(options ? { options } : {})}
          />
          {after}
        </div>
      )}
      <HeldHere section={section} held={acts.held} />
    </section>
  );
}

/**
 * What the held changes add to a section, or after it, said in its panel without opening it: the
 * changes themselves, with Undo, are in Changes to publish.
 */
function HeldHere({ section, held }: { section: NoteTypeSection; held: readonly HeldOp[] }) {
  const fields = held.filter((h) => h.op.op === 'add_field' && valueOf(h, 'sectionId') === section.id);
  const after = held.filter(
    (h) =>
      (h.op.op === 'add_section' || h.op.op === 'copy_section') &&
      valueOf(h, 'afterSectionId') === section.id,
  );
  if (fields.length === 0 && after.length === 0) return null;
  return (
    <ul className={`px-list ${editor.held}`}>
      {fields.map((h) => (
        <li key={h.id}>
          A new field when you publish: {quoted(String(valueOf(h, 'label')))} (
          {newFieldKind(h.op as unknown as { kind: string; many?: unknown })}).
        </li>
      ))}
      {after.map((h) => (
        <li key={h.id}>A new section after this one when you publish: {h.said}.</li>
      ))}
    </ul>
  );
}

/**
 * The type's own title, with Rename. A note type every part of which is protected, its title
 * included (the list's `protected.whole`: the Red flags note), gets no editor (page.tsx), so the
 * title is offered on every note type the editor is drawn for.
 */
function TitleBlock({ title, acts }: { title: string; acts: PartActs }) {
  const [renaming, setRenaming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const focusBack = useRef(false);
  useEffect(() => {
    if (!renaming && focusBack.current) {
      focusBack.current = false;
      button.current?.focus();
    }
  }, [renaming]);
  const renamed = acts.held.find((h) => h.op.op === 'rename_type');
  const now = heldTitle(acts.held) ?? title;
  const close = () => {
    focusBack.current = true;
    setRenaming(false);
  };
  const keep = (words: string) => {
    if (words === title) {
      if (renamed) acts.undo(renamed, `Undone: rename of the note type`);
    } else if (words !== now || !renamed)
      acts.hold({ op: 'rename_type', title: words }, `Rename the note type to ${quoted(words)}`, renamed);
    close();
  };
  return (
    <section aria-labelledby="note-type-title" className="px-panel">
      <h2 id="note-type-title" className="px-h2">
        Title
      </h2>
      <p>{title}</p>
      {renamed && <p className={editor.held}>Renamed to {quoted(now)} when you publish.</p>}
      {renaming ? (
        <RenameForm id="rename-title" label="New title" current={now} onKeep={keep} onCancel={close} />
      ) : (
        <div className={styles.moves}>
          <button
            ref={button}
            type="button"
            className="sx-btn sx-btn--secondary"
            onClick={() => setRenaming(true)}
          >
            Rename<span className="sr-only"> the note type</span>
          </button>
        </div>
      )}
    </section>
  );
}

/** The editor's context for its parts: what is held, and how to hold and undo a change. */
export interface EditorContext extends PartActs {
  opened: NoteTypeRow;
}

/**
 * The note type editor (phase 5 design 5.4, 8.1): the sections, fields and options of the version
 * the page first drew, with Rename, Hide and Show again, each change held here until Publish, which
 * posts them in the order made, with a reason, to the page's route handler (D115). It holds no rule
 * of its own (D114): what is protected is the list's `protected`, said as "This part can’t be
 * changed."; whether a change may be made is the API's, which refuses one by its place in what was
 * sent, and the editor says it beside that change and in the alert that takes focus, naming it.
 *
 * The version it opened is kept for the life of the page, as Co-sign keeps its plan (D115): a later
 * render of a newer version says so and is never published over unseen, and a Publish sent again
 * after a dropped connection is refused stale rather than made twice.
 */
export function NoteTypeEditor({ row, titles, sources }: EditorProps) {
  // The row of the first render, for the life of the page: later renders are never sent (D115).
  const [opened] = useState(row);
  const [held, setHeld] = useState<HeldOp[]>([]);
  const nextId = useRef(1);
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState<Refused | null>(null);
  const [tries, setTries] = useState(0);
  const [reason, setReason] = useState('');
  const [sending, startSending] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = sending || leaving;
  const alert = useRef<HTMLDivElement>(null);
  const heldHeading = useRef<HTMLHeadingElement>(null);
  const undoButtons = useRef(new Map<number, HTMLButtonElement>());
  // The last Publish got no answer the editor could read: the next stale answer may be its own.
  const dropped = useRef(false);
  // Where focus goes once the list is drawn without the change an Undo took back.
  const focusAfterUndo = useRef<number | 'heading' | null>(null);

  useEffect(() => {
    if (refused) alert.current?.focus();
  }, [refused, tries]);
  useEffect(() => {
    const to = focusAfterUndo.current;
    if (to === null) return;
    focusAfterUndo.current = null;
    if (to === 'heading') heldHeading.current?.focus();
    else undoButtons.current.get(to)?.focus();
  }, [held]);

  const count = (n: number) => (n === 1 ? '1 change to publish' : `${n} changes to publish`);
  const hold = (op: NoteTypeEdit, words: string, replacing?: HeldOp) => {
    const next = replaceOrAdd(held, replacing, { id: nextId.current++, op, said: words });
    setHeld(next);
    setSaid(`Held: ${words}. ${count(next.length)}.`);
  };
  const undo = (h: HeldOp, words = `Undone: ${h.said}`) => {
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next);
    setSaid(`${words}. ${next.length === 0 ? 'Nothing to publish.' : `${count(next.length)}.`}`);
    if (refused?.opId === h.id) setRefused(null);
  };
  /** Undo from the list: focus goes to the next change's Undo, else the one before, else the heading. */
  const undoFromList = (h: HeldOp) => {
    const at = held.findIndex((x) => x.id === h.id);
    const neighbour = held[at + 1] ?? held[at - 1];
    focusAfterUndo.current = neighbour ? neighbour.id : 'heading';
    undo(h);
  };
  const ctx: EditorContext = { opened, held, hold, undo };

  const { definition } = opened;
  const protectedSections = new Set(opened.protected.sections);
  const protectedFields = new Set(opened.protected.fields);
  const protectedOptions = new Map<string, Set<string>>();
  for (const { path, code } of opened.protected.options)
    protectedOptions.set(path, (protectedOptions.get(path) ?? new Set()).add(code));
  const changed = row.version !== opened.version;
  const answers = (field: NoteTypeField, path: string) => (
    <OptionEditor
      path={path}
      label={field.label}
      options={field.options ?? []}
      fieldProtected={protectedFields.has(path)}
      protectedCodes={protectedOptions.get(path) ?? new Set()}
      acts={ctx}
    />
  );
  const startHeld = held.filter(
    (h) => (h.op.op === 'add_section' || h.op.op === 'copy_section') && valueOf(h, 'afterSectionId') === null,
  );

  function leave(to: string) {
    setLeaving(true);
    window.location.assign(to);
  }

  function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const sent = held;
    setRefused(null);
    startSending(async () => {
      let answer: PublishAnswer;
      try {
        const response = await fetch(`/team/presets/note-types/${opened.key}/publish`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseVersion: opened.version, ops: sent.map((h) => h.op), reason }),
          cache: 'no-store',
          redirect: 'manual',
        });
        const kind = answerKind({ type: response.type, contentType: response.headers.get('content-type') });
        // Sent to sign-in on the way (the session ended): the page itself goes there.
        if (kind === 'session_ended') {
          setLeaving(true);
          window.location.reload();
          return;
        }
        // Not the route handler's answer: whether the version went live can't be told, so what is
        // held stays, as for a dropped connection.
        if (kind === 'unknown') throw new Error('an answer that is not the editor’s');
        answer = (await response.json()) as PublishAnswer;
      } catch {
        dropped.current = true;
        setRefused({ error: DROPPED });
        setTries((n) => n + 1);
        return;
      }
      const afterDrop = dropped.current;
      dropped.current = false;
      if (answer.ok) {
        // A full load, not a client navigation: the editor starts afresh on the version made.
        const also = answer.alsoPublished.length > 0 ? `&also=${answer.alsoPublished.join(',')}` : '';
        leave(`/team/presets/note-types/${opened.key}?published=${answer.version}${also}`);
        return;
      }
      if ('redirect' in answer) {
        // A fresh sign-in is asked for in a tab of its own, so what is held here stays (8.1's
        // reauth_required, without losing the changes). Anything else ended the session.
        if (answer.redirect.startsWith('/reauth')) setRefused({ error: REAUTH, reauth: answer.redirect });
        else leave(answer.redirect);
        setTries((n) => n + 1);
        return;
      }
      // Sent again after a dropped connection, a newer version is live: it may be this Publish's own.
      if (answer.code === 'stale' && afterDrop && (answer.currentVersion ?? 0) > opened.version) {
        setRefused({ error: liveAfterDrop(answer.currentVersion!), load: answer.currentVersion! });
        setTries((n) => n + 1);
        return;
      }
      const op = answer.opIndex === undefined ? undefined : sent[answer.opIndex];
      setRefused({
        error:
          answer.code === 'id_taken' && op?.op.op === 'copy_section'
            ? copyTakenWords(definition.sections, valueOf(op, 'sectionId'))
            : answer.error,
        ...(op ? { opId: op.id } : {}),
        ...(answer.noteTypeKey ? { reachedTitle: titles[answer.noteTypeKey] ?? answer.noteTypeKey } : {}),
        ...(answer.fieldErrors ? { fieldErrors: answer.fieldErrors } : {}),
      });
      setTries((n) => n + 1);
    });
  }

  const refusedOp = refused?.opId === undefined ? undefined : held.find((h) => h.id === refused.opId);
  const refusedAt = refusedOp ? held.indexOf(refusedOp) : -1;
  const reached = refused?.reachedTitle
    ? ` It reaches the same question in ${quoted(refused.reachedTitle)}, where it can’t be made.`
    : '';
  const reasonError = refused?.fieldErrors?.reason;

  return (
    <div className={editor.editor}>
      <p id="editor-said" role="status" className="sr-only">
        {said}
      </p>
      {changed && (
        <p role="status" className="px-alert px-alert--info">
          Someone else published version {row.version} while you were editing, so your changes here would be
          refused. <a href={`/team/presets/note-types/${opened.key}`}>Load their version</a>.
        </p>
      )}
      <dl className="px-facts">
        <div>
          <dt>Version you’re editing</dt>
          <dd>{opened.version}</dd>
        </div>
      </dl>
      <TitleBlock title={definition.title} acts={ctx} />

      <section aria-labelledby="held-heading" className="px-panel">
        <h2 id="held-heading" ref={heldHeading} tabIndex={-1} className="px-h2">
          Changes to publish ({held.length})
        </h2>
        {refused && (
          <div ref={alert} tabIndex={-1} role="alert" className="px-alert px-alert--error">
            <p className="px-alert__title">
              {refusedOp
                ? `Change ${refusedAt + 1}, ${refusedOp.said}: ${refused.error}${reached}`
                : refused.error}
            </p>
            {refusedOp && (
              <p>
                <a href={`#held-${refusedOp.id}`}>Go to change {refusedAt + 1}</a>
              </p>
            )}
            {refused.reauth && (
              <p>
                <a href={refused.reauth} target="_blank" rel="noopener noreferrer">
                  Confirm it’s you (opens in a new tab)
                </a>
              </p>
            )}
            {refused.load !== undefined && (
              <p>
                <a href={`/team/presets/note-types/${opened.key}`}>Load version {refused.load}</a>
              </p>
            )}
            {refused.fieldErrors && (
              <ul>
                {Object.entries(refused.fieldErrors).map(([name, message]) => (
                  <li key={name}>
                    <a href={`#publish-${name}`}>{message}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {held.length === 0 ? (
          <p>Nothing yet. Each change you make below is held here until you publish it.</p>
        ) : (
          <ol className={editor.heldList}>
            {held.map((h) => (
              <li key={h.id} id={`held-${h.id}`} className={editor.heldItem}>
                <span>{h.said}</span>
                {refused?.opId === h.id && (
                  <span id={`held-${h.id}-refused`} className="sx-help sx-help--error">
                    {refused.error}
                    {reached}
                  </span>
                )}
                <button
                  type="button"
                  ref={(el) => {
                    if (el) undoButtons.current.set(h.id, el);
                    else undoButtons.current.delete(h.id);
                  }}
                  className="sx-btn sx-btn--secondary"
                  {...(refused?.opId === h.id ? { 'aria-describedby': `held-${h.id}-refused` } : {})}
                  onClick={() => undoFromList(h)}
                >
                  Undo<span className="sr-only"> {h.said}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <form className="px-form" onSubmit={publish} aria-label="Publish the changes" noValidate>
          <div className="px-field">
            <label htmlFor="publish-reason">Reason</label>
            {reasonError && (
              <p id="publish-reason-error" className="sx-help sx-help--error">
                {reasonError}
              </p>
            )}
            <div className={`sx-input${reasonError ? ' sx-input--error' : ''}`}>
              <input
                id="publish-reason"
                name="reason"
                type="text"
                required
                aria-required
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={[reasonError ? 'publish-reason-error' : null, 'publish-reason-hint']
                  .filter(Boolean)
                  .join(' ')}
                autoComplete="off"
                maxLength={REASON_MAX}
                size={10}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <p id="publish-reason-hint" className="sx-help">
              Don’t put patient names here.
            </p>
          </div>
          <p className="sx-help">
            Publishing makes a new version. Notes already started stay on the version they began on.
          </p>
          <div className="px-actions">
            <button
              type="submit"
              className="sx-btn sx-btn--primary"
              aria-disabled={busy}
              onClick={(e) => {
                if (busy) e.preventDefault();
              }}
            >
              {busy ? 'Working…' : 'Publish'}
            </button>
          </div>
        </form>
      </section>

      {startHeld.length > 0 && (
        <ul className={`px-list ${editor.held}`}>
          {startHeld.map((h) => (
            <li key={h.id}>A new section at the start when you publish: {h.said}.</li>
          ))}
        </ul>
      )}
      {definition.sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          protectedSections={protectedSections}
          protectedFields={protectedFields}
          acts={ctx}
          options={answers}
          after={protectedSections.has(section.id) ? null : <AddField section={section} acts={ctx} />}
        />
      ))}
      <AddSection sections={definition.sections} acts={ctx} />
      {sources.length > 0 && <CopySection sources={sources} sections={definition.sections} acts={ctx} />}
    </div>
  );
}

/** A stale sign-in at Publish: confirmed in a tab of its own, so the held changes stay here. */
const REAUTH =
  'Confirm it’s you before you publish: it’s been a while since you signed in. Your changes stay on this page while you do. Then press Publish again.';
