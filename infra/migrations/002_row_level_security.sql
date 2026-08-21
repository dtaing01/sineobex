-- Row-level security.
--
-- Defence in depth: the API already joins through team_members, but a bug in
-- one handler shouldn't be able to leak another team's caseload. With RLS on,
-- a query that forgets its team filter returns zero rows instead of everyone.
--
-- The API connects as `sineobex_api`, not as the master user, and sets
-- `sineobex.actor` to the caller's Cognito sub at the start of each
-- transaction.

BEGIN;

-- The role the Lambdas connect as. It deliberately cannot create or drop
-- anything, and RLS applies to it (unlike a superuser, which bypasses RLS
-- entirely — the reason the API must never use the master credential).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sineobex_api') THEN
    CREATE ROLE sineobex_api NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sineobex_api;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO sineobex_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sineobex_api;

-- No DELETE anywhere: patient records are soft-deleted, encounters and audit
-- rows are permanent.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM sineobex_api;

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;

CREATE POLICY patients_team_isolation ON patients
  FOR ALL TO sineobex_api
  USING (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE cognito_sub = current_setting('sineobex.actor', true)
        AND active
    )
  );

CREATE POLICY patient_locations_team_isolation ON patient_locations
  FOR ALL TO sineobex_api
  USING (
    patient_id IN (
      SELECT p.id FROM patients p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE tm.cognito_sub = current_setting('sineobex.actor', true)
        AND tm.active
    )
  );

CREATE POLICY encounters_team_isolation ON encounters
  FOR ALL TO sineobex_api
  USING (
    patient_id IN (
      SELECT p.id FROM patients p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE tm.cognito_sub = current_setting('sineobex.actor', true)
        AND tm.active
    )
  );

COMMIT;
