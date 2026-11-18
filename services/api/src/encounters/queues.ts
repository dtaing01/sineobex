import { z } from '@hono/zod-openapi';
import type { TeamScope } from '../auth/context.ts';
import { CAPABILITIES } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { forbidden } from '../lib/errors.ts';
import { Uuid } from '../routes/schemas.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { noteRules } from '../sync/entities/note.ts';
import type { StoredRecord } from '../sync/records.ts';
import { DateTime, UserRef } from '../sync/schemas.ts';
import { attestOf } from './attest.ts';
import { actNote, cosignOf, type ActNote } from './cosign.ts';

/**
 * The co-sign queue and the attestation queue (lifecycle 3.7, 5.4): team-wide, every attending sees
 * every note that waits (PRD main 216). One row per visit, oldest first, with its waiting notes.
 *
 * A note is listed as the visit read would give it to the caller (6.4 rule 2): a note they may not
 * read at all is absent, as on the timeline, and a row left with no note is absent too. A note they
 * may read but not act on is listed with canAct false, so the queue can say why it waits for
 * someone else: an answer they may not see (6.4 rule 4), or a note they wrote or signed. canAct is
 * the act's own rule (cosignOf, attestOf) asked as if the hash matched, so the queue and the act
 * never disagree. Nothing a note holds is listed: its type, author and times only.
 */

export const QueueNote = z
  .object({
    noteId: Uuid,
    noteTypeKey: z.string(),
    author: UserRef,
    completedAt: DateTime.nullable(),
    signedBefore: z.union([UserRef, z.null()]).openapi({
      description: 'Who signed it before, when a correction sent it back; null otherwise',
    }),
    attestedBefore: z.union([UserRef, z.null()]).openapi({
      description: 'Who attested it last, when a correction sent it back; null otherwise',
    }),
    canAct: z.boolean().openapi({
      description:
        'False for a note the caller may not co-sign or attest: one with an answer they may not see, or one they wrote or signed',
    }),
  })
  .openapi('QueueNote');

export const QueueVisit = z
  .object({
    encounterId: Uuid,
    patientId: Uuid.nullable(),
    preferredName: z.string().nullable(),
    startedAt: DateTime,
    notes: z.array(QueueNote),
  })
  .openapi('QueueVisit');

export const SignatureQueue = z.object({ rows: z.array(QueueVisit) }).openapi('SignatureQueue');

export type SignatureQueueValue = z.infer<typeof SignatureQueue>;
type QueueVisitValue = z.infer<typeof QueueVisit>;

const QUEUES = {
  cosign: {
    action: 'cosign_queue.viewed',
    refusal: 'cannot_sign',
    message: 'Your credential can’t sign notes, so no note waits for your co-signature.',
    mayAct: (scope: TeamScope) => CAPABILITIES[scope.team.credential].sign,
    effect: cosignOf,
  },
  attestation: {
    action: 'attestation_queue.viewed',
    refusal: 'cannot_attest',
    message: 'Your credential can’t attest notes, so no note waits for your attestation.',
    mayAct: (scope: TeamScope) => CAPABILITIES[scope.team.credential].attest,
    effect: attestOf,
  },
} as const;

export type QueueName = keyof typeof QUEUES;

interface WaitingRow {
  id: string;
  encounterId: string;
  startedAt: Date;
  patientId: string | null;
  /** The canonical chart's, as a merged ID's chart shows it. */
  preferredName: string | null;
}

/**
 * GET /v1/team/cosign-queue and /v1/team/attestation-queue. The route has checked encounters.chart;
 * a credential that cannot do the act is refused here (403 cannot_sign or cannot_attest), logged
 * with the reason's name. The view is logged as one event naming the patients it shows in
 * details.patientIds (D53), with how many rows (resultCount, as the offline list events name it).
 */
