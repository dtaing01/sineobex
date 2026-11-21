import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDay, STACKED_TABLE } from '@/components/SideBySide';
import { api, unwrap } from '@/lib/api';
import { matchReasons } from '@/lib/labels';
import { ArrivalHeading } from './ArrivalHeading';
import { BAND, PAIR_STATUS, pairName, SOURCE } from './pairs';

export const metadata: Metadata = { title: 'Duplicates' };

type Pair = Schemas['DuplicatePairSummary'];
const STATUSES = ['open', 'not_sure', 'decided'] as const;
type Status = (typeof STATUSES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAB: Record<Status, string> = { open: 'Open', not_sure: 'Not sure', decided: 'Decided' };

const CAPTION: Record<Status, string> = {
  open: 'Pairs waiting for a decision',
  not_sure: 'Pairs marked Not sure',
  decided: 'Decided pairs',
};

/** What the reviewer just did, and where it leaves the pair. */
const DECIDED: Record<string, { heading: string; text: string }> = {
  merge: {
    heading: 'Merged',
    text: 'The kept chart now shows both records. An admin can undo the merge from Merges.',
  },
  keep_separate: { heading: 'Kept separate', text: 'This pair won’t be suggested again.' },
  not_sure: {
    heading: 'Marked Not sure',
    text: 'The pair stays in the queue, with your note if you wrote one.',
  },
};

function notes(p: Pair): string[] {
  const out: string[] = [];
  if (p.status !== 'open') {
    out.push(`${PAIR_STATUS[p.status]}${p.decidedAt ? `, ${formatDay(p.decidedAt)}` : ''}`);
  }
  if (p.creatorDismissed)
    out.push('Whoever made the newer record saw this match and said it was someone else');
  if (p.note) out.push(`Note for field staff: ${p.note}`);
  return out;
}

interface View {
  status: Status;
  after?: { id: string; page: number };
}

function href(view: View): string {
  const q = new URLSearchParams({ status: view.status });
  if (view.after) {
    q.set('after', view.after.id);
    q.set('page', String(view.after.page));
  }
  return `/team/duplicates?${q}`;
}

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === 'string' ? v : '';
  };
  const status = (STATUSES as readonly string[]).includes(one('status')) ? (one('status') as Status) : 'open';
  const after = UUID.test(one('after')) ? one('after') : undefined;
  // The number is only shown: the cursor decides what the page holds.
  const page = after ? Math.min(Math.max(Number.parseInt(one('page'), 10) || 2, 2), 9999) : 1;
  const decided = DECIDED[one('decided')];
  const queue = await unwrap(
    (await api()).GET('/v1/team/duplicates', {
      params: { query: { status, ...(after ? { afterId: after } : {}) } },
    }),
  );
  const count = queue.pairs.length;
  // After a decision: the oldest other pair still waiting (a Not sure pair stays in the list).
  const next = decided && status === 'open' ? queue.pairs.find((p) => p.id !== one('pair')) : undefined;

  return (
    <>
      <h1 className="px-h1">Duplicates</h1>
      <p className="sx-help">
        Pairs of charts that may be the same person. Nothing is merged until someone decides, and every
        decision needs a comment. Opening this page is logged.
      </p>
      {decided && (
        <section aria-labelledby="decided" className="px-alert px-alert--ok">
          <ArrivalHeading id="decided">{decided.heading}</ArrivalHeading>
          <p>{decided.text}</p>
          <p>
            {next ? (
              <Link href={`/team/duplicates/${next.id}`}>Next pair: {pairName(next)}</Link>
            ) : (
              'No other pair is waiting.'
            )}
          </p>
        </section>
      )}
      <nav aria-label="Duplicate pairs" className="px-tabs">
        <ul>
          {STATUSES.map((s) => (
            <li key={s}>
              <Link href={href({ status: s })} aria-current={s === status ? 'page' : undefined}>
                {TAB[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {count === 0 ? (
        <p className="px-panel">
          {page > 1
            ? 'Nothing more after the previous page.'
            : status === 'decided'
              ? 'None yet.'
              : 'No pairs here.'}
        </p>
      ) : (
        <table className={STACKED_TABLE}>
          <caption>
            {CAPTION[status]}, oldest flagged first. Page {page}: {count} {count === 1 ? 'pair' : 'pairs'}.
          </caption>
          <thead>
            <tr>
              <th scope="col">Records</th>
              <th scope="col">How alike</th>
              <th scope="col">Why they matched</th>
              <th scope="col">Flagged</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {queue.pairs.map((p) => {
              const said = notes(p);
              return (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/team/duplicates/${p.id}`}>{pairName(p)}</Link>
                  </th>
                  <td data-label="How alike">{BAND[p.band]}</td>
                  <td data-label="Why they matched">{matchReasons(p.reasons) || 'Reported by staff'}</td>
                  <td data-label="Flagged">
                    {formatDay(p.firstFlaggedAt)}, {p.sources.map((s) => SOURCE[s]).join('; ')}
                  </td>
                  <td data-label="Notes">{said.length === 0 ? 'None' : said.join('. ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(page > 1 || queue.nextAfterId) && (
        <nav aria-label="Duplicate pages" className="px-tabs px-pager">
          <ul>
            {page > 1 && (
              <li>
                <Link href={href({ status })}>First page</Link>
              </li>
            )}
            <li>
              <span aria-current="page">Page {page}</span>
            </li>
            {queue.nextAfterId && (
              <li>
                <Link href={href({ status, after: { id: queue.nextAfterId, page: page + 1 } })} rel="next">
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
