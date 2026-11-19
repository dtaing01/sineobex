import type { ResolvedNoteType } from '@sineobex/forms';
import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { notFound } from '../lib/errors.ts';
import { canonicalOf } from '../patients/charts.ts';
import type {
  TimelinePageValue,
  TimelineValue,
  TimelineVisitValue,
  VisitReadValue,
} from '../patients/schemas.ts';
import { RULES } from '../sync/entities/index.ts';
import { DefinitionError, definitionOf, snapshot } from '../sync/records.ts';
import { readerOf, seenBy, statusShown, visitAsRead, type ReadSource, type StatusNote } from './read.ts';
import { noteIsEmpty, type Attestation, type NoteStatus } from './rules.ts';

/**
 * The patient timeline (lifecycle 5.2): a merged group's visits, newest first, each with the notes
 * the reader may see, by the visit read's rules (read.ts: readerOf, seenBy and statusShown); and the
 * last three visits in full, so the phone's chart cache can show what happened last time with no
 * signal (PRD main 533). Nothing a note holds is listed: only its type (its key and title), group,
 * whether it is Medical and its state, so no finding of a sensitive exam reaches the overview for
 * any reader (6.4 rule 3).
 */

/** Visits per page of the timeline: the chart's first page, and each of "Show earlier visits". */
export const TIMELINE_PAGE = 50;

// PLAN-OPEN: how many recent visits ride with a chart, to be read offline (lifecycle 12.1 #17).
// Three, the PRD's "recent notes" read as the last few visits.
export const RECENT_VISITS = 3;

interface VisitRow {
  id: string;
  startedAt: Date;
  kind: TimelineVisitValue['kind'];
}

interface NoteRow {
  id: string;
  encounterId: string;
  noteTypeKey: string;
  noteTypeVersion: number | null;
  status: NoteStatus;
  attestation: Attestation;
  medical: boolean;
  data: Record<string, unknown>;
  actingAuthorId: string;
}

/**
 * A page of the group's visits, newest first, after [before] when it is given. A note the reader
 * may not see is left out of its visit, as are an empty draft (3.1), a phase 2 note with no version
 * and a note whose definition the server cannot read, as the visit read leaves them out. A visit's
 * status is worked out from the notes listed, so it says nothing of a note left out (6.4 rule 2;
 * review finding LRD-2).
 */
export async function timelineVisits(
  tx: Tx,
  scope: TeamScope,
  canonicalId: string,
  before: { startedAt: Date; id: string } | null = null,
): Promise<TimelineVisitValue[]> {
  const visits = await tx<VisitRow[]>`
    select e.id, e.started_at, e.kind from sineobex.encounters e
    join sineobex.patients p on p.team_id = e.team_id and p.id = e.patient_id
    where e.team_id = ${scope.team.teamId} and p.canonical_id = ${canonicalId}
      ${before ? tx`and (e.started_at, e.id) < (${before.startedAt}, ${before.id})` : tx``}
    order by e.started_at desc, e.id desc
    limit ${TIMELINE_PAGE}`;
  if (visits.length === 0) return [];
  const notes = await tx<NoteRow[]>`
    select id, encounter_id, note_type_key, note_type_version, status, attestation, medical, data,
           coalesce(assigned_user_id, author_user_id) as acting_author_id
    from sineobex.encounter_notes
    where team_id = ${scope.team.teamId} and encounter_id = any (${visits.map((v) => v.id)}::uuid[])
    order by created_at, id`;
  const definitions = new Map<string, Promise<ResolvedNoteType | undefined>>();
  const definition = (key: string, version: number) => {
    const at = `${key}@${version}`;
    if (!definitions.has(at)) definitions.set(at, definitionOf(tx, scope.team.teamId, key, version));
    return definitions.get(at)!;
  };
  const shown = new Map<string, TimelineVisitValue['notes']>(visits.map((v) => [v.id, []]));
  const counted = new Map<string, StatusNote[]>(visits.map((v) => [v.id, []]));
  for (const n of notes) {
    if (n.noteTypeVersion === null || (n.status === 'draft' && noteIsEmpty(n.data))) continue;
    let type: ResolvedNoteType | undefined;
    try {
      type = await definition(n.noteTypeKey, n.noteTypeVersion);
    } catch (err) {
      if (err instanceof DefinitionError) continue;
      throw err;
    }
    if (!type || seenBy(type, n.data, readerOf(scope, n.actingAuthorId)) === null) continue;
    shown.get(n.encounterId)!.push({
      noteId: n.id,
      noteTypeKey: n.noteTypeKey,
      title: type.title,
      medical: n.medical,
      group: type.group,
      status: n.status,
      attestation: n.attestation,
    });
    counted.get(n.encounterId)!.push({ status: n.status, medical: n.medical, answers: n.data });
  }
  return visits.map((v) => ({
    encounterId: v.id,
    startedAt: v.startedAt.toISOString(),
    kind: v.kind,
    status: statusShown(counted.get(v.id)!),
    notes: shown.get(v.id)!,
  }));
}

