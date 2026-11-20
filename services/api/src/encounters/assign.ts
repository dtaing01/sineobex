import { z } from '@hono/zod-openapi';
import { definitionModel, type ResolvedNoteType } from '@sineobex/forms';
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
import { actingAuthor, noteRules, noteTypeOf } from '../sync/entities/note.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import {
  byDefinition,
  DefinitionError,
  mayHoldHidden,
  noteReader,
  type StoredRecord,
} from '../sync/records.ts';
import { medicalHidden, noteAsRead } from './read.ts';
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
 * Whether a note of this type could hold an answer the assignee's role could not see if they were
 * not its author (6.4 rule 4, design 3.12): whoever acts as the author sees all of it, so the
 * question is what their role allows today. Decided from the note's definition and the assignee's
 * keys alone, never from what the note holds, as a hold is (D88, mayHoldHidden): the picker's list
 * is read on every visit page, and a list that left out whoever could not see a sensitive exam or
 * a treatment record the note holds would tell the person reading it that the note holds one
 * (review finding PRD-1). The summary of a Medical visit they may not read, or a definition the
 * server cannot read, hides something too.
 *
 * PLAN-OPEN: a note of a type that could hold a sensitive exam, a treatment record or a sensitive
 * diagnosis goes only to someone whose role would see them, so a team whose attendings hold no
 * patients.view_sensitive_exams has nobody to take a General / primary care note whose author
 * left, and it stays in Notes not complete (lifecycle 12.1 #31). Is that acceptable?
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
  try {
    const type = await noteTypeOf(tx, note);
    // A phase 2 note with no version has no definition, and the sync read gives it whole.
    if (type === undefined) return false;
    return byDefinition(() => answerPaths(type).some((path) => mayHoldHidden(type, path, reader)));
  } catch (err) {
    if (err instanceof DefinitionError) return true;
    throw err;
  }
}

/** What mayAssign asks of a note whatever the assignee: who acts as its author, and the rank it needs. */
interface AssignedNote {
  visit: StoredRecord;
  note: StoredRecord;
  fromUserId: string;
  actingAuthorActive: boolean;
  neededRank: number;
}

async function assignedNote(tx: Tx, visit: StoredRecord, note: StoredRecord): Promise<AssignedNote> {
  const fromUserId = actingAuthor(note);
  return {
    visit,
    note,
    fromUserId,
    actingAuthorActive: (await memberOf(tx, note.teamId, fromUserId))?.status === 'active',
    neededRank: await neededRank(tx, note),
  };
}

/**
 * mayAssign asked of [assignee] for the note: the one rule the assign route and its picker's list
 * (GET /v1/notes/{noteId}/assignees) both ask, so the picker never offers someone the route refuses.
 */
async function assignDecision(tx: Tx, a: AssignedNote, assignee: Member | undefined) {
  const credential = credentialOf(assignee) ?? 'none';
  const permissions = new Set((assignee?.permissions ?? []).filter(isPermission));
  return mayAssign({
    actingAuthorActive: a.actingAuthorActive,
    assigneeActive: assignee?.status === 'active',
    assigneeCanChart: permissions.has('encounters.chart'),
    assigneeRank: CAPABILITIES[credential].rank,
    neededRank: a.neededRank,
    noteHasHiddenSection: await hidesFrom(tx, a.visit, a.note, permissions, credential),
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
    const note = await noteRules.load(tx, noteId, true);
    // A note the caller may not read is not found, as its assignees route answers, so no answer
    // tells its state (6.4 rule 5; review finding PAC-3).
    if (!note || note.teamId !== teamId || !(await noteAsRead(tx, scope, note))) throw notFound('note');
    const visit = await loadEncounter(tx, note.attributes.encounterId as string, false);
    if (!visit) throw notFound('note');

    const assigned = await assignedNote(tx, visit, note);
    const { fromUserId } = assigned;
    const decision = await assignDecision(tx, assigned, await memberOf(tx, teamId, input.toUserId));
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
    const note = await noteRules.load(tx, noteId, false);
    if (!note || note.teamId !== teamId || !(await noteAsRead(tx, scope, note))) throw notFound('note');
    const visit = await loadEncounter(tx, note.attributes.encounterId as string, false);
    if (!visit) throw notFound('note');
    const assigned = await assignedNote(tx, visit, note);
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
      if ((await assignDecision(tx, assigned, member)) !== 'ok') continue;
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
