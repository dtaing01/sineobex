import Link from 'next/link';
import { Fragment } from 'react';
import { noticeKey, PresetNotice } from '@/components/presets/PresetNotice';
import styles from '@/components/presets/presets.module.css';
import { ReviewTable } from '@/components/presets/UpdateOffer';
import { HistoryTable } from '@/components/presets/VersionHistory';
import type { NoteTypeEvent, NoteTypeRow } from '@/lib/presets';
import { usedBy } from '@/lib/refusals';
import { AddNoteType, RemoveNoteType, RestoreNoteType } from './NoteTypeForms';
import { NoteTypeOffer } from './NoteTypeOffer';
import { groupOf, noteTypeReviewRows, readersOf, visitsOf, whoseOf } from './words';

/** The editor's address: a key, never a title (design 7). */
export const editorPath = (key: string) => `/team/presets/note-types/${key}`;

/** Sineobex's update to one note type, placed for every one the page shows: it draws nothing while none is on offer. */
function Offer({ row }: { row: NoteTypeRow }) {
  const { update } = row;
  return (
    <NoteTypeOffer
      noteType={{
        key: row.key,
        title: row.title,
        version: row.version,
        customized: row.customized,
        removed: row.state === 'archived',
      }}
      offer={
        update
          ? { platformVersion: update.platformVersion, changesFixed: update.changesFixed.length > 0 }
          : null
      }
      review={
        update ? (
          <ReviewTable
            rows={noteTypeReviewRows(row.definition, update.definition)}
            name={row.title}
            id={row.key}
          />
        ) : null
      }
    />
  );
}

/**
 * A note type's history as the history route answers it, in the table every preset page draws: who,
 * when, the platform's or the team's, and the reason. A note type's event carries no body.
 */
function History({ row, events }: { row: NoteTypeRow; events: readonly NoteTypeEvent[] }) {
  return (
    <HistoryTable
      events={events.map((e) => ({ ...e, body: {} }))}
      id={row.key}
      heading={`History of ${row.title}`}
      headingLevel={3}
      flat
    />
  );
}

/** One active note type: what it is, what uses it, Edit, Remove, any update, and its history. */
function NoteTypeSection({ row, history }: { row: NoteTypeRow; history?: readonly NoteTypeEvent[] }) {
  const heading = `note-type-${row.key}`;
  const used = usedBy(row.referencedBy);
  const { definition } = row;
  return (
    <section aria-labelledby={heading} className="px-panel">
      <h2 id={heading} className="px-h2">
        {row.title}
      </h2>
      <dl className="px-facts">
        <div>
          <dt>Which visits</dt>
          <dd>{visitsOf(definition.kinds)}</dd>
        </div>
        <div>
          <dt>Timeline group</dt>
          <dd>{groupOf(definition.group)}</dd>
        </div>
        <div>
          <dt>Who may read it</dt>
          <dd>{readersOf(definition.sensitivity)}</dd>
        </div>
        <div>
          <dt>Whose version</dt>
          <dd>
            {whoseOf(row)}, version {row.version}
          </dd>
        </div>
        <div>
          <dt>Used by</dt>
          <dd>{used || 'Nothing yet'}</dd>
        </div>
      </dl>
      <p>
        <Link href={editorPath(row.key)} className="sx-btn sx-btn--secondary">
          Edit<span className="sr-only"> {row.title}</span>
        </Link>
      </p>
      <RemoveNoteType noteType={row} />
      <Offer row={row} />
      {history && <History row={row} events={history} />}
    </section>
  );
}

/**
 * The Removed list: the team's archived note types, each with Restore and a reason, and Sineobex's
 * update offered as a new one where there is one (5.1). Every version still reads, and a note begun
 * on one still finishes (5.4). Nothing is drawn while nothing is removed.
 */
function RemovedNoteTypes({ rows }: { rows: readonly NoteTypeRow[] }) {
  const removed = rows.filter((r) => r.state === 'archived');
  if (removed.length === 0) return null;
  return (
    <section aria-labelledby="removed-note-types" className="px-panel">
      <h2 id="removed-note-types" className="px-h2">
        Removed ({removed.length})
      </h2>
      <p className="sx-help">These aren’t offered for new notes. Restore one to offer it again.</p>
      <ul className={styles.removed}>
        {removed.map((r) => (
          <li key={r.key} className={styles.removedItem}>
            <span className={styles.removedName}>{r.title}</span>
            <RestoreNoteType noteType={r} />
            <Offer row={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Note types (phase 5 design 8.1; PRD main 945, 952): each active note type of the team with which
 * visits offer it, its timeline group, who may read it, whose version it is (Sineobex's, used as
 * is, or the team's) and what uses it; Edit, which opens its editor; Remove; Sineobex's update when
 * one is on offer; and its history. Then Add, a copy or a blank one, and the Removed list with
 * Restore. `rows` is the API's list in its order, removed ones included; `histories` each active
 * one's history, by key.
 */
export function NoteTypesView({
  rows,
  histories = {},
  done,
  refused,
  noteType,
}: {
  rows: readonly NoteTypeRow[];
  histories?: Readonly<Record<string, readonly NoteTypeEvent[]>>;
  done?: string;
  /** A refusal another admin's Remove or Restore caused, which the page says (PresetNotice). */
  refused?: string;
  noteType?: string;
}) {
  const active = rows.filter((r) => r.state === 'active');
  // A new view starts afresh after each act the page is sent back to, as the preset pages do.
  const view = noticeKey(done, refused, noteType);
  return (
    <Fragment key={view}>
      <h1 className="px-h1">Note types</h1>
      <p className="px-lede">
        What staff choose when they add a note to a visit. Use Sineobex’s note types as they are, edit them,
        add your own, or remove those your team doesn’t use. Notes already started stay on the version they
        began on.
      </p>
      <PresetNotice
        done={done}
        refused={refused}
        preset={noteType}
        presets={rows.map((r) => ({ id: r.key, name: r.title }))}
      />
      {active.length === 0 ? (
        <p className="px-panel">Your team has no note types on its list. Add one below.</p>
      ) : (
        active.map((row) => <NoteTypeSection key={row.key} row={row} history={histories[row.key]} />)
      )}
      <AddNoteType rows={rows} />
      <RemovedNoteTypes rows={rows} />
    </Fragment>
  );
}
