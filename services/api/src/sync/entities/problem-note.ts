import type { z } from '@hono/zod-openapi';
import { storeCreate, type EntityRules } from '../records.ts';
import { ProblemNoteCreate, valueParents } from './values.ts';

/**
 * Notes on a problem (design 9.5): append-only rows, a wrong note followed by a correcting one. A
 * note written offline on a problem someone has since marked entered in error, or merged into
 * another, is stored as sent: a real clinical note is never refused for something the worker
 * couldn't see (review finding 7). The receipt tells its author.
 */

type Value = z.infer<typeof ProblemNoteCreate>;

interface NoteRow {
  id: string;
  teamId: string;
  problemId: string;
  text: string;
  encounterId: string | null;
  writtenAt: Date;
  authorUserId: string;
  createdAt: Date;
  patientId: string;
}

export const problemNoteRules: EntityRules<Value> = {
  entity: 'problem_note',
  auditPrefix: 'problem_note',
  permission: () => 'encounters.chart',
  takesTeamLock: () => true,
  create: ProblemNoteCreate,
  parents: (v) => valueParents('problem_note', 'create', undefined, v),
  parentsOfSet: () => [],

  async applyCreate(ctx, v) {
    const [problem] = await ctx.tx<{ patientId: string; retracted: boolean }[]>`
      select patient_id, error_at is not null as retracted from sineobex.problems where id = ${v.problemId}`;
    return storeCreate(ctx, 'problem_note', {
      insert: async (input) => {
        const rows = await ctx.tx`
          insert into sineobex.problem_notes (id, team_id, problem_id, text, encounter_id, written_at,
            author_user_id, created_device_id, change_id)
          values (${input.id}, ${input.teamId}, ${v.problemId}, ${v.text}, ${v.encounterId ?? null}, ${input.at},
                  ${input.authorUserId}, ${input.deviceId}, ${input.changeId})
          on conflict (id) do nothing
          returning id`;
        return rows.length === 0 ? null : {};
      },
      patientId: problem!.patientId,
      action: 'problem_note.created',
      after: async () => (problem!.retracted ? { problemRetracted: true } : undefined),
    });
  },

  fieldClass: () => null,
  fieldSchema: () => null,

  async load(tx, id) {
    const rows = await tx<NoteRow[]>`
      select n.id, n.team_id, n.problem_id, n.text, n.encounter_id, n.written_at, n.author_user_id,
             n.created_at, pr.patient_id
      from sineobex.problem_notes n join sineobex.problems pr on pr.id = n.problem_id
      where n.id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      entity: 'problem_note',
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
        problemId: r.problemId,
        text: r.text,
        encounterId: r.encounterId,
        writtenAt: r.writtenAt.toISOString(),
      },
      internal: {},
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    };
  },

  write: () => Promise.reject(new Error('a problem note is never changed')),
};
