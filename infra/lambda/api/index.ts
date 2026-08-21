import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

import { withTransaction, setActor } from '../shared/db';
import {
  ok,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
  callerFrom,
  canEdit,
  type Caller,
} from '../shared/http';

type Handler = (
  caller: Caller,
  body: Record<string, unknown>,
  query: Record<string, string | undefined>,
) => Promise<APIGatewayProxyResultV2>;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext.requestId;

  try {
    const caller = callerFrom(event);
    if (!caller) return unauthorized();

    const route = `${event.requestContext.http.method} ${event.routeKey.split(' ')[1] ?? ''}`;
    const body = event.body
      ? (JSON.parse(event.body) as Record<string, unknown>)
      : {};

    const routes: Record<string, Handler> = {
      'GET /v1/reference': getReference,
      'GET /v1/insights': getInsights,
      'GET /v1/patients': listPatients,
      'POST /v1/patients/lookup': lookupPatient,
      'POST /v1/sync/mutations': applyMutation,
      'POST /v1/audit': recordAudit,
    };

    const fn = routes[route] ?? routes[event.routeKey];
    if (!fn) return notFound();

    return await fn(caller, body, event.queryStringParameters ?? {});
  } catch (error) {
    if (error instanceof SyntaxError) return badRequest('Malformed JSON body');
    return serverError(requestId, error);
  }
};

/**
 * Reference data: partner facilities and geographic clusters. No PHI, so any
 * authenticated caller may read it, including view-only accounts.
 */
const getReference: Handler = async () =>
  withTransaction(async (client) => {
    const [resources, hotspots] = await Promise.all([
      client.query(
        `SELECT id, name, type, address AS loc,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng,
                hours, phone
         FROM resources
         WHERE active
         ORDER BY name`,
      ),
      client.query(
        `SELECT id, name, type, intensity, patient_count AS patients,
                ST_Y(location::geometry) AS lat,
                ST_X(location::geometry) AS lng,
                supply
         FROM hotspots
         ORDER BY name`,
      ),
    ]);

    return ok({ resources: resources.rows, hotspots: hotspots.rows });
  });

/**
 * Program analytics. Served from the rollup tables the `analytics-rollup`
 * cron job maintains, so this is a cheap read even at scale — and the numbers
 * are aggregates, never individual records.
 */
const getInsights: Handler = async () =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT payload FROM analytics_rollups
       WHERE name = 'insights'
       ORDER BY computed_at DESC
       LIMIT 1`,
    );
    if (rows.length === 0) {
      // The device computes its own from local encounters rather than showing
      // an error, so an empty payload here is a valid answer.
      return ok({});
    }
    return ok(rows[0].payload);
  });

/**
 * The caseload for the caller's team, as of a sync cursor.
 *
 * The cursor is a query parameter, not a body field: this is a GET, and a GET
 * body is not sent by most clients and not readable here. It is a timestamp,
 * not an identifier, so it is safe in a URL.
 */
const listPatients: Handler = async (caller, _body, query) =>
  withTransaction(async (client) => {
    await setActor(client, caller.sub);

    const parsed = query.since ? new Date(query.since) : null;
    const since =
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);

    const { rows } = await client.query(
      `SELECT p.id, p.first_name, p.last_name, p.dob, p.risk,
              p.location_label AS loc,
              ST_Y(p.location::geometry) AS lat,
              ST_X(p.location::geometry) AS lng,
              p.tags, p.flags, p.follow_up, p.next_follow_up,
              p.phone, p.insurance_name, p.member_id, p.primary_doctor,
              p.updated_at
       FROM patients p
       JOIN team_members tm ON tm.team_id = p.team_id
       WHERE tm.cognito_sub = $1
         AND tm.active
         AND p.updated_at > $2
         AND NOT p.deleted
       ORDER BY p.updated_at ASC
       LIMIT 500`,
      [caller.sub, since],
    );

    await client.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id)
       VALUES ($1, 'listPatients', 'patient', '')`,
      [caller.sub],
    );

    return ok({ patients: rows });
  });

/**
 * Single patient by id.
 *
 * POST rather than GET with a path parameter: an id in a URL lands in API
 * Gateway access logs, CloudFront logs, and browser history, and those are
 * retained far longer than the request. Bodies are not logged.
 */
