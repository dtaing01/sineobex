import { z } from '@hono/zod-openapi';
import { definitionModel, effectiveAnswers, type ResolvedNoteType } from '@sineobex/forms';
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
import { Credential as CredentialSchema, Reason, Uuid } from '../routes/schemas.ts';
import { loadEncounter } from '../sync/entities/encounter.ts';
import { actingAuthor, noteRules } from '../sync/entities/note.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import {
  byDefinition,
  DefinitionError,
  mayHoldHidden,
  noteReader,
  sameValue,
  type StoredRecord,
} from '../sync/records.ts';
import { medicalHidden, noteAsRead, seenBy, type NoteRead } from './read.ts';
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

export const NoteAssignees = z
  .object({
    assignees: z.array(
      z
        .object({ userId: Uuid, displayName: z.string(), credential: CredentialSchema })
        .openapi('NoteAssignee'),
    ),
  })
  .openapi('NoteAssignees', {
    description: 'Every active member the assign route would take for this note, by name',
  });

export type AssignInputValue = z.infer<typeof AssignInput>;
export type NoteAssignedValue = z.infer<typeof NoteAssigned>;
export type NoteAssigneesValue = z.infer<typeof NoteAssignees>;

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
 * An entry's ID that stands for every entry of a repeating section: mayHoldHidden asks of a path,
 * and every path of such a section carries an entry's ID second (forms 2.3).
 */
const ANY_ENTRY = 'e0000000';

/**
 * Every path a note of [type] can hold an answer at, an entry's ID put in where its section repeats,
 * with each repeating section's own entry paths; first the empty path, which names nothing, so
 * mayHoldHidden asks of it only whether the reader may read a note of the type at all.
 */
function answerPaths(type: ResolvedNoteType): string[] {
  const model = definitionModel(type);
  const repeats = new Set(model.sections.filter((s) => s.section.repeat).map((s) => s.section.id));
  const at = (key: string) => {
    const [section = '', ...rest] = key.split('.');
    return repeats.has(section) ? [section, ANY_ENTRY, ...rest].join('.') : key;
  };
  return [
    '',
    ...[...model.leaves.values()].map((leaf) => at(leaf.key)),
    ...[...repeats].map((section) => `${section}.${ANY_ENTRY}.entryAt`),
  ];
}

/**
 * Whether the note hides something from the assignee's role, as if they were not its author (6.4
 * rule 4, design 3.12): whoever acts as the author sees all of it, so the question is what their
 * role allows today. It is asked of each path of the note's definition, and of what the caller,
 * who reads the picker's list on every visit page, may see there (the coordinator's decision of
 * Nov 20, narrowing D116):
 *
 *  - where the caller's keys could miss what the path holds too, a note of the type could hold
 *    there something the assignee's keys could miss (mayHoldHidden for both), whatever the note
 *    holds, as a hold is decided (D88): a list that left out whoever could not see a treatment
 *    record the note holds would tell a Program Admin who reads none that it holds one (review
 *    finding PRD-1);
 *  - elsewhere, the note holds an answer that counts the assignee's role may not see (seenBy, the
 *    read rule): the caller sees every such answer on the page, so whom the list leaves out tells
 *    them nothing new. An answer the assignee may not see is at a path mayHoldHidden marks for
 *    them, as a hold relies on; where it marks the path for the caller too, the first rule has
 *    refused already, whatever the answer is.
 *
 * So two callers may be given different lists for one note, each from what they may see of it. A
 * note of a type the assignee may not read, the summary of a Medical visit they may not read, or a
 * definition the server cannot read, hides something too.
 *
 * PLAN-OPEN: a note that holds a sensitive exam, a treatment record or a sensitive diagnosis, or
 * could hold one where the person assigning could not see it, goes only to someone whose role would
 * see them, so on a team whose attendings hold no patients.view_sensitive_exams a General / primary
 * care note with a GU exam whose author left has nobody to take it, and it stays in Notes not
 * complete (lifecycle 12.1 #31). Is that acceptable?
 */
function hidesFrom(
  visit: StoredRecord,
  read: NoteRead,
  permissions: ReadonlySet<Permission>,
  credential: Credential,
): boolean {
  if (medicalHidden(permissions, visit.values.kind)) return true;
  const { type, answers, reader: caller } = read;
  // A phase 2 note with no version has no definition, and the sync read gives it whole.
  if (type === undefined) return false;
  const assignee = noteReader(permissions, credential, false);
  try {
    return byDefinition(() => {
      const paths = answerPaths(type);
      if (paths.some((p) => mayHoldHidden(type, p, assignee) && mayHoldHidden(type, p, caller))) return true;
      const seen = seenBy(type, answers, assignee);
      return seen === null || !sameValue(seen, effectiveAnswers(type, answers));
    });
  } catch (err) {
    if (err instanceof DefinitionError) return true;
    throw err;
  }
}

