import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { sha256Hex } from '../sync/canonical.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { sameValue } from '../sync/records.ts';
import { canonicalOf, patientValues, type PatientRow } from './charts.ts';
import { ESTIMATE_RANGE } from './match-constants.ts';
import type { BirthValue } from './matching.ts';
import { ageYears, birthFromRow, loadSummaries, projectSummary, SUMMARY_ALIASES } from './projection.ts';
import { recognisableAfter } from './recognisable.ts';
import type {
  MergePageValue,
  PageQueryValue,
  PatientSummaryValue,
  UndoMergeInput,
  UndoMergeResultValue,
} from './schemas.ts';

/**
 * Merges and their undo (phase 3 design 8.4, 8.5, D27, D39).
 *
 * A merge moves nothing: it writes patient rows only (status, merged_into, canonical_id), fills the
 * survivor's blanks from the merged record, and opens a field review for every field the two hold
 * differently. Child rows keep the patient ID they were stored with and every chart reads the group,
 * so undo is exact: it recomputes canonical_id down the merged record's subtree and reverts the
 * fills nobody has edited since. No ID link is retired by a merge, and undo gives each record back
 * the cards a regeneration retired while it was merged.
 *
 * Both run after the team lock and lock patient rows FOR NO KEY UPDATE, never FOR UPDATE: an
 * encounter or allergy insert's foreign key check holds FOR KEY SHARE on the patient, which FOR NO
 * KEY UPDATE never waits on, so a merge and a push have one lock order (D32).
 */

type MergeViewValue = UndoMergeResultValue['merge'];

