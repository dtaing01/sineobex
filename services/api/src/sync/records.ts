import { z } from '@hono/zod-openapi';
import {
  effectiveAnswers,
  fieldAt,
  isSensitiveCode,
  visibleAnswers,
  type NoteReader,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { AuditFn } from '../auth/context.ts';
import { CAPABILITIES, mayViewProblems, type Credential, type Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { definitionFor, DefinitionMismatch } from '../forms/definitions.ts';
import { SENSITIVE_CODE_RANGES } from '../patients/generated/sensitive-codes.ts';
import { Uuid } from '../routes/schemas.ts';
import { canonicalJson } from './canonical.ts';
import type { ParentRef } from './entities/values.ts';
import type {
  AnyRecordEntityName,
  FieldStateValue,
  RecordSnapshotValue,
  RejectReasonName,
  SyncChangeInput,
} from './schemas.ts';

/**
 * Synced records and how their fields are stored. Every settable field carries its own version and
 * who last changed it, so two people can edit one record field by field. Each kind of record has
 * its rules in entities/ (the registry, phase 3 design 2.2); this file holds what they share: the
 * stored record, its history, the change being applied, and phase 2's encounter and note values.
 * A note's answers keep phase 2's open `data.<path>` pattern here, before the note is loaded; once it
 * is, the team's definition of its type checks each one (phase 4, lifecycle 4.4, entities/note.ts).
 * Who may read which answers of a note (lifecycle 6.4) is here too: the sync read leaves out what
 * the reader may not see (review.ts), and a set of an answer the sender may not see is held.
 */

/** Largest canonical JSON for one value. Photos travel separately (module 8). */
export const MAX_VALUE_BYTES = 64 * 1024;

/**
 * Data fields one note may have. Each field is its own history row, version and meta entry, so
 * without a bound one 1 MB push could write ~100,000 permanent history rows. A General note with
 * every exam system charted can pass 300 (forms 2.4); the definition bounds a note's paths, and this
 * is the server's bound, since it checks one answer at a time and counts no entries.
 */
export const MAX_NOTE_FIELDS = 1000;
const MAX_DEPTH = 10;

const Location = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100_000).optional(),
  })
  .strict();

const NoteTypeKey = z.string().regex(/^[a-z][a-z0-9_]{1,60}$/);
const DATA_PATH = /^[a-z][a-zA-Z0-9_]{0,60}(\.[a-z][a-zA-Z0-9_]{0,60}){0,3}$/;
const DataPath = z.string().regex(DATA_PATH);

// An unpaired UTF-16 surrogate parses as JSON but Postgres refuses it in jsonb. Caught here it is a
// validation rejection; missed, it would fail the same way on every retry and block the phone's queue.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const textProblem = (s: string) =>
  s.includes('\u0000')
    ? 'contains a NUL character'
    : LONE_SURROGATE.test(s)
      ? 'contains a broken character'
      : null;

/** Any JSON value Postgres can store: no NUL characters or broken surrogates, bounded depth. */
export function jsonProblem(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return 'nested too deeply';
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'not a finite number';
  if (typeof value === 'string') return textProblem(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const p = jsonProblem(v, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const kp = textProblem(k);
      if (kp) return kp;
      const p = jsonProblem(v, depth + 1);
      if (p) return p;
    }
    return null;
  }
  return 'not JSON';
}

/** A value Postgres can store; a missing one (undefined) is refused, so a key that must hold a value does. */
export const JsonValue = z.unknown().superRefine((v, ctx) => {
  const p = jsonProblem(v);
  if (p) ctx.addIssue({ code: 'custom', message: p });
});

/** A note's answer named as a field, `data.<path>`, as a set names it and a correction lists it. */
export const AnswerField = z
  .string()
  .refine((f) => f.startsWith('data.') && DATA_PATH.test(f.slice('data.'.length)), {
    message: 'not_an_answer',
  });

const EncounterKind = z.enum(['medical', 'non_medical']);

/**
 * Free text, as values.ts takes it: validated, never transformed, so the server stores the string the
 * phone hashed. The phone trims what it sends; a space at either end is refused, never trimmed here.
 * The database measures the same `length()` without trimming, so it is never the stricter of the two.
 */
const Text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s === s.trim(), { message: 'untrimmed' });

/** The place typed by hand (PRD main 378); the assessment written on the summary screen (433). */
const LocationText = Text(200);
const Summary = Text(4000);

