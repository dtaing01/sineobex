import type { z } from '@hono/zod-openapi';
import type { TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { notFound } from '../lib/errors.ts';
import type { FieldMeta } from '../sync/records.ts';
import type { FieldStateValue, RecordSnapshotValue } from '../sync/schemas.ts';
import { idLinkUrl } from './id-links.ts';
import { birthFromRow, duplicateHints, projectChart } from './projection.ts';
import type {
  HistoryKind,
  ChartBundleValue,
  FetchChartsInput,
  PatientChartValue,
  PatientRedirectValue,
} from './schemas.ts';

/**
 * Charts: one patient's group, read through canonical_id (phase 3 design 3.1, D27).
 *
 * A merge moves nothing, so a chart is every row whose patient has this canonical_id. A child table
 * read by `patient_id = $1` would show half a merged chart, so every table with a patient_id column
 * is listed here with how a chart reads it, and a schema test fails until a new one is registered.
 */
export const CHART_TABLES: Readonly<Record<string, 'group' | 'not_chart'>> = {
  patient_aliases: 'group',
  patient_allergies: 'group',
  patient_consents: 'group',
  patient_id_links: 'group',
  field_reviews: 'group',
  patient_corrections: 'group',
  problems: 'group',
  // Phase 4 lists a group's recent encounters; phase 2 rows may name patients that never existed.
  encounters: 'group',
  // Search keys: retrieval groups them by canonical_id (patient_candidates), never a chart.
  patient_name_keys: 'not_chart',
  // The access report reads it by patient_id and details.patientIds.
  audit_events: 'not_chart',
};

// ------------------------------------------------------------------------------------------------
// Snapshots: the shape importServerRecord reads, so a cached chart keeps its field versions
// ------------------------------------------------------------------------------------------------

type HistoryKindValue = z.infer<typeof HistoryKind>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface Bookkeeping {
  fieldVersions: Record<string, number>;
  fieldMeta: Record<string, FieldMeta>;
}

function fieldStates(row: Bookkeeping, values: Record<string, unknown>): Record<string, FieldStateValue> {
  const fields: Record<string, FieldStateValue> = {};
  for (const [name, value] of Object.entries(values)) {
    const meta = row.fieldMeta[name];
    fields[name] = {
      value: value ?? null,
      version: row.fieldVersions[name] ?? 0,
      changedBy: meta?.by ?? null,
      changedAt: meta?.at ?? null,
    };
  }
  return fields;
}

export interface PatientRow extends Bookkeeping {
  id: string;
  teamId: string;
  status: 'active' | 'merged';
  mergedInto: string | null;
  canonicalId: string;
  preferredName: string | null;
  legalGivenName: string | null;
  legalFamilyName: string | null;
  visualDescriptor: string | null;
  birthPrecision: string | null;
  birthDate: string | null;
  birthYear: number | null;
  livingSituation: string | null;
  livingSituationOther: string | null;
  usualArea: string | null;
  preferredLanguage: string | null;
  allergyScreen: string;
  idCardChoice: string;
  lastSeenAt: Date | null;
  registeredAt: Date;
  clockVerified: boolean;
  authorUserId: string;
  createdDeviceId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The patient's settable fields as sync names and shapes them (sync/entities/values.ts). */
export function patientValues(r: PatientRow): Record<string, unknown> {
  return {
    preferredName: r.preferredName,
    legalName:
      r.legalGivenName === null && r.legalFamilyName === null
        ? null
        : { given: r.legalGivenName, family: r.legalFamilyName },
    visualDescriptor: r.visualDescriptor,
    birth: birthFromRow(r),
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

export function patientSnapshot(r: PatientRow): RecordSnapshotValue {
  return {
    entity: 'patient',
    id: r.id,
    version: r.version,
    status: r.status,
    authorUserId: r.authorUserId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    attributes: {
      registeredAt: r.registeredAt.toISOString(),
      clockVerified: r.clockVerified,
      lastSeenAt: iso(r.lastSeenAt),
    },
    fields: fieldStates(r, patientValues(r)),
  };
}

interface AliasRow extends Bookkeeping {
  id: string;
  groupId: string;
  patientId: string;
  alias: string;
  status: string;
  removedReason: string | null;
  authorUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const aliasSnapshot = (r: AliasRow): RecordSnapshotValue => ({
  entity: 'patient_alias',
  id: r.id,
  version: r.version,
  status: r.status,
  authorUserId: r.authorUserId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  attributes: { patientId: r.patientId, alias: r.alias },
  fields: fieldStates(r, { removal: r.removedReason === null ? null : { reason: r.removedReason } }),
});

interface AllergyRow extends Bookkeeping {
  id: string;
  groupId: string;
  patientId: string;
  substance: string;
  category: string;
  reaction: string | null;
  severity: string;
  encounterId: string | null;
  status: string;
  errorReason: string | null;
  recordedAt: Date;
  authorUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const allergySnapshot = (r: AllergyRow): RecordSnapshotValue => ({
  entity: 'patient_allergy',
  id: r.id,
  version: r.version,
  status: r.status,
  authorUserId: r.authorUserId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  attributes: {
    patientId: r.patientId,
    substance: r.substance,
    category: r.category,
    reaction: r.reaction,
    severity: r.severity,
    encounterId: r.encounterId,
    recordedAt: r.recordedAt.toISOString(),
  },
  fields: fieldStates(r, { enteredInError: r.errorReason === null ? null : { reason: r.errorReason } }),
});

interface ProblemRow extends Bookkeeping {
  id: string;
  groupId: string;
  patientId: string;
  title: string;
  codeSystem: string | null;
  code: string | null;
  codeDisplay: string | null;
  sensitive: boolean;
  status: string;
  statusEncounterId: string | null;
  statusChangedAt: Date;
  statusCheckedAt: Date;
  recurrenceOf: string | null;
  resolvedInErrorOf: string | null;
  reversalRequest: string | null;
  mergedInto: string | null;
  errorReason: string | null;
  source: string;
  createdEncounterId: string | null;
  onsetDate: Date | null;
  authorUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A problem's attributes include `sensitive`, which the projection reads. */
const problemSnapshot = (r: ProblemRow): RecordSnapshotValue => ({
  entity: 'problem',
  id: r.id,
  version: r.version,
  status: r.status,
  authorUserId: r.authorUserId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  attributes: {
    patientId: r.patientId,
    title: r.title,
    code: r.code === null ? null : { system: r.codeSystem, code: r.code, display: r.codeDisplay },
    sensitive: r.sensitive,
    source: r.source,
    createdEncounterId: r.createdEncounterId,
    onsetDate: r.onsetDate ? r.onsetDate.toISOString().slice(0, 10) : null,
    recurrenceOf: r.recurrenceOf,
    resolvedInErrorOf: r.resolvedInErrorOf,
    // Admin actions move these two (design 9.4); the phone shows them, never edits them.
    reversalRequest: r.reversalRequest,
    mergedInto: r.mergedInto,
    statusChangedAt: r.statusChangedAt.toISOString(),
    statusCheckedAt: r.statusCheckedAt.toISOString(),
  },
  fields: fieldStates(r, {
    status: { status: r.status, encounterId: r.statusEncounterId },
    enteredInError: r.errorReason === null ? null : { reason: r.errorReason },
  }),
});

// ------------------------------------------------------------------------------------------------
// Loading groups
// ------------------------------------------------------------------------------------------------

type UserRefValue = { userId: string; displayName: string };

async function userRefs(tx: Tx, ids: Iterable<string | null>): Promise<Map<string, UserRefValue>> {
  const wanted = [...new Set([...ids].filter((x): x is string => x !== null))];
  const out = new Map<string, UserRefValue>();
  if (wanted.length === 0) return out;
  const rows = await tx<{ id: string; displayName: string }[]>`
    select id, display_name from sineobex.users where id = any (${wanted}::uuid[])`;
  for (const r of rows) out.set(r.id, { userId: r.id, displayName: r.displayName });
  return out;
}

const ref = (users: Map<string, UserRefValue>, id: string): UserRefValue =>
  users.get(id) ?? { userId: id, displayName: '' };

/** The canonical patient of each ID the team has; IDs it doesn't have are left out. */
export async function canonicalOf(tx: Tx, patientIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (patientIds.length === 0) return out;
  const rows = await tx<{ id: string; canonicalId: string }[]>`
    select id, canonical_id from sineobex.patients
    where team_id = sineobex.current_team_id() and id = any (${[...patientIds]}::uuid[])`;
  for (const r of rows) out.set(r.id, r.canonicalId);
  return out;
}

const PATIENT_COLUMNS = (tx: Tx) => tx`
  p.id, p.team_id, p.status, p.merged_into, p.canonical_id, p.preferred_name, p.legal_given_name,
  p.legal_family_name, p.visual_descriptor, p.birth_precision, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date,
  p.birth_year, p.living_situation, p.living_situation_other, p.usual_area, p.preferred_language,
  p.allergy_screen, p.id_card_choice, p.last_seen_at, p.registered_at, p.clock_verified, p.author_user_id,
  p.created_device_id, p.field_versions, p.field_meta, p.version, p.created_at, p.updated_at`;

/**
 * Every live redirect into the groups: each merged record of a group, to the group's canonical
 * patient, with when it was merged. Keyed by nothing: the list is the answer.
 */
export async function groupRedirects(
  tx: Tx,
  canonicalIds: readonly string[] | null,
): Promise<PatientRedirectValue[]> {
  const rows = await tx<{ mergedId: string; survivorId: string; mergedAt: Date }[]>`
    select p.id as merged_id, p.canonical_id as survivor_id, coalesce(m.merged_at, p.updated_at) as merged_at
    from sineobex.patients p
    left join sineobex.patient_merges m on m.team_id = p.team_id and m.merged_id = p.id and m.undone_at is null
    where p.team_id = sineobex.current_team_id() and p.status = 'merged'
      ${canonicalIds === null ? tx`` : tx`and p.canonical_id = any (${[...canonicalIds]}::uuid[])`}
    order by p.id`;
  return rows.map((r) => ({
    mergedId: r.mergedId,
    survivorId: r.survivorId,
    mergedAt: r.mergedAt.toISOString(),
  }));
}

/**
 * The full charts (before projection) of these groups, keyed by canonical ID. One query per part,
 * whatever the number of groups (a chart bundle holds up to 50).
 */
async function loadGroupCharts(
  tx: Tx,
  scope: TeamScope,
  canonicalIds: readonly string[],
): Promise<Map<string, PatientChartValue>> {
  const charts = new Map<string, PatientChartValue>();
  if (canonicalIds.length === 0) return charts;
  const ids = [...canonicalIds];
  const patients = await tx<PatientRow[]>`
    select ${PATIENT_COLUMNS(tx)} from sineobex.patients p
    where p.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
    order by p.created_at, p.id`;
  const merges = await tx<{ mergedId: string; mergeId: string; mergedAt: Date }[]>`
    select m.merged_id, m.id as merge_id, m.merged_at from sineobex.patient_merges m
    join sineobex.patients p on p.team_id = m.team_id and p.id = m.merged_id
    where m.team_id = sineobex.current_team_id() and m.undone_at is null and p.canonical_id = any (${ids}::uuid[])`;
  const aliases = await tx<AliasRow[]>`
    select a.*, p.canonical_id as group_id from sineobex.patient_aliases a
    join sineobex.patients p on p.team_id = a.team_id and p.id = a.patient_id
    where a.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
    order by a.created_at, a.id`;
  const allergies = await tx<AllergyRow[]>`
    select a.*, p.canonical_id as group_id from sineobex.patient_allergies a
    join sineobex.patients p on p.team_id = a.team_id and p.id = a.patient_id
    where a.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
    order by a.recorded_at, a.id`;
  const consents = await tx<
    {
      id: string;
      groupId: string;
      kind: 'care_and_record' | 'privacy_notice';
      decision: 'given' | 'unable' | 'acknowledged' | 'declined' | 'not_offered';
      method: 'verbal' | 'written' | 'not_applicable';
      recordedAt: Date;
      recordedBy: string;
    }[]
  >`
    select c.id, p.canonical_id as group_id, c.kind, c.decision, c.method, c.recorded_at, c.recorded_by
    from sineobex.patient_consents c
    join sineobex.patients p on p.team_id = c.team_id and p.id = c.patient_id
    where c.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
    order by c.recorded_at, c.id`;
  const problems = await tx<ProblemRow[]>`
    select pr.*, p.canonical_id as group_id
    from sineobex.problems pr
    join sineobex.patients p on p.team_id = pr.team_id and p.id = pr.patient_id
    where pr.team_id = sineobex.current_team_id() and p.canonical_id = any (${ids}::uuid[])
    order by pr.created_at, pr.id`;
  const problemIds = problems.map((r) => r.id);
  const statusHistory =
    problemIds.length === 0
      ? []
      : await tx<
          {
            id: string;
            recordId: string;
            value: { status: 'new' | 'ongoing' | 'resolved'; encounterId: string | null };
            kind: HistoryKindValue;
            changedBy: string;
            at: Date;
          }[]
        >`
    select h.id::text, h.record_id, h.value, h.kind, h.changed_by, coalesce(h.device_time, h.recorded_at) as at
    from sineobex.field_history h
    where h.team_id = sineobex.current_team_id() and h.entity = 'problem' and h.field = 'status'
      and h.record_id = any (${problemIds}::uuid[])
    order by h.id`;
  const notes =
    problemIds.length === 0
      ? []
      : await tx<
          {
            id: string;
            problemId: string;
            text: string;
            encounterId: string | null;
            writtenAt: Date;
            authorUserId: string;
          }[]
        >`
    select n.id, n.problem_id, n.text, n.encounter_id, n.written_at, n.author_user_id
    from sineobex.problem_notes n
    where n.team_id = sineobex.current_team_id() and n.problem_id = any (${problemIds}::uuid[])
    order by n.written_at, n.id`;
  const links = await tx<
    {
      id: string;
      groupId: string;
      patientId: string;
      token: string;
      status: 'active' | 'retired';
      effectiveAt: Date;
      madeOffline: boolean;
    }[]
  >`
    select l.id, p.canonical_id as group_id, l.patient_id, l.token, l.status, l.effective_at, l.made_offline
    from sineobex.patient_id_links l
    join sineobex.patients p on p.team_id = l.team_id and p.id = l.patient_id
    where l.team_id = sineobex.current_team_id() and l.status = 'active' and p.canonical_id = any (${ids}::uuid[])
    order by l.effective_at, l.id`;
  const reviews = await tx<
    {
      id: string;
      groupId: string;
      patientId: string;
      recordId: string;
      field: string;
      needs: 'patients.edit' | 'patients.correct_identity';
      status: 'open' | 'decided' | 'obsolete';
      openedAt: Date;
    }[]
  >`
    select r.id, p.canonical_id as group_id, r.patient_id, r.record_id, r.field, r.needs, r.status, r.opened_at
    from sineobex.field_reviews r
    join sineobex.patients p on p.team_id = r.team_id and p.id = r.patient_id
    where r.team_id = sineobex.current_team_id() and r.status = 'open' and p.canonical_id = any (${ids}::uuid[])
    order by r.opened_at, r.id`;
  const alternates =
    reviews.length === 0
      ? []
      : await tx<
          { id: string; reviewId: string; value: unknown; changedBy: string; deviceTime: Date | null }[]
        >`
    select h.id::text, h.review_id, h.value, h.changed_by, h.device_time
    from sineobex.field_history h
    where h.team_id = sineobex.current_team_id() and h.kind = 'kept_both'
      and h.review_id = any (${reviews.map((r) => r.id)}::uuid[])
    order by h.id`;
  const hints = await duplicateHints(tx, ids);
  const users = await userRefs(tx, [
    ...consents.map((c) => c.recordedBy),
    ...statusHistory.map((h) => h.changedBy),
    ...notes.map((n) => n.authorUserId),
    ...alternates.map((a) => a.changedBy),
  ]);

  const byId = new Map(patients.map((p) => [p.id, p]));
  const baseUrl = scope.deps.config.ID_LINK_BASE_URL;
  for (const canonicalId of ids) {
    const canonical = byId.get(canonicalId);
    if (!canonical || canonical.status !== 'active') continue;
    const groupProblems = problems.filter((r) => r.groupId === canonicalId);
    const groupProblemIds = new Set(groupProblems.map((r) => r.id));
    charts.set(canonicalId, {
      patient: patientSnapshot(canonical),
      canonicalId,
      mergedFrom: patients
        .filter((p) => p.canonicalId === canonicalId && p.id !== canonicalId)
        .flatMap((p) => {
          const m = merges.find((x) => x.mergedId === p.id);
          return m ? [{ patientId: p.id, mergedAt: m.mergedAt.toISOString(), mergeId: m.mergeId }] : [];
        }),
      aliases: aliases.filter((r) => r.groupId === canonicalId).map(aliasSnapshot),
      allergies: allergies.filter((r) => r.groupId === canonicalId).map(allergySnapshot),
      consents: consents
        .filter((c) => c.groupId === canonicalId)
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          decision: c.decision,
          method: c.method,
          recordedAt: c.recordedAt.toISOString(),
          recordedBy: ref(users, c.recordedBy),
        })),
      problems: groupProblems.map(problemSnapshot),
      problemHistory: statusHistory
        .filter((h) => groupProblemIds.has(h.recordId))
        .map((h) => ({
          historyId: h.id,
          problemId: h.recordId,
          status: h.value.status,
          encounterId: h.value.encounterId ?? null,
          by: ref(users, h.changedBy),
          at: h.at.toISOString(),
          kind: h.kind,
        })),
      problemNotes: notes
        .filter((n) => groupProblemIds.has(n.problemId))
        .map((n) => ({
          id: n.id,
          problemId: n.problemId,
          text: n.text,
          encounterId: n.encounterId,
          writtenAt: n.writtenAt.toISOString(),
          author: ref(users, n.authorUserId),
        })),
      idLinks: links
        .filter((l) => l.groupId === canonicalId)
        .map((l) => ({
          id: l.id,
          issuedOn: l.patientId,
          status: l.status,
          effectiveAt: l.effectiveAt.toISOString(),
          madeOffline: l.madeOffline,
          url: idLinkUrl(baseUrl, l.token),
        })),
      reviews: reviews
        .filter((r) => r.groupId === canonicalId)
        .map((r) => {
          const record = byId.get(r.recordId) ?? canonical;
          return {
            id: r.id,
            patientId: r.patientId,
            field: r.field,
            needs: r.needs,
            current: fieldStates(record, { [r.field]: patientValues(record)[r.field] })[r.field]!,
            alternates: alternates
              .filter((a) => a.reviewId === r.id)
              .map((a) => ({
                historyId: a.id,
                value: a.value,
                by: ref(users, a.changedBy),
                deviceTime: iso(a.deviceTime),
              })),
            openedAt: r.openedAt.toISOString(),
            status: r.status,
          };
        }),
      duplicate: hints.get(canonicalId) ?? null,
      projection: '',
    });
  }
  return charts;
}

/**
 * The projected chart of a patient's group inside the caller's transaction, without auditing (the
 * caller audits what it shows, as the duplicate pair page does). Null when the team has no such patient.
 */
export async function loadChart(
  tx: Tx,
  scope: TeamScope,
  patientId: string,
): Promise<PatientChartValue | null> {
  const canonical = (await canonicalOf(tx, [patientId])).get(patientId);
  if (!canonical) return null;
  const chart = (await loadGroupCharts(tx, scope, [canonical])).get(canonical);
  if (!chart) return null;
  const projected = projectChart(scope, chart);
  return canonical === patientId ? projected : { ...projected, redirectedFrom: patientId };
}

/** Where a chart was opened, for `patient.viewed`: a registered phone of this person, or the portal. */
const viewSource = (scope: TeamScope) => (scope.meta.deviceId ? 'phone' : 'portal');

/**
 * GET /v1/patients/{patientId}: the projected chart of the patient's group. A merged ID answers the
 * survivor's chart with `redirectedFrom`. Audited as `patient.viewed {source}` with the canonical ID.
 */
export async function getChart(scope: TeamScope, patientId: string): Promise<PatientChartValue> {
  return scope.tx(async (tx, audit) => {
    const chart = await loadChart(tx, scope, patientId);
    if (!chart) throw notFound('patient');
    await audit({
      action: 'patient.viewed',
      entity: 'patient',
      entityId: chart.canonicalId,
      patientId: chart.canonicalId,
      details: { source: viewSource(scope) },
    });
    return chart;
  });
}

/**
 * POST /v1/patients/charts: charts for the phone's cache, with every live redirect into or out of
 * the requested IDs and the returned groups. One `patient.viewed {source: 'cache', reason}` per chart.
 */
export async function fetchCharts(scope: TeamScope, input: FetchChartsInput): Promise<ChartBundleValue> {
  return scope.tx(async (tx, audit) => {
    const requested = [...new Set(input.patientIds.map((id) => id.toLowerCase()))];
    const canonical = await canonicalOf(tx, requested);
    const groups = [...new Set(canonical.values())];
    const full = await loadGroupCharts(tx, scope, groups);
    const charts: PatientChartValue[] = [];
    for (const id of groups) {
      const chart = full.get(id);
      if (!chart) continue;
      charts.push(projectChart(scope, chart));
      await audit({
        action: 'patient.viewed',
        entity: 'patient',
        entityId: id,
        patientId: id,
        details: { source: 'cache', reason: input.reason },
      });
    }
    return {
      charts,
      missing: requested.filter((id) => !full.has(canonical.get(id) ?? '')),
      redirects: await groupRedirects(
        tx,
        charts.map((c) => c.canonicalId),
      ),
    };
  });
}
