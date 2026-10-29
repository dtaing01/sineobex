import { z } from '@hono/zod-openapi';
import { Reason, Uuid } from '../routes/schemas.ts';
import { DateTime, FieldState, RecordSnapshot, UserRef } from '../sync/schemas.ts';

/**
 * Wire format for patients, problems, duplicates and ID links (phase 3 design, section 3).
 *
 * Names, birth dates and search text travel only in POST bodies: paths carry UUIDs, query strings
 * carry cursors, status enums and field names (packages/contract/test/spec.test.ts holds that). Every
 * patient read is projected for the caller's role (projection.ts): a part the role can't see is
 * absent, never null. A 409 carries codes, IDs and versions only, never a chart value, a summary or
 * a token, because it is thrown inside the transaction and rolls its audit event back.
 */

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ format: 'date', description: 'A calendar date, YYYY-MM-DD' });

const realDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const isRealIsoDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return realDate(y, m, d);
};

/** Opaque keyset cursor over field_history (a bigint row ID). */
export const HistoryId = z
  .string()
  .regex(/^\d{1,19}$/)
  .openapi({ description: 'A field history entry' });

/** Paths carry UUIDs only. */
export const PatientParam = z.object({ patientId: Uuid });
export const ProblemParam = z.object({ problemId: Uuid });
export const ReviewParam = z.object({ reviewId: Uuid });
export const PairParam = z.object({ pairId: Uuid });
export const MergeParam = z.object({ mergeId: Uuid });

/** A page of a list ordered by a keyset; `afterId` is the previous page's nextAfterId. */
export const PageQuery = z.object({
  afterId: Uuid.optional().openapi({ description: 'The previous page’s nextAfterId' }),
});

const NextAfterId = Uuid.nullable().openapi({
  description: 'Pass as afterId for the next page; null on the last',
});

export const Surface = z.enum(['portal', 'phone']).openapi('Surface', {
  description: 'Where the result is shown. On the phone no result carries a legal name.',
});

// --------------------------------------------------------------------------------------------
// Shared pieces of a patient
// --------------------------------------------------------------------------------------------

export const BirthPrecision = z.enum(['day', 'year', 'estimated']).openapi('BirthPrecision');

/** A birth as recorded: a full date, a year, or a year estimated from an age. */
export const BirthView = z
  .object({ precision: BirthPrecision, date: IsoDate.optional(), year: z.number().int().optional() })
  .openapi('BirthView');

/** A birth typed into a form. The same shape as the sync value `birth`, checked the same way. */
export const BirthInput = z
  .object({
    precision: BirthPrecision,
    date: IsoDate.optional().openapi({ description: 'With precision day' }),
    year: z.number().int().min(1900).max(2100).optional().openapi({ description: 'With year or estimated' }),
  })
  .superRefine((v, ctx) => {
    if (v.precision === 'day') {
      if (v.date === undefined || !isRealIsoDate(v.date) || v.date < '1900-01-01')
        ctx.addIssue({ code: 'custom', path: ['date'], message: 'invalid_date' });
      if (v.year !== undefined) ctx.addIssue({ code: 'custom', path: ['year'], message: 'unexpected' });
    } else {
      if (v.year === undefined) ctx.addIssue({ code: 'custom', path: ['year'], message: 'required' });
      if (v.date !== undefined) ctx.addIssue({ code: 'custom', path: ['date'], message: 'unexpected' });
    }
  })
  .openapi('BirthInput');

/** A birth date to search by. A year alone needs a name with it (no browsing by year). */
export const BirthQuery = z
  .object({
    year: z.number().int().min(1900).max(2100),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.day !== undefined && v.month === undefined)
      ctx.addIssue({ code: 'custom', path: ['month'], message: 'required' });
    if (v.day !== undefined && v.month !== undefined && !realDate(v.year, v.month, v.day))
      ctx.addIssue({ code: 'custom', path: ['day'], message: 'invalid_date' });
  })
  .openapi('BirthQuery');

export const LegalNameView = z
  .object({ given: z.string().nullable(), family: z.string().nullable() })
  .openapi('LegalNameView');

const NamePart = z.string().trim().min(1).max(80);

export const LegalNameInput = z
  .object({ given: NamePart.nullable(), family: NamePart.nullable() })
  .refine((v) => v.given !== null || v.family !== null, { message: 'empty_legal_name' })
  .openapi('LegalNameInput');

