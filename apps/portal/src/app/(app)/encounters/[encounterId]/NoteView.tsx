import type { Schemas } from '@sineobex/contract';
import type { ReactNode } from 'react';
import { heldBecauseText, noteState, noteTrail, replacedBy, type TrailEntry } from '@/lib/encounters';
import styles from '../encounters.module.css';

type ReadItem = Schemas['ReadItem'];

/**
 * One answer: its labels, then its value. A corrected answer shows the new value and under it each
 * old one, struck through, with who changed it, when and why (PRD main 460), in the order the
 * corrections were made; a screen reader hears "Replaced: {old value}" (lifecycle 9.7). An answer a
 * correction took away shows no value, only the old one.
 */
function Answer({ item }: { item: ReadItem }) {
  return (
    <div>
      <dt>{item.labels.join(', ')}</dt>
      <dd>
        {item.value === null ? (
          <span className="sr-only">No answer now</span>
        ) : (
          <span className={styles.value}>{item.value}</span>
        )}
        {item.corrections.map((c, i) => (
          <div key={i} className={styles.replaced}>
            <span className="sr-only">Replaced: {c.old ?? 'blank'}</span>
            <del aria-hidden="true">{c.old ?? '(blank)'}</del>
            <span className={styles.meta}>{replacedBy(c)}</span>
            <span className={styles.meta}>Reason: {c.reason}</span>
          </div>
        ))}
      </dd>
    </div>
  );
}

function Answers({ items }: { items: ReadItem[] }) {
  return (
    <dl className={styles.answers}>
      {items.map((item) => (
        <Answer key={item.path} item={item} />
      ))}
    </dl>
  );
}

/**
 * A note's read model (forms 7.1, 8.4): its sections in the definition's order, a repeating
 * section's entries under their titles. It draws what the API laid out for this reader and knows
 * nothing of kinds: what the reader may see was settled before the model was made.
 */
export function ReadModelView({ model }: { model: Schemas['ReadModel'] }) {
  if (model.sections.length === 0) return <p>Nothing was recorded in this note.</p>;
  return (
    <>
      {model.sections.map((section) => (
        <div key={section.id} className={styles.section}>
          <h3 className="px-h3">{section.title}</h3>
          {section.entries
            ? section.entries.map((entry) => (
                <div key={entry.id} className={styles.entry}>
                  <h4 className={styles.entryTitle}>{entry.title}</h4>
                  <Answers items={entry.items} />
                </div>
              ))
            : section.items && <Answers items={section.items} />}
        </div>
      ))}
    </>
  );
}

/** Sign-offs, attestations, corrections and addenda, in time order (lifecycle 9.7). */
export function Trail({ entries }: { entries: TrailEntry[] }) {
  return (
    <ol className={styles.plain}>
      {entries.map((e) => (
        <li key={e.id}>
          {e.text}
          {e.reason !== undefined && <span className={styles.meta}>Reason: {e.reason}</span>}
          {e.body !== undefined && <p className={styles.typed}>{e.body}</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * A note of the visit, read-only (lifecycle 9.7, 9.11): its title and state, who wrote it, why it
 * waits for someone else when the API says so, its recap, its sections, and what hangs off it; then
 * what the page offers on this note alone (Assign).
 */
export function NoteView({ note, children }: { note: Schemas['VisitNote']; children?: ReactNode }) {
  const heading = `note-${note.noteId}`;
  const state = noteState(note);
  const waiting = (note.status === 'completed' && note.medical) || note.attestation === 'waiting';
  const held = heldBecauseText(note);
  const trail = noteTrail(note);
  // Someone a note was assigned to acts as its author; they did not write it (lifecycle 3.8).
  const assigned = note.actingAuthor.userId !== note.author.userId;

  return (
    <article aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {note.title || 'Note'}
      </h2>
      <p className={styles.state}>
        <span className={`sx-pill ${waiting ? 'sx-pill--info' : 'sx-pill--neutral'}`}>{state}</span>
      </p>
      <p>
        Written by {note.author.displayName}.
        {assigned && ` Assigned to ${note.actingAuthor.displayName}, who acts as its author now.`}
      </p>
      {held && <p className="px-alert px-alert--info">{held}</p>}
      {/* The lines name their answers already: a section's title before each would say it twice. */}
      {note.recap.length > 0 && (
        <div className={styles.section}>
          <h3 className="px-h3">Recap</h3>
          <ul className="px-list">
            {note.recap.map((line, i) => (
              <li key={i}>{line.text}</li>
            ))}
          </ul>
        </div>
      )}
      <ReadModelView model={note.read} />
      {trail.length > 0 && (
        <div className={styles.section}>
          <h3 className="px-h3">Sign-offs and changes</h3>
          <Trail entries={trail} />
        </div>
      )}
      {children}
    </article>
  );
}
