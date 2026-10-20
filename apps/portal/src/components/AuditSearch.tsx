'use client';

import { useActionState } from 'react';
import { searchAudit, verifyChain, type AuditState } from '@/app/actions/audit';
import { formatDateTime } from '@/lib/labels';

const ACTIONS = [
  { value: '', label: 'Any action' },
  { value: 'session.', label: 'Sign-ins' },
  { value: 'membership.', label: 'Staff access changes' },
  { value: 'role.', label: 'Role changes' },
  { value: 'access.denied', label: 'Refused requests' },
  { value: 'audit.', label: 'Audit searches' },
];

export function AuditSearch({ people }: { people: { userId: string; displayName: string }[] }) {
  const [state, search, searching] = useActionState(searchAudit, {} as AuditState);
  const [chainState, verify, verifying] = useActionState(verifyChain, {} as AuditState);
  return (
    <>
      <form action={search} className="px-form px-form--inline" aria-label="Search the audit log">
        <div className="px-field">
          <label htmlFor="actorUserId">Person</label>
          <select
            id="actorUserId"
            name="actorUserId"
            className="px-select"
            defaultValue={state.filters?.actorUserId ?? ''}
          >
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="px-field">
          <label htmlFor="actionPrefix">Action</label>
          <select
            id="actionPrefix"
            name="actionPrefix"
            className="px-select"
            defaultValue={state.filters?.actionPrefix ?? ''}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="px-field">
          <label htmlFor="from">From</label>
          <div className="sx-input">
            <input id="from" name="from" type="date" defaultValue={state.filters?.from} />
          </div>
        </div>
        <div className="px-field">
          <label htmlFor="to">To</label>
          <div className="sx-input">
            <input id="to" name="to" type="date" defaultValue={state.filters?.to} />
          </div>
        </div>
        <button type="submit" className="sx-btn sx-btn--primary" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="px-alert px-alert--error">
          {state.error}
        </p>
      )}
      <div aria-live="polite">
        {state.entries && (
          <table className="px-table">
            <caption>
              {state.entries.length} {state.entries.length === 1 ? 'entry' : 'entries'}, newest first
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Record</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.occurredAt)}</td>
                  <td>{e.actor.displayName ?? 'System'}</td>
                  <td>
                    <code className="sx-data">{e.action}</code>
                  </td>
                  <td>{e.entity ? `${e.entity}` : '—'}</td>
                  <td>{e.ip ?? (e.deviceId ? 'Phone' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form action={verify} className="px-form" aria-label="Check the audit log for tampering">
        <p className="sx-help">
          Recomputes every entry’s hash. Any edited or deleted entry breaks the chain.
        </p>
        <button type="submit" className="sx-btn sx-btn--secondary" disabled={verifying}>
          {verifying ? 'Checking…' : 'Check for tampering'}
        </button>
      </form>
      <div aria-live="polite">
        {chainState.chain && (
          <p className={`px-alert ${chainState.chain.ok ? 'px-alert--ok' : 'px-alert--error'}`}>
            {chainState.chain.ok
              ? `Intact: ${chainState.chain.checked} entries checked.`
              : `Problem at entry ${chainState.chain.firstBadSeq}: ${chainState.chain.problem}. Report this to the platform owners.`}
          </p>
        )}
      </div>
    </>
  );
}
