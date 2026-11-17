import type { z } from '@hono/zod-openapi';
import { signedUnder } from '../../encounters/signed-under.ts';
import { credentialChangesAfter, loadSigner } from '../../encounters/signer.ts';
import {
  createReceivedAt,
  receivedAtOf,
  rejected,
  signoffOfOther,
  storeCreate,
  when,
  type EntityRules,
} from '../records.ts';
import { loadEncounter } from './encounter.ts';
import { noteRules } from './note.ts';
import { NoteAddendumCreate, valueParents } from './values.ts';

/**
 * Addenda (phase 4 design, lifecycle 3.6, 4.7): "a dated entry by its author attached below the
 * note" (PRD main 459), or below the visit itself when it names no note. Append-only, made on the
 * phone, and taken in every state of its note: it is text with its own author and time, and
 * refusing it would leave the worker with something they cannot fix (4.1). It changes no state, so
 * it needs no Medical credential: anyone who charts may add one (4.2).
 *
 * Its note must be a note of its visit, which the database's key also holds (0019). That key would
 * answer with a constraint the worker cannot read, so the pair is checked first and a mismatch is a
 * stale reference, as a missing parent is. The author is recorded as they were when they wrote it:
 * their credential is signedUnder's (3.5), from the change's time, as a signature's is.
 */

type Value = z.infer<typeof NoteAddendumCreate>;

interface AddendumRow {
  id: string;
  teamId: string;
  encounterId: string;
  noteId: string | null;
  text: string;
  writtenAt: Date;
  clockVerified: boolean;
  authorUserId: string;
  authorName: string;
  authorCredential: string;
  createdAt: Date;
  patientId: string | null;
}

export const noteAddendumRules: EntityRules<Value> = {
  entity: 'note_addendum',
  auditPrefix: 'addendum',
  permission: () => 'encounters.chart',
  // Every change of a visit's records applies one after the other (4.2).
  takesTeamLock: () => true,
  create: NoteAddendumCreate,
  parents: (v) => valueParents('note_addendum', 'create', undefined, v),
  parentsOfSet: () => [],

  async applyCreate(ctx, v) {
    const { tx, actor, change: c } = ctx;
    // Both exist: apply.ts checked them as the create's parents.
    const visit = (await loadEncounter(tx, v.encounterId, false))!;
    if (v.noteId !== null) {
      const note = (await noteRules.load(tx, v.noteId, false))!;
      if (note.attributes.encounterId !== visit.id) {
        return rejected('stale_reference', { problem: 'encounter_note_missing' });
      }
    }
    const other = await signoffOfOther(tx, v.signoffId, v.noteId, visit.id);
    if (other) return other;
    const author = await loadSigner(tx, actor.teamId, actor.authorId);
    // A push and an admin's accept both come from a member of the team, removed or not.
    if (!author) throw new Error('an addendum from someone who was never a member of the team');
    const writtenAt = when(c);
    const under = signedUnder({
      current: { credential: author.credential, fields: author.fields },
      laterChanges: await credentialChangesAfter(tx, actor.teamId, actor.authorId, writtenAt),
      signedAt: writtenAt.toISOString(),
      receivedAt: (await receivedAtOf(tx, c.changeId)).toISOString(),
      clockVerified: c.clockVerified,
      notBefore: (await createReceivedAt(tx, 'encounter', visit)).toISOString(),
      claimed: null,
    });
    return storeCreate(ctx, 'note_addendum', {
      insert: async (input) => {
        const rows = await tx`
          insert into sineobex.note_addenda (id, team_id, encounter_id, note_id, text, written_at, clock_verified,
            author_user_id, author_name, author_credential, created_device_id, change_id)
          values (${input.id}, ${input.teamId}, ${visit.id}, ${v.noteId}, ${v.text}, ${input.at},
                  ${input.clockVerified}, ${input.authorUserId}, ${author.displayName}, ${under.credential},
                  ${input.deviceId}, ${input.changeId})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : {};
      },
      patientId: visit.patientId,
      action: 'addendum.added',
      auditDetails: { encounterId: visit.id, noteId: v.noteId },
    });
  },

  fieldClass: () => null,
  fieldSchema: () => null,

  async load(tx, id) {
    const rows = await tx<AddendumRow[]>`
      select a.id, a.team_id, a.encounter_id, a.note_id, a.text, a.written_at, a.clock_verified, a.author_user_id,
             a.author_name, a.author_credential, a.created_at, e.patient_id
      from sineobex.note_addenda a join sineobex.encounters e on e.id = a.encounter_id
      where a.id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'note_addendum',
      id: r.id,
      teamId: r.teamId,
      status: 'written',
      authorUserId: r.authorUserId,
      version: 1,
      patientId: r.patientId,
      fieldVersions: {},
      fieldMeta: {},
      values: {},
      attributes: {
        encounterId: r.encounterId,
        noteId: r.noteId,
        text: r.text,
        writtenAt: r.writtenAt.toISOString(),
        clockVerified: r.clockVerified,
        authorName: r.authorName,
        authorCredential: r.authorCredential,
      },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    };
  },

  write: () => Promise.reject(new Error('an addendum is never changed')),
};
