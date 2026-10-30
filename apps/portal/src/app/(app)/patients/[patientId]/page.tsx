import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { IdCardPanel, type CardView } from '@/components/IdCardPanel';
import { chartValue, PatientHeader } from '@/components/PatientHeader';
import { ReviewForm } from '@/components/ReviewForm';
import { teamToday } from '@/lib/dob';
import { formatDateTime, PROBLEM_STATUS, syncFieldLabel } from '@/lib/labels';
import { can, currentUser } from '@/lib/me';
import { loadChart } from '../chart';
import {
  ALLERGY_CATEGORY,
  ALLERGY_SEVERITY,
  CONSENT_DECISION,
  CONSENT_KIND,
  fieldValueText,
  formatDayOf,
} from '../format';
import styles from '../patients.module.css';

// Never a name: titles land in the history and on screen shares (module 9).
export const metadata: Metadata = { title: 'Patient' };

/** The chart's details, in the order the phone's intake asks for them (design 11.1). */
const DETAILS = [
  'preferredName',
  'legalName',
  'birth',
  'visualDescriptor',
  'usualArea',
  'livingSituation',
  'preferredLanguage',
  'idCardChoice',
] as const;

const CORRECTED: Record<string, string> = {
  legalName: 'Legal name corrected. The old value, the new one and your reason are in the history.',
  birth: 'Date of birth corrected. The old value, the new one and your reason are in the history.',
  declined: 'The declined request is recorded with your reason. The chart is unchanged.',
};

const DECIDED: Record<string, string> = {
  current: 'Decided. The chart keeps its value, and the other stays in its history.',
  alternate: 'Decided. The chart now shows the value you chose; the one it replaced stays in its history.',
};

const METHOD: Record<Schemas['ConsentView']['method'], string> = {
  verbal: ', verbally',
  written: ', in writing',
  not_applicable: '',
};

type Snapshot = Schemas['RecordSnapshot'];
const attr = (r: Snapshot, key: string) => r.attributes[key];
const reasonOf = (r: Snapshot, field: string) =>
  (r.fields[field]?.value as { reason?: string } | null | undefined)?.reason ?? null;

