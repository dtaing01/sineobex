import type { TeamScope } from '../auth/context.ts';
import { mayViewProblems, type Permission } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import type { BirthValue } from './matching.ts';
import type { PatientChartValue, PatientSummaryValue, SurfaceValue } from './schemas.ts';

/**
 * Minimum necessary as a function (phase 3 design 4.3, D33): every patient read goes through one
 * projection for the caller's role. A part the role can't see is absent, never null; sensitive
 * items are hidden, not counted; a sensitive problem the role can't see answers the same 404 as a
 * missing one. A role searches only by what it can see.
 */

/** Key sources in patient_name_keys a search may match. */
export type NameKeySource = 'legal' | 'preferred' | 'alias' | 'descriptor';

export interface Projection {
  /** Names the projection in responses and in the index version ("<counter>.<key>"). */
  key: string;
  /** mayViewProblems: titles, codes, statuses, status history and notes. */
  problems: boolean;
  /** patients.view_sensitive: sensitive problems (and, in phase 5, sensitive flags). */
  sensitive: boolean;
  /** patients.edit: ID link URLs (Show link, Copy). */
  idLinkUrls: boolean;
  /** False for result lists and the duplicate panel on the phone (D40). */
  legalName: boolean;
  /** patient_candidates' p_sources. */
  sources: readonly NameKeySource[];
}

/**
 * The projection for a role's permissions on a surface. Pure. Everything in a summary and every
 * name key is open to patients.view in phase 3 (4.3), so every role searches all four sources; the
 * parameter stays for later projections.
 */
export function projectionFor(permissions: ReadonlySet<Permission>, surface: SurfaceValue): Projection {
  const problems = mayViewProblems(permissions);
  const sensitive = problems && permissions.has('patients.view_sensitive');
  const idLinkUrls = permissions.has('patients.edit');
  const legalName = surface !== 'phone';
  const parts = ['c1', problems && 'prob', sensitive && 'sens', idLinkUrls && 'url', !legalName && 'nolegal'];
  return {
    key: parts.filter((p) => p !== false).join('+'),
    problems,
    sensitive,
    idLinkUrls,
    legalName,
    sources: ['legal', 'preferred', 'alias', 'descriptor'],
  };
}

/**
 * Removes from a fully loaded chart what the caller's role may not see. A chart is the person's own
 * opened record, so it keeps the legal name on both surfaces (D40); `projection` names the result.
 */
export function projectChart(scope: TeamScope, chart: PatientChartValue): PatientChartValue {
  const p = projectionFor(scope.team.permissions, 'portal');
  const out: PatientChartValue = { ...chart, projection: p.key };
  if (!p.problems) {
    delete out.problems;
    delete out.problemHistory;
    delete out.problemNotes;
  } else if (!p.sensitive) {
    const hidden = new Set(
      (chart.problems ?? []).filter((r) => r.attributes.sensitive === true).map((r) => r.id),
    );
    out.problems = (chart.problems ?? []).filter((r) => !hidden.has(r.id));
    out.problemHistory = (chart.problemHistory ?? []).filter((e) => !hidden.has(e.problemId));
    out.problemNotes = (chart.problemNotes ?? []).filter((n) => !hidden.has(n.problemId));
  }
  out.idLinks = chart.idLinks.map((l) => {
    if (p.idLinkUrls) return l;
    const { url: _url, ...rest } = l;
    return rest;
  });
  return out;
}

