import type { Tx } from '../../db/database.ts';
import type { EntityRules } from '../records.ts';
import type { AnyRecordEntityName, SyncChangeInput } from '../schemas.ts';
import { aliasRules } from './alias.ts';
import { allergyRules } from './allergy.ts';
import { consentRules } from './consent.ts';
import { encounterRules } from './encounter.ts';
import { idLinkRules } from './id-link.ts';
import { noteRules } from './note.ts';
import { patientRules } from './patient.ts';
import { problemNoteRules } from './problem-note.ts';
import { problemRules } from './problem.ts';
import type { ParentRef } from './values.ts';

/**
 * The entity registry (phase 3 design 2.2): one module per kind of synced record, each with its
 * permission, parents, create, field classes, storage and redirect. The phone mirrors it in
 * lib/sync/entities.dart, and its fake server in test/sync/fake_server.dart.
 */
export const RULES: Readonly<Record<AnyRecordEntityName, EntityRules>> = {
  encounter: encounterRules as EntityRules,
  encounter_note: noteRules as EntityRules,
  patient: patientRules as EntityRules,
  patient_alias: aliasRules as EntityRules,
  patient_allergy: allergyRules as EntityRules,
  patient_consent: consentRules as EntityRules,
  problem: problemRules as EntityRules,
  problem_note: problemNoteRules as EntityRules,
  id_link: idLinkRules as EntityRules,
};

/** The rules of a change's entity; null for an activity log entry, which is no record. */
export function rulesFor(entity: string): EntityRules | null {
  return Object.hasOwn(RULES, entity) ? RULES[entity as AnyRecordEntityName] : null;
}

/** Whether applying this change takes the team's write lock first (D32). */
export const takesTeamLock = (c: SyncChangeInput): boolean => rulesFor(c.entity)?.takesTeamLock(c) ?? false;

/**
 * The first of [parents] the team doesn't have, in any status (merged included). Row-level
 * security hides another team's records, so a parent there is missing here too.
 */
export async function missingParent(tx: Tx, teamId: string, parents: ParentRef[]): Promise<ParentRef | null> {
  for (const p of parents) {
    const rows =
      p.entity === 'patient'
        ? await tx`select 1 from sineobex.patients where team_id = ${teamId} and id = ${p.id}`
        : p.entity === 'encounter'
          ? await tx`select 1 from sineobex.encounters where team_id = ${teamId} and id = ${p.id}`
          : p.entity === 'problem'
            ? await tx`select 1 from sineobex.problems where team_id = ${teamId} and id = ${p.id}`
            : (await RULES[p.entity].load(tx, p.id, false))
              ? [1]
              : [];
    if (rows.length === 0) return p;
  }
  return null;
}

/** `details.problem` of a stale reference to a missing parent: patient_missing, encounter_missing… */
export const missingProblem = (p: ParentRef) => `${p.entity}_missing`;
