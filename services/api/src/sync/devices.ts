import type { Context } from 'hono';
import {
  deviceTx,
  requestMeta,
  type AuditFn,
  type DeviceActor,
  type RequestMeta,
  type TeamScope,
} from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { ApiError, conflict, notFound } from '../lib/errors.ts';
import type { AppEnv, Deps } from '../types.ts';
import {
  applyChange,
  changeOwners,
  findReceipt,
  precheck,
  quarantine,
  sameOwner,
  type ApplyActor,
} from './apply.ts';
import { canonicalJson } from './canonical.ts';
import { CLOCK_LIMIT_MS } from './push.ts';
import type { RejectReasonName, SyncChangeInput } from './schemas.ts';

/**
 * Phones and their keys (module 9). Each phone registers an Ed25519 key per team while its user is
 * signed in. Later the key alone lets it report a wipe, check whether it must wipe, and upload
 * unsynced work into quarantine after its user was removed, when it has no valid sign-in.
 */

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function verifyEd25519(publicKey: string, message: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64Url(publicKey), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      fromBase64Url(signature),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export interface RegisterInput {
  deviceId: string;
  platform: 'ios' | 'android' | 'other';
  appVersion: string;
  publicKey: string;
}

interface DeviceRow {
  id: string;
  userId: string;
  publicKey: string;
  status: 'active' | 'wipe_requested' | 'wiped';
  registeredAt: Date;
}

const deviceOut = (d: DeviceRow) => ({
  id: d.id,
  status: d.status,
  registeredAt: d.registeredAt.toISOString(),
});

export async function registerDevice(scope: TeamScope, input: RegisterInput) {
  return scope.tx(async (tx, audit) => {
    const inserted = await tx<DeviceRow[]>`
      insert into sineobex.devices (id, team_id, user_id, platform, app_version, public_key, last_seen_at)
      values (${input.deviceId}, ${scope.team.teamId}, ${scope.principal.userId}, ${input.platform},
              ${input.appVersion}, ${input.publicKey}, ${scope.deps.now()})
      on conflict (id) do nothing
      returning id, user_id, public_key, status, registered_at`;
    if (inserted[0]) {
      await audit({
        action: 'device.registered',
        entity: 'device',
        entityId: input.deviceId,
        details: { platform: input.platform, appVersion: input.appVersion },
      });
      return { created: true, device: deviceOut(inserted[0]) };
    }
    // Registering again with the same key is a retry. Anything else is refused: a key never changes.
    const rows = await tx<DeviceRow[]>`
      select id, user_id, public_key, status, registered_at from sineobex.devices where id = ${input.deviceId}`;
    const existing = rows[0];
    if (!existing || existing.userId !== scope.principal.userId || existing.publicKey !== input.publicKey) {
      throw conflict(
        'device_exists',
        'This phone ID is already registered. Reinstall the app to register again.',
      );
    }
    await tx`update sineobex.devices set app_version = ${input.appVersion}, last_seen_at = ${scope.deps.now()}
      where id = ${existing.id}`;
    return { created: false, device: deviceOut(existing) };
  });
}

export interface SignedBody {
  payload: Record<string, unknown> & { deviceId: string; purpose: string };
  signature: string;
}

interface SignedDevice extends DeviceActor {
  status: 'active' | 'wipe_requested' | 'wiped';
  payload: Record<string, unknown>;
}

/**
 * Verifies a device-signed request. The signature covers the canonical JSON of the payload exactly
 * as sent (before any defaults are applied), and the payload names its purpose so a signature for
 * one endpoint can't be replayed at another.
 */
export async function verifySigned(
  c: Context<AppEnv>,
  deps: Deps,
  deviceId: string,
  purpose: string,
): Promise<SignedDevice> {
  const raw = (await c.req.json()) as SignedBody;
  const refused = new ApiError(401, 'device_signature_invalid', 'This phone could not be verified.');
  if (raw.payload.deviceId.toLowerCase() !== deviceId.toLowerCase() || raw.payload.purpose !== purpose)
    throw refused;
  const rows = await deps.db.tx(
    {},
    (tx) => tx<{ teamId: string; userId: string; publicKey: string; status: SignedDevice['status'] }[]>`
      select * from sineobex.device_for_signature(${deviceId})`,
  );
  const d = rows[0];
  if (!d || !(await verifyEd25519(d.publicKey, canonicalJson(raw.payload), raw.signature))) throw refused;
  return {
    deviceId: deviceId.toLowerCase(),
    teamId: d.teamId,
    userId: d.userId,
    status: d.status,
    payload: raw.payload as Record<string, unknown>,
  };
}

async function access(deps: Deps, d: SignedDevice): Promise<'active' | 'removed'> {
  const rows = await deps.db.tx(
    { teamId: d.teamId, userId: d.userId },
    (tx) => tx<{ membership: string; user: string }[]>`
      select m.status as membership, u.status as user
      from sineobex.team_memberships m join sineobex.users u on u.id = m.user_id
      where m.team_id = ${d.teamId} and m.user_id = ${d.userId}`,
  );
  const r = rows[0];
  return r && r.membership === 'active' && r.user === 'active' ? 'active' : 'removed';
}

export async function deviceStatus(c: Context<AppEnv>, deps: Deps, deviceId: string) {
  const d = await verifySigned(c, deps, deviceId, 'status');
  const now = deps.now();
  // An old signed request replayed must not make a lost phone look recently seen. (It is still
  // answered: a phone whose clock is off must still learn that it has to wipe.)
  const sentAt = Date.parse(String(d.payload.sentAt ?? ''));
  if (Math.abs(now.getTime() - sentAt) <= CLOCK_LIMIT_MS) {
    await deps.db.tx(
      { teamId: d.teamId, userId: d.userId },
      (tx) => tx`update sineobex.devices set last_seen_at = ${now} where id = ${d.deviceId}`,
    );
  }
  return { status: d.status, access: await access(deps, d), serverTime: now.toISOString() };
}

/**
 * More than a phone's outbox ever holds. A removed person's keys stop here, whether they flood
 * the review queue or the audit chain: changes waiting for review and activity log entries they
 * handed over count together, from all of the person's phones on the team, so another phone buys
 * no more room to bury someone else's hand-over.
 */
export const MAX_PENDING_PER_PERSON = 5000;

interface HandedOver {
  pending: number;
  recorded: number;
}

/** One hand-over (or refusal report) at a time per person on a team, whichever phone sends it. */
async function lockPerson(tx: Tx, d: SignedDevice) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`handover:${d.teamId}:${d.userId}`}, 0))`;
}

/** What this person has handed over to this team, from any of their phones, that counts against the cap. */
async function handedOver(tx: Tx, d: SignedDevice): Promise<HandedOver> {
  // Activity log entries are never reviewed, so they count until the person syncs again. Pushes
  // are refused after removal, so every one recorded since their last push came through here.
  const [row] = await tx<HandedOver[]>`
    select (select count(*)::int from sineobex.quarantine_items
            where team_id = ${d.teamId} and user_id = ${d.userId} and status = 'pending') as pending,
           (select count(*)::int from sineobex.devices dv
            join sineobex.sync_changes s on s.device_id = dv.id
            where dv.team_id = ${d.teamId} and dv.user_id = ${d.userId} and s.entity = 'audit'
              and s.received_at > (
                select max(coalesce(last_sync_at, registered_at)) from sineobex.devices
                where team_id = ${d.teamId} and user_id = ${d.userId})) as recorded`;
  return row!;
}

/** Thrown inside a hand-over's transaction, so nothing that request stored is kept. */
class QuarantineFull extends Error {
  constructor(readonly held: HandedOver) {
    super('quarantine_full');
  }
}

type HandOverResult =
  | { changeId: string; status: 'quarantined' | 'recorded'; hash: string }
  | { changeId: string; status: 'rejected'; reason: RejectReasonName };

/** A removed user's phone hands over what it never synced. Nothing is applied to a chart. */
export async function uploadQuarantine(
  c: Context<AppEnv>,
  deps: Deps,
  deviceId: string,
  changes: SyncChangeInput[],
) {
  const d = await verifySigned(c, deps, deviceId, 'quarantine');
  if (d.status === 'wiped') throw conflict('device_wiped', 'This phone was wiped.');
  // An admin asked to wipe it: it wipes on the next answer and hands nothing over. Refusing here
  // also cuts off a removed person's key at the admin's word.
  if (d.status === 'wipe_requested') throw conflict('wipe_requested', 'This phone must be wiped.');
  if (d.status === 'active' && (await access(deps, d)) === 'active') {
    throw conflict('use_sync', 'This phone can still sync normally.');
  }
  const meta = requestMeta(c);
  const checked = await Promise.all(changes.map((change) => precheck(change)));
  try {
    return await deviceTx(deps, d, meta, async (tx, audit) => {
      // One hand-over at a time per person, counted and stored in this one transaction, so
      // parallel requests (from one phone or several) can't each find room under the cap.
      await lockPerson(tx, d);
      // Each change ID too, in order and before anything is written, so a push of the same ID
      // waits for this hand-over instead of deadlocking with it on the audit chain.
      await tx`
        select pg_advisory_xact_lock(hashtextextended(id, 0))
        from unnest(${changes.map((x) => x.changeId)}::text[]) as id order by id`;
      const held = await handedOver(tx, d);
      let room = MAX_PENDING_PER_PERSON - held.pending - held.recorded;
      // Only what this request adds counts: the phone starts every hand-over again from its
      // first entry, so most of a retry is already here.
      const take = () => {
        if (--room < 0) throw new QuarantineFull(held);
      };
      const results: HandOverResult[] = [];
      for (const [i, change] of changes.entries()) {
        const check = checked[i]!;
        if (!check.ok) {
          results.push({ changeId: change.changeId, status: 'rejected', reason: check.outcome.reason });
          continue;
        }
        if (change.entity === 'audit') {
          results.push(await recordAudit(tx, audit, d, change, check.hash, take));
          continue;
        }
        const added = await quarantine(
          tx,
          { teamId: d.teamId, authorId: d.userId, deviceId: d.deviceId },
          change,
          check.hash,
          'access_removed',
        );
        if (added) {
          take();
          await audit({
            action: 'sync.quarantined',
            entity: change.entity,
            entityId: change.recordId,
            deviceTime: new Date(change.deviceTime),
            details: { changeId: change.changeId, reason: 'access_removed' },
          });
        } else if (!(await heldFor(tx, change.changeId, d))) {
          // Someone else's change waits under this ID (here or in another team): nothing of this
          // phone's was stored, and answering "quarantined" would have it wipe the change.
          results.push({ changeId: change.changeId, status: 'rejected', reason: 'validation' });
          continue;
        }
        results.push({ changeId: change.changeId, status: 'quarantined', hash: check.hash });
      }
      return { results };
    });
  } catch (err) {
    if (!(err instanceof QuarantineFull)) throw err;
    await reportFull(deps, d, meta, err.held, changes.length);
    throw conflict('quarantine_full', 'Your phones have handed over more than a Program Admin can review.');
  }
}

/** This phone's own change is the one held for review under [changeId] (a re-sent hand-over). */
async function heldFor(tx: Tx, changeId: string, d: SignedDevice): Promise<boolean> {
  const rows = await tx`
    select 1 from sineobex.quarantine_items
    where change_id = ${changeId} and device_id = ${d.deviceId} and user_id = ${d.userId}`;
  return rows.length > 0;
}

/**
 * What the person looked at offline joins the audit chain as theirs, from their phone, at its
 * device time. It isn't anyone's to approve, and an admin accepting it would log the read as the
 * admin's.
 */
async function recordAudit(
  tx: Tx,
  audit: AuditFn,
  d: SignedDevice,
  change: SyncChangeInput,
  hash: string,
  take: () => void,
): Promise<HandOverResult> {
  const recorded = { changeId: change.changeId, status: 'recorded', hash } as const;
  const refused = { changeId: change.changeId, status: 'rejected', reason: 'validation' } as const;
  const existing = await findReceipt(tx, change.changeId);
  if (existing) {
    const mine = existing.userId === d.userId && existing.deviceId === d.deviceId;
    return mine && existing.status === 'accepted' ? recorded : refused;
  }
  // An ID held in another team is hidden from this one, and its receipt can't be stored twice.
  if ((await changeOwners(tx, change.changeId)).some((o) => !sameOwner(o, d))) return refused;
  take();
  const actor: ApplyActor = {
    teamId: d.teamId,
    authorId: d.userId,
    approvedBy: null,
    deviceId: d.deviceId,
    canChart: false,
    quarantineOnPermission: false,
    auditDetails: { afterRemoval: true },
  };
  return (await applyChange(tx, audit, actor, change, hash)).status === 'accepted' ? recorded : refused;
}

/**
 * Tells admins that a person's work is waiting beyond the cap. At most once a day per person: the
 * refused keys must not get to fill the audit chain with refusals instead.
 */
async function reportFull(deps: Deps, d: SignedDevice, meta: RequestMeta, held: HandedOver, sent: number) {
  await deviceTx(deps, d, meta, async (tx, audit) => {
    await lockPerson(tx, d);
    const recent = await tx`
      select 1 from sineobex.audit_events
      where team_id = ${d.teamId} and actor_user_id = ${d.userId} and action = 'sync.quarantine_full'
        and occurred_at > now() - interval '1 day'
      limit 1`;
    if (recent.length > 0) return;
    await audit({
      action: 'sync.quarantine_full',
      entity: 'device',
      entityId: d.deviceId,
      details: { ...held, sent, limit: MAX_PENDING_PER_PERSON },
    });
  });
}

export async function confirmWiped(c: Context<AppEnv>, deps: Deps, deviceId: string, wipedAt: string) {
  const d = await verifySigned(c, deps, deviceId, 'wiped');
  await deviceTx(deps, d, requestMeta(c), async (tx, audit) => {
    const rows = await tx`
      update sineobex.devices set status = 'wiped', wiped_at = ${deps.now()}
      where id = ${d.deviceId} and status <> 'wiped' returning id`;
    if (rows.length > 0) {
      await audit({
        action: 'device.wiped',
        entity: 'device',
        entityId: d.deviceId,
        details: { reportedAt: wipedAt },
      });
    }
  });
  return { ok: true as const };
}

interface TeamDeviceRow {
  id: string;
  userId: string;
  displayName: string;
  platform: string;
  appVersion: string;
  status: 'active' | 'wipe_requested' | 'wiped';
  registeredAt: Date;
  lastSeenAt: Date | null;
  lastSyncAt: Date | null;
  clockOffsetMs: number | null;
  clockFlaggedAt: Date | null;
  unsyncedCounts: Record<string, number>;
  oldestUnsyncedAt: Date | null;
  openRejections: number;
  wipeRequestedAt: Date | null;
  wipedAt: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Unsynced work older than this is flagged to the admin (module 9: "an admin alert at 24 hours"). */
export const UNSYNCED_STALE_MS = 24 * 60 * 60 * 1000;

export async function listDevices(scope: TeamScope) {
  const now = scope.deps.now().getTime();
  const rows = await scope.tx(
    (tx) => tx<TeamDeviceRow[]>`
      select d.*, u.display_name,
             (select count(*)::int from sineobex.sync_changes s
              where s.device_id = d.id and s.status = 'rejected' and s.resolved_by_change is null
                and coalesce(s.details ->> 'quarantined', 'false') <> 'true') as open_rejections
      from sineobex.devices d join sineobex.users u on u.id = d.user_id
      order by d.last_seen_at desc nulls last, d.registered_at desc`,
  );
  return rows.map((r) => ({
    id: r.id,
    user: { userId: r.userId, displayName: r.displayName },
    platform: r.platform,
    appVersion: r.appVersion,
    status: r.status,
    registeredAt: r.registeredAt.toISOString(),
    lastSeenAt: iso(r.lastSeenAt),
    lastSyncAt: iso(r.lastSyncAt),
    clockOffsetMs: r.clockOffsetMs,
    clockFlagged: r.clockFlaggedAt !== null,
    unsyncedCounts: r.unsyncedCounts,
    oldestUnsyncedAt: iso(r.oldestUnsyncedAt),
    unsyncedStale: r.oldestUnsyncedAt !== null && now - r.oldestUnsyncedAt.getTime() > UNSYNCED_STALE_MS,
    openRejections: r.openRejections,
    wipeRequestedAt: iso(r.wipeRequestedAt),
    wipedAt: iso(r.wipedAt),
  }));
}

/**
 * Remote wipe: the one exception to "never delete unconfirmed data" (module 9). The admin sees the
 * phone's unsynced counts on the devices page first; the event records them.
 */
export async function requestWipe(scope: TeamScope, deviceId: string, reason: string) {
  return scope.tx(async (tx, audit) => {
    const rows = await tx<{ id: string; status: string; unsyncedCounts: Record<string, number> }[]>`
      select id, status, unsynced_counts from sineobex.devices where id = ${deviceId} for update`;
    const d = rows[0];
    if (!d) throw notFound('phone');
    if (d.status !== 'active') throw conflict('already_wiping', 'This phone is already being wiped.');
    await tx`
      update sineobex.devices set status = 'wipe_requested', wipe_requested_by = ${scope.principal.userId},
        wipe_requested_at = ${scope.deps.now()}, wipe_reason = ${reason}
      where id = ${deviceId}`;
    await audit({
      action: 'device.wipe_requested',
      entity: 'device',
      entityId: deviceId,
      details: { reason, unsyncedCounts: d.unsyncedCounts },
    });
    return { ok: true as const };
  });
}