/** Removes from a full summary what the caller's role may not see on that surface. */
export function projectSummary(
  scope: TeamScope,
  summary: PatientSummaryValue,
  surface: SurfaceValue,
): PatientSummaryValue {
  const p = projectionFor(scope.team.permissions, surface);
  const out = { ...summary };
  if (!p.legalName) delete out.legalName;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Summaries: who someone is, in a result list
// ------------------------------------------------------------------------------------------------

/** Street names a summary lists (PatientSummary.aliases). */
export const SUMMARY_ALIASES = 5;

// PLAN-OPEN: dates (age, last seen) are taken in UTC; a team time zone setting can come with
// routes (phase 7), when a run's day matters.
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Completed years from a birth to `today` (YYYY-MM-DD); a year or an estimate counts whole years. */
export function ageYears(birth: BirthValue | null, today: string): number | null {
  if (!birth) return null;
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  if (birth.precision !== 'day') return ty - birth.year;
  const [y, m, d] = birth.date.split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/** The patient row's birth as recorded; null when unknown. */
export function birthFromRow(r: {
  birthPrecision: string | null;
  birthDate: string | null;
  birthYear: number | null;
}): BirthValue | null {
  if (r.birthPrecision === 'day' && r.birthDate) return { precision: 'day', date: r.birthDate };
  if ((r.birthPrecision === 'year' || r.birthPrecision === 'estimated') && r.birthYear !== null)
    return { precision: r.birthPrecision, year: r.birthYear };
  return null;
}

/** The hint a chart, an index entry and a summary show while a pair is open or not sure (design 8.3). */
export interface DuplicateHintValue {
  status: 'open' | 'not_sure';
  note: string | null;
}

/**
 * Open and not-sure pairs touching each group, whose sides are still two patients; the most
 * recently flagged one's status and note. Keyed by canonical ID.
 */
export async function duplicateHints(
  tx: Tx,
  canonicalIds: readonly string[],
): Promise<Map<string, DuplicateHintValue>> {
  const out = new Map<string, DuplicateHintValue>();
  if (canonicalIds.length === 0) return out;
  const rows = await tx<{ canonicalId: string; status: 'open' | 'not_sure'; note: string | null }[]>`
    select distinct on (c.canonical_id) c.canonical_id, d.status, d.note
    from sineobex.duplicate_pairs d
    join sineobex.patients pa on pa.team_id = d.team_id and pa.id = d.patient_a
    join sineobex.patients pb on pb.team_id = d.team_id and pb.id = d.patient_b
    cross join lateral (values (pa.canonical_id), (pb.canonical_id)) as c(canonical_id)
    where d.team_id = sineobex.current_team_id() and d.status in ('open', 'not_sure')
      and pa.canonical_id <> pb.canonical_id and c.canonical_id = any (${[...canonicalIds]}::uuid[])
    order by c.canonical_id, d.last_flagged_at desc, d.id`;
  for (const r of rows) out.set(r.canonicalId, { status: r.status, note: r.note });
  return out;
}

/**
 * Full summaries (before projection) of the groups of these patients, keyed by each requested ID:
 * a merged ID gets its survivor's summary. Every value comes from the canonical record, except the
 * street names, allergies and last-seen date, which are the whole group's. IDs the team doesn't have
 * are left out. Search, the match check and the admin queues build their lists with this, then pass
 * each summary through `projectSummary`.
 */
export async function loadSummaries(
  tx: Tx,
  scope: TeamScope,
  patientIds: readonly string[],
): Promise<Map<string, PatientSummaryValue>> {
  const out = new Map<string, PatientSummaryValue>();
  if (patientIds.length === 0) return out;
  const requested = await tx<{ id: string; canonicalId: string }[]>`
    select id, canonical_id from sineobex.patients
    where team_id = sineobex.current_team_id() and id = any (${[...patientIds]}::uuid[])`;
  const canonical = [...new Set(requested.map((r) => r.canonicalId))];
  if (canonical.length === 0) return out;
  const rows = await tx<
    {
      id: string;
      preferredName: string | null;
      legalGivenName: string | null;
      legalFamilyName: string | null;
      visualDescriptor: string | null;
      birthPrecision: string | null;
      birthDate: string | null;
      birthYear: number | null;
      usualArea: string | null;
      allergyScreen: 'not_asked' | 'none_known';
      lastSeenAt: Date | null;
      allergyCount: number;
      severe: boolean;
      aliases: string[] | null;
    }[]
  >`
    select p.id, p.preferred_name, p.legal_given_name, p.legal_family_name, p.visual_descriptor,
           p.birth_precision, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date, p.birth_year, p.usual_area,
           p.allergy_screen,
           (select max(g.last_seen_at) from sineobex.patients g
            where g.team_id = p.team_id and g.canonical_id = p.id) as last_seen_at,
           (select count(*)::int from sineobex.patient_allergies a
            join sineobex.patients g on g.team_id = a.team_id and g.id = a.patient_id
            where a.team_id = p.team_id and g.canonical_id = p.id and a.status = 'active') as allergy_count,
           (select coalesce(bool_or(a.severity = 'severe'), false) from sineobex.patient_allergies a
            join sineobex.patients g on g.team_id = a.team_id and g.id = a.patient_id
            where a.team_id = p.team_id and g.canonical_id = p.id and a.status = 'active') as severe,
           (select array_agg(x.alias order by x.created_at, x.id) from (
              select a.alias, a.created_at, a.id from sineobex.patient_aliases a
              join sineobex.patients g on g.team_id = a.team_id and g.id = a.patient_id
              where a.team_id = p.team_id and g.canonical_id = p.id and a.status = 'active'
              order by a.created_at, a.id limit ${SUMMARY_ALIASES}) x) as aliases
    from sineobex.patients p
    where p.team_id = sineobex.current_team_id() and p.id = any (${canonical}::uuid[])`;
  const hints = await duplicateHints(tx, canonical);
  const today = isoDay(scope.deps.now());
  const byCanonical = new Map<string, PatientSummaryValue>();
  for (const r of rows) {
    const birth = birthFromRow(r);
    byCanonical.set(r.id, {
      preferredName: r.preferredName,
      legalName:
        r.legalGivenName === null && r.legalFamilyName === null
          ? null
          : { given: r.legalGivenName, family: r.legalFamilyName },
      aliases: r.aliases ?? [],
      visualDescriptor: r.visualDescriptor,
      birth,
      ageYears: ageYears(birth, today),
      usualArea: r.usualArea,
      lastSeenOn: r.lastSeenAt ? isoDay(r.lastSeenAt) : null,
      allergy: { screen: r.allergyScreen, count: r.allergyCount, severe: r.severe },
      duplicateHint: hints.has(r.id),
    });
  }
  for (const r of requested) {
    const s = byCanonical.get(r.canonicalId);
    if (s) out.set(r.id, s);
  }
  return out;
}
