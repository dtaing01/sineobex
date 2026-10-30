import type { Schemas } from '@sineobex/contract';
import type { Metadata } from 'next';
import { wipeDevice } from '@/app/actions/devices';
import { ActionForm, SubmitButton, TextField } from '@/components/ActionForm';
import { api, unwrap } from '@/lib/api';
import { formatDateTime, unsyncedSummary } from '@/lib/labels';

export const metadata: Metadata = { title: 'Phones' };

type TeamDevice = Schemas['TeamDevice'];

const STATUS: Record<TeamDevice['status'], string> = {
  active: 'Active',
  wipe_requested: 'Wipe requested',
  wiped: 'Wiped',
};

function clockText(d: TeamDevice): string {
  if (d.clockOffsetMs === null) return 'Not checked yet';
  const minutes = Math.round(Math.abs(d.clockOffsetMs) / 60000);
  if (!d.clockFlagged) return 'Correct';
  return `${minutes} minutes ${d.clockOffsetMs > 0 ? 'behind' : 'ahead'}, charting paused`;
}

/**
 * "Riley’s phone", or, when a person has more than one, "Riley’s phone 2 of 3 (Android, registered
 * …)": each wipe section needs its own name, for screen readers and so nobody wipes the wrong one.
 * Numbered by registration because two phones can register in the same minute.
 */
function phoneNames(listed: TeamDevice[]): Map<string, string> {
  const names = new Map<string, string>();
  const byUser = Map.groupBy(listed, (d) => d.user.userId);
  for (const own of byUser.values()) {
    const sorted = own.toSorted(
      (a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id),
    );
    sorted.forEach((d, i) => {
      const base = `${d.user.displayName}’s phone`;
      names.set(
        d.id,
        sorted.length === 1
          ? base
          : `${base} ${i + 1} of ${sorted.length} (${d.platform === 'ios' ? 'iPhone' : 'Android'}, registered ${formatDateTime(d.registeredAt)})`,
      );
    });
  }
  return names;
}

export default async function DevicesPage() {
  const devices = await unwrap((await api()).GET('/v1/team/devices'));
  const holding = devices.filter(
    (d) => d.status === 'active' && Object.values(d.unsyncedCounts).some((n) => n > 0),
  );
  const wipeable = devices.filter((d) => d.status !== 'wiped');
  const names = phoneNames(wipeable);

  return (
    <>
      <h1 className="px-h1">Phones</h1>
      <p className="sx-help">
        Each phone reports what it still holds at every sync. A phone listed as holding unsynced work has
        records the server doesn’t have yet.
      </p>
      {holding.length > 0 && (
        <p role="status" className="px-alert px-alert--info">
          {holding.length === 1 ? '1 phone is' : `${holding.length} phones are`} holding unsynced work.
        </p>
      )}
      <section aria-labelledby="devices-heading" className="px-panel">
        <h2 id="devices-heading" className="px-h2">
          Phones on this team ({devices.length})
        </h2>
        {devices.length === 0 ? (
          <p>No phone has synced with this team yet.</p>
        ) : (
          <table className="px-table">
            <caption className="sr-only">Phones, their sync status and what they still hold</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Status</th>
                <th scope="col">Last sync</th>
                <th scope="col">Waiting on the phone</th>
                <th scope="col">Clock</th>
                <th scope="col">Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const stale = d.unsyncedStale;
                return (
                  <tr key={d.id}>
                    <th scope="row">
                      {d.user.displayName}
                      <span className="sx-help">
                        {' '}
                        {d.platform === 'ios' ? 'iPhone' : 'Android'} · app {d.appVersion}
                      </span>
                    </th>
                    <td>{STATUS[d.status]}</td>
                    <td>{d.lastSyncAt ? formatDateTime(d.lastSyncAt) : 'Never'}</td>
                    <td>
                      {unsyncedSummary(d.unsyncedCounts)}
                      {d.oldestUnsyncedAt && (
                        <span className={stale ? 'px-warn' : 'sx-help'}>
                          {' '}
                          {stale ? 'Waiting more than 24 hours, since ' : 'since '}
                          {formatDateTime(d.oldestUnsyncedAt)}
                        </span>
                      )}
                    </td>
                    <td>{clockText(d)}</td>
                    <td>{d.openRejections === 0 ? 'Nothing' : `${d.openRejections} rejected`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {wipeable.map((d) => (
        <section key={d.id} aria-labelledby={`wipe-${d.id}`} className="px-panel">
          <h2 id={`wipe-${d.id}`} className="px-h2">
            Wipe {names.get(d.id)}
          </h2>
          {d.status === 'wipe_requested' ? (
            <p role="status" className="px-alert px-alert--info">
              Wipe requested{d.wipeRequestedAt ? ` ${formatDateTime(d.wipeRequestedAt)}` : ''}. The phone
              erases this team’s data the next time it reaches the server, and this page shows when it has.
            </p>
          ) : (
            <>
              <p>
                Only for a lost or stolen phone. It erases this team’s data at the phone’s next contact with
                the server
                {Object.values(d.unsyncedCounts).some((n) => n > 0) ? (
                  <>
                    ,{' '}
                    <strong>
                      including work that never reached the server: {unsyncedSummary(d.unsyncedCounts)}
                    </strong>
                    . That work is lost.
                  </>
                ) : (
                  <>. At its last sync it held nothing unsynced.</>
                )}
              </p>
              <ActionForm id={`wipe-form-${d.id}`} action={wipeDevice} label={`Wipe ${names.get(d.id)}`}>
                <input type="hidden" name="deviceId" value={d.id} />
                <TextField
                  name="reason"
                  label="Reason"
                  hint="For example: reported stolen on the route"
                  required
                />
                <SubmitButton variant="danger">Wipe this phone</SubmitButton>
              </ActionForm>
            </>
          )}
        </section>
      ))}
    </>
  );
}
