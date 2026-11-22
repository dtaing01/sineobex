import { createRoute, z } from '@hono/zod-openapi';
import { PRESET_KINDS, type HeldPreset, type PresetKind } from '@sineobex/presets';
import type { TeamScope } from '../auth/context.ts';
import { notFound } from '../lib/errors.ts';
import {
  archivePreset,
  createPreset,
  editPreset,
  loadTeamPresets,
  platformUpdateOf,
  presetReadScope,
  presetWriteScope,
  PresetReason,
  referencedBy,
  restorePreset,
  takePlatformUpdate,
  type TeamPresets,
} from '../presets/store.ts';
import type { App } from '../app.ts';
import { DateTime, MAX_VERSION, UserRef } from '../sync/schemas.ts';
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
const presetParam = z.object({ kind: Kind, id: Uuid });

/**
 * The body as it is sent, whatever it is: the store parses it by its kind's schema and answers 422
 * invalid with the path of each problem, a body that is no object among them, so the admin is shown
 * where it is wrong.
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

/** The version the person opened, so a write never undoes a change they have not seen. */
const BaseVersion = z
  .number()
  .int()
  .min(1)
  .max(MAX_VERSION)
  .openapi({ description: 'The version you opened: any other is refused as stale, with the current one' });

const CreatePreset = z.object({ body: SentBody, reason: PresetReason }).openapi('CreatePreset');

const CreatePresetResult = z
  .object({ id: Uuid, version: z.literal(1), revision: Revision })
  .openapi('CreatePresetResult');

const EditPreset = z
  .object({ baseVersion: BaseVersion, body: SentBody, reason: PresetReason })
  .openapi('EditPreset');

const EditPresetResult = z
  .object({ version: z.number().int().min(2), revision: Revision })
  .openapi('EditPresetResult');

const ArchivePreset = z.object({ baseVersion: BaseVersion, reason: PresetReason }).openapi('ArchivePreset');

const RestorePreset = z.object({ reason: PresetReason }).openapi('RestorePreset');

/** What an archive or a restore answers: it stays at the version it is at, so only the revision moves. */
const PresetRevision = z.object({ revision: Revision }).openapi('PresetRevision');

const TakePresetUpdate = z
  .object({
    baseVersion: BaseVersion,
    reason: PresetReason,
    asNew: z.boolean().openapi({
      description:
        'Take it as a new preset: this one is archived and kept in the history. The only way to take an update that changes a field fixed at creation',
    }),
  })
  .openapi('TakePresetUpdate');

const TakePresetUpdateResult = z
  .object({
    id: Uuid.openapi({ description: 'The preset that now holds the update: this one, or the new one' }),
    version: z.number().int().min(1).openapi({ description: 'Its version now: 1 for a new preset' }),
    revision: Revision,
  })
  .openapi('TakePresetUpdateResult');

/** The acts team_preset_events keeps for a preset (0023): a person's, or the platform installer's. */
const PRESET_ACTS = [
  'created',
  'updated',
  'archived',
  'restored',
  'update_taken',
  'reordered',
  'installed',
  'platform_updated',
] as const;

const PresetEvent = z
  .object({
    act: z.enum(PRESET_ACTS).openapi({
      description:
        'installed and platform_updated are the platform installer’s; every other act is a person’s',
    }),
    version: z
      .number()
      .int()
      .min(1)
      .openapi({ description: 'The version the act made, or stood on: an archive and a restore make none' }),
    source: z.enum(['team', 'platform']).openapi({
      description: 'Whose version it is: the team’s, or the platform’s, installed or taken by a person',
    }),
    by: z.union([UserRef, z.null()]).openapi({ description: 'Who acted; null for the platform installer' }),
    at: DateTime,
    reason: z
      .string()
      .nullable()
      .openapi({ description: 'Why, as the person gave it; null for the platform installer' }),
    body: z
      .record(z.string(), z.unknown())
      .openapi({ description: 'That version’s body, in the shape of @sineobex/presets for its kind' }),
  })
  .openapi('PresetEvent');

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

