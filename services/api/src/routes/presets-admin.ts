import { createRoute, z } from '@hono/zod-openapi';
import { PRESET_KINDS, type HeldPreset, type PresetKind } from '@sineobex/presets';
import type { TeamScope } from '../auth/context.ts';
import {
  createPreset,
  loadTeamPresets,
  platformUpdateOf,
  presetReadScope,
  presetWriteScope,
  PresetReason,
  referencedBy,
  type TeamPresets,
} from '../presets/store.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors, Uuid } from './schemas.ts';

/**
 * The admin preset routes (phase 5 design 5.1, 7, 9; D129, D131, D132): Team setup's pages read a
 * kind's presets here and change them one act at a time, online only, so no phone ever holds a
 * refused preset change (design 3, point 2). Each act is the store's (presets/store.ts), the one
 * writer of a team's presets, which takes the team lock first, refuses by presetWriteEffect before
 * it writes anything, and audits in the write's transaction; a route only reads the request and
 * opens the scope. Every route needs team.manage_presets, and every write a recent sign-in too. The
 * address carries a kind and a preset id, never a name (design 7).
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const Kind = z.enum(PRESET_KINDS).openapi({ description: 'The kind of preset' });
const kindParam = z.object({ kind: Kind });

/**
 * The body as it is sent: the store parses it by its kind's schema and answers 422 invalid with the
 * path of each problem, so a body this schema took is never refused for its shape here.
 */
const SentBody = z.unknown().openapi({
  description:
    'Required: the preset in its kind’s shape (@sineobex/presets), checked against that shape and the team’s other presets',
});

const Revision = z
  .number()
  .int()
  .min(1)
  .openapi({ description: 'The team’s revision this write took: a phone’s next pull gets the change' });

const CreatePreset = z.object({ body: SentBody, reason: PresetReason }).openapi('CreatePreset');

const CreatePresetResult = z
  .object({ id: Uuid, version: z.literal(1), revision: Revision })
  .openapi('CreatePresetResult');

const PresetView = z
  .object({
    id: Uuid,
    name: z.string(),
    state: z
      .enum(['active', 'archived'])
      .openapi({ description: 'An archived preset is offered for no new work' }),
    version: z.number().int().min(1).openapi({ description: 'Its current version: an edit sends it back' }),
    customized: z.boolean().openapi({
      description: 'The team edited, archived or restored it: a platform version is then only offered',
    }),
    updateOnOffer: z.boolean().openapi({ description: 'A newer platform version is on offer to take' }),
    updateChangesFixed: z.boolean().openapi({
      description: 'The update changes a field fixed at creation, so it is taken only as a new preset',
    }),
    referencedBy: z.record(z.string(), z.number().int().min(1)).openapi({
      description:
        'How many active presets name it, by their kind; only kinds that do. It can’t be archived while any do',
    }),
    body: z
      .record(z.string(), z.unknown())
      .openapi({ description: 'Its current version’s body, in the shape of @sineobex/presets for its kind' }),
  })
  .openapi('PresetView');

const listRoute = createRoute({
  method: 'get',
  path: '/v1/admin/presets/{kind}',
  operationId: 'listPresets',
  tags: ['presets'],
  summary: 'Every preset of a kind, archived ones too, with what names each and any update on offer',
  security: [{ bearer: [] }],
  request: { params: kindParam },
  responses: { 200: { description: 'Presets', ...json(z.array(PresetView)) }, ...errors(401, 403, 422) },
});

const createPresetRoute = createRoute({
  method: 'post',
  path: '/v1/admin/presets/{kind}',
  operationId: 'createPreset',
  tags: ['presets'],
  summary: 'Add a preset of the team’s own, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { params: kindParam, body: { required: true, ...json(CreatePreset) } },
  responses: {
    201: { description: 'Created at version 1', ...json(CreatePresetResult) },
    ...errors(401, 403, 409, 422),
  },
});

// The pages list a kind by name, in one order whatever the database's collation (CI runs two
// PostgreSQL versions), the ID settling two names a reader would sort alike.
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** A preset as Team setup's pages show it: a fault, never a row, when its current version is missing. */
function viewOf(team: TeamPresets, preset: HeldPreset): z.infer<typeof PresetView> {
  // Every writer writes a head with its version (store.ts, the installer), as 0023 cannot hold.
  if (preset.body === null) throw new Error('a preset’s current version is missing');
  const update = platformUpdateOf(team, preset);
  return {
    id: preset.id,
    name: preset.name,
    state: preset.state,
    version: preset.currentVersion,
    customized: preset.customized,
    // On offer exactly when taking it would not be refused no_update: the store reads it the same way.
    updateOnOffer: update !== null,
    updateChangesFixed: update !== null && update.changesFixed.length > 0,
    referencedBy: referencedBy(team, preset.id),
    body: preset.body as Record<string, unknown>,
  };
}

/** Every preset of the kind in the team, archived ones included, read in one statement. */
function listPresets(scope: TeamScope, kind: PresetKind) {
  return scope.tx(async (tx) => {
    const team = await loadTeamPresets(tx, scope.team.teamId);
    return team.all
      .filter((p) => p.kind === kind)
      .map((p) => viewOf(team, p))
      .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });
}

export function registerPresetAdminRoutes(app: App, deps: Deps): void {
  // PLAN-OPEN (PL-13): is reading the team's presets audited? No: presets hold no patient data
  // (PRD main 621 logs access to patient data). This list asks for team.manage_presets, as it is
  // the pages that change them; any member reads the presets through the phone's pull.
  app.openapi(listRoute, async (c) => {
    const { kind } = c.req.valid('param');
    const scope = await presetReadScope(c, deps);
    return c.json(await listPresets(scope, kind), 200);
  });

  app.openapi(createPresetRoute, async (c) => {
    const { kind } = c.req.valid('param');
    const { body, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await createPreset(scope, { kind, body, reason }), 201);
  });
}
