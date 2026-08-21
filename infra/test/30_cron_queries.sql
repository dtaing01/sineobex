-- The scheduled-job queries, executed verbatim.
--
-- These exist because four bugs in this file's SQL shipped past review: two
-- `text = uuid` comparisons that failed on every run, an unscoped CROSS JOIN
-- that alerted every admin about every other team's van, and an upsert that
-- aborted whenever two rows collided on the same key. All four are the kind
-- of thing that only a real Postgres will tell you about.
--
-- Keep these in step with infra/lambda/cron/index.ts. If a query changes
-- there and not here, the test is worse than useless.

\echo '== Cron queries =='

-- ---------------------------------------------------------------------------
-- followup-due
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  queued bigint;
BEGIN
  INSERT INTO notification_queue
    (recipient_sub, kind, subject_id, scheduled_for)
  SELECT DISTINCT tm.cognito_sub, 'followup-due', p.id::text, now()
  FROM patients p
  JOIN team_members tm ON tm.team_id = p.team_id
  WHERE p.follow_up
    AND p.next_follow_up IS NOT NULL
    AND p.next_follow_up <= (now() + interval '1 day')::date
    AND NOT p.deleted
    AND tm.active
    AND NOT EXISTS (
      SELECT 1 FROM notification_queue q
      WHERE q.subject_id = p.id::text
        AND q.kind = 'followup-due'
        AND q.recipient_sub = tm.cognito_sub
        AND q.scheduled_for > now() - interval '20 hours'
    );

  GET DIAGNOSTICS queued = ROW_COUNT;
  PERFORM assert_equals(
    'followup-due queues one reminder per active member per due patient',
    2::bigint, queued
  );
END
$$;

DO $$
DECLARE
  second_pass bigint;
BEGIN
  -- Idempotency. cron-job.org retries on timeout; a retry must not double-notify.
  INSERT INTO notification_queue
    (recipient_sub, kind, subject_id, scheduled_for)
  SELECT DISTINCT tm.cognito_sub, 'followup-due', p.id::text, now()
  FROM patients p
  JOIN team_members tm ON tm.team_id = p.team_id
  WHERE p.follow_up
    AND p.next_follow_up IS NOT NULL
    AND p.next_follow_up <= (now() + interval '1 day')::date
    AND NOT p.deleted
    AND tm.active
    AND NOT EXISTS (
      SELECT 1 FROM notification_queue q
      WHERE q.subject_id = p.id::text
        AND q.kind = 'followup-due'
        AND q.recipient_sub = tm.cognito_sub
        AND q.scheduled_for > now() - interval '20 hours'
    );

  GET DIAGNOSTICS second_pass = ROW_COUNT;
  PERFORM assert_equals(
    'running followup-due twice queues nothing the second time',
    0::bigint, second_pass
  );
END
$$;

DO $$
BEGIN
  PERFORM assert_true(
    'queued notifications carry an id and no clinical detail',
    NOT EXISTS (
      SELECT 1 FROM notification_queue
      WHERE subject_id ILIKE '%Ann%' OR subject_id ILIKE '%Alpha%'
    )
  );
END
$$;

-- ---------------------------------------------------------------------------
-- low-stock-alert
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alerted bigint;
BEGIN
  INSERT INTO notification_queue
    (recipient_sub, kind, subject_id, scheduled_for)
  SELECT tm.cognito_sub, 'low-stock', i.id::text, now()
  FROM inventory_items i
  JOIN team_members tm ON tm.team_id = i.team_id
  WHERE i.stock < i.min_level
    AND i.ordered_at IS NULL
    AND tm.active
    AND tm.access_tier = 'full-admin'
    AND NOT EXISTS (
      SELECT 1 FROM notification_queue q
      WHERE q.subject_id = i.id::text
        AND q.kind = 'low-stock'
        AND q.recipient_sub = tm.cognito_sub
        AND q.scheduled_for > now() - interval '24 hours'
    );

  GET DIAGNOSTICS alerted = ROW_COUNT;
  -- Two low items, one per team, one admin each. A CROSS JOIN would give 4.
  PERFORM assert_equals(
    'low-stock alerts only the owning team''s admin',
    2::bigint, alerted
  );
END
$$;

