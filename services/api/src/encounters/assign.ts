import { z } from '@hono/zod-openapi';
import { effectiveAnswers, visibleAnswers } from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import {
  CAPABILITIES,
  CREDENTIALS,
  isPermission,
  type Credential,
  type Permission,
} from '../auth/permissions.ts';
import type { Tx } from '../db/database.ts';
import { conflict, invalid, notFound } from '../lib/errors.ts';
import { Reason, Uuid } from '../routes/schemas.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { actingAuthor, answersOf, noteRules, noteTypeOf } from '../sync/entities/note.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { byDefinition, DefinitionError, noteReader, sameValue, type StoredRecord } from '../sync/records.ts';
import { medicalHidden } from './read.ts';
import { mayAssign, type AssignRefusal } from './rules.ts';

/**
 * Assigning a note (lifecycle 3.8, 5.5; PRD main 461): when whoever acts as a note's author has
 * left the team, a Program Admin puts another clinician in their place, with a reason. The rule is
 * mayAssign's (rules.ts); this module loads what it asks, under the team lock, and writes what it
 * says. The assignee then acts as the author everywhere the sync asks (actingAuthor): they correct
 * the note, and complete it while it is a draft (PLAN-OPEN 12.1 #7).
 */

export const AssignInput = z
  .object({
    toUserId: Uuid.openapi({ description: 'The clinician who will act as the note’s author' }),
    reason: Reason,
  })
  .strict()
  .openapi('AssignInput');

export const NoteAssigned = z
  .object({
    assignmentId: Uuid,
    noteId: Uuid,
    fromUserId: Uuid.openapi({ description: 'Who acted as the author until now' }),
    toUserId: Uuid,
  })
  .openapi('NoteAssigned');

export type AssignInputValue = z.infer<typeof AssignInput>;
export type NoteAssignedValue = z.infer<typeof NoteAssigned>;

const MESSAGES: Record<AssignRefusal, string> = {
  author_active: 'The note’s author is still on the team, so it stays theirs.',
  assignee_not_member: 'That person isn’t an active member of this team.',
  assignee_cannot_chart: 'That person’s role can’t chart notes.',
  credential_too_low: 'That person’s credential is lower than the one the note needs.',
  cannot_see_all: 'That person’s role can’t see every part of this note.',
};

interface Member {
  status: string;
  credential: string;
  permissions: string[];
}

async function memberOf(tx: Tx, teamId: string, userId: string): Promise<Member | undefined> {
  const [row] = await tx<Member[]>`
    select m.status, m.credential, r.permissions
    from sineobex.team_memberships m join sineobex.roles r on r.id = m.role_id
    where m.team_id = ${teamId} and m.user_id = ${userId}`;
  return row;
}

const credentialOf = (m: Member | undefined): Credential | undefined =>
  m && (CREDENTIALS as readonly string[]).includes(m.credential) ? (m.credential as Credential) : undefined;

const HIGHEST_RANK = Math.max(...CREDENTIALS.map((c) => CAPABILITIES[c].rank));

/**
 * The rank the note needs of its assignee: the credential its current signature was recorded under
 * (a note's signoff_id names a signature only, 0019), or, for an unsigned note, its author's last
 * credential. A membership is never deleted, only marked removed with its credential kept; an author
 * with none is not one this team can vouch for, so the note asks the highest rank.
 */
async function neededRank(tx: Tx, note: StoredRecord): Promise<number> {
  const signoffId = note.attributes.signoffId as string | null;
  if (signoffId) {
    const [signature] = await tx<{ credential: Credential }[]>`
      select signer_credential as credential from sineobex.note_signoffs
      where team_id = ${note.teamId} and id = ${signoffId}`;
    if (signature) return CAPABILITIES[signature.credential].rank;
  }
  const author = credentialOf(await memberOf(tx, note.teamId, note.authorUserId));
  return author ? CAPABILITIES[author].rank : HIGHEST_RANK;
}