/** The group's referrals, oldest first, as the sync read gives them: read whole with patients.view. */
async function groupReferrals(tx: Tx, scope: TeamScope, canonicalId: string) {
  const rows = await tx<{ id: string }[]>`
    select r.id from sineobex.referrals r
    join sineobex.patients p on p.team_id = r.team_id and p.id = r.patient_id
    where r.team_id = ${scope.team.teamId} and p.canonical_id = ${canonicalId}
    order by r.recorded_at, r.id`;
  const out = [];
  for (const { id } of rows) {
    const record = await RULES.referral.load(tx, id, false);
    if (record) out.push(snapshot(record));
  }
  return out;
}

/**
 * What a chart carries of the group's visits: its timeline and its last three visits in full, each
 * read, and logged, as GET /v1/encounters/{id} reads it.
 */
export async function chartVisits(
  tx: Tx,
  scope: TeamScope,
  audit: AuditFn,
  canonicalId: string,
  source: ReadSource,
): Promise<{ timeline: TimelineValue; recentVisits: VisitReadValue[] }> {
  const encounters = await timelineVisits(tx, scope, canonicalId);
  const recentVisits: VisitReadValue[] = [];
  for (const e of encounters.slice(0, RECENT_VISITS)) {
    const visit = await visitAsRead(tx, scope, audit, e.encounterId, source);
    if (visit) recentVisits.push(visit);
  }
  return {
    timeline: { encounters, referrals: await groupReferrals(tx, scope, canonicalId) },
    recentVisits,
  };
}

/**
 * GET /v1/patients/{patientId}/timeline?before=: the group's next visits after [before], for "Show
 * earlier visits"; the first page without it. A merged ID answers its group, as the chart does.
 * Logged as `chart.timeline_viewed` with how many visits it shows (resultCount, as the offline
 * list events name it).
 */
export async function earlierVisits(
  scope: TeamScope,
  patientId: string,
  before: string | undefined,
): Promise<TimelinePageValue> {
  return scope.tx(async (tx, audit) => {
    const canonicalId = (await canonicalOf(tx, [patientId])).get(patientId);
    if (!canonicalId) throw notFound('patient');
    let after: { startedAt: Date; id: string } | null = null;
    if (before) {
      const [row] = await tx<{ startedAt: Date; id: string }[]>`
        select e.started_at, e.id from sineobex.encounters e
        join sineobex.patients p on p.team_id = e.team_id and p.id = e.patient_id
        where e.team_id = ${scope.team.teamId} and e.id = ${before} and p.canonical_id = ${canonicalId}`;
      if (!row) throw notFound('encounter');
      after = row;
    }
    const encounters = await timelineVisits(tx, scope, canonicalId, after);
    await audit({
      action: 'chart.timeline_viewed',
      entity: 'patient',
      entityId: canonicalId,
      patientId: canonicalId,
      details: { resultCount: encounters.length, ...(before ? { before } : {}) },
    });
    return { encounters };
  });
}