DO $$
BEGIN
  PERFORM assert_equals(
    'Team A''s admin is told about Team A''s gauze',
    1::bigint,
    (SELECT count(*) FROM notification_queue
     WHERE kind = 'low-stock' AND recipient_sub = 'sub-a')
  );
  PERFORM assert_equals(
    'and not about Team B''s saline',
    'cccccccc-0000-4000-8000-000000000003',
    (SELECT subject_id FROM notification_queue
     WHERE kind = 'low-stock' AND recipient_sub = 'sub-a')
  );
END
$$;

-- ---------------------------------------------------------------------------
-- seasonal-demand
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Grouped by month *name* to match the primary key. Grouping by
  -- date_trunc instead makes two years of data hit 'Mar' twice, and Postgres
  -- aborts with "ON CONFLICT DO UPDATE command cannot affect row a second
  -- time".
  INSERT INTO seasonal_demand (month, items, intensity, computed_at)
  SELECT
    to_char(occurred_at, 'Mon'),
    (array_agg(DISTINCT supply ORDER BY supply))[1:5],
    least(100, count(*) * 2),
    now()
  FROM encounters e, jsonb_array_elements_text(e.supplies) AS supply
  WHERE occurred_at > now() - interval '2 years'
  GROUP BY to_char(occurred_at, 'Mon')
  ON CONFLICT (month) DO UPDATE SET
    items = EXCLUDED.items,
    intensity = EXCLUDED.intensity,
    computed_at = now();

  PERFORM assert_true(
    'seasonal-demand upserts without a duplicate-key abort',
    (SELECT count(*) FROM seasonal_demand) > 0
  );
END
$$;

DO $$
BEGIN
  -- Run it twice: the ON CONFLICT path is the one that broke.
  INSERT INTO seasonal_demand (month, items, intensity, computed_at)
  SELECT
    to_char(occurred_at, 'Mon'),
    (array_agg(DISTINCT supply ORDER BY supply))[1:5],
    least(100, count(*) * 2),
    now()
  FROM encounters e, jsonb_array_elements_text(e.supplies) AS supply
  WHERE occurred_at > now() - interval '2 years'
  GROUP BY to_char(occurred_at, 'Mon')
  ON CONFLICT (month) DO UPDATE SET
    items = EXCLUDED.items,
    intensity = EXCLUDED.intensity,
    computed_at = now();

  PERFORM assert_true('seasonal-demand is idempotent', true);
END
$$;

-- ---------------------------------------------------------------------------
-- hotspot-recompute
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  human_before bigint;
  human_after bigint;
BEGIN
  SELECT count(*) INTO human_before FROM hotspots WHERE NOT computed;

  DELETE FROM hotspots WHERE computed;

  WITH clustered AS (
    SELECT
      location,
      patient_id,
      ST_ClusterDBSCAN(location::geometry, eps := 0.004, minpoints := 3)
        OVER () AS cluster_id
    FROM encounters
    WHERE occurred_at > now() - interval '90 days'
      AND location IS NOT NULL
  ),
  centroids AS (
    SELECT
      cluster_id,
      ST_Centroid(ST_Collect(location::geometry)) AS centre,
      count(*) AS encounter_count,
      count(DISTINCT patient_id) AS patient_count
    FROM clustered
    WHERE cluster_id IS NOT NULL
    GROUP BY cluster_id
  ),
  identified AS (
    SELECT
      'auto-' || encode(
        sha256(ST_AsBinary(ST_SnapToGrid(centre, 0.002))), 'hex'
      ) AS id,
      centre, encounter_count, patient_count
    FROM centroids
  )
  INSERT INTO hotspots
    (id, name, type, intensity, patient_count, location, computed)
  SELECT DISTINCT ON (id)
    id,
    'Cluster near ' || round(ST_Y(centre)::numeric, 3) || ', '
                    || round(ST_X(centre)::numeric, 3),
    'Rising Need',
    CASE WHEN encounter_count >= 20 THEN 'High'
         WHEN encounter_count >= 8 THEN 'Moderate'
         ELSE 'Low' END,
    patient_count,
    centre::geography,
    true
  FROM identified
  ORDER BY id, encounter_count DESC
  ON CONFLICT (id) DO UPDATE SET
    intensity = EXCLUDED.intensity,
    patient_count = EXCLUDED.patient_count,
    location = EXCLUDED.location,
    updated_at = now();

  PERFORM assert_true(
    'hotspot-recompute finds the seeded cluster',
    (SELECT count(*) FROM hotspots WHERE computed) > 0
  );

  SELECT count(*) INTO human_after FROM hotspots WHERE NOT computed;
  PERFORM assert_equals(
    'and never deletes coordinator-entered hotspots',
    human_before, human_after
  );

  PERFORM assert_equals(
    'patient_count counts patients, not encounters',
    1, (SELECT patient_count FROM hotspots WHERE computed LIMIT 1)
  );
