import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { notImplemented } from './pending.ts';
import type { IdLinkReasonValue, IdLinkStateValue, IssueIdLinkInput } from './schemas.ts';

/**
 * Street Medicine ID links (phase 3 design, section 10).
 *
 * The token is 16 bytes from a cryptographically secure generator, base64url without padding (22
 * characters), never derived from a patient ID, name or time. It is stored as plaintext (Copy ID
 * link works for anyone with patients.edit at any time) and as SHA-256, which uniqueness and every
 * lookup use, so the plaintext is never in a `where` clause, a statement log or an audit row. Audit
 * events and notices carry `tokenRef`: the first 12 hex characters of that hash. The URL puts the
 * token in the fragment, which browsers and QR scanners never send to a server. The token helpers
 * are pinned by packages/contract/test-vectors/id-link-token.json, with the phone's.
 */

export const ID_LINK_TOKEN_BYTES = 16;
export const ID_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function newIdLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LINK_TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** SHA-256 of the token's ASCII, lowercase hex: patient_id_links.token_hash. */
export async function idLinkTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What audit events and notices name a token by. */
export async function idLinkTokenRef(token: string): Promise<string> {
  return (await idLinkTokenHash(token)).slice(0, 12);
}

/** `{ID_LINK_BASE_URL}/c#<token>`: the portal's public landing page, the token in the fragment. */
export function idLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/c#${token}`;
}

/** One issue of a link, from a phone's `id_link` create or the online route (design 10.4). */
export interface HandshakeInput {
  /** The link's own ID (the change's recordId, or IssueIdLink.linkId). */
  linkId: string;
  /** The patient the issuer named; must be canonical (a merged ID is `patient_merged`). */
  patientId: string;
  token: string;
  /** The newest active link the issuer saw for the group, or null when it saw none. */
  replacesLinkId: string | null;
  reason: IdLinkReasonValue;
  /** Corrected device time offline, server time online: decides a conflict. */
  effectiveAt: Date;
  clockVerified: boolean;
  madeOffline: boolean;
  issuedBy: string;
  deviceId: string | null;
  changeId: string | null;
}

export type HandshakeResult =
  /** Stored: active (it won, every other active link of the group retired) or retired (it lost). */
  | { status: 'accepted'; linkOutcome: 'active' | 'retired'; activeLinkId: string; retiredLinkIds: string[] }
  /** A validation rejection (`token_taken`, `record_exists`) or a stale reference (`patient_missing`,
   * `patient_merged` with the survivor). Nothing was stored. */
  | {
      status: 'rejected';
      reason: 'validation' | 'stale_reference';
      problem: 'token_taken' | 'record_exists' | 'patient_missing' | 'patient_merged';
      survivorId?: string;
    }
  /** Online only: `replacesLinkId` is not active anywhere in the group (409 link_changed). */
  | { status: 'link_changed'; activeLinkIds: string[] };

/**
 * The handshake (design 10.4), inside the caller's transaction with the team lock already held:
 * lock the group's active links, decide (the issuer's `replacesLinkId` still active in the group
 * wins; otherwise, in 'sync' mode, the newer effective time wins, and in 'online' mode the answer is
 * `link_changed`), retire the losers, insert the new link with its final status (`on conflict
 * (token_hash) do nothing`, inside a savepoint), send the notices and write the audit events. The
 * permission check is the caller's. After it the group holds exactly one active link.
 */
export async function idLinkHandshake(
  _tx: Tx,
  _audit: AuditFn,
  _input: HandshakeInput,
  _mode: 'sync' | 'online',
): Promise<HandshakeResult> {
  throw notImplemented();
}

/**
 * GET /v1/patients/{patientId}/id-link: the group's active links (usually one; one per merged
 * record that had a card until the next regeneration, D39) and their history. A merged ID answers
 * its survivor's. Audited as `id_link.viewed {linkId, tokenRef}` per active link shown.
 */
export async function getIdLinks(_scope: TeamScope, _patientId: string): Promise<IdLinkStateValue> {
  throw notImplemented();
}

/**
 * POST /v1/patients/{patientId}/id-link: the server makes the token and runs the handshake in
 * 'online' mode with server time. 409 link_changed {activeLinkIds} or 409 patient_merged
 * {survivorId}; neither carries a URL or a token.
 */
export async function issueIdLink(
  _scope: TeamScope,
  _patientId: string,
  _input: IssueIdLinkInput,
): Promise<IdLinkStateValue> {
  throw notImplemented();
}
