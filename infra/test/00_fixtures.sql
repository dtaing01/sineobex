-- Test fixtures.
--
-- Two teams inside one agency, so every isolation assertion has something
-- real to be isolated *from*. A single-team fixture would pass every RLS test
-- while proving nothing.
--
-- All data here is synthetic.

BEGIN;

INSERT INTO agencies (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Agency');

INSERT INTO teams (id, agency_id, name) VALUES
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'Team A'),
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'Team B');

INSERT INTO team_members
  (team_id, cognito_sub, display_name, role, access_tier, active) VALUES
  ('22222222-2222-2222-2222-222222222222',
   'sub-a', 'Nurse A', 'RN', 'full-admin', true),
  ('33333333-3333-3333-3333-333333333333',
   'sub-b', 'Nurse B', 'RN', 'full-admin', true),
  -- A deactivated member of Team A. Their access must be revoked by the
  -- policies, not merely hidden in the UI.
  ('22222222-2222-2222-2222-222222222222',
   'sub-inactive', 'Former Staff', 'RN', 'standard', false);

INSERT INTO patients
  (id, team_id, first_name, last_name, dob, risk, location_label, location,
   follow_up, next_follow_up, primary_doctor, client_updated_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'Ann', 'Alpha', '1980-01-01', 'High', 'Cass Park',
   ST_SetSRID(ST_MakePoint(-83.0580, 42.3400), 4326)::geography,
   true, current_date, 'Dr. Test', '2026-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-4000-8000-000000000002',
   '33333333-3333-3333-3333-333333333333',
   'Bob', 'Beta', '1975-05-05', 'Low', 'Corktown',
   ST_SetSRID(ST_MakePoint(-83.0700, 42.3300), 4326)::geography,
   true, current_date, NULL, '2026-01-01T00:00:00Z');

-- Enough encounters in one place to satisfy DBSCAN's minpoints := 3.
INSERT INTO encounters
  (id, patient_id, occurred_at, provider_sub, provider_name, needs,
   location_label, location, notes, supplies, follow_up_set)
SELECT
  ('dddddddd-0000-4000-8000-00000000000' || n)::uuid,
  'aaaaaaaa-0000-4000-8000-000000000001',
  now() - (n || ' days')::interval,
  'sub-a', 'Nurse A', 'Wound Care', 'Cass Park',
  ST_SetSRID(ST_MakePoint(-83.0580 + n * 0.0001, 42.3400), 4326)::geography,
  'Test note', '["Gauze (2)", "Saline"]'::jsonb, false
FROM generate_series(1, 5) AS n;

INSERT INTO inventory_items
  (id, team_id, name, category, stock, min_level, unit) VALUES
  ('cccccccc-0000-4000-8000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   'Gauze', 'Medical', 2, 20, 'packs'),
  ('cccccccc-0000-4000-8000-000000000004',
   '33333333-3333-3333-3333-333333333333',
   'Saline', 'Medical', 1, 10, 'bottles');

COMMIT;