/** Why a candidate matched, as a closed list the screens put in plain words (design 3.1). */
export const MatchReason = z
  .enum([
    'name',
    'alias',
    'legal_name',
    'descriptor',
    'typo',
    'nickname',
    'sounds_like',
    'initial',
    'dob_exact',
    'dob_swapped',
    'dob_month_year',
    'dob_year_slip',
    'dob_year',
    'dob_estimate',
  ])
  .openapi('MatchReason');

export const MatchBand = z.enum(['likely', 'possible', 'weak']).openapi('MatchBand');

export const AllergyScreen = z.enum(['not_asked', 'none_known']).openapi('AllergyScreen');
export const AllergyCategory = z
  .enum(['drug', 'food', 'environment', 'other', 'unknown'])
  .openapi('AllergyCategory');
export const AllergySeverity = z.enum(['mild', 'moderate', 'severe', 'unknown']).openapi('AllergySeverity');

export const AllergySummary = z
  .object({ screen: AllergyScreen, count: z.number().int(), severe: z.boolean() })
  .openapi('AllergySummary');

/**
 * Who someone is, in a result list. Keys are present per projection; a value the role may see
 * that was never recorded is null. `legalName` is never present for the phone (D40).
 */
export const PatientSummary = z
  .object({
    preferredName: z.string().nullable().optional(),
    legalName: z.union([LegalNameView, z.null()]).optional(),
    aliases: z.array(z.string()).max(5).optional(),
    visualDescriptor: z.string().nullable().optional(),
    birth: z.union([BirthView, z.null()]).optional(),
    ageYears: z.number().int().nullable().optional(),
    usualArea: z.string().nullable().optional(),
    lastSeenOn: IsoDate.nullable().optional(),
    allergy: AllergySummary.optional(),
    duplicateHint: z.boolean().optional(),
  })
  .openapi('PatientSummary');

export const PatientHit = z
  .object({
    patientId: Uuid.openapi({ description: 'The canonical patient' }),
    score: z.number(),
    band: MatchBand,
    reasons: z.array(MatchReason),
    summary: PatientSummary,
  })
  .openapi('PatientHit');

export const PatientRedirect = z
  .object({ mergedId: Uuid, survivorId: Uuid, mergedAt: DateTime })
  .openapi('PatientRedirect');

export const DuplicateHint = z
  .object({
    status: z.enum(['open', 'not_sure']),
    note: z
      .string()
      .nullable()
      .openapi({ description: 'The reviewer’s Not sure note, shown to field staff' }),
  })
  .openapi('DuplicateHint');

export const ConsentView = z
  .object({
    id: Uuid,
    kind: z.enum(['care_and_record', 'privacy_notice']),
    decision: z.enum(['given', 'unable', 'acknowledged', 'declined', 'not_offered']),
    method: z.enum(['verbal', 'written', 'not_applicable']),
    recordedAt: DateTime,
    recordedBy: UserRef,
  })
  .openapi('ConsentView');

export const IdLinkStatus = z.enum(['active', 'retired']).openapi('IdLinkStatus');
export const IdLinkReason = z
  .enum(['first_card', 'lost', 'damaged', 'stolen', 'patient_request', 'other'])
  .openapi('IdLinkReason');

export const IdLinkSummary = z
  .object({
    id: Uuid,
    issuedOn: Uuid.openapi({ description: 'The patient record the link was issued on' }),
    status: IdLinkStatus,
    effectiveAt: DateTime,
    madeOffline: z.boolean(),
    url: z.string().optional().openapi({ description: 'patients.edit only' }),
  })
  .openapi('IdLinkSummary');

export const ReviewNeeds = z.enum(['patients.edit', 'patients.correct_identity']).openapi('ReviewNeeds');

export const FieldReviewView = z
  .object({
    id: Uuid,
    patientId: Uuid,
    field: z.string(),
    needs: ReviewNeeds,
    current: FieldState,
    alternates: z.array(
      z.object({ historyId: HistoryId, value: z.unknown(), by: UserRef, deviceTime: DateTime.nullable() }),
    ),
    openedAt: DateTime,
    status: z.enum(['open', 'decided', 'obsolete']),
  })
  .openapi('FieldReviewView');

