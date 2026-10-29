import { randomUUID } from 'node:crypto';
import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { conflict, invalid, notFound } from '../lib/errors.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { sameValue } from '../sync/records.ts';
import {
  findMatches,
  loadGroups,
  loadMatchSubject,
  phoneticCodes,
  suppressedCanonicals,
} from './candidates.ts';
import { canonicalOf, loadChart } from './charts.ts';
import { CANDIDATE_LIMIT, QUEUE_THRESHOLD } from './match-constants.ts';
import { bandOf, phoneticTokens, scoreMatch, type Scored } from './matching.ts';
import { commentSha256, MERGE_FIELDS, mergeRecords, mergeViews, sideSummaries } from './merges.ts';
import type {
  DecideDuplicateInput,
  DuplicateDecisionResultValue,
  DuplicatePageValue,
  DuplicatePairDetailValue,
  DuplicatePairSummaryValue,
  DuplicateQueryValue,
  FlagDuplicateInput,
} from './schemas.ts';

/** Why a patient is matched again (duplicate_pairs.sources). */
export type RematchSource = 'sync' | 'edit' | 'merge_rematch' | 'correction';

export interface RematchOptions {
  /** Patients the creator was shown at intake (matchCheck.shown). */
  shown?: readonly string[];
  /** Patients the creator dismissed as "Not them" (matchCheck.dismissed): marked creator_dismissed. */
  dismissed?: readonly string[];
}

export interface RematchResult {
  /** Pairs inserted, or refreshed while open or not sure, with the other canonical patient. */
  flagged: { pairId: string; otherId: string; score: number; created: boolean }[];
  /** A pair was flagged against a patient the creator was not shown (receipt details.possibleDuplicate). */
  possibleDuplicate: boolean;
}

/** Every candidate at or above QUEUE_THRESHOLD is queued, not only the few the intake panel shows. */
const REMATCH_LIMIT = CANDIDATE_LIMIT;

interface Carried {
  note: string | null;
  creatorDismissed: boolean;
}

/**
 * What superseded pairs between this group and each candidate's knew: a merge supersedes a pair
 * naming the merged record, and the survivor's re-match flags the groups again (8.4 step 7), so
 * the new pair keeps the latest Not sure note and the creator's "Not them".
 */
async function carriedOver(tx: Tx, self: string, others: readonly string[]): Promise<Map<string, Carried>> {
  const rows = await tx<({ other: string } & Carried)[]>`
    select c.other, bool_or(d.creator_dismissed) as creator_dismissed,
           (array_agg(d.note order by d.last_flagged_at desc) filter (where d.note is not null))[1] as note
    from sineobex.duplicate_pairs d
    join sineobex.patients pa on pa.team_id = d.team_id and pa.id = d.patient_a
    join sineobex.patients pb on pb.team_id = d.team_id and pb.id = d.patient_b
    cross join lateral (
      select case when pa.canonical_id = ${self}::uuid then pb.canonical_id else pa.canonical_id end as other
    ) c
    where d.team_id = sineobex.current_team_id() and d.status = 'superseded'
      and ${self}::uuid in (pa.canonical_id, pb.canonical_id) and c.other = any (${[...others]}::uuid[])
    group by c.other`;
  return new Map(rows.map((r) => [r.other, { note: r.note, creatorDismissed: r.creatorDismissed }]));
}

/**
 * The server's re-run of matching (phase 3 design 8.2), inside the caller's transaction with the
 * team lock already held (lockTeamWrites): every accepted patient create ('sync'), every accepted
 * change to preferredName, legalName, birth or an alias ('edit'), every correction and identity
 * review decision ('correction'), and for the survivor after a merge ('merge_rematch'). Skips the
 * patient's own group and suppressed pairs, upserts every candidate at or above QUEUE_THRESHOLD and
 * audits `duplicate.flagged {pairId, score, sources}` with both IDs in details.patientIds.
 *
 * It takes no lock of its own (D32): pair rows are only written under the team lock, which the
 * caller holds. A patient the team doesn't have, or one with no name to match, flags nothing.
 * Refreshing an open or not-sure pair keeps the higher score, adds the source and moves
 * last_flagged_at; a decided pair is left alone. A creator's "Not them" never suppresses a pair.
 */