const editPresetRoute = createRoute({
  method: 'put',
  path: '/v1/admin/presets/{kind}/{id}',
  operationId: 'editPreset',
  tags: ['presets'],
  summary: 'Give a preset its next version, with a reason (recent sign-in); what is fixed at creation stays',
  security: [{ bearer: [] }],
  request: { params: presetParam, body: { required: true, ...json(EditPreset) } },
  responses: {
    200: { description: 'Its next version', ...json(EditPresetResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const archivePresetRoute = createRoute({
  method: 'post',
  path: '/v1/admin/presets/{kind}/{id}/archive',
  operationId: 'archivePreset',
  tags: ['presets'],
  summary: 'Archive a preset no active preset names, with a reason (recent sign-in); nothing is deleted',
  security: [{ bearer: [] }],
  request: { params: presetParam, body: { required: true, ...json(ArchivePreset) } },
  responses: {
    200: { description: 'Archived, at the version it is at', ...json(PresetRevision) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const restorePresetRoute = createRoute({
  method: 'post',
  path: '/v1/admin/presets/{kind}/{id}/restore',
  operationId: 'restorePreset',
  tags: ['presets'],
  summary: 'Restore an archived preset at the version it is at, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { params: presetParam, body: { required: true, ...json(RestorePreset) } },
  responses: {
    200: { description: 'Restored, at the version it is at', ...json(PresetRevision) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const takeUpdateRoute = createRoute({
  method: 'post',
  path: '/v1/admin/presets/{kind}/{id}/take-update',
  operationId: 'takePresetUpdate',
  tags: ['presets'],
  summary:
    'Take the platform’s newer version of a preset, in place or as a new preset, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { params: presetParam, body: { required: true, ...json(TakePresetUpdate) } },
  responses: {
    200: {
      description: 'The preset that holds the update, at its version now',
      ...json(TakePresetUpdateResult),
    },
    ...errors(401, 403, 404, 409, 422),
  },
});

const historyRoute = createRoute({
  method: 'get',
  path: '/v1/admin/presets/{kind}/{id}/history',
  operationId: 'getPresetHistory',
  tags: ['presets'],
  summary: 'Every act on a preset, oldest first, with who, when and why, and the body of its version',
  security: [{ bearer: [] }],
  request: { params: presetParam },
  responses: {
    200: { description: 'Its history', ...json(z.array(PresetEvent)) },
    ...errors(401, 403, 404, 422),
  },
});

/**
 * The preset an address names, as the store reads IDs: in lowercase, as the database writes a UUID,
 * so one sent in capitals still names its preset.
 */
const presetIn = (param: { kind: PresetKind; id: string }) => ({
  kind: param.kind,
  id: param.id.toLowerCase(),
});

// The pages list a kind by name, in one order whatever the database's collation (CI runs two
// PostgreSQL versions), the ID settling two names a reader would sort alike.
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** A preset as Team setup's pages show it: a fault, never a row, when its current version is missing. */
function viewOf(team: TeamPresets, preset: HeldPreset): z.infer<typeof PresetView> {
  // Every writer writes a head with its version (store.ts, the installer); 0023 cannot hold it.
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

/**
 * Every act on one of the team's presets of the kind, oldest first, each with the version it made
 * or stood on. By version before time: versions are made one after another under the team lock,
 * while an act's time is when its transaction began, so a phone's pull that began before an admin
 * took an update and installed a newer one after it (5.2) would otherwise come first.
 */
function presetHistory(scope: TeamScope, kind: PresetKind, id: string) {
  const { teamId } = scope.team;
  return scope.tx(async (tx) => {
    const [head] = await tx`
      select 1 from sineobex.team_presets where team_id = ${teamId} and id = ${id} and kind = ${kind}`;
    if (!head) throw notFound('preset');
    const rows = await tx<
      {
        act: (typeof PRESET_ACTS)[number];
        version: number;
        source: 'team' | 'platform' | null;
        byId: string | null;
        byName: string | null;
        at: Date;
        reason: string | null;
        body: Record<string, unknown> | null;
      }[]
    >`
      select e.act, e.version, v.source, e.created_by as by_id, u.display_name as by_name,
             e.created_at as at, e.reason, v.body
      from sineobex.team_preset_events e
      left join sineobex.team_preset_versions v
        on v.team_id = e.team_id and v.preset_id = e.preset_id and v.version = e.version
      left join sineobex.users u on u.id = e.created_by
      where e.team_id = ${teamId} and e.preset_id = ${id}
      order by e.version, e.created_at, e.id`;
    return rows.map((r) => {
      // Every act names a version its preset holds (store.ts, the installer); 0023 cannot hold it.
      if (r.source === null || r.body === null) throw new Error('a preset event’s version is missing');
      return {
        act: r.act,
        version: r.version,
        source: r.source,
        by: r.byId === null ? null : { userId: r.byId, displayName: r.byName ?? '' },
        at: r.at.toISOString(),
        reason: r.reason,
        body: r.body,
      };
    });
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

  app.openapi(editPresetRoute, async (c) => {
    const { kind, id } = presetIn(c.req.valid('param'));
    const { baseVersion, body, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await editPreset(scope, { kind, id, baseVersion, body, reason }), 200);
  });

  // PLAN-OPEN (PL-12): is a preset nobody uses deleted, or archived like the rest? Archived: no
  // route deletes one, so every old note, order and report can still name what it used, and a
  // platform update cannot bring it back.
  app.openapi(archivePresetRoute, async (c) => {
    const { kind, id } = presetIn(c.req.valid('param'));
    const { baseVersion, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await archivePreset(scope, { kind, id, baseVersion, reason }), 200);
  });

  app.openapi(restorePresetRoute, async (c) => {
    const { kind, id } = presetIn(c.req.valid('param'));
    const { reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await restorePreset(scope, { kind, id, reason }), 200);
  });

  // PLAN-OPEN (PL-20): may a platform update change a field fixed at creation? Only as a new
  // preset (asNew), the old one archived, so what its counts, ranks and readers meant stays; in
  // place, such an update is refused fixed_field.
  app.openapi(takeUpdateRoute, async (c) => {
    const { kind, id } = presetIn(c.req.valid('param'));
    const { baseVersion, asNew, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await takePlatformUpdate(scope, { kind, id, baseVersion, asNew, reason }), 200);
  });

  // PLAN-OPEN (PL-13): is reading the team's presets audited? No, nor their history: it holds the
  // admins' reasons and bodies, no patient data.
  app.openapi(historyRoute, async (c) => {
    const { kind, id } = presetIn(c.req.valid('param'));
    const scope = await presetReadScope(c, deps);
    return c.json(await presetHistory(scope, kind, id), 200);
  });
}
