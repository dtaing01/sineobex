-- Module 4 and 9: a notice names the note it is about (phase 4 design, D104; lifecycle 4.6, 4.10).
-- A held sign-off that will not reach the chart tells its sender with `signoff_not_applied` on
-- the sign-off, which waits in quarantine_items and is never in the sync read: a phone that never
-- held it (the sender's second phone, or one erased at a synced sign-out) could not find the note.
-- Only that notice names one; every other notice leaves it null.

set search_path = sineobex, public, extensions;

-- A key, unlike record_id, which names a record of any entity, held ones included: the API names
-- a note only after reading it on the chart. Composite on (team_id, note_id), as 0020's tables
-- are: a foreign key check ignores row-level security, so a notice never names another team's
-- note. It blocks nothing: a note is never deleted (0004 revokes delete from the app role, and its
-- sign-offs hold keys to it already), and a wipe erases a phone's file, never a team's rows. Valid
-- at once, not NOT VALID as 0013: no row written before names a note. No index: nothing reads
-- notices by their note.
alter table sineobex.user_notices
  add column note_id uuid,
  add foreign key (team_id, note_id) references sineobex.encounter_notes (team_id, id);
