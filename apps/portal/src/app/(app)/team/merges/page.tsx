import type { Metadata } from 'next';
import Link from 'next/link';
import { recordName, who } from '@/components/SideBySide';
import { api, unwrap } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { can, currentUser } from '@/lib/me';
import { UndoMerge } from './UndoMerge';

export const metadata: Metadata = { title: 'Merges' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function href(after?: { id: string; page: number }): string {
  return after
    ? `/team/merges?${new URLSearchParams({ after: after.id, page: String(after.page) })}`
    : '/team/merges';
}

export default async function MergesPage({
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
  const { team } = await currentUser();
  const reviews = can(team, 'patients.review_duplicates');
  const list = await unwrap(
    (await api()).GET('/v1/team/merges', { params: { query: after ? { afterId: after } : {} } }),
  );
  const count = list.merges.length;

  return (
    <>
      <h1 className="px-h1">Merges</h1>
      <p className="sx-help">
        Charts merged after a duplicate review. A merge moves nothing, so undoing it gives each record back
        its own details, records and ID cards. Opening this page is logged.
      </p>
      {count === 0 ? (
        <p className="px-panel">{page > 1 ? 'Nothing more after the previous page.' : 'No merges yet.'}</p>
      ) : (
        <p className="sx-help">
          Page {page}: {count} {count === 1 ? 'merge' : 'merges'}, newest first.
        </p>
      )}
      {list.merges.map((m, i) => {
        const heading = `merge-${m.id}`;
        const survivor = who(m.survivor.summary);
        const merged = who(m.merged.summary);
        return (
          <section key={m.id} aria-labelledby={heading} className="px-panel">
            <h2 id={heading} className="px-h2">
              {i + 1}. {merged}, merged into {survivor}
            </h2>
            <dl className="px-facts">
              <div>
                <dt>Kept chart</dt>
                <dd>{survivor}</dd>
              </div>
              <div>
                <dt>Merged record</dt>
                <dd>{merged}</dd>
              </div>
              <div>
                <dt>Merged</dt>
                <dd>
                  {formatDateTime(m.mergedAt)} by {m.mergedBy.displayName}
                </dd>
              </div>
              <div>
                <dt>Comment</dt>
                <dd>{m.comment}</dd>
              </div>
              {m.undone && (
                <div>
                  <dt>Undone</dt>
                  <dd>
                    {formatDateTime(m.undone.at)} by {m.undone.by.displayName}: {m.undone.comment}
                  </dd>
                </div>
              )}
            </dl>
            {reviews && (
              <p>
                <Link href={`/team/duplicates/${m.pairId}`} aria-describedby={heading}>
                  The pair and its decisions
                </Link>
              </p>
            )}
            <UndoMerge
              mergeId={m.id}
              undoable={m.undoable}
              describedBy={heading}
              names={{
                survivorId: m.survivor.patientId,
                survivor: recordName(m.survivor.summary),
                mergedId: m.merged.patientId,
                merged: recordName(m.merged.summary),
              }}
            />
          </section>
        );
      })}
      {(page > 1 || list.nextAfterId) && (
        <nav aria-label="Merge pages" className="px-tabs px-pager">
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