export const EncounterCreate = z
  .object({
    kind: EncounterKind,
    patientId: Uuid.nullable().optional(),
    location: Location.nullable().optional(),
    locationText: LocationText.nullable().optional(),
  })
  .strict();

export const NoteCreate = z
  .object({
    encounterId: Uuid,
    noteTypeKey: NoteTypeKey,
    noteTypeVersion: z.number().int().min(1).nullable().optional(),
    data: z
      .record(DataPath, JsonValue)
      .refine((d) => Object.keys(d).length <= MAX_NOTE_FIELDS, { message: 'too_many_fields' })
      .optional(),
  })
  .strict();

/**
 * A note's status from a phone: `draft` is the reopen (lifecycle 4.4); `completed`, an old build's
 * Complete, is kept in history, since a note is finished only by a sign-off (4.6).
 */
const Status = z.enum(['draft', 'completed']);

/**
 * The settable fields of an encounter and of a note. An encounter's status is not one: the database
 * works it out from the visit's notes (lifecycle 2.2, 4.3), so a set of it answers as any unknown
 * field does. Its kind takes `non_medical` too, so a move back is kept in history, not refused.
 */
export function fieldSchema(entity: 'encounter' | 'encounter_note', field: string): z.ZodType | null {
  if (entity === 'encounter') {
    if (field === 'patientId') return Uuid.nullable();
    if (field === 'location') return Location.nullable();
    if (field === 'locationText') return LocationText.nullable();
    if (field === 'summary') return Summary.nullable();
    if (field === 'kind') return EncounterKind;
    return null;
  }
  if (field === 'status') return Status;
  if (field.startsWith('data.') && DATA_PATH.test(field.slice(5))) return JsonValue;
  return null;
}

export interface FieldMeta {
  by: string;
  at: string;
  changeId: string | null;
}

