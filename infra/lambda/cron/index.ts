import { createHmac, timingSafeEqual } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

import { withTransaction } from '../shared/db';
import { ok, badRequest, unauthorized, notFound, serverError } from '../shared/http';

const secrets = new SecretsManagerClient({});
let cachedSigningKey: string | undefined;

/** Requests older than this are rejected even with a valid signature. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

async function signingKey(): Promise<string> {
  if (cachedSigningKey) return cachedSigningKey;
  const arn = process.env.CRON_SECRET_ARN;
  if (!arn) throw new Error('CRON_SECRET_ARN is not set');

  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  if (!result.SecretString) throw new Error('Cron secret has no value');
  cachedSigningKey = result.SecretString;
  return cachedSigningKey;
}

/**
 * Verifies the HMAC signature cron-job.org sends.
 *
 * cron-job.org cannot hold a Cognito session, so these endpoints authenticate
 * with a shared key instead. The signature covers a timestamp as well as the
 * body, so a captured request cannot be replayed beyond the skew window.
 *
 * `timingSafeEqual` rather than `===` because a string comparison leaks the
 * signature one byte at a time to anyone who can measure the response.
 */
async function verifySignature(
  event: APIGatewayProxyEventV2,
): Promise<{ valid: boolean; reason?: string }> {
  const signature = event.headers['x-sineobex-signature'];
  const timestamp = event.headers['x-sineobex-timestamp'];

  if (!signature || !timestamp) {
    return { valid: false, reason: 'missing signature headers' };
  }

  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: 'timestamp outside the accepted window' };
  }

  const key = await signingKey();
  const expected = createHmac('sha256', key)
    .update(`${timestamp}.${event.body ?? ''}`)
    .digest('hex');

  const provided = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length) {
    return { valid: false, reason: 'signature mismatch' };
  }

  return {
    valid: timingSafeEqual(provided, computed),
    reason: 'signature mismatch',
  };
}

type Job = () => Promise<Record<string, unknown>>;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext.requestId;

  try {
    const check = await verifySignature(event);
    if (!check.valid) {
      console.warn('Rejected cron request', {
        requestId,
        reason: check.reason,
        ip: event.requestContext.http.sourceIp,
      });
      return unauthorized();
    }

    const name = event.pathParameters?.job;
    if (!name) return badRequest('job is required');

    const jobs: Record<string, Job> = {
      'analytics-rollup': analyticsRollup,
      'hotspot-recompute': hotspotRecompute,
      'seasonal-demand': seasonalDemand,
      'followup-due': followUpDue,
      'low-stock-alert': lowStockAlert,
      'audit-archive': auditArchive,
    };

    const job = jobs[name];
    if (!job) return notFound();

    const started = Date.now();
    const result = await job();
    const durationMs = Date.now() - started;

    console.info('Cron job complete', { requestId, job: name, durationMs });
    return ok({ job: name, durationMs, ...result });
  } catch (error) {
    return serverError(requestId, error);
  }
};

/**
 * Recomputes the Insights payload.
 *
 * Every figure here is an aggregate. No row in `analytics_rollups` identifies
 * a patient, which is what lets the Insights endpoint be cheap and lets this
 * payload be cached.
 */
const analyticsRollup: Job = () =>
  withTransaction(async (client) => {
    const { rows } = await client.query(`
      WITH months AS (
        SELECT date_trunc('month', d)::date AS month
        FROM generate_series(
          date_trunc('month', now()) - interval '3 months',
          date_trunc('month', now()),
          interval '1 month'
        ) d
      ),
      first_seen AS (
        SELECT patient_id, min(occurred_at) AS first_at
        FROM encounters GROUP BY patient_id
      ),
      monthly AS (
        SELECT
          m.month,
          count(e.id) AS encounters,
          count(DISTINCT e.patient_id) AS unique_patients,
          count(DISTINCT e.patient_id) FILTER (
            WHERE date_trunc('month', fs.first_at) = m.month
          ) AS new_patients
        FROM months m
        LEFT JOIN encounters e
          ON date_trunc('month', e.occurred_at) = m.month
        LEFT JOIN first_seen fs ON fs.patient_id = e.patient_id
        GROUP BY m.month
        ORDER BY m.month
      )
      SELECT jsonb_build_object(
        'monthlyImpact', jsonb_agg(jsonb_build_object(
          'month', to_char(month, 'Mon'),
          'encounters', encounters,
          'uniquePatients', unique_patients,
          'newPatients', new_patients,
          'repeatPatients', unique_patients - new_patients
        ) ORDER BY month)
      ) AS payload
      FROM monthly
    `);

    await client.query(
      `INSERT INTO analytics_rollups (name, payload, computed_at)
       VALUES ('insights', $1, now())`,
      [rows[0]?.payload ?? {}],
    );

    // Keep a short history for debugging, not an unbounded one.
    await client.query(
      `DELETE FROM analytics_rollups
       WHERE name = 'insights'
         AND computed_at < now() - interval '7 days'`,
    );

    return { rollup: 'insights' };
  });