export async function rematchPatient(
  tx: Tx,
  audit: AuditFn,
  patientId: string,
  source: RematchSource,
  options: RematchOptions = {},
): Promise<RematchResult> {
  const none: RematchResult = { flagged: [], possibleDuplicate: false };
  const [own] = await tx<{ teamId: string; canonicalId: string }[]>`
    select team_id, canonical_id from sineobex.patients
    where team_id = sineobex.current_team_id() and id = ${patientId}`;
  if (!own) return none;
  const self = own.canonicalId;
  const subject = await loadMatchSubject(tx, self);
  if (!subject || subject.names.length === 0) return none;
  const exclude = await suppressedCanonicals(tx, self);
  exclude.add(self);
  const found = await findMatches(tx, subject, { exclude, minScore: QUEUE_THRESHOLD, limit: REMATCH_LIMIT });
  if (found.length === 0) return none;

  // What the creator saw may name a patient merged since: compare groups, not IDs.
  const intake = await canonicalOf(tx, [...(options.shown ?? []), ...(options.dismissed ?? [])]);
  const groups = (ids: readonly string[] = []) =>
    new Set(ids.flatMap((id) => (intake.has(id) ? [intake.get(id)!] : [])));
  const dismissed = groups(options.dismissed);
  const shown = new Set([...groups(options.shown), ...dismissed]);

  const carried =
    source === 'merge_rematch'
      ? await carriedOver(
          tx,
          self,
          found.map((f) => f.canonicalId),
        )
      : new Map<string, Carried>();

  const flagged: RematchResult['flagged'] = [];
  for (const f of found) {
    const [a, b] = self < f.canonicalId ? [self, f.canonicalId] : [f.canonicalId, self];
    const before = carried.get(f.canonicalId);
    // A decided pair (keep separate, merged, superseded) is left as it is: the `where` returns no row.
    const [row] = await tx<{ id: string; created: boolean; score: string; sources: string[] }[]>`
      insert into sineobex.duplicate_pairs as d
        (team_id, patient_a, patient_b, score, reasons, sources, creator_dismissed, note)
      values (${own.teamId}, ${a}, ${b}, ${f.score}, ${f.reasons}::text[], ${[source]}::text[],
        ${dismissed.has(f.canonicalId) || (before?.creatorDismissed ?? false)}, ${before?.note ?? null})
      on conflict (team_id, patient_a, patient_b) do update set
        score = greatest(d.score, excluded.score),
        reasons = case when excluded.score > d.score then excluded.reasons else d.reasons end,
        sources = case when ${source}::text = any (d.sources) then d.sources else d.sources || excluded.sources end,
        creator_dismissed = d.creator_dismissed or excluded.creator_dismissed,
        note = coalesce(d.note, excluded.note),
        last_flagged_at = now()
      where d.status in ('open', 'not_sure')
      returning d.id, (xmax = 0) as created, d.score, d.sources`;
    if (!row) continue;
    flagged.push({ pairId: row.id, otherId: f.canonicalId, score: Number(row.score), created: row.created });
    if (row.created) {
      await audit({
        action: 'duplicate.flagged',
        entity: 'duplicate_pair',
        entityId: row.id,
        patientId: null,
        details: { pairId: row.id, score: Number(row.score), sources: row.sources, patientIds: [a, b] },
      });
    }
  }
  return { flagged, possibleDuplicate: flagged.some((f) => !shown.has(f.otherId)) };
}

// ------------------------------------------------------------------------------------------------
// The queue (design 8.3)
// ------------------------------------------------------------------------------------------------

type PairSummary = DuplicatePairSummaryValue;
type PairSideValue = DuplicatePairDetailValue['a'];

/** Pairs listed per page, oldest flagged first. */
const QUEUE_PAGE = 50;

