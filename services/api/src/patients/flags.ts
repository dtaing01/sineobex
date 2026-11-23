import type { TeamScope } from '../auth/context.ts';
import { conflict, forbidden, invalid, notFound, type ApiError } from '../lib/errors.ts';
import { flagChangeRules, flagDetails, insertFlagChange } from '../sync/entities/patient-flag-change.ts';
import { lockTeamWrites } from '../sync/locks.ts';
import { flagHidden, teamFlags, type FlagHead } from '../sync/read-rules.ts';
import { appendHistory } from '../sync/records.ts';
import { canonicalOf } from './charts.ts';
import { flagView } from './projection.ts';
import type {
  ListedFlagValue,
  MarkFlagChangeInput,
  MarkFlagChangeResultValue,
  SetPatientFlagInput,
  SetPatientFlagResultValue,
} from './schemas.ts';

/**
 * A patient's flags from the portal (phase 5 design 7, 9): a flag set or cleared, its Entered in
 * error mark, and the team's flag list the panel and the search filters offer. Every check of a
 * change is the one a phone's push makes (insertFlagChange) and every read of a flag the one flag
 * rule (flagHidden), so the desk and the phone cannot drift (D99), and the portal holds no rule of
 * its own (D114). Each write takes the team lock first (D32) and audits in its transaction; a
 * refusal about the caller is logged as access.denied with the patient, never the flag (D98 as
 * amended), and every other refusal writes nothing.
 */

type Outcome<T> = { answer: T } | { refused: ApiError };

/** A flag the caller may not see, refused as the flag rule hides it: logged, never naming the flag. */
const hiddenFlag = () => forbidden('Your role can’t see this flag, so you can’t change it.', 'flag_hidden');

/**
 * POST /v1/patients/{patientId}/flags: sets or clears a flag on the patient at the server's time.
 * The page makes the change's id once per form (D115): the same change sent again gets the first
 * answer and writes nothing more, whatever has changed since; an id another change holds is 409
 * `id_taken`. Refused, in the shared check's order: 404 for a patient the team does not hold, then
 * 422 `unknown_flag`, 422 `reason_invalid`, 403 for a flag hidden from the caller (logged), and
 * 409 `archived` for a set of a flag no longer on the team's list. Stored as sent, as a phone's is:
 * a chart reads its merged group's (D27).
 */
export async function setPatientFlag(
  scope: TeamScope,
  patientId: string,
  input: SetPatientFlagInput,
  route: string,
): Promise<SetPatientFlagResultValue> {
  // IDs as the database writes them, so a capital never makes another flag, nor names one in the log.
  const id = input.id.toLowerCase();
  const patient = patientId.toLowerCase();
  const flagId = input.flagId.toLowerCase();
  const outcome = await scope.tx(async (tx, audit): Promise<Outcome<SetPatientFlagResultValue>> => {
    await lockTeamWrites(tx, scope.team.teamId);
    const [held] = await tx`
      select id from sineobex.patients where team_id = ${scope.team.teamId} and id = ${patient}`;
    if (!held) throw notFound('patient');
    const [made] = await tx<
      { patientId: string; flagId: string; action: string; reason: string; authorUserId: string }[]
    >`
      select patient_id, flag_id, action, reason, author_user_id from sineobex.patient_flag_changes
      where id = ${id}`;
    if (made) {
      const same =
        made.patientId === patient &&
        made.flagId === flagId &&
        made.action === input.action &&
        made.reason === input.reason &&
        made.authorUserId === scope.principal.userId;
      if (same) return { answer: { id } };
      throw idTaken();
    }
    const stored = await insertFlagChange(
      tx,
      audit,
      {
        id,
        teamId: scope.team.teamId,
        patientId: patient,
        flagId,
        action: input.action,
        reason: input.reason,
        authorUserId: scope.principal.userId,
        permissions: scope.team.permissions,
        // Made at the desk: its time is the server's receipt (design 4.5), and the clock is the
        // server's own, as a co-sign stamps a desk act.
        at: null,
        deviceTime: null,
        clockVerified: true,
        deviceId: null,
        changeId: null,
        approvedBy: null,
        receivedAt: null,
        auditDetails: {},
      },
      { refuseArchivedSet: true },
    );
    if ('refused' in stored) {
      switch (stored.refused) {
        case 'unknown_flag':
          throw invalid('unknown_flag', 'That flag isn’t on your team’s list.');
        case 'reason_invalid':
          throw invalid('reason_invalid', 'Say why in 1 to 500 characters, with no space before or after.');
        case 'archived':
          throw conflict(
            'archived',
            'That flag is no longer on your team’s list, so it can only be cleared.',
          );
        case 'hidden':
          await audit({
            action: 'access.denied',
            patientId: patient,
            details: { permission: 'patients.view_sensitive', route },
          });
          return { refused: hiddenFlag() };
      }
    }
    // Under the team lock nobody of the team took the id since it was read, so another team holds it.
    if (!stored.stored) throw idTaken();
    return { answer: { id } };
  });
  if ('answer' in outcome) return outcome.answer;
  throw outcome.refused;
}

