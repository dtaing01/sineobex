import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from '../src/migrate.ts';
import { createScratchDatabase, type ScratchDatabase } from '../src/testing.ts';
import { asApp, makeTeam, makeUser, refusal } from './helpers.ts';

// 0018: the life of a note and of its encounter (phase 4 design, lifecycle 2.2). The encounter's
// status follows its notes, by trigger, and the answers the trigger must give are the shared
// vectors the API and the phone read. Made-up answers only.

interface Case<I, E> {
  name: string;
  input: I;
  expected: E;
}
type NoteStatus = 'draft' | 'completed' | 'signed';
interface NoteShape {
  status: NoteStatus;
  medical: boolean;
  empty: boolean;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../packages/contract/test-vectors/note-lifecycle.json', import.meta.url), 'utf8'),
) as {
  cases: {
    encounterStatus: Case<NoteShape[], NoteStatus>[];
    noteIsEmpty: Case<Record<string, unknown>, boolean>[];
  };
};

const CHECK = '23514';
const ANSWERS = { plan: 'Demo: dressing changed' };
const BLANKS = { site: null, plan: '', dressings: [], vitals: {} };

describe('0018 encounter lifecycle', () => {
  let db: ScratchDatabase;
  let team: string;
  let author: string;

  const inTeam = <T>(run: (tx: TransactionSql) => Promise<T>) =>
    asApp(db.appUrl, { teamId: team, userId: author }, run);

  const encounter = async () => {
    const id = randomUUID();
    await inTeam(
      (tx) => tx`insert into sineobex.encounters (id, team_id, kind, author_user_id, started_at)
                 values (${id}, ${team}, 'medical', ${author}, now())`,
    );
    return id;
  };

  const statusOf = async (encounterId: string) => {
    const [row] = await db.owner<{ status: string; worked: string }[]>`
      select status, sineobex.encounter_status(id) as worked from sineobex.encounters where id = ${encounterId}`;
    // The column never disagrees with the function that fills it.
    expect(row!.status).toBe(row!.worked);
    return row!.status;
  };

  /** A draft, inserted as the API inserts one. */
  const draft = async (encounterId: string, data: Record<string, unknown> = ANSWERS, medical = false) => {
    const id = randomUUID();
    await inTeam(
      (
        tx,
      ) => tx`insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id,
                   medical, data)
                 values (${id}, ${team}, ${encounterId}, 'demo_note', ${author}, ${medical},
                   ${tx.json(data as never)})`,
    );
    return id;
  };

  /** The columns a note that waits, or a finished Non-Medical note, must carry. */
  const complete = (tx: TransactionSql, noteId: string) =>
    tx`update sineobex.encounter_notes set status = 'completed', completed_at = now(), completed_by = ${author}
       where id = ${noteId}`;

  /** A sign-off row (0019): a signed note names the one that signs it. */
  const signoff = async (tx: TransactionSql, noteId: string) => {
    const id = randomUUID();
    await tx`insert into sineobex.note_signoffs (id, team_id, note_id, act, effect, content_hash, signer_user_id,
               signer_name, signer_credential, needs_attestation, statement_version, signed_at, clock_verified)
             values (${id}, ${team}, ${noteId}, 'sign', 'signed', ${'ab'.repeat(32)}, ${author}, 'Demo Signer',
               'attending', false, 'demo-1', now(), true)`;
    return id;
  };

  /** The columns a signed note must carry, written with its sign-off as a sign-off is applied. */
  const sign = async (tx: TransactionSql, noteId: string) => {
    const signoffId = await signoff(tx, noteId);
    await tx`update sineobex.encounter_notes
             set status = 'signed', completed_at = now(), completed_by = ${author},
                 first_signed_at = coalesce(first_signed_at, now()), signoff_id = ${signoffId}
             where id = ${noteId}`;
  };

  /** A note in the state a vector case names. A finished note is inserted finished where it can be. */
  const note = async (encounterId: string, shape: NoteShape) => {
    const data = shape.empty ? {} : ANSWERS;
    if (shape.status === 'draft') return draft(encounterId, data, shape.medical);
    if (shape.status === 'signed') {
      const id = await draft(encounterId, data, shape.medical);
      await inTeam((tx) => sign(tx, id));
      return id;
    }
    const id = randomUUID();
    await inTeam(
      (
        tx,
      ) => tx`insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id,
                   medical, data, status, completed_at, completed_by)
                 values (${id}, ${team}, ${encounterId}, 'demo_note', ${author}, ${shape.medical},
                   ${tx.json(data as never)}, 'completed', now(), ${author})`,
    );
    return id;
  };

  const setData = (tx: TransactionSql, noteId: string, data: Record<string, unknown>) =>
    tx`update sineobex.encounter_notes set data = ${tx.json(data as never)} where id = ${noteId}`;

  const dataOf = async (noteId: string) => {
    const [row] = await db.owner<{ data: unknown }[]>`
      select data from sineobex.encounter_notes where id = ${noteId}`;
    return row!.data;
  };

  beforeAll(async () => {
    db = await createScratchDatabase();
    team = await makeTeam(db.owner, 'Lifecycle Team');
    author = await makeUser(db.owner, 'lifecycle-author@example.com');
  });
  afterAll(() => db.drop());

  describe('the status trigger', () => {
    it('the encounter’s status follows its notes', async () => {
      const cases = vectors.cases.encounterStatus;
      expect(cases.length).toBeGreaterThanOrEqual(19);
      for (const c of cases) {
        const id = await encounter();
        for (const shape of c.input) await note(id, shape);
        expect(await statusOf(id), c.name).toBe(c.expected);
      }
    });

    it('calls the same answers blank as the shared rule does', async () => {
      const cases = vectors.cases.noteIsEmpty;
      expect(cases.length).toBeGreaterThanOrEqual(14);
      for (const c of cases) {
        const [row] = await db.owner<{ empty: boolean }[]>`
          select sineobex.note_is_empty(${db.owner.json(c.input as never)}) as empty`;
        expect(row!.empty, c.name).toBe(c.expected);
      }
    });

    it('an empty draft does not count', async () => {
      const id = await encounter();
      await note(id, { status: 'completed', medical: false, empty: false });
      expect(await statusOf(id)).toBe('completed');
      const picked = await draft(id, {});
      expect(await statusOf(id)).toBe('completed');
      await draft(id, BLANKS);
      expect(await statusOf(id)).toBe('completed');

      // Its first real answer makes it count. Blanked again (Remove this note), it is out of the way.
      await inTeam((tx) => setData(tx, picked, { ...BLANKS, painScore: 0 }));
      expect(await statusOf(id)).toBe('draft');
      await inTeam((tx) => setData(tx, picked, BLANKS));
      expect(await statusOf(id)).toBe('completed');
    });

    it('moves with every change of a note’s status', async () => {
      const id = await encounter();
      const waiting = await draft(id, ANSWERS, true);
      const other = await draft(id, ANSWERS, true);
      await inTeam((tx) => sign(tx, other));
      expect(await statusOf(id)).toBe('draft');
      await inTeam((tx) => complete(tx, waiting));
      expect(await statusOf(id)).toBe('completed');
      // Reopened by its author, then signed.
      await inTeam(
        (
          tx,
        ) => tx`update sineobex.encounter_notes set status = 'draft', completed_at = null, completed_by = null
                   where id = ${waiting}`,
      );
      expect(await statusOf(id)).toBe('draft');
      await inTeam((tx) => sign(tx, waiting));
      expect(await statusOf(id)).toBe('signed');
    });

    it('leaves the encounter alone while its status stays the same', async () => {
      const id = await encounter();
      const noteId = await draft(id);
      const version = async () => {
        const [row] = await db.owner<{ at: string }[]>`
          select updated_at::text as at from sineobex.encounters where id = ${id}`;
        return row!.at;
      };
      const before = await version();
      await inTeam((tx) => setData(tx, noteId, { ...ANSWERS, painScore: 3 }));
      expect(await version()).toBe(before);
      await inTeam((tx) => complete(tx, noteId));
      expect(await version()).not.toBe(before);
    });

    describe('two writers of one visit at once, neither holding the team lock', () => {
      /** Runs `first` and, once it has written but not committed, `second`; then lets both finish. */
      const atOnce = async (
        first: (tx: TransactionSql) => Promise<unknown>,
        second: (tx: TransactionSql) => Promise<unknown>,
      ) => {
        let wrote!: () => void;
        const written = new Promise<void>((resolve) => (wrote = resolve));
        const a = inTeam(async (tx) => {
          await first(tx);
          wrote();
          // Long enough for the second writer to reach the visit while this one is open.
          await tx`select pg_sleep(0.3)`;
        });
        const b = (async () => {
          await written;
          await inTeam(second);
        })();
        await Promise.all([a, b]);
      };

      it('each finishing a different note: the visit is finished', async () => {
        const id = await encounter();
        const one = await draft(id);
        const two = await draft(id);
        await atOnce(
          (tx) => complete(tx, one),
          (tx) => complete(tx, two),
        );
        expect(await statusOf(id)).toBe('completed');
      });

      it('one signing while another opens a new draft: the visit is a draft', async () => {
        const id = await encounter();
        const signed = await draft(id, ANSWERS, true);
        await atOnce(
          (tx) => sign(tx, signed),
          (tx) =>
            tx`insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id, data)
               values (${randomUUID()}, ${team}, ${id}, 'demo_note', ${author}, ${tx.json(ANSWERS as never)})`,
        );
        expect(await statusOf(id)).toBe('draft');
      });
    });

    it('works out one encounter at a time', async () => {
      const first = await encounter();
      const second = await encounter();
      await note(first, { status: 'completed', medical: false, empty: false });
      await note(second, { status: 'draft', medical: false, empty: false });
      expect(await statusOf(first)).toBe('completed');
      expect(await statusOf(second)).toBe('draft');
    });
  });

  describe('the finished-note guard', () => {
    const FINISHED: NoteShape[] = [
      { status: 'completed', medical: false, empty: false },
      { status: 'completed', medical: true, empty: false },
      { status: 'signed', medical: true, empty: false },
    ];
    const GUARD = { code: CHECK, constraint: 'encounter_notes_finished_data' };
    const CORRECTED = { plan: 'Demo: dressing left in place' };

    it('a finished note’s answers change only through a correction', async () => {
      for (const shape of FINISHED) {
        const id = await encounter();
        const noteId = await note(id, shape);
        const other = await draft(id);
        const label = `${shape.status}, medical ${shape.medical}`;

        expect(await refusal(inTeam((tx) => setData(tx, noteId, CORRECTED))), label).toEqual(GUARD);
        // One answer added, as the draft rule writes a field.
        expect(
          await refusal(
            inTeam(
              (tx) => tx`update sineobex.encounter_notes set data = data || '{"painScore": 2}'::jsonb
                         where id = ${noteId}`,
            ),
          ),
          label,
        ).toEqual(GUARD);
        // A correction of another note opens nothing here.
        expect(
          await refusal(
            inTeam(async (tx) => {
              await tx`select set_config('app.note_correction', ${other}, true)`;
              await setData(tx, noteId, CORRECTED);
            }),
          ),
          label,
        ).toEqual(GUARD);
        expect(await dataOf(noteId), label).toEqual(ANSWERS);

        await inTeam(async (tx) => {
          await tx`select set_config('app.note_correction', ${noteId}, true)`;
          await setData(tx, noteId, CORRECTED);
        });
        expect(await dataOf(noteId), label).toEqual(CORRECTED);
        // The correction opened the note for its own transaction only.
        expect(await refusal(inTeam((tx) => setData(tx, noteId, ANSWERS))), label).toEqual(GUARD);
      }
    });

    it('a correction names its note in any case and with spaces around it', async () => {
      const id = await encounter();
      for (const spell of [(n: string) => n.toUpperCase(), (n: string) => `  ${n}\n`]) {
        const noteId = await note(id, { status: 'completed', medical: false, empty: false });
        await inTeam(async (tx) => {
          await tx`select set_config('app.note_correction', ${spell(noteId)}, true)`;
          await setData(tx, noteId, CORRECTED);
        });
        expect(await dataOf(noteId)).toEqual(CORRECTED);
      }
      // A value that names no note at all is still a class 23 refusal, never another class.
      const noteId = await note(id, { status: 'completed', medical: false, empty: false });
      for (const value of ['not a note', '{' + noteId + '}', ' ', '\u00a0']) {
        expect(
          await refusal(
            inTeam(async (tx) => {
              await tx`select set_config('app.note_correction', ${value}, true)`;
              await setData(tx, noteId, CORRECTED);
            }),
          ),
          value,
        ).toEqual(GUARD);
      }
    });

    it('a correction opens one note, not every note of the statement', async () => {
      const id = await encounter();
      const corrected = await note(id, { status: 'completed', medical: false, empty: false });
      const beside = await note(id, { status: 'completed', medical: false, empty: false });
      expect(
        await refusal(
          inTeam(async (tx) => {
            await tx`select set_config('app.note_correction', ${corrected}, true)`;
            await tx`update sineobex.encounter_notes set data = '{}' where id in (${corrected}, ${beside})`;
          }),
        ),
      ).toEqual(GUARD);
      expect(await dataOf(corrected)).toEqual(ANSWERS);
      expect(await dataOf(beside)).toEqual(ANSWERS);
    });

    it('the update that finishes a note may change its answers', async () => {
      const id = await encounter();
      const signed = await draft(id, { ...ANSWERS, hidden: 'Demo: an answer that no longer counts' }, true);
      await inTeam(async (tx) => {
        const signoffId = await signoff(tx, signed);
        await tx`update sineobex.encounter_notes
                 set status = 'signed', data = ${tx.json(ANSWERS as never)}, completed_at = now(),
                     completed_by = ${author}, first_signed_at = now(), signoff_id = ${signoffId}
                 where id = ${signed}`;
      });
      expect(await dataOf(signed)).toEqual(ANSWERS);
      expect(await statusOf(id)).toBe('signed');
    });

    it('a reopen does not carry new answers with it', async () => {
      const id = await encounter();
      const waiting = await note(id, { status: 'completed', medical: true, empty: false });
      expect(
        await refusal(
          inTeam(
            (tx) => tx`update sineobex.encounter_notes
                       set status = 'draft', completed_at = null, completed_by = null, data = '{}'
                       where id = ${waiting}`,
          ),
        ),
      ).toEqual(GUARD);
      expect(await statusOf(id)).toBe('completed');
    });

    it('a finished note keeps its visit, its type and version, whether it is Medical, and its author', async () => {
      const elsewhere = await encounter();
      const someoneElse = await makeUser(db.owner, 'lifecycle-someone-else@example.com');
      const changes: [string, Record<string, unknown>][] = [
        ['encounter_notes_finished_encounter_id', { encounter_id: elsewhere }],
        ['encounter_notes_finished_note_type_key', { note_type_key: 'other_note' }],
        ['encounter_notes_finished_note_type_version', { note_type_version: 2 }],
        ['encounter_notes_finished_author_user_id', { author_user_id: someoneElse }],
      ];
      for (const shape of FINISHED) {
        const id = await encounter();
        const noteId = await note(id, shape);
        const label = `${shape.status}, medical ${shape.medical}`;
        const flipped: [string, Record<string, unknown>] = [
          'encounter_notes_finished_medical',
          // A signed note must stay Medical anyway; a waiting one could otherwise become Non-Medical.
          { medical: !shape.medical },
        ];
        for (const [constraint, change] of [...changes, flipped]) {
          const refused = { code: CHECK, constraint };
          const set = (tx: TransactionSql) =>
            tx`update sineobex.encounter_notes set ${tx(change)} where id = ${noteId}`;
          expect(await refusal(inTeam(set)), `${label} ${constraint}`).toEqual(refused);
          // A correction of this very note opens none of them.
          expect(
            await refusal(
              inTeam(async (tx) => {
                await tx`select set_config('app.note_correction', ${noteId}, true)`;
                await set(tx);
              }),
            ),
            `${label} ${constraint}, correcting`,
          ).toEqual(refused);
        }
      }
      // A draft is the API's to check: the guard holds finished notes only.
      const id = await encounter();
      const open = await draft(id);
      for (const [constraint, change] of [...changes, ['', { medical: true }] as const]) {
        expect(
          await refusal(
            inTeam((tx) => tx`update sineobex.encounter_notes set ${tx(change)} where id = ${open}`),
          ),
          `draft ${constraint}`,
        ).toBeNull();
      }
    });

    it('a note that was ever signed is never reopened, and keeps the time it was first signed', async () => {
      const id = await encounter();
      const signed = await note(id, { status: 'signed', medical: true, empty: false });
      const reopen = (noteId: string) =>
        refusal(
          inTeam(
            (tx) => tx`update sineobex.encounter_notes
                       set status = 'draft', completed_at = null, completed_by = null, signoff_id = null,
                           attestation = 'not_needed'
                       where id = ${noteId}`,
          ),
        );
      const NEVER = { code: CHECK, constraint: 'encounter_notes_signed_never_reopened' };
      expect(await reopen(signed)).toEqual(NEVER);
      // A student's correction sent it back to wait for a co-signer: still never a draft again.
      await inTeam(async (tx) => {
        await tx`select set_config('app.note_correction', ${signed}, true)`;
        await tx`update sineobex.encounter_notes
                 set status = 'completed', signoff_id = null, data = ${tx.json(CORRECTED as never)}
                 where id = ${signed}`;
      });
      expect(await reopen(signed)).toEqual(NEVER);
      const ONCE = { code: CHECK, constraint: 'encounter_notes_first_signed_at_once' };
      for (const firstSignedAt of [new Date('2026-01-01T00:00:00Z'), null]) {
        expect(
          await refusal(
            inTeam(async (tx) => {
              await tx`select set_config('app.note_correction', ${signed}, true)`;
              await tx`update sineobex.encounter_notes set first_signed_at = ${firstSignedAt} where id = ${signed}`;
            }),
          ),
        ).toEqual(ONCE);
      }
      // A note finished but never signed may still be reopened by its author.
      const waiting = await note(id, { status: 'completed', medical: true, empty: false });
      expect(await reopen(waiting)).toBeNull();
    });

    it('lets everything but the answers of a finished note change, and a draft change freely', async () => {
      const id = await encounter();
      const signed = await note(id, { status: 'signed', medical: true, empty: false });
      await inTeam(
        (tx) => tx`update sineobex.encounter_notes set attestation = 'waiting', assigned_user_id = ${author},
                     data = ${tx.json(ANSWERS as never)}
                   where id = ${signed}`,
      );
      const open = await draft(id);
      await inTeam((tx) => setData(tx, open, CORRECTED));
      expect(await dataOf(open)).toEqual(CORRECTED);
    });
  });

  describe('what a note’s columns must agree on', () => {
    let encounterId: string;
    const NOW = new Date();
    const row = (over: Record<string, unknown>) => ({
      id: randomUUID(),
      team_id: team,
      encounter_id: encounterId,
      note_type_key: 'demo_note',
      author_user_id: author,
      ...over,
    });
    const insert = (over: Record<string, unknown>) =>
      refusal(inTeam((tx) => tx`insert into sineobex.encounter_notes ${tx(row(over))}`));
    /** A note inserted as `start`, then changed step by step. The answer is the last step's. */
    const update = async (start: Record<string, unknown>, ...steps: Record<string, unknown>[]) => {
      const values = row(start);
      await inTeam((tx) => tx`insert into sineobex.encounter_notes ${tx(values)}`);
      // A note names only a sign-off of its own: each note gets one, put where a step says OWN.
      const own = await inTeam((tx) => signoff(tx, values.id));
      let last: Awaited<ReturnType<typeof refusal>> = null;
      for (const step of steps) {
        expect(last).toBeNull();
        const change = step.signoff_id === OWN ? { ...step, signoff_id: own } : step;
        last = await refusal(
          inTeam((tx) => tx`update sineobex.encounter_notes set ${tx(change)} where id = ${values.id}`),
        );
      }
      return last;
    };
    const finished = () => ({ completed_at: NOW, completed_by: author });
    const OWN = 'the note’s own sign-off';
    const signed = () => ({
      status: 'signed',
      medical: true,
      first_signed_at: NOW,
      signoff_id: OWN,
      ...finished(),
    });

    beforeAll(async () => {
      encounterId = await encounter();
    });

    it('a new note is a draft, Non-Medical, with nothing to attest and nobody assigned', async () => {
      // As phase 2 inserts one: none of the new columns named.
      const { id } = row({});
      expect(await insert({ id })).toBeNull();
      const [note] = await db.owner`
        select medical, status, completed_at, completed_by, first_signed_at, signoff_id, attestation,
               assigned_user_id
        from sineobex.encounter_notes where id = ${id}`;
      expect(note).toEqual({
        medical: false,
        status: 'draft',
        completed_at: null,
        completed_by: null,
        first_signed_at: null,
        signoff_id: null,
        attestation: 'not_needed',
        assigned_user_id: null,
      });
    });

    it('a note has a time of finishing exactly while it is not a draft', async () => {
      const refused = { code: CHECK, constraint: 'encounter_notes_completed_at_when_finished' };
      expect(await insert({ status: 'draft', ...finished() })).toEqual(refused);
      expect(await update({}, { status: 'completed' })).toEqual(refused);
      expect(await update({ status: 'completed', ...finished() }, { status: 'draft' })).toEqual(refused);
      expect(await insert({ status: 'completed', ...finished() })).toBeNull();
      expect(await update({}, { status: 'completed', ...finished() })).toBeNull();
      expect(
        await update(
          { status: 'completed', ...finished() },
          { status: 'draft', completed_at: null, completed_by: null },
        ),
      ).toBeNull();
    });

    it('the time of finishing and the person who finished go together', async () => {
      const refused = { code: CHECK, constraint: 'encounter_notes_completed_by_with_at' };
      expect(await insert({ status: 'completed', completed_at: NOW })).toEqual(refused);
      expect(await insert({ status: 'draft', completed_by: author })).toEqual(refused);
      expect(await update({ status: 'completed', ...finished() }, { completed_by: null })).toEqual(refused);
    });

    it('only a signed note waits for an attestation or has one', async () => {
      const refused = { code: CHECK, constraint: 'encounter_notes_attestation_when_signed' };
      for (const attestation of ['waiting', 'attested']) {
        expect(await insert({ status: 'draft', attestation }), attestation).toEqual(refused);
        expect(
          await insert({ status: 'completed', medical: true, attestation, ...finished() }),
          attestation,
        ).toEqual(refused);
        expect(await update({}, { ...signed(), attestation }), attestation).toBeNull();
      }
      // A student's correction sends a signed note back to wait for a co-signer: the attestation goes too.
      const waiting = { ...signed(), attestation: 'waiting' };
      const back = { status: 'completed', signoff_id: null };
      expect(await update({}, waiting, back)).toEqual(refused);
      expect(await update({}, waiting, { ...back, attestation: 'not_needed' })).toBeNull();
    });

    it('an attestation is one of three words', async () => {
      expect(await insert({ attestation: 'refused' })).toEqual({
        code: CHECK,
        constraint: 'encounter_notes_attestation_check',
      });
      expect(await insert({ attestation: null })).toEqual({ code: '23502', constraint: undefined });
    });

    it('a signed note says when it was first signed', async () => {
      const refused = { code: CHECK, constraint: 'encounter_notes_signed_has_first_signed' };
      expect(await update({}, { ...signed(), first_signed_at: null })).toEqual(refused);
      expect(await update({}, signed())).toBeNull();
      // The time stays when a correction sends the note back to wait, so it is never reopened.
      expect(
        await update(
          { status: 'completed', medical: true, first_signed_at: NOW, ...finished() },
          { attestation: 'not_needed' },
        ),
      ).toBeNull();
    });

    it('a Non-Medical note is never signed', async () => {
      const refused = { code: CHECK, constraint: 'encounter_notes_signed_is_medical' };
      expect(await update({}, { ...signed(), medical: false })).toEqual(refused);
      expect(await update({ medical: false }, { status: 'completed', ...finished() })).toBeNull();
    });

    it('the person who finished a note, and the one it is assigned to, are people', async () => {
      const nobody = randomUUID();
      expect(await insert({ status: 'completed', completed_at: NOW, completed_by: nobody })).toEqual({
        code: '23503',
        constraint: 'encounter_notes_completed_by_fkey',
      });
      expect(await insert({ assigned_user_id: nobody })).toEqual({
        code: '23503',
        constraint: 'encounter_notes_assigned_user_id_fkey',
      });
    });

    it('a note can be named together with its team', async () => {
      const keys = await db.owner<{ name: string; columns: string[] }[]>`
        select c.conname as name,
               array(select a.attname::text from unnest(c.conkey) with ordinality k (attnum, n)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.n) as columns
        from pg_constraint c
        where c.conrelid = 'sineobex.encounter_notes'::regclass and c.contype = 'u'
        order by c.conname`;
      expect(keys).toEqual([
        { name: 'encounter_notes_team_id_encounter_id_id_key', columns: ['team_id', 'encounter_id', 'id'] },
        { name: 'encounter_notes_team_id_key', columns: ['team_id', 'id'] },
      ]);
    });

    it('the co-sign and attestation queues have their indexes', async () => {
      const indexes = await db.owner<{ name: string; columns: string[]; predicate: string }[]>`
        select c.relname as name, pg_get_expr(i.indpred, i.indrelid) as predicate,
               array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k (attnum, n)
                     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.n) as columns
        from pg_index i join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'sineobex.encounter_notes'::regclass and i.indpred is not null
        order by c.relname`;
      expect(indexes).toEqual([
        {
          name: 'encounter_notes_cosign',
          columns: ['team_id', 'completed_at'],
          predicate: "((status = 'completed'::text) AND medical)",
        },
        {
          name: 'encounter_notes_waiting',
          columns: ['team_id', 'updated_at'],
          predicate: "(attestation = 'waiting'::text)",
        },
      ]);
    });
  });

  describe('the encounter’s own new columns', () => {
    const set = async (values: Record<string, unknown>) => {
      const id = await encounter();
      return refusal(inTeam((tx) => tx`update sineobex.encounters set ${tx(values)} where id = ${id}`));
    };

    it('a summary is absent or 1 to 4,000 characters', async () => {
      const refused = { code: CHECK, constraint: 'encounters_summary_check' };
      expect(await set({ summary: '' })).toEqual(refused);
      expect(await set({ summary: 'é'.repeat(4001) })).toEqual(refused);
      // Characters, not bytes.
      expect(await set({ summary: 'é'.repeat(4000) })).toBeNull();
      expect(await set({ summary: 'D' })).toBeNull();
      expect(await set({ summary: null })).toBeNull();
    });

    it('a place entered by hand is absent or 1 to 200 characters', async () => {
      const refused = { code: CHECK, constraint: 'encounters_location_text_check' };
      expect(await set({ location_text: '' })).toEqual(refused);
      expect(await set({ location_text: 'é'.repeat(201) })).toEqual(refused);
      expect(await set({ location_text: 'é'.repeat(200) })).toBeNull();
      expect(await set({ location_text: 'D' })).toBeNull();
      expect(await set({ location_text: null })).toBeNull();
    });

    it('an encounter starts with neither', async () => {
      const id = await encounter();
      const [row] = await db.owner`select summary, location_text from sineobex.encounters where id = ${id}`;
      expect(row).toEqual({ summary: null, location_text: null });
    });
  });

  it('the app role still cannot delete a note', async () => {
    const id = await encounter();
    const noteId = await draft(id);
    expect(
      await refusal(inTeam((tx) => tx`delete from sineobex.encounter_notes where id = ${noteId}`)),
    ).toEqual({ code: '42501', constraint: undefined });
    expect(await refusal(inTeam((tx) => tx`delete from sineobex.encounters where id = ${id}`))).toEqual({
      code: '42501',
      constraint: undefined,
    });
  });

  it('another team’s request neither reads a note nor puts one on its encounter', async () => {
    const otherTeam = await makeTeam(db.owner, 'Lifecycle Other Team');
    const id = await encounter();
    const noteId = await draft(id);
    const asOther = <T>(run: (tx: TransactionSql) => Promise<T>) =>
      asApp(db.appUrl, { teamId: otherTeam, userId: author }, run);
    expect(await asOther((tx) => tx`select id from sineobex.encounter_notes where id = ${noteId}`)).toEqual(
      [],
    );
    // Its own note on this team's encounter: the foreign key checks the team, whatever the request
    // can see, so the note is refused and the encounter does not move.
    await db.owner`update sineobex.encounters set status = 'signed' where id = ${id}`;
    expect(
      await refusal(
        asOther(
          (
            tx,
          ) => tx`insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, author_user_id,
                       data)
                     values (${randomUUID()}, ${otherTeam}, ${id}, 'demo_note', ${author}, '{"plan": "Demo: x"}')`,
        ),
      ),
    ).toEqual({ code: '23503', constraint: 'encounter_notes_team_id_encounter_id_fkey' });
    const [row] = await db.owner<{ status: string }[]>`
      select status from sineobex.encounters where id = ${id}`;
    expect(row!.status).toBe('signed');
  });
});

