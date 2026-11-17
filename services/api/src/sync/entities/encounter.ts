import type { z } from '@hono/zod-openapi';
import type { Tx } from '../../db/database.ts';
import {
  bookkeeping,
  EncounterCreate,
  fieldSchema,
  initialFieldState,
  invalid,
  jsonb,
  sameValue,
  storeCreate,
  type EntityRules,
  type FieldMeta,
  type Outcome,
  type SetContext,
  type StoredRecord,
} from '../records.ts';
import { keepInHistory, NOTHING_TO_RESOLVE, writeValue } from './fields.ts';
import { valueParents } from './values.ts';

/**
 * Encounters (phase 2, module 4). The patient they name must be a patient of the team (phase 3
 * design 2.3, migration 0013): checked as a parent of the create and of a `set patientId`, so the
 * foreign key never answers first.
 *
 * Every change takes the team lock first (phase 4 lifecycle 4.2), as every note change does. A
 * create naming a patient needs it before its foreign key check takes FOR KEY SHARE on the patient
 * row (D32). A `set patientId` holds it while it locks the encounter row; any other set locks that
 * row and then waits for the same lock at its audit event, so taking it later would deadlock the
 * two (review finding S3). And a visit's status is worked out from its notes by the trigger of
 * migration 0018: with one lock per team, its changes and its notes' apply one after the other, so
 * no rule reads a half-applied sibling.
 *
 * Its status is no longer a field: the trigger of 0018 owns the column (lifecycle 4.3). Its kind is
 * one, with a rule of its own (the `status` class, the hook a problem's status uses): it moves to
 * Medical at any time (PRD main 379) and never back.
 */

type Value = z.infer<typeof EncounterCreate>;

interface EncounterRow {
  id: string;
  teamId: string;
  status: string;
  authorUserId: string;
  version: number;
  patientId: string | null;
  location: Record<string, unknown> | null;
  locationText: string | null;
  summary: string | null;
  kind: string;
  startedAt: Date;
  startedDeviceTime: Date | null;
  clockVerified: boolean;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

export const encounterRules: EntityRules<Value> = {
  entity: 'encounter',
  auditPrefix: 'encounter',
  permission: () => 'encounters.chart',
  takesTeamLock: () => true,
  create: EncounterCreate,
  parents: (v) => valueParents('encounter', 'create', undefined, v),
  parentsOfSet: (field, v) => valueParents('encounter', 'set', field, v),

  applyCreate: (ctx, value) =>
    storeCreate(ctx, 'encounter', {
      insert: async (input) => {
        const initial: Record<string, unknown> = {
          patientId: value.patientId ?? null,
          location: value.location ?? null,
          locationText: value.locationText ?? null,
          kind: value.kind,
        };
        const { versions, meta } = initialFieldState(initial, input);
        const rows = await ctx.tx`
          insert into sineobex.encounters
            (id, team_id, patient_id, kind, status, author_user_id, started_at, started_device_time,
             clock_verified, location, location_text, created_device_id, field_versions, field_meta)
          values (${input.id}, ${input.teamId}, ${initial.patientId as string | null}, ${value.kind}, 'draft',
                  ${input.authorUserId}, ${input.at}, ${input.deviceTime}, ${input.clockVerified},
                  ${jsonb(ctx.tx, initial.location)}, ${initial.locationText as string | null}, ${input.deviceId},
                  ${jsonb(ctx.tx, versions)}, ${jsonb(ctx.tx, meta)})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : initial;
      },
      patientId: value.patientId ?? null,
      action: 'encounter.created',
    }),

  fieldClass: (field) => (field === 'kind' ? 'status' : fieldSchema('encounter', field) ? 'draft' : null),
  fieldSchema: (field) => fieldSchema('encounter', field),
  applyStatus: kindSet,
  load: loadEncounter,

  async write(tx, rec, field, value, version, meta) {
    const set =
      field === 'patientId'
        ? tx`patient_id = ${value as string | null}`
        : field === 'location'
          ? tx`location = ${jsonb(tx, value)}`
          : field === 'locationText'
            ? tx`location_text = ${value as string | null}`
            : field === 'summary'
              ? tx`summary = ${value as string | null}`
              : tx`kind = ${value as string}`;
    const rows = await tx<{ version: number }[]>`
      update sineobex.encounters set ${set}, ${bookkeeping(tx, field, version, meta)}
      where id = ${rec.id} returning version`;
    return rows[0]!.version;
  },
};

/**
 * A visit's kind goes from Non-Medical to Medical at any time, finished notes or not, and never back
 * (lifecycle 3.10, 4.3). It moves one way only, so a switch never conflicts: it applies from any
 * version. A move back is kept in history and not applied, since the worker has nothing to fix.
 */
async function kindSet(s: SetContext): Promise<Outcome> {
  if (s.change.resolution) return invalid(NOTHING_TO_RESOLVE);
  if (sameValue(s.cur.value, s.value)) return { status: 'accepted', serverVersion: s.cur.version };
  if (s.value !== 'medical') return keepInHistory(s, { problem: 'kind_cannot_go_back' });
  return writeValue(s, 'set');
}

/**
 * Loads an encounter; `lock` takes FOR NO KEY UPDATE, so two phones changing it are applied one
 * after the other, while a problem or allergy naming it (whose foreign key check takes FOR KEY
 * SHARE under the team lock) never waits on a change that will wait for that lock in turn.
 */
export async function loadEncounter(tx: Tx, id: string, lock: boolean): Promise<StoredRecord | null> {
  const rows = lock
    ? await tx<EncounterRow[]>`select * from sineobex.encounters where id = ${id} for no key update`
    : await tx<EncounterRow[]>`select * from sineobex.encounters where id = ${id}`;
  const r = rows[0];
  if (!r) return null;
  return {
    entity: 'encounter',
    id: r.id,
    teamId: r.teamId,
    status: r.status,
    authorUserId: r.authorUserId,
    version: r.version,
    patientId: r.patientId,
    // Encounters from before phase 4 still carry the bookkeeping of a status field; it is no field now.
    fieldVersions: withoutStatus(r.fieldVersions),
    fieldMeta: withoutStatus(r.fieldMeta),
    values: {
      patientId: r.patientId,
      location: r.location,
      locationText: r.locationText,
      summary: r.summary,
      kind: r.kind,
    },
    attributes: {
      startedAt: r.startedAt.toISOString(),
      startedDeviceTime: r.startedDeviceTime?.toISOString() ?? null,
      clockVerified: r.clockVerified,
    },
    internal: {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function withoutStatus<T>(byField: Record<string, T>): Record<string, T> {
  const { status: _, ...rest } = byField;
  return rest;
}
