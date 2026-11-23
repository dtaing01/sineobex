import type { ResolvedNoteType } from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definitionFor } from '../src/forms/definitions.ts';
import { correct, noteRow, visitAt } from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { createPatient } from './patient-fixtures.ts';
import { presetsTeam, REASON, tokenOf, type PresetsTeam } from './presets-fixtures.ts';
import { call, clinician, finishNote, noteOn, type Clinician } from './sync-fixtures.ts';

// A note stays on the version it began on (PRD main 387; forms 2.6; phase 5 design 5.4 rule 4, 6.4,
// 7), written ahead of the code (card P4-tests): a team's publish, and a Remove, change what new
// notes are offered, never what a note already begun is read and checked by. A draft begun on
// version 1 completes, and is later corrected, on version 1 after version 2 is published, a field
// version 2 hid among the answers; another phone opens it, through the one-version route, which
// serves every stored version; the new version is read back by definitionFor and a note made on it
// is accepted. A removed note type leaves the list the phones read (P4-offered), and its drafts
// finish. The admin routes are note-types-admin.test.ts's; until they land they answer 404, and so
// does every case here. The phone's half is apps/mobile/test/forms/note_type_version_test.dart.

let h: Harness;
let team: PresetsTeam;
let jo: Clinician;
let ari: Clinician;
let patientId: string;

beforeAll(async () => {
  h = await createHarness();
  team = await presetsTeam(h, 'Note Type Versions');
  const asAdmin = { teamId: team.teamId, adminToken: await tokenOf(h, team.admin) };
  jo = await clinician(h, asAdmin, 'versions-jo@example.com', 'Jo (demo)', 'attending');
  ari = await clinician(h, asAdmin, 'versions-ari@example.com', 'Ari (demo)', 'attending');
  patientId = (await createPatient(h, team.teamId, team.admin.userId)).id;
});
afterAll(() => h?.close());

const admin = async (method: 'GET' | 'POST' | 'PUT', path: string, json?: unknown) =>
  call(h, path, {
    method,
    token: await tokenOf(h, team.admin),
    teamId: team.teamId,
    ...(json ? { json } : {}),
  });