export const HistoryKind = z
  .enum([
    'created',
    'set',
    'filled_blank',
    'replaced_after_review',
    'kept_both',
    'confirmed',
    'redirected',
    'corrected',
    'review_decided',
    'merge_fill',
    'merge_undone',
    'cleared_by_allergy',
    'entered_in_error',
  ])
  .openapi('HistoryKind');

export const ProblemStatus = z.enum(['new', 'ongoing', 'resolved']).openapi('ProblemStatus');

export const ProblemStatusEvent = z
  .object({
    historyId: HistoryId,
    problemId: Uuid,
    status: ProblemStatus,
    encounterId: Uuid.nullable(),
    by: UserRef,
    at: DateTime,
    kind: HistoryKind,
  })
  .openapi('ProblemStatusEvent');

export const ProblemNoteView = z
  .object({
    id: Uuid,
    problemId: Uuid,
    text: z.string(),
    encounterId: Uuid.nullable(),
    writtenAt: DateTime,
    author: UserRef,
  })
  .openapi('ProblemNoteView');

// --------------------------------------------------------------------------------------------
// 3.1 Search, match, read, charts, index, history
// --------------------------------------------------------------------------------------------

// POST, so a name never lands in a URL, browser history or access log.
export const PatientSearch = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .openapi({ description: 'Name, street name or description' }),
    birth: BirthQuery.optional(),
    limit: z.number().int().min(1).max(50).default(20),
    surface: Surface,
  })
  .superRefine((v, ctx) => {
    const fullDate = v.birth?.month !== undefined && v.birth.day !== undefined;
    if (v.name === undefined && !fullDate) {
      // A name, or a full birth date: a year or a month alone never browses the list.
      ctx.addIssue({
        code: 'custom',
        path: [v.birth ? 'birth' : 'name'],
        message: 'name_or_full_birth_date',
      });
    }
  })
  .openapi('PatientSearch');

export const PatientSearchResult = z
  .object({
    hits: z.array(PatientHit),
    truncated: z
      .boolean()
      .openapi({ description: 'More matched than shown: ask for more letters or a birth year' }),
  })
  .openapi('PatientSearchResult');

export const PatientMatchRequest = z
  .object({
    preferredName: z.string().trim().min(1).max(80).optional(),
    legalName: LegalNameInput.optional(),
    aliases: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
    birth: BirthInput.optional(),
    excludePatientId: Uuid.optional().openapi({ description: 'The patient being edited' }),
    surface: Surface,
  })
  .openapi('PatientMatchRequest');

export const PatientMatchResult = z
  .object({ checkId: Uuid, candidates: z.array(PatientHit).max(5) })
  .openapi('PatientMatchResult');

export const PatientChart = z
  .object({
    patient: RecordSnapshot,
    canonicalId: Uuid,
    redirectedFrom: Uuid.optional().openapi({ description: 'The merged ID that was asked for' }),
    mergedFrom: z.array(z.object({ patientId: Uuid, mergedAt: DateTime, mergeId: Uuid })),
    aliases: z.array(RecordSnapshot),
    allergies: z.array(RecordSnapshot),
    consents: z.array(ConsentView),
    problems: z.array(RecordSnapshot).optional(),
    problemHistory: z.array(ProblemStatusEvent).optional(),
    problemNotes: z.array(ProblemNoteView).optional(),
    idLinks: z.array(IdLinkSummary).openapi({
      description:
        'Active links of the group: usually one; one per merged record that had a card until the next new card',
    }),
    reviews: z.array(FieldReviewView),
    duplicate: z.union([DuplicateHint, z.null()]),
    projection: z.string().openapi({ description: 'Which projection made this copy' }),
  })
  .openapi('PatientChart');

export const FetchCharts = z
  .object({
    patientIds: z.array(Uuid).min(1).max(50),
    // Phase 7 adds 'route' with a routeId.
    reason: z.enum(['opened', 'refresh']),
  })
  .openapi('FetchCharts');

export const ChartBundle = z
  .object({
    charts: z.array(PatientChart),
    missing: z.array(Uuid),
    redirects: z.array(PatientRedirect).openapi({
      description: 'Every live redirect into or out of the requested IDs and the returned groups',
    }),
  })
  .openapi('ChartBundle');

export const TeamIndexRequest = z
  .object({
    have: z.string().max(60).optional().openapi({ description: 'The version this phone holds' }),
    after: Uuid.optional().openapi({ description: 'The previous page’s next' }),
    limit: z.number().int().min(100).max(1000).default(500),
  })
  .openapi('TeamIndexRequest');