describe('0018 on a database that already holds notes', () => {
  let db: ScratchDatabase;
  let dir: string;
  let team: string;
  let author: string;
  const at = new Date('2026-10-20T15:00:00.000Z');
  const encounters: Record<NoteStatus, string> = { draft: '', completed: '', signed: '' };
  const notes: Record<NoteStatus, string> = { draft: '', completed: '', signed: '' };
  let before: { encounters: unknown[]; notes: Record<string, unknown>[] };

  const snapshot = async () => ({
    encounters: await db.owner`
      select id, team_id, patient_id, kind, status, author_user_id, started_at, started_device_time,
             clock_verified, location, created_device_id, field_versions, field_meta, version, created_at,
             updated_at
      from sineobex.encounters order by id`,
    notes: await db.owner<Record<string, unknown>[]>`
      select id, team_id, encounter_id, note_type_key, note_type_version, status, author_user_id, data,
             field_versions, field_meta, version, created_at, updated_at
      from sineobex.encounter_notes order by id`,
  });

  beforeAll(async () => {
    // Every migration before 0018, so rows can be written as phase 2 left them.
    dir = await mkdtemp(join(tmpdir(), 'sineobex-0017-'));
    for (const f of await readdir(MIGRATIONS_DIR)) {
      if (f.endsWith('.sql') && f < '0018') await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    db = await createScratchDatabase({ migrate: false });
    await migrate(db.owner, { dir });
    team = await makeTeam(db.owner, 'Phase Two Team');
    author = await makeUser(db.owner, 'phase-two-author@example.com');

    // A phone could set either status in phase 2, and nothing tied the two together.
    for (const status of ['draft', 'completed', 'signed'] as const) {
      encounters[status] = randomUUID();
      notes[status] = randomUUID();
      await db.owner`
        insert into sineobex.encounters (id, team_id, kind, status, author_user_id, started_at, created_at, updated_at)
        values (${encounters[status]}, ${team}, 'non_medical', 'draft', ${author}, ${at}, ${at}, ${at})`;
      await db.owner`
        insert into sineobex.encounter_notes (id, team_id, encounter_id, note_type_key, status, author_user_id,
          data, field_versions, version, created_at, updated_at)
        values (${notes[status]}, ${team}, ${encounters[status]}, 'demo_note', ${status}, ${author},
          '{"plan": "Demo: seen at the day center"}', '{"status": 2, "data.plan": 1}', 3, ${at}, ${at})`;
    }
    before = await snapshot();
    await migrate(db.owner);
  });
  afterAll(async () => {
    await db.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('rows from before the migration stay', async () => {
    expect(before.notes).toHaveLength(3);
    // Every column phase 2 wrote, the time of the last change included, and each encounter's status.
    expect(await snapshot()).toEqual(before);

    const added = await db.owner<Record<string, unknown>[]>`
      select status, medical, completed_at, completed_by, first_signed_at, signoff_id, attestation,
             assigned_user_id
      from sineobex.encounter_notes order by status`;
    const blank = {
      medical: false,
      completed_at: null,
      completed_by: null,
      first_signed_at: null,
      signoff_id: null,
      attestation: 'not_needed',
      assigned_user_id: null,
    };
    expect(added).toEqual([
      // Finished when it was last changed, by its author: the nearest thing phase 2 recorded.
      { ...blank, status: 'completed', completed_at: at, completed_by: author },
      { ...blank, status: 'draft' },
      { ...blank, status: 'signed' },
    ]);
  });

  it('checks an old row from its next change on', async () => {
    const touch = (status: NoteStatus) =>
      refusal(
        db.owner`update sineobex.encounter_notes set assigned_user_id = ${author} where id = ${notes[status]}`,
      );
    // The filled row is whole. Phase 2 never signed a note, so a row marked signed by hand is not.
    expect(await touch('completed')).toBeNull();
    expect(await touch('draft')).toBeNull();
    expect((await touch('signed'))?.code).toBe(CHECK);
    // The change is stamped as every change is: the migration left the touch trigger on.
    const [row] = await db.owner<{ moved: boolean }[]>`
      select updated_at > ${at} as moved from sineobex.encounter_notes where id = ${notes.completed}`;
    expect(row!.moved).toBe(true);
  });

  it('adds the key from a note to its team’s encounter without holding old rows to it', async () => {
    const [key] = await db.owner<{ valid: boolean; toEncounters: boolean }[]>`
      select convalidated as valid, confrelid = 'sineobex.encounters'::regclass as "toEncounters"
      from pg_constraint
      where conrelid = 'sineobex.encounter_notes'::regclass and conname = 'encounter_notes_team_id_encounter_id_fkey'`;
    expect(key).toEqual({ valid: false, toEncounters: true });
  });

  it('adds each check without holding old rows to it', async () => {
    const checks = await db.owner<{ name: string }[]>`
      select conname as name from pg_constraint
      where conrelid = 'sineobex.encounter_notes'::regclass and contype = 'c' and not convalidated
      order by conname`;
    // 0019 adds one more the same way.
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'encounter_notes_attestation_when_signed',
        'encounter_notes_completed_at_when_finished',
        'encounter_notes_completed_by_with_at',
        'encounter_notes_signed_has_first_signed',
        'encounter_notes_signed_is_medical',
        'encounter_notes_signed_never_reopened',
      ]),
    );
  });

  it('works out an old encounter’s status at its notes’ next change', async () => {
    await db.owner`
      update sineobex.encounter_notes set data = data || '{"painScore": 1}'::jsonb where id = ${notes.draft}`;
    await db.owner`
      update sineobex.encounter_notes set status = 'completed', completed_at = now(), completed_by = ${author}
      where id = ${notes.draft}`;
    const [row] = await db.owner<{ status: string }[]>`
      select status from sineobex.encounters where id = ${encounters.draft}`;
    expect(row!.status).toBe('completed');
  });
});
