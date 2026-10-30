-- Module 4 and 2: an encounter names a real patient of its own team (phase 3 design 1.6).
--
-- NOT VALID: phase 2 preview and test rows may name patients that never existed, and they stay as
-- they are; every new or changed row is checked. The API checks the patient first and answers a
-- stale reference (patient_missing), so this constraint never fires inside a push; if it ever did,
-- the change's savepoint stores a rejection instead of stopping the phone's queue (D42). Composite
-- on (team_id, patient_id): a foreign key check ignores row-level security, so even a buggy
-- handler can't point an encounter at another team's patient. Validate on the fresh RDS database
-- (phase 12), where no unchecked rows exist.

set search_path = sineobex, public, extensions;

alter table sineobex.encounters add constraint encounters_patient_fk
  foreign key (team_id, patient_id) references sineobex.patients (team_id, id) not valid;

-- A patient group's encounters (phase 4 lists the recent ones); also what the foreign key needs to
-- check a patient row is unreferenced.
create index encounters_team_patient on sineobex.encounters (team_id, patient_id, started_at);
