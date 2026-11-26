import { createRoute, z } from '@hono/zod-openapi';
import {
  hiddenParts,
  isNoteTypeTitle,
  madeIn,
  protectedParts,
  typeProtected,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import { versionsFor } from '../forms/definitions.ts';
import {
  archiveNoteType,
  copySourceOf,
  createNoteType,
  FIXED_NOTE_TYPE_FIELDS,
  loadTeamNoteTypes,
  NOTE_TYPE_ACTS,
  NOTE_TYPE_GROUPS,
  noteTypeHistory,
  noteTypeUpdateOf,
  publishNoteType,
  referencedBy,
  restoreNoteType,
  takeNoteTypeUpdate,
  type HeldNoteType,
  type TeamNoteTypes,
} from '../presets/note-types.ts';
import { presetReadScope, presetWriteScope, PresetReason } from '../presets/store.ts';
import type { App } from '../app.ts';
import { DateTime, MAX_VERSION, UserRef } from '../sync/schemas.ts';
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
    whole: z.boolean().openapi({
      description:
        'Nothing in it can be changed, its title and what an edit would add included: the Red flags note',
    }),
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

const NoteTypeHiddenPart = z
  .object({
    kind: z.enum(['section', 'field', 'option']).openapi({
      description:
        'A section, a field (at any depth) or an answer of a choice field the current version lacks',
    }),
    path: z.string().openapi({
      description:
        'A section’s id; a field’s path, the entry part of a repeating section left out; for an answer, its field’s path',
    }),
    code: z.string().optional().openapi({ description: 'An answer’s code' }),
    words: z.string().openapi({ description: 'Its title, label or words in the newest version that had it' }),
    showAgain: z.boolean().openapi({
      description:
        'set_hidden with hidden false copies it back now, unchanged: the editor offers Show again. A part inside a hidden one comes back with it',
    }),
    part: z.record(z.string(), z.unknown()).optional().openapi({
      description: 'A section or a field as that version held it, so what is inside it can be named',
    }),
  })
  .openapi('NoteTypeHiddenPart', {
    description: 'A part an earlier version had and the current version lacks (design 5.4, 8.1)',
  });

const NoteTypeCopySection = z
  .object({
    id: z.string(),
    title: z.string(),
    made: z.array(z.string()).openapi({
      description:
        'Every id and code the team made (`t_` and a number) that the section holds, at any depth, in the order it writes them: what the note type it is copied into may never have used (id_taken)',
    }),
  })
  .openapi('NoteTypeCopySection', { description: 'A section copy_section can name from this note type' });

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
    hidden: z.array(NoteTypeHiddenPart).openapi({
      description:
        'What earlier versions had and the current one lacks, newest first: none for a type never hidden from',
    }),
    copySections: z.array(NoteTypeCopySection).openapi({
      description:
        'The sections a copy from it reads, in order: the platform’s newest released version of a platform note type, whatever the team’s copy holds, else its current version',
    }),
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
/**
 * A note type's title as an operation sends it: one with words that starts or ends with white space is
 * refused, never trimmed, as a preset's name is; any other value is the operation's to refuse
 * (title_invalid), so an empty one or one of spaces only is answered with its index.
 */
const SentTitle = z
  .string()
  .refine((s) => s === s.trim() || s.trim() === '', { message: 'untrimmed' })
  .openapi({ description: '1 to 80 characters, with no space before or after' });

const Path = z.string().openapi({
  description: 'A field’s path, the entry part of a repeating section left out, or a section’s id',
});
/**
 * A label, an answer's words or a section's title as an operation sends it: refused with white space
 * before or after its words, as a title is (SentTitle), never trimmed; one that is empty or only
 * spaces is the operation's to refuse (label_invalid), with its index.
 */
const Label = z
  .string()
  .refine((s) => s === s.trim() || s.trim() === '', { message: 'untrimmed' })
  .openapi({ description: 'Words, with no space before or after: not empty, not only spaces' });
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
    z.strictObject({ op: op('rename_type'), title: SentTitle }),
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

/** The revision a write took: a phone's next list gets the change. */
const Revision = z.number().int().min(1).openapi({ description: 'The team’s revision this write took' });

/** A new note type's title: 1 to 80 characters, sent as it is kept. */
const NoteTypeTitle = z
  .string()
  .refine((s) => isNoteTypeTitle(s) && s === s.trim(), { message: 'title_invalid' })
  .openapi({ description: '1 to 80 characters, with no space before or after' });

const Kinds = z
  .array(z.enum(['medical', 'non_medical']))
  .min(1)
  .max(2)
  .refine((kinds) => new Set(kinds).size === kinds.length, { message: 'repeated' })
  .openapi({
    description:
      'Medical, Non-Medical or both: which visits offer it. It is Medical exactly when it is medical alone',
  });

/**
 * A new note type: a copy of one the team holds (`copyOf`), or a blank one with its kinds and timeline
 * group, one or the other. One shape with both ways in it, so a request missing a field is refused
 * naming it.
 */
const CreateNoteType = z
  .strictObject({
    title: NoteTypeTitle,
    reason: PresetReason,
    copyOf: NoteTypeKey.optional().openapi({
      description:
        'A note type the team holds, copied at its current version with its kinds, group, sensitivity and marks; else a blank one with kinds and group',
    }),
    kinds: Kinds.optional(),
    group: z.enum(NOTE_TYPE_GROUPS).optional().openapi({ description: 'Where the timeline files its notes' }),
  })
  .superRefine((b, ctx) => {
    const copy = b.copyOf !== undefined;
    if (
      copy ? b.kinds !== undefined || b.group !== undefined : b.kinds === undefined || b.group === undefined
    )
      ctx.addIssue({
        code: 'custom',
        path: [copy ? 'copyOf' : b.kinds === undefined ? 'kinds' : 'group'],
        message: 'copy_or_blank',
      });
  })
  .openapi('CreateNoteType', {
    description:
      'A copy ({title, copyOf, reason}) or a blank note type ({title, kinds, group, reason}): one section, Notes, holding one text field, Notes',
  });

const CreateNoteTypeResult = z
  .object({
    key: z.string().openapi({ description: 'The new note type’s key: t_ and 12 hex characters' }),
    version: z.literal(1),
  })
  .openapi('CreateNoteTypeResult');

const ArchiveNoteType = z
  .object({ baseVersion: BaseVersion, reason: PresetReason })
  .openapi('ArchiveNoteType');

const RestoreNoteType = z.object({ reason: PresetReason }).openapi('RestoreNoteType');

/** What a remove or a restore answers: it stays at the version it is at, so only the revision moves. */
const NoteTypeRevision = z.object({ revision: Revision }).openapi('NoteTypeRevision');

const TakeNoteTypeUpdate = z
  .object({
    baseVersion: BaseVersion,
    platformVersion: z.number().int().min(1).max(MAX_VERSION).openapi({
      description:
        'The platform version you reviewed, as the list’s update gave it: a newer one on offer by then is refused as stale',
    }),
    reason: PresetReason,
    asNew: z.boolean().openapi({
      description:
        'Take it as a new note type: this one is removed and kept in the history. The only way to take an update that changes what is fixed at creation',
    }),
  })
  .openapi('TakeNoteTypeUpdate');

const TakeNoteTypeUpdateResult = z
  .object({
    key: z
      .string()
      .openapi({ description: 'The note type that now holds the update: this one, or the new one' }),
    version: z.number().int().min(1).openapi({ description: 'Its version now: 1 for a new note type' }),
    revision: Revision,
  })
  .openapi('TakeNoteTypeUpdateResult');

/** One act in a note type's history, as a preset's history gives one, without its definition. */
const NoteTypeEvent = z
  .object({
    act: z.enum(NOTE_TYPE_ACTS).openapi({
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
  })
  .openapi('NoteTypeEvent');

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

const addRoute = createRoute({
  method: 'post',
  path: '/v1/admin/note-types',
  operationId: 'createNoteType',
  tags: ['presets'],
  summary: 'Add a note type of the team’s own, blank or a copy, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(CreateNoteType) } },
  responses: {
    201: { description: 'Added at version 1', ...json(CreateNoteTypeResult) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const archiveRoute = createRoute({
  method: 'post',
  path: '/v1/admin/note-types/{key}/archive',
  operationId: 'archiveNoteType',
  tags: ['presets'],
  summary: 'Remove a note type from new notes, with a reason (recent sign-in); every version still reads',
  security: [{ bearer: [] }],
  request: { params: keyParam, body: { required: true, ...json(ArchiveNoteType) } },
  responses: {
    200: { description: 'Removed, at the version it is at', ...json(NoteTypeRevision) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const restoreRoute = createRoute({
  method: 'post',
  path: '/v1/admin/note-types/{key}/restore',
  operationId: 'restoreNoteType',
  tags: ['presets'],
  summary: 'Restore a removed note type at the version it is at, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { params: keyParam, body: { required: true, ...json(RestoreNoteType) } },
  responses: {
    200: { description: 'Restored, at the version it is at', ...json(NoteTypeRevision) },
    ...errors(401, 403, 404, 409, 422),
  },
});

const takeUpdateRoute = createRoute({
  method: 'post',
  path: '/v1/admin/note-types/{key}/take-update',
  operationId: 'takeNoteTypeUpdate',
  tags: ['presets'],
  summary:
    'Take the platform’s newer version of a note type, in place or as a new one, with a reason (recent sign-in)',
  security: [{ bearer: [] }],
  request: { params: keyParam, body: { required: true, ...json(TakeNoteTypeUpdate) } },
  responses: {
    200: {
      description: 'The note type that holds the update, at its version now',
      ...json(TakeNoteTypeUpdateResult),
    },
    ...errors(401, 403, 404, 409, 422),
  },
});

const historyRoute = createRoute({
  method: 'get',
  path: '/v1/admin/note-types/{key}/history',
  operationId: 'getNoteTypeHistory',
  tags: ['presets'],
  summary: 'Every act on a note type, oldest first, with who, when, whose version and why',
  security: [{ bearer: [] }],
  request: { params: keyParam },
  responses: {
    200: { description: 'Its history', ...json(z.array(NoteTypeEvent)) },
    ...errors(401, 403, 404, 422),
  },
});

// The pages list note types by title, in one order whatever the database's collation (CI runs two
// PostgreSQL versions), the key settling two titles a reader would sort alike.
const byTitle = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * A note type as Team setup's pages show it. `versions` are every version it holds, oldest first:
 * what it showed before and lacks now (Show again, and the words of the pages, design 8.1).
 */
function viewOf(
  team: TeamNoteTypes,
  held: HeldNoteType,
  versions: readonly ResolvedNoteType[],
): z.infer<typeof NoteTypeView> {
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
    // The whole note type said once, so the page offers no edit the API would refuse (D114).
    protected: { whole: typeProtected(held.definition), ...protectedParts(held.definition) },
    hidden: hiddenParts(versions).map((p) =>
      p.kind === 'option'
        ? { ...p, showAgain: false }
        : { ...p, part: p.part as unknown as Record<string, unknown> },
    ),
    // With what rule 3 checks of it, so a page can name the part a refused copy would be confused with.
    copySections: copySourceOf(held).sections.map((s) => ({
      id: s.id,
      title: s.title,
      made: [...madeIn(s)],
    })),
  };
}

/**
 * Every note type of the team, removed ones included, in one read. It runs no installer: what is on
 * offer is what the last install wrote, at team creation, in the seed or at a phone's list.
 */
function listNoteTypesAdmin(scope: TeamScope) {
  return scope.tx(async (tx) => {
    const team = await loadTeamNoteTypes(tx, scope.team.teamId);
    // Every version of each, each checked as definitionFor checks it: what they showed before.
    const versions = await versionsFor(
      tx,
      scope.team.teamId,
      team.all.map((n) => n.key),
    );
    return team.all
      .map((held) =>
        viewOf(
          team,
          held,
          (versions.get(held.key) ?? []).map((v) => v.definition),
        ),
      )
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

  // The history of 8.1, as a preset's: who, when, the platform's or the team's, and the reason, which
  // is kept only in team_preset_events and shown only here (design 9).
  app.openapi(historyRoute, async (c) => {
    const { key } = c.req.valid('param');
    const scope = await presetReadScope(c, deps);
    return c.json(await scope.tx((tx) => noteTypeHistory(tx, scope.team.teamId, key)), 200);
  });

  app.openapi(addRoute, async (c) => {
    const { title, reason, copyOf, kinds, group } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    const made =
      copyOf === undefined
        ? await createNoteType(scope, { title, reason, kinds: kinds!, group: group! })
        : await createNoteType(scope, { title, reason, copyOf });
    return c.json(made, 201);
  });

  app.openapi(publishRoute, async (c) => {
    const { key } = c.req.valid('param');
    const { baseVersion, ops, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await publishNoteType(scope, { key, baseVersion, ops, reason }), 200);
  });

  // PLAN-OPEN (PL-12): is a preset nobody uses deleted, or archived like the rest? Archived, note
  // types too: no route deletes one, so every note begun on it still reads and finishes, and a
  // platform update can't bring it back.
  app.openapi(archiveRoute, async (c) => {
    const { key } = c.req.valid('param');
    const { baseVersion, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await archiveNoteType(scope, { key, baseVersion, reason }), 200);
  });

  app.openapi(restoreRoute, async (c) => {
    const { key } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await restoreNoteType(scope, { key, reason }), 200);
  });

  // PLAN-OPEN (PL-20): may a platform update change a field fixed at creation? Only as a new note
  // type (asNew), the old one removed, so what its notes were read as stays: in place, an update
  // that changes kinds, group, sensitivity, quick or auto is refused fixed_field.
  app.openapi(takeUpdateRoute, async (c) => {
    const { key } = c.req.valid('param');
    const { baseVersion, platformVersion, asNew, reason } = c.req.valid('json');
    const scope = await presetWriteScope(c, deps);
    return c.json(await takeNoteTypeUpdate(scope, { key, baseVersion, platformVersion, asNew, reason }), 200);
  });
}
