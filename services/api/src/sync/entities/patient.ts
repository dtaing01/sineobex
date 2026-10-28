import type { Tx } from '../../db/database.ts';
import { rematchPatient } from '../../patients/duplicates.ts';
import {
  bookkeeping,
  initialFieldState,
  invalid,
  jsonb,
  storeCreate,
  type EntityRules,
  type FieldMeta,
  type StoredRecord,
} from '../records.ts';
import { patientFieldSchema, PatientCreate, valueProblem, type PatientCreateValue } from './values.ts';

/**
 * Patients (module 2; phase 3 design 2.3). A create is an intake: the row, canonical to itself,
 * with its two consent decisions, then the server's re-run of duplicate matching under the team
 * lock already held, so a concurrent intake of the same person is always seen (D32, design 8.2).
 * Demographics keep both values when two people disagree; legal name and birth are identity
 * fields (2.4). A set naming a merged patient applies to its survivor (2.7).
 */

const IDENTITY_FIELDS = new Set(['legalName', 'birth']);
/** A change to one of these re-runs matching ('edit', design 8.2). */
const MATCHED_FIELDS = new Set(['preferredName', 'legalName', 'birth']);

interface PatientRow {
  id: string;
  teamId: string;
  status: 'active' | 'merged';
  mergedInto: string | null;
  canonicalId: string;
  preferredName: string | null;
  legalGivenName: string | null;
  legalFamilyName: string | null;
  visualDescriptor: string | null;
  birthPrecision: 'day' | 'year' | 'estimated' | null;
  birthDate: string | null;
  birthYear: number | null;
  livingSituation: string | null;
  livingSituationOther: string | null;
  usualArea: string | null;
  preferredLanguage: string | null;
  allergyScreen: string;
  idCardChoice: string;
  registeredAt: Date;
  clockVerified: boolean;
  authorUserId: string;
  version: number;
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
  createdAt: Date;
  updatedAt: Date;
}

/** The sync fields of a row, as the phone sends and receives them. */
function patientValues(r: PatientRow): Record<string, unknown> {
  return {
    preferredName: r.preferredName,
    legalName:
      r.legalGivenName === null && r.legalFamilyName === null
        ? null
        : { given: r.legalGivenName, family: r.legalFamilyName },
    visualDescriptor: r.visualDescriptor,
    birth:
      r.birthPrecision === null
        ? null
        : r.birthPrecision === 'day'
          ? { precision: 'day', date: r.birthDate }
          : { precision: r.birthPrecision, year: r.birthYear },
    livingSituation:
      r.livingSituation === null
        ? null
        : r.livingSituationOther === null
          ? { kind: r.livingSituation }
          : { kind: r.livingSituation, other: r.livingSituationOther },
    usualArea: r.usualArea,
    preferredLanguage: r.preferredLanguage,
    allergyScreen: r.allergyScreen,
    idCardChoice: r.idCardChoice,
  };
}

