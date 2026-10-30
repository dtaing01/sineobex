import { z } from '@hono/zod-openapi';
import { recognisableCreate } from '../../patients/recognisable.ts';
import { Uuid } from '../../routes/schemas.ts';
import type { AnyRecordEntityName, PatientEntityName } from '../schemas.ts';

/**
 * The values patient-side changes carry (phase 3 design 2.1 and 2.8). Not OpenAPI components:
 * values travel as `value: unknown`, as EncounterCreate does. The phone mirrors these in
 * lib/sync/entities.dart, and packages/contract/test-vectors/sync-values.json pins both, and the
 * phone's fake server, to each other.
 *
 * Schemas validate and never transform (review finding 21). The apply path stores the parsed
 * value while the receipt confirms the hash of the value the phone sent, so a `.trim()` here would
 * store a different string than the one confirmed. A string with leading or trailing whitespace
 * is refused instead, and the phone trims every text input before it builds and hashes the value.
 * Every object is strict, an empty string is refused, and null clears a field where allowed.
 *
 * Rules that need more than one field and a date are `valueProblem` (a named `details.problem`);
 * rules that need the chart are the entity modules'.
 */

const Trimmed = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => s === s.trim(), { message: 'untrimmed' });

const Name80 = Trimmed(1, 80);
const Text200 = Trimmed(1, 200);
/** The routes' shared Reason trims (a transform), so sync values use this. */
const SyncReason = Trimmed(3, 300);

/** A real calendar date, YYYY-MM-DD. */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, { message: 'not_a_date' });
const LanguageTag = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
const ScriptVersion = z.string().regex(/^[a-z0-9_.-]{1,40}$/);

/** Earliest birth date and year stored (patients_birth checks in 0009). */
export const BIRTH_MIN_DATE = '1900-01-01';
export const BIRTH_MIN_YEAR = 1900;

export const LegalName = z
  .object({ given: Name80.nullable(), family: Name80.nullable() })
  .strict()
  .refine((v) => v.given !== null || v.family !== null, { message: 'empty_legal_name' });

/** The upper bound (not after server today plus one day, not after this year) is `birth_in_future`. */
export const Birth = z.discriminatedUnion('precision', [
  z
    .object({
      precision: z.literal('day'),
      date: IsoDate.refine((d) => d >= BIRTH_MIN_DATE, { message: 'before_1900' }),
    })
    .strict(),
  z.object({ precision: z.literal('year'), year: z.number().int().min(BIRTH_MIN_YEAR) }).strict(),
  // From an age ("about 46"): matched loosely and refined only within ESTIMATE_RANGE (design 2.4).
  z.object({ precision: z.literal('estimated'), year: z.number().int().min(BIRTH_MIN_YEAR) }).strict(),
]);

// PLAN-OPEN: living situation options (design 14.1, #2): the ten of 11.4 until the Google Doc
// Contents tab confirms them. "Doubled up" became couch_surfing (Oct 19).
export const LIVING_SITUATIONS = [
  'unsheltered',
  'vehicle',
  'emergency_shelter',
  'transitional_housing',
  'couch_surfing',
  'hotel_motel',
  'housed',
  'institution',
  'unknown',
  'other',
] as const;

/** `other` is required exactly when kind is 'other' (`living_other_text`). */
export const LivingSituation = z
  .object({ kind: z.enum(LIVING_SITUATIONS), other: Text200.optional() })
  .strict();

const needsReason = (decision: string) => decision === 'unable' || decision === 'not_offered';
const reasonRequired = (v: { decision: string; reason?: string }, ctx: z.RefinementCtx) => {
  if (needsReason(v.decision) && v.reason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' });
  }
};

// PLAN-OPEN: consent wording, whether verbal suffices, minors and withdrawal (design 14.1, #1):
// verbal or written consent, or "unable" with a reason; "declines" creates no record.
export const RegistrationConsent = z
  .object({
    id: Uuid,
    decision: z.enum(['given', 'unable']),
    method: z.enum(['verbal', 'written', 'not_applicable']),
    reason: SyncReason.optional(),
    scriptVersion: ScriptVersion,
    language: LanguageTag,
  })
  .strict()
  .superRefine(reasonRequired);

