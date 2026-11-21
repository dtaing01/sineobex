import { readFileSync } from 'node:fs';
import { PRESETS, type ResolvedNoteType } from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Credential } from '../src/auth/permissions.ts';
import { noteContentHash } from '../src/encounters/content-hash.ts';
import {
  attestationRows,
  eventsAfter,
  noteRow,
  noticesOf,
  signoffRows,
  visitStatus,
} from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createPatient, expectAudit, expectAuditClean, logSpy } from './patient-fixtures.ts';
import {
  call,
  clinician,
  CREDENTIAL_FIELDS,
  push,
  results,
  setupTeam,
  type Change,
  type Clinician,
  type Json,
  type Result,
  type Team,
} from './sync-fixtures.ts';

// The phase 4 Done when, the API's half (lifecycle 11.1): "A resident charts a medical, wound and
// social visit as one encounter offline, saves and closes it, completes it later, and an attending
// attests it." The phone's work arrives as the changes its store makes, built from the shared story
// (packages/contract/test-vectors/encounters-done-when.json): steps 1 and 2 are the first push's
// outbox, step 4 the second's. Steps 3, 5, 6 and 7 are asserted here as 11.1 asserts them, on the
// rows, the receipts, the audit chain and the routes; the phone's tests and the portal's read the
// same file. Every person and value is made up.

type Answers = Record<string, unknown>;
type Ref = 'general' | 'redFlags' | 'wound' | 'social';

interface Person {
  email: string;
  displayName: string;
  role: string;
  credential: Credential;
}
interface StoryNote {
  ref: Ref;
  noteTypeKey: string;
  noteTypeVersion: number;
  title: string;
  medical: boolean;
  addedBy: 'resident' | 'app';
  addedWith?: Ref;
  answers: Answers;
  answersAtStep4: Answers;
  act: 'sign' | 'complete';
  effect: string;
  event: string;
  afterStep5: { status: string; attestation: string };
  afterStep7: { status: string; attestation: string };
}
interface Step {
  n: number;
  online: boolean;
  by: 'resident' | 'attending';
  expect: Record<string, Record<string, unknown>>;
}
interface Story {
  people: { resident: Person; attending: Person; programAdmin: Person };
  patient: {
    id: string;
    preferredName: string;
    visualDescriptor: string;
    usualArea: string;
    livingSituation: { kind: string };
    preferredLanguage: string;
  };
  encounter: { kind: 'medical'; locationText: string };
  statementVersions: { sign: string; complete: string; attest: string };
  assessment: string;
  notes: StoryNote[];
  steps: Step[];
  guExam: {
    assessment: string;
    notes: { ref: Ref; noteTypeKey: string; noteTypeVersion: number; title: string; answers: Answers }[];
    refusedTo: 'attending';
    refusal: { status: number; code: string; notes: Ref[] };
    attestedBy: 'programAdmin';
  };
  neverInAuditDetails: string[];
}

const story = JSON.parse(
  readFileSync(
    new URL('../../../packages/contract/test-vectors/encounters-done-when.json', import.meta.url),
    'utf8',
  ),
) as Story;
const P = story.patient.id;
const step = (n: number) => story.steps.find((s) => s.n === n)!.expect;
const byRef = (ref: Ref) => story.notes.find((n) => n.ref === ref)!;

/** The note type as released, which a team gets when it is made (forms 3.4). */
const definitionOf = (key: string, version: number) =>
  PRESETS.find((p) => p.key === key && p.version === version)!.definition as ResolvedNoteType;

/** The answers a note holds once step 4 has run: the person finishes it with both. */
const finalAnswers = (n: StoryNote) => ({ ...n.answers, ...n.answersAtStep4 });

/** The hash the phone sends with a sign-off: over what the summary screen drew (lifecycle 4.5). */
const contentHash = (
  n: { noteTypeKey: string; noteTypeVersion: number },
  noteId: string,
  encounterId: string,
  summary: string,
  answers: Answers,
) =>
  noteContentHash({
    noteId,
    encounterId,
    patientId: P,
    summary,
    definition: definitionOf(n.noteTypeKey, n.noteTypeVersion),
    answers,
  });