/** The patient fields a merge compares, fills and reviews, as sync names them. */
export const MERGE_FIELDS = [
  'preferredName',
  'legalName',
  'visualDescriptor',
  'birth',
  'livingSituation',
  'usualArea',
  'preferredLanguage',
  'allergyScreen',
  'idCardChoice',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** Identity fields: a difference needs patients.correct_identity to decide (design 2.4). */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(['legalName', 'birth']);

/** Merges listed per page, newest first. */
const MERGE_PAGE = 50;

/** What audit details carry instead of a comment (D33). */
export const commentSha256 = (comment: string) => sha256Hex(comment);

// ------------------------------------------------------------------------------------------------
// Field rules
// ------------------------------------------------------------------------------------------------

type LegalNameValue = { given: string | null; family: string | null };

/** Nothing recorded: no value, or a question still "not asked". */
function blank(field: string, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return (field === 'allergyScreen' || field === 'idCardChoice') && v === 'not_asked';
}

const birthYear = (b: BirthValue) => (b.precision === 'day' ? Number(b.date.slice(0, 4)) : b.year);

/**
 * `v` keeps every recorded part of `cur` and only adds to it (design 2.4 `fills`): a blank takes
 * anything; a legal name gains a missing part; a birth year becomes a date in that year; an
 * estimate becomes a year or a date only within ESTIMATE_RANGE of it.
 */
export function fills(field: string, cur: unknown, v: unknown): boolean {
  if (blank(field, v) || sameValue(cur, v)) return false;
  if (blank(field, cur)) return true;
  if (field === 'legalName') {
    const c = cur as LegalNameValue;
    const n = v as LegalNameValue;
    return (c.given === null || c.given === n.given) && (c.family === null || c.family === n.family);
  }
  if (field === 'birth') {
    const c = cur as BirthValue;
    const n = v as BirthValue;
    if (c.precision === 'year') return n.precision === 'day' && birthYear(n) === c.year;
    if (c.precision === 'estimated')
      return n.precision !== 'estimated' && Math.abs(birthYear(n) - c.year) <= ESTIMATE_RANGE;
  }
  return false;
}

/** The columns a patient field is stored in. */
function columns(tx: Tx, field: MergeField, v: unknown) {
  switch (field) {
    case 'preferredName':
      return tx`preferred_name = ${v as string | null}`;
    case 'visualDescriptor':
      return tx`visual_descriptor = ${v as string | null}`;
    case 'usualArea':
      return tx`usual_area = ${v as string | null}`;
    case 'preferredLanguage':
      return tx`preferred_language = ${v as string | null}`;
    case 'allergyScreen':
      return tx`allergy_screen = ${v as string}`;
    case 'idCardChoice':
      return tx`id_card_choice = ${v as string}`;
    case 'legalName': {
      const n = v as LegalNameValue | null;
      return tx`legal_given_name = ${n?.given ?? null}, legal_family_name = ${n?.family ?? null}`;
    }
    case 'livingSituation': {
      const l = v as { kind: string; other?: string } | null;
      return tx`living_situation = ${l?.kind ?? null}, living_situation_other = ${l?.other ?? null}`;
    }
    case 'birth': {
      const b = v as BirthValue | null;
      return tx`birth_precision = ${b?.precision ?? null},
        birth_date = ${b?.precision === 'day' ? b.date : null}::date,
        birth_year = ${b ? birthYear(b) : null}::smallint`;
    }
  }
}

/** Writes one field of a patient row at `version`, as the sync path does: field version, meta, row version. */
async function writePatientField(
  tx: Tx,
  patientId: string,
  field: MergeField,
  value: unknown,
  version: number,
  meta: { by: string; at: string },
): Promise<void> {
  await tx`
    update sineobex.patients set ${columns(tx, field, value)},
      field_versions = field_versions || jsonb_build_object(${field}::text, ${version}::int),
      field_meta = field_meta || jsonb_build_object(${field}::text, ${tx.json({ ...meta, changeId: null })}::jsonb),
      version = version + 1
    where team_id = sineobex.current_team_id() and id = ${patientId}`;
}

interface HistoryRow {
  teamId: string;
  recordId: string;
  field: string;
  version: number;
  value: unknown;
  previousValue: unknown;
  kind: 'merge_fill' | 'merge_undone' | 'cleared_by_allergy' | 'kept_both';
  changedBy: string;
  approvedBy: string | null;
  changeId?: string | null;
  reviewId?: string | null;
}

async function appendPatientHistory(tx: Tx, e: HistoryRow): Promise<void> {
  await tx`
    insert into sineobex.field_history
      (team_id, entity, record_id, field, version, value, previous_value, kind, changed_by, approved_by,
       change_id, review_id)
    values (${e.teamId}, 'patient', ${e.recordId}, ${e.field}, ${e.version}, ${tx.json((e.value ?? null) as never)},
      ${tx.json((e.previousValue ?? null) as never)}, ${e.kind}, ${e.changedBy}, ${e.approvedBy},
      ${e.changeId ?? null}, ${e.reviewId ?? null})`;
}

async function loadPatients(tx: Tx, ids: readonly string[]): Promise<Map<string, PatientRow>> {
  const rows = await tx<PatientRow[]>`
    select id, team_id, status, merged_into, canonical_id, preferred_name, legal_given_name, legal_family_name,
      visual_descriptor, birth_precision, to_char(birth_date, 'YYYY-MM-DD') as birth_date, birth_year,
      living_situation, living_situation_other, usual_area, preferred_language, allergy_screen, id_card_choice,
      last_seen_at, registered_at, clock_verified, author_user_id, created_device_id, field_versions, field_meta,
      version, created_at, updated_at
    from sineobex.patients
    where team_id = sineobex.current_team_id() and id = any (${[...ids]}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** Whether any record of the group has an active allergy. */
async function groupHasAllergy(tx: Tx, canonicalId: string): Promise<boolean> {
  const [row] = await tx<{ any: boolean }[]>`
    select exists (
      select 1 from sineobex.patient_allergies a
      join sineobex.patients g on g.team_id = a.team_id and g.id = a.patient_id
      where a.team_id = sineobex.current_team_id() and g.canonical_id = ${canonicalId} and a.status = 'active'
    ) as any`;
  return row!.any;
}

// ------------------------------------------------------------------------------------------------
// Merge (design 8.4 steps 2-8; the decision, the pair lock and the row locks are the caller's)
// ------------------------------------------------------------------------------------------------

export interface MergeRecordsInput {
  mergeId: string;
  pairId: string;
  decisionId: string;
  survivorId: string;
  mergedId: string;
}

/**
 * Merges `mergedId` into `survivorId` inside the decision's transaction. The caller holds the team
 * lock, has locked both rows FOR NO KEY UPDATE, checked both are active at the versions the
 * reviewer saw, and inserted the decision row; it runs the survivor's re-match afterwards.
 */
export async function mergeRecords(
  tx: Tx,
  audit: AuditFn,
  scope: TeamScope,
  input: MergeRecordsInput,
): Promise<void> {
  const teamId = scope.team.teamId;
  const reviewer = scope.principal.userId;
  const meta = { by: reviewer, at: scope.deps.now().toISOString() };
  const { mergeId, pairId, decisionId, survivorId, mergedId } = input;

  // 2. The merged record and everything merged into it before now read as the survivor's group.
  const subtree = (
    await tx<{ id: string }[]>`
      update sineobex.patients set
        status = case when id = ${mergedId}::uuid then 'merged' else status end,
        merged_into = case when id = ${mergedId}::uuid then ${survivorId}::uuid else merged_into end,
        version = case when id = ${mergedId}::uuid then version + 1 else version end,
        canonical_id = ${survivorId}
      where team_id = ${teamId} and canonical_id = ${mergedId}
      returning id`
  ).map((r) => r.id);

  // 3 and 4. Fill the survivor's blanks; every other difference becomes a field review.
  const rows = await loadPatients(tx, [survivorId, mergedId]);
  const survivor = rows.get(survivorId)!;
  const merged = rows.get(mergedId)!;
  const kept = patientValues(survivor);
  const offered = patientValues(merged);
  const allergy = await groupHasAllergy(tx, survivorId);
  const filled: Record<string, number> = {};
  const reviewsOpened: string[] = [];
  for (const field of MERGE_FIELDS) {
    const cur = kept[field];
    const alt = offered[field];
    const version = survivor.fieldVersions[field] ?? 0;
    const writer = merged.fieldMeta[field]?.by ?? merged.authorUserId;
    if (field === 'allergyScreen' && allergy) {
      // An active allergy in the group wins over "none known", as an allergy create does (2.3).
      if (cur === 'none_known') {
        await writePatientField(tx, survivorId, field, 'not_asked', version + 1, meta);
        await appendPatientHistory(tx, {
          teamId,
          recordId: survivorId,
          field,
          version: version + 1,
          value: 'not_asked',
          previousValue: cur,
          kind: 'cleared_by_allergy',
          changedBy: reviewer,
          approvedBy: reviewer,
        });
        filled[field] = version + 1;
      }
      continue;
    }
    if (fills(field, cur, alt)) {
      await writePatientField(tx, survivorId, field, alt, version + 1, meta);
      await appendPatientHistory(tx, {
        teamId,
        recordId: survivorId,
        field,
        version: version + 1,
        value: alt,
        previousValue: cur,
        kind: 'merge_fill',
        changedBy: writer,
        approvedBy: reviewer,
      });
      filled[field] = version + 1;
      continue;
    }
    // Same, nothing offered, or the survivor already holds more of it (a date for a year).
    if (blank(field, alt) || sameValue(cur, alt) || fills(field, alt, cur)) continue;
    const reviewId = await openReview(tx, {
      teamId,
      survivorId,
      field,
      needs: IDENTITY_FIELDS.has(field) ? 'patients.correct_identity' : 'patients.edit',
      mergeId,
    });
    if (reviewId.opened) reviewsOpened.push(reviewId.id);
    await appendPatientHistory(tx, {
      teamId,
      recordId: survivorId,
      field,
      version,
      value: alt,
      previousValue: cur,
      kind: 'kept_both',
      changedBy: writer,
      approvedBy: null,
      changeId: merged.fieldMeta[field]?.changeId ?? null,
      reviewId: reviewId.id,
    });
  }

  // 5. ID links: nothing changes (D39). 6. The merged records' open reviews are obsolete: step 4
  // re-raised every real difference against the survivor.
  await tx`
    update sineobex.field_reviews set status = 'obsolete', decided_at = now()
    where team_id = ${teamId} and record_id = any (${subtree}::uuid[]) and status = 'open'`;

  // 7. Pairs this merge settles leave the queue, restorable by undo: those whose sides now share
  // the survivor, and those naming a record that is no longer canonical, which nobody could decide
  // (the survivor's re-match flags its group against the other side again).
  await tx`
    update sineobex.duplicate_pairs d set
      status_before_superseded = d.status, status = 'superseded', superseded_by_merge = ${mergeId}
    where d.team_id = ${teamId} and d.id <> ${pairId} and d.status in ('open', 'not_sure')
      and (d.patient_a = any (${subtree}::uuid[]) or d.patient_b = any (${subtree}::uuid[]))`;

  // 8. The merge row and the pair; the index version moves through the triggers.
  await tx`
    insert into sineobex.patient_merges
      (id, team_id, pair_id, survivor_id, merged_id, filled_fields, reviews_opened, decision_id, merged_by)
    values (${mergeId}, ${teamId}, ${pairId}, ${survivorId}, ${mergedId}, ${tx.json(filled)}, ${reviewsOpened}::uuid[],
      ${decisionId}, ${reviewer})`;
  await tx`
    update sineobex.duplicate_pairs set status = 'merged', decided_at = now(), decided_by = ${reviewer}
    where team_id = ${teamId} and id = ${pairId}`;
  for (const patientId of [survivorId, mergedId]) {
    await audit({
      action: 'patient.merged',
      entity: 'patient_merge',
      entityId: mergeId,
      patientId,
      details: { mergeId, survivorId, mergedId },
    });
  }
}

/** Opens the survivor's review of a field, or joins the one already open. */
async function openReview(
  tx: Tx,
  r: { teamId: string; survivorId: string; field: string; needs: string; mergeId: string },
): Promise<{ id: string; opened: boolean }> {
  const [open] = await tx<{ id: string; needs: string }[]>`
    select id, needs from sineobex.field_reviews
    where team_id = ${r.teamId} and entity = 'patient' and record_id = ${r.survivorId} and field = ${r.field}
      and status = 'open'
    for update`;
  if (open) return { id: open.id, opened: false };
  const [row] = await tx<{ id: string }[]>`
    insert into sineobex.field_reviews (team_id, patient_id, entity, record_id, field, needs, merge_id)
    values (${r.teamId}, ${r.survivorId}, 'patient', ${r.survivorId}, ${r.field}, ${r.needs}, ${r.mergeId})
    returning id`;
  return { id: row!.id, opened: true };
}

// ------------------------------------------------------------------------------------------------
// Summaries and views
// ------------------------------------------------------------------------------------------------

/**
 * Projected summaries of pair and merge sides, keyed by ID: a canonical patient's is its group's
 * (loadSummaries); a merged record's is its own, so a merge lists what was merged in, not the
 * survivor twice.
 */
export async function sideSummaries(
  tx: Tx,
  scope: TeamScope,
  ids: readonly string[],
): Promise<Map<string, PatientSummaryValue>> {
  const unique = [...new Set(ids)];
  const canonical = await canonicalOf(tx, unique);
  const live = unique.filter((id) => canonical.get(id) === id);
  const mergedIds = unique.filter((id) => canonical.has(id) && canonical.get(id) !== id);
  const out = new Map<string, PatientSummaryValue>();
  for (const [id, s] of await loadSummaries(tx, scope, live)) out.set(id, projectSummary(scope, s, 'portal'));
  if (mergedIds.length === 0) return out;
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
           p.allergy_screen, p.last_seen_at,
           (select count(*)::int from sineobex.patient_allergies a
            where a.team_id = p.team_id and a.patient_id = p.id and a.status = 'active') as allergy_count,
           (select coalesce(bool_or(a.severity = 'severe'), false) from sineobex.patient_allergies a
            where a.team_id = p.team_id and a.patient_id = p.id and a.status = 'active') as severe,
           (select array_agg(x.alias order by x.created_at, x.id) from (
              select a.alias, a.created_at, a.id from sineobex.patient_aliases a
              where a.team_id = p.team_id and a.patient_id = p.id and a.status = 'active'
              order by a.created_at, a.id limit ${SUMMARY_ALIASES}) x) as aliases
    from sineobex.patients p
    where p.team_id = sineobex.current_team_id() and p.id = any (${mergedIds}::uuid[])`;
  const today = scope.deps.now().toISOString().slice(0, 10);
  for (const r of rows) {
    const birth = birthFromRow(r);
    const summary: PatientSummaryValue = {
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
      lastSeenOn: r.lastSeenAt ? r.lastSeenAt.toISOString().slice(0, 10) : null,
      allergy: { screen: r.allergyScreen, count: r.allergyCount, severe: r.severe },
      duplicateHint: false,
    };
    out.set(r.id, projectSummary(scope, summary, 'portal'));
  }
  return out;
}

/**
 * Live merges made after this one that involve its survivor's group. Undo is refused while any
 * exists (409 undo_later_merge_first), so every undo is exact.
 */
async function laterMerges(
  tx: Tx,
  merge: { id: string; survivorId: string; mergedAt: Date },
): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    select distinct l.id from sineobex.patients s
    join sineobex.patients g on g.team_id = s.team_id and g.canonical_id = s.canonical_id
    join sineobex.patient_merges l on l.team_id = s.team_id and (l.survivor_id = g.id or l.merged_id = g.id)
    where s.team_id = sineobex.current_team_id() and s.id = ${merge.survivorId}
      and l.undone_at is null and l.id <> ${merge.id} and l.merged_at >= ${merge.mergedAt}`;
  return rows.map((r) => r.id);
}

interface MergeRow {
  id: string;
  pairId: string;
  survivorId: string;
  mergedId: string;
  mergedAt: Date;
  mergedBy: string;
  mergedByName: string;
  comment: string;
  undoneAt: Date | null;
  undoneBy: string | null;
  undoneByName: string | null;
  undoComment: string | null;
  onTop: boolean;
}

/** MergeViews in the order of `mergeIds`; the caller audits what it shows. */
export async function mergeViews(
  tx: Tx,
  scope: TeamScope,
  mergeIds: readonly string[],
): Promise<MergeViewValue[]> {
  if (mergeIds.length === 0) return [];
  const rows = await tx<MergeRow[]>`
    select m.id, m.pair_id, m.survivor_id, m.merged_id, m.merged_at, m.merged_by, mb.display_name as merged_by_name,
           d.comment, m.undone_at, m.undone_by, ub.display_name as undone_by_name, ud.comment as undo_comment,
           exists (
             select 1 from sineobex.patients s
             join sineobex.patients g on g.team_id = s.team_id and g.canonical_id = s.canonical_id
             join sineobex.patient_merges l on l.team_id = s.team_id and (l.survivor_id = g.id or l.merged_id = g.id)
             where s.team_id = m.team_id and s.id = m.survivor_id
               and l.undone_at is null and l.id <> m.id and l.merged_at >= m.merged_at
           ) as on_top
    from sineobex.patient_merges m
    join sineobex.duplicate_decisions d on d.id = m.decision_id
    join sineobex.users mb on mb.id = m.merged_by
    left join sineobex.users ub on ub.id = m.undone_by
    left join sineobex.duplicate_decisions ud on ud.id = m.undo_decision_id
    where m.team_id = sineobex.current_team_id() and m.id = any (${[...mergeIds]}::uuid[])`;
  const summaries = await sideSummaries(
    tx,
    scope,
    rows.flatMap((r) => [r.survivorId, r.mergedId]),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const mayUndo = scope.can('patients.correct_identity');
  return mergeIds.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    return [
      {
        id: r.id,
        pairId: r.pairId,
        survivor: { patientId: r.survivorId, summary: summaries.get(r.survivorId) ?? {} },
        merged: { patientId: r.mergedId, summary: summaries.get(r.mergedId) ?? {} },
        comment: r.comment,
        mergedBy: { userId: r.mergedBy, displayName: r.mergedByName },
        mergedAt: r.mergedAt.toISOString(),
        undone:
          r.undoneAt && r.undoneBy
            ? {
                by: { userId: r.undoneBy, displayName: r.undoneByName ?? '' },
                at: r.undoneAt.toISOString(),
                comment: r.undoComment ?? '',
              }
            : null,
        undoable: mayUndo && r.undoneAt === null && !r.onTop,
      },
    ];
  });
}

/**
 * GET /v1/team/merges: recent merges, newest first. `undoable` only for a caller with
 * patients.correct_identity. Audited as `merges.viewed {count, patientIds}` with both patients of
 * every listed merge (D33).
 */
export async function listMerges(scope: TeamScope, query: PageQueryValue): Promise<MergePageValue> {
  return scope.tx(async (tx, audit) => {
    const rows = await tx<{ id: string; survivorId: string; mergedId: string }[]>`
      select m.id, m.survivor_id, m.merged_id from sineobex.patient_merges m
      where m.team_id = sineobex.current_team_id()
        ${
          query.afterId
            ? tx`and (m.merged_at, m.id) < (
                select a.merged_at, a.id from sineobex.patient_merges a
                where a.team_id = m.team_id and a.id = ${query.afterId})`
            : tx``
        }
      order by m.merged_at desc, m.id desc
      limit ${MERGE_PAGE + 1}`;
    const page = rows.slice(0, MERGE_PAGE);
    const merges = await mergeViews(
      tx,
      scope,
      page.map((r) => r.id),
    );
    await audit({
      action: 'merges.viewed',
      patientId: null,
      details: {
        count: merges.length,
        patientIds: [...new Set(page.flatMap((r) => [r.survivorId, r.mergedId]))],
      },
    });
    return { merges, nextAfterId: rows.length > MERGE_PAGE ? page.at(-1)!.id : null };
  });
}

// ------------------------------------------------------------------------------------------------
// Undo (design 8.5)
// ------------------------------------------------------------------------------------------------

/**
 * POST /v1/team/merges/{mergeId}/undo (phase 3 design 8.5): an identity correction, so
 * patients.correct_identity with a recent sign-in. Refused with 409 undo_later_merge_first while a
 * later live merge involves the survivor's group. Each record gets its own ID links back (D39).
 */
export async function undoMerge(
  scope: TeamScope,
  mergeId: string,
  input: UndoMergeInput,
): Promise<UndoMergeResultValue> {
  const teamId = scope.team.teamId;
  const by = scope.principal.userId;
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, teamId);
    const [merge] = await tx<
      {
        id: string;
        pairId: string;
        survivorId: string;
        mergedId: string;
        mergedAt: Date;
        undoneAt: Date | null;
        filledFields: Record<string, number>;
        reviewsOpened: string[];
      }[]
    >`
      select id, pair_id, survivor_id, merged_id, merged_at, undone_at, filled_fields, reviews_opened
      from sineobex.patient_merges
      where team_id = sineobex.current_team_id() and id = ${mergeId}
      for update`;
    if (!merge) throw notFound('merge');
    if (merge.undoneAt) throw conflict('already_undone', 'This merge was already undone.');
    const later = await laterMerges(tx, merge);
    if (later.length > 0) {
      throw conflict('undo_later_merge_first', 'Undo the later merge on this chart first.', {
        mergeIds: later,
      });
    }
    const { survivorId, mergedId } = merge;

    // The whole group, rows in ID order: the survivor is canonical, or a later merge would be live.
    await tx`
      select id from sineobex.patients
      where team_id = ${teamId} and canonical_id = ${survivorId}
      order by id
      for no key update`;

    // 1. The merged record and its subtree (records merged into it earlier) are their own group again.
    const subtree = (
      await tx<{ id: string }[]>`
        with recursive sub (id) as (
          select ${mergedId}::uuid
          union
          select p.id from sineobex.patients p join sub on p.merged_into = sub.id
          where p.team_id = ${teamId}
        )
        select id from sub`
    ).map((r) => r.id);
    await tx`
      update sineobex.patients set
        status = case when id = ${mergedId}::uuid then 'active' else status end,
        merged_into = case when id = ${mergedId}::uuid then null else merged_into end,
        version = case when id = ${mergedId}::uuid then version + 1 else version end,
        canonical_id = ${mergedId}
      where team_id = ${teamId} and id = any (${subtree}::uuid[])`;

    // 2. Fills nobody has edited since go back, unless that would leave nobody recognisable.
    const survivor = (await loadPatients(tx, [survivorId])).get(survivorId)!;
    const values = patientValues(survivor);
    const allergy = await groupHasAllergy(tx, survivorId);
    const revertedFields: string[] = [];
    const keptFields: string[] = [];
    for (const field of MERGE_FIELDS) {
      const version = merge.filledFields[field];
      if (version === undefined) continue;
      if ((survivor.fieldVersions[field] ?? 0) !== version) {
        keptFields.push(field);
        continue;
      }
      const [written] = await tx<{ previousValue: unknown }[]>`
        select previous_value from sineobex.field_history
        where team_id = ${teamId} and entity = 'patient' and record_id = ${survivorId} and field = ${field}
          and version = ${version} and kind in ('merge_fill', 'cleared_by_allergy')
        order by id desc limit 1`;
      const before = written?.previousValue ?? null;
      const stale = field === 'allergyScreen' && before === 'none_known' && allergy;
      if (stale || !recognisableAfter({ values }, field, before)) {
        keptFields.push(field);
        continue;
      }
      await writePatientField(tx, survivorId, field, before, version + 1, {
        by,
        at: scope.deps.now().toISOString(),
      });
      await appendPatientHistory(tx, {
        teamId,
        recordId: survivorId,
        field,
        version: version + 1,
        value: before,
        previousValue: values[field],
        kind: 'merge_undone',
        changedBy: by,
        approvedBy: null,
      });
      values[field] = before;
      revertedFields.push(field);
    }

    // 3. Reviews this merge opened and nobody decided are moot.
    const closed = await tx`
      update sineobex.field_reviews set status = 'obsolete', decided_at = now()
      where team_id = ${teamId} and id = any (${merge.reviewsOpened}::uuid[]) and status = 'open'
      returning id`;

    // 4. ID links (D39): a card of the subtree that a regeneration on the group retired while the
    // merge was live is active again. No subtree row gained an active link meanwhile (issuing
    // targets the canonical record), so one per record holds.
    const restored = await tx<{ id: string; tokenRef: string; patientId: string }[]>`
      with candidates as (
        select distinct on (l.patient_id) l.id
        from sineobex.patient_id_links l
        join sineobex.patient_id_links r on r.team_id = l.team_id and r.id = l.retired_by_link
        where l.team_id = ${teamId} and l.patient_id = any (${subtree}::uuid[]) and l.status = 'retired'
          and l.retired_at >= ${merge.mergedAt} and r.patient_id <> all (${subtree}::uuid[])
        order by l.patient_id, l.retired_at desc, l.id
      )
      update sineobex.patient_id_links l set
        status = 'active', retired_reason = null, retired_by_link = null, retired_at = null,
        restored_at = now(), restored_by_merge = ${mergeId}
      from candidates c
      where l.id = c.id
      returning l.id, left(l.token_hash, 12) as token_ref, l.patient_id`;
    const issuedWhileMerged = await tx<
      { id: string; tokenRef: string; patientId: string; reason: string; effectiveAt: Date }[]
    >`
      select l.id, left(l.token_hash, 12) as token_ref, l.patient_id, l.reason, l.effective_at
      from sineobex.patient_id_links l
      join sineobex.patients g on g.team_id = l.team_id and g.id = l.patient_id
      where l.team_id = ${teamId} and g.canonical_id = ${survivorId} and l.status = 'active'
        and l.received_at >= ${merge.mergedAt}
      order by l.received_at, l.id`;

    // 5. Pairs this merge superseded come back as they were; the merged pair must be decided again.
    await tx`
      update sineobex.duplicate_pairs set
        status = status_before_superseded, status_before_superseded = null, superseded_by_merge = null
      where team_id = ${teamId} and superseded_by_merge = ${mergeId} and status = 'superseded'`;
    await tx`
      update sineobex.duplicate_pairs set status = 'open', decided_at = null, decided_by = null
      where team_id = ${teamId} and id = ${merge.pairId}`;
    const [decision] = await tx<{ id: string }[]>`
      insert into sineobex.duplicate_decisions (team_id, pair_id, decision, comment, merge_id, decided_by)
      values (${teamId}, ${merge.pairId}, 'undo_merge', ${input.comment}, ${mergeId}, ${by})
      returning id`;
    await tx`
      update sineobex.patient_merges set
        undone_at = now(), undone_by = ${by}, undo_decision_id = ${decision!.id},
        restored_link_ids = ${restored.map((l) => l.id)}::uuid[]
      where id = ${mergeId}`;

    // 6. The reason, on both charts, and the audit events.
    const sha = await commentSha256(input.comment);
    for (const patientId of [survivorId, mergedId]) {
      await tx`
        insert into sineobex.patient_corrections (team_id, patient_id, kind, entity, record_id, reason, decided_by)
        values (${teamId}, ${patientId}, 'merge_undo', 'patient', ${patientId}, ${input.comment}, ${by})`;
      await audit({
        action: 'patient.merge_undone',
        entity: 'patient_merge',
        entityId: mergeId,
        patientId,
        details: { mergeId, decisionId: decision!.id, commentSha256: sha },
      });
    }
    for (const l of restored) {
      await audit({
        action: 'id_link.restored',
        entity: 'patient_id_link',
        entityId: l.id,
        patientId: l.patientId,
        details: { linkId: l.id, tokenRef: l.tokenRef, mergeId },
      });
    }

    // Edits sent to a record of the subtree while merged were applied to the survivor (2.7): the
    // one thing undo can't decide, so the admin moves them by hand.
    const redirected = await tx<
      { historyId: string; field: string; recordedAt: Date; changedBy: string; displayName: string }[]
    >`
      select h.id::text as history_id, h.field, h.recorded_at, h.changed_by, u.display_name
      from sineobex.field_history h
      join sineobex.sync_changes c on c.change_id = h.change_id
      join sineobex.users u on u.id = h.changed_by
      where h.team_id = ${teamId} and h.entity = 'patient' and h.kind = 'redirected'
        and h.recorded_at >= ${merge.mergedAt} and c.record_id = any (${subtree}::uuid[])
      order by h.id`;

    const [view] = await mergeViews(tx, scope, [mergeId]);
    return {
      merge: view!,
      revertedFields,
      keptFields,
      reviewsClosed: closed.length,
      redirectedEdits: redirected.map((r) => ({
        historyId: r.historyId,
        field: r.field,
        at: r.recordedAt.toISOString(),
        by: { userId: r.changedBy, displayName: r.displayName },
      })),
      restoredLinks: restored.map((l) => ({ linkId: l.id, tokenRef: l.tokenRef, issuedOn: l.patientId })),
      linksIssuedWhileMerged: issuedWhileMerged.map((l) => ({
        linkId: l.id,
        tokenRef: l.tokenRef,
        issuedOn: l.patientId,
        reason: l.reason as UndoMergeResultValue['linksIssuedWhileMerged'][number]['reason'],
        effectiveAt: l.effectiveAt.toISOString(),
      })),
    };
  });
}
