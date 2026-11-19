import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/app/(app)/encounters/encounters.module.css';
import { STACKED_TABLE } from '@/components/SideBySide';
import { api, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { can, currentUser } from '@/lib/me';
import { patientName } from '@/lib/worklists';

export const metadata: Metadata = { title: 'Notes not complete' };

/**
 * Notes not complete (lifecycle 3.9, 5.6, 9.12): every draft note on the server, oldest visit first,
 * with its title, whoever acts as its author, when the visit started and whether that was more than
 * a day ago, as the API lists them for `team.manage_users` and logs the patients shown. A draft whose
 * author has left says so and offers Assign, a form on the visit page. The patient's name, the visit
 * and chart links and Assign need `patients.view`: without it the API names no patient, and every
 * one of those pages would refuse the person.
 */
export default async function IncompleteNotesPage() {
  const { team } = await currentUser();
  const views = can(team, 'patients.view');
  const { notes } = await unwrap((await api()).GET('/v1/team/incomplete-notes'));
  const overdue = notes.filter((n) => n.overdue).length;
  // Two drafts of one type by one author at one visit would read the same, row and links alike
  // (review finding PAX-5): each is numbered among them, in the list's order.
  const sameAs = (n: (typeof notes)[number]) => `${n.encounterId} ${n.noteTypeKey} ${n.author.userId}`;
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(sameAs(n), (counts.get(sameAs(n)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const titleOf = new Map(
    notes.map((n) => {
      const key = sameAs(n);
      const of = counts.get(key)!;
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      return [n.noteId, `${n.title || 'Note'}${of > 1 ? ` (${nth} of ${of})` : ''}`];
    }),
  );

  return (
    <>
      <h1 className="px-h1">Notes not complete</h1>
      <p className="sx-help">
        Every draft note the server holds, oldest visit first. A note whose visit started more than a day ago
        is marked.{' '}
        {views
          ? 'When a note’s author has left the team, assign it to another clinician from its visit.'
          : // A visit is a page this role can't open (review finding PAX-4).
            'When a note’s author has left the team, someone whose role opens patients’ charts can assign it to another clinician from its visit. Your role doesn’t open patients’ charts, so patients aren’t named here.'}{' '}
        Opening this page is logged.
      </p>
      {notes.length === 0 ? (
        <p className="px-panel">No notes are incomplete.</p>
      ) : (
        <table className={STACKED_TABLE}>
          <caption className={styles.caption}>
            Draft notes, oldest visit first: {notes.length} {notes.length === 1 ? 'note' : 'notes'}, {overdue}{' '}
            older than a day.
          </caption>
          <thead>
            <tr>
              <th scope="col">Note</th>
              {views && <th scope="col">Patient</th>}
              <th scope="col">Author</th>
              <th scope="col">Visit started</th>
              {views && <th scope="col">Open</th>}
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => {
              const title = titleOf.get(note.noteId)!;
              const name = patientName(note.preferredName, note.patientId);
              const started = formatDateTime(note.startedAt);
              // Each link's name tells its row apart: the note, who acts as its author, the patient
              // and when the visit started.
              const context = `${title} by ${note.author.displayName}${views ? `, ${name}` : ''}, visit on ${started}`;
              return (
                <tr key={note.noteId}>
                  <th scope="row">{title}</th>
                  {views && <td data-label="Patient">{name}</td>}
                  <td data-label="Author">
                    {note.author.displayName}
                    {!note.authorActive && <span className={styles.meta}>No longer on the team</span>}
                  </td>
                  <td data-label="Visit started">
                    {started}
                    {note.overdue && (
                      <span className={styles.meta}>
                        <span className="sx-pill sx-pill--info">Older than a day</span>
                      </span>
                    )}
                  </td>
                  {views && (
                    <td data-label="Open">
                      <ul className={styles.plain}>
                        <li>
                          {/* No prefetch on links to a visit or a chart: loading one logs a read. */}
                          <Link href={`/encounters/${note.encounterId}`} prefetch={false}>
                            Open the visit<span className="sr-only">: {context}</span>
                          </Link>
                        </li>
                        {note.patientId && (
                          <li>
                            <Link href={`/patients/${note.patientId}`} prefetch={false}>
                              Open the chart<span className="sr-only">: {context}</span>
                            </Link>
                          </li>
                        )}
                        {!note.authorActive && (
                          <li>
                            <Link
                              href={`/encounters/${note.encounterId}#assign-${note.noteId}`}
                              prefetch={false}
                            >
                              Assign<span className="sr-only">: {context}</span>
                            </Link>
                          </li>
                        )}
                      </ul>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
