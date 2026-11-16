import { CAPABILITIES, type Credential } from '../auth/permissions.ts';

/**
 * The credential a signature or a correction is recorded under (phase 4 design, lifecycle 3.5).
 * "Signed notes keep the credential they were signed under", and an offline signature is checked
 * days later, so the answer is the credential at the time of signing, not at the time of syncing.
 * Server-only and pure; packages/contract/test-vectors/signed-under.json holds every answer.
 */

/** A credential with the fields it was held with (team_memberships, and membership_changes values). */
export interface CredentialSnapshot {
  credential: Credential;
  fields: Record<string, string>;
}

/**
 * A membership_changes row of kind `credential` or `restored`, with its old_value: both replace the
 * credential and its fields (a restore is a re-invite of a removed person, who may come back with
 * another credential or another NPI). Rows of other kinds carry no credential and are not passed.
 */
export interface CredentialChange {
  changedAt: string;
  /** What the person held until this change. */
  oldValue: CredentialSnapshot;
}

export interface SignedUnderInput {
  /** The signer's membership now, also when they were removed since. */
  current: CredentialSnapshot;
  /** The membership's credential changes and restores made after `signedAt`. Earlier ones are passed over. */
  laterChanges: CredentialChange[];
  /** Clock-corrected device time of the act, as the phone gave it. Times are ISO 8601 in UTC. */
  signedAt: string;
  receivedAt: string;
  clockVerified: boolean;
  /** When the server received the note's create. */
  notBefore: string;
  /** The credential the phone's saved profile showed; null for a `complete` and for an online act. */
  claimed: Credential | null;
}

export interface SignedUnder {
  /** The credential found, and what the row stores of it: its NPI apart from its other fields. */
  credential: Credential;
  npi: string | null;
  fields: Record<string, string>;
  timeTrusted: boolean;
  canSign: boolean;
  needsAttestation: boolean;
  /** The phone claimed another credential than the one found: the audit event says so. */
  claimDiffers: boolean;
}

/** How far after its receipt a signature time may lie and be believed: CLOCK_LIMIT_MS of sync/push.ts. */
export const TRUSTED_AHEAD_MS = 5 * 60_000;

/**
 * PLAN-OPEN: does a note signed offline count as signed at device time or at server receipt
 * (lifecycle 12.1 #1; plan section 6)? At device time, when that time can be trusted.
 * PLAN-OPEN: which credential is a signature recorded under when its time cannot be trusted
 * (lifecycle 12.1 #22; plan section 6)? The one held when the server receives it, with the
 * phone's claim stored beside it.
 */
export function signedUnder(i: SignedUnderInput): SignedUnder {
  // A change's time comes from a timestamptz column: one that cannot be read is the server's own
  // fault, and passing over it could record a signature under a credential it was not made under.
  if (i.laterChanges.some((change) => Number.isNaN(Date.parse(change.changedAt)))) {
    throw new Error('a credential change has a time that cannot be read');
  }
  const signedAt = Date.parse(i.signedAt);
  // `clockVerified` is the phone's own word. A time from before the server knew the note could
  // date a signature to before a credential was lowered, so it is not believed. Neither is a time
  // that cannot be read: every comparison with it is false.
  const timeTrusted =
    i.clockVerified &&
    signedAt - Date.parse(i.receivedAt) <= TRUSTED_AHEAD_MS &&
    signedAt >= Date.parse(i.notBefore);

  let found = i.current;
  if (timeTrusted) {
    // The first change after the signature: its old value is what the signer held when signing.
    let first: number | undefined;
    for (const change of i.laterChanges) {
      const at = Date.parse(change.changedAt);
      if (at > signedAt && (first === undefined || at < first)) {
        first = at;
        found = change.oldValue;
      }
    }
  }

  const { npi, ...fields } = found.fields;
  return {
    credential: found.credential,
    npi: npi ?? null,
    fields,
    timeTrusted,
    canSign: CAPABILITIES[found.credential].sign,
    // The claim can only make the answer more careful, never less.
    needsAttestation:
      CAPABILITIES[found.credential].billingNeedsAttestation ||
      (i.claimed !== null && CAPABILITIES[i.claimed].billingNeedsAttestation),
    claimDiffers: i.claimed !== null && i.claimed !== found.credential,
  };
}
