import { createRoute, z } from '@hono/zod-openapi';
import type { PresetKind } from '@sineobex/presets';
import { teamScope, type TeamScope } from '../auth/context.ts';
import { installPlatformPresets } from '../presets/store.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors, Uuid } from './schemas.ts';

/**
 * The phone's copy of its team's presets (phase 5 design 6.1, 7; D130): one read, by revision and
 * epoch, after every sync that reached the server. It names no patient.
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

/**
 * The kinds a phone reads: every kind but one a later phase adds for the server alone (phase 10's
 * billing_code_map), so this list never grows with the kinds the database holds.
 */
const PULLED_KINDS = [
  'order_category',
  'item',
  'bundle',
  'flag',
  'field_supply_map',
  'condition_supply_map',
  'bag',
  'settings',
] as const satisfies readonly PresetKind[];

/** The epoch of a team that has taken no revision yet, so holds no preset: any other is a reset. */
const NO_EPOCH = '00000000-0000-0000-0000-000000000000';

const PresetsQuery = z.object({
  since: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional()
    .openapi({ description: 'The revision the phone holds; everything when absent' }),
  epoch: Uuid.optional().openapi({ description: 'The epoch the phone’s copy came from' }),
});

const PulledPreset = z
  .object({
    id: Uuid,
    kind: z.enum(PULLED_KINDS).openapi({ description: 'A phone skips a kind it does not know' }),
    state: z.enum(['active', 'archived']).openapi({ description: 'An archived preset is kept for its name' }),
    version: z.number().int().min(1).openapi({ description: 'Its current version' }),
    originKey: z
      .string()
      .nullable()
      .openapi({ description: 'The platform preset it came from; null for the team’s own' }),
    body: z
      .record(z.string(), z.unknown())
      .openapi({ description: 'Its current version’s body, in the shape of @sineobex/presets for its kind' }),
  })
  .openapi('PulledPreset');

export const PresetsPull = z
  .object({
    reset: z.boolean().openapi({
      description: 'Replace the copy whole: the revision sent is above the team’s, or another epoch',
    }),
    revision: z
      .number()
      .int()
      .min(0)
      .openapi({ description: 'Send as since next time: the greatest revision among presets, else since' }),
    epoch: Uuid.openapi({ description: 'Send as epoch next time' }),
    presets: z
      .array(PulledPreset)
      .openapi({ description: 'Every preset changed after since, or all of them; archived ones included' }),
  })
  .openapi('PresetsPull');

const pullRoute = createRoute({
  method: 'get',
  path: '/v1/presets',
  operationId: 'pullPresets',
  tags: ['presets'],
  summary: 'The team’s presets changed since a revision, for the phone’s copy (any member)',
  security: [{ bearer: [] }],
  request: { query: PresetsQuery },
  responses: { 200: { description: 'Presets', ...json(PresetsPull) }, ...errors(401, 403, 422) },
});

interface PulledRow {
  reset: boolean;
  epoch: string;
  id: string | null;
  kind: (typeof PULLED_KINDS)[number];
  state: 'active' | 'archived';
  version: number;
  originKey: string | null;
  /** Null only for a head whose current version is missing, which no writer leaves (4.1). */
  body: Record<string, unknown> | null;
  // A bigint: postgres.js gives it as a string unless it is parsed.
  revision: string | number | null;
}

/**
 * The presets a phone asks for. The installer runs first, in the same transaction and team scope,
 * so a team gets a platform update the first time a phone asks (design 5.2). Then one statement
 * reads the team's revision and epoch and every head of the kinds a phone reads above `since`, so
 * the revision answered is the greatest among the rows answered, read with them: every writer
 * takes its revision under the team lock and holds it to commit (4.2), so once a revision is read
 * no lower one can commit later, and what this read did not see, a pull since its answer does.
 * A revision above the team's, or another epoch (a restored database, setup.md), answers a reset,
 * and everything with it. A head whose current version is missing is a fault, as for every reader
 * of presets: left out under a revision above it, it would never be asked for again.
 */
async function pullPresets(
  scope: TeamScope,
  query: { since?: string | undefined; epoch?: string | undefined },
): Promise<z.infer<typeof PresetsPull>> {
  const { teamId } = scope.team;
  const sent = query.since === undefined ? null : Number(query.since);
  // A revision no team can have taken (above what a JavaScript number counts) is above the team's.
  const beyond = sent !== null && !Number.isSafeInteger(sent);
  const since = beyond ? null : sent;
  return scope.tx(async (tx, audit) => {
    await installPlatformPresets(tx, audit, { teamId, log: scope.deps.log, requestId: scope.meta.requestId });
    const rows = await tx<PulledRow[]>`
      select r.reset, st.epoch::text as epoch, p.id, p.kind, p.state, p.version, p.origin_key, p.body,
             p.revision
      from (
        select coalesce(s.revision, 0) as revision, coalesce(s.epoch, ${NO_EPOCH}::uuid) as epoch
        from (values (1)) as one (x)
        left join sineobex.team_preset_state s on s.team_id = ${teamId}::uuid
      ) st
      cross join lateral (
        select ${beyond}::boolean
               or (${since}::bigint is not null
                   and (${since}::bigint > st.revision or ${query.epoch ?? null}::uuid is distinct from st.epoch))
               as reset
      ) r
      left join lateral (
        select h.id, h.kind, h.state, h.current_version as version, h.origin_key, v.body, h.revision
        from sineobex.team_presets h
        left join sineobex.team_preset_versions v
          on v.team_id = h.team_id and v.preset_id = h.id and v.version = h.current_version
        where h.team_id = ${teamId}::uuid and h.kind = any(${[...PULLED_KINDS]}::text[])
          and (r.reset or ${since}::bigint is null or h.revision > ${since}::bigint)
      ) p on true
      order by p.revision, p.id`;
    const { reset, epoch } = rows[0]!;
    const held = rows.filter((r) => r.id !== null);
    // Every writer writes a head with its version (store.ts, the installer); 0023 cannot hold it.
    if (held.some((r) => r.body === null)) throw new Error('a preset’s current version is missing');
    const greatest = Math.max(0, ...held.map((r) => Number(r.revision)));
    return {
      reset,
      revision: held.length > 0 ? greatest : reset ? 0 : (since ?? 0),
      epoch,
      presets: held.map((r) => ({
        id: r.id!,
        kind: r.kind,
        state: r.state,
        version: r.version,
        originKey: r.originKey,
        body: r.body!,
      })),
    };
  });
}

export function registerPresetRoutes(app: App, deps: Deps): void {
  // PLAN-OPEN (PL-13): who may read the team's presets, and is reading them audited? Any active
  // member, whatever the role, and not audited: presets hold no patient data (PRD main 621 logs
  // access to patient data). The phone holds every flag, sensitive ones too, for its own copy of
  // the flag rule (design 7, GET /v1/presets/flags).
  app.openapi(pullRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json(await pullPresets(scope, c.req.valid('query')), 200);
  });
}
