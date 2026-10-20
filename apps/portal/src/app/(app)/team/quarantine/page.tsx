import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { decideQuarantine } from '@/app/actions/devices';
import { ActionForm, TextField } from '@/components/ActionForm';
import { api, unwrap } from '@/lib/api';
import { formatDateTime, quarantineValue, syncFieldLabel } from '@/lib/labels';

export const metadata: Metadata = { title: 'Quarantine' };

type Item = Schemas['QuarantineItem'];
const STATUSES = ['pending', 'accepted', 'rejected'] as const;

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

export default async function QuarantinePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; decided?: string }>;
}) {
  const { status: raw, decided } = await searchParams;
  const status = (STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as (typeof STATUSES)[number])
    : 'pending';
  const items = await unwrap((await api()).GET('/v1/team/quarantine', { params: { query: { status } } }));

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
              <Link href={`/team/quarantine?status=${s}`} aria-current={s === status ? 'page' : undefined}>
                {s === 'pending' ? 'Waiting for review' : s === 'accepted' ? 'Accepted' : 'Rejected'}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {items.length === 0 && (
        <p className="px-panel">{status === 'pending' ? 'Nothing is waiting for review.' : 'None yet.'}</p>
      )}
      {items.map((item) => (
        <section key={item.id} aria-labelledby={`q-${item.id}`} className="px-panel">
          <h2 id={`q-${item.id}`} className="px-h2">
            {what(item)} from {item.user.displayName}
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
            <ActionForm id={`decide-${item.id}`} action={decideQuarantine} label={`Decide on ${what(item)}`}>
              <input type="hidden" name="itemId" value={item.id} />
              <TextField name="reason" label="Reason" hint="Logged with your decision" required />
              <div className="px-actions">
                <button type="submit" name="decision" value="accept" className="sx-btn sx-btn--primary">
                  Accept onto the chart
                </button>
                <button type="submit" name="decision" value="reject" className="sx-btn sx-btn--secondary">
                  Reject
                </button>
              </div>
            </ActionForm>
          )}
        </section>
      ))}
    </>
  );
}