/** What nothing logged may hold: the patient, every answer in words, the assessment, the place. */
const NEVER_LOGGED = [
  story.patient.preferredName,
  story.patient.visualDescriptor,
  story.assessment,
  story.encounter.locationText,
  story.guExam.assessment,
  ...[...story.notes, ...story.guExam.notes].flatMap((n) =>
    Object.values(n.answers).filter((v): v is string => typeof v === 'string' && v.startsWith('Demo:')),
  ),
];

const spy = logSpy();
let h: Harness;
let t: Team;
let resident: Clinician;
let attending: Clinician;

const as = async (who: Person, path: string, init: { method?: string; json?: unknown } = {}) =>
  call(h, path, { ...init, token: await h.tokenFor(who.email), teamId: t.teamId });

/** A change as the resident's phone made it offline, [minutesAgo] before now. */
const offline = (minutesAgo: number, c: Omit<Parameters<Clinician['phone']['change']>[0], 'deviceTime'>) =>
  resident.phone.change({
    ...c,
    deviceTime: new Date(h.clock.now.getTime() - minutesAgo * 60_000).toISOString(),
  });

/** The phone reconnects: its outbox goes in one push, under a token minted now. */
const reconnect = async (outbox: Change[]) => {
  const r = await push(h, resident.phone, await h.tokenFor(story.people.resident.email), t.teamId, outbox);
  expect(r.status).toBe(200);
  return results(r.body);
};

/** Each change has a receipt that names it, accepts it and confirms its hash, kept by the server. */
async function expectHashConfirmed(n: number, outbox: Change[], receipts: Result[]) {
  expect(step(n).receipts).toEqual({ status: 'accepted', hashConfirmed: true });
  expect(receipts.map((x) => [x.changeId, x.status, x.hash])).toEqual(
    outbox.map((c) => [c.changeId, 'accepted', c.valueHash]),
  );
  const kept = await h.scratch.owner<{ changeId: string; status: string; valueHash: string }[]>`
    select change_id as "changeId", status, value_hash as "valueHash" from sineobex.sync_changes
    where change_id in ${h.scratch.owner(outbox.map((c) => c.changeId))}`;
  expect(new Map(kept.map((k) => [k.changeId, [k.status, k.valueHash]]))).toEqual(
    new Map(outbox.map((c) => [c.changeId, ['accepted', c.valueHash]])),
  );
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  t = await setupTeam(h);
  const p = story.patient;
  await createPatient(h, t.teamId, t.adminId, {
    id: P,
    preferredName: p.preferredName,
    visualDescriptor: p.visualDescriptor,
    usualArea: p.usualArea,
    livingSituation: p.livingSituation,
    preferredLanguage: p.preferredLanguage,
  });
  const { resident: r, attending: a, programAdmin } = story.people;
  resident = await clinician(h, t, r.email, r.displayName, r.credential, r.role);
  attending = await clinician(h, t, a.email, a.displayName, a.credential, a.role);
  // The team's own Program Admin is the story's, by email, given its name and credential the way
  // db/seed/seed.ts writes them: only an owner appoints a Program Admin, and the members routes an
  // owner can't call are the only ones that change a credential (module 1).
  expect(programAdmin.email).toBe('admin@example.com');
  const sql = h.scratch.owner;
  await sql`update sineobex.users set display_name = ${programAdmin.displayName} where id = ${t.adminId}`;
  await sql`
    update sineobex.team_memberships
    set credential = ${programAdmin.credential},
        credential_fields = ${sql.json(CREDENTIAL_FIELDS[programAdmin.credential])}
    where team_id = ${t.teamId} and user_id = ${t.adminId}`;
});

afterAll(async () => {
  spy.expectClean(NEVER_LOGGED);
  await h?.close();
});

