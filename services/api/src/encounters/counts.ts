import { z } from '@hono/zod-openapi';
import type { TeamScope } from '../auth/context.ts';
import { CAPABILITIES } from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { noteRules } from '../sync/entities/note.ts';
import type { StoredRecord } from '../sync/records.ts';
import { actNote } from './cosign.ts';
import { draftsAsRead } from './incomplete.ts';
import type { QueueName } from './queues.ts';

/**
 * The numbers Home shows (lifecycle 5.6, 9.9). Each is the length of the list it stands for, built
 * by that list's own function, and a number for a list the caller may not open is absent: so Home
 * never shows a count its list would not show. Numbers only, naming no patient, so nothing is
 * logged: the lists log every patient they show, and a count built on them would put a view in each
 * patient's access report every time someone opened Home.
 */

const count = z.number().int().nonnegative();

export const HomeCounts = z
  .object({
    notesToFinish: count.optional().openapi({
      description:
        'The drafts the caller acts as the author of (GET /v1/me/notes-to-finish); encounters.chart',
    }),
    notesOverdue: count.optional().openapi({ description: 'How many of those are overdue (lifecycle 3.9)' }),
    cosignWaiting: count.optional().openapi({
      description:
        'Visits in the co-sign queue (GET /v1/team/cosign-queue); encounters.chart and a credential that signs',
    }),
    attestationWaiting: count.optional().openapi({
      description:
        'Visits in the attestation queue (GET /v1/team/attestation-queue); encounters.chart and a credential that attests',
    }),
    teamIncomplete: count.optional().openapi({
      description: 'The team’s drafts (GET /v1/team/incomplete-notes); team.manage_users',
    }),
  })
  .openapi('HomeCounts');

export type HomeCountsValue = z.infer<typeof HomeCounts>;

/** GET /v1/me/counts: any member may ask. */
export function homeCounts(scope: TeamScope): Promise<HomeCountsValue> {
  return scope.tx(async (tx) => {
    const counts: HomeCountsValue = {};
    const capabilities = CAPABILITIES[scope.team.credential];
    if (scope.can('encounters.chart')) {
      const mine = await draftsAsRead(tx, scope, scope.principal.userId);
      counts.notesToFinish = mine.length;
      counts.notesOverdue = mine.filter((n) => n.overdue).length;
      if (capabilities.sign) counts.cosignWaiting = await queueVisits(tx, scope, 'cosign');
      if (capabilities.attest) counts.attestationWaiting = await queueVisits(tx, scope, 'attestation');
    }
    if (scope.can('team.manage_users')) counts.teamIncomplete = (await draftsAsRead(tx, scope)).length;
    return counts;
  });
}

/**
 * How many rows the queue would show the caller: visits with a waiting note they may read (6.4
 * rule 2), as readQueue (queues.ts) lists them. readQueue logs the patients it shows, so it is not
 * called here; the test of the counts pins this number to the queue's length.
 */
async function queueVisits(tx: Tx, scope: TeamScope, which: QueueName): Promise<number> {
  const teamId = scope.team.teamId;
  const waits =
    which === 'cosign'
      ? tx`n.status = 'completed' and n.medical`
      : tx`n.status = 'signed' and n.attestation = 'waiting'`;
  const waiting = await tx<{ id: string; encounterId: string }[]>`
    select n.id, n.encounter_id from sineobex.encounter_notes n
    where n.team_id = ${teamId} and ${waits}`;

  const visits = new Map<string, StoredRecord | null>();
  const shown = new Set<string>();
  for (const row of waiting) {
    if (shown.has(row.encounterId)) continue;
    if (!visits.has(row.encounterId))
      visits.set(row.encounterId, await loadEncounter(tx, row.encounterId, false));
    const visit = visits.get(row.encounterId);
    const note = await noteRules.load(tx, row.id, false);
    if (!visit || !note) continue;
    const { read } = await actNote(tx, scope, visit, note);
    if (read && read.type !== undefined) shown.add(row.encounterId);
  }
  return shown.size;
}
