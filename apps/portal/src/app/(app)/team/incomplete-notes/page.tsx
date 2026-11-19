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

  return (
    <>
      <h1 className="px-h1">Notes not complete</h1>
      <p className="sx-help">
        Every draft note the server holds, oldest visit first. A note started more than a day ago is marked.
        When a note’s author has left the team, assign it to another clinician from its visit.
        {views ? '' : ' Your role doesn’t open patients’ charts, so patients aren’t named here.'} Opening this
        page is logged.
      </p>
      {notes.length === 0 ? (
        <p className="px-panel">No notes are incomplete.</p>
      ) : (
        <table className={STACKED_TABLE}>
          <caption>
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
              const title = note.title || 'Note';
              const name = patientName(note.preferredName, note.patientId);
              const context = `${title}${views ? `, ${name}` : ''}`;
              return (
                <tr key={note.noteId}>
                  <th scope="row">{title}</th>
                  {views && <td data-label="Patient">{name}</td>}
                  <td data-label="Author">
                    {note.author.displayName}
                    {!note.authorActive && <span className={styles.meta}>No longer on the team</span>}
                  </td>
                  <td data-label="Visit started">
                    {formatDateTime(note.startedAt)}
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