describe('the Done when, the API’s half (lifecycle 11.1)', () => {
  // What the phone holds, by the story's note: the IDs its store made, offline.
  const ids = {} as Record<Ref, string>;
  let encounterId: string;
  let signoffs: Change[];
  let step5Receipts: Result[];

  it('step 3: the phone reconnects; the server holds one draft encounter with four draft notes, each change confirmed by hash', async () => {
    // Steps 1 and 2, offline: the encounter, the three notes the resident adds with the Red flags
    // note the app adds with the first Medical one (in that note's transaction), then each answer
    // as it was entered, one set each (lifecycle 3.2: Save & Close saves nothing extra).
    const visit = await offline(120, {
      entity: 'encounter',
      op: 'create',
      value: { kind: story.encounter.kind, patientId: P, locationText: story.encounter.locationText },
    });
    encounterId = visit.recordId;
    const order: Ref[] = [];
    for (const n of story.notes.filter((x) => x.addedBy === 'resident')) {
      order.push(n.ref);
      for (const app of story.notes.filter((x) => x.addedBy === 'app' && x.addedWith === n.ref))
        order.push(app.ref);
    }
    expect(order).toEqual(story.notes.map((n) => n.ref));
    const creates: Change[] = [];
    for (const ref of order) {
      const n = byRef(ref);
      const c = await offline(118, {
        entity: 'encounter_note',
        op: 'create',
        value: { encounterId, noteTypeKey: n.noteTypeKey, noteTypeVersion: n.noteTypeVersion },
      });
      ids[ref] = c.recordId;
      creates.push(c);
    }
    const sets: Change[] = [];
    for (const n of story.notes) {
      for (const [path, value] of Object.entries(n.answers)) {
        sets.push(
          await offline(110, {
            entity: 'encounter_note',
            op: 'set',
            recordId: ids[n.ref],
            field: `data.${path}`,
            value,
          }),
        );
      }
    }
    const outbox = [visit, ...creates, ...sets];

    const mark = await auditMark(h);
    const receipts = await reconnect(outbox);
    await expectHashConfirmed(3, outbox, receipts);

    // One draft encounter, Medical, for the patient, at the place typed.
    const expected = step(3).server!;
    const visits = await h.scratch.owner<
      { id: string; status: string; kind: string; locationText: string }[]
    >`
      select id, status, kind, location_text as "locationText" from sineobex.encounters
      where team_id = ${t.teamId} and patient_id = ${P}`;
    expect(visits).toEqual([
      {
        id: encounterId,
        status: expected.encounterStatus,
        kind: story.encounter.kind,
        locationText: story.encounter.locationText,
      },
    ]);
    expect(visits).toHaveLength(expected.encounters as number);
    // Four draft notes, each of its type, with every answer of step 2.
    const notes = await h.scratch.owner<
      {
        id: string;
        noteTypeKey: string;
        status: string;
        attestation: string;
        data: Answers;
        authorUserId: string;
      }[]
    >`
      select id, note_type_key as "noteTypeKey", status, attestation, data, author_user_id as "authorUserId"
      from sineobex.encounter_notes where encounter_id = ${encounterId}`;
    expect(notes).toHaveLength(expected.notes as number);
    for (const n of story.notes) {
      expect(notes.find((x) => x.id === ids[n.ref])).toEqual({
        id: ids[n.ref],
        noteTypeKey: n.noteTypeKey,
        status: expected.noteStatus,
        attestation: expected.attestation,
        data: n[expected.answers as 'answers'],
        authorUserId: resident.id,
      });
    }
    // The resident's notes to finish, on the server too: the four drafts, none of them empty.
    const toFinish = await as(story.people.resident, '/v1/me/notes-to-finish');
    expect(toFinish.status).toBe(200);
    const listed = (toFinish.body.notes as { noteId: string; encounterId: string }[]).filter(
      (n) => n.encounterId === encounterId,
    );
    expect(listed.map((n) => n.noteId).sort()).toEqual(Object.values(ids).sort());
    expect(listed).toHaveLength(expected.notesToFinish as number);
    const counts = await as(story.people.resident, '/v1/me/counts');
    expect(counts.body.notesToFinish).toBe(expected.notesToFinish);

    // What the server logged of it, each event named for the phone that sent it.
    await expectAudit(h, 'encounter.created', { after: mark, patientId: P, count: 1 });
    await expectAudit(h, 'note.created', { after: mark, patientId: P, count: 4 });
  });

  it('step 5: the phone reconnects after Complete and sign; four sign-offs, each with its event in its change’s transaction', async () => {
    // Step 4, offline again, later: the visit opened from Notes to finish, the red-flag question
    // answered, the assessment written, Complete and sign. The store sends the Red flags note's
    // sign-off first, then the visit's notes in order (lifecycle 3.3 as built).
    h.clock.advance(3 * 3600_000);
    const outbox: Change[] = [
      await offline(30, {
        entity: 'audit',
        op: 'append',
        value: { action: 'notes_to_finish.viewed', patientIds: [P], resultCount: story.notes.length },
      }),
    ];
    for (const n of story.notes) {
      for (const [path, value] of Object.entries(n.answersAtStep4)) {
        // An answer never set before: the phone's base is version 0.
        outbox.push(
          await offline(25, {
            entity: 'encounter_note',
            op: 'set',
            recordId: ids[n.ref],
            field: `data.${path}`,
            value,
          }),
        );
      }
    }
    outbox.push(
      await offline(22, {
        entity: 'encounter',
        op: 'set',
        recordId: encounterId,
        field: 'summary',
        value: story.assessment,
      }),
    );
    const planned = step(4).phone!.outbox as { note: Ref; act: 'sign' | 'complete' }[];
    signoffs = [];
    for (const { note, act } of planned) {
      const n = byRef(note);
      expect(act).toBe(n.act);
      signoffs.push(
        await offline(20, {
          entity: 'note_signoff',
          op: 'create',
          value: {
            noteId: ids[note],
            act,
            contentHash: await contentHash(n, ids[note], encounterId, story.assessment, finalAnswers(n)),
            claimedCredential: act === 'sign' ? story.people.resident.credential : null,
            statementVersion: story.statementVersions[act],
          },
        }),
      );
    }
    outbox.push(...signoffs);

    const mark5 = await auditMark(h);
    step5Receipts = await reconnect(outbox);
    await expectHashConfirmed(5, outbox, step5Receipts);
    const expected = step(5).server!;
    expect(step5Receipts.slice(-signoffs.length).map((r) => r.details?.effect)).toEqual(
      planned.map(({ note }) => byRef(note).effect),
    );

    // Four note_signoffs rows: three signed, one completed, each naming its note's hash.
    const rows = (await Promise.all(story.notes.map((n) => signoffRows(h, ids[n.ref])))).flat();
    expect(rows).toHaveLength(expected.signoffs as number);
    const effects: Record<string, number> = {};
    for (const r of rows) effects[r.effect as string] = (effects[r.effect as string] ?? 0) + 1;
    expect(effects).toEqual(expected.effects);
    for (const [i, { note }] of planned.entries()) {
      const n = byRef(note);
      const [row] = await signoffRows(h, ids[note]);
      expect(row).toMatchObject({
        id: signoffs[i]!.recordId,
        noteId: ids[note],
        act: n.act,
        effect: n.effect,
        contentHash: (signoffs[i]!.value as { contentHash: string }).contentHash,
        signerUserId: resident.id,
        signerName: story.people.resident.displayName,
        signerCredential: story.people.resident.credential,
        // signedUnder's answer for the signer, whatever the effect (lifecycle 4.6): the note's own
        // attestation is what the queues read.
        needsAttestation: true,
        statementVersion: story.statementVersions[n.act],
        changeId: signoffs[i]!.changeId,
        createdDeviceId: resident.phone.deviceId,
      });
      // The three Medical notes signed and waiting for an attending; Social needs completed.
      expect(await noteRow(h, ids[note])).toMatchObject({
        ...n[expected.notes as 'afterStep5'],
        // A note names the sign-off that signs it; a completed one names none (lifecycle 2.3).
        signoffId: n.effect === 'signed' ? signoffs[i]!.recordId : null,
        data: finalAnswers(n),
      });
    }
    expect(await visitStatus(h, encounterId)).toBe(expected.encounterStatus);
    const [visit] = await h.scratch.owner<{ summary: string }[]>`
      select summary from sineobex.encounters where id = ${encounterId}`;
    expect(visit!.summary).toBe(story.assessment);

    // One audit event per sign-off, on the note, with what it did and nothing it holds.
    const events = expected.events as Record<string, number>;
    for (const [action, count] of Object.entries(events)) {
      const logged = await expectAudit(h, action, { after: mark5, patientId: P, count });
      for (const e of logged) {
        const i = signoffs.findIndex((s) => (s.value as { noteId: string }).noteId === e.entityId);
        const n = byRef(planned[i]!.note);
        expect(n.event).toBe(action);
        expect(e).toMatchObject({
          entity: 'encounter_note',
          actorUserId: resident.id,
          deviceId: resident.phone.deviceId,
        });
        expect(e.details).toMatchObject({
          signoffId: signoffs[i]!.recordId,
          act: n.act,
          effect: n.effect,
          clockVerified: true,
          ...(n.act === 'sign'
            ? { credential: story.people.resident.credential, needsAttestation: true }
            : {}),
        });
        expect(e.details).not.toHaveProperty('claimedCredential');
      }
    }
    // Each in its change's transaction: the sign-off, its receipt and its event were written by one
    // transaction, and each sign-off by its own (lifecycle 10.1; push.ts: one change, one
    // transaction).
    expect(expected.eachEventInItsChangeTransaction).toBe(true);
    const xids: string[] = [];
    for (const [i, s] of signoffs.entries()) {
      const { note } = planned[i]!;
      const [row] = await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.note_signoffs where id = ${s.recordId}`;
      const [receipt] = await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.sync_changes where change_id = ${s.changeId}`;
      const logged = await h.scratch.owner<{ xid: string }[]>`
        select xmin::text as xid from sineobex.audit_events
        where id > ${mark5}::bigint and action = ${byRef(note).event} and entity_id = ${ids[note]}`;
      expect(logged).toHaveLength(1);
      expect([receipt!.xid, logged[0]!.xid]).toEqual([row!.xid, row!.xid]);
      xids.push(row!.xid);
    }
    expect(new Set(xids).size).toBe(signoffs.length);

    // The offline read joined the chain with the phone's time.
    const [viewed] = await expectAudit(h, 'notes_to_finish.viewed', { after: mark5, count: 1 });
    expect(viewed!.details).toMatchObject({
      offline: true,
      patientIds: [P],
      resultCount: story.notes.length,
    });
    await expectAuditClean(h, story.neverInAuditDetails, mark5);
  });

  it('step 6: the phone’s sync finishes; nothing is left to finish, and a resend changes nothing', async () => {
    const expected = step(6).server!;
    const toFinish = await as(story.people.resident, '/v1/me/notes-to-finish');
    expect(toFinish.status).toBe(200);
    const left = (toFinish.body.notes as { encounterId: string }[]).filter(
      (n) => n.encounterId === encounterId,
    );
    expect(left).toHaveLength(expected.notesToFinish as number);
    const counts = await as(story.people.resident, '/v1/me/counts');
    expect(counts.body.notesToFinish).toBe(expected.notesToFinish);

    // What the phone's refresh reads of the visit and its notes: finished, so its sweep lets them
    // go once their receipts are in (lifecycle 8.2).
    const read = await as(story.people.resident, '/v1/sync/records', {
      method: 'POST',
      json: {
        records: [
          { entity: 'encounter', id: encounterId },
          ...story.notes.map((n) => ({ entity: 'encounter_note', id: ids[n.ref] })),
        ],
      },
    });
    expect(read.status).toBe(200);
    const snapshots = read.body.records as { entity: string; id: string; status: string; attributes: Json }[];
    expect(snapshots.find((s) => s.id === encounterId)).toMatchObject({
      status: step(5).server!.encounterStatus,
      attributes: { hasFinishedNote: true },
    });
    for (const n of story.notes) {
      expect(snapshots.find((s) => s.id === ids[n.ref])!.status).toBe(n.afterStep5.status);
    }

    // A phone that lost the answers sends its outbox again: the same receipts, nothing run twice.
    const mark = await auditMark(h);
    const again = await push(h, resident.phone, await h.tokenFor(story.people.resident.email), t.teamId, [
      ...signoffs,
    ]);
    expect(results(again.body)).toEqual(step5Receipts.slice(-signoffs.length));
    expect((await Promise.all(story.notes.map((n) => signoffRows(h, ids[n.ref])))).flat()).toHaveLength(
      step(5).server!.signoffs as number,
    );
    expect((await eventsAfter(h, mark)).filter((e) => e.action.startsWith('note.'))).toEqual([]);
  });

  it('step 7: an attending opens the attestation queue and attests the visit in one action', async () => {
    const expected = step(7).server!;
    const attendingPerson = story.people.attending;
    const mark = await auditMark(h);

    // The queue lists one visit, with the three Medical notes, each theirs to attest.
    const queue = await as(attendingPerson, '/v1/team/attestation-queue');
    expect(queue.status).toBe(200);
    type Row = { encounterId: string; patientId: string; notes: { noteId: string; canAct: boolean }[] };
    const rows = (queue.body.rows as Row[]).filter((r) => r.patientId === P);
    const before = expected.queueBefore as { visits: number; notes: Ref[] };
    expect(rows).toHaveLength(before.visits);
    expect(rows[0]!.encounterId).toBe(encounterId);
    // In the visit's order: the order the phone made them in.
    expect(rows[0]!.notes.map((n) => n.noteId)).toEqual(before.notes.map((r) => ids[r]));
    expect(rows[0]!.notes.every((n) => n.canAct)).toBe(true);
    const [viewed] = await expectAudit(h, 'attestation_queue.viewed', { after: mark, count: 1 });
    expect(viewed!.details).toMatchObject({ patientIds: [P] });

    // The visit, read whole: what the attest sends is each note's hash as the read gives it, the
    // hash the resident signed.
    const read = await as(attendingPerson, `/v1/encounters/${encounterId}`);
    expect(read.status).toBe(200);
    type ReadNote = { noteId: string; canAttest?: boolean; contentHash?: string };
    const plan = (read.body.notes as ReadNote[])
      .filter((n) => n.canAttest)
      .map((n) => ({ noteId: n.noteId, contentHash: n.contentHash! }));
    const attest = expected.attest as { status: number; notes: Ref[] };
    expect(plan.map((n) => n.noteId)).toEqual(attest.notes.map((r) => ids[r]));
    for (const { noteId, contentHash: hash } of plan) {
      const n = story.notes.find((x) => ids[x.ref] === noteId)!;
      expect(hash).toBe(await contentHash(n, noteId, encounterId, story.assessment, finalAnswers(n)));
    }

    // One action attests the three.
    const signatures = Object.fromEntries(
      await Promise.all(
        story.notes.map(async (n) => [n.ref, (await noteRow(h, ids[n.ref])).signoffId] as const),
      ),
    );
    const done = await as(attendingPerson, `/v1/encounters/${encounterId}/attest`, {
      method: 'POST',
      json: { notes: plan, statementVersion: story.statementVersions.attest },
    });
    expect(done.status).toBe(attest.status);

    // Three note_attestations rows, each naming its note's signature and the hash read.
    let attestations = 0;
    for (const n of story.notes) {
      const found = await attestationRows(h, ids[n.ref]);
      attestations += found.length;
      expect(await noteRow(h, ids[n.ref])).toMatchObject(n[expected.notes as 'afterStep7']);
      if (!attest.notes.includes(n.ref)) {
        expect(found).toEqual([]);
        continue;
      }
      expect(found).toEqual([
        expect.objectContaining({
          noteId: ids[n.ref],
          signoffId: signatures[n.ref],
          contentHash: plan.find((x) => x.noteId === ids[n.ref])!.contentHash,
          attendingUserId: attending.id,
          attendingName: attendingPerson.displayName,
          statementVersion: story.statementVersions.attest,
        }),
      ]);
    }
    expect(attestations).toBe(expected.attestations);
    expect(await visitStatus(h, encounterId)).toBe(expected.encounterStatus);

    // The events: the queue's view, then one note.attested per note, on the note.
    const events = expected.events as Record<string, number>;
    for (const [action, count] of Object.entries(events)) {
      await expectAudit(h, action, { after: mark, count });
    }
    for (const e of await expectAudit(h, 'note.attested', { after: mark })) {
      expect(e).toMatchObject({ entity: 'encounter_note', patientId: P, actorUserId: attending.id });
      const ref = story.notes.find((n) => ids[n.ref] === e.entityId)!.ref;
      expect(e.details).toEqual({
        attestationId: (await attestationRows(h, ids[ref]))[0]!.id,
        signoffId: signatures[ref],
      });
    }

    // The resident has one note_attested notice for the visit, and reads it as one.
    const notices = expected.notices as { resident: Record<string, number> };
    for (const [kind, count] of Object.entries(notices.resident)) {
      expect(await noticesOf(h, resident.id, kind)).toEqual(
        Array.from({ length: count }, () => ({ entity: 'encounter', recordId: encounterId })),
      );
      const listed = await as(story.people.resident, '/v1/team/notices');
      expect(listed.status).toBe(200);
      expect(
        (listed.body as unknown as { kind: string; recordId: string }[]).filter(
          (x) => x.kind === kind && x.recordId === encounterId,
        ),
      ).toHaveLength(count);
    }

    // Then none.
    const after = await as(attendingPerson, '/v1/team/attestation-queue');
    expect((after.body.rows as Row[]).filter((r) => r.patientId === P)).toHaveLength(
      (expected.queueAfter as { visits: number }).visits,
    );
    const counts = await as(attendingPerson, '/v1/me/counts');
    expect(counts.body.attestationWaiting).toBe(0);
    await expectAuditClean(h, story.neverInAuditDetails, mark);
  });
});

