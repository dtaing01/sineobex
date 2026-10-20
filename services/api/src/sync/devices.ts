import type { Context } from 'hono';
import { deviceTx, requestMeta, type DeviceActor, type TeamScope } from '../auth/context.ts';
import { ApiError, conflict, notFound } from '../lib/errors.ts';
import type { AppEnv, Deps } from '../types.ts';
import { precheck, quarantine } from './apply.ts';
import { canonicalJson } from './canonical.ts';
import type { SyncChangeInput } from './schemas.ts';

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
  return { deviceId: deviceId.toLowerCase(), teamId: d.teamId, userId: d.userId, status: d.status };
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
  await deps.db.tx(
    { teamId: d.teamId, userId: d.userId },
    (tx) => tx`update sineobex.devices set last_seen_at = ${now} where id = ${d.deviceId}`,
  );
  return { status: d.status, access: await access(deps, d), serverTime: now.toISOString() };
}

/** A removed user's phone hands over what it never synced. Nothing is applied to a chart. */
export async function uploadQuarantine(
  c: Context<AppEnv>,
  deps: Deps,
  deviceId: string,
  changes: SyncChangeInput[],
) {
  const d = await verifySigned(c, deps, deviceId, 'quarantine');
  if (d.status === 'wiped') throw conflict('device_wiped', 'This phone was wiped.');
  if (d.status === 'active' && (await access(deps, d)) === 'active') {
    throw conflict('use_sync', 'This phone can still sync normally.');
  }
  const meta = requestMeta(c);
  const results = [];
  for (const change of changes) {
    const checked = await precheck(change);
    if (!checked.ok) {
      results.push({
        changeId: change.changeId,
        status: 'rejected' as const,
        reason: checked.outcome.reason,
      });
      continue;
    }
    await deviceTx(deps, d, meta, async (tx, audit) => {
      const added = await quarantine(
        tx,
        { teamId: d.teamId, authorId: d.userId, deviceId: d.deviceId },
        change,
        checked.hash,
        'access_removed',
      );
      if (added) {
        await audit({
          action: 'sync.quarantined',
          entity: change.entity,
          entityId: change.recordId,
          deviceTime: new Date(change.deviceTime),
          details: { changeId: change.changeId, reason: 'access_removed' },
        });
      }
    });
    results.push({ changeId: change.changeId, status: 'quarantined' as const, hash: checked.hash });
  }
  return { results };
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

export async function listDevices(scope: TeamScope) {
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
