import { randomUUID } from 'node:crypto';
import type { AuditFn, TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';
import { jsonb, type StoredRecord } from '../sync/records.ts';
import { noticeOfVisit, secondAct, type NoteActInputValue, type NoteActResultValue } from './cosign.ts';
import type { AttestRefusal } from './rules.ts';
import { attestOf, type ActNote } from './second-person.ts';

/**
 * Attest (lifecycle 3.7, 5.4): an attending reads a visit's signed notes that wait and attests
 * them, online, all or nothing, as co-sign does (cosign.ts runs both; who may attest is
 * second-person.ts's attestOf). "Attesting adds a dated statement below the note and doesn't change
 * it" (PRD main 216).
 */

const ATTEST_REFUSALS: readonly AttestRefusal[] = [
  'not_waiting',
  'is_author',
  'is_signer',
  'cannot_attest',
  'cannot_see_all',
  'content_changed',
];

/**
 * POST /v1/encounters/{encounterId}/attest. For each note: a note_attestations row that names the
 * note's current signature, the one `signoff_id` holds. The database's key lets a row name any
 * sign-off of its note and cannot see a sign-off's effect (2.4), so the route names it: never a
 * later sign-off that signed nothing, nor a student's that was saved unsigned. The attending's
 * name, NPI and license are stored as they are now; the note's attestation becomes `attested` and
 * nothing else of it changes. One note.attested per note; one notice to the signer of each note's
 * current signature, once for the visit.
 */
export function attestVisit(scope: TeamScope, encounterId: string, input: NoteActInputValue, route: string) {
  return secondAct<{ attestationAfter: 'attested' }>(scope, encounterId, input, route, {
    refusals: ATTEST_REFUSALS,
    messages: {
      not_waiting: 'A note isn’t waiting for attestation any more. Load the visit again.',
      content_changed: 'The visit changed since you read it. Read it again before you attest.',
      // Worded for everyone it covers: whoever wrote, completed or acts as the author of a note.
      is_author: 'You can’t attest a note you wrote, completed or act as the author of.',
      is_signer: 'You can’t attest a note you signed.',
      cannot_attest: 'Your credential can’t attest notes.',
      cannot_see_all:
        'Your role can’t see every part of this note, so you can’t attest it. Someone who can see all of it must.',
    },
    waiting: async (tx, visit) =>
      (
        await tx<{ id: string }[]>`
          select id from sineobex.encounter_notes
          where team_id = ${visit.teamId} and encounter_id = ${visit.id} and status = 'signed'
            and attestation = 'waiting'
          order by created_at, id`
      ).map((r) => r.id),
    effect: attestOf,
    apply: writeAttestations,
  });
}

async function writeAttestations(
  tx: Tx,
  scope: TeamScope,
  audit: AuditFn,
  visit: StoredRecord,
  acts: { n: ActNote; contentHash: string }[],
  statementVersion: string,
): Promise<NoteActResultValue> {
  const { npi, ...fields } = scope.team.credentialFields;
  const attestedAt = scope.deps.now();
  const signers = new Set<string>();
  const notes: NoteActResultValue['notes'] = [];
  for (const { n, contentHash } of acts) {
    const { note } = n;
    const attestationId = randomUUID();
    const signoffId = note.attributes.signoffId as string;
    await tx`
      insert into sineobex.note_attestations
        (id, team_id, note_id, signoff_id, content_hash, attending_user_id, attending_name, attending_npi,
         attending_fields, statement_version, attested_at)
      values (${attestationId}, ${note.teamId}, ${note.id}, ${signoffId}, ${contentHash}, ${scope.principal.userId},
              ${scope.principal.displayName}, ${npi ?? null}, ${jsonb(tx, fields)}, ${statementVersion}, ${attestedAt})`;
    await tx`update sineobex.encounter_notes set attestation = 'attested' where id = ${note.id}`;
    await audit({
      action: 'note.attested',
      entity: 'encounter_note',
      entityId: note.id,
      patientId: visit.patientId,
      details: { attestationId, signoffId },
    });
    // attestEffect refused a note with no signature: it is not signed.
    signers.add(n.signerUserId!);
    notes.push({ noteId: note.id, status: 'signed', attestation: 'attested' });
  }
  // "Your note was attested": once for the visit, to whoever made the signature attested.
  for (const userId of signers) await noticeOfVisit(tx, visit.teamId, userId, 'note_attested', visit.id);
  return { notes };
}
