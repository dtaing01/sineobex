import type { TeamScope } from '../auth/context.ts';
import { TeamScope as Scope } from '../auth/context.ts';
import { conflict } from '../lib/errors.ts';
import {
  applyChange,
  changeOwners,
  findReceipt,
  precheck,
  resultFromReceipt,
  sameOwner,
  toResult,
  type ApplyActor,
} from './apply.ts';
import type { SyncChangeInput, SyncResultValue } from './schemas.ts';

/** Charting pauses beyond this offset (module 9, decided Oct 12). The phone enforces it; the server flags it. */
export const CLOCK_LIMIT_MS = 5 * 60_000;
const INT32 = 2_147_483_647;

export interface PushInput {
  deviceId: string;
  clock: { deviceTime: string };
  unsynced: { counts: Record<string, number>; oldest?: string };
  changes: SyncChangeInput[];
}

interface DeviceRow {
  id: string;
  userId: string;
  status: 'active' | 'wipe_requested' | 'wiped';
  clockFlaggedAt: Date | null;
}

export async function push(scope: TeamScope, input: PushInput) {
  const now = scope.deps.now();
  const offsetMs = Math.max(
    -INT32,
    Math.min(INT32, now.getTime() - new Date(input.clock.deviceTime).getTime()),
  );
  const flagged = Math.abs(offsetMs) > CLOCK_LIMIT_MS;

  const device = await scope.tx(async (tx, audit) => {
    const rows = await tx<DeviceRow[]>`
      select id, user_id, status, clock_flagged_at from sineobex.devices
      where id = ${input.deviceId} for update`;
    const d = rows[0];
    if (!d || d.userId !== scope.principal.userId) {
      throw conflict('device_not_registered', 'Register this phone before syncing.');
    }
    await tx`
      update sineobex.devices set
        last_seen_at = ${now},
        clock_offset_ms = ${offsetMs},
        clock_flagged_at = ${flagged ? (d.clockFlaggedAt ?? now) : null},
        unsynced_counts = ${tx.json(input.unsynced.counts)},
        oldest_unsynced_at = ${input.unsynced.oldest ? new Date(input.unsynced.oldest) : null}
      where id = ${d.id}`;
    if (flagged && !d.clockFlaggedAt) {
      await audit({
        action: 'device.clock_flagged',
        entity: 'device',
        entityId: d.id,
        details: { offsetMs },
      });
    }
    return d;
  });

  const base = { serverTime: now.toISOString(), clock: { offsetMs, flagged } };
  // A phone an admin asked to wipe sends nothing more; it wipes on this answer.
  if (device.status !== 'active') return { ...base, results: [], device: { status: device.status } };

  // Audit events for this push name the phone that made the changes.
  const deviceScope = new Scope(scope.deps, scope.principal, scope.team, {
    ...scope.meta,
    deviceId: device.id,
  });
  const actor: ApplyActor = {
    teamId: scope.team.teamId,
    authorId: scope.principal.userId,
    approvedBy: null,
    deviceId: device.id,
    canChart: scope.can('encounters.chart'),
    quarantineOnPermission: true,
  };

  const results: SyncResultValue[] = [];
  // Oldest first by the phone's own sequence, never by its clock (module 9).
  const ordered = [...input.changes].sort((a, b) => a.seq - b.seq);
  for (const change of ordered) {
    try {
      // A time the server just measured as more than 5 minutes off is never stored as verified,
      // whatever the phone claims.
      const stamped = flagged ? { ...change, clockVerified: false } : change;
      results.push(await processOne(deviceScope, actor, stamped));
    } catch (err) {
      // Stop here, keeping order: the phone sends this change and everything after it again.
      scope.deps.log.error('sync.change_failed', {
        requestId: scope.meta.requestId,
        deviceId: device.id,
        count: results.length,
        errorName: err instanceof Error ? err.name : 'unknown',
      });
      break;
    }
  }

  await scope.deps.db.tx({ teamId: scope.team.teamId, userId: scope.principal.userId }, async (tx) => {
    await tx`update sineobex.devices set last_sync_at = ${now} where id = ${device.id}`;
  });
  scope.deps.log.info('sync.pushed', {
    requestId: scope.meta.requestId,
    deviceId: device.id,
    count: input.changes.length,
    accepted: results.filter((r) => r.status === 'accepted').length,
    rejected: results.filter((r) => r.status === 'rejected').length,
    conflicts: results.filter((r) => r.status === 'conflict').length,
  });
  return { ...base, results, device: { status: device.status } };
}

/** One change, one transaction: the data, its receipt and its audit entry commit together. */
async function processOne(
  scope: TeamScope,
  actor: ApplyActor,
  change: SyncChangeInput,
): Promise<SyncResultValue> {
  const checked = await precheck(change);
  if (!checked.ok && !checked.store) return toResult(change.changeId, checked.outcome);
  return scope.tx(async (tx, audit) => {
    // A retry racing its own first attempt waits here, then finds the receipt.
    await tx`select pg_advisory_xact_lock(hashtextextended(${change.changeId}, 0))`;
    const existing = await findReceipt(tx, change.changeId);
    if (existing) {
      if (existing.userId !== actor.authorId || existing.deviceId !== actor.deviceId)
        return reused(change.changeId);
      return resultFromReceipt(tx, existing);
    }
    // An ID held anywhere else stays its holder's: a removed person's change held for review (or
    // the admin could never apply it), or a change in another team, which this one can't see.
    const mine = { teamId: actor.teamId, userId: actor.authorId, deviceId: actor.deviceId };
    if ((await changeOwners(tx, change.changeId)).some((o) => !sameOwner(o, mine)))
      return reused(change.changeId);
    // This person's own change, handed over for review after they were removed: however the
    // phone sends it again, only the admin's decision puts it on the chart. (An accepted one has
    // a receipt, answered above.)
    const [held] = await tx<{ status: 'pending' | 'rejected'; valueHash: string }[]>`
      select status, value_hash from sineobex.quarantine_items where change_id = ${change.changeId}`;
    if (held) {
      return toResult(
        change.changeId,
        {
          status: 'rejected',
          reason: 'permission',
          details: { problem: 'held_for_review', decision: held.status },
          quarantined: true,
        },
        held.valueHash,
      );
    }
    return checked.ok
      ? applyChange(tx, audit, actor, change, checked.hash)
      : applyChange(tx, audit, actor, change, change.valueHash, checked.outcome);
  });
}

function reused(changeId: string): SyncResultValue {
  return {
    changeId,
    status: 'rejected',
    reason: 'validation',
    message: 'This change ID was already used. The app will make a new one.',
    details: { problem: 'change_id_reused' },
  };
}
