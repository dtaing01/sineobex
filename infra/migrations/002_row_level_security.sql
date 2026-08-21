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

-- The role the Lambdas connect as.
--
-- It MUST have LOGIN and the API MUST actually connect as it. A NOLOGIN role
-- cannot be connected as, so the API would silently fall back to the master
-- credential — and the master user is a superuser, which bypasses RLS
-- entirely. Every policy below would then be decorative.
--
-- The password is supplied by the deployer from the ApiDbSecret created in
-- DataStack:
--
--   psql -v api_password="$(aws secretsmanager get-secret-value \
--     --secret-id <ApiDbSecretArn> --query SecretString --output text \
--     | jq -r .password)" -f 002_row_level_security.sql
\if :{?api_password}
\else
\echo 'ERROR: run with -v api_password=... (see the comment above)'
\quit
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sineobex_api') THEN
    CREATE ROLE sineobex_api LOGIN;
  ELSE
    ALTER ROLE sineobex_api LOGIN;
  END IF;
END
$$;

ALTER ROLE sineobex_api WITH PASSWORD :'api_password';

-- Belt and braces: NOBYPASSRLS means that even if this role is later granted
-- something broader by mistake, the policies still apply to it.
ALTER ROLE sineobex_api NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

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

-- Fails the migration loudly if the policies could never bite, rather than
-- leaving a deployment that looks isolated and is not.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'sineobex_api' AND (rolsuper OR rolbypassrls OR NOT rolcanlogin)
  ) THEN
    RAISE EXCEPTION
      'sineobex_api must be a LOGIN role without SUPERUSER or BYPASSRLS, '
      'otherwise row-level security does not apply to the API.';
  END IF;
END
$$;

COMMIT;
