import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import { definitionFor, listNoteTypes } from '../forms/definitions.ts';
import { notFound } from '../lib/errors.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors } from './schemas.ts';

/**
 * Note type definitions (phase 4 design, forms 3.3): any member of the team reads them, whatever
 * their role. They hold no patient data.
 */

/**
 * A response that holds no patient data and never changes: the one exception to the app's
 * `no-store`, which leaves a response alone when its handler sent exactly this. Private, since a
 * team may hold its own definition under a key and version (phase 5).
 */
export const IMMUTABLE_NO_PHI = 'private, max-age=31536000, immutable';

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const NoteTypeKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,60}$/)
  .openapi({ description: 'A note type’s key, as migration 0017 allows it', example: 'wound_care' });

const Kinds = z.array(z.enum(['medical', 'non_medical']));
const Sensitivity = z.enum(['none', 'sensitive']);

export const NoteTypeEntry = z
  .object({
    key: NoteTypeKey,
    version: z.number().int().min(1).openapi({ description: 'The newest version the team holds' }),
    title: z.string(),
    kinds: Kinds.openapi({ description: 'Which encounters offer it' }),
    sensitivity: Sensitivity.openapi({ description: '`sensitive` needs patients.view_sensitive to read' }),
    quick: z.boolean().openapi({ description: 'The Quick encounter' }),
    auto: z
      .enum(['medical'])
      .nullable()
      .openapi({ description: 'Added by itself with the first Medical note of an encounter' }),
    hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .openapi({ description: 'SHA-256 of the definition’s canonical JSON' }),
  })
  .openapi('NoteTypeEntry');

export const NoteTypeList = z.object({ noteTypes: z.array(NoteTypeEntry) }).openapi('NoteTypeList');

export const NoteTypeDefinition = z
  .object({
    key: NoteTypeKey,
    version: z.number().int().min(1),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    definition: z
      .record(z.string(), z.unknown())
      .openapi({ description: 'The resolved definition, in the format of @sineobex/forms' }),
  })
  .openapi('NoteTypeDefinition');

const DefinitionParams = z.object({
  key: NoteTypeKey,
  // Digits only, as the client sends them (every path parameter travels as text): no sign, no
  // fraction, no leading zero, so one version has one URL.
  version: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/)
    .openapi({ param: { name: 'version', in: 'path' }, description: 'A version, 1 or more', example: '1' }),
});

const listRoute = createRoute({
  method: 'get',
  path: '/v1/forms/note-types',
  operationId: 'listNoteTypes',
  tags: ['forms'],
  summary: 'The team’s note types, each at its newest version',
  description:
    'Any member of the team. Installs the platform’s presets the team does not hold yet first, and audits ' +
    'that install when it writes; the list itself holds no patient data and is not audited.',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'The list', ...json(NoteTypeList) }, ...errors(400, 401, 403) },
});

const definitionRoute = createRoute({
  method: 'get',
  path: '/v1/forms/note-types/{key}/{version}',
  operationId: 'getNoteTypeDefinition',
  tags: ['forms'],
  summary: 'One version of a note type, resolved. It never changes, so it may be kept',
  description: 'Any member of the team. Holds no patient data and is not audited.',
  security: [{ bearer: [] }],
  request: { params: DefinitionParams },
  responses: {
    200: { description: 'The definition', ...json(NoteTypeDefinition) },
    ...errors(400, 401, 403, 404, 422),
  },
});

export function registerFormRoutes(app: App, deps: Deps) {
  app.openapi(listRoute, async (c) => {
    const scope = await teamScope(c, deps);
    return c.json({ noteTypes: await listNoteTypes(scope) }, 200);
  });

  app.openapi(definitionRoute, async (c) => {
    const scope = await teamScope(c, deps);
    const { key, version } = c.req.valid('param');
    const stored = await scope.tx((tx) => definitionFor(tx, scope.team.teamId, key, Number(version)));
    if (!stored) throw notFound('note type version');
    c.header('Cache-Control', IMMUTABLE_NO_PHI);
    // A private cache keys on the team too: two teams may hold different definitions at one URL.
    c.header('Vary', 'Authorization, X-Team-Id', { append: true });
    return c.json(stored, 200);
  });
}