/**
 * Whether the note holds an answer that counts which the assignee's role could not see if they were
 * not its author (6.4 rule 4, design 3.12): whoever acts as the author sees all of it, so the
 * question is what their role allows today. It is the question co-sign asks of its caller
 * (cosign.ts actNote), asked of another person; a note they may not read at all, the summary of a
 * Medical visit they may not read, or a definition the server cannot read, all hide something.
 */
async function hidesFrom(
  tx: Tx,
  visit: StoredRecord,
  note: StoredRecord,
  permissions: ReadonlySet<Permission>,
  credential: Credential,
): Promise<boolean> {
  if (medicalHidden(permissions, visit.values.kind)) return true;
  const reader = noteReader(permissions, credential, false);
  const answers = answersOf(note);
  try {
    const type = await noteTypeOf(tx, note);
    // A phase 2 note with no version has no definition, and the sync read gives it whole.
    if (type === undefined) return false;
    return byDefinition(() => {
      const seen = visibleAnswers(type, answers, reader);
      return seen === null || !sameValue(seen, effectiveAnswers(type, answers));
    });
  } catch (err) {
    if (err instanceof DefinitionError) return true;
    throw err;
  }
}

/**
 * POST /v1/notes/{noteId}/assign. The route has checked team.manage_users and a recent sign-in.
 * The team lock is the first statement, then the note is loaded for update, as every online writer
 * does (lifecycle 5). A refusal is a state the admin can see on the page (409) or a person the
 * picker should not have offered (422); neither writes anything. On success: a note_assignments
 * row, the note's assigned_user_id, one note.assigned event whose details name the two people and
 * not the reason, and a notice with no text to the assignee.
 */
export function assignNote(
  scope: TeamScope,
  noteId: string,
  input: AssignInputValue,
): Promise<NoteAssignedValue> {
  return scope.tx(async (tx, audit) => {
    const teamId = scope.team.teamId;
    await lockTeamWrites(tx, teamId);
    const note = await noteRules.load(tx, noteId, true);
    if (!note || note.teamId !== teamId) throw notFound('note');
    const visit = await loadEncounter(tx, note.attributes.encounterId as string, false);
    if (!visit) throw notFound('note');

    const fromUserId = actingAuthor(note);
    const author = await memberOf(tx, teamId, fromUserId);
    const assignee = await memberOf(tx, teamId, input.toUserId);
    const credential = credentialOf(assignee) ?? 'none';
    const permissions = new Set((assignee?.permissions ?? []).filter(isPermission));
    const decision = mayAssign({
      actingAuthorActive: author?.status === 'active',
      assigneeActive: assignee?.status === 'active',
      assigneeCanChart: permissions.has('encounters.chart'),
      assigneeRank: CAPABILITIES[credential].rank,
      neededRank: await neededRank(tx, note),
      noteHasHiddenSection: await hidesFrom(tx, visit, note, permissions, credential),
    });
    if (decision !== 'ok') {
      const { refuse } = decision;
      throw refuse === 'author_active'
        ? conflict(refuse, MESSAGES[refuse])
        : invalid(refuse, MESSAGES[refuse]);
    }

    const [assignment] = await tx<{ id: string }[]>`
      insert into sineobex.note_assignments (team_id, note_id, from_user_id, to_user_id, assigned_by, reason)
      values (${teamId}, ${note.id}, ${fromUserId}, ${input.toUserId}, ${scope.principal.userId}, ${input.reason})
      returning id`;
    await tx`
      update sineobex.encounter_notes set assigned_user_id = ${input.toUserId}
      where team_id = ${teamId} and id = ${note.id}`;
    await audit({
      action: 'note.assigned',
      entity: 'encounter_note',
      entityId: note.id,
      patientId: visit.patientId,
      details: { fromUserId, toUserId: input.toUserId },
    });
    await tx`
      insert into sineobex.user_notices (team_id, user_id, kind, entity, record_id)
      values (${teamId}, ${input.toUserId}, 'note_assigned', 'encounter_note', ${note.id})`;
    return { assignmentId: assignment!.id, noteId: note.id, fromUserId, toUserId: input.toUserId };
  });
}