/** One canonical, active patient in the phone's search index. No legal name, ever (D40). */
export const IndexEntry = z
  .object({
    patientId: Uuid,
    preferredName: z.string().nullable(),
    aliases: z
      .array(
        z.object({
          id: Uuid.nullable().openapi({
            description: 'The street name’s record, which a phone may remove offline; null for a merged name',
          }),
          alias: z.string(),
          kind: z.enum(['alias', 'merged_name']).openapi({
            description:
              'merged_name: the preferred name of a record merged into this one. Not a street name record',
          }),
        }),
      )
      .max(20),
    visualDescriptor: z.string().nullable(),
    birth: z.union([BirthView, z.null()]),
    usualArea: z.string().nullable(),
    lastSeenOn: IsoDate.nullable(),
    allergyScreen: AllergyScreen,
    allergies: z.array(
      z.object({ id: Uuid, substance: z.string(), category: AllergyCategory, severity: AllergySeverity }),
    ),
    idLinks: z.array(z.object({ id: Uuid, effectiveAt: DateTime })),
    duplicate: z.union([DuplicateHint, z.null()]),
    reviews: z.array(z.string()).openapi({ description: 'Fields with an open review' }),
    versions: z.object({
      preferredName: z.number().int(),
      visualDescriptor: z.number().int(),
      usualArea: z.number().int(),
      allergyScreen: z.number().int(),
    }),
  })
  .openapi('IndexEntry');

export const TeamIndexPage = z
  .object({
    status: z.enum(['unchanged', 'page']),
    version: z.string(),
    projection: z.string(),
    generatedAt: DateTime,
    entries: z.array(IndexEntry),
    next: Uuid.nullable(),
    redirects: z.array(PatientRedirect).openapi({ description: 'First page only: the team’s complete list' }),
  })
  .openapi('TeamIndexPage');

export const HistoryQuery = z.object({
  field: z
    .string()
    .regex(/^[a-z][a-zA-Z]{0,40}$/)
    .optional()
    .openapi({ description: 'A field name; every field when absent' }),
  afterId: HistoryId.optional().openapi({ description: 'The previous page’s nextAfterId' }),
});

export const FieldHistoryEntry = z
  .object({
    id: HistoryId,
    entity: z.string(),
    recordId: Uuid,
    field: z.string(),
    version: z.number().int(),
    value: z.unknown(),
    previousValue: z.unknown(),
    kind: HistoryKind,
    changedBy: UserRef,
    approvedBy: z.union([UserRef, z.null()]),
    deviceTime: DateTime.nullable(),
    recordedAt: DateTime,
    reviewId: Uuid.nullable(),
    correctionId: Uuid.nullable(),
  })
  .openapi('FieldHistoryEntry');

export const FieldHistoryPage = z
  .object({ entries: z.array(FieldHistoryEntry), nextAfterId: HistoryId.nullable() })
  .openapi('FieldHistoryPage');

// --------------------------------------------------------------------------------------------
// 3.2 Identity corrections and field reviews
// --------------------------------------------------------------------------------------------

export const IdentityCorrection = z
  .object({
    field: z.enum(['legalName', 'birth']),
    value: z.union([LegalNameInput, BirthInput]),
    baseVersion: z.number().int().min(0),
    reason: Reason,
    requestedByPatient: z.boolean().openapi({ description: 'A HIPAA §164.526 amendment request' }),
    outcome: z.enum(['corrected', 'declined']).openapi({
      description: 'declined: an amendment request refused with a reason; the chart is unchanged',
    }),
  })
  .superRefine((v, ctx) => {
    const isBirth = typeof v.value === 'object' && v.value !== null && 'precision' in v.value;
    if ((v.field === 'birth') !== isBirth)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'wrong_field' });
    if (v.outcome === 'declined' && !v.requestedByPatient)
      ctx.addIssue({ code: 'custom', path: ['outcome'], message: 'declined_needs_request' });
  })
  .openapi('IdentityCorrection');

export const FieldReviewQuery = z.object({
  status: z.enum(['open', 'decided']).default('open'),
  afterId: Uuid.optional().openapi({ description: 'The previous page’s nextAfterId' }),
});

export const FieldReviewPage = z
  .object({ reviews: z.array(FieldReviewView), nextAfterId: NextAfterId })
  .openapi('FieldReviewPage');

