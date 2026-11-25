import { createRoute, z } from '@hono/zod-openapi';
import { protectedParts } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import {
  FIXED_NOTE_TYPE_FIELDS,
  loadTeamNoteTypes,
  noteTypeUpdateOf,
  publishNoteType,
  referencedBy,
  type HeldNoteType,
  type TeamNoteTypes,
} from '../presets/note-types.ts';
import { presetReadScope, presetWriteScope, PresetReason } from '../presets/store.ts';
import type { App } from '../app.ts';
import { MAX_VERSION } from '../sync/schemas.ts';
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

/**
 * A note type's key, as 0017 allows it: a platform key, or a team's own, `t_` and 12 hex characters
 * (4.3). It names a form, never a patient.
 */
const NoteTypeKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,60}$/)
  .openapi({ description: 'A note type’s key, as migration 0017 allows it', example: 'wound_care' });
const keyParam = z.object({ key: NoteTypeKey });

/** The version the person opened, so a write never undoes a change they have not seen. */
const BaseVersion = z
  .number()
  .int()
  .min(1)
  .max(MAX_VERSION)
  .openapi({ description: 'The version you opened: any other is refused as stale, with the current one' });

/**
 * The most operations one publish sends. An operation is cheap, but each reads the version so far,
 * so a request's size alone would let one publish keep the API busy; the editor sends far fewer.
 */
export const MAX_PUBLISH_OPS = 200;

// An operation's values are checked by the operation itself (packages/forms), which answers a
// refusal naming its index (5.4); the request checks only their types, so a value the operation
// refuses is never answered validation_failed. Each shape takes no key it does not name: a mark
// sent with one is refused, never dropped in silence, since no operation writes a mark (rule 1).
const Path = z.string().openapi({
  description: 'A field’s path, the entry part of a repeating section left out, or a section’s id',
});
const Label = z.string().openapi({ description: 'Words: not empty, not only spaces' });
const Code = z.string().openapi({ description: 'An option’s code' });
const SectionId = z.string().openapi({ description: 'A section’s id' });
const AfterSection = z.union([SectionId, z.null()]).openapi({ description: 'null puts it first' });

const NewTextField = z
  .strictObject({
    kind: z.literal('text'),
    label: Label,
    lines: z.enum(['one', 'many']),
    maxLength: z.number().openapi({ description: '1 to 4000 characters' }),
  })
  .openapi('NewTextField');
const NewChoiceField = z
  .strictObject({
    kind: z.literal('choice'),
    label: Label,
    many: z.boolean().openapi({ description: 'Choose any number, else one' }),
    options: z
      .array(Label)
      .openapi({ description: 'The options’ labels, one at least; their codes are made by the server' }),
  })
  .openapi('NewChoiceField');
const NewNumberField = z
  .strictObject({
    kind: z.literal('number'),
    label: Label,
    min: z.number(),
    max: z.number(),
    decimals: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    unit: z.string().optional(),
  })
  .openapi('NewNumberField');
const NewField = z.discriminatedUnion('kind', [NewTextField, NewChoiceField, NewNumberField]);

const op = <T extends string>(name: T) => z.literal(name);
const NoteTypeEditOp = z
  .discriminatedUnion('op', [
    z.strictObject({ op: op('rename_type'), title: z.string() }),
    z.strictObject({
      op: op('set_hidden'),
      path: Path,
      hidden: z.boolean().openapi({
        description:
          'Hidden leaves it out of the new version; shown copies it back from the last one that had it',
      }),
    }),
    z.strictObject({ op: op('rename_label'), path: Path, label: Label }),
    z.strictObject({ op: op('add_option'), path: Path, label: Label }),
    z.strictObject({ op: op('rename_option'), path: Path, code: Code, label: Label }),
    z.strictObject({ op: op('retire_option'), path: Path, code: Code }),
    z.strictObject({
      op: op('move_option'),
      path: Path,
      code: Code,
      before: z
        .union([Code, z.null()])
        .openapi({ description: 'The option it goes just before; null for the end' }),
    }),
    z.discriminatedUnion('kind', [
      NewTextField.extend({ op: op('add_field'), sectionId: SectionId }),
      NewChoiceField.extend({ op: op('add_field'), sectionId: SectionId }),
      NewNumberField.extend({ op: op('add_field'), sectionId: SectionId }),
    ]),
    z.strictObject({
      op: op('add_section'),
      title: Label,
      afterSectionId: AfterSection,
      fields: z.array(NewField).openapi({ description: 'The fields it starts with, one at least' }),
    }),
    z.strictObject({
      op: op('copy_section'),
      fromKey: NoteTypeKey,
      sectionId: SectionId,
      afterSectionId: AfterSection,
    }),
  ])
  .openapi('NoteTypeEditOp', {
    description: 'One operation of a publish (phase 5 design 5.4), applied in the order sent',
  });

const PublishNoteType = z
  .object({
    baseVersion: BaseVersion,
    ops: z.array(NoteTypeEditOp).min(1).max(MAX_PUBLISH_OPS),
    reason: PresetReason,
  })
  .openapi('PublishNoteType');

const PublishNoteTypeResult = z
  .object({
    version: z.number().int().min(2).openapi({ description: 'The version now live' }),
    alsoPublished: z.array(z.string()).openapi({
      description:
        'The other note types the publish gave their next version, by key: an option change carried along mapsTo',
    }),
  })
  .openapi('PublishNoteTypeResult');

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

const publishRoute = createRoute({
  method: 'put',
  path: '/v1/admin/note-types/{key}',
  operationId: 'publishNoteType',
  tags: ['presets'],
  summary:
    'Publish an edit of a note type as its next version, through fixed operations, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { params: keyParam, body: { required: true, ...json(PublishNoteType) } },
  responses: {
    200: { description: 'Its next version is live', ...json(PublishNoteTypeResult) },
    ...errors(401, 403, 404, 409, 422),
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

  app.openapi(publishRoute, async (c) => {
    const { key } = c.req.valid('param');
    const { baseVersion, ops, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await publishNoteType(scope, { key, baseVersion, ops, reason }), 200);
  });
}
