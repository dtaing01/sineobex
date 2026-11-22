/**
 * The team lock and the team revision (docs/design/phase-5-admin-configuration.md, 4.2). Every
 * preset and note type write takes a revision, and a phone asks for what changed since the one it
 * holds (6.1), so a revision must be taken under the lock and committed in the order it was taken.
 * Both functions are here, not in the presets package, because the note type installer in this
 * package takes them too, and forms never imports presets.
 *
 * Each runs one statement in a transaction its caller already holds, as installPresets does (this
 * package imports no database library). Advisory locks are re-entrant, so a caller that took the
 * lock already takes it again for free.
 */
import type { InstallSql } from './install.ts';

/**
 * The team's write lock, held to the end of the caller's transaction: the advisory lock
 * append_audit takes for the team's audit chain (migration 0003), so it adds no contention, and
 * the one the API's lockTeamWrites takes first in every patient-side write, so it keeps the one
 * lock order (D32). The statement is lockTeamWrites' own, since a package cannot import the API;
 * db/test/preset-revision.test.ts holds the two together. An installer takes it before it works
 * out its plan again.
 */
export async function lockTeam(sql: InstallSql, teamId: string): Promise<void> {
  // The uuid's own text form, exactly as append_audit builds the key ('sineobex.audit:' || chain).
  await sql`select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || ${teamId}::uuid::text, 0))`;
}

/**
 * Takes the team's next revision: the one way to take one. Every writer calls it once per
 * transaction and stamps every head it changes with the answer, and none writes a revision itself.
 *
 * It takes the team lock first, and the lock is held to commit, so a second writer waits until the
 * first has committed: revisions commit in the order they are taken, one step each, and a writer
 * that rolls back takes its step with it, so there is no gap. A team made after migration 0023 has
 * no row until its first write, which makes it at revision 1.
 *
 * With the step it records what it took for the team, in a setting local to the transaction, and
 * 0023 refuses a head that does not carry that record: a head at its team's revision is not enough,
 * since a write that never took one would leave its head at the revision of the write before it,
 * which a phone may already hold. Local, the record goes at commit and with a savepoint rolled
 * back, as the step does, so it never reaches the next transaction on a pooled connection. A second
 * take in one transaction, a second writer's (team creation runs two installers), moves it, and the
 * heads written after it carry the second.
 */
export async function takeRevision(sql: InstallSql, teamId: string): Promise<number> {
  await lockTeam(sql, teamId);
  // The record is set in the step's own statement, from the row it wrote, so no take is without one
  // and the edge pays no round trip more for it. A setting's name is identifiers only, hence the id
  // without its dashes, as 0023 reads it. The revision is a bigint: postgres.js gives it as a string
  // unless its caller parses it.
  const [row] = await sql<{ revision: string | number }[]>`
    with taken as (
      insert into sineobex.team_preset_state (team_id, revision) values (${teamId}::uuid, 1)
      on conflict (team_id) do update set revision = sineobex.team_preset_state.revision + 1
      returning team_id, revision)
    select revision, set_config('app.revision_' || replace(team_id::text, '-', ''), revision::text, true)
    from taken`;
  return Number(row!.revision);
}