export const DecideFieldReview = z
  .object({
    keep: z.enum(['current', 'alternate']),
    historyId: HistoryId.optional().openapi({ description: 'The alternate kept' }),
    comment: Reason.optional().openapi({ description: 'Required for legal name and birth' }),
    baseVersion: z.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    if (v.keep === 'alternate' && v.historyId === undefined)
      ctx.addIssue({ code: 'custom', path: ['historyId'], message: 'required' });
  })
  .openapi('DecideFieldReview');

// --------------------------------------------------------------------------------------------
// 3.3 Problems (online admin actions; everything else is sync)
// --------------------------------------------------------------------------------------------

export const ProblemView = z
  .object({
    id: Uuid,
    patientId: Uuid,
    title: z.string(),
    code: z.string().nullable(),
    codeDisplay: z.string().nullable(),
    status: ProblemStatus,
    sensitive: z.boolean(),
    statusHistory: z.array(ProblemStatusEvent),
    notes: z.array(ProblemNoteView),
    recurrenceOf: Uuid.nullable(),
    resolvedInErrorOf: Uuid.nullable(),
    reversalRequest: z.enum(['open', 'reversed', 'declined']).nullable(),
    mergedInto: Uuid.nullable(),
    enteredInError: z.union([z.object({ reason: z.string(), by: UserRef, at: DateTime }), z.null()]),
    createdAt: DateTime,
    author: UserRef,
  })
  .openapi('ProblemView');

export const ReversalRequestPage = z
  .object({
    requests: z.array(
      z.object({
        request: ProblemView,
        original: ProblemView,
        patientId: Uuid,
        patient: PatientSummary,
        requestedBy: UserRef,
        requestedAt: DateTime,
      }),
    ),
    nextAfterId: NextAfterId,
  })
  .openapi('ReversalRequestPage');

export const ReverseResolved = z
  .object({
    reason: Reason,
    requestProblemId: Uuid.optional().openapi({
      description: 'The "Resolved by mistake" entry this answers',
    }),
  })
  .openapi('ReverseResolved');

export const ReverseResolvedResult = z
  .object({
    problem: ProblemView,
    mergeCandidates: z.array(ProblemView).openapi({
      description: 'New or Ongoing entries added since, with the same code or title; the request first',
    }),
  })
  .openapi('ReverseResolvedResult');

export const DeclineReversal = z.object({ reason: Reason }).openapi('DeclineReversal');

export const MergeProblems = z.object({ intoProblemId: Uuid, comment: Reason }).openapi('MergeProblems');

// --------------------------------------------------------------------------------------------
// 3.4 Duplicates and merges
// --------------------------------------------------------------------------------------------

export const DuplicateStatus = z
  .enum(['open', 'not_sure', 'keep_separate', 'merged', 'superseded'])
  .openapi('DuplicateStatus');
export const DuplicateSource = z
  .enum(['sync', 'edit', 'merge_rematch', 'correction', 'staff_report'])
  .openapi('DuplicateSource');

export const PairPatient = z.object({ patientId: Uuid, summary: PatientSummary }).openapi('PairPatient');

export const DuplicatePairSummary = z
  .object({
    id: Uuid,
    a: PairPatient,
    b: PairPatient,
    status: DuplicateStatus,
    score: z.number(),
    band: MatchBand,
    reasons: z.array(MatchReason),
    sources: z.array(DuplicateSource),
    creatorDismissed: z
      .boolean()
      .openapi({ description: 'The creator saw this match at intake and said "Not them"' }),
    note: z.string().nullable(),
    firstFlaggedAt: DateTime,
    lastFlaggedAt: DateTime,
    decidedAt: DateTime.nullable(),
  })
  .openapi('DuplicatePairSummary');

export const DuplicateQuery = z.object({
  status: z
    .enum(['open', 'not_sure', 'decided'])
    .default('open')
    .openapi({ description: 'open: open and not sure' }),
  afterId: Uuid.optional().openapi({ description: 'The previous page’s nextAfterId' }),
});

export const DuplicatePage = z
  .object({ pairs: z.array(DuplicatePairSummary), nextAfterId: NextAfterId })
  .openapi('DuplicatePage');