/**
 * What mayAssign asks of a note whatever the assignee: the note as the caller reads it, who acts as
 * its author, and the rank it needs.
 */
interface AssignedNote {
  visit: StoredRecord;
  read: NoteRead;
  fromUserId: string;
  actingAuthorActive: boolean;
  neededRank: number;
}

async function assignedNote(tx: Tx, visit: StoredRecord, read: NoteRead): Promise<AssignedNote> {
  const { note } = read;
  const fromUserId = actingAuthor(note);
  return {
    visit,
    read,
    fromUserId,
    actingAuthorActive: (await memberOf(tx, note.teamId, fromUserId))?.status === 'active',
    neededRank: await neededRank(tx, note),
  };
}

/**
 * mayAssign asked of [assignee] for the note, by the caller: the one rule the assign route and its
 * picker's list (GET /v1/notes/{noteId}/assignees) both ask, with the caller's read of the note, so
 * the picker never offers someone the route refuses.
 */
function assignDecision(a: AssignedNote, assignee: Member | undefined) {
  const credential = credentialOf(assignee) ?? 'none';
  const permissions = new Set((assignee?.permissions ?? []).filter(isPermission));
  return mayAssign({
    actingAuthorActive: a.actingAuthorActive,
    assigneeActive: assignee?.status === 'active',
    assigneeCanChart: permissions.has('encounters.chart'),
    assigneeRank: CAPABILITIES[credential].rank,
    neededRank: a.neededRank,
    noteHasHiddenSection: hidesFrom(a.visit, a.read, permissions, credential),
  });
}

/**
 * POST /v1/notes/{noteId}/assign. The route has checked team.manage_users and a recent sign-in.
 * The team lock is the first statement, then the note is loaded for update, as every online writer
 * does (lifecycle 5). A note the team does not have, or the caller may not read, is 404, as the
 * assignees route answers. A refusal is a state the admin can see on the page (409) or a person the
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
    const loaded = await noteRules.load(tx, noteId, true);
    // A note the caller may not read is not found, as its assignees route answers, so no answer
    // tells its state (6.4 rule 5; review finding PAC-3).
    const read = loaded?.teamId === teamId ? await noteAsRead(tx, scope, loaded) : null;
    if (!read) throw notFound('note');
    const { note } = read;
    const visit = await loadEncounter(tx, note.attributes.encounterId as string, false);
    if (!visit) throw notFound('note');

    const assigned = await assignedNote(tx, visit, read);
    const { fromUserId } = assigned;
    const decision = assignDecision(assigned, await memberOf(tx, teamId, input.toUserId));
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

/**
 * GET /v1/notes/{noteId}/assignees: every active member the assign route would take for the note,
 * by name and credential, so the portal's picker lists exactly them (lifecycle 5.5, 9.12). The
 * route has checked team.manage_users; it is a read, as the list of members is, so it asks for no
 * recent sign-in, and the assignment itself does. A note the team does not have, or the caller may
 * not read (noteAsRead, as the visit read leaves it out), is 404; one whose acting author is active
 * is 409 author_active, as the act answers, so the page offers Assign only where this answers 200.
 * Neither is logged (lifecycle 10.1). The list is logged as one note.assignees_viewed on the note,
 * with its patient and how many it names: names are staff, and no event holds one.
 */
export function noteAssignees(scope: TeamScope, noteId: string): Promise<NoteAssigneesValue> {
  return scope.tx(async (tx, audit) => {
    const teamId = scope.team.teamId;
    const loaded = await noteRules.load(tx, noteId, false);
    const read = loaded?.teamId === teamId ? await noteAsRead(tx, scope, loaded) : null;
    if (!read) throw notFound('note');
    const { note } = read;
    const visit = await loadEncounter(tx, note.attributes.encounterId as string, false);
    if (!visit) throw notFound('note');
    const assigned = await assignedNote(tx, visit, read);
    if (assigned.actingAuthorActive) throw conflict('author_active', MESSAGES.author_active);

    const active = await tx<(Member & { userId: string; displayName: string })[]>`
      select m.user_id, u.display_name, m.status, m.credential, r.permissions
      from sineobex.team_memberships m
      join sineobex.roles r on r.id = m.role_id
      join sineobex.users u on u.id = m.user_id
      where m.team_id = ${teamId} and m.status = 'active'
      order by u.display_name, m.user_id`;
    const assignees: NoteAssigneesValue['assignees'] = [];
    for (const member of active) {
      if (assignDecision(assigned, member) !== 'ok') continue;
      assignees.push({
        userId: member.userId,
        displayName: member.displayName,
        credential: credentialOf(member) ?? 'none',
      });
    }
    await audit({
      action: 'note.assignees_viewed',
      entity: 'encounter_note',
      entityId: note.id,
      patientId: visit.patientId,
      details: { resultCount: assignees.length },
    });
    return { assignees };
  });
}