/** Recorded with the registration consent's script version and language; never blocking. */
export const PrivacyNotice = z
  .object({
    id: Uuid,
    decision: z.enum(['acknowledged', 'declined', 'unable', 'not_offered']),
    reason: SyncReason.optional(),
  })
  .strict()
  .superRefine(reasonRequired);

/** What the person saw at intake, so the server's re-run knows what they dismissed (design 8.1). */
export const MatchCheck = z
  .object({
    checkId: Uuid,
    where: z.enum(['phone', 'server', 'both']),
    indexVersion: z.string().max(40).nullable(),
    shown: z.array(Uuid).max(10),
    dismissed: z.array(Uuid).max(10),
  })
  .strict();

export const ALLERGY_SCREENS = ['not_asked', 'none_known'] as const;
export const ID_CARD_CHOICES = ['not_asked', 'wants', 'declined'] as const;

export const PatientCreate = z
  .object({
    preferredName: Name80.nullable().optional(),
    legalName: LegalName.nullable().optional(),
    visualDescriptor: Text200.nullable().optional(),
    birth: Birth.nullable().optional(),
    livingSituation: LivingSituation.nullable().optional(),
    usualArea: Text200.nullable().optional(),
    preferredLanguage: LanguageTag.nullable().optional(),
    allergyScreen: z.enum(ALLERGY_SCREENS).optional(),
    idCardChoice: z.enum(ID_CARD_CHOICES).optional(),
    consent: RegistrationConsent,
    privacyNotice: PrivacyNotice,
    matchCheck: MatchCheck.optional(),
  })
  .strict();
export type PatientCreateValue = z.infer<typeof PatientCreate>;

export const AliasCreate = z.object({ patientId: Uuid, alias: Trimmed(1, 60) }).strict();

export const ALLERGY_CATEGORIES = ['drug', 'food', 'environment', 'other', 'unknown'] as const;
export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe', 'unknown'] as const;

export const AllergyCreate = z
  .object({
    patientId: Uuid,
    substance: Trimmed(1, 120),
    category: z.enum(ALLERGY_CATEGORIES).optional(),
    reaction: Text200.nullable().optional(),
    severity: z.enum(ALLERGY_SEVERITIES).optional(),
    encounterId: Uuid.nullable().optional(),
  })
  .strict();

/** A later consent decision (Record consent now), or a privacy notice offered again. */
export const ConsentCreate = z.discriminatedUnion('kind', [
  z
    .object({
      patientId: Uuid,
      kind: z.literal('care_and_record'),
      decision: z.enum(['given', 'unable']),
      method: z.enum(['verbal', 'written', 'not_applicable']),
      scriptVersion: ScriptVersion,
      language: LanguageTag,
      reason: SyncReason.optional(),
    })
    .strict()
    .superRefine(reasonRequired),
  z
    .object({
      patientId: Uuid,
      kind: z.literal('privacy_notice'),
      decision: z.enum(['acknowledged', 'declined', 'unable', 'not_offered']),
      method: z.enum(['verbal', 'written', 'not_applicable']),
      scriptVersion: ScriptVersion,
      language: LanguageTag,
      reason: SyncReason.optional(),
    })
    .strict()
    .superRefine(reasonRequired),
]);

/** ICD-10-CM, checked by shape only, so a code-set update never becomes a sync rejection (9.5). */
export const ICD10CM_CODE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

export const ProblemCode = z
  .object({
    system: z.literal('icd10cm'),
    code: z.string().regex(ICD10CM_CODE),
    display: Trimmed(1, 300).optional(),
  })
  .strict();

