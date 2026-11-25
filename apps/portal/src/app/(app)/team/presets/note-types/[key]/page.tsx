import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrivalHeading } from '@/app/(app)/team/duplicates/ArrivalHeading';
import { listNoteTypes, noteTypeHistory, type NoteTypeRow } from '@/lib/presets';
import { NOTE_TYPE_SENTENCES, publishedSentence } from '@/lib/refusals';
import { RemoveNoteType, RestoreNoteType } from '../NoteTypeForms';
import { History, Offer } from '../NoteTypesView';
import { groupOf, readersOf, visitsOf, whoseOf } from '../words';
import { NoteTypeEditor } from './NoteTypeEditor';

// The screen's name only: a note type's title is the team's own text, kept out of the tab's title.
export const metadata: Metadata = { title: 'Note type' };

/** A note type's key, as 0017 allows it: what the address may name, never a title. */
const KEY = /^[a-z][a-z0-9_]{1,60}$/;
const LIST = '/team/presets/note-types';

/**
 * What a publish made, as its address says once the editor has loaded the page again
 * (`?published=<version>&also=<keys>`): 8.1's sentence with the version, and each other note type
 * the change reached (rule 5) at its version now. Said only of the version the page now shows, so
 * an address that names another says nothing.
 */
function Published({
  row,
  rows,
  version,
  also,
}: {
  row: NoteTypeRow;
  rows: readonly NoteTypeRow[];
  version: string | undefined;
  also: string | undefined;
}) {
  if (version === undefined || Number(version) !== row.version) return null;
  const reached = (also ?? '')
    .split(',')
    .filter((k) => KEY.test(k))
    .map((k) => rows.find((r) => r.key === k))
    .filter((r): r is NoteTypeRow => r !== undefined);
  return (
    <section aria-labelledby="published" className="px-alert px-alert--ok">
      <ArrivalHeading id="published">Published</ArrivalHeading>
      <p>{publishedSentence(row.version)}</p>
      {reached.map((r) => (
        <p key={r.key}>
          The same change to its answers went into {r.title}, now at version {r.version}.
        </p>
      ))}
    </section>
  );
}

/**
 * One note type of Team setup (phase 5 design 5.4, 8.1), by its key: what it is, Sineobex's update
 * when one is on offer, the editor, Remove, and its history; a removed one offers Restore. Only
 * team.manage_presets opens it: the API refuses anyone else at the list, logged once, and the
 * portal sends them home as from every refused page. A key that is none of the team's note types is
 * no page. Reading is not audited (PL-13).
 */
export default async function NoteTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  if (!KEY.test(key)) notFound();
  const query = await searchParams;
  const one = (name: string) => {
    const v = query[name];
    return typeof v === 'string' ? v : undefined;
  };
  // The list first and alone: a refused visit is refused there, before the history is asked.
  const rows = await listNoteTypes();
  const row = rows.find((r) => r.key === key);
  if (!row) notFound();
  const history = await noteTypeHistory(key);
  const others = rows.filter((r) => r.key !== key);
  const titles = Object.fromEntries(others.map((r) => [r.key, r.title]));
  // Every other note type, a removed one too, with its sections: what can be copied is the API's to say.
  const sources = others.map((r) => ({
    key: r.key,
    title: r.state === 'archived' ? `${r.title} (removed)` : r.title,
    sections: r.definition.sections.map((s) => ({ id: s.id, title: s.title })),
  }));
  const { definition } = row;
  return (
    <>
      <p>
        <Link href={LIST}>← Note types</Link>
      </p>
      <h1 className="px-h1">{row.title}</h1>
      <Published row={row} rows={rows} version={one('published')} also={one('also')} />
      <dl className="px-facts">
        <div>
          <dt>Which visits</dt>
          <dd>
            {visitsOf(definition.kinds)}
            <span className="sx-help"> {NOTE_TYPE_SENTENCES.kindsFixed}</span>
          </dd>
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
      </dl>
      <Offer row={row} />
      {row.state === 'active' ? (
        <>
          {row.protected.whole ? (
            // Every part protected (the Red flags note): no change it would offer could be made (D114).
            <section aria-labelledby="note-type-sections" className="px-panel">
              <h2 id="note-type-sections" className="px-h2">
                Sections
              </h2>
              <p>{NOTE_TYPE_SENTENCES.wholeProtected}</p>
              <ul className="px-list">
                {definition.sections.map((s) => (
                  <li key={s.id}>{s.title}</li>
                ))}
              </ul>
            </section>
          ) : (
            <>
              <p className="px-lede">
                Change it here: rename it, rename or hide its sections and fields, and change a choice’s
                answers. Each change is held until you publish them all, with a reason.
              </p>
              <NoteTypeEditor row={row} titles={titles} sources={sources} />
            </>
          )}
          <section aria-labelledby="remove-note-type" className="px-panel">
            <h2 id="remove-note-type" className="px-h2">
              Remove
            </h2>
            <RemoveNoteType noteType={row} />
          </section>
        </>
      ) : (
        <section aria-labelledby="removed-note-type" className="px-panel">
          <h2 id="removed-note-type" className="px-h2">
            Removed
          </h2>
          <p>
            This note type isn’t offered for new notes. Notes already started on it can still be finished.
            Restore it to offer it again, and to change it.
          </p>
          <RestoreNoteType noteType={row} />
        </section>
      )}
      <History row={row} events={history} flat={false} />
    </>
  );
}