const idTaken = () =>
  conflict('id_taken', 'This form was already sent for another change. Open the patient again.');

/**
 * POST /v1/patients/{patientId}/flag-changes/{changeId}/entered-in-error: marks a change of the
 * patient's chart entered in error, once, with a reason, as a phone's mark does (the entity's
 * write, its history row and its event). 404 for a patient the team does not hold or a change their
 * merged group does not; 403, logged, for a flag hidden from the caller (D136), and for anyone but
 * the change's author or a Program Admin; 409 `already_marked`. A refusal about the caller comes
 * before the state, so it is logged whatever the change holds.
 */
export async function markFlagChangeInError(
  scope: TeamScope,
  patientId: string,
  changeId: string,
  input: MarkFlagChangeInput,
  route: string,
): Promise<MarkFlagChangeResultValue> {
  const outcome = await scope.tx(async (tx, audit): Promise<Outcome<MarkFlagChangeResultValue>> => {
    await lockTeamWrites(tx, scope.team.teamId);
    const patient = patientId.toLowerCase();
    const group = (await canonicalOf(tx, [patient])).get(patient);
    if (!group) throw notFound('patient');
    const rec = await flagChangeRules.load(tx, changeId.toLowerCase(), true);
    const of =
      rec?.teamId === scope.team.teamId
        ? (await canonicalOf(tx, [rec.patientId!])).get(rec.patientId!)
        : null;
    if (!rec || of !== group) throw notFound('flag change');
    const flag = rec.internal.flag as FlagHead | null;
    if (flagHidden(scope.team.permissions, flag)) {
      await audit({
        action: 'access.denied',
        patientId: rec.patientId,
        details: { permission: 'patients.view_sensitive', route },
      });
      return { refused: hiddenFlag() };
    }
    // PLAN-OPEN (PL-19): who counts as a Program Admin, to mark someone else's flag change entered
    // in error, with no new keys? A holder of team.manage_users, as a phone's mark is checked
    // (patient-flag-change.ts mayChange).
    if (rec.authorUserId !== scope.principal.userId && !scope.can('team.manage_users')) {
      await audit({
        action: 'access.denied',
        patientId: rec.patientId,
        details: { permission: 'team.manage_users', route },
      });
      return {
        refused: forbidden(
          'Only the person who made this change, or a Program Admin, can mark it entered in error.',
        ),
      };
    }
    if (rec.status === 'entered_in_error')
      throw conflict('already_marked', 'This change was marked entered in error already.');
    const userId = scope.principal.userId;
    const fieldVersion = (rec.fieldVersions.enteredInError ?? 0) + 1;
    const value = { reason: input.reason };
    const version = await flagChangeRules.write(tx, rec, 'enteredInError', value, fieldVersion, {
      by: userId,
      at: scope.deps.now().toISOString(),
      changeId: null,
    });
    await appendHistory(tx, {
      teamId: scope.team.teamId,
      entity: 'patient_flag_change',
      recordId: rec.id,
      field: 'enteredInError',
      version: fieldVersion,
      value,
      previousValue: null,
      kind: 'entered_in_error',
      changedBy: userId,
      approvedBy: null,
      changeId: null,
      deviceId: null,
      deviceTime: null,
    });
    await audit({
      action: 'patient_flag.entered_in_error',
      entity: 'patient_flag_change',
      entityId: rec.id,
      patientId: rec.patientId,
      details: {
        field: 'enteredInError',
        kind: 'entered_in_error',
        version: fieldVersion,
        ...flagDetails(flag, rec.attributes.flagId as string),
      },
    });
    return { answer: { version } };
  });
  if ('answer' in outcome) return outcome.answer;
  throw outcome.refused;
}

/** Primary before secondary, then by rank, then name and ID by code units, as currentFlags orders. */
const byTierThenRank = (a: ListedFlagValue, b: ListedFlagValue) =>
  (a.tier === b.tier ? 0 : a.tier === 'primary' ? -1 : 1) ||
  a.rank - b.rank ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
  (a.flagId < b.flagId ? -1 : a.flagId > b.flagId ? 1 : 0);

/**
 * GET /v1/presets/flags: the flags the portal's Flags panel offers to set and its search filters
 * narrow by, each as the team holds it now with its colour's plain name. Only the caller's: a flag
 * the flag rule hides from them is left out. It names no patient, so it writes no audit event
 * (section 11, row 9).
 */
export async function listTeamFlags(scope: TeamScope): Promise<ListedFlagValue[]> {
  const flags = await scope.tx((tx) => teamFlags(tx, scope.team.teamId));
  return (
    [...flags.values()]
      // PLAN-OPEN (BM-78): what happens to the patients who carry a flag when it is archived? It
      // stays on them, and is never offered to be set again: an archived flag is not listed.
      .filter((f) => f.state === 'active' && !flagHidden(scope.team.permissions, f))
      .map((f) => {
        const { archived: _, ...listed } = flagView(f);
        return listed;
      })
      .sort(byTierThenRank)
  );
}
