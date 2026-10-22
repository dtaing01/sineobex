import type { Tx } from '../db/database.ts';

/**
 * The team's patient-side write lock (phase 3 design 2.2 step 2, D32).
 *
 * It is the advisory lock append_audit takes for the team's audit chain (0003), with the exact
 * same key, so it adds no contention: every audited write already waits on it. Taking it first,
 * before any read or insert, gives one lock order between a merge (which then locks patient rows
 * FOR NO KEY UPDATE) and a push (whose encounter insert takes FOR KEY SHARE on the patient through
 * the foreign key), and lets duplicate matching see a concurrent create. Advisory locks are
 * re-entrant within a session, so append_audit taking it again later is free.
 *
 * Every patient-side change in a push, an encounter create or `set patientId` that names a patient,
 * and every online route that touches patient-side rows call this as their first statement.
 */
export async function lockTeamWrites(tx: Tx, teamId: string): Promise<void> {
  // The uuid's own text form, exactly as append_audit builds the key ('sineobex.audit:' || chain).
  await tx`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0))`;
}