/** Loads a patient record (merged or not); `lock` takes it FOR NO KEY UPDATE, as merges do (D32). */
export async function loadPatient(tx: Tx, id: string, lock: boolean): Promise<StoredRecord | null> {
  const rows = await tx<PatientRow[]>`
    select id, team_id, status, merged_into, canonical_id, preferred_name, legal_given_name,
           legal_family_name, visual_descriptor, birth_precision, birth_date::text as birth_date, birth_year,
           living_situation, living_situation_other, usual_area, preferred_language, allergy_screen,
           id_card_choice, registered_at, clock_verified, author_user_id, version, field_versions,
           field_meta, created_at, updated_at
    from sineobex.patients where id = ${id}
    ${lock ? tx`for no key update` : tx``}`;
  const r = rows[0];
  if (!r) return null;
  return {
    entity: 'patient',
    id: r.id,
    teamId: r.teamId,
    status: r.status,
    authorUserId: r.authorUserId,
    version: r.version,
    patientId: r.id,
    fieldVersions: r.fieldVersions,
    fieldMeta: r.fieldMeta,
    values: patientValues(r),
    attributes: { registeredAt: r.registeredAt.toISOString(), clockVerified: r.clockVerified },
    internal: { canonicalId: r.canonicalId, mergedInto: r.mergedInto },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** The patient's group: itself when active, its survivor when merged. Null when the team has none. */
export async function canonicalOf(tx: Tx, patientId: string): Promise<string | null> {
  const [row] = await tx<{ canonicalId: string }[]>`
    select canonical_id from sineobex.patients where id = ${patientId}`;
  return row?.canonicalId ?? null;
}

type Birth = { precision: 'day'; date: string } | { precision: 'year' | 'estimated'; year: number } | null;
type LegalName = { given: string | null; family: string | null } | null;
type Living = { kind: string; other?: string } | null;

/** The columns one sync field is stored in. */
function columns(tx: Tx, field: string, value: unknown) {
  switch (field) {
    case 'preferredName':
      return tx`preferred_name = ${value as string | null}`;
    case 'visualDescriptor':
      return tx`visual_descriptor = ${value as string | null}`;
    case 'usualArea':
      return tx`usual_area = ${value as string | null}`;
    case 'preferredLanguage':
      return tx`preferred_language = ${value as string | null}`;
    case 'allergyScreen':
      return tx`allergy_screen = ${value as string}`;
    case 'idCardChoice':
      return tx`id_card_choice = ${value as string}`;
    case 'legalName': {
      const v = value as LegalName;
      return tx`legal_given_name = ${v?.given ?? null}, legal_family_name = ${v?.family ?? null}`;
    }
    case 'birth': {
      const v = value as Birth;
      return tx`birth_precision = ${v?.precision ?? null},
                birth_date = ${v?.precision === 'day' ? v.date : null}::date,
                birth_year = ${v ? (v.precision === 'day' ? Number(v.date.slice(0, 4)) : v.year) : null}`;
    }
    case 'livingSituation': {
      const v = value as Living;
      return tx`living_situation = ${v?.kind ?? null}, living_situation_other = ${v?.other ?? null}`;
    }
  }
  throw new Error('a patient write named an unknown field');
}

export async function writePatient(
  tx: Tx,
  rec: StoredRecord,
  field: string,
  value: unknown,
  version: number,
  meta: FieldMeta,
): Promise<number> {
  const rows = await tx<{ version: number }[]>`
    update sineobex.patients set ${columns(tx, field, value)}, ${bookkeeping(tx, field, version, meta)}
    where id = ${rec.id} returning version`;
  return rows[0]!.version;
}

export const patientRules: EntityRules<PatientCreateValue> = {
  entity: 'patient',
  auditPrefix: 'patient',
  permission: () => 'patients.edit',
  takesTeamLock: () => true,
  create: PatientCreate,
  valueProblem: (op, field, value, today) => valueProblem('patient', op, field, value, today),
  parents: () => [],
  parentsOfSet: () => [],

  applyCreate(ctx, v) {
    const { tx, change: c } = ctx;
    const birth = v.birth ?? null;
    return storeCreate(ctx, 'patient', {
      // The two consent decisions are rows of their own, with the IDs the phone made.
      check: async () => {
        if (v.consent.id === v.privacyNotice.id) return invalid('record_exists');
        const taken = await tx`
          select 1 from sineobex.patient_consents where id in (${v.consent.id}, ${v.privacyNotice.id})`;
        return taken.length > 0 ? invalid('record_exists') : null;
      },
      insert: async (input) => {
        const initial: Record<string, unknown> = {
          preferredName: v.preferredName ?? null,
          legalName: v.legalName ?? null,
          visualDescriptor: v.visualDescriptor ?? null,
          birth,
          livingSituation: v.livingSituation ?? null,
          usualArea: v.usualArea ?? null,
          preferredLanguage: v.preferredLanguage ?? null,
          allergyScreen: v.allergyScreen ?? 'not_asked',
          idCardChoice: v.idCardChoice ?? 'not_asked',
        };
        const { versions, meta } = initialFieldState(initial, input);
        const rows = await tx`
          insert into sineobex.patients (id, team_id, canonical_id, preferred_name, legal_given_name,
            legal_family_name, visual_descriptor, birth_precision, birth_date, birth_year, living_situation,
            living_situation_other, usual_area, preferred_language, allergy_screen, id_card_choice,
            last_seen_at, registered_at, clock_verified, author_user_id, created_device_id, field_versions,
            field_meta)
          values (${input.id}, ${input.teamId}, ${input.id}, ${v.preferredName ?? null},
            ${v.legalName?.given ?? null}, ${v.legalName?.family ?? null}, ${v.visualDescriptor ?? null},
            ${birth?.precision ?? null}, ${birth?.precision === 'day' ? birth.date : null}::date,
            ${birth ? (birth.precision === 'day' ? Number(birth.date.slice(0, 4)) : birth.year) : null},
            ${v.livingSituation?.kind ?? null}, ${v.livingSituation?.other ?? null}, ${v.usualArea ?? null},
            ${v.preferredLanguage ?? null}, ${initial.allergyScreen as string}, ${initial.idCardChoice as string},
            ${input.at}, ${input.at}, ${input.clockVerified}, ${input.authorUserId}, ${input.deviceId},
            ${jsonb(tx, versions)}, ${jsonb(tx, meta)})
          on conflict (id) do nothing
          returning id`;
        if (rows.length === 0) return null;
        // PLAN-OPEN: consent wording and method (design 14.1, #1). The privacy notice is offered
        // in the same conversation, so it is recorded with the consent's method, script and language.
        const consent = v.consent;
        const notice = v.privacyNotice;
        await tx`
          insert into sineobex.patient_consents (id, team_id, patient_id, kind, decision, method, script_version,
            language, reason, recorded_by, recorded_at, clock_verified, device_id, change_id)
          values (${consent.id}, ${input.teamId}, ${input.id}, 'care_and_record', ${consent.decision},
                  ${consent.method}, ${consent.scriptVersion}, ${consent.language}, ${consent.reason ?? null},
                  ${input.authorUserId}, ${input.at}, ${input.clockVerified}, ${input.deviceId}, ${input.changeId}),
                 (${notice.id}, ${input.teamId}, ${input.id}, 'privacy_notice', ${notice.decision},
                  ${consent.method}, ${consent.scriptVersion}, ${consent.language}, ${notice.reason ?? null},
                  ${input.authorUserId}, ${input.at}, ${input.clockVerified}, ${input.deviceId}, ${input.changeId})`;
        return initial;
      },
      patientId: c.recordId,
      action: 'patient.created',
      auditDetails: { matchCheckId: v.matchCheck?.checkId ?? null },
      // The server sees legal names, sound-alikes and patients the phone's index lacks. A pair
      // flagged against someone the creator wasn't shown is worth telling them about.
      after: async () => {
        const matched = await rematchPatient(tx, ctx.audit, c.recordId, 'sync', {
          shown: v.matchCheck?.shown ?? [],
          dismissed: v.matchCheck?.dismissed ?? [],
        });
        return matched.possibleDuplicate ? { possibleDuplicate: true } : undefined;
      },
    });
  },

  fieldClass: (field) =>
    patientFieldSchema('patient', field) ? (IDENTITY_FIELDS.has(field) ? 'identity' : 'keep_both') : null,
  fieldSchema: (field) => patientFieldSchema('patient', field),
  load: loadPatient,
  write: writePatient,

  async redirect(tx, rec) {
    if (rec.status !== 'merged') return null;
    const to = await loadPatient(tx, rec.internal.canonicalId as string, true);
    const [merge] = await tx<{ id: string }[]>`
      select id from sineobex.patient_merges
      where team_id = ${rec.teamId} and merged_id = ${rec.id} and undone_at is null`;
    return { to: to!, details: { redirectedTo: to!.id, ...(merge ? { mergeId: merge.id } : {}) } };
  },

  async afterWrite(s) {
    if (MATCHED_FIELDS.has(s.field)) await rematchPatient(s.tx, s.audit, s.rec.id, 'edit');
  },
};
