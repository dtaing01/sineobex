-- Data integrity rules that exist because of what this system stores.

\echo '== Integrity =='

DO $$
BEGIN
  -- A clinical note, once written, is a record. Corrections are made by
  -- writing a later encounter, never by rewriting an earlier one.
  UPDATE encounters SET notes = 'tampered'
  WHERE id = 'dddddddd-0000-4000-8000-000000000001';

  PERFORM assert_equals(
    'encounters cannot be updated',
    'Test note',
    (SELECT notes FROM encounters
     WHERE id = 'dddddddd-0000-4000-8000-000000000001')
  );

  DELETE FROM encounters
  WHERE id = 'dddddddd-0000-4000-8000-000000000001';

  PERFORM assert_equals(
    'encounters cannot be deleted',
    5::bigint,
    (SELECT count(*) FROM encounters)
  );
END
$$;

DO $$
BEGIN
  -- HIPAA §164.312(b): the audit trail is evidence, not a cache.
  DELETE FROM audit_log;
  PERFORM assert_true(
    'audit rows cannot be deleted',
    (SELECT count(*) FROM audit_log) > 0
  );
END
$$;

DO $$
DECLARE
  before_count bigint;
BEGIN
  -- The trigger must write an audit row even when the application forgets.
  SELECT count(*) INTO before_count FROM audit_log;

  PERFORM set_config('sineobex.actor', 'sub-a', true);
  UPDATE patients SET risk = 'Moderate'
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

  PERFORM assert_true(
    'updating a patient writes an audit row automatically',
    (SELECT count(*) FROM audit_log) > before_count
  );
  PERFORM assert_equals(
    'and it is attributed to the acting user',
    'sub-a',
    (SELECT actor FROM audit_log ORDER BY id DESC LIMIT 1)
  );
END
$$;

DO $$
BEGIN
  -- Stock is a physical count; it cannot go negative.
  PERFORM assert_raises(
    'inventory stock cannot go negative',
    $stmt$UPDATE inventory_items SET stock = -1
          WHERE id = 'cccccccc-0000-4000-8000-000000000003'$stmt$
  );
  PERFORM assert_raises(
    'risk must be one of the three known levels',
    $stmt$UPDATE patients SET risk = 'Catastrophic'
          WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'$stmt$
  );
  PERFORM assert_raises(
    'access tier must be one of the three known tiers',
    $stmt$UPDATE team_members SET access_tier = 'root'
          WHERE cognito_sub = 'sub-a'$stmt$
  );
END
$$;

DO $$
DECLARE
  server_ts timestamptz;
BEGIN
  -- The server clock drives the sync cursor and must not be settable by a
  -- client. This is what makes paging safe against device clock skew.
  PERFORM set_config('sineobex.actor', 'sub-a', true);
  UPDATE patients SET updated_at = '2000-01-01T00:00:00Z'
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

  SELECT updated_at INTO server_ts FROM patients
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

  PERFORM assert_true(
    'updated_at is forced to server time, not whatever was supplied',
    server_ts > '2020-01-01T00:00:00Z'::timestamptz
  );
END
$$;

DO $$
BEGIN
  -- An encounter records where the patient was actually found, and that
  -- observation must reach the movement-pattern table without a second write
  -- from the client.
  PERFORM assert_true(
    'logging an encounter records a movement observation',
    (SELECT count(*) FROM patient_locations
     WHERE patient_id = 'aaaaaaaa-0000-4000-8000-000000000001') >= 5
  );
END
$$;

\echo '   integrity: PASS'
