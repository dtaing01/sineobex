import { lockTeam } from '@sineobex/forms';
import type { TransactionSql } from 'postgres';
import { demoId, demoPatientId } from './demo-patients.ts';

/**
 * Made-up flags on two demo patients (phase 5 design 13.4, card P5-seed; 9, "demo additions start
 * Demo:"): the platform's High risk level, coloured Red, on one, and its Frost risk condition on
 * another, each with a reason starting "Demo:". Each is written as sync applies a phone's flag change
 * (design 6.2, 4.5) and as demo-encounters.ts writes its visits: by a seeded staff member who holds
 * patients.edit and may see the flag, the change's time the phone's own, never later than its
 * receipt, its clock verified. The seed cannot import the API (the API imports this package), so the
 * few rules it needs are restated here; db/test/demo-flags.test.ts holds every row to the API's own
 * functions. Nothing is audited: the seed is not anyone's act, as its patients and visits are not.
 */

/** Seeded IDs are fixed, so the seed is idempotent and tests can name what they need. */
export const demoFlagChangeId = (n: number) => demoId('31', n);

/** The platform flags the changes set, by origin key (packages/presets/data/platform.json). */
const NAMED = ['flag.high', 'flag.frost_risk'] as const;
type Named = (typeof NAMED)[number];

interface DemoFlagChange {
  n: number;
  patient: number;
  flag: Named;
  /** The staff email of whoever set it, on their phone. */
  by: string;
  /** When it was set, by the phone's clock, which was right: the change's own time. */
  at: string;
  reason: string;
}

const CHANGES: readonly DemoFlagChange[] = [
  {
    // The man in the blue wheelchair (21), by the attending who saw his pressure ulcer that evening
    // (demo-encounters.ts, visit 3).
    n: 1,
    patient: 21,
    flag: 'flag.high',
    by: 'clinician@example.com',
    at: '2026-10-24T22:40:00Z',
    reason: 'Demo: open pressure sore and sleeping outside; recheck the dressing within a week',
  },
  {
    // Doc (33), who lives in a tent, by the community health worker on an outreach round: a role with
    // no problem list sets the flags it may see as any member does.
    n: 2,
    patient: 33,
    flag: 'flag.frost_risk',
    by: 'chw@example.com',
    at: '2026-10-22T13:30:00Z',
    reason: 'Demo: tent by the made-up river path; nights near freezing this week',
  },
];

/** The longest reason a flag change takes, in code points (values.ts FLAG_REASON_MAX, 0024). */
const REASON_MAX = 500;

interface Author {
  userId: string;
  permissions: ReadonlySet<string>;
}

/**
 * Writes the demo team's flag changes once; a second run writes nothing. Where no seeded staff can
 * have made them (the preview, where people are invited), none: `skipped` says why, as the visits'.
 * The rest of the rules a phone's change is held to are checked first, for every change still to
 * write, so a run writes both or neither.
 */
