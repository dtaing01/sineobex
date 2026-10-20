import { z } from '@hono/zod-openapi';
import type { Tx } from '../db/database.ts';
import { Uuid } from '../routes/schemas.ts';
import { canonicalJson } from './canonical.ts';
import type { FieldStateValue, RecordEntityName, RecordSnapshotValue } from './schemas.ts';

/**
 * The synced records of phase 2 and how their fields are stored. Every settable field carries
 * its own version and who last changed it, so two people can edit one draft field by field.
 * Phase 4 replaces the open `data.<path>` rule with the team's versioned note type definitions.
 */

/** Largest canonical JSON for one value. Photos travel separately (module 8). */
export const MAX_VALUE_BYTES = 64 * 1024;

/**
 * Data fields one note may have. Each field is its own history row, version and meta entry, so
 * without a bound one 1 MB push could write ~100,000 permanent history rows.
 */
export const MAX_NOTE_FIELDS = 300;
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

const JsonValue = z.unknown().superRefine((v, ctx) => {
  const p = jsonProblem(v);
  if (p) ctx.addIssue({ code: 'custom', message: p });
});

export const EncounterCreate = z
  .object({
    kind: z.enum(['medical', 'non_medical']),
    patientId: Uuid.nullable().optional(),
    location: Location.nullable().optional(),
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

/** Draft and Complete are set by sync; Signed comes only through signing (phase 4). */
const Status = z.enum(['draft', 'completed']);

export function fieldSchema(entity: RecordEntityName, field: string): z.ZodType | null {
  if (entity === 'encounter') {
    if (field === 'patientId') return Uuid.nullable();
    if (field === 'location') return Location.nullable();
    if (field === 'status') return Status;
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
  entity: RecordEntityName;
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  patientId: string | null;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  /** Current values of the settable fields, by field name. */
  values: Record<string, unknown>;
  attributes: Record<string, unknown>;
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

export function isLocked(record: StoredRecord): boolean {
  return record.status === 'signed';
}

interface EncounterRow {
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  patientId: string | null;
  location: Record<string, unknown> | null;
  kind: string;
  startedAt: Date;
  startedDeviceTime: Date | null;
  clockVerified: boolean;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

interface NoteRow {
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  encounterId: string;
  noteTypeKey: string;
  noteTypeVersion: number | null;
  data: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
  patientId: string | null;
}

/**
 * Loads a record; `lock` takes a row lock so two phones changing the same record are applied
 * one after the other and each sees the other's version.
 */
export async function loadRecord(
  tx: Tx,
  entity: RecordEntityName,
  id: string,
  lock: boolean,
): Promise<StoredRecord | null> {
  if (entity === 'encounter') {
    const rows = lock
      ? await tx<EncounterRow[]>`select * from sineobex.encounters where id = ${id} for update`
      : await tx<EncounterRow[]>`select * from sineobex.encounters where id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity,
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      authorUserId: r.authorUserId,
      version: r.version,
      patientId: r.patientId,
      fieldVersions: r.fieldVersions,
      fieldMeta: r.fieldMeta,
      values: { patientId: r.patientId, location: r.location, status: r.status },
      attributes: {
        kind: r.kind,
        startedAt: r.startedAt.toISOString(),
        startedDeviceTime: r.startedDeviceTime?.toISOString() ?? null,
        clockVerified: r.clockVerified,
      },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
  const rows = lock
    ? await tx<NoteRow[]>`
        select n.*, e.patient_id from sineobex.encounter_notes n
        join sineobex.encounters e on e.id = n.encounter_id where n.id = ${id} for update of n`
    : await tx<NoteRow[]>`
        select n.*, e.patient_id from sineobex.encounter_notes n
        join sineobex.encounters e on e.id = n.encounter_id where n.id = ${id}`;
  const r = rows[0];
  if (!r) return null;
  const values: Record<string, unknown> = { status: r.status };
  for (const [k, v] of Object.entries(r.data)) values[`data.${k}`] = v;
  return {
    entity,
    id: r.id,
    teamId: r.teamId,
    status: r.status,
    authorUserId: r.authorUserId,
    version: r.version,
    patientId: r.patientId,
    fieldVersions: r.fieldVersions,
    fieldMeta: r.fieldMeta,
    values,
    attributes: {
      encounterId: r.encounterId,
      noteTypeKey: r.noteTypeKey,
      noteTypeVersion: r.noteTypeVersion,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
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

/** Inserts a new encounter; returns the initial field values, or null if the ID is taken. */
export async function insertEncounter(
  tx: Tx,
  input: CreateInput,
  value: z.infer<typeof EncounterCreate>,
): Promise<Record<string, unknown> | null> {
  const initial: Record<string, unknown> = {
    patientId: value.patientId ?? null,
    location: value.location ?? null,
    status: 'draft',
  };
  const { versions, meta } = initialFieldState(initial, input);
  const rows = await tx`
    insert into sineobex.encounters
      (id, team_id, patient_id, kind, status, author_user_id, started_at, started_device_time,
       clock_verified, location, created_device_id, field_versions, field_meta)
    values (${input.id}, ${input.teamId}, ${initial.patientId as string | null}, ${value.kind}, 'draft',
            ${input.authorUserId}, ${input.at}, ${input.deviceTime}, ${input.clockVerified},
            ${jsonb(tx, initial.location)}, ${input.deviceId}, ${jsonb(tx, versions)}, ${jsonb(tx, meta)})
    on conflict (id) do nothing
    returning id`;
  return rows.length === 0 ? null : initial;
}

export async function insertNote(
  tx: Tx,
  input: CreateInput,
  value: z.infer<typeof NoteCreate>,
): Promise<Record<string, unknown> | null> {
  const data = value.data ?? {};
  const initial: Record<string, unknown> = { status: 'draft' };
  for (const [k, v] of Object.entries(data)) initial[`data.${k}`] = v;
  const { versions, meta } = initialFieldState(initial, input);
  const rows = await tx`
    insert into sineobex.encounter_notes
      (id, team_id, encounter_id, note_type_key, note_type_version, status, author_user_id, data,
       field_versions, field_meta)
    values (${input.id}, ${input.teamId}, ${value.encounterId}, ${value.noteTypeKey},
            ${value.noteTypeVersion ?? null}, 'draft', ${input.authorUserId}, ${jsonb(tx, data)},
            ${jsonb(tx, versions)}, ${jsonb(tx, meta)})
    on conflict (id) do nothing
    returning id`;
  return rows.length === 0 ? null : initial;
}

function initialFieldState(initial: Record<string, unknown>, input: CreateInput) {
  const versions: Record<string, number> = {};
  const meta: Record<string, FieldMeta> = {};
  for (const k of Object.keys(initial)) {
    versions[k] = 1;
    meta[k] = { by: input.authorUserId, at: input.at.toISOString(), changeId: input.changeId };
  }
  return { versions, meta };
}

/** Writes one field and its version; returns the record's new version. */
export async function writeField(
  tx: Tx,
  record: StoredRecord,
  field: string,
  value: unknown,
  version: number,
  meta: FieldMeta,
): Promise<number> {
  const bookkeeping = tx`
    field_versions = field_versions || jsonb_build_object(${field}::text, ${version}::int),
    field_meta = field_meta || jsonb_build_object(${field}::text, ${jsonb(tx, meta)}),
    version = version + 1`;
  let rows: { version: number }[];
  if (field === 'status' && record.entity === 'encounter') {
    rows = await tx`update sineobex.encounters set status = ${value as string}, ${bookkeeping}
      where id = ${record.id} returning version`;
  } else if (field === 'status') {
    rows = await tx`update sineobex.encounter_notes set status = ${value as string}, ${bookkeeping}
      where id = ${record.id} returning version`;
  } else if (record.entity === 'encounter' && field === 'patientId') {
    rows = await tx`update sineobex.encounters set patient_id = ${value as string | null}, ${bookkeeping}
      where id = ${record.id} returning version`;
  } else if (record.entity === 'encounter' && field === 'location') {
    rows = await tx`update sineobex.encounters set location = ${jsonb(tx, value)}, ${bookkeeping}
      where id = ${record.id} returning version`;
  } else if (record.entity === 'encounter_note' && field.startsWith('data.')) {
    rows = await tx`update sineobex.encounter_notes
      set data = data || jsonb_build_object(${field.slice(5)}::text, ${jsonb(tx, value)}), ${bookkeeping}
      where id = ${record.id} returning version`;
  } else {
    throw new Error('writeField called with an unknown field');
  }
  return rows[0]!.version;
}

export interface HistoryEntry {
  teamId: string;
  entity: RecordEntityName;
  recordId: string;
  field: string;
  version: number;
  value: unknown;
  previousValue: unknown;
  kind: 'created' | 'set' | 'filled_blank' | 'replaced_after_review' | 'kept_both';
  changedBy: string;
  approvedBy: string | null;
  changeId: string | null;
  deviceId: string | null;
  deviceTime: Date | null;
}

export async function appendHistory(tx: Tx, e: HistoryEntry): Promise<void> {
  await tx`
    insert into sineobex.field_history
      (team_id, entity, record_id, field, version, value, previous_value, kind, changed_by,
       approved_by, change_id, device_id, device_time)
    values (${e.teamId}, ${e.entity}, ${e.recordId}, ${e.field}, ${e.version}, ${jsonb(tx, e.value)},
            ${e.previousValue === undefined ? null : jsonb(tx, e.previousValue)}, ${e.kind}, ${e.changedBy},
            ${e.approvedBy}, ${e.changeId}, ${e.deviceId}, ${e.deviceTime})`;
}