/** Recent encounters a pair side lists (dates and kinds only). */
const PAIR_ENCOUNTERS = 5;

// PLAN-OPEN: how long after its device time an intake may arrive and still count as made online
// (PairSide.createdHow). Phones sync within seconds when they have signal.
const OFFLINE_AFTER_MINUTES = 10;

interface PairRow {
  id: string;
  patientA: string;
  patientB: string;
  status: PairSummary['status'];
  score: string;
  reasons: PairSummary['reasons'];
  sources: PairSummary['sources'];
  creatorDismissed: boolean;
  note: string | null;
  firstFlaggedAt: Date;
  lastFlaggedAt: Date;
  decidedAt: Date | null;
}

const PAIR_COLUMNS = (tx: Tx) => tx`
  d.id, d.patient_a, d.patient_b, d.status, d.score::text as score, d.reasons, d.sources, d.creator_dismissed,
  d.note, d.first_flagged_at, d.last_flagged_at, d.decided_at`;

async function loadPair(tx: Tx, pairId: string, lock = false): Promise<PairRow | null> {
  const [row] = await tx<PairRow[]>`
    select ${PAIR_COLUMNS(tx)} from sineobex.duplicate_pairs d
    where d.team_id = sineobex.current_team_id() and d.id = ${pairId}
    ${lock ? tx`for update` : tx``}`;
  return row ?? null;
}

/** Summaries of pairs, in order, both sides projected; a pair whose side the team lacks is left out. */
async function pairSummaries(tx: Tx, scope: TeamScope, rows: readonly PairRow[]): Promise<PairSummary[]> {
  const summaries = await sideSummaries(
    tx,
    scope,
    rows.flatMap((r) => [r.patientA, r.patientB]),
  );
  return rows.flatMap((r) => {
    const a = summaries.get(r.patientA);
    const b = summaries.get(r.patientB);
    if (!a || !b) return [];
    const score = Number(r.score);
    return [
      {
        id: r.id,
        a: { patientId: r.patientA, summary: a },
        b: { patientId: r.patientB, summary: b },
        status: r.status,
        score,
        band: bandOf(score),
        reasons: r.reasons,
        sources: r.sources,
        creatorDismissed: r.creatorDismissed,
        note: r.note,
        firstFlaggedAt: r.firstFlaggedAt.toISOString(),
        lastFlaggedAt: r.lastFlaggedAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      },
    ];
  });
}

/**
 * GET /v1/team/duplicates: open and not-sure pairs (or decided ones), oldest flagged first. A pair
 * in the queue lists only while both its sides are canonical: a merge settles the others (8.4 step
 * 7). Not sure leaves decided_at null, so such a pair is still waiting. Audited as
 * `duplicates.viewed {status, count, patientIds}`.
 */
export async function listDuplicates(
  scope: TeamScope,
  query: DuplicateQueryValue,
): Promise<DuplicatePageValue> {
  const statuses =
    query.status === 'open'
      ? ['open', 'not_sure']
      : query.status === 'not_sure'
        ? ['not_sure']
        : ['keep_separate', 'merged'];
  return scope.tx(async (tx, audit) => {
    const rows = await tx<PairRow[]>`
      select ${PAIR_COLUMNS(tx)} from sineobex.duplicate_pairs d
      join sineobex.patients pa on pa.team_id = d.team_id and pa.id = d.patient_a
      join sineobex.patients pb on pb.team_id = d.team_id and pb.id = d.patient_b
      where d.team_id = sineobex.current_team_id() and d.status = any (${statuses}::text[])
        ${query.status === 'decided' ? tx`` : tx`and pa.status = 'active' and pb.status = 'active'`}
        ${
          query.afterId
            ? tx`and (d.last_flagged_at, d.id) > (
                select x.last_flagged_at, x.id from sineobex.duplicate_pairs x
                where x.team_id = d.team_id and x.id = ${query.afterId})`
            : tx``
        }
      order by d.last_flagged_at, d.id
      limit ${QUEUE_PAGE + 1}`;
    const page = rows.slice(0, QUEUE_PAGE);
    const pairs = await pairSummaries(tx, scope, page);
    await audit({
      action: 'duplicates.viewed',
      patientId: null,
      details: {
        status: query.status,
        count: pairs.length,
        patientIds: [...new Set(pairs.flatMap((p) => [p.a.patientId, p.b.patientId]))],
      },
    });
    return { pairs, nextAfterId: rows.length > QUEUE_PAGE ? page.at(-1)!.id : null };
  });
}

