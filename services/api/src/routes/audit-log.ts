import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors, Uuid } from './schemas.ts';

const AuditEntry = z
  .object({
    id: z.string(),
    seq: z.string(),
    occurredAt: z.string().datetime(),
    deviceTime: z.string().datetime().nullable(),
    actor: z.object({
      userId: Uuid.nullable(),
      displayName: z.string().nullable(),
      role: z.string().nullable(),
    }),
    action: z.string(),
    entity: z.string().nullable(),
    entityId: z.string().nullable(),
    patientId: Uuid.nullable(),
    deviceId: Uuid.nullable(),
    ip: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .openapi('AuditEntry');

// POST, so the search terms (a patient, a person) never land in URLs, browser history or access logs.
const AuditSearch = z
  .object({
    actorUserId: Uuid.optional(),
    patientId: Uuid.optional(),
    actionPrefix: z
      .string()
      .regex(/^[a-z_.]+$/)
      .max(60)
      .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    beforeId: z.string().regex(/^\d+$/).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .openapi('AuditSearch');

const AuditPage = z
  .object({ entries: z.array(AuditEntry), nextBeforeId: z.string().nullable() })
  .openapi('AuditPage');

const ChainCheck = z
  .object({
    ok: z.boolean(),
    checked: z.number().int(),
    firstBadSeq: z.number().int().nullable(),
    problem: z.string().nullable(),
  })
  .openapi('ChainCheck');

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const searchRoute = createRoute({
  method: 'post',
  path: '/v1/team/audit/search',
  operationId: 'searchAudit',
  tags: ['audit'],
  summary: 'Search the audit log by person, patient, action and time. The search itself is logged.',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(AuditSearch) } },
  responses: { 200: { description: 'Entries, newest first', ...json(AuditPage) }, ...errors(401, 403, 422) },
});

const verifyRoute = createRoute({
  method: 'post',
  path: '/v1/team/audit/verify',
  operationId: 'verifyAuditChain',
  tags: ['audit'],
  summary: "Recompute every hash in the team's audit chain",
  security: [{ bearer: [] }],
  responses: { 200: { description: 'Result', ...json(ChainCheck) }, ...errors(401, 403) },
});

export function registerAuditRoutes(app: App, deps: Deps): void {
  app.openapi(searchRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.view_audit'] });
    const q = c.req.valid('json');
    const page = await scope.tx(async (tx, audit) => {
      const rows = await tx<
        {
          id: string;
          seq: string;
          occurredAt: Date;
          deviceTime: Date | null;
          actorUserId: string | null;
          actorName: string | null;
          actorRole: string | null;
          action: string;
          entity: string | null;
          entityId: string | null;
          patientId: string | null;
          deviceId: string | null;
          ip: string | null;
          details: Record<string, unknown>;
        }[]
      >`
        select e.id::text, e.seq::text, e.occurred_at, e.device_time, e.actor_user_id, u.display_name as actor_name,
               e.actor_role, e.action, e.entity, e.entity_id, e.patient_id, e.device_id, host(e.ip) as ip, e.details
        from sineobex.audit_events e
        left join sineobex.users u on u.id = e.actor_user_id
        where e.team_id = ${scope.team.teamId}
          ${q.actorUserId ? tx`and e.actor_user_id = ${q.actorUserId}` : tx``}
          ${q.patientId ? tx`and e.patient_id = ${q.patientId}` : tx``}
          ${q.actionPrefix ? tx`and e.action like ${`${q.actionPrefix}%`}` : tx``}
          ${q.from ? tx`and e.occurred_at >= ${q.from}` : tx``}
          ${q.to ? tx`and e.occurred_at < ${q.to}` : tx``}
          ${q.beforeId ? tx`and e.id < ${q.beforeId}` : tx``}
        order by e.id desc
        limit ${q.limit + 1}`;
      await audit({
        action: 'audit.searched',
        patientId: q.patientId ?? null,
        details: {
          actorUserId: q.actorUserId ?? null,
          actionPrefix: q.actionPrefix ?? null,
          results: Math.min(rows.length, q.limit),
        },
      });
      return rows;
    });
    const entries = page.slice(0, q.limit).map((r) => ({
      id: r.id,
      seq: r.seq,
      occurredAt: r.occurredAt.toISOString(),
      deviceTime: r.deviceTime ? r.deviceTime.toISOString() : null,
      actor: { userId: r.actorUserId, displayName: r.actorName, role: r.actorRole },
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      patientId: r.patientId,
      deviceId: r.deviceId,
      ip: r.ip,
      details: r.details,
    }));
    return c.json({ entries, nextBeforeId: page.length > q.limit ? entries.at(-1)!.id : null }, 200);
  });

  app.openapi(verifyRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['team.view_audit'] });
    const result = await scope.tx(async (tx, audit) => {
      const [r] = await tx<
        { ok: boolean; checked: string; firstBadSeq: string | null; problem: string | null }[]
      >`
        select ok, checked, first_bad_seq, problem from sineobex.verify_audit_chain(${scope.team.teamId})`;
      await audit({ action: 'audit.verified', details: { ok: r!.ok, checked: Number(r!.checked) } });
      return r!;
    });
    return c.json(
      {
        ok: result.ok,
        checked: Number(result.checked),
        firstBadSeq: result.firstBadSeq === null ? null : Number(result.firstBadSeq),
        problem: result.problem,
      },
      200,
    );
  });
}