export async function readQueue(
  scope: TeamScope,
  which: QueueName,
  route: string,
): Promise<SignatureQueueValue> {
  const queue = QUEUES[which];
  if (!queue.mayAct(scope)) {
    await scope.tx((_, audit) =>
      audit({ action: 'access.denied', details: { reason: queue.refusal, route } }),
    );
    throw forbidden(queue.message, queue.refusal);
  }
  return scope.tx(async (tx, audit) => {
    const teamId = scope.team.teamId;
    const waits =
      which === 'cosign'
        ? tx`n.status = 'completed' and n.medical`
        : tx`n.status = 'signed' and n.attestation = 'waiting'`;
    const waiting = await tx<WaitingRow[]>`
      select n.id, n.encounter_id, e.started_at, e.patient_id, c.preferred_name
      from sineobex.encounter_notes n
      join sineobex.encounters e on e.team_id = n.team_id and e.id = n.encounter_id
      left join sineobex.patients p on p.team_id = e.team_id and p.id = e.patient_id
      left join sineobex.patients c on c.team_id = p.team_id and c.id = p.canonical_id
      where n.team_id = ${teamId} and ${waits}
      order by e.started_at, e.id, n.created_at, n.id`;

    const visits = new Map<string, StoredRecord | null>();
    const shown: { row: WaitingRow; n: ActNote; canAct: boolean }[] = [];
    for (const row of waiting) {
      if (!visits.has(row.encounterId))
        visits.set(row.encounterId, await loadEncounter(tx, row.encounterId, false));
      const visit = visits.get(row.encounterId);
      const note = await noteRules.load(tx, row.id, false);
      if (!visit || !note) continue;
      const n = await actNote(tx, scope, visit, note);
      // As the visit read: a note the caller may not read, or with no definition to read it by, is absent.
      if (!n.read || n.read.type === undefined) continue;
      const effect = queue.effect(scope, n, true);
      shown.push({ row, n, canAct: !('refuse' in effect) });
    }

    const ids = shown.map((s) => s.n.note.id);
    const before = await signedAndAttestedBefore(tx, teamId, ids);
    const authors = await displayNames(
      tx,
      shown.map((s) => s.n.note.authorUserId),
    );
    // A preferred name is in every summary patients.view reads (phase 3 design 4.3).
    const names = scope.can('patients.view');
    const rows: QueueVisitValue[] = [];
    for (const { row, n, canAct } of shown) {
      let visit = rows.at(-1);
      if (visit?.encounterId !== row.encounterId) {
        visit = {
          encounterId: row.encounterId,
          patientId: row.patientId,
          preferredName: names ? row.preferredName : null,
          startedAt: row.startedAt.toISOString(),
          notes: [],
        };
        rows.push(visit);
      }
      const { note } = n;
      visit.notes.push({
        noteId: note.id,
        noteTypeKey: note.attributes.noteTypeKey as string,
        author: { userId: note.authorUserId, displayName: authors.get(note.authorUserId) ?? '' },
        completedAt: note.attributes.completedAt as string | null,
        signedBefore: before.signed.get(note.id) ?? null,
        attestedBefore: before.attested.get(note.id) ?? null,
        canAct,
      });
    }

    await audit({
      action: queue.action,
      patientId: null,
      details: {
        patientIds: [...new Set(rows.flatMap((r) => (r.patientId ? [r.patientId] : [])))],
        resultCount: rows.length,
      },
    });
    return { rows };
  });
}

type Person = { userId: string; displayName: string };

/**
 * For each note: who made its latest signature other than the one it holds now, and who attested it
 * last. A waiting note has either only when a correction sent it back (3.6), which is when the
 * queue shows them (3.7). The names are the ones stored with the act, as the visit read shows them.
 */
async function signedAndAttestedBefore(tx: Tx, teamId: string, ids: string[]) {
  const signed = new Map<string, Person>();
  const attested = new Map<string, Person>();
  if (ids.length === 0) return { signed, attested };
  const signatures = await tx<{ noteId: string; userId: string; displayName: string }[]>`
    select distinct on (s.note_id) s.note_id, s.signer_user_id as user_id, s.signer_name as display_name
    from sineobex.note_signoffs s
    join sineobex.encounter_notes n on n.team_id = s.team_id and n.id = s.note_id
    where s.team_id = ${teamId} and s.note_id = any (${ids}::uuid[]) and s.effect = 'signed'
      and s.id is distinct from n.signoff_id
    order by s.note_id, s.received_at desc, s.id desc`;
  for (const r of signatures) signed.set(r.noteId, { userId: r.userId, displayName: r.displayName });
  const attestations = await tx<{ noteId: string; userId: string; displayName: string }[]>`
    select distinct on (a.note_id) a.note_id, a.attending_user_id as user_id, a.attending_name as display_name
    from sineobex.note_attestations a
    where a.team_id = ${teamId} and a.note_id = any (${ids}::uuid[])
    order by a.note_id, a.attested_at desc, a.id desc`;
  for (const r of attestations) attested.set(r.noteId, { userId: r.userId, displayName: r.displayName });
  return { signed, attested };
}

async function displayNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await tx<{ id: string; displayName: string }[]>`
    select id, display_name from sineobex.users where id = any (${wanted}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