/**
 * Re-clusters hotspots from recent encounter geography.
 *
 * ST_ClusterDBSCAN with a 400m radius and a 3-encounter minimum: close enough
 * that a cluster describes one walkable area, dense enough that two visits to
 * the same corner don't invent a hotspot.
 */
const hotspotRecompute: Job = () =>
  withTransaction(async (client) => {
    const { rowCount } = await client.query(`
      WITH clustered AS (
        SELECT
          location,
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
          count(*) AS encounter_count
        FROM clustered
        WHERE cluster_id IS NOT NULL
        GROUP BY cluster_id
      )
      INSERT INTO hotspots (id, name, type, intensity, patient_count, location,
                            computed)
      SELECT
        'auto-' || cluster_id,
        'Cluster ' || cluster_id,
        'Rising Need',
        CASE
          WHEN encounter_count >= 20 THEN 'High'
          WHEN encounter_count >= 8 THEN 'Moderate'
          ELSE 'Low'
        END,
        encounter_count,
        centre::geography,
        true
      FROM centroids
      ON CONFLICT (id) DO UPDATE SET
        intensity = EXCLUDED.intensity,
        patient_count = EXCLUDED.patient_count,
        location = EXCLUDED.location,
        updated_at = now()
    `);

    return { clusters: rowCount };
  });

/** Rebuilds the twelve-month supply demand model from historical usage. */
const seasonalDemand: Job = () =>
  withTransaction(async (client) => {
    const { rowCount } = await client.query(`
      INSERT INTO seasonal_demand (month, items, intensity, computed_at)
      SELECT
        to_char(date_trunc('month', occurred_at), 'Mon') AS month,
        (array_agg(DISTINCT supply ORDER BY supply))[1:5] AS items,
        least(100, count(*) * 2) AS intensity,
        now()
      FROM encounters e,
           jsonb_array_elements_text(e.supplies) AS supply
      WHERE occurred_at > now() - interval '2 years'
      GROUP BY date_trunc('month', occurred_at)
      ON CONFLICT (month) DO UPDATE SET
        items = EXCLUDED.items,
        intensity = EXCLUDED.intensity,
        computed_at = now()
    `);

    return { months: rowCount };
  });

/**
 * Queues follow-up reminders.
 *
 * The notification payload carries a patient id and nothing else — a push
 * notification is rendered on a lock screen, and "Follow-up due: Jane Smith,
 * prenatal" on a lock screen in a shared van is a disclosure. The app resolves
 * the id to a name only after the device is unlocked.
 */
const followUpDue: Job = () =>
  withTransaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO notification_queue (recipient_sub, kind, subject_id,
                                      scheduled_for)
      SELECT DISTINCT tm.cognito_sub, 'followup-due', p.id, now()
      FROM patients p
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE p.follow_up
        AND p.next_follow_up::date <= (now() + interval '1 day')::date
        AND NOT p.deleted
        AND tm.active
        AND NOT EXISTS (
          SELECT 1 FROM notification_queue q
          WHERE q.subject_id = p.id
            AND q.kind = 'followup-due'
            AND q.scheduled_for > now() - interval '20 hours'
        )
      RETURNING id
    `);

    return { queued: rows.length };
  });

/** Flags items below their minimum and notifies team leads. */
const lowStockAlert: Job = () =>
  withTransaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO notification_queue (recipient_sub, kind, subject_id,
                                      scheduled_for)
      SELECT tm.cognito_sub, 'low-stock', i.id, now()
      FROM inventory_items i
      CROSS JOIN team_members tm
      WHERE i.stock < i.min_level
        AND i.ordered_at IS NULL
        AND tm.active
        AND tm.access_tier = 'full-admin'
        AND NOT EXISTS (
          SELECT 1 FROM notification_queue q
          WHERE q.subject_id = i.id
            AND q.kind = 'low-stock'
            AND q.scheduled_for > now() - interval '24 hours'
        )
      RETURNING id
    `);

    return { alerts: rows.length };
  });

/**
 * Moves audit rows older than 90 days into the Object Lock archive.
 *
 * Rows are marked archived rather than deleted here; the actual S3 write is
 * done by the export step, and the row is only removed once the object is
 * confirmed durable. Losing an audit record is worse than storing it twice.
 */
const auditArchive: Job = () =>
  withTransaction(async (client) => {
    const { rowCount } = await client.query(`
      UPDATE audit_log
      SET archived = true
      WHERE occurred_at < now() - interval '90 days'
        AND NOT archived
    `);

    return { marked: rowCount };
  });
