-- Assertion helper.
--
-- Deliberately not pgTAP: that is another extension to install on every
-- developer machine and in every CI image, for a suite this small. A function
-- that raises is enough, and `psql -v ON_ERROR_STOP=1` turns a raise into a
-- non-zero exit code.

CREATE OR REPLACE FUNCTION assert_equals(
  description text,
  expected anyelement,
  actual anyelement
) RETURNS void AS $$
BEGIN
  IF expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION 'FAIL: % — expected %, got %',
      description, expected, actual;
  END IF;
  RAISE NOTICE '  ok  %', description;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_true(
  description text,
  condition boolean
) RETURNS void AS $$
BEGIN
  IF condition IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: % — expected true, got %',
      description, coalesce(condition::text, 'null');
  END IF;
  RAISE NOTICE '  ok  %', description;
END;
$$ LANGUAGE plpgsql;

/*
 * Asserts that a statement fails. Used for the append-only and isolation
 * rules, where the whole point is that something is refused.
 */
CREATE OR REPLACE FUNCTION assert_raises(
  description text,
  statement text
) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '  ok  % (raised %)', description, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % — statement succeeded but should have failed',
    description;
END;
$$ LANGUAGE plpgsql;