const lookupPatient: Handler = async (caller, body) => {
  const id = body.id;
  if (typeof id !== 'string') return badRequest('id is required');

  return withTransaction(async (client) => {
    await setActor(client, caller.sub);

    const { rows } = await client.query(
      `SELECT p.*,
              ST_Y(p.location::geometry) AS lat,
              ST_X(p.location::geometry) AS lng
       FROM patients p
       JOIN team_members tm ON tm.team_id = p.team_id
       WHERE p.id = $1 AND tm.cognito_sub = $2 AND tm.active
         AND NOT p.deleted`,
      [id, caller.sub],
    );

    if (rows.length === 0) {
      // Not-found and not-authorised are deliberately indistinguishable:
      // "this patient exists but isn't yours" is itself a disclosure.
      return notFound();
    }

    const encounters = await client.query(
      `SELECT id, occurred_at AS date, provider_name AS provider, needs,
              location_label AS "encounterLoc", notes, supplies,
              follow_up_set AS "followUpSet",
              follow_up_date AS "followUpDate",
              follow_up_location AS "followUpLoc"
       FROM encounters
       WHERE patient_id = $1
       ORDER BY occurred_at DESC`,
      [id],
    );

    await client.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id)
       VALUES ($1, 'viewPatient', 'patient', $2)`,
      [caller.sub, id],
    );

    return ok({ patient: rows[0], history: encounters.rows });
  });
};

/**
 * Drains one entry from a device's offline outbox.
 *
 * Conflict policy, matching the client:
 *  - Patients and inventory resolve last-writer-wins on `updated_at`.
 *  - Encounters are append-only. A clinical note written in the field is
 *    never overwritten by a concurrent edit; a duplicate id is a retry of the
 *    same write, so it is accepted idempotently rather than rejected.
 */
const applyMutation: Handler = async (caller, body) => {
  if (!canEdit(caller)) return forbidden();

  const { entity, entityId, op, payload } = body as {
    entity?: string;
    entityId?: string;
    op?: string;
    payload?: Record<string, unknown>;
  };

  if (!entity || !entityId || !op || !payload) {
    return badRequest('entity, entityId, op, and payload are required');
  }

  return withTransaction(async (client) => {
    await setActor(client, caller.sub);

    switch (entity) {
      case 'patient':
        await client.query(
          `INSERT INTO patients (
             id, team_id, first_name, last_name, dob, risk, location_label,
             location, tags, flags, follow_up, next_follow_up,
             phone, insurance_name, member_id, primary_doctor,
             client_updated_at
           )
           VALUES (
             $1,
             (SELECT team_id FROM team_members
              WHERE cognito_sub = $2 AND active),
             $3, $4, $5, $6, $7,
             ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography,
             $10, $11, $12, $13, $14, $15, $16, $17, $18
           )
           ON CONFLICT (id) DO UPDATE SET
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             dob = EXCLUDED.dob,
             risk = EXCLUDED.risk,
             location_label = EXCLUDED.location_label,
             location = EXCLUDED.location,
             tags = EXCLUDED.tags,
             flags = EXCLUDED.flags,
             follow_up = EXCLUDED.follow_up,
             next_follow_up = EXCLUDED.next_follow_up,
             phone = EXCLUDED.phone,
             insurance_name = EXCLUDED.insurance_name,
             member_id = EXCLUDED.member_id,
             primary_doctor = EXCLUDED.primary_doctor,
             client_updated_at = EXCLUDED.client_updated_at
           WHERE patients.client_updated_at < EXCLUDED.client_updated_at
             -- Team check as well as RLS. A standard-tier user must not be
             -- able to overwrite a record belonging to another team, and this
             -- holds even if the connection role is ever misconfigured.
             AND patients.team_id = (
               SELECT team_id FROM team_members
               WHERE cognito_sub = $2 AND active
             )`,
          [
            entityId,
            caller.sub,
            payload.firstName,
            payload.lastName,
            payload.dob,
            payload.risk,
            payload.loc,
            payload.lat,
            payload.lng,
            JSON.stringify(payload.tags ?? []),
            JSON.stringify(payload.flags ?? []),
            payload.followUp ?? false,
            payload.nextFollowUp ?? null,
            payload.phone ?? null,
            payload.insuranceName ?? null,
            payload.memberId ?? null,
            payload.primaryDoctor ?? null,
            // The device's own timestamp, not now(). Using now() made the
            // last-writer-wins guard compare a row against the current clock,
            // which is always newer — so a week-old offline edit always won.
            payload.updatedAt ?? new Date().toISOString(),
          ],
        );
        break;

      case 'encounter':
        await client.query(
          `INSERT INTO encounters (
             id, patient_id, occurred_at, provider_sub, provider_name, needs,
             location_label, location, notes, supplies,
             follow_up_set, follow_up_date, follow_up_location
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $9::double precision IS NULL THEN NULL
                  ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END,
             $10, $11, $12, $13, $14
           )
           ON CONFLICT (id) DO NOTHING`,
          [
            entityId,
            payload.patientId,
            payload.date,
            caller.sub,
            payload.provider,
            payload.needs,
            payload.encounterLoc,
            payload.lat ?? null,
            payload.lng ?? null,
            payload.notes,
            JSON.stringify(payload.supplies ?? []),
            payload.followUpSet ?? false,
            payload.followUpDate ?? null,
            payload.followUpLoc ?? null,
          ],
        );
        break;

      case 'inventory':
        await client.query(
          `UPDATE inventory_items
           SET stock = $2,
               ordered_at = $3,
               ordered_by = $4,
               updated_at = now(),
               client_updated_at = $5
           WHERE id = $1 AND client_updated_at < $5`,
          [
            entityId,
            payload.stock,
            payload.orderedAt ?? null,
            payload.orderedBy ?? null,
            payload.updatedAt ?? new Date().toISOString(),
          ],
        );
        break;

      default:
        return badRequest(`Unknown entity "${entity}"`);
    }

    return ok({ applied: true, entity, entityId });
  });
};

/** Ships the device's queued audit rows for offline activity. */
const recordAudit: Handler = async (caller, body) => {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) return ok({ recorded: 0 });
  if (entries.length > 500) return badRequest('Too many entries in one batch');

  return withTransaction(async (client) => {
    for (const raw of entries) {
      const entry = raw as Record<string, unknown>;
      await client.query(
        `INSERT INTO audit_log (actor, action, entity, entity_id, occurred_at,
                                recorded_offline)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          // The actor is taken from the verified token, never from the body:
          // a client must not be able to attribute its actions to someone else.
          caller.sub,
          entry.action,
          entry.entity,
          entry.entityId ?? '',
          entry.at ?? new Date().toISOString(),
        ],
      );
    }
    return ok({ recorded: entries.length });
  });
};