END
$$;

DO $$
DECLARE
  first_id text;
  second_id text;
BEGIN
  -- The id must be stable across runs, or a client can never correlate a
  -- cluster with the one it drew a minute ago.
  SELECT id INTO first_id FROM hotspots WHERE computed ORDER BY id LIMIT 1;

  DELETE FROM hotspots WHERE computed;

  WITH clustered AS (
    SELECT location, patient_id,
      ST_ClusterDBSCAN(location::geometry, eps := 0.004, minpoints := 3)
        OVER () AS cluster_id
    FROM encounters
    WHERE occurred_at > now() - interval '90 days' AND location IS NOT NULL
  ),
  centroids AS (
    SELECT cluster_id,
      ST_Centroid(ST_Collect(location::geometry)) AS centre,
      count(*) AS encounter_count,
      count(DISTINCT patient_id) AS patient_count
    FROM clustered WHERE cluster_id IS NOT NULL GROUP BY cluster_id
  ),
  identified AS (
    SELECT 'auto-' || encode(
      sha256(ST_AsBinary(ST_SnapToGrid(centre, 0.002))), 'hex') AS id,
      centre, encounter_count, patient_count
    FROM centroids
  )
  INSERT INTO hotspots
    (id, name, type, intensity, patient_count, location, computed)
  SELECT DISTINCT ON (id) id, 'Cluster', 'Rising Need', 'Low',
    patient_count, centre::geography, true
  FROM identified ORDER BY id, encounter_count DESC
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO second_id FROM hotspots WHERE computed ORDER BY id LIMIT 1;

  PERFORM assert_equals(
    'computed hotspot ids are stable across runs',
    first_id, second_id
  );
END
$$;

-- ---------------------------------------------------------------------------
-- analytics-rollup
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO analytics_rollups (name, payload, computed_at)
  SELECT 'insights', jsonb_build_object(
    'monthlyImpact', coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(month, 'Mon'),
      'encounters', encounters,
      'uniquePatients', unique_patients,
      'newPatients', new_patients,
      'repeatPatients', unique_patients - new_patients
    ) ORDER BY month), '[]'::jsonb)
  ), now()
  FROM (
    SELECT
      m.month,
      count(e.id) AS encounters,
      count(DISTINCT e.patient_id) AS unique_patients,
      count(DISTINCT e.patient_id) FILTER (
        WHERE date_trunc('month', fs.first_at) = m.month
      ) AS new_patients
    FROM (
      SELECT date_trunc('month', d)::date AS month
      FROM generate_series(
        date_trunc('month', now()) - interval '3 months',
        date_trunc('month', now()), interval '1 month') d
    ) m
    LEFT JOIN encounters e
      ON date_trunc('month', e.occurred_at) = m.month
    LEFT JOIN (
      SELECT patient_id, min(occurred_at) AS first_at
      FROM encounters GROUP BY patient_id
    ) fs ON fs.patient_id = e.patient_id
    GROUP BY m.month
  ) monthly;

  PERFORM assert_true(
    'analytics-rollup produces a payload',
    (SELECT payload -> 'monthlyImpact' IS NOT NULL
     FROM analytics_rollups WHERE name = 'insights'
     ORDER BY computed_at DESC LIMIT 1)
  );
END
$$;

DO $$
BEGIN
  PERFORM assert_true(
    'the rollup payload contains no patient identifiers',
    (SELECT payload::text NOT ILIKE '%Ann%'
       AND payload::text NOT ILIKE '%Alpha%'
     FROM analytics_rollups WHERE name = 'insights'
     ORDER BY computed_at DESC LIMIT 1)
  );
END
$$;

\echo '   cron queries: PASS'
