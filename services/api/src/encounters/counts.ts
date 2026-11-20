import { z } from '@hono/zod-openapi';
import type { TeamScope } from '../auth/context.ts';
import { draftsAsRead } from './incomplete.ts';
import { mayOpenQueue, queueRows } from './queues.ts';

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
    teamOverdue: count.optional().openapi({
      description: 'How many of the team’s drafts are overdue, as that list says each is; team.manage_users',
    }),
  })
  .openapi('HomeCounts');

export type HomeCountsValue = z.infer<typeof HomeCounts>;

/** GET /v1/me/counts: any member may ask. */
export function homeCounts(scope: TeamScope): Promise<HomeCountsValue> {
  return scope.tx(async (tx) => {
    const counts: HomeCountsValue = {};
    if (scope.can('encounters.chart')) {
      const mine = await draftsAsRead(tx, scope, scope.principal.userId);
      counts.notesToFinish = mine.length;
      counts.notesOverdue = mine.filter((n) => n.overdue).length;
      // The queues' own rows, read without their audit event (queues.ts queueRows).
      if (mayOpenQueue(scope, 'cosign')) counts.cosignWaiting = (await queueRows(tx, scope, 'cosign')).length;
      if (mayOpenQueue(scope, 'attestation'))
        counts.attestationWaiting = (await queueRows(tx, scope, 'attestation')).length;
    }
    if (scope.can('team.manage_users')) {
      const team = await draftsAsRead(tx, scope);
      counts.teamIncomplete = team.length;
      counts.teamOverdue = team.filter((n) => n.overdue).length;
    }
    return counts;
  });
}