export const PairSide = z
  .object({
    chart: PatientChart,
    version: z.number().int().openapi({ description: 'Send back in DecideDuplicate.versions' }),
    recentEncounters: z
      .array(z.object({ id: Uuid, startedAt: DateTime, kind: z.string() }))
      .max(5)
      .openapi({ description: 'Dates and kinds only' }),
    photoId: Uuid.nullable().openapi({ description: 'Phase 8; always null in phase 3' }),
    createdHow: z.enum(['phone_offline', 'phone', 'unknown']),
    createdBy: UserRef,
  })
  .openapi('PairSide');

export const DuplicateDecisionView = z
  .object({
    id: Uuid,
    decision: z.enum(['merge', 'keep_separate', 'not_sure', 'undo_merge', 'flagged_by_staff']),
    comment: z.string(),
    survivorId: Uuid.nullable(),
    mergeId: Uuid.nullable(),
    decidedBy: UserRef,
    decidedAt: DateTime,
  })
  .openapi('DuplicateDecisionView');

export const DuplicatePairDetail = z
  .object({
    pair: DuplicatePairSummary,
    a: PairSide,
    b: PairSide,
    compared: z.array(z.object({ field: z.string(), same: z.boolean() })),
    decisions: z.array(DuplicateDecisionView),
  })
  .openapi('DuplicatePairDetail');

export const DecideDuplicate = z
  .object({
    decision: z.enum(['merge', 'keep_separate', 'not_sure']),
    comment: Reason,
    survivorId: Uuid.optional().openapi({ description: 'Merge only: the chart that is kept' }),
    fieldNote: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .optional()
      .openapi({ description: 'Not sure only: shown to field staff on both charts' }),
    versions: z.object({ a: z.number().int().min(1), b: z.number().int().min(1) }).openapi({
      description: 'The versions the reviewer saw',
    }),
  })
  .superRefine((v, ctx) => {
    if ((v.decision === 'merge') !== (v.survivorId !== undefined))
      ctx.addIssue({ code: 'custom', path: ['survivorId'], message: 'merge_only' });
    if (v.fieldNote !== undefined && v.decision !== 'not_sure')
      ctx.addIssue({ code: 'custom', path: ['fieldNote'], message: 'not_sure_only' });
  })
  .openapi('DecideDuplicate');

export const MergeView = z
  .object({
    id: Uuid,
    pairId: Uuid,
    survivor: PairPatient,
    merged: PairPatient,
    comment: z.string(),
    mergedBy: UserRef,
    mergedAt: DateTime,
    undone: z.union([z.object({ by: UserRef, at: DateTime, comment: z.string() }), z.null()]),
    undoable: z.boolean().openapi({
      description: 'For a caller with patients.correct_identity, when nothing was merged on top',
    }),
  })
  .openapi('MergeView');

export const DuplicateDecisionResult = z
  .object({ pair: DuplicatePairSummary, merge: z.union([MergeView, z.null()]) })
  .openapi('DuplicateDecisionResult');

export const FlagDuplicate = z
  .object({ patientA: Uuid, patientB: Uuid, comment: Reason })
  .refine((v) => v.patientA.toLowerCase() !== v.patientB.toLowerCase(), {
    path: ['patientB'],
    message: 'same_patient',
  })
  .openapi('FlagDuplicate');

export const MergePage = z
  .object({ merges: z.array(MergeView), nextAfterId: NextAfterId })
  .openapi('MergePage');

export const UndoMerge = z.object({ comment: Reason }).openapi('UndoMerge');

export const UndoMergeResult = z
  .object({
    merge: MergeView,
    revertedFields: z.array(z.string()),
    keptFields: z.array(z.string()),
    reviewsClosed: z.number().int(),
    redirectedEdits: z
      .array(z.object({ historyId: HistoryId, field: z.string(), at: DateTime, by: UserRef }))
      .openapi({ description: 'Edits sent to the merged record and applied to the survivor: move by hand' }),
    restoredLinks: z.array(z.object({ linkId: Uuid, tokenRef: z.string(), issuedOn: Uuid })),
    linksIssuedWhileMerged: z.array(
      z.object({
        linkId: Uuid,
        tokenRef: z.string(),
        issuedOn: Uuid,
        reason: IdLinkReason,
        effectiveAt: DateTime,
      }),
    ),
  })
  .openapi('UndoMergeResult');

// --------------------------------------------------------------------------------------------
// 3.5 ID links
// --------------------------------------------------------------------------------------------