export const ProblemCreate = z
  .object({
    patientId: Uuid,
    title: Text200,
    code: ProblemCode.nullable().optional(),
    status: z.enum(['new', 'ongoing']),
    sensitive: z.boolean().optional(),
    encounterId: Uuid.nullable().optional(),
    onsetDate: IsoDate.nullable().optional(),
    recurrenceOf: Uuid.optional(),
    resolvedInErrorOf: Uuid.optional(),
  })
  .strict()
  .refine((v) => v.recurrenceOf === undefined || v.resolvedInErrorOf === undefined, {
    path: ['resolvedInErrorOf'],
    message: 'one_origin_only',
  });

export const PROBLEM_STATUSES = ['new', 'ongoing', 'resolved'] as const;

export const ProblemStatusValue = z
  .object({ status: z.enum(PROBLEM_STATUSES), encounterId: Uuid.nullable() })
  .strict();

export const ProblemNoteCreate = z
  .object({ problemId: Uuid, text: Trimmed(1, 4000), encounterId: Uuid.nullable().optional() })
  .strict();

export const ID_LINK_TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const ID_LINK_REASONS = [
  'first_card',
  'lost',
  'damaged',
  'stolen',
  'patient_request',
  'other',
] as const;

export const IdLinkCreate = z
  .object({
    patientId: Uuid,
    token: z.string().regex(ID_LINK_TOKEN),
    replacesLinkId: Uuid.nullable(),
    reason: z.enum(ID_LINK_REASONS),
  })
  .strict();

/** Alias removal, allergy or problem entered in error: set once, with a reason. */
export const Retraction = z.object({ reason: SyncReason }).strict();

/** Most patients one offline audit entry may list: Show more displays up to SEARCH_MAX (50). */
export const AUDIT_MAX_PATIENTS = 50;

/**
 * Offline reads, logged on the phone and appended to the audit chain at sync (design 2.8). Search
 * text never enters an entry, online or offline (D41): only the criteria used.
 */
// PLAN-OPEN: search terms in the audit log (design 14.1, #9, for counsel). Never stored; if counsel
// wants them, a separate restricted column with its own retention, never `details`.
export const AuditAppend = z
  .object({
    action: z.enum([
      'patient.viewed',
      'patient.searched',
      'patient.match_checked',
      'id_link.copied',
      'encounter.viewed',
      'note.viewed',
    ]),
    entity: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .optional(),
    entityId: Uuid.optional(),
    patientId: Uuid.optional(),
    patientIds: z.array(Uuid).max(AUDIT_MAX_PATIENTS).optional(),
    resultCount: z.number().int().min(0).max(100_000).optional(),
    criteria: z
      .array(z.enum(['name', 'birth_full', 'birth_year', 'descriptor']))
      .max(4)
      .optional(),
    source: z.enum(['team_index', 'cache', 'local', 'server']).optional(),
    checkId: Uuid.optional(),
  })
  .strict();

/** What a create of each patient-side entity carries. */
export const CREATE_SCHEMAS: Record<PatientEntityName, z.ZodType> = {
  patient: PatientCreate,
  patient_alias: AliasCreate,
  patient_allergy: AllergyCreate,
  patient_consent: ConsentCreate,
  problem: ProblemCreate,
  problem_note: ProblemNoteCreate,
  id_link: IdLinkCreate,
};

/** The fields a `set` may change, per entity. Consents, notes and links are never changed. */
export const FIELD_SCHEMAS: Record<PatientEntityName, Readonly<Record<string, z.ZodType>>> = {
  patient: {
    preferredName: Name80.nullable(),
    visualDescriptor: Text200.nullable(),
    livingSituation: LivingSituation.nullable(),
    usualArea: Text200.nullable(),
    preferredLanguage: LanguageTag.nullable(),
    allergyScreen: z.enum(ALLERGY_SCREENS),
    idCardChoice: z.enum(ID_CARD_CHOICES),
    legalName: LegalName.nullable(),
    birth: Birth.nullable(),
  },
  patient_alias: { removal: Retraction },
  patient_allergy: { enteredInError: Retraction },
  patient_consent: {},
  problem: { status: ProblemStatusValue, enteredInError: Retraction },
  problem_note: {},
  id_link: {},
};

