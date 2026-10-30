import type { Metadata } from 'next';
import Link from 'next/link';
import { ReviewForm } from '@/components/ReviewForm';
import { api, unwrap } from '@/lib/api';
import { teamToday } from '@/lib/dob';
import { formatDateTime, syncFieldLabel } from '@/lib/labels';

export const metadata: Metadata = { title: 'Reviews' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function href(after?: { id: string; page: number }): string {
  if (!after) return '/team/reviews';
  return `/team/reviews?${new URLSearchParams({ after: after.id, page: String(after.page) })}`;
}

/**
 * Field reviews (design 3.2, 12.2): fields where two values were recorded, that the signed-in
 * person may decide. The API lists only those; loading the page logs each patient shown.
 */
export default async function ReviewsPage({
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
  const decided = one('decided');
  const queue = await unwrap(
    (await api()).GET('/v1/team/field-reviews', {
      params: { query: { status: 'open', ...(after ? { afterId: after } : {}) } },
    }),
  );
  const today = teamToday();
  const count = queue.reviews.length;

  return (
    <>
      <h1 className="px-h1">Reviews</h1>
      <p className="sx-help">
        Two people recorded different values for the same detail, and the chart kept its own. Choose which one
        the chart keeps; the other stays in the chart’s history. Opening this page is logged.
      </p>
      {decided === 'current' && (
        <p role="status" className="px-alert px-alert--ok">
          Decided. The chart keeps its value, and the other stays in its history.
        </p>
      )}
      {decided === 'alternate' && (
        <p role="status" className="px-alert px-alert--ok">
          Decided. The chart now shows the value you chose; the one it replaced stays in its history.
        </p>
      )}
      {count === 0 ? (
        <p className="px-panel">
          {page > 1 ? 'Nothing more after the previous page.' : 'Nothing is waiting for you to decide.'}
        </p>
      ) : (
        <p className="sx-help">
          Page {page}: {count} {count === 1 ? 'review' : 'reviews'}, oldest first.
        </p>
      )}
      {queue.reviews.map((review, i) => {
        const name = `${i + 1}. ${syncFieldLabel(review.field)}`;
        return (
          <section key={review.id} aria-labelledby={`r-${review.id}`} className="px-panel">
            <h2 id={`r-${review.id}`} className="px-h2">
              {name}
            </h2>
            <p>
              Opened {formatDateTime(review.openedAt)}.{' '}
              {/* No prefetch on any link to a patient page: loading one logs a view nobody made. */}
              <Link href={`/patients/${review.patientId}`} prefetch={false}>
                Open the chart<span className="sr-only"> for review {i + 1}</span>
              </Link>
            </p>
            <ReviewForm review={review} today={today} back="/team/reviews" name={name} />
          </section>
        );
      })}
      {(page > 1 || queue.nextAfterId) && (
        <nav aria-label="Review pages" className="px-tabs px-pager">
          <ul>
            {page > 1 && (
              <li>
                <Link href={href()} prefetch={false}>
                  First page
                </Link>
              </li>
            )}
            <li>
              <span aria-current="page">Page {page}</span>
            </li>
            {queue.nextAfterId && (
              <li>
                <Link href={href({ id: queue.nextAfterId, page: page + 1 })} prefetch={false} rel="next">
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
