import type { Schemas } from '@sineobex/contract';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import styles from '@/app/(app)/encounters/encounters.module.css';
import { STACKED_TABLE } from '@/components/SideBySide';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import type { SignAct } from '@/lib/sign';
import { patientName, queueNoteLines } from '@/lib/worklists';

const WORDS: Record<SignAct, { title: string; help: string; caption: string; empty: string }> = {
  cosign: {
    title: 'Co-sign queue',
    help: 'Visits with a Medical note waiting for a co-signer, oldest first. Open a visit to read its notes, then co-sign them there. Opening this page is logged.',
    caption: 'Visits waiting for a co-signature, oldest first',
    empty: 'No visits wait for a co-signature.',
  },
  attest: {
    title: 'Attestation queue',
    help: 'Visits with a signed note waiting for an attending’s attestation, oldest first. Open a visit to read its notes, then attest them there. Opening this page is logged.',
    caption: 'Visits waiting for attestation, oldest first',
    empty: 'No visits wait for attestation.',
  },
};

/**
 * The queue's rows, as the API lists them for this person. A credential that doesn't do the act is
 * refused by the API (`cannot_sign`, `cannot_attest`, logged) as a role without `encounters.chart`
 * is: a typed URL to a screen the person can't use, which goes Home and says so.
 */
export async function queueRows(act: SignAct): Promise<Schemas['QueueVisit'][]> {
  const client = await api();
  try {
    const queue = await unwrap(
      act === 'cosign' ? client.GET('/v1/team/cosign-queue') : client.GET('/v1/team/attestation-queue'),
    );
    return queue.rows;
  } catch (err) {
    if (err instanceof PortalApiError && err.status === 403) redirect('/home?denied=1');
    throw err;
  }
}

/**
 * A queue of visits waiting for a second person (lifecycle 3.7, 5.4, 9.14): one row per visit, as the
 * API lists them, each naming the patient, when the visit started and its waiting notes by their
 * titles, and opening the visit page, where the person reads the notes and acts on them. The API
 * decides which visits and notes a person sees and whether they may act on each (`canAct`), and logs
 * the patients shown.
 */
export function SignatureQueue({ act, rows }: { act: SignAct; rows: Schemas['QueueVisit'][] }) {
  const words = WORDS[act];
  return (
    <>
      <h1 className="px-h1">{words.title}</h1>
      <p className="sx-help">{words.help}</p>
      {rows.length === 0 ? (
        <p className="px-panel">{words.empty}</p>
      ) : (
        <table className={STACKED_TABLE}>
          <caption className={styles.caption}>
            {words.caption}: {rows.length} {rows.length === 1 ? 'visit' : 'visits'}.
          </caption>
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Visit started</th>
              <th scope="col">Notes waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const started = formatDateTime(row.startedAt);
              return (
                <tr key={row.encounterId}>
                  <th scope="row">
                    {/* No prefetch on links to a visit: loading one logs a read nobody made. */}
                    <Link href={`/encounters/${row.encounterId}`} prefetch={false}>
                      {patientName(row.preferredName, row.patientId)}
                      <span className="sr-only">, visit on {started}</span>
                    </Link>
                  </th>
                  <td data-label="Visit started">{started}</td>
                  <td data-label="Notes waiting">
                    <ul className={styles.plain}>
                      {row.notes.map((note) => {
                        const { title, lines } = queueNoteLines(note, act);
                        return (
                          <li key={note.noteId}>
                            <strong>{title}</strong>
                            {lines.map((line) => (
                              <span key={line} className={styles.meta}>
                                {line}
                              </span>
                            ))}
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