export function patientFieldSchema(entity: PatientEntityName, field: string): z.ZodType | null {
  return Object.hasOwn(FIELD_SCHEMAS[entity], field) ? FIELD_SCHEMAS[entity][field]! : null;
}

type BirthValue = z.infer<typeof Birth>;

/** `birth_in_future`: a date after server today plus one day, or a year after this one. */
export function birthProblem(birth: BirthValue | null | undefined, today: string): string | null {
  if (!birth) return null;
  if (birth.precision === 'day') {
    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + 1);
    return birth.date > limit.toISOString().slice(0, 10) ? 'birth_in_future' : null;
  }
  return birth.year > Number(today.slice(0, 4)) ? 'birth_in_future' : null;
}

/** `living_other_text`: the text goes with Other and only with Other. */
export function livingProblem(v: z.infer<typeof LivingSituation> | null | undefined): string | null {
  if (!v) return null;
  return (v.kind === 'other') === (v.other !== undefined) ? null : 'living_other_text';
}

/**
 * The rules a parsed value breaks on its own, as the `details.problem` of a validation rejection:
 * `nothing_to_recognise` (a patient create with no name and no description), `birth_in_future`,
 * `living_other_text`. `today` is the server's date (YYYY-MM-DD). Null when the value is fine.
 */
export function valueProblem(
  entity: PatientEntityName,
  op: 'create' | 'set',
  field: string | undefined,
  value: unknown,
  today: string,
): string | null {
  if (entity !== 'patient') return null;
  if (op === 'create') {
    const v = value as PatientCreateValue;
    if (!recognisableCreate(v)) return 'nothing_to_recognise';
    return birthProblem(v.birth, today) ?? livingProblem(v.livingSituation);
  }
  if (field === 'birth') return birthProblem(value as BirthValue | null, today);
  if (field === 'livingSituation') return livingProblem(value as z.infer<typeof LivingSituation> | null);
  return null;
}

/** A record a change needs on the server (any status, merged included) before it can apply. */
export interface ParentRef {
  entity: AnyRecordEntityName;
  id: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * The records a change names (design 2.1 "Parents that must exist", 2.2 steps 3 and 4, 2.9-2): the
 * server's `parents` and `parentsOfSet`, and the phone's `parentsOf`, agree on these, pinned by the
 * `parents` lists in sync-values.json. Read from a value that passed its schema; encounters and
 * notes are read from the phase 2 values.
 */
export function valueParents(
  entity: AnyRecordEntityName,
  op: 'create' | 'set',
  field: string | undefined,
  value: unknown,
): ParentRef[] {
  const out: ParentRef[] = [];
  const add = (e: AnyRecordEntityName, id: unknown) => {
    const s = str(id);
    if (s) out.push({ entity: e, id: s });
  };
  const v = (value ?? {}) as Record<string, unknown>;
  if (op === 'set') {
    if (entity === 'problem' && field === 'status') add('encounter', v.encounterId);
    if (entity === 'encounter' && field === 'patientId') add('patient', value);
    return out;
  }
  switch (entity) {
    case 'encounter':
      add('patient', v.patientId);
      break;
    case 'encounter_note':
      add('encounter', v.encounterId);
      break;
    case 'patient_alias':
    case 'patient_consent':
    case 'id_link':
      add('patient', v.patientId);
      break;
    case 'patient_allergy':
      add('patient', v.patientId);
      add('encounter', v.encounterId);
      break;
    case 'problem':
      add('patient', v.patientId);
      add('encounter', v.encounterId);
      add('problem', v.recurrenceOf);
      add('problem', v.resolvedInErrorOf);
      break;
    case 'problem_note':
      add('problem', v.problemId);
      add('encounter', v.encounterId);
      break;
    case 'patient':
      break;
  }
  return out;
}
