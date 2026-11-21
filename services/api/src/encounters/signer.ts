import { CAPABILITIES, CREDENTIALS, type Credential } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import type { CredentialChange, CredentialSnapshot } from './signed-under.ts';

/**
 * The person a signature, a correction or the Medical gate is about (phase 4 design, lifecycle
 * 4.2). The actor of a change carries the role's permissions and no credential, and it stays that
 * way: when a Program Admin accepts a held change, the actor is the admin's approval while the
 * signer is still the change's author. So the credential is loaded here, inside the change's
 * transaction, never carried. signedUnder (signed-under.ts) takes what these two return.
 */

export interface Signer {
  userId: string;
  displayName: string;
  /** False once removed from the team. */
  active: boolean;
  /** The membership's credential now (its last one, if removed). */
  credential: Credential;
  /** credential_fields now. */
  fields: Record<string, string>;
}

interface SignerRow {
  displayName: string;
  status: 'active' | 'removed';
  credential: Credential;
  credentialFields: Record<string, string>;
}

/** The person's membership of the team, removed or not; null when they never were a member. */
export async function loadSigner(tx: Tx, teamId: string, userId: string): Promise<Signer | null> {
  const [row] = await tx<SignerRow[]>`
    select u.display_name, m.status, m.credential, m.credential_fields
    from sineobex.team_memberships m join sineobex.users u on u.id = m.user_id
    where m.team_id = ${teamId} and m.user_id = ${userId}`;
  if (!row) return null;
  return {
    userId,
    displayName: row.displayName,
    active: row.status === 'active',
    credential: row.credential,
    fields: row.credentialFields,
  };
}

/** Whether the person may chart a Medical note now (lifecycle 1.3): an active member whose credential does. */
export const chartsMedical = (signer: Signer | null): boolean =>
  signer !== null && signer.active && CAPABILITIES[signer.credential].chartMedical;

/**
 * The membership_changes rows of kind `credential` and `restored` made after `at`, oldest first,
 * each with what it replaced (lifecycle 3.5): both replace the credential and its fields. Other
 * kinds carry no credential.
 *
 * A restore recorded before restores kept what they replaced (phase 1; services/memberships.ts
 * from phase 4 on) has no old_value and is passed over. Such a row is older than every note that
 * can be signed, so it never falls after a signature whose time is trusted, the only time
 * signedUnder reads these rows.
 *
 * changed_at holds microseconds and a JavaScript time milliseconds. Each time is rounded up to its
 * millisecond, so a change made within the millisecond after `at`, which the query finds, also
 * reads as after `at` to signedUnder, which compares the two times again.
 */
export async function credentialChangesAfter(
  tx: Tx,
  teamId: string,
  userId: string,
  at: Date,
): Promise<CredentialChange[]> {
  const rows = await tx<{ changedAtMs: number; oldValue: unknown }[]>`
    select ceil(extract(epoch from c.changed_at) * 1000)::float8 as changed_at_ms, c.old_value
    from sineobex.membership_changes c
    join sineobex.team_memberships m on m.id = c.membership_id and m.team_id = c.team_id
    where c.team_id = ${teamId} and m.user_id = ${userId}
      and c.kind in ('credential', 'restored') and c.old_value is not null
      and c.changed_at > ${at}
    order by c.changed_at, c.id`;
  return rows.map((r) => ({
    changedAt: new Date(r.changedAtMs).toISOString(),
    oldValue: snapshot(r.oldValue),
  }));
}

/**
 * What a row says the person held. The server writes these rows itself, so one it cannot read is
 * its own fault, and reading it as some credential could record a signature under one it was not
 * made under. The message names no value.
 */
function snapshot(value: unknown): CredentialSnapshot {
  const v = value as { credential?: unknown; fields?: unknown } | null;
  const fields = v?.fields;
  if (
    typeof v?.credential !== 'string' ||
    !(CREDENTIALS as readonly string[]).includes(v.credential) ||
    typeof fields !== 'object' ||
    fields === null ||
    Array.isArray(fields) ||
    Object.values(fields).some((f) => typeof f !== 'string')
  ) {
    throw new Error('a credential change holds no credential it replaced');
  }
  return { credential: v.credential as Credential, fields: fields as Record<string, string> };
}
