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

/** An active link of the patient's group, locked by the handshake. */
interface ActiveLink {
  id: string;
  /** The record it was issued on: the canonical patient, or a record merged into it (D39). */
  patientId: string;
  tokenHash: string;
  effectiveAt: Date;
  receivedAt: Date;
  clockVerified: boolean;
  issuedBy: string;
}

/** The insert found the token's hash taken (in any team): roll back to the savepoint. */
class TokenTaken extends Error {}

const tokenRefOf = (tokenHash: string) => tokenHash.slice(0, 12);

/**
 * The handshake (design 10.4), inside the caller's transaction with the team lock already held:
 * lock the group's active links, decide (the issuer's `replacesLinkId` still active in the group
 * wins; otherwise, in 'sync' mode, the newer effective time wins, and in 'online' mode the answer is
 * `link_changed`), retire the losers, insert the new link with its final status (`on conflict
 * (token_hash) do nothing`, inside a savepoint), send the notices and write the audit events. The
 * permission check is the caller's. After a link wins, the group holds exactly one active link; a
 * link that loses changes nothing that was there.
 */
export async function idLinkHandshake(
  tx: Tx,
  audit: AuditFn,
  input: HandshakeInput,
  mode: 'sync' | 'online',
): Promise<HandshakeResult> {
  // Both callers check the shape first (the sync value schema; newIdLinkToken online). The table's
  // check constraint is the backstop, and inside a push the change's savepoint turns it into a
  // stored rejection.
  if (!ID_LINK_TOKEN_PATTERN.test(input.token)) throw new Error('idLinkHandshake: malformed token');

  const [patient] = await tx<{ teamId: string; status: string; canonicalId: string }[]>`
    select team_id, status, canonical_id from sineobex.patients where id = ${input.patientId}`;
  if (!patient) return { status: 'rejected', reason: 'stale_reference', problem: 'patient_missing' };
  // A card is made on the chart that is kept: the phone makes a new one from the survivor (2.6).
  if (patient.status !== 'active') {
    return {
      status: 'rejected',
      reason: 'stale_reference',
      problem: 'patient_merged',
      survivorId: patient.canonicalId,
    };
  }
  const teamId = patient.teamId;
  // This team's rows only (RLS). An ID taken in another team is the 2^-122 case: the primary key
  // refuses the insert, and inside a push the change's savepoint stores that as a rejection.
  const taken = await tx`select 1 from sineobex.patient_id_links where id = ${input.linkId}`;
  if (taken.length > 0) return { status: 'rejected', reason: 'validation', problem: 'record_exists' };

  // The group's active links: one, none, or one per merged record that had a card (D39). Newest
  // first by effective time; a tie goes to the later receipt.
  const active = await tx<ActiveLink[]>`
    select l.id, l.patient_id, l.token_hash, l.effective_at, l.received_at, l.clock_verified, l.issued_by
    from sineobex.patient_id_links l
    join sineobex.patients p on p.team_id = l.team_id and p.id = l.patient_id
    where p.team_id = ${teamId} and p.canonical_id = ${input.patientId} and l.status = 'active'
    order by l.effective_at desc, l.received_at desc, l.id
    for update of l`;

  // Decide before writing anything (review finding 14). The old card the issuer named is still
  // active somewhere in the group ("the old token is still the active one", read for groups), or
  // there is no card to replace: the new link wins and every active link of the group retires.
  // Otherwise another card was made since the issuer looked.
  const named = input.replacesLinkId !== null && active.some((l) => l.id === input.replacesLinkId);
  let rival: ActiveLink | null = null;
  if (active.length > 0 && !named) {
    // Online, the person is looking at the cards right now: show them the current ones and ask again.
    if (mode === 'online') return { status: 'link_changed', activeLinkIds: active.map((l) => l.id) };
    // Offline issues are decided by device time against the newest active card; a tie goes to this
    // receipt, the later one.
    // PLAN-OPEN: whether an unverified clock should lose a near-tie (design 10.4 step 3).
    rival = active[0]!;
  }
  const won = rival === null || input.effectiveAt.getTime() >= rival.effectiveAt.getTime();
  const retiredReason = rival ? 'superseded_by_newer' : 'regenerated';
  const retiring = won ? active : [];
  const tokenHash = await idLinkTokenHash(input.token);

  // Retire, then insert with the final status, so the per-record active index never sees two: when
  // the insert runs, nothing in the group is active any more (it won) or the new row isn't (it
  // lost). One conflict target only: a multi-target `do nothing` would swallow that index.
  try {
    await tx.savepoint(async (sp) => {
      if (retiring.length > 0) {
        await sp`
          update sineobex.patient_id_links
          set status = 'retired', retired_reason = ${retiredReason}, retired_by_link = ${input.linkId},
              retired_at = now()
          where team_id = ${teamId} and id = any(${retiring.map((l) => l.id)}::uuid[])`;
      }
      const inserted = await sp`
        insert into sineobex.patient_id_links
          (id, team_id, patient_id, token, token_hash, status, reason, replaces_link_id, effective_at,
           clock_verified, made_offline, retired_reason, retired_by_link, retired_at, issued_by,
           issued_device_id, change_id)
        values (${input.linkId}, ${teamId}, ${input.patientId}, ${input.token}, ${tokenHash},
                ${won ? 'active' : 'retired'}, ${input.reason}, ${input.replacesLinkId}, ${input.effectiveAt},
                ${input.clockVerified}, ${input.madeOffline}, ${won ? null : retiredReason},
                ${won ? null : rival!.id}, ${won ? null : sp`now()`}, ${input.issuedBy}, ${input.deviceId},
                ${input.changeId})
        on conflict (token_hash) do nothing
        returning id`;
      if (inserted.length === 0) throw new TokenTaken();
    });
  } catch (err) {
    // Taken by a link in some team (2^-128): nothing was retired or stored. The phone makes a new card.
    if (err instanceof TokenTaken)
      return { status: 'rejected', reason: 'validation', problem: 'token_taken' };
    throw err;
  }

  const tokenRef = tokenRefOf(tokenHash);
  await audit({
    action: 'id_link.generated',
    entity: 'id_link',
    entityId: input.linkId,
    patientId: input.patientId,
    details: {
      linkId: input.linkId,
      tokenRef,
      reason: input.reason,
      offline: input.madeOffline,
      status: won ? 'active' : 'retired',
      ...(input.changeId ? { changeId: input.changeId } : {}),
    },
  });
  const retired = won
    ? retiring.map((l) => ({ id: l.id, patientId: l.patientId, tokenRef: tokenRefOf(l.tokenHash) }))
    : [{ id: input.linkId, patientId: input.patientId, tokenRef }];
  const replacedBy = won ? input.linkId : rival!.id;
  for (const l of retired) {
    await audit({
      action: 'id_link.retired',
      entity: 'id_link',
      entityId: l.id,
      patientId: l.patientId,
      details: { linkId: l.id, tokenRef: l.tokenRef, replacedBy, reason: retiredReason },
    });
  }

  if (rival) {
    const mine = { id: input.linkId, effectiveAt: input.effectiveAt, clockVerified: input.clockVerified };
    const winner = won ? mine : rival;
    const loser = won ? rival : mine;
    // Kind, entity and link ID only: each app words the notice from its own data, after unlock.
    // The admins' notice names the card that is valid.
    await tx`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
      values (${teamId}, ${won ? rival.issuedBy : input.issuedBy}, 'id_link_superseded', 'id_link', ${loser.id}),
             (${teamId}, ${won ? input.issuedBy : rival.issuedBy}, 'id_link_kept', 'id_link', ${winner.id})`;
    await tx`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
      select m.team_id, m.user_id, 'id_link_conflict', 'id_link', ${winner.id}::uuid
      from sineobex.team_memberships m join sineobex.roles r on r.id = m.role_id
      where m.team_id = ${teamId} and m.status = 'active' and 'team.manage_users' = any (r.permissions)`;
    await audit({
      action: 'id_link.conflict_resolved',
      entity: 'id_link',
      entityId: winner.id,
      patientId: input.patientId,
      details: {
        winner: winner.id,
        loser: loser.id,
        effectiveAts: { winner: winner.effectiveAt.toISOString(), loser: loser.effectiveAt.toISOString() },
        clockVerified: { winner: winner.clockVerified, loser: loser.clockVerified },
      },
    });
  }

  return {
    status: 'accepted',
    linkOutcome: won ? 'active' : 'retired',
    activeLinkId: won ? input.linkId : rival!.id,
    retiredLinkIds: retired.map((l) => l.id),
  };
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
