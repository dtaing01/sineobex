import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UUID } from '@/app/(app)/patients/chart';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { ASSIGNED_STATES, assignedState, assigneeOptions } from '@/lib/assign';
import { addendumEntry, ENCOUNTER_KIND, madeAtRows, startedText } from '@/lib/encounters';
import { HANDOFF_STATES, handoffState } from '@/lib/handoff';
import { can, currentUser } from '@/lib/me';
import { SIGNED_STATES, signedState, signPlan } from '@/lib/sign';
import styles from '../encounters.module.css';
import { AssignForm } from './AssignForm';
import { HandoffExport } from './HandoffExport';
import { NoteView, Trail } from './NoteView';
import { SignActions } from './SignActions';

// Never a name: titles land in the history and on screen shares (lifecycle 10.2).
export const metadata: Metadata = { title: 'Visit' };

/**
 * A visit as this reader may see it (lifecycle 5.1), or the not-found page. Reading it logs each
 * record shown; the page reads it once and holds no rule of its own about what to show.
 */
async function loadVisit(encounterId: string): Promise<Schemas['VisitRead']> {
  if (!UUID.test(encounterId)) notFound();
  try {
    return await unwrap(
      (await api()).GET('/v1/encounters/{encounterId}', { params: { path: { encounterId } } }),
    );
  } catch (err) {
    if (err instanceof PortalApiError && err.status === 404) notFound();
    throw err;
  }
}

/**
 * Who may be assigned each note, for a person who may assign (lifecycle 5.5, 9.12): the assignees
 * route's answer, asked of every note shown. It answers 200 only for a note whose author has left,
 * and the page offers Assign exactly there; a 409 or a 404 is a note it doesn't offer.
 */
async function assigneesOf(notes: Schemas['VisitNote'][]): Promise<Map<string, Schemas['NoteAssignee'][]>> {
  const client = await api();
  const answers = await Promise.all(
    notes.map(async (n) => {
      const { data, response } = await client.GET('/v1/notes/{noteId}/assignees', {
        params: { path: { noteId: n.noteId } },
      });
      return response.ok && data ? ([n.noteId, data.assignees] as const) : null;
    }),
  );
  return new Map(answers.filter((a) => a !== null));
}

/**
 * The visit page (lifecycle 9.7, 9.11), read-only: the envelope, each note the reader may see with
 * its recap, its sections and what hangs off it, and the records made at the visit. Export EMS
 * handoff (PDF) shows when the API says the export would give the file (`hasHandoff`); Co-sign and
 * Attest, at the bottom, when it marks a note the reader may act on (`canCosign`, `canAttest`);
 * Assign, under a note, when its assignees route answers. Each act loads the page again after it.
 */
export default async function VisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ encounterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { encounterId } = await params;
  const visit = await loadVisit(encounterId);
  const { team } = await currentUser();
  const assignees = can(team, 'team.manage_users') ? await assigneesOf(visit.notes) : new Map();
  const query = await searchParams;
  const handoff = handoffState(query.handoff);
  const signed = signedState(query.signed);
  const assigned = assignedState(query.assign);
  const notice = handoff
    ? HANDOFF_STATES[handoff]
    : signed
      ? SIGNED_STATES[signed]
      : assigned
        ? ASSIGNED_STATES[assigned]
        : null;
  const patient = visit.patientId ? (visit.preferredName ?? 'No name recorded') : 'No patient recorded';
  const started = startedText(visit.startedAt, visit.clockVerified);
  const records = madeAtRows(visit.records, visit.patientId);

  return (
    <>
      <h1 className="px-h1">Visit</h1>
      <p className="px-lede">
        {patient} · {ENCOUNTER_KIND[visit.kind]} · {started}
      </p>
      {visit.patientId && (
        // No prefetch on links to patient pages: loading one logs a view nobody made.
        <nav aria-label="This visit" className="px-tabs">
          <ul>
            <li>
              <Link href={`/patients/${visit.patientId}`} prefetch={false}>
                Open the chart
              </Link>
            </li>
          </ul>
        </nav>
      )}
      {notice && (
        <p role="status" className={`px-alert px-alert--${notice.tone}`}>
          {notice.text}
        </p>
      )}

      <section aria-labelledby="visit-heading" className="px-panel">
        <h2 id="visit-heading" className="px-h2">
          About the visit
        </h2>
        <dl className="px-facts">
          <div>
            <dt>Patient</dt>
            <dd>{patient}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{started}</dd>
          </div>
          <div>
            <dt>Place</dt>
            <dd className={styles.typed}>{visit.locationText || 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{ENCOUNTER_KIND[visit.kind]}</dd>
          </div>
        </dl>
        {/* Absent for a Medical visit to a reader of no Medical notes: nothing is said of it. */}
        {visit.summary !== undefined && (
          <div className={styles.section}>
            <h3 className="px-h3">Assessment</h3>
            <p className={styles.typed}>{visit.summary || 'Not recorded'}</p>
          </div>
        )}
        {visit.addenda.length > 0 && (
          <div className={styles.section}>
            <h3 className="px-h3">Addenda to the visit</h3>
            <Trail entries={visit.addenda.map(addendumEntry)} />
          </div>
        )}
      </section>

      {visit.hasHandoff && (
        <section aria-labelledby="handoff-heading" className="px-panel">
          <h2 id="handoff-heading" className="px-h2">
            EMS handoff
          </h2>
          <p className="sx-help">
            EMS was called at this visit. The handoff is a PDF for the crew, stamped with your name and the
            time. Nothing from a sensitive note or exam is in it. You may be asked to confirm it’s you first,
            and each export is logged.
          </p>
          <HandoffExport encounterId={visit.encounterId} />
        </section>
      )}

      {visit.notes.length === 0 ? (
        <p className="px-panel">No notes to show.</p>
      ) : (
        visit.notes.map((note) => {
          const offered = assignees.get(note.noteId);
          return (
            <NoteView key={note.noteId} note={note}>
              {offered && (
                <AssignForm
                  encounterId={visit.encounterId}
                  noteId={note.noteId}
                  options={assigneeOptions(offered)}
                />
              )}
            </NoteView>
          );
        })
      )}

      {records.length > 0 && (
        <section aria-labelledby="records-heading" className="px-panel">
          <h2 id="records-heading" className="px-h2">
            Recorded at this visit
          </h2>
          <ul className={styles.plain}>
            {records.map((r) => (
              <li key={r.id}>
                {r.enteredInError ? (
                  <>
                    <del className={styles.struck}>{r.text}</del>
                    <span className={styles.meta}>Entered in error</span>
                  </>
                ) : (
                  r.text
                )}
                {r.elsewhere && <span className={styles.meta}>On another chart now</span>}
                {r.patientId && (
                  <span className={styles.meta}>
                    <Link href={`/patients/${r.patientId}`} prefetch={false}>
                      Open {r.elsewhere ? 'that' : 'the'} chart
                      <span className="sr-only">: {r.text}</span>
                    </Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(['cosign', 'attest'] as const).map((act) => {
        const plan = signPlan(visit.notes, act);
        // Keyed by the act alone: a later render's plan must reach the same component, which keeps
        // the one the person read.
        return plan && <SignActions key={act} encounterId={visit.encounterId} act={act} plan={plan} />;
      })}
    </>
  );
}