function Problems({ chart }: { chart: Schemas['PatientChart'] }) {
  const problems = chart.problems ?? [];
  if (problems.length === 0) return <p>No problems recorded.</p>;
  return (
    <ul className={styles.cards}>
      {problems.map((p) => {
        const title = String(attr(p, 'title'));
        const code = attr(p, 'code') as { code: string } | null;
        const status = (p.fields.status?.value as { status: Schemas['ProblemStatus'] } | null)?.status;
        const error = reasonOf(p, 'enteredInError');
        const history = (chart.problemHistory ?? []).filter((e) => e.problemId === p.id);
        const notes = (chart.problemNotes ?? []).filter((n) => n.problemId === p.id);
        return (
          <li key={p.id} className="px-card">
            <h3 className="px-h3">{title}</h3>
            <p>
              {code ? `${code.code} · ` : ''}
              {error
                ? `Entered in error: ${error}`
                : `${status ? PROBLEM_STATUS[status] : 'Status not recorded'} since ${formatDayOf(String(attr(p, 'statusChangedAt')))}`}
              {attr(p, 'sensitive') === true ? ' · Sensitive' : ''}
              {attr(p, 'mergedInto') ? ' · Merged into another entry' : ''}
              {attr(p, 'reversalRequest') === 'open' ? ' · Waiting for an admin to reopen it' : ''}
            </p>
            {(history.length > 0 || notes.length > 0) && (
              <details>
                <summary>
                  Status history and notes<span className="sr-only">: {title}</span>
                </summary>
                {history.length > 0 && (
                  <ol className="px-list">
                    {history.map((e) => (
                      <li key={e.historyId}>
                        {PROBLEM_STATUS[e.status]} · {e.by.displayName} · {formatDateTime(e.at)}
                      </li>
                    ))}
                  </ol>
                )}
                {notes.map((n) => (
                  <p key={n.id}>
                    {n.text}
                    <span className={styles.meta}>
                      {n.author.displayName}, {formatDateTime(n.writtenAt)}
                    </span>
                  </p>
                ))}
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A patient's profile (design 12.2): the chart as the role may see it, its ID cards, open reviews
 * and merges, and the ways to its history and to an admin's correction. Opening it logs a view.
 */
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { patientId } = await params;
  const query = await searchParams;
  const [chart, { team }] = await Promise.all([loadChart(patientId), currentUser()]);
  const today = teamToday();
  const id = chart.canonicalId;
  const corrected = CORRECTED[typeof query.corrected === 'string' ? query.corrected : ''];
  const decided = DECIDED[typeof query.decided === 'string' ? query.decided : ''];
  const aliases = chart.aliases.filter((a) => a.status === 'active');
  const removedAliases = chart.aliases.filter((a) => a.status !== 'active');
  const allergies = chart.allergies.filter((a) => a.status === 'active');
  const allergyErrors = chart.allergies.filter((a) => a.status !== 'active');
  // The chart carries no link for the browser: Show link reads them through the logged route.
  const cards: CardView[] = chart.idLinks
    .filter((l) => l.status === 'active')
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
    .map((l) => ({
      id: l.id,
      effectiveAt: l.effectiveAt,
      madeOffline: l.madeOffline,
      fromMergedRecord: l.issuedOn !== id,
    }));
  const lastSeen = attr(chart.patient, 'lastSeenAt');

  return (
    <>
      {corrected && (
        <p role="status" className="px-alert px-alert--ok">
          {corrected}
        </p>
      )}
      {decided && (
        <p role="status" className="px-alert px-alert--ok">
          {decided}
        </p>
      )}
      <PatientHeader chart={chart} today={today} />
      {/* No prefetch on links to patient pages: loading one logs a view nobody made. */}
      <nav aria-label="This chart" className="px-tabs">
        <ul>
          <li>
            <Link href={`/patients/${id}/history`} prefetch={false}>
              History
            </Link>
          </li>
          {can(team, 'patients.correct_identity') && (
            <li>
              {/* A correction needs a fresh sign-in (design 11.6): the code first, then the form. */}
              <Link href={`/reauth?next=${encodeURIComponent(`/patients/${id}/correct`)}`} prefetch={false}>
                Correct identity
              </Link>
            </li>
          )}
        </ul>
      </nav>

      <section aria-labelledby="details-heading" className="px-panel">
        <h2 id="details-heading" className="px-h2">
          Details
        </h2>
        <dl className="px-facts">
          {DETAILS.map((field) => (
            <div key={field}>
              <dt>{syncFieldLabel(field)}</dt>
              <dd>
                {fieldValueText(field, chartValue(chart, field), today)}
                <span className={styles.meta}>
                  <Link href={`/patients/${id}/history?field=${field}`} prefetch={false}>
                    History<span className="sr-only">: {syncFieldLabel(field)}</span>
                  </Link>
                </span>
              </dd>
            </div>
          ))}
          <div>
            <dt>Registered</dt>
            <dd>{formatDayOf(String(attr(chart.patient, 'registeredAt')))}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{typeof lastSeen === 'string' ? formatDayOf(lastSeen) : 'Not recorded'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="allergies-heading" className="px-panel">
        <h2 id="allergies-heading" className="px-h2">
          Allergies
        </h2>
        {allergies.length === 0 ? (
          <p>
            {chartValue(chart, 'allergyScreen') === 'none_known' ? 'No known allergies.' : 'Not asked yet.'}
          </p>
        ) : (
          <table className={`px-table ${styles.stack}`}>
            <caption className="sr-only">Allergies on the chart</caption>
            <thead>
              <tr>
                <th scope="col">Allergy</th>
                <th scope="col">Kind</th>
                <th scope="col">Severity</th>
                <th scope="col">Reaction</th>
                <th scope="col">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {allergies.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{String(attr(a, 'substance'))}</th>
                  <td data-label="Kind">
                    {ALLERGY_CATEGORY[attr(a, 'category') as Schemas['AllergyCategory']] ?? '—'}
                  </td>
                  <td data-label="Severity">
                    {ALLERGY_SEVERITY[attr(a, 'severity') as Schemas['AllergySeverity']] ?? '—'}
                  </td>
                  <td data-label="Reaction">{(attr(a, 'reaction') as string | null) || 'Not recorded'}</td>
                  <td data-label="Recorded">{formatDayOf(String(attr(a, 'recordedAt')))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {allergyErrors.length > 0 && (
          <ul className="px-list">
            {allergyErrors.map((a) => (
              <li key={a.id}>
                {String(attr(a, 'substance'))}: entered in error
                {reasonOf(a, 'enteredInError') ? ` (${reasonOf(a, 'enteredInError')})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="names-heading" className="px-panel">
        <h2 id="names-heading" className="px-h2">
          Street names
        </h2>
        {aliases.length === 0 ? (
          <p>None recorded.</p>
        ) : (
          <ul className="px-list">
            {aliases.map((a) => (
              <li key={a.id}>{String(attr(a, 'alias'))}</li>
            ))}
          </ul>
        )}
        {removedAliases.length > 0 && (
          <p className="sx-help">
            Removed:{' '}
            {removedAliases
              .map(
                (a) =>
                  `${String(attr(a, 'alias'))}${reasonOf(a, 'removal') ? ` (${reasonOf(a, 'removal')})` : ''}`,
              )
              .join('; ')}
          </p>
        )}
      </section>

      {chart.problems && (
        <section aria-labelledby="problems-heading" className="px-panel">
          <h2 id="problems-heading" className="px-h2">
            Problems
          </h2>
          <Problems chart={chart} />
        </section>
      )}

      <section aria-labelledby="card-heading" className="px-panel">
        <h2 id="card-heading" className="px-h2">
          ID card
        </h2>
        <IdCardPanel
          patientId={id}
          cards={cards}
          canEdit={can(team, 'patients.edit')}
          declined={chartValue(chart, 'idCardChoice') === 'declined'}
          linkId={randomUUID()}
        />
      </section>

      {chart.reviews.length > 0 && (
        <section aria-labelledby="reviews-heading" className="px-panel">
          <h2 id="reviews-heading" className="px-h2">
            Open reviews
          </h2>
          <p className="sx-help">
            Two people recorded different values, and the chart kept its own. The other stays in the history
            whichever you keep.
          </p>
          {chart.reviews.map((review, i) => {
            const name = `${i + 1}. ${syncFieldLabel(review.field)}`;
            return (
              <div key={review.id} className="px-form">
                <h3 className="px-h3">{name}</h3>
                {can(team, review.needs) ? (
                  <ReviewForm review={review} today={today} back={`/patients/${id}`} name={name} />
                ) : (
                  <ul className="px-list">
                    <li>On the chart: {fieldValueText(review.field, review.current.value, today)}</li>
                    {review.alternates.map((a) => (
                      <li key={a.historyId}>
                        Also recorded: {fieldValueText(review.field, a.value, today)} ({a.by.displayName})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section aria-labelledby="consent-heading" className="px-panel">
        <h2 id="consent-heading" className="px-h2">
          Consent
        </h2>
        {chart.consents.length === 0 ? (
          <p>None recorded.</p>
        ) : (
          <ul className="px-list">
            {chart.consents.map((c) => (
              <li key={c.id}>
                {CONSENT_KIND[c.kind]}: {CONSENT_DECISION[c.decision]}
                {METHOD[c.method]}
                <span className={styles.meta}>
                  Recorded by {c.recordedBy.displayName}, {formatDateTime(c.recordedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {chart.mergedFrom.length > 0 && (
        <section aria-labelledby="merges-heading" className="px-panel">
          <h2 id="merges-heading" className="px-h2">
            Merged records
          </h2>
          <ul className="px-list">
            {chart.mergedFrom.map((m) => (
              <li key={m.mergeId}>A record merged into this chart on {formatDayOf(m.mergedAt)}</li>
            ))}
          </ul>
          {(can(team, 'patients.review_duplicates') || can(team, 'patients.correct_identity')) && (
            <p>
              <Link href="/team/merges" prefetch={false}>
                See recent merges
              </Link>
            </p>
          )}
        </section>
      )}
    </>
  );
}
