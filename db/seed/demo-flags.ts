import type { TransactionSql } from 'postgres';
import { demoId } from './demo-patients.ts';

/**
 * Made-up flags on two demo patients (phase 5 design 13.4, card P5-seed; 9, "demo additions start
 * Demo:"): the platform's High risk level, coloured Red, on one, and its Frost risk condition on
 * another, each with a reason starting "Demo:". Each is written as sync applies a phone's flag change
 * (design 6.2, 4.5) and as demo-encounters.ts writes its visits: by a seeded staff member who holds
 * patients.edit and may see the flag, the change's time the phone's own, never later than its
 * receipt, its clock verified. The seed cannot import the API (the API imports this package), so the
 * few rules it needs are restated here; db/test/demo-flags.test.ts holds every row to the API's own
 * functions. Nothing is audited: the seed is not anyone's act, as its patients and visits are not.
 *
 * Written ahead of its code (card P5-tests): it throws until card P5-seed builds it.
 */

/** Seeded IDs are fixed, so the seed is idempotent and tests can name what they need. */
export const demoFlagChangeId = (n: number) => demoId('31', n);

/**
 * Writes the demo team's flag changes once; a second run writes nothing. Where no seeded staff can
 * have made them (the preview, where people are invited), none: `skipped` says why, as the visits'.
 */
export async function seedDemoFlags(
  tx: TransactionSql,
  teamId: string,
): Promise<{ changes: number; skipped?: string }> {
  void tx;
  throw new Error(`P5-seed ${teamId}`);
}
