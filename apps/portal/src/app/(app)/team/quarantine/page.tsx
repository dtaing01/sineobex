import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { decideQuarantine } from '@/app/actions/devices';
import { ActionForm, ChoiceField, SubmitButton, TextField } from '@/components/ActionForm';
import { api, unwrap } from '@/lib/api';
import { formatDateTime, quarantineValue, syncFieldLabel } from '@/lib/labels';

export const metadata: Metadata = { title: 'Quarantine' };

type Item = Schemas['QuarantineItem'];
const STATUSES = ['pending', 'accepted', 'rejected'] as const;
type Status = (typeof STATUSES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASON: Record<Item['reason'], string> = {
  access_removed: 'Sent after the person lost access to the team',
  permission: 'The person’s role no longer allows it',
};

const ENTITY: Record<string, string> = {
  encounter: 'Encounter',
  encounter_note: 'Note',
  audit: 'Activity log entry',
};

function what(item: Item): string {
  const entity = ENTITY[item.entity] ?? item.entity;
  if (item.op === 'create') return `New ${entity.toLowerCase()}`;
  return item.field ? `${entity}: ${syncFieldLabel(item.field)}` : entity;
}

/** Which part of the queue is shown. It lives in the URL, so a page can be linked and reloaded. */
interface View {
  status: Status;
  person?: string;
  /** The cursor, with the page number it leads to (only shown, never trusted). */
  after?: { id: string; page: number };
}

function href(view: View): string {
  const q = new URLSearchParams({ status: view.status });
  if (view.person) q.set('person', view.person);
  if (view.after) {
    q.set('after', view.after.id);
    q.set('page', String(view.after.page));
  }
  return `/team/quarantine?${q}`;
}

export default async function QuarantinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === 'string' ? v : '';
  };
  const status = (STATUSES as readonly string[]).includes(one('status'))
    ? (one('status') as Status)
    : 'pending';
  const person = UUID.test(one('person')) ? one('person') : undefined;
  const after = UUID.test(one('after')) ? one('after') : undefined;
  // The number is only shown: the cursor decides what the page holds.
  const page = after ? Math.min(Math.max(Number.parseInt(one('page'), 10) || 2, 2), 9999) : 1;
  const decided = one('decided');
  const queue = await unwrap(
    (await api()).GET('/v1/team/quarantine', {
      params: {
        query: { status, ...(person ? { userId: person } : {}), ...(after ? { afterId: after } : {}) },
      },
    }),
  );
  const name = queue.people.find((p) => p.userId === person)?.displayName;
  const from = name ? ` from ${name}` : '';
  const count = queue.items.length;

  return (
    <>
      <h1 className="px-h1">Quarantine</h1>
      <p className="sx-help">
        Records sent from phones whose user could no longer make them. Nothing here is on a chart until you
        accept it; a rejected record is kept here with your reason. Opening this page is logged.
      </p>
      {decided === 'accepted' && (
        <p role="status" className="px-alert px-alert--ok">
          Accepted. The change is on the chart, and your reason is logged.
        </p>
      )}
      {decided === 'rejected' && (
        <p role="status" className="px-alert px-alert--ok">
          Rejected. The record stays in quarantine with your reason.
        </p>
      )}
      <nav aria-label="Quarantine status" className="px-tabs">
        <ul>
          {STATUSES.map((s) => (
            <li key={s}>
              <Link href={href({ status: s, person })} aria-current={s === status ? 'page' : undefined}>
                {s === 'pending' ? 'Waiting for review' : s === 'accepted' ? 'Accepted' : 'Rejected'}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* A plain GET form: the choice lands in the URL with the status, and needs no script. */}
      <form
        method="get"
        action="/team/quarantine"
        className="px-form px-form--inline"
        aria-label="Choose whose records to show"
      >
        <input type="hidden" name="status" value={status} />
        <div className="px-field">
          <label htmlFor="q-person">Person</label>
          <select id="q-person" name="person" className="px-select" defaultValue={person ?? ''}>
            <option value="">Everyone</option>
            {queue.people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="sx-btn sx-btn--secondary">
          Show
        </button>
      </form>
      {count === 0 ? (
        <p className="px-panel">
          {page > 1
            ? 'Nothing more after the previous page.'
            : status === 'pending'
              ? `Nothing${from} is waiting for review.`
              : 'None yet.'}
        </p>
      ) : (
        <p className="sx-help">
          Page {page}
          {from}: {count} {count === 1 ? 'record' : 'records'}, oldest first.
        </p>
      )}
      {/* Numbered on the page: one person's records often read alike, and each section and form
          needs a name of its own to be told apart. */}
      {queue.items.map((item, i) => (
        <section key={item.id} aria-labelledby={`q-${item.id}`} className="px-panel">
          <h2 id={`q-${item.id}`} className="px-h2">
            {i + 1}. {what(item)} from {item.user.displayName}
          </h2>
          <dl className="px-facts">
            <dt>Why it is here</dt>
            <dd>{REASON[item.reason]}</dd>
            <dt>Made on the phone</dt>
            <dd>{formatDateTime(item.deviceTime)}</dd>
            <dt>Received</dt>
            <dd>{formatDateTime(item.receivedAt)}</dd>
            <dt>Value</dt>
            <dd>
              <pre className="px-value">{quarantineValue(item.value)}</pre>
            </dd>
            {item.decidedBy && (
              <>
                <dt>Decided</dt>
                <dd>
                  {item.status === 'accepted' ? 'Accepted' : 'Rejected'} by {item.decidedBy.displayName}
                  {item.decidedAt ? `, ${formatDateTime(item.decidedAt)}` : ''}: {item.decisionReason}
                </dd>
              </>
            )}
          </dl>
          {item.status === 'pending' && (
            <ActionForm
              id={`decide-${item.id}`}
              action={decideQuarantine}
              label={`Decide on ${i + 1}. ${what(item)}`}
            >
              <input type="hidden" name="itemId" value={item.id} />
              {/* After the decision the admin comes back to the same person and page. */}
              {person && <input type="hidden" name="person" value={person} />}
              {after && <input type="hidden" name="after" value={after} />}
              {after && <input type="hidden" name="page" value={page} />}
              <ChoiceField
                name="decision"
                legend="Decision"
                options={[
                  { value: 'accept', label: 'Accept onto the chart', hint: 'It can’t be taken off again.' },
                  { value: 'reject', label: 'Reject', hint: 'It stays here, with your reason, for good.' },
                ]}
              />
              <TextField name="reason" label="Reason" hint="Logged with your decision" required />
              <div className="px-actions">
                <SubmitButton>Record decision</SubmitButton>
              </div>
            </ActionForm>
          )}
        </section>
      ))}
      {(page > 1 || queue.nextAfterId) && (
        <nav aria-label="Quarantine pages" className="px-tabs px-pager">
          <ul>
            {page > 1 && (
              <li>
                <Link href={href({ status, person })}>First page</Link>
              </li>
            )}
            <li>
              <span aria-current="page">Page {page}</span>
            </li>
            {queue.nextAfterId && (
              <li>
                <Link
                  href={href({ status, person, after: { id: queue.nextAfterId, page: page + 1 } })}
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
