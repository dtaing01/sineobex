import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FieldHistory } from '@/components/FieldHistory';
import { api, PortalApiError, unwrap } from '@/lib/api';
import { teamToday } from '@/lib/dob';
import { syncFieldLabel } from '@/lib/labels';
import { UUID } from '../../chart';

export const metadata: Metadata = { title: 'History' };

// The API's own patterns: a field name, and a history entry's ID as the cursor. Neither is PHI.
const FIELD = /^[a-z][a-zA-Z]{0,40}$/;
const HISTORY_ID = /^\d{1,19}$/;

/** Which part of the history is shown. It lives in the URL, so a page can be linked and reloaded. */
function href(patientId: string, view: { field?: string; after?: { id: string; page: number } }): string {
  const q = new URLSearchParams();
  if (view.field) q.set('field', view.field);
  if (view.after) {
    q.set('after', view.after.id);
    q.set('page', String(view.after.page));
  }
  const query = q.toString();
  return `/patients/${patientId}/history${query ? `?${query}` : ''}`;
}

/** A chart's field history, newest first (design 11.7, 12.2). Opening it is logged. */
export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { patientId } = await params;
  if (!UUID.test(patientId)) notFound();
  const query = await searchParams;
  const one = (key: string) => {
    const v = query[key];
    return typeof v === 'string' ? v : '';
  };
  const field = FIELD.test(one('field')) ? one('field') : undefined;
  const after = HISTORY_ID.test(one('after')) ? one('after') : undefined;
  // The number is only shown: the cursor decides what the page holds.
  const page = after ? Math.min(Math.max(Number.parseInt(one('page'), 10) || 2, 2), 9999) : 1;
  let history;
  try {
    history = await unwrap(
      (await api()).GET('/v1/patients/{patientId}/history', {
        params: {
          path: { patientId },
          query: { ...(field ? { field } : {}), ...(after ? { afterId: after } : {}) },
        },
      }),
    );
  } catch (err) {
    if (err instanceof PortalApiError && err.status === 404) notFound();
    throw err;
  }
  const label = field ? syncFieldLabel(field) : null;

  return (
    <>
      <h1 className="px-h1">History</h1>
      <p className="sx-help">
        Every value recorded for {label ? `“${label}”` : 'this chart’s details'}, the old and the new, newest
        first. Opening this page is logged.
      </p>
      {/* No prefetch on links to patient pages: loading one logs a view nobody made. */}
      <nav aria-label="History" className="px-tabs">
        <ul>
          <li>
            <Link href={`/patients/${patientId}`} prefetch={false}>
              Back to the chart
            </Link>
          </li>
          {field && (
            <li>
              <Link href={href(patientId, {})} prefetch={false}>
                Every field
              </Link>
            </li>
          )}
        </ul>
      </nav>
      {history.entries.length === 0 ? (
        <p className="px-panel">
          {page > 1 ? 'Nothing more after the previous page.' : 'Nothing recorded yet.'}
        </p>
      ) : (
        <FieldHistory
          entries={history.entries}
          patientId={patientId}
          today={teamToday()}
          caption={`${label ? `${label}: changes` : 'Changes to this chart'}, newest first (page ${page})`}
        />
      )}
      {(page > 1 || history.nextAfterId) && (
        <nav aria-label="History pages" className="px-tabs px-pager">
          <ul>
            {page > 1 && (
              <li>
                <Link href={href(patientId, { field })} prefetch={false}>
                  First page
                </Link>
              </li>
            )}
            <li>
              <span aria-current="page">Page {page}</span>
            </li>
            {history.nextAfterId && (
              <li>
                <Link
                  href={href(patientId, { field, after: { id: history.nextAfterId, page: page + 1 } })}
                  prefetch={false}
                  rel="next"
                >
                  Next page
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </>
  );
}
