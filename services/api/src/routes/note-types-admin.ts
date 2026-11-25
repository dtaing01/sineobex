import { createRoute, z } from '@hono/zod-openapi';
import { protectedParts } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import {
  FIXED_NOTE_TYPE_FIELDS,
  loadTeamNoteTypes,
  noteTypeUpdateOf,
  referencedBy,
  type HeldNoteType,
  type TeamNoteTypes,
} from '../presets/note-types.ts';
import { presetReadScope } from '../presets/store.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors } from './schemas.ts';

/**
 * The admin note type routes (phase 5 design 5.4, 7, 9; D129): Team setup's note type pages read
 * the team's note types here, each with its current definition and what in it an edit may not touch,
 * and change them one act at a time, online only. A team edits a note type through fixed operations,
 * never by writing a definition; what each does is packages/forms' (applyNoteTypeEdit,
 * editNoteTypes), and every act is presets/note-types.ts's. Every route needs team.manage_presets,
 * and every write a recent sign-in too. The address carries a note type's key, never a title.
 */

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

/** Resolved definitions travel as JSON, in the format of @sineobex/forms. */
const Definition = z
  .record(z.string(), z.unknown())
  .openapi({ description: 'A resolved note type definition, in the format of @sineobex/forms' });

const ProtectedParts = z
  .object({
    sections: z.array(z.string()).openapi({ description: 'Section ids' }),
    fields: z
      .array(z.string())
      .openapi({ description: 'Field paths, the entry part of a repeating section left out' }),
    options: z.array(z.object({ path: z.string(), code: z.string() })).openapi({
      description: 'Options of choice fields, by the field’s path and the option’s code',
    }),
  })
  .openapi('NoteTypeProtectedParts', {
    description: 'What an edit may not touch: “This part can’t be changed.”',
  });

const FixedField = z.enum(FIXED_NOTE_TYPE_FIELDS);

const NoteTypePlatformUpdate = z
  .object({
    platformVersion: z.number().int().min(1).openapi({
      description: 'Send it back as platformVersion to take this update and no other',
    }),
    definition: Definition.openapi({
      description:
        'The platform’s definition named as this note type’s next version: what taking it in place writes',
    }),
    changesFixed: z.array(FixedField).openapi({
      description: 'The fields fixed at creation it changes; with any, it is taken only as a new note type',
    }),
  })
  .openapi('NoteTypePlatformUpdate');

const NoteTypeView = z
  .object({
    key: z.string(),
    title: z.string(),
    state: z.enum(['active', 'archived']).openapi({
      description: 'An archived note type is offered for no new note; every version still reads',
    }),
    version: z
      .number()
      .int()
      .min(1)
      .openapi({ description: 'Its current version: a publish, a remove and a take send it back' }),
    customized: z.boolean().openapi({
      description: 'The team edited, removed or restored it: a platform version is then only offered',
    }),
    updateOnOffer: z.boolean().openapi({ description: 'A newer platform version is on offer to take' }),
    updateChangesFixed: z.boolean().openapi({
      description: 'The update changes a field fixed at creation, so it is taken only as a new note type',
    }),
    update: z.union([NoteTypePlatformUpdate, z.null()]).openapi({
      description: 'The update on offer, for the person to review before taking it; null when none is',
    }),
    referencedBy: z.record(z.string(), z.number().int().min(1)).openapi({
      description: 'How many active presets name it, by their kind; it can’t be removed while any do',
    }),
    definition: Definition.openapi({ description: 'Its current version’s resolved definition' }),
    protected: ProtectedParts,
  })
  .openapi('NoteTypeView');

const listRoute = createRoute({
  method: 'get',
  path: '/v1/admin/note-types',
  operationId: 'listAdminNoteTypes',
  tags: ['presets'],
  summary:
    'Every note type of the team, removed ones too, with its current definition, what is protected in it and any update on offer',
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'Note types', ...json(z.array(NoteTypeView)) },
    ...errors(401, 403),
  },
});

// The pages list note types by title, in one order whatever the database's collation (CI runs two
// PostgreSQL versions), the key settling two titles a reader would sort alike.
const byTitle = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** A note type as Team setup's pages show it. */
function viewOf(team: TeamNoteTypes, held: HeldNoteType): z.infer<typeof NoteTypeView> {
  const update = noteTypeUpdateOf(held);
  return {
    key: held.key,
    title: held.title,
    state: held.state,
    version: held.currentVersion,
    customized: held.customized,
    // On offer exactly when taking it would not be refused no_update: the take reads it the same way.
    updateOnOffer: update !== null,
    updateChangesFixed: update !== null && update.changesFixed.length > 0,
    update:
      update === null
        ? null
        : {
            platformVersion: update.preset.version,
            definition: update.definition as Record<string, unknown>,
            changesFixed: update.changesFixed,
          },
    referencedBy: referencedBy(team, held.key),
    definition: held.definition as Record<string, unknown>,
    protected: protectedParts(held.definition),
  };
}

/**
 * Every note type of the team, removed ones included, in one read. It runs no installer: what is on
 * offer is what the last install wrote, at team creation, in the seed or at a phone's list.
 */
function listNoteTypesAdmin(scope: TeamScope) {
  return scope.tx(async (tx) => {
    const team = await loadTeamNoteTypes(tx, scope.team.teamId);
    return team.all
      .map((held) => viewOf(team, held))
      .sort((a, b) => byTitle.compare(a.title, b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  });
}

export function registerNoteTypeAdminRoutes(app: App, deps: Deps): void {
  // PLAN-OPEN (PL-13): is reading the team's presets audited? No, nor its note types: definitions
  // hold no patient data. The list asks for team.manage_presets, as it is the pages that change
  // them; any member reads the note types through the phone's list (forms 3.3).
  app.openapi(listRoute, async (c) => {
    const scope = await presetReadScope(c, deps);
    return c.json(await listNoteTypesAdmin(scope), 200);
  });
}
