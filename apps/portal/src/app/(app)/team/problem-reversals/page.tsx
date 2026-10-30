import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { who } from '@/components/SideBySide';
import { api, unwrap } from '@/lib/api';
import { formatDateTime, PROBLEM_STATUS } from '@/lib/labels';
import { ArrivalHeading } from '../duplicates/ArrivalHeading';
import { ReversalDecision } from './ReversalDecision';

export const metadata: Metadata = { title: 'Problem reversals' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a decision left the request, after the action redirected here. */
const DONE: Record<string, { heading: string; text: string }> = {
  declined: {
    heading: 'Declined',
    text: 'The new entry stays a separate problem, and the worker who asked is told.',
  },
  reversed: { heading: 'Reversed', text: 'Both entries stay on the problem list.' },
  merged: {
    heading: 'Entries merged',
    text: 'The original is Ongoing, and the new entry’s history and notes show in its timeline.',
  },
};

function href(after?: { id: string; page: number }): string {
  return after
    ? `/team/problem-reversals?${new URLSearchParams({ after: after.id, page: String(after.page) })}`
    : '/team/problem-reversals';
}

/** One entry: its title and code, its status now, and every status and note it has had. */
function Entry({ heading, problem }: { heading: string; problem: Schemas['ProblemView'] }) {
  return (
    <li className="px-card">
      <h3 className="px-h3">{heading}</h3>
      <p>
        {problem.title}
        {problem.code ? ` (${problem.code})` : ''}: <strong>{PROBLEM_STATUS[problem.status]}</strong>. Added{' '}
        {formatDateTime(problem.createdAt)} by {problem.author.displayName}.
      </p>
      <h4 className="sx-label">Status history</h4>
      <ol className="px-list">
        {problem.statusHistory.map((e) => (
          <li key={e.historyId}>
            {PROBLEM_STATUS[e.status]}, {formatDateTime(e.at)} by {e.by.displayName}
          </li>
        ))}
      </ol>
      {problem.notes.length > 0 && (
        <>
          <h4 className="sx-label">Notes</h4>
          <ul className="px-list">
            {problem.notes.map((n) => (
              <li key={n.id}>
                {n.text} ({formatDateTime(n.writtenAt)}, {n.author.displayName})
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

export default async function ProblemReversalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === 'string' ? v : '';
  };
  const after = UUID.test(one('after')) ? one('after') : undefined;
  // The number is only shown: the cursor decides what the page holds.
  const page = after ? Math.min(Math.max(Number.parseInt(one('page'), 10) || 2, 2), 9999) : 1;
  const done = DONE[one('done')];
  const list = await unwrap(
    (await api()).GET('/v1/team/problem-reversals', { params: { query: after ? { afterId: after } : {} } }),
  );
  const count = list.requests.length;

  return (
    <>
      <h1 className="px-h1">Problem reversals</h1>
      <p className="sx-help">
        Problems a worker says were marked Resolved by mistake. They added the problem again as a new entry,
        so care carries on while you decide whether the original goes back to Ongoing. Opening this page is
        logged.
      </p>
      {done && (
        <section aria-labelledby="done" className="px-alert px-alert--ok">
          <ArrivalHeading id="done">{done.heading}</ArrivalHeading>
          <p>{done.text}</p>
        </section>
      )}
      {count === 0 ? (
        <p className="px-panel">
          {page > 1 ? 'Nothing more after the previous page.' : 'No request is waiting.'}
        </p>
      ) : (
        <p className="sx-help">
          Page {page}: {count} {count === 1 ? 'request' : 'requests'}, oldest first.
        </p>
      )}
      {list.requests.map((r, i) => {
        const heading = `request-${r.request.id}`;
        const title = `${i + 1}. ${r.request.title}`;
        return (
          <section key={r.request.id} aria-labelledby={heading} className="px-panel">
            <h2 id={heading} className="px-h2">
              {title}, for {who(r.patient)}
            </h2>
            <p>
              {r.requestedBy.displayName} added this again on {formatDateTime(r.requestedAt)}, saying it never
              went away. <Link href={`/patients/${r.patientId}`}>Open chart: {who(r.patient)}</Link>
            </p>
            <ul className="px-cards">
              <Entry heading="The original entry" problem={r.original} />
              <Entry heading="The new entry" problem={r.request} />
            </ul>
            <ReversalDecision
              requestId={r.request.id}
              originalId={r.original.id}
              originalTitle={r.original.title}
              label={title}
            />
          </section>
        );
      })}
      {(page > 1 || list.nextAfterId) && (
        <nav aria-label="Request pages" className="px-tabs px-pager">
          <ul>
            {page > 1 && (
              <li>
                <Link href={href()}>First page</Link>
              </li>
            )}
            <li>
              <span aria-current="page">Page {page}</span>
            </li>
            {list.nextAfterId && (
              <li>
                <Link href={href({ id: list.nextAfterId, page: page + 1 })} rel="next">
                  Next 50
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </>
  );
}