export interface StoredRecord {
  entity: AnyRecordEntityName;
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  /** The patient the record is about, as stored (a merged one included); its own ID for a patient. */
  patientId: string | null;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  /** Current values of the settable fields, by field name. */
  values: Record<string, unknown>;
  /** Set at creation, never changed: shown in a snapshot. */
  attributes: Record<string, unknown>;
  /** What the entity's rules need and a snapshot never shows (a patient's canonical ID). */
  internal: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

export function fieldState(record: StoredRecord, field: string): FieldStateValue {
  const meta = record.fieldMeta[field];
  return {
    value: record.values[field] ?? null,
    version: record.fieldVersions[field] ?? 0,
    changedBy: meta?.by ?? null,
    changedAt: meta?.at ?? null,
  };
}

export function snapshot(record: StoredRecord): RecordSnapshotValue {
  const fields: Record<string, FieldStateValue> = {};
  const names = new Set([...Object.keys(record.values), ...Object.keys(record.fieldVersions)]);
  for (const name of names) fields[name] = fieldState(record, name);
  return {
    entity: record.entity,
    id: record.id,
    version: record.version,
    status: record.status,
    authorUserId: record.authorUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    attributes: record.attributes,
    fields,
  };
}

/**
 * A jsonb parameter. postgres.js encodes it exactly once; JSON text with a `::jsonb` cast would be
 * encoded twice (stored as a JSON string). Null is sent as SQL NULL, which jsonb_build_object turns
 * into a JSON null, so the key is kept.
 */
export const jsonb = (tx: Tx, v: unknown) => tx.json((v ?? null) as never);

/** The bookkeeping every field write updates: the field's version and meta, and the record's version. */
export const bookkeeping = (tx: Tx, field: string, version: number, meta: FieldMeta) => tx`
  field_versions = field_versions || jsonb_build_object(${field}::text, ${version}::int),
  field_meta = field_meta || jsonb_build_object(${field}::text, ${jsonb(tx, meta)}),
  version = version + 1`;

export interface CreateInput {
  id: string;
  teamId: string;
  authorUserId: string;
  deviceId: string;
  changeId: string;
  at: Date;
  deviceTime: Date;
  clockVerified: boolean;
}

/** Every initial field at version 1, made by this create. */
export function initialFieldState(initial: Record<string, unknown>, input: CreateInput) {
  const versions: Record<string, number> = {};
  const meta: Record<string, FieldMeta> = {};
  for (const k of Object.keys(initial)) {
    versions[k] = 1;
    meta[k] = { by: input.authorUserId, at: input.at.toISOString(), changeId: input.changeId };
  }
  return { versions, meta };
}

export type HistoryKind =
  | 'created'
  | 'set'
  | 'filled_blank'
  | 'replaced_after_review'
  | 'kept_both'
  | 'confirmed'
  | 'redirected'
  | 'cleared_by_allergy'
  | 'entered_in_error'
  /** An answer of a finished note, written by a correction (lifecycle 4.7). */
  | 'corrected';

export interface HistoryEntry {
  teamId: string;
  entity: AnyRecordEntityName;
  recordId: string;
  field: string;
  version: number;
  value: unknown;
  previousValue: unknown;
  kind: HistoryKind;
  changedBy: string;
  approvedBy: string | null;
  changeId: string | null;
  deviceId: string | null;
  deviceTime: Date | null;
  reviewId?: string | null;
}

/** Appends one history row and returns its ID (a bigint, as text), which a correction's row names. */
export async function appendHistory(tx: Tx, e: HistoryEntry): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into sineobex.field_history
      (team_id, entity, record_id, field, version, value, previous_value, kind, changed_by,
       approved_by, change_id, device_id, device_time, review_id)
    values (${e.teamId}, ${e.entity}, ${e.recordId}, ${e.field}, ${e.version}, ${jsonb(tx, e.value)},
            ${e.previousValue === undefined ? null : jsonb(tx, e.previousValue)}, ${e.kind}, ${e.changedBy},
            ${e.approvedBy}, ${e.changeId}, ${e.deviceId}, ${e.deviceTime}, ${e.reviewId ?? null})
    returning id::text as id`;
  return row!.id;
}

/**
 * A patient's record names a visit of someone else: one whose patient is outside the merged group
 * of [patientId] (lifecycle 4.7, `encounter_other_patient`). A visit that names no patient names
 * nobody else. Both exist: they were checked as parents first.
 */
export async function visitOfOtherPatient(
  tx: Tx,
  teamId: string,
  patientId: string,
  encounterId: string,
): Promise<boolean> {
  const rows = await tx`
    select 1 from sineobex.encounters e
    join sineobex.patients seen on seen.team_id = e.team_id and seen.id = e.patient_id
    join sineobex.patients named on named.team_id = e.team_id and named.id = ${patientId}
    where e.team_id = ${teamId} and e.id = ${encounterId} and seen.canonical_id <> named.canonical_id`;
  return rows.length > 0;
}

// ------------------------------------------------------------------------------------------------
// Rules that read a note type's definition
// ------------------------------------------------------------------------------------------------

/**
 * A rule could not apply the definition it reads (lifecycle 4.1): the team's row of it fails its
 * hash (D79), a note names a version the team does not hold, or the interpreter threw on it. The
 * same definition fails the same way on every retry, and a push stops at a change that throws, so
 * applyInSavepoint rolls back what the change wrote and stores it as a `definition_error`
 * rejection: the phone's queue moves on. It carries nothing of the definition or the answer.
 */
export class DefinitionError extends Error {
  constructor() {
    super('A sync rule could not apply a note type definition.');
    this.name = 'DefinitionError';
  }
}

/** Runs the interpreter for a rule (checkAnswer, effectiveAnswers, the hash): any throw is a DefinitionError. */
export function byDefinition<T>(rule: () => T): T {
  try {
    return rule();
  } catch {
    throw new DefinitionError();
  }
}

/**
 * The definition of a version the team holds, for a rule that needs it: undefined when the team
 * does not hold it, a DefinitionError when its row fails its hash. A database error is no
 * DefinitionError: it may pass on a retry, so it still stops the push.
 */
export async function definitionOf(
  tx: Tx,
  teamId: string,
  key: string,
  version: number,
): Promise<ResolvedNoteType | undefined> {
  try {
    return (await definitionFor(tx, teamId, key, version))?.definition;
  } catch (err) {
    if (err instanceof DefinitionMismatch) throw new DefinitionError();
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------
// Who may read what in a note (lifecycle 6.4)
// ------------------------------------------------------------------------------------------------

/**
 * A person as visibleAnswers reads them: their role's keys and their credential now. A Medical note
 * is read by whoever may read the problem list (D37: patients.view with encounters.chart or
 * billing.view_codes), so the CHW preset reads no clinical notes.
 */
export function noteReader(
  permissions: ReadonlySet<Permission>,
  credential: Credential,
  actsAsAuthor: boolean,
): NoteReader {
  const can = CAPABILITIES[credential];
  return {
    actsAsAuthor,
    viewSensitive: permissions.has('patients.view_sensitive'),
    viewSensitiveExams: permissions.has('patients.view_sensitive_exams'),
    readsMedical: mayViewProblems(permissions),
    chartsMedical: can.chartMedical,
    ordersMedications: can.orderMedications,
    sensitiveCodes: SENSITIVE_CODE_RANGES,
  };
}

/**
 * Whether [reader] may not see [value] as the answer at [path] of a note that holds [answers]
 * (lifecycle 5.1, 6.4): the note is one they may not read, the answer is in a section they may not
 * read (a sensitive exam, a treatment record), or, put in place, it is something visibleAnswers
 * takes out or cuts down (a sensitive exam's option, the entry of a sensitive diagnosis). A change
 * is tested with its old value and then its new one, since either would give the answer away.
 *
 * visibleAnswers gives no reader an answer that does not count, so one is told by what it would be
 * if it counted (review findings RD-5 and NOT-9): it is hidden when any answer of its entry, or
 * outside a repeating section of its section, is a sensitive diagnosis, counting or not, which
 * takes the entry or section with it (a removal takes an entry out of what counts, never out of the
 * note); or when it is itself a pick of a sensitive exam's option. Interpreter calls: callers wrap
 * this in byDefinition.
 */
export function answerHidden(
  type: ResolvedNoteType,
  answers: Record<string, unknown>,
  path: string,
  value: unknown,
  reader: NoteReader,
): boolean {
  if (reader.actsAsAuthor) return false;
  const placed = { ...answers, [path]: value };
  const seen = visibleAnswers(type, placed, reader);
  if (seen === null) return true;
  const target = fieldAt(type, path);
  const section = target?.section;
  if (section?.sensitiveExam && !reader.viewSensitiveExams) return true;
  if (section?.treatmentRecord && !(reader.viewSensitive && reader.chartsMedical)) return true;
  const counted = effectiveAnswers(type, placed);
  if (Object.hasOwn(counted, path))
    return !Object.hasOwn(seen, path) || !sameValue(seen[path], counted[path]);
  if (!target) return false;
  const scope = target.entry === null ? `${target.section.id}.` : `${target.section.id}.${target.entry}.`;
  if (!reader.viewSensitive) {
    for (const [p, v] of Object.entries(placed)) {
      if (!p.startsWith(scope) || typeof v !== 'string') continue;
      const at = fieldAt(type, p);
      if (at?.field?.kind === 'problem' && at.part === 'code' && isSensitiveCode(v, reader.sensitiveCodes))
        return true;
    }
  }
  const holds = target.holds;
  if (reader.viewSensitiveExams || holds?.type !== 'codes') return false;
  const picked = new Set(typeof value === 'string' ? [value] : Array.isArray(value) ? value : []);
  return holds.options.some((o) => o.sensitiveExam === true && picked.has(o.code));
}

// ------------------------------------------------------------------------------------------------
// Applying one change
// ------------------------------------------------------------------------------------------------

/** Whose change this is, and what they may do. */
export interface ApplyActor {
  teamId: string;
  /** The person who made the change on the phone. */
  authorId: string;
  /** Who approved it, when someone else did (a Program Admin accepting a quarantined change). */
  approvedBy: string | null;
  deviceId: string;
  /**
   * What the change may do, by catalog key (D37): each entity names the key it needs (2.2). A push
   * passes the person's role; an admin's accept the whole catalog (the accept is the approval); the
   * hand-over after removal none (it applies only activity log entries).
   */
  permissions: ReadonlySet<Permission>;
  /**
   * A push: a change refused for permission, or one that belongs to a record held for review, is
   * held for review too. An admin's accept: it fails outright.
   */
  holdForReview: boolean;
  /** The server's clock, for rules about dates (a birth date in the future). */
  now: Date;
  /** Added to every audit event, e.g. { onBehalfOf } when an admin applies someone else's change. */
  auditDetails?: Record<string, unknown>;
}

export type Outcome =
  | {
      status: 'accepted';
      serverVersion: number;
      /** The field as the server holds it, when the change was kept but not applied (2.5). */
      server?: FieldStateValue;
      details?: Record<string, unknown>;
    }
  | { status: 'rejected'; reason: RejectReasonName; details?: Record<string, unknown>; quarantined?: boolean }
  | {
      status: 'conflict';
      server: FieldStateValue;
      /** Kept on the receipt only (a redirect's survivor, so a retry shows it); never sent. */
      details?: Record<string, unknown>;
    };

export const rejected = (reason: RejectReasonName, details?: Record<string, unknown>): Outcome => ({
  status: 'rejected',
  reason,
  ...(details ? { details } : {}),
});

/** A validation rejection naming the rule it broke (`details.problem`), never a value. */
export const invalid = (problem: string, more?: Record<string, unknown>) =>
  rejected('validation', { problem, ...more });

/** A notice with no text, to one person, about a record (lifecycle 4.10). */
export async function notify(
  ctx: ChangeContext,
  userId: string,
  kind: string,
  entity: AnyRecordEntityName,
  recordId: string,
): Promise<void> {
  await ctx.tx`
    insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
    values (${ctx.actor.teamId}, ${userId}, ${kind}, ${entity}, ${recordId})`;
}

/**
 * When the server first received a change: when its push held it for review, if it was held (an
 * admin's accept applies it later), else now. signedUnder believes a time a phone stamped no more
 * than five minutes after this (lifecycle 3.5).
 */
export async function receivedAtOf(tx: Tx, changeId: string): Promise<Date> {
  const [row] = await tx<{ at: Date }[]>`
    select coalesce((select received_at from sineobex.quarantine_items where change_id = ${changeId}), now()) as at`;
  return row!.at;
}

/**
 * When the server received a record's create (lifecycle 3.5, notBefore): when its push held it for
 * review, if it was held and an admin's accept made the row later, else when the row was made
 * (review finding NOT-2).
 */
export async function createReceivedAt(
  tx: Tx,
  entity: AnyRecordEntityName,
  record: Pick<StoredRecord, 'id' | 'createdAt'>,
): Promise<Date> {
  const [row] = await tx<{ at: Date | null }[]>`
    select min(received_at) as at from sineobex.quarantine_items
    where entity = ${entity} and record_id = ${record.id} and op = 'create' and status = 'accepted'`;
  return row?.at ?? record.createdAt;
}

/** The change being applied, with what applying it needs. */
export interface ChangeContext {
  tx: Tx;
  audit: AuditFn;
  actor: ApplyActor;
  change: SyncChangeInput;
}

/** When the change happened: device time corrected by the phone's last measured offset. */
export const when = (c: SyncChangeInput) => new Date(c.correctedTime ?? c.deviceTime);

export function createInput(ctx: ChangeContext): CreateInput {
  const c = ctx.change;
  return {
    id: c.recordId,
    teamId: ctx.actor.teamId,
    authorUserId: ctx.actor.authorId,
    deviceId: ctx.actor.deviceId,
    changeId: c.changeId,
    at: when(c),
    deviceTime: new Date(c.deviceTime),
    clockVerified: c.clockVerified,
  };
}

/** A history row for this change, on [recordId] (the survivor when the change was redirected). */
export function historyOf(
  ctx: ChangeContext,
  entity: AnyRecordEntityName,
  recordId: string,
  field: string,
  version: number,
  value: unknown,
  previousValue: unknown,
  kind: HistoryKind,
): HistoryEntry {
  return {
    teamId: ctx.actor.teamId,
    entity,
    recordId,
    field,
    version,
    value,
    previousValue,
    kind,
    changedBy: ctx.actor.authorId,
    approvedBy: ctx.actor.approvedBy,
    changeId: ctx.change.changeId,
    deviceId: ctx.actor.deviceId,
    deviceTime: new Date(ctx.change.deviceTime),
  };
}

/**
 * A new record, the way every create is stored: the entity's own checks, the insert (null when
 * the ID is taken), one `created` history row per initial field, the audit event, then what the
 * entity does after (matching, an allergy clearing "No known allergies"), whose answer goes in the
 * receipt's details.
 */
export async function storeCreate(
  ctx: ChangeContext,
  entity: AnyRecordEntityName,
  steps: {
    check?: () => Promise<Outcome | null>;
    insert: (input: CreateInput) => Promise<Record<string, unknown> | null>;
    patientId: string | null;
    action: string;
    auditDetails?: Record<string, unknown>;
    after?: () => Promise<Record<string, unknown> | undefined>;
  },
): Promise<Outcome> {
  const refused = steps.check ? await steps.check() : null;
  if (refused) return refused;
  const initial = await steps.insert(createInput(ctx));
  if (!initial) return invalid('record_exists');
  const c = ctx.change;
  for (const [field, value] of Object.entries(initial)) {
    await appendHistory(ctx.tx, historyOf(ctx, entity, c.recordId, field, 1, value, undefined, 'created'));
  }
  await ctx.audit({
    action: steps.action,
    entity,
    entityId: c.recordId,
    patientId: steps.patientId,
    deviceTime: new Date(c.deviceTime),
    details: {
      ...ctx.actor.auditDetails,
      changeId: c.changeId,
      clockVerified: c.clockVerified,
      ...steps.auditDetails,
    },
  });
  const details = steps.after ? await steps.after() : undefined;
  return { status: 'accepted', serverVersion: 1, ...(details ? { details } : {}) };
}

// ------------------------------------------------------------------------------------------------
// The entity registry's contract (phase 3 design 2.2)
// ------------------------------------------------------------------------------------------------

/** How two values for one field are reconciled (design 2.4). */
export type FieldClass = 'draft' | 'keep_both' | 'identity' | 'status' | 'set_once';

/** A set sent to a merged record, applied to the survivor instead (design 2.7). */
export interface Redirect {
  to: StoredRecord;
  /** For the receipt: `redirectedTo`, and the merge that made the record merged. */
  details: { redirectedTo: string; mergeId?: string };
}

/**
 * Why a value the draft rule would write is kept in history instead (lifecycle 4.1): a rule the
 * worker cannot fix is no refusal. `notice` tells the people named, by a notice with no text.
 */
export interface KeptInstead {
  problem: string;
  notice?: { kind: string; to: readonly string[] };
}

/** The field a set applies to, and what the server knows about it. */
export interface SetContext extends ChangeContext {
  rules: EntityRules;
  /** The record the change applies to: the survivor when it was redirected. */
  rec: StoredRecord;
  field: string;
  /** The parsed value. Schemas never transform it, so it is the value the phone hashed. */
  value: unknown;
  cur: FieldStateValue;
  /** The person saw the field's current value (D9, D16). Never true for a redirected change. */
  saw: boolean;
  redirect: Redirect | null;
}

export interface EntityRules<C = unknown> {
  readonly entity: AnyRecordEntityName;
  /** Audit actions are named `${auditPrefix}.created`, `.updated` and so on. */
  readonly auditPrefix: string;
  /** The catalog key the change needs (D37); without it the change is held for review. */
  permission(op: 'create' | 'set', field?: string): Permission;
  /** A rule that also needs the record (a problem marked entered in error: its author, or an admin). */
  mayChange?(actor: ApplyActor, rec: StoredRecord, field: string): boolean;
  /**
   * Takes the team's write lock first (D32): every patient-side change, and an encounter write that
   * names a patient. Read from the value as sent, before it is checked.
   */
  takesTeamLock(change: SyncChangeInput): boolean;
  readonly create: z.ZodType<C>;
  /** A rule the parsed value breaks on its own, as a `details.problem` (values.ts valueProblem). */
  valueProblem?(
    op: 'create' | 'set',
    field: string | undefined,
    value: unknown,
    today: string,
  ): string | null;
  /** Records the create names, which must exist in the team (any status) or be held. */
  parents(value: C): ParentRef[];
  /** Records a set's value names: a problem status's encounter, an encounter's patient. */
  parentsOfSet(field: string, value: unknown): ParentRef[];
  /** Stores a create whose parents exist: storeCreate, or the whole of an ID link's handshake. */
  applyCreate(ctx: ChangeContext, value: C): Promise<Outcome>;
  fieldClass(field: string): FieldClass | null;
  fieldSchema(field: string): z.ZodType | null;
  /** `lock` takes the row FOR NO KEY UPDATE, so two changes to one record apply one after the other. */
  load(tx: Tx, id: string, lock: boolean): Promise<StoredRecord | null>;
  /** Writes one field and its version; returns the record's new version. */
  write(
    tx: Tx,
    rec: StoredRecord,
    field: string,
    value: unknown,
    version: number,
    meta: FieldMeta,
  ): Promise<number>;
  /** The record a set of [field] applies to instead: a merged patient's survivor, a merged problem's. */
  redirect?(tx: Tx, rec: StoredRecord, field: string): Promise<Redirect | null>;
  /** The status class's rule (problems, design 9.2). */
  applyStatus?(s: SetContext): Promise<Outcome>;
  /**
   * The draft rule asks it before it writes a different value: the envelope of a visit with a
   * finished note, a patient taken off a visit (lifecycle 4.3). Null: the draft rule decides.
   */
  keptInstead?(s: SetContext): Promise<KeptInstead | null>;
  /** The audit action of a write to [field], when it isn't `${auditPrefix}.updated`. */
  writeAction?(field: string): string | null;
  /** After a value reached the chart (matching re-runs on a name). */
  afterWrite?(s: SetContext): Promise<void>;
}