/** What a phone's list names, as the person on it reads it. */
async function listedTo(who: Clinician) {
  const r = await call(h, '/v1/forms/note-types', { token: who.token, teamId: team.teamId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return new Map((r.body.noteTypes as { key: string; version: number }[]).map((e) => [e.key, e.version]));
}

/** One version, as another phone downloads it to open a note on it. */
async function opened(who: Clinician, key: string, version: number): Promise<ResolvedNoteType> {
  const r = await call(h, `/v1/forms/note-types/${key}/${version}`, {
    token: who.token,
    teamId: team.teamId,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.definition as ResolvedNoteType;
}

/** The version as the server reads it back, in the team's scope (D79). */
const stored = (key: string, version: number) =>
  h.db.tx({ teamId: team.teamId, userId: team.admin.userId }, (tx) =>
    definitionFor(tx, team.teamId, key, version),
  );

/** The note type's current version, from the admin list. */
async function currentOf(key: string): Promise<number> {
  const r = await admin('GET', '/v1/admin/note-types');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as unknown as { key: string; version: number }[]).find((x) => x.key === key)!.version;
}

describe('a note stays on the version it began on', () => {
  it('a draft begun on version 1 completes, and is corrected, on version 1 after version 2 is published', async () => {
    const v1 = await currentOf('social_needs');
    const type = await opened(jo, 'social_needs', v1);
    const visit = await visitAt(jo, patientId, { kind: 'non_medical' });
    const draft = await noteOn(jo, visit, type, { 'needs.needs': ['housing'], 'needs.housing': 'shelter' });

    // Version 2 no longer asks where they stay.
    const published = await admin('PUT', '/v1/admin/note-types/social_needs', {
      baseVersion: v1,
      ops: [{ op: 'set_hidden', path: 'needs.housing', hidden: true }],
      reason: REASON,
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const v2 = published.body.version as number;
    expect(v2).toBe(v1 + 1);
    expect((await listedTo(jo)).get('social_needs')).toBe(v2);

    // The draft is checked, and its hash taken, on version 1, which still holds the answer.
    await finishNote(jo, draft, 'complete', 'completed');
    const { note } = await correct(jo, draft, h, 'needs.housing', 'transitional');
    expect((await noteRow(h, draft.noteId)).data['needs.housing']).toBe('transitional');
    expect(note.answers['needs.housing']).toBe('transitional');
    const [row] = await h.scratch.owner<{ version: number }[]>`
      select note_type_version as version from sineobex.encounter_notes where id = ${draft.noteId}`;
    expect(row!.version).toBe(v1);
  });

  it('another phone opens a note on version 1 while the list names version 2', async () => {
    const current = await currentOf('social_needs');
    expect(current).toBeGreaterThan(1);
    expect((await listedTo(ari)).get('social_needs')).toBe(current);
    const first = await opened(ari, 'social_needs', 1);
    expect([first.key, first.version]).toEqual(['social_needs', 1]);
    expect(JSON.stringify(first)).toContain('"housing"');
  });

  it('answers the published version through definitionFor, and accepts a note made on it', async () => {
    const current = await currentOf('social_needs');
    const read = await stored('social_needs', current);
    expect(read).toBeDefined();
    expect([read!.definition.key, read!.definition.version]).toEqual(['social_needs', current]);
    expect(await opened(ari, 'social_needs', current)).toEqual(read!.definition);
    const visit = await visitAt(ari, patientId, { kind: 'non_medical' });
    const note = await noteOn(ari, visit, read!.definition, { 'needs.needs': ['food'] });
    await finishNote(ari, note, 'complete', 'completed');
  });

  it('refuses, on the new version, an answer only the old one has: what was hidden is not asked again', async () => {
    const current = await currentOf('social_needs');
    const read = (await stored('social_needs', current))!.definition;
    const visit = await visitAt(ari, patientId, { kind: 'non_medical' });
    const change = await ari.phone.change({
      entity: 'encounter_note',
      op: 'create',
      value: {
        encounterId: visit.encounterId,
        noteTypeKey: 'social_needs',
        noteTypeVersion: read.version,
        data: { 'needs.housing': 'shelter' },
      },
    });
    const [answer] = await ari.send(change);
    expect(answer!.status).toBe('rejected');
  });
});

describe('a removed note type', () => {
  it('leaves the list the phones read, while every version of it still serves, and its drafts finish', async () => {
    const made = await admin('POST', '/v1/admin/note-types', {
      title: 'Demo: Winter check-in',
      kinds: ['non_medical'],
      group: 'outreach',
      reason: REASON,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const key = made.body.key as string;
    expect((await listedTo(jo)).get(key)).toBe(1);
    const type = await opened(jo, key, 1);
    const visit = await visitAt(jo, patientId, { kind: 'non_medical' });
    const draft = await noteOn(jo, visit, type, { 'notes.notes': 'Demo: asked about a blanket' });

    const archived = await admin('POST', `/v1/admin/note-types/${key}/archive`, {
      baseVersion: 1,
      reason: REASON,
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    // No new note is offered on it.
    expect((await listedTo(jo)).has(key)).toBe(false);
    expect((await listedTo(ari)).has(key)).toBe(false);
    // Every version still serves, so a draft on it opens on any phone, and finishes.
    expect(await opened(ari, key, 1)).toEqual(type);
    expect(await stored(key, 1)).toMatchObject({ key, version: 1 });
    await finishNote(jo, draft, 'complete', 'completed');

    // A note a phone made on it offline, before it heard of the Remove, is accepted (design point 6).
    const late = await visitAt(ari, patientId, { kind: 'non_medical' });
    await noteOn(ari, late, type, { 'notes.notes': 'Demo: written before the sync' });

    // Restored, it is offered again.
    const restored = await admin('POST', `/v1/admin/note-types/${key}/restore`, { reason: REASON });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect((await listedTo(jo)).get(key)).toBe(1);
  });

  it('leaves out of the list a platform note type the team removed, while the others stay', async () => {
    const before = await listedTo(jo);
    expect(before.has('psychological')).toBe(true);
    const version = await currentOf('psychological');
    const archived = await admin('POST', '/v1/admin/note-types/psychological/archive', {
      baseVersion: version,
      reason: REASON,
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const after = await listedTo(jo);
    expect(after.has('psychological')).toBe(false);
    expect([...after.keys()].sort()).toEqual([...before.keys()].filter((k) => k !== 'psychological').sort());
    expect((await opened(jo, 'psychological', version)).key).toBe('psychological');
  });
});