describe('the Done when’s shorter test: a note with a GU exam (lifecycle 11.1, 6.4 rule 4)', () => {
  it('is refused to the attending in Healthcare Staff, and a Program Admin who reads it whole attests it', async () => {
    const gu = story.guExam;
    const people = story.people;
    const sendAsResident = async (...changes: Change[]) => {
      const r = await push(h, resident.phone, await h.tokenFor(people.resident.email), t.teamId, changes);
      expect(r.status).toBe(200);
      return results(r.body);
    };
    // The resident charts and signs it, the Red flags note first.
    const visit = await resident.phone.change({
      entity: 'encounter',
      op: 'create',
      value: { kind: 'medical', patientId: P },
    });
    const ids = {} as Record<Ref, string>;
    const creates: Change[] = [];
    for (const n of gu.notes) {
      const c = await resident.phone.change({
        entity: 'encounter_note',
        op: 'create',
        value: {
          encounterId: visit.recordId,
          noteTypeKey: n.noteTypeKey,
          noteTypeVersion: n.noteTypeVersion,
          data: n.answers,
        },
      });
      ids[n.ref] = c.recordId;
      creates.push(c);
    }
    const summary = await resident.phone.change({
      entity: 'encounter',
      op: 'set',
      recordId: visit.recordId,
      field: 'summary',
      value: gu.assessment,
    });
    const signs: Change[] = [];
    for (const n of gu.notes) {
      signs.push(
        await resident.phone.change({
          entity: 'note_signoff',
          op: 'create',
          value: {
            noteId: ids[n.ref],
            act: 'sign',
            contentHash: await contentHash(n, ids[n.ref], visit.recordId, gu.assessment, n.answers),
            claimedCredential: people.resident.credential,
            statementVersion: story.statementVersions.sign,
          },
        }),
      );
    }
    const sent = await sendAsResident(visit, ...creates, summary, ...signs);
    expect(sent.map((r) => r.status)).toEqual(Array(sent.length).fill('accepted'));
    expect(sent.slice(-signs.length).map((r) => r.details?.effect)).toEqual(['signed', 'signed']);
    for (const n of gu.notes) {
      expect(await noteRow(h, ids[n.ref])).toMatchObject({ status: 'signed', attestation: 'waiting' });
    }

    const attestAs = async (who: Person, refs: Ref[]) =>
      as(who, `/v1/encounters/${visit.recordId}/attest`, {
        method: 'POST',
        json: {
          notes: await Promise.all(
            refs.map(async (ref) => {
              const n = gu.notes.find((x) => x.ref === ref)!;
              return {
                noteId: ids[ref],
                contentHash: await contentHash(n, ids[ref], visit.recordId, gu.assessment, n.answers),
              };
            }),
          ),
          statementVersion: story.statementVersions.attest,
        },
      });

    // The attending in Healthcare Staff may not read the GU exam: the note's part they can't open is
    // named in the queue and the read, and attesting it is refused, logged, and writes nothing.
    const refused = people[gu.refusedTo];
    const queue = await as(refused, '/v1/team/attestation-queue');
    type Row = { encounterId: string; notes: { noteId: string; canAct: boolean }[] };
    const row = (queue.body.rows as Row[]).find((r) => r.encounterId === visit.recordId)!;
    expect(row.notes.find((n) => n.noteId === ids.general)!.canAct).toBe(false);
    const read = await as(refused, `/v1/encounters/${visit.recordId}`);
    const general = (read.body.notes as { noteId: string; canAttest?: boolean; heldBecause?: string }[]).find(
      (n) => n.noteId === ids.general,
    )!;
    expect(general.canAttest).toBeFalsy();
    expect(JSON.stringify(read.body)).not.toContain('dysuria');
    const mark = await auditMark(h);
    const r = await attestAs(
      refused,
      gu.notes.map((n) => n.ref),
    );
    expect(r.status).toBe(gu.refusal.status);
    expect(r.body.error?.code).toBe(gu.refusal.code);
    expect(((r.body.error?.details?.noteIds as string[]) ?? []).sort()).toEqual(
      gu.refusal.notes.map((ref) => ids[ref]).sort(),
    );
    const [denied] = await expectAudit(h, 'access.denied', { after: mark, count: 1 });
    expect(denied!.details).toMatchObject({ reason: gu.refusal.code });
    for (const n of gu.notes) {
      expect(await noteRow(h, ids[n.ref])).toMatchObject({ status: 'signed', attestation: 'waiting' });
      expect(await attestationRows(h, ids[n.ref])).toEqual([]);
    }

    // The Red flags note is the whole of what the attending may attest, and they do.
    const theirs = gu.notes.map((n) => n.ref).filter((ref) => !gu.refusal.notes.includes(ref));
    expect((await attestAs(refused, theirs)).status).toBe(200);
    for (const ref of theirs) expect(await noteRow(h, ids[ref])).toMatchObject({ attestation: 'attested' });
    expect(await noteRow(h, ids.general)).toMatchObject({ attestation: 'waiting' });

    // A Program Admin with an attending's credential reads it whole, and attests it.
    const admin = people[gu.attestedBy];
    const whole = await as(admin, `/v1/encounters/${visit.recordId}`);
    expect(whole.status).toBe(200);
    expect(
      (whole.body.notes as { noteId: string; canAttest?: boolean }[]).find((n) => n.noteId === ids.general)!
        .canAttest,
    ).toBe(true);
    const ok = await attestAs(admin, gu.refusal.notes);
    expect(ok.status, JSON.stringify(ok.body.error)).toBe(200);
    const [row2] = await attestationRows(h, ids.general);
    expect(row2).toMatchObject({
      attendingUserId: t.adminId,
      attendingName: admin.displayName,
      statementVersion: story.statementVersions.attest,
    });
    expect(await noteRow(h, ids.general)).toMatchObject({ status: 'signed', attestation: 'attested' });
    await expectAuditClean(h, story.neverInAuditDetails, mark);
  });
});