/** One side of the pair page: the group's chart, and how and by whom this record was made. */
async function pairSide(tx: Tx, scope: TeamScope, patientId: string): Promise<PairSideValue> {
  const chart = await loadChart(tx, scope, patientId);
  const [own] = await tx<
    { version: number; authorUserId: string; displayName: string; offline: boolean | null }[]
  >`
    select p.version, p.author_user_id, u.display_name,
      (select coalesce(c.corrected_time, c.device_time) < c.received_at - make_interval(mins => ${OFFLINE_AFTER_MINUTES})
       from sineobex.sync_changes c
       where c.team_id = p.team_id and c.record_id = p.id and c.entity = 'patient' and c.op = 'create'
         and c.status = 'accepted'
       limit 1) as offline
    from sineobex.patients p join sineobex.users u on u.id = p.author_user_id
    where p.team_id = sineobex.current_team_id() and p.id = ${patientId}`;
  if (!chart || !own) throw notFound('patient');
  const encounters = await tx<{ id: string; startedAt: Date; kind: string }[]>`
    select e.id, e.started_at, e.kind from sineobex.encounters e
    join sineobex.patients g on g.team_id = e.team_id and g.id = e.patient_id
    where e.team_id = sineobex.current_team_id() and g.canonical_id = ${chart.canonicalId}
    order by e.started_at desc, e.id
    limit ${PAIR_ENCOUNTERS}`;
  return {
    chart,
    version: own.version,
    recentEncounters: encounters.map((e) => ({
      id: e.id,
      startedAt: e.startedAt.toISOString(),
      kind: e.kind,
    })),
    photoId: null,
    createdHow: own.offline === null ? 'unknown' : own.offline ? 'phone_offline' : 'phone',
    createdBy: { userId: own.authorUserId, displayName: own.displayName },
  };
}

/**
 * GET /v1/team/duplicates/{pairId}: both records side by side, Same or Differs on every field, and
 * every decision so far. One `duplicate.pair_viewed {pairId}` per patient shown, so each patient's
 * access report finds it.
 */