export async function seedDemoFlags(
  tx: TransactionSql,
  teamId: string,
): Promise<{ changes: number; skipped?: string }> {
  // A flag change takes the team lock first, as sync takes it (design 6.2, D32), before anything is
  // read: a writer at the same moment commits first, and is seen.
  await lockTeam(tx, teamId);
  const held = new Set(
    (
      await tx<{ id: string }[]>`
        select id from sineobex.patient_flag_changes
        where team_id = ${teamId} and id in ${tx(CHANGES.map((c) => demoFlagChangeId(c.n)))}`
    ).map((r) => r.id),
  );
  const missing = CHANGES.filter((c) => !held.has(demoFlagChangeId(c.n)));
  if (missing.length === 0) return { changes: 0 };

  const staff = await authorsOf(tx, teamId);
  if (missing.some((c) => !staff.has(c.by))) return { changes: 0, skipped: 'no demo staff to set them' };
  const flags = await platformFlags(tx, teamId);
  if (!flags) return { changes: 0, skipped: 'the team does not hold the platform flags they name' };

  // The rules sync holds a phone's change to (design 6.2), in the order the shared check takes them
  // (insertFlagChange): one of the team's flags, which platformFlags reads as the flag rule reads it;
  // the reason, trimmed, 1 to 500 code points; then the flag rule, beside the entity's own key. A
  // change its author may not make is held for a Program Admin, never stored, so none is written.
  for (const c of missing) {
    if (reasonInvalid(c.reason) || !c.reason.startsWith('Demo: ')) {
      throw new Error(`demo flag change ${c.n}: its reason is not one sync takes, or not made up`);
    }
    const author = staff.get(c.by)!;
    if (!author.permissions.has('patients.edit') || flagHidden(author.permissions, flags[c.flag])) {
      return { changes: 0, skipped: `the author of demo flag change ${c.n} may not set its flag` };
    }
  }

  let written = 0;
  for (const c of missing) {
    // Received a little after the phone made it; its time is its own, its clock verified, so never
    // later than the receipt (0024). The row as insertFlagChange writes it, with no phone or sync
    // change named, as the visits name none, and updated when it was written, at its receipt.
    const receivedAt = new Date(Date.parse(c.at) + 2 * 60_000).toISOString();
    const rows = await tx`
      insert into sineobex.patient_flag_changes (id, team_id, patient_id, flag_id, action, reason, effective_at,
        received_at, device_time, clock_verified, author_user_id, created_device_id, change_id, approved_by,
        updated_at)
      values (${demoFlagChangeId(c.n)}, ${teamId}, ${demoPatientId(c.patient)}, ${flags[c.flag].id}, 'set',
        ${c.reason}, ${c.at}, ${receivedAt}, ${c.at}, true, ${staff.get(c.by)!.userId}, null, null, null,
        ${receivedAt})
      on conflict (id) do nothing
      returning id`;
    written += rows.length;
  }
  return { changes: written };
}

/** `reason_invalid` (values.ts flagReasonInvalid): untrimmed as the phone trims, empty, or too long. */
const reasonInvalid = (reason: string) =>
  reason !== reason.trim() ||
  reason.startsWith('\u0085') ||
  reason.endsWith('\u0085') ||
  reason.length === 0 ||
  [...reason].length > REASON_MAX;

/**
 * The flag rule (read-rules.ts flagHidden): a sensitive flag only for whoever sees a sensitive
 * problem, patients.view_sensitive with the problem list (permissions.ts mayViewProblems).
 */
const flagHidden = (permissions: ReadonlySet<string>, flag: { sensitive: boolean }) =>
  flag.sensitive &&
  !(
    permissions.has('patients.view') &&
    (permissions.has('encounters.chart') || permissions.has('billing.view_codes')) &&
    permissions.has('patients.view_sensitive')
  );

/** The demo staff as sync loads an author: the membership and its role's permissions as they are now. */
async function authorsOf(tx: TransactionSql, teamId: string): Promise<Map<string, Author>> {
  const rows = await tx<{ email: string; userId: string; permissions: string[] }[]>`
    select u.email, u.id as "userId", r.permissions
    from sineobex.team_memberships m
    join sineobex.users u on u.id = m.user_id
    join sineobex.roles r on r.id = m.role_id
    where m.team_id = ${teamId} and m.removed_at is null`;
  return new Map(rows.map((r) => [r.email, { userId: r.userId, permissions: new Set(r.permissions) }]));
}

/**
 * The team's copy of each platform flag the changes set, as the flag rule reads a flag (read-rules.ts
 * flagRows): a preset of kind flag, its current version's sensitive read without a cast. Null when
 * the team holds not every one. An archived one is set all the same: sync takes a phone's change of
 * one, which stays on the patient (design 5.1).
 */
async function platformFlags(
  tx: TransactionSql,
  teamId: string,
): Promise<Record<Named, { id: string; sensitive: boolean }> | null> {
  const rows = await tx<{ originKey: Named; id: string; sensitive: boolean }[]>`
    select p.origin_key as "originKey", p.id,
           coalesce(v.body -> 'sensitive' = 'true'::jsonb, false) as sensitive
    from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.kind = 'flag' and p.origin_key in ${tx([...NAMED])}`;
  const flags = Object.fromEntries(rows.map(({ originKey, ...f }) => [originKey, f])) as Partial<
    Record<Named, { id: string; sensitive: boolean }>
  >;
  return NAMED.every((key) => flags[key] !== undefined)
    ? (flags as Record<Named, { id: string; sensitive: boolean }>)
    : null;
}