export const IdLinkView = z
  .object({
    id: Uuid,
    issuedOn: Uuid,
    url: z.string().optional().openapi({ description: 'Active links only, for patients.edit' }),
    tokenRef: z.string().openapi({ description: 'First 12 hex characters of the token’s SHA-256' }),
    status: IdLinkStatus,
    reason: IdLinkReason,
    effectiveAt: DateTime,
    issuedBy: UserRef,
    madeOffline: z.boolean(),
    retiredAt: DateTime.nullable(),
    retiredReason: z.enum(['regenerated', 'superseded_by_newer']).nullable(),
    replacedBy: Uuid.nullable(),
    restoredAt: DateTime.nullable(),
  })
  .openapi('IdLinkView');

export const IdLinkState = z
  .object({ active: z.array(IdLinkView), history: z.array(IdLinkView) })
  .openapi('IdLinkState');

export const IssueIdLink = z
  .object({
    linkId: Uuid.openapi({ description: 'Made by the client, so a retry issues nothing twice' }),
    replacesLinkId: Uuid.nullable().openapi({
      description: 'The newest active link the issuer saw; null for a first card',
    }),
    reason: IdLinkReason,
  })
  .openapi('IssueIdLink');

// Inferred types for the module functions the routes delegate to.
export type PatientSearchInput = z.infer<typeof PatientSearch>;
export type PatientSearchResultValue = z.infer<typeof PatientSearchResult>;
export type PatientMatchInput = z.infer<typeof PatientMatchRequest>;
export type PatientMatchResultValue = z.infer<typeof PatientMatchResult>;
export type PatientChartValue = z.infer<typeof PatientChart>;
export type PatientSummaryValue = z.infer<typeof PatientSummary>;
export type FetchChartsInput = z.infer<typeof FetchCharts>;
export type ChartBundleValue = z.infer<typeof ChartBundle>;
export type TeamIndexInput = z.infer<typeof TeamIndexRequest>;
export type TeamIndexPageValue = z.infer<typeof TeamIndexPage>;
export type IndexEntryValue = z.infer<typeof IndexEntry>;
export type HistoryQueryValue = z.infer<typeof HistoryQuery>;
export type FieldHistoryPageValue = z.infer<typeof FieldHistoryPage>;
export type IdentityCorrectionInput = z.infer<typeof IdentityCorrection>;
export type FieldReviewQueryValue = z.infer<typeof FieldReviewQuery>;
export type FieldReviewPageValue = z.infer<typeof FieldReviewPage>;
export type FieldReviewViewValue = z.infer<typeof FieldReviewView>;
export type DecideFieldReviewInput = z.infer<typeof DecideFieldReview>;
export type ProblemViewValue = z.infer<typeof ProblemView>;
export type ReversalRequestPageValue = z.infer<typeof ReversalRequestPage>;
export type ReverseResolvedInput = z.infer<typeof ReverseResolved>;
export type ReverseResolvedResultValue = z.infer<typeof ReverseResolvedResult>;
export type DeclineReversalInput = z.infer<typeof DeclineReversal>;
export type MergeProblemsInput = z.infer<typeof MergeProblems>;
export type PageQueryValue = z.infer<typeof PageQuery>;
export type DuplicateQueryValue = z.infer<typeof DuplicateQuery>;
export type DuplicatePageValue = z.infer<typeof DuplicatePage>;
export type DuplicatePairSummaryValue = z.infer<typeof DuplicatePairSummary>;
export type DuplicatePairDetailValue = z.infer<typeof DuplicatePairDetail>;
export type DecideDuplicateInput = z.infer<typeof DecideDuplicate>;
export type DuplicateDecisionResultValue = z.infer<typeof DuplicateDecisionResult>;
export type FlagDuplicateInput = z.infer<typeof FlagDuplicate>;
export type MergePageValue = z.infer<typeof MergePage>;
export type UndoMergeInput = z.infer<typeof UndoMerge>;
export type UndoMergeResultValue = z.infer<typeof UndoMergeResult>;
export type IdLinkStateValue = z.infer<typeof IdLinkState>;
export type IssueIdLinkInput = z.infer<typeof IssueIdLink>;
export type IdLinkReasonValue = z.infer<typeof IdLinkReason>;
export type PatientRedirectValue = z.infer<typeof PatientRedirect>;
export type SurfaceValue = z.infer<typeof Surface>;
export type MatchReasonValue = z.infer<typeof MatchReason>;