export async function getDuplicatePair(scope: TeamScope, pairId: string): Promise<DuplicatePairDetailValue> {
  return scope.tx(async (tx, audit) => {
    const row = await loadPair(tx, pairId);
    if (!row) throw notFound('duplicate pair');
    const [pair] = await pairSummaries(tx, scope, [row]);
    if (!pair) throw notFound('duplicate pair');
    const a = await pairSide(tx, scope, row.patientA);
    const b = await pairSide(tx, scope, row.patientB);
    const compared = MERGE_FIELDS.map((field) => ({
      field,
      same: sameValue(a.chart.patient.fields[field]?.value, b.chart.patient.fields[field]?.value),
    }));
    const decisions = await tx<
      {
        id: string;
        decision: DuplicatePairDetailValue['decisions'][number]['decision'];
        comment: string;
        survivorId: string | null;
        mergeId: string | null;
        decidedBy: string;
        displayName: string;
        decidedAt: Date;
      }[]
    >`
      select d.id, d.decision, d.comment, d.survivor_id, d.merge_id, d.decided_by, u.display_name, d.decided_at
      from sineobex.duplicate_decisions d join sineobex.users u on u.id = d.decided_by
      where d.team_id = sineobex.current_team_id() and d.pair_id = ${pairId}
      order by d.decided_at, d.id`;
    const shown = new Set([row.patientA, row.patientB, a.chart.canonicalId, b.chart.canonicalId]);
    for (const patientId of shown) {
      await audit({
        action: 'duplicate.pair_viewed',
        entity: 'duplicate_pair',
        entityId: pairId,
        patientId,
        details: { pairId },
      });
    }
    return {
      pair,
      a,
      b,
      compared,
      decisions: decisions.map((d) => ({
        id: d.id,
        decision: d.decision,
        comment: d.comment,
        survivorId: d.survivorId,
        mergeId: d.mergeId,
        decidedBy: { userId: d.decidedBy, displayName: d.displayName },
        decidedAt: d.decidedAt.toISOString(),
      })),
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Decisions (design 8.4)
// ------------------------------------------------------------------------------------------------

/**
 * POST /v1/team/duplicates/{pairId}/decision: merge, keep separate or not sure, with a comment and
 * the versions the reviewer saw (409 pair_changed, 409 already_decided). A merge runs in this
 * transaction, team lock first (design 8.4).
 *
 * Not sure keeps the pair in the queue (decided_at stays null) and its optional field note becomes
 * the note field staff see on both charts; a later Not sure without a note keeps the earlier one.
 * Keep separate starts suppression (8.6). Audited as `duplicate.decided {pairId, decision,
 * decisionId, commentSha256}` once per patient, and a merge as `patient.merged` once per patient.
 */
export async function decideDuplicate(
  scope: TeamScope,
  pairId: string,
  input: DecideDuplicateInput,
): Promise<DuplicateDecisionResultValue> {
  const teamId = scope.team.teamId;
  const by = scope.principal.userId;
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, teamId);
    const pair = await loadPair(tx, pairId, true);
    if (!pair) throw notFound('duplicate pair');
    if (pair.status !== 'open' && pair.status !== 'not_sure')
      throw conflict('already_decided', 'This pair was already decided.');
    // Never FOR UPDATE: it would wait on the FOR KEY SHARE an encounter or allergy insert holds (D32).
    const rows = await tx<{ id: string; status: string; version: number }[]>`
      select id, status, version from sineobex.patients
      where team_id = ${teamId} and id in (${pair.patientA}, ${pair.patientB})
      order by id
      for no key update`;
    const a = rows.find((r) => r.id === pair.patientA);
    const b = rows.find((r) => r.id === pair.patientB);
    if (
      a?.status !== 'active' ||
      b?.status !== 'active' ||
      a.version !== input.versions.a ||
      b.version !== input.versions.b
    ) {
      throw conflict('pair_changed', 'One of these records changed. Look at the pair again.', {
        versions: { a: a?.version ?? null, b: b?.version ?? null },
      });
    }
    let merge: { mergeId: string; survivorId: string; mergedId: string } | null = null;
    if (input.decision === 'merge') {
      const survivorId = input.survivorId!;
      if (survivorId !== pair.patientA && survivorId !== pair.patientB)
        throw invalid('survivor_not_in_pair', 'Keep one of the two records in this pair.');
      const mergedId = survivorId === pair.patientA ? pair.patientB : pair.patientA;
      merge = { mergeId: randomUUID(), survivorId, mergedId };
    }

    const [decision] = await tx<{ id: string }[]>`
      insert into sineobex.duplicate_decisions (team_id, pair_id, decision, comment, survivor_id, merge_id, decided_by)
      values (${teamId}, ${pairId}, ${input.decision}, ${input.comment}, ${merge?.survivorId ?? null},
        ${merge?.mergeId ?? null}, ${by})
      returning id`;
    const decisionId = decision!.id;
    if (input.decision === 'keep_separate') {
      await tx`
        update sineobex.duplicate_pairs set status = 'keep_separate', decided_at = now(), decided_by = ${by}
        where team_id = ${teamId} and id = ${pairId}`;
    } else if (input.decision === 'not_sure') {
      await tx`
        update sineobex.duplicate_pairs set status = 'not_sure', note = coalesce(${input.fieldNote ?? null}, note)
        where team_id = ${teamId} and id = ${pairId}`;
    } else if (merge) {
      await mergeRecords(tx, audit, scope, { ...merge, pairId, decisionId });
      await rematchPatient(tx, audit, merge.survivorId, 'merge_rematch');
    }

    const sha = await commentSha256(input.comment);
    for (const patientId of [pair.patientA, pair.patientB]) {
      await audit({
        action: 'duplicate.decided',
        entity: 'duplicate_pair',
        entityId: pairId,
        patientId,
        details: { pairId, decision: input.decision, decisionId, commentSha256: sha },
      });
    }
    const [summary] = await pairSummaries(tx, scope, [(await loadPair(tx, pairId))!]);
    const [view] = merge ? await mergeViews(tx, scope, [merge.mergeId]) : [];
    return { pair: summary!, merge: view ?? null };
  });
}

/** How alike two groups are, for a pair staff flagged by hand; null when either has no name. */
async function scorePair(tx: Tx, x: string, y: string): Promise<Scored | null> {
  const subject = await loadMatchSubject(tx, x);
  const group = (await loadGroups(tx, [y], ['legal', 'preferred', 'alias'])).get(y);
  if (!subject || subject.names.length === 0 || !group) return null;
  const codes = await phoneticCodes(tx, phoneticTokens([...subject.names, ...group.keys].map((k) => k.norm)));
  return scoreMatch(subject, group, codes);
}

/**
 * POST /v1/team/duplicates: staff who know two charts are one person (source staff_report). The
 * pair joins the queue at whatever score the two groups have, with a `flagged_by_staff` decision
 * row holding the comment; it merges nothing. A pair someone kept separate is refused (409
 * already_decided).
 */
// PLAN-OPEN: only a reviewer should re-open a pair kept separate (design 8.6); there is no route for
// it yet, and a staff flag never does.
export async function flagDuplicate(
  scope: TeamScope,
  input: FlagDuplicateInput,
): Promise<DuplicatePairSummaryValue> {
  const teamId = scope.team.teamId;
  return scope.tx(async (tx, audit) => {
    await lockTeamWrites(tx, teamId);
    const canonical = await canonicalOf(tx, [input.patientA, input.patientB]);
    const x = canonical.get(input.patientA);
    const y = canonical.get(input.patientB);
    if (!x || !y) throw notFound('patient');
    if (x === y) throw invalid('same_patient', 'These records are already one chart.');
    if ((await suppressedCanonicals(tx, x)).has(y))
      throw conflict('already_decided', 'This pair was already decided.');
    const scored = await scorePair(tx, x, y);
    const [a, b] = x < y ? [x, y] : [y, x];
    const [row] = await tx<{ id: string; sources: string[] }[]>`
      insert into sineobex.duplicate_pairs as d (team_id, patient_a, patient_b, score, reasons, sources)
      values (${teamId}, ${a}, ${b}, ${scored?.score ?? 0}, ${scored?.reasons ?? []}::text[], '{staff_report}')
      on conflict (team_id, patient_a, patient_b) do update set
        sources = case when 'staff_report' = any (d.sources) then d.sources else d.sources || '{staff_report}' end,
        last_flagged_at = now()
      where d.status in ('open', 'not_sure')
      returning d.id, d.sources`;
    if (!row) throw conflict('already_decided', 'This pair was already decided.');
    const [decision] = await tx<{ id: string }[]>`
      insert into sineobex.duplicate_decisions (team_id, pair_id, decision, comment, decided_by)
      values (${teamId}, ${row.id}, 'flagged_by_staff', ${input.comment}, ${scope.principal.userId})
      returning id`;
    await audit({
      action: 'duplicate.flagged',
      entity: 'duplicate_pair',
      entityId: row.id,
      patientId: null,
      details: {
        pairId: row.id,
        sources: row.sources,
        decisionId: decision!.id,
        commentSha256: await commentSha256(input.comment),
        patientIds: [a, b],
      },
    });
    const [summary] = await pairSummaries(tx, scope, [(await loadPair(tx, row.id))!]);
    return summary!;
  });
}
