-- Row-level security.
--
-- These must run as `sineobex_api`, not as the master user. A superuser
-- bypasses RLS entirely, so running this file as postgres would pass every
-- assertion while proving nothing — which is exactly the failure mode that
-- shipped in the first draft of this system.

\echo '== Row-level security =='

DO $$
BEGIN
  PERFORM assert_equals(
    'test connection is not a superuser',
    false,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  );
  PERFORM assert_equals(
    'test connection cannot bypass RLS',
    false,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)
  );
END
$$;

-- Team A
SELECT set_config('sineobex.actor', 'sub-a', false);

DO $$
BEGIN
  PERFORM assert_equals(
    'Team A member sees exactly their own caseload',
    1::bigint,
    (SELECT count(*) FROM patients)
  );
  PERFORM assert_equals(
    'and it is the right patient',
    'Ann',
    (SELECT first_name FROM patients)
  );
  PERFORM assert_equals(
    'encounters follow the same isolation',
    5::bigint,
    (SELECT count(*) FROM encounters)
  );
END
$$;

-- Team B
SELECT set_config('sineobex.actor', 'sub-b', false);

DO $$
BEGIN
  PERFORM assert_equals(
    'Team B member sees only their own caseload',
    1::bigint,
    (SELECT count(*) FROM patients)
  );
  PERFORM assert_equals(
    'and never Team A''s patient',
    'Bob',
    (SELECT first_name FROM patients)
  );
  PERFORM assert_equals(
    'Team B sees none of Team A''s encounters',
    0::bigint,
    (SELECT count(*) FROM encounters)
  );
END
$$;

-- A deactivated member of Team A.
SELECT set_config('sineobex.actor', 'sub-inactive', false);

DO $$
BEGIN
  PERFORM assert_equals(
    'a deactivated member sees nothing, even in their own team',
    0::bigint,
    (SELECT count(*) FROM patients)
  );
END
$$;

-- An identity that is not a member of anything.
SELECT set_config('sineobex.actor', 'sub-unknown', false);

DO $$
BEGIN
  PERFORM assert_equals(
    'an unknown actor sees nothing',
    0::bigint,
    (SELECT count(*) FROM patients)
  );
END
$$;

-- No actor set at all. This is the dangerous case: a handler that forgets to
-- call setActor() must fail closed, not open.
SELECT set_config('sineobex.actor', '', false);

DO $$
BEGIN
  PERFORM assert_equals(
    'a request with no actor set sees nothing (fails closed)',
    0::bigint,
    (SELECT count(*) FROM patients)
  );
END
$$;

-- Cross-team write attempt.
SELECT set_config('sineobex.actor', 'sub-b', false);

DO $$
DECLARE
  affected bigint;
BEGIN
  UPDATE patients SET risk = 'Low'
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;

  PERFORM assert_equals(
    'Team B''s update of Team A''s patient affects no rows',
    0::bigint, affected
  );

  -- DELETE is revoked from sineobex_api outright, so this is refused at the
  -- grant level before RLS is even consulted. Patient records are
  -- soft-deleted; encounters and audit rows are never removed at all.
  PERFORM assert_raises(
    'the application role cannot delete patients at all',
    $stmt$DELETE FROM patients
          WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'$stmt$
  );

  PERFORM assert_equals(
    'Team A''s patient is not even visible to Team B',
    0::bigint,
    (SELECT count(*) FROM patients
     WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001')
  );
END
$$;

-- An insert into another team must not be possible either. Without a WITH
-- CHECK clause a policy restricts reads but permits writes of rows the writer
-- could never read back, which is worse than either extreme.
DO $$
BEGIN
  PERFORM assert_raises(
    'Team B cannot insert a patient into Team A',
    $stmt$INSERT INTO patients
            (id, team_id, first_name, last_name, dob, risk,
             location_label, location)
          VALUES ('eeeeeeee-0000-4000-8000-000000000009',
                  '22222222-2222-2222-2222-222222222222',
                  'Mallory', 'Intruder', '1990-01-01', 'Low', 'Nowhere',
                  ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography)$stmt$
  );
END
$$;

\echo '   row-level security: PASS'
