import { z } from '@hono/zod-openapi';
import type { ResolvedNoteType } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { Uuid } from '../routes/schemas.ts';
import { DefinitionError, definitionOf } from '../sync/records.ts';
import { DateTime, UserRef } from '../sync/schemas.ts';
import { readerOf, seenBy } from './read.ts';
import { isOverdue } from './rules.ts';

/**
 * Notes that are not complete (lifecycle 3.9, 5.6; PRD main 99): the drafts the server holds, each
 * with whether it is overdue, worked out when read. Nothing is written at the 24-hour mark, so no
 * job that did not run can miss one. An empty draft counts as not there (3.1).
 *
 * A note is listed as the timeline lists it (timeline.ts): one the reader may not read is absent,
 * and so is a phase 2 note with no version or one whose definition the server cannot read (6.4
 * rule 2). Whoever acts as a note's author reads all of it (rule 1), so the caller's own list holds
 * every draft of theirs. Nothing a note holds is listed: its type, its visit and its patient's ID.
 */

export const NoteToFinish = z
  .object({
    noteId: Uuid,
    encounterId: Uuid,
    patientId: Uuid.nullable(),
    noteTypeKey: z.string(),
    startedAt: DateTime,
    overdue: z.boolean().openapi({
      description:
        'More than 24 hours since the visit started, or since the server received it when its start was not verified',
    }),
  })
  .openapi('NoteToFinish');

export const IncompleteNote = NoteToFinish.extend({
  author: UserRef.openapi({ description: 'Whoever acts as the author: the assignee, when there is one' }),
  authorActive: z.boolean().openapi({ description: 'The author is still an active member of the team' }),
}).openapi('IncompleteNote');

export const NotesToFinish = z.object({ notes: z.array(NoteToFinish) }).openapi('NotesToFinish');
export const IncompleteNotes = z.object({ notes: z.array(IncompleteNote) }).openapi('IncompleteNotes');

export const IncompleteQuery = z.object({
  author: Uuid.optional().openapi({
    description: 'Only the drafts this person acts as the author of (the route lead’s view, phase 7)',
  }),
});

export type NotesToFinishValue = z.infer<typeof NotesToFinish>;
export type IncompleteNotesValue = z.infer<typeof IncompleteNotes>;
export type IncompleteNoteValue = z.infer<typeof IncompleteNote>;

interface DraftRow {
  noteId: string;
  encounterId: string;
  patientId: string | null;
  noteTypeKey: string;
  noteTypeVersion: number;
  data: Record<string, unknown>;
  actingAuthorId: string;
  displayName: string | null;
  authorActive: boolean;
  startedAt: Date;
  clockVerified: boolean;
  receivedAt: Date;
}

/**
 * The team's drafts the caller may read, oldest visit first, of [actingAuthorId] when it is given:
 * the list both routes show and the counts count (counts.ts), so a count is always its list's length.
 */
export async function draftsAsRead(
  tx: Tx,
  scope: TeamScope,
  actingAuthorId?: string,
): Promise<IncompleteNoteValue[]> {
  const teamId = scope.team.teamId;
  const rows = await tx<DraftRow[]>`
    select n.id as note_id, n.encounter_id, e.patient_id, n.note_type_key, n.note_type_version, n.data,
           a.id as acting_author_id, a.display_name, coalesce(m.status = 'active', false) as author_active,
           e.started_at, e.clock_verified, e.created_at as received_at
    from sineobex.encounter_notes n
    join sineobex.encounters e on e.team_id = n.team_id and e.id = n.encounter_id
    join sineobex.users a on a.id = coalesce(n.assigned_user_id, n.author_user_id)
    left join sineobex.team_memberships m on m.team_id = n.team_id and m.user_id = a.id
    where n.team_id = ${teamId} and n.status = 'draft' and n.note_type_version is not null
      and not sineobex.note_is_empty(n.data)
      ${actingAuthorId ? tx`and coalesce(n.assigned_user_id, n.author_user_id) = ${actingAuthorId}` : tx``}
    order by e.started_at, e.id, n.created_at, n.id`;

  const definitions = new Map<string, Promise<ResolvedNoteType | undefined>>();
  const definition = (key: string, version: number) => {
    const at = `${key}@${version}`;
    if (!definitions.has(at)) definitions.set(at, definitionOf(tx, teamId, key, version));
    return definitions.get(at)!;
  };
  const now = scope.deps.now().toISOString();
  const notes: IncompleteNoteValue[] = [];
  for (const r of rows) {
    let type: ResolvedNoteType | undefined;
    try {
      type = await definition(r.noteTypeKey, r.noteTypeVersion);
    } catch (err) {
      if (err instanceof DefinitionError) continue;
      throw err;
    }
    // As the visit read reads it (read.ts).
    if (!type || seenBy(type, r.data, readerOf(scope, r.actingAuthorId)) === null) continue;
    const startedAt = r.startedAt.toISOString();
    notes.push({
      noteId: r.noteId,
      encounterId: r.encounterId,
      patientId: r.patientId,
      noteTypeKey: r.noteTypeKey,
      startedAt,
      overdue: isOverdue({
        noteStatus: 'draft',
        startedAt,
        startedVerified: r.clockVerified,
        receivedAt: r.receivedAt.toISOString(),
        now,
      }),
      author: { userId: r.actingAuthorId, displayName: r.displayName ?? '' },
      authorActive: r.authorActive,
    });
  }
  return notes;
}

/** Each patient the list names once, for its audit event (D53). */
const patientsOf = (notes: readonly { patientId: string | null }[]) => [
  ...new Set(notes.flatMap((n) => (n.patientId ? [n.patientId] : []))),
];

/**
 * GET /v1/me/notes-to-finish: the caller's drafts, which the phone merges with the ones it holds
 * (9.9). Logged as one view naming the patients it shows, with how many notes (resultCount, as the
 * phone's offline entry of the same view names it, 10.1).
 */
export function notesToFinish(scope: TeamScope): Promise<NotesToFinishValue> {
  return scope.tx(async (tx, audit) => {
    const drafts = await draftsAsRead(tx, scope, scope.principal.userId);
    await audit({
      action: 'notes_to_finish.viewed',
      patientId: null,
      details: { patientIds: patientsOf(drafts), resultCount: drafts.length },
    });
    return {
      notes: drafts.map(({ noteId, encounterId, patientId, noteTypeKey, startedAt, overdue }) => ({
        noteId,
        encounterId,
        patientId,
        noteTypeKey,
        startedAt,
        overdue,
      })),
    };
  });
}

/**
 * GET /v1/team/incomplete-notes: every draft of the team, with whoever acts as its author and
 * whether they are still a member, so a Program Admin can assign a departed author's (5.5). Logged
 * as one view naming the patients it shows, with how many notes and the author filter's ID.
 */
export function incompleteNotes(scope: TeamScope, author?: string): Promise<IncompleteNotesValue> {
  return scope.tx(async (tx, audit) => {
    const notes = await draftsAsRead(tx, scope, author);
    await audit({
      action: 'incomplete_notes.viewed',
      patientId: null,
      details: {
        patientIds: patientsOf(notes),
        resultCount: notes.length,
        ...(author ? { author } : {}),
      },
    });
    return { notes };
  });
}
