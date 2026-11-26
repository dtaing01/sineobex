import { randomUUID } from 'node:crypto';
import {
  canonicalJson,
  MAX_DEFINITION_BYTES,
  PRESETS,
  protectedParts,
  sha256Hex,
  takeRevision,
  type InstallSql,
  type NoteTypeEdit,
  type Option,
  type Preset,
  type ResolvedNoteType,
} from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { definitionFor } from '../src/forms/definitions.ts';
import { visitAt } from './encounters-fixtures.ts';
import { createHarness, type Harness } from './harness.ts';
import { createPatient, logSpy } from './patient-fixtures.ts';
import {
  auditAfter,
  auditMark,
  errorOf,
  memberOf,
  presetsApi,
  presetsTeam,
  REASON,
  STALE_MINUTES,
  tokenOf,
  whileLocked,
  type Answer,
  type Person,
  type PresetsTeam,
} from './presets-fixtures.ts';
import { call, clinician, noteOn, type Clinician } from './sync-fixtures.ts';

// The admin note type routes (phase 5 design 5.4, 7, 9; BM-73, BM-75, BM-82, BM-84, PL-17),
// written ahead of them (card P4-tests) and held to the shapes below; until the cards that build
// them land (P4-list, P4-publish, P4-fanout, P4-lifecycle) each answers 404, the reason every case
// here fails. Where the design leaves a shape open, this block settles it from the preset routes'
// (presets-routes.test.ts), "as for presets"; the route cards build to it. "Admin" is
// team.manage_presets. What an edit does is packages/forms' (editNoteTypes, note-type-edit.json);
// the routes call it and never re-derive it.
//
//   GET  /v1/admin/note-types                        Admin            200 [row]
//   POST /v1/admin/note-types                        Admin, recent    201 {key, version: 1}
//        {title, kinds, group, reason}  a blank one: kinds one or both of medical and non_medical
//        {title, copyOf, reason}        a copy of the team's current version of copyOf
//   PUT  /v1/admin/note-types/{key}                  Admin, recent    200 {version, alsoPublished}
//        {baseVersion, ops, reason}     alsoPublished: the other keys the publish changed, by key
//   POST /v1/admin/note-types/{key}/archive          Admin, recent    200 {revision}
//        {baseVersion, reason}
//   POST /v1/admin/note-types/{key}/restore          Admin, recent    200 {revision}
//        {reason}
//   POST /v1/admin/note-types/{key}/take-update      Admin, recent    200 {key, version, revision}
//        {baseVersion, platformVersion, reason, asNew}  (as new: the new key, version 1)
//
// {key} matches 0017's key pattern, else 422 validation_failed; a key the team holds no head of is
// 404 not_found. A row is {key, title, state, version, customized, updateOnOffer,
// updateChangesFixed, update, referencedBy, definition, protected}, one for every head of the team,
// archived ones included, ordered by title (an English collator, base sensitivity, numeric), ties
// by key: `version` is the head's current version and `definition` that version's resolved
// definition; `protected` is protectedParts(definition) (packages/forms/src/edit-protected.ts), for
// the editor, with `whole`, typeProtected(definition): nothing in it can be changed; `referencedBy` counts the active field supply maps whose current body names the key
// ({field_supply_map: n}, {} when none); `updateOnOffer` is platform_latest above the platform
// version last taken; `update` is that platform version for review, {platformVersion, definition,
// changesFixed}, `definition` as taking it in place would write it (its `version` the head's next),
// `changesFixed` the fixed fields it changes (kinds, group, sensitivity, quick, auto), or null with
// nothing on offer, and `updateChangesFixed` is changesFixed non-empty. The list runs no installer.
//
// A blank note type's version 1 is {key, version: 1, title, kinds, group, sensitivity: 'none',
// sections: [{id: 'notes', title: 'Notes', fields: [{id: 'notes', kind: 'text', label: 'Notes',
// lines: 'many', maxLength: 4000}]}]} (section 11, row 36); a copy's is the copied definition with
// its key, version and title the new one's. A key the server makes is `t_` and 12 hex characters.
// A publish applies the ops in order through editNoteTypes, then checks each version it would
// store with phase 4's validate (another key looked up at the version the publish gives it, else
// the team's newest), versionProblems against every earlier version and MAX_DEFINITION_BYTES; it
// stores no renames.
//
// A write's reason is `reason`, as for presets (3 to 300 characters, trimmed, else 422
// validation_failed naming it), kept in team_preset_events with note_type_key and never in audit
// details. A stale sign-in is 403 reauth_required, written nowhere. Refusals, each {error: {code,
// message, details?}}, and nothing written with any of them:
//   422 <the operation's code>  details.opIndex, and details.noteTypeKey where a field another
//                               note type holds refused it (note-type-edit.json's codes)
//   422 invalid       details.problems: what validate or versionProblems found in a version the
//                     publish would store; a copy_section the validator refuses names its opIndex
//   422 not_copyable  a copy of a quick or an auto note type
//   409 stale         details.currentVersion; for take-update also details.platformVersion, the
//                     version on offer now or null
//   409 archived, not_archived, name_taken (another active note type of the team holds the title,
//       as lower() folds it), referenced (details.referencedBy), not_removable (the auto note
//       type), no_update, fixed_field (take-update in place, details.fields)
//   404 not_found     copyOf names no note type the team holds
// What each write stores: one revision for the write, on every head it changes, each the team's
// next; a version a person makes is origin 'team', preset_version null; a platform version taken
// is origin 'preset' and preset_version the platform's number; every stored definition names its
// row's key and version, and hashes to its hash (definitionFor reads it back). Each changed head:
// title the new version's, current_version it, updated_by the admin; a publish, an archive and a
// restore make it customized, an update taken in place makes it not. Events, each with the reason
// and the admin: created (1), updated (each published version, one for each note type), archived
// and restored (the version stood on), update_taken (the version made; as new the new key's 1, and
// archived for the old key at its version when it was active). Audit events, entity note_type and
// the key: note_type.created, .published (one for each note type published), .archived, .restored,
// .platform_update_taken (as new on the new key, with `replaces`), details {version, operations,
// count}: for a publish the distinct operation names applied to that note type, in the order
// first sent, and how many; never a reason, a title, a label or an option's words.

// This file's presets are its own copy, so the platform versions below can be released into it.
vi.mock('../../../packages/forms/generated/presets.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});

type Json = Record<string, unknown>;
interface NoteTypeRow {
  key: string;
  title: string;
  state: 'active' | 'archived';
  version: number;
  customized: boolean;
  updateOnOffer: boolean;
  updateChangesFixed: boolean;
  update: { platformVersion: number; definition: ResolvedNoteType; changesFixed: string[] } | null;
  referencedBy: Record<string, number>;
  definition: ResolvedNoteType;
  protected: {
    whole: boolean;
    sections: string[];
    fields: string[];
    options: { path: string; code: string }[];
  };
  hidden: {
    kind: 'section' | 'field' | 'option';
    path: string;
    code?: string;
    words: string;
    showAgain: boolean;
    part?: Record<string, unknown>;
  }[];
  copySections: { id: string; title: string; made: string[] }[];
}

const spy = logSpy();
let h: Harness;
let team: PresetsTeam;
let other: PresetsTeam;
let api: ReturnType<typeof noteTypesApi>;
let phone: Clinician;
let patientId: string;

/** The note type routes in a team, called as `who` with a token minted for each call, or `token`. */
function noteTypesApi(teamId: string, who: Person, options: { token?: string } = {}) {
  const send = async (method: 'GET' | 'POST' | 'PUT', path: string, json?: unknown): Promise<Answer> =>
    call(h, path, {
      method,
      token: options.token ?? (await tokenOf(h, who)),
      teamId,
      ...(json === undefined ? {} : { json }),
    });
  const at = (key?: string, act?: string) =>
    `/v1/admin/note-types${key === undefined ? '' : `/${key}`}${act === undefined ? '' : `/${act}`}`;
  return {
    send,
    list: () => send('GET', at()),
    create: (body: Json) => send('POST', at(), { reason: REASON, ...body }),
    publish: (key: string, baseVersion: number, ops: NoteTypeEdit[], reason: unknown = REASON) =>
      send('PUT', at(key), { baseVersion, ops, reason }),
    archive: (key: string, baseVersion: number, reason: unknown = REASON) =>
      send('POST', at(key, 'archive'), { baseVersion, reason }),
    restore: (key: string, reason: unknown = REASON) => send('POST', at(key, 'restore'), { reason }),
    takeUpdate: (
      key: string,
      take: { baseVersion: number; platformVersion: number; asNew: boolean },
      reason: unknown = REASON,
    ) => send('POST', at(key, 'take-update'), { ...take, reason }),
  };
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  team = await presetsTeam(h, 'Note Types');
  other = await presetsTeam(h, 'Note Types Other');
  api = noteTypesApi(team.teamId, team.admin);
  phone = await clinician(
    h,
    { teamId: team.teamId, adminToken: await tokenOf(h, team.admin) },
    'note-types-phone@example.com',
    'Note Types Phone (demo)',
    'attending',
  );
  patientId = (await createPatient(h, team.teamId, team.admin.userId)).id;
});
afterAll(async () => {
  // No reason, title, label or option's words reaches a log line (design 9).
  spy.expectClean(['Demo: the team asked', 'Demo: Night outreach', 'Demo: Evening', 'Demo: One more']);
  await h?.close();
});

// ------------------------------------------------------------------------------------------------
// What the database holds
// ------------------------------------------------------------------------------------------------

interface Head {
  key: string;
  title: string;
  state: string;
  currentVersion: number;
  platformLatest: number | null;
  customized: boolean;
  revision: number;
  updatedBy: string | null;
}
const headOf = async (teamId: string, key: string): Promise<Head | undefined> =>
  (
    await h.scratch.owner<Head[]>`
      select key, title, state, current_version as "currentVersion", platform_latest as "platformLatest",
             customized, revision::int as revision, updated_by as "updatedBy"
      from sineobex.note_types where team_id = ${teamId} and key = ${key}`
  )[0];
/** The platform note type a head names as its origin (0025): its own key's, a taken one's, or none. */
const originOf = async (teamId: string, key: string) =>
  (
    await h.scratch.owner<{ originKey: string | null }[]>`
      select origin_key as "originKey" from sineobex.note_types where team_id = ${teamId} and key = ${key}`
  )[0]?.originKey;
const versionsOf = (teamId: string, key: string) =>
  h.scratch.owner<
    {
      version: number;
      origin: string;
      presetVersion: number | null;
      hash: string;
      definition: ResolvedNoteType;
    }[]
  >`
    select version, origin, preset_version as "presetVersion", hash, definition
    from sineobex.note_type_versions where team_id = ${teamId} and key = ${key} order by version`;
const eventsOf = (teamId: string, key: string) =>
  h.scratch.owner<{ act: string; version: number; reason: string | null; createdBy: string | null }[]>`
    select act, version, reason, created_by as "createdBy" from sineobex.team_preset_events
    where team_id = ${teamId} and note_type_key = ${key} order by created_at, version, act`;
const revisionOf = async (teamId: string) => {
  const [row] = await h.scratch.owner<{ revision: number }[]>`
    select revision::int as revision from sineobex.team_preset_state where team_id = ${teamId}`;
  return row?.revision ?? 0;
};

/** Everything a note type write could leave behind in the team: what a refusal must leave as it was. */
async function footprint(teamId: string) {
  const heads = await h.scratch.owner`
    select key, title, state, current_version, platform_latest, customized, revision, updated_at
    from sineobex.note_types where team_id = ${teamId} order by key collate "C"`;
  const [counts] = await h.scratch.owner<{ versions: number; events: number; audit: number }[]>`
    select (select count(*)::int from sineobex.note_type_versions where team_id = ${teamId}) as versions,
           (select count(*)::int from sineobex.team_preset_events where team_id = ${teamId}) as events,
           (select count(*)::int from sineobex.audit_events where team_id = ${teamId}) as audit`;
  return { heads, ...counts!, revision: await revisionOf(teamId) };
}

/** The refusal's status and code; answers its details. */
function refused(r: Answer, status: number, code: string) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(errorOf(r).code, JSON.stringify(r.body)).toBe(code);
  return errorOf(r).details ?? {};
}
/** Runs `act`, which must be refused so, and checks it wrote nothing in the team. */
async function refusedUnwritten(
  act: () => Promise<Answer>,
  status: number,
  code: string,
  teamId = team.teamId,
) {
  const before = await footprint(teamId);
  const details = refused(await act(), status, code);
  expect(await footprint(teamId)).toEqual(before);
  return details;
}

/** The list's row of `key`; a test that names one the team lacks is wrong. */
async function rowOf(key: string, a = api): Promise<NoteTypeRow> {
  const r = await a.list();
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const row = (r.body as unknown as NoteTypeRow[]).find((x) => x.key === key);
  if (!row) throw new Error(`the list has no row for ${key}`);
  return row;
}

/**
 * A stored version read back as the server reads it (D79, review finding NOT-8): definitionFor, in
 * the team's scope, which refuses a row whose hash is not its definition's or whose definition names
 * another key or version.
 */
async function storedAs(key: string, version: number, teamId = team.teamId) {
  const stored = await h.db.tx({ teamId, userId: team.admin.userId }, (tx) =>
    definitionFor(tx, teamId, key, version),
  );
  expect(stored, `${key} v${version}`).toBeDefined();
  expect([stored!.definition.key, stored!.definition.version]).toEqual([key, version]);
  return stored!;
}

/** A note made on that version through sync, as a phone makes one: accepted. */
async function noteAccepted(key: string, version: number) {
  const { definition } = await storedAs(key, version);
  const visit = await visitAt(phone, patientId, {
    kind: definition.kinds.includes('non_medical') ? 'non_medical' : 'medical',
  });
  return noteOn(phone, visit, definition, {});
}

/** Every path any write took: the row read back, and a note made on it accepted. */
async function readBack(key: string, version: number) {
  await storedAs(key, version);
  await noteAccepted(key, version);
}

/** The released definition of a key at its newest version. */
const releasedOf = (key: string) =>
  [...PRESETS].filter((p) => p.key === key).sort((a, b) => b.version - a.version)[0]!.definition;

/** Puts these platform versions among the presets the API installs, until the answer is called. */
function release(...presets: Preset[]): () => void {
  const all = PRESETS as Preset[];
  all.push(...presets);
  return () => {
    for (const p of presets) all.splice(all.indexOf(p), 1);
  };
}
/** The platform's next version of a key, changed by `change`. */
async function platformNext(key: string, change: (d: ResolvedNoteType) => ResolvedNoteType): Promise<Preset> {
  const newest = releasedOf(key);
  const definition = change({ ...structuredClone(newest), version: newest.version + 1 });
  return { key, version: definition.version, hash: await sha256Hex(canonicalJson(definition)), definition };
}
/** The installer, as a phone's list of note types runs it. */
async function phoneLists(teamId = team.teamId) {
  const r = await call(h, '/v1/forms/note-types', {
    token: await h.tokenFor('note-types-phone@example.com'),
    teamId,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.noteTypes as { key: string; version: number }[];
}

const fieldOf = (definition: ResolvedNoteType, path: string) => {
  const [first, ...rest] = path.split('.');
  let fields = definition.sections.find((s) => s.id === first)!.fields as {
    id: string;
    fields?: unknown[];
  }[];
  let found: Record<string, unknown> | undefined;
  for (const id of rest) {
    found = fields.find((f) => f.id === id) as Record<string, unknown>;
    fields = (found?.fields ?? []) as typeof fields;
  }
  return found as { label: string; options?: { code: string; label: string }[] };
};

// ------------------------------------------------------------------------------------------------
// The list
// ------------------------------------------------------------------------------------------------

describe('GET /v1/admin/note-types', () => {
  it('lists every note type of the team, archived ones too, with its current definition and what is protected', async () => {
    const r = await api.list();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = r.body as unknown as NoteTypeRow[];
    const heads = await h.scratch.owner<{ key: string; currentVersion: number; state: string }[]>`
      select key, current_version as "currentVersion", state from sineobex.note_types where team_id = ${team.teamId}`;
    expect(rows.map((x) => x.key).sort()).toEqual(heads.map((x) => x.key).sort());
    const byTitle = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    expect(rows.map((x) => x.key)).toEqual(
      [...rows]
        .sort((a, b) => byTitle.compare(a.title, b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((x) => x.key),
    );
    for (const row of rows) {
      const head = heads.find((x) => x.key === row.key)!;
      expect(row.version, row.key).toBe(head.currentVersion);
      expect(row.state, row.key).toBe(head.state);
      expect(row.definition, row.key).toEqual((await storedAs(row.key, row.version)).definition);
      expect(row.protected, row.key).toEqual({
        whole: row.key === 'red_flags_disposition',
        ...protectedParts(row.definition),
      });
      expect(row.update, row.key).toBeNull();
      expect([row.updateOnOffer, row.updateChangesFixed], row.key).toEqual([false, false]);
      // What a copy from it reads: the platform's newest released version of a platform note type,
      // else its current version (copy_section, design 5.4). The platform makes no `t_` id (rule 3).
      const platform = [...PRESETS].filter((p) => p.key === row.key).sort((a, b) => b.version - a.version)[0];
      expect(row.copySections, row.key).toEqual(
        (platform?.definition ?? row.definition).sections.map((x) => ({
          id: x.id,
          title: x.title,
          made: platform ? [] : expect.any(Array),
        })),
      );
    }
    // The auto note type is protected whole; Red flags, disposition and follow-up (PRD main 409), said
    // once as `whole`, so the page offers it no edit the API would refuse.
    const red = rows.find((x) => x.key === 'red_flags_disposition')!;
    expect(red.protected.whole).toBe(true);
    expect(red.protected.sections).toEqual(red.definition.sections.map((s) => s.id));
  });

  it('lists what an earlier version had and the current one lacks, in the words of the newest version that had it, with Show again for what can be copied back', async () => {
    const t = await presetsTeam(h, 'Note Types Hidden');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const key = (await theirs.create({ title: 'Demo: Hidden round', copyOf: 'outreach' })).body.key as string;
    expect((await rowOf(key, theirs)).hidden).toEqual([]);
    const first = await theirs.publish(key, 1, [
      { op: 'rename_label', path: 'outreach.notes', label: 'Demo: What happened' },
      { op: 'retire_option', path: 'outreach.support', code: 'hygiene' },
    ]);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await theirs.publish(key, 2, [{ op: 'set_hidden', path: 'outreach.notes', hidden: true }]);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const v2 = (await storedAs(key, 2, t.teamId)).definition;
    const row = await rowOf(key, theirs);
    expect(row.hidden).toEqual([
      {
        kind: 'field',
        path: 'outreach.notes',
        words: 'Demo: What happened',
        showAgain: true,
        part: v2.sections[0]!.fields.find((f) => f.id === 'notes'),
      },
      { kind: 'option', path: 'outreach.support', code: 'hygiene', words: 'Hygiene', showAgain: false },
    ]);
    // Shown again, it is no longer listed; the retired answer still is.
    const shown = await theirs.publish(key, 3, [{ op: 'set_hidden', path: 'outreach.notes', hidden: false }]);
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    expect((await rowOf(key, theirs)).hidden.map((p) => [p.kind, p.path, p.code])).toEqual([
      ['option', 'outreach.support', 'hygiene'],
    ]);
  });

  it('lists the sections a copy reads: the platform’s for a platform note type the team edited, and the team’s own of its own', async () => {
    const t = await presetsTeam(h, 'Note Types Copy Sections');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const gpc = await rowOf('general_primary_care', theirs);
    const hidden = gpc.definition.sections.find((x) => x.id === 'eyes')!;
    const edit = await theirs.publish('general_primary_care', gpc.version, [
      { op: 'set_hidden', path: hidden.id, hidden: true },
    ]);
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const after = await rowOf('general_primary_care', theirs);
    expect(after.definition.sections.map((x) => x.id)).not.toContain(hidden.id);
    expect(after.copySections).toContainEqual({ id: hidden.id, title: hidden.title, made: [] });
    // A copy of it is the team's own: a copy from it reads its current version.
    const key = (await theirs.create({ title: 'Demo: Our clinic', copyOf: 'general_primary_care' })).body
      .key as string;
    const copy = await rowOf(key, theirs);
    expect(copy.copySections).toEqual(
      copy.definition.sections.map((x) => ({ id: x.id, title: x.title, made: [] })),
    );
    expect(copy.copySections.map((x) => x.id)).not.toContain(hidden.id);
  });

  it('lists with each section a copy reads the ids and codes the team made in it, which a note type copied into may not hold (item 10)', async () => {
    const t = await presetsTeam(h, 'Note Types Copy Made');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const key = (await theirs.create({ title: 'Demo: Kit round', copyOf: 'outreach' })).body.key as string;
    const made = await theirs.publish(key, 1, [
      {
        op: 'add_section',
        title: 'Demo: Kit check',
        afterSectionId: null,
        fields: [
          { kind: 'choice', label: 'Demo: Kit given', many: true, options: ['Demo: Socks', 'Demo: Gloves'] },
          { kind: 'text', label: 'Demo: What else', lines: 'one', maxLength: 100 },
        ],
      },
      { op: 'add_option', path: 'outreach.support', label: 'Demo: Blanket' },
    ]);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const v2 = (await storedAs(key, 2, t.teamId)).definition;
    const kit = v2.sections[0]!;
    const [given, other] = kit.fields as unknown as [
      { id: string; options: { code: string }[] },
      { id: string },
    ];
    const blanket = (
      v2.sections[1]!.fields.find((f) => f.id === 'support') as { options: { code: string }[] }
    ).options.at(-1)!.code;
    const row = await rowOf(key, theirs);
    // Every id and code the team made in each section, in the order the section writes them: in the
    // section it added, and the answer it added to the one it copied from the platform's.
    expect(row.copySections).toEqual([
      {
        id: kit.id,
        title: 'Demo: Kit check',
        made: [kit.id, given.id, ...given.options.map((o) => o.code), other.id],
      },
      ...v2.sections
        .slice(1)
        .map((x) => ({ id: x.id, title: x.title, made: x.id === 'outreach' ? [blanket] : [] })),
    ]);
    expect([kit.id, given.id, blanket].every((id) => /^t_[0-9]+$/.test(id))).toBe(true);
  });

  it('counts the active field supply maps that name each note type', async () => {
    const maps = await h.scratch.owner<{ key: string; n: number }[]>`
      select v.body ->> 'noteTypeKey' as key, count(*)::int as n from sineobex.team_presets p
      join sineobex.team_preset_versions v
        on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
      where p.team_id = ${team.teamId} and p.kind = 'field_supply_map' and p.state = 'active'
      group by 1`;
    const r = await api.list();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = r.body as unknown as NoteTypeRow[];
    for (const row of rows) {
      const n = maps.find((m) => m.key === row.key)?.n;
      expect(row.referencedBy, row.key).toEqual(n === undefined ? {} : { field_supply_map: n });
    }
    expect(rows.find((x) => x.key === 'wound_care')!.referencedBy.field_supply_map).toBeGreaterThan(0);
  });

  it('runs no installer, and is not audited', async () => {
    const unrelease = release(
      await platformNext('social_needs', (d) => ({ ...d, title: 'Social needs, again' })),
    );
    try {
      const before = await footprint(team.teamId);
      expect((await api.list()).status).toBe(200);
      expect(await footprint(team.teamId)).toEqual(before);
    } finally {
      unrelease();
    }
  });

  it('is refused to a member without team.manage_presets, and logged', async () => {
    const staff = noteTypesApi(team.teamId, team.staff);
    const mark = await auditMark(h);
    refused(await staff.list(), 403, 'forbidden');
    expect((await auditAfter(h, mark)).map((e) => [e.action, e.details.permission])).toEqual([
      ['access.denied', 'team.manage_presets'],
    ]);
  });

  it('shows a team only its own note types', async () => {
    const theirs = await noteTypesApi(other.teamId, other.admin).create({
      title: 'Demo: Only theirs',
      kinds: ['non_medical'],
      group: 'social',
    });
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
    const r = await api.list();
    expect(r.status).toBe(200);
    expect((r.body as unknown as NoteTypeRow[]).map((x) => x.key)).not.toContain(theirs.body.key);
  });
});

// ------------------------------------------------------------------------------------------------
// Adding a note type
// ------------------------------------------------------------------------------------------------

describe('POST /v1/admin/note-types', () => {
  it('adds a blank note type: one section, Notes, holding one text field, Notes (section 11, row 36)', async () => {
    const r0 = await revisionOf(team.teamId);
    const mark = await auditMark(h);
    const r = await api.create({ title: 'Demo: Night outreach', kinds: ['non_medical'], group: 'outreach' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toEqual({ key: expect.stringMatching(/^t_[0-9a-f]{12}$/), version: 1 });
    const key = r.body.key as string;
    const [row] = await versionsOf(team.teamId, key);
    expect(row).toMatchObject({ version: 1, origin: 'team', presetVersion: null });
    expect(row!.definition).toEqual({
      key,
      version: 1,
      title: 'Demo: Night outreach',
      kinds: ['non_medical'],
      group: 'outreach',
      sensitivity: 'none',
      sections: [
        {
          id: 'notes',
          title: 'Notes',
          fields: [{ id: 'notes', kind: 'text', label: 'Notes', lines: 'many', maxLength: 4000 }],
        },
      ],
    });
    expect(await headOf(team.teamId, key)).toMatchObject({
      title: 'Demo: Night outreach',
      state: 'active',
      currentVersion: 1,
      platformLatest: null,
      revision: r0 + 1,
      updatedBy: team.admin.userId,
    });
    expect(await revisionOf(team.teamId)).toBe(r0 + 1);
    expect(await eventsOf(team.teamId, key)).toEqual([
      { act: 'created', version: 1, reason: REASON, createdBy: team.admin.userId },
    ]);
    const audits = await auditAfter(h, mark);
    expect(audits.map((e) => [e.action, e.entity, e.entityId, e.actorUserId])).toEqual([
      ['note_type.created', 'note_type', key, team.admin.userId],
    ]);
    expect(audits[0]!.details).toMatchObject({ version: 1 });
    expect(JSON.stringify(audits[0]!.details)).not.toMatch(/Demo|Night|Notes/);
    await readBack(key, 1);
    // A blank Medical one, for both kinds of visit, is made the same way.
    const both = await api.create({
      title: 'Demo: Both kinds',
      kinds: ['medical', 'non_medical'],
      group: 'clinical',
    });
    expect(both.status, JSON.stringify(both.body)).toBe(201);
    const stored = await storedAs(both.body.key as string, 1);
    expect([stored.definition.kinds, stored.definition.group]).toEqual([
      ['medical', 'non_medical'],
      'clinical',
    ]);
    await noteAccepted(both.body.key as string, 1);
  });

  it('adds a copy of one of the team’s note types: its kinds, group, sensitivity and marks come with it', async () => {
    const r = await api.create({ title: 'Demo: Outreach for the night shift', copyOf: 'outreach' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const key = r.body.key as string;
    expect(key).toMatch(/^t_[0-9a-f]{12}$/);
    const source = (await rowOf('outreach')).definition;
    const [row] = await versionsOf(team.teamId, key);
    expect(row!.definition).toEqual({
      ...source,
      key,
      version: 1,
      title: 'Demo: Outreach for the night shift',
    });
    expect(row!.origin).toBe('team');
    await readBack(key, 1);
    // A sensitive one stays sensitive (rule 2): its readers are its source's.
    const sensitive = await api.create({ title: 'Demo: Harm reduction, ours', copyOf: 'harm_reduction' });
    expect(sensitive.status, JSON.stringify(sensitive.body)).toBe(201);
    expect((await storedAs(sensitive.body.key as string, 1)).definition.sensitivity).toBe('sensitive');
  });

  it('refuses a copy of the quick encounter or of the auto note type, writing nothing', async () => {
    for (const copyOf of ['quick_encounter', 'red_flags_disposition'])
      await refusedUnwritten(
        () => api.create({ title: `Demo: Copy of ${copyOf}`, copyOf }),
        422,
        'not_copyable',
      );
  });

  it('refuses a copy of a note type the team does not hold, another team’s own among them', async () => {
    const theirs = await noteTypesApi(other.teamId, other.admin).create({
      title: 'Demo: Theirs',
      kinds: ['non_medical'],
      group: 'social',
    });
    expect(theirs.status).toBe(201);
    for (const copyOf of ['demo_nowhere', theirs.body.key as string])
      await refusedUnwritten(
        () => api.create({ title: 'Demo: Copied from nowhere', copyOf }),
        404,
        'not_found',
      );
  });

  it('refuses a title another active note type of the team holds, whatever its case', async () => {
    await refusedUnwritten(
      () => api.create({ title: 'social NEEDS', kinds: ['non_medical'], group: 'social' }),
      409,
      'name_taken',
    );
  });

  it('refuses kinds that are not one or both of medical and non_medical, and a timeline group it does not know', async () => {
    for (const body of [
      { title: 'Demo: No kinds', kinds: [], group: 'outreach' },
      { title: 'Demo: Odd kinds', kinds: ['urgent'], group: 'outreach' },
      { title: 'Demo: Odd group', kinds: ['medical'], group: 'dental' },
      { title: '', kinds: ['medical'], group: 'clinical' },
      { title: 'Demo: Both ways', kinds: ['medical'], group: 'clinical', copyOf: 'outreach' },
    ])
      await refusedUnwritten(() => api.create(body), 422, 'validation_failed');
  });
});

// ------------------------------------------------------------------------------------------------
// Publishing an edit
// ------------------------------------------------------------------------------------------------

describe('PUT /v1/admin/note-types/{key}', () => {
  it('publishes the operations as the next version, the team’s, read back as it was written', async () => {
    const before = await rowOf('social_needs');
    const r0 = await revisionOf(team.teamId);
    const mark = await auditMark(h);
    const ops: NoteTypeEdit[] = [
      { op: 'rename_type', title: 'Demo: Evening social needs' },
      {
        op: 'add_field',
        sectionId: 'needs',
        kind: 'text',
        label: 'Demo: Anything else',
        lines: 'one',
        maxLength: 200,
      },
      { op: 'rename_label', path: 'needs.housing', label: 'Demo: Where they sleep' },
    ];
    const r = await api.publish('social_needs', before.version, ops);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ version: before.version + 1, alsoPublished: [] });
    const version = before.version + 1;
    const row = (await versionsOf(team.teamId, 'social_needs')).find((v) => v.version === version)!;
    expect(row).toMatchObject({ origin: 'team', presetVersion: null });
    expect(row.definition.title).toBe('Demo: Evening social needs');
    expect(fieldOf(row.definition, 'needs.housing').label).toBe('Demo: Where they sleep');
    expect(row.definition.sections[0]!.fields.at(-1)).toEqual({
      id: 't_1',
      kind: 'text',
      label: 'Demo: Anything else',
      lines: 'one',
      maxLength: 200,
    });
    // The renames are checked, never stored: the resolved definition leaves them out of its hash.
    expect(Object.keys(row.definition)).not.toContain('renames');
    expect(await headOf(team.teamId, 'social_needs')).toMatchObject({
      title: 'Demo: Evening social needs',
      currentVersion: version,
      customized: true,
      revision: r0 + 1,
      updatedBy: team.admin.userId,
    });
    expect((await eventsOf(team.teamId, 'social_needs')).at(-1)).toEqual({
      act: 'updated',
      version,
      reason: REASON,
      createdBy: team.admin.userId,
    });
    const audits = await auditAfter(h, mark);
    expect(audits.map((e) => [e.action, e.entity, e.entityId])).toEqual([
      ['note_type.published', 'note_type', 'social_needs'],
    ]);
    expect(audits[0]!.details).toEqual({
      version,
      operations: ['rename_type', 'add_field', 'rename_label'],
      count: 3,
    });
    expect(JSON.stringify(audits[0]!.details)).not.toMatch(/Demo|sleep|Anything/);
    await readBack('social_needs', version);
    // The version before still serves: a note begun on it is read on it (rule 4).
    await readBack('social_needs', before.version);
    expect((await rowOf('social_needs')).version).toBe(version);
  });

  it('carries an option operation along mapsTo: the quick encounter and wound care, one revision, an event and an audit each', async () => {
    const quick = await rowOf('quick_encounter');
    const wound = await rowOf('wound_care');
    const r0 = await revisionOf(team.teamId);
    const mark = await auditMark(h);
    const r = await api.publish('quick_encounter', quick.version, [
      { op: 'add_option', path: 'wound.dressing', label: 'Demo: One more dressing' },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ version: quick.version + 1, alsoPublished: ['wound_care'] });
    const quickNow = (await storedAs('quick_encounter', quick.version + 1)).definition;
    const woundNow = (await storedAs('wound_care', wound.version + 1)).definition;
    const added = [fieldOf(quickNow, 'wound.dressing'), fieldOf(woundNow, 'wound.treatment.dressing')].map(
      (f) => f.options!.at(-1),
    );
    expect(added[0]).toEqual({ code: expect.stringMatching(/^t_\d+$/), label: 'Demo: One more dressing' });
    expect(added[1]).toEqual(added[0]);
    expect(await revisionOf(team.teamId)).toBe(r0 + 1);
    for (const key of ['quick_encounter', 'wound_care']) {
      expect((await headOf(team.teamId, key))!.revision, key).toBe(r0 + 1);
      expect((await eventsOf(team.teamId, key)).at(-1), key).toMatchObject({
        act: 'updated',
        reason: REASON,
      });
    }
    const audits = await auditAfter(h, mark);
    expect(audits.map((e) => [e.action, e.entityId, e.details.version])).toEqual([
      ['note_type.published', 'quick_encounter', quick.version + 1],
      ['note_type.published', 'wound_care', wound.version + 1],
    ]);
    await readBack('quick_encounter', quick.version + 1);
    await readBack('wound_care', wound.version + 1);
  });

  it('refuses an option operation on a protected option, with its index alone, and writes nothing', async () => {
    // No released quick field that maps is protected, so a refusal naming another note type is
    // note-type-edit.json's alone; here, an exclusive option of the note type itself.
    const row = await rowOf('outreach');
    const details = await refusedUnwritten(
      () =>
        api.publish('outreach', row.version, [
          { op: 'rename_option', path: 'outreach.new_need', code: 'no', label: 'Demo: None' },
        ]),
      422,
      'protected',
    );
    expect(details).toEqual({ opIndex: 0 });
  });

  it('refuses each operation the vectors refuse, at its index, with its code', async () => {
    const row = await rowOf('outreach');
    for (const [ops, code, opIndex] of [
      [[{ op: 'set_hidden', path: 'outreach.red_flags', hidden: true }], 'protected', 0],
      [[{ op: 'set_hidden', path: 'outreach.new_need', hidden: true }], 'in_use', 0],
      [
        [
          { op: 'rename_type', title: 'Demo: ok' },
          { op: 'rename_label', path: 'outreach.nowhere', label: 'Demo: x' },
        ],
        'not_found',
        1,
      ],
      [[{ op: 'rename_type', title: 'x'.repeat(81) }], 'title_invalid', 0],
      [
        [{ op: 'copy_section', fromKey: 'wound_care', sectionId: 'wound', afterSectionId: null }],
        'not_copyable',
        0,
      ],
    ] as [NoteTypeEdit[], string, number][]) {
      const details = await refusedUnwritten(() => api.publish('outreach', row.version, ops), 422, code);
      expect(details.opIndex, code).toBe(opIndex);
    }
  });

  it('refuses, by its index, a retire of an answer a condition asks for and a number field no answer fits, writing nothing', async () => {
    // Each would leave a version phase 4's validator refuses as a whole; the operation refuses it
    // first, so the editor can name the change (review B-14).
    const row = await rowOf('outreach');
    expect(
      await refusedUnwritten(
        () =>
          api.publish('outreach', row.version, [
            { op: 'rename_type', title: 'Demo: Outreach, retired' },
            { op: 'retire_option', path: 'outreach.new_need', code: 'emergency' },
          ]),
        422,
        'in_use',
      ),
    ).toEqual({ opIndex: 1 });
    const section = row.definition.sections[0]!.id;
    const details = await refusedUnwritten(
      () =>
        api.publish('outreach', row.version, [
          {
            op: 'add_field',
            sectionId: section,
            kind: 'number',
            label: 'Demo: Count',
            min: 10,
            max: 5,
            decimals: 0,
          },
          { op: 'rename_type', title: 'Demo: Outreach, counted' },
        ]),
      422,
      'invalid',
    );
    expect(details.opIndex).toBe(0);
    expect((details.problems as { path: string }[]).map((p) => p.path)).toEqual([
      expect.stringMatching(/\.max$/),
    ]);
  });

  it('refuses a publish from a version that is not the current one, with the current one, writing nothing', async () => {
    const row = await rowOf('outreach');
    expect(
      (await api.publish('outreach', row.version, [{ op: 'rename_type', title: 'Demo: Outreach, first' }]))
        .status,
    ).toBe(200);
    const details = await refusedUnwritten(
      () => api.publish('outreach', row.version, [{ op: 'rename_type', title: 'Demo: Outreach, second' }]),
      409,
      'stale',
    );
    expect(details).toEqual({ currentVersion: row.version + 1 });
  });

  it('refuses a rename into a title another active note type holds, whatever its case, writing nothing; a removed one’s is free', async () => {
    const t = await presetsTeam(h, 'Note Types Rename Taken');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf('outreach', theirs);
    const social = await rowOf('social_needs', theirs);
    await refusedUnwritten(
      () =>
        theirs.publish('outreach', row.version, [
          { op: 'rename_type', title: 'Demo: Outreach, for a moment' },
          { op: 'rename_type', title: social.title.toUpperCase() },
        ]),
      409,
      'name_taken',
      t.teamId,
    );
    // Its own title, in another case, is its own.
    const own = await theirs.publish('outreach', row.version, [
      { op: 'rename_type', title: row.title.toUpperCase() },
    ]);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    // A removed note type's title is free, as for an add.
    expect((await theirs.archive('social_needs', social.version)).status).toBe(200);
    const freed = await theirs.publish('outreach', row.version + 1, [
      { op: 'rename_type', title: social.title },
    ]);
    expect(freed.status, JSON.stringify(freed.body)).toBe(200);
    expect(await headOf(t.teamId, 'outreach')).toMatchObject({ title: social.title });
  });

  it('refuses a publish of a removed note type, and of one the team does not hold', async () => {
    const made = await api.create({ title: 'Demo: Soon removed', kinds: ['non_medical'], group: 'outreach' });
    const key = made.body.key as string;
    expect((await api.archive(key, 1)).status).toBe(200);
    await refusedUnwritten(
      () => api.publish(key, 1, [{ op: 'rename_type', title: 'Demo: Back' }]),
      409,
      'archived',
    );
    await refusedUnwritten(
      () => api.publish('t_000000000000', 1, [{ op: 'rename_type', title: 'Demo: x' }]),
      404,
      'not_found',
    );
    await refusedUnwritten(
      () => api.publish('Not-A-Key', 1, [{ op: 'rename_type', title: 'Demo: x' }]),
      422,
      'validation_failed',
    );
  });

  it('refuses ops that are not a list of the operations, and a malformed base version, before anything is asked', async () => {
    const row = await rowOf('outreach');
    for (const json of [
      { baseVersion: row.version, ops: 'rename', reason: REASON },
      { baseVersion: row.version, ops: [{ op: 'rewrite', definition: {} }], reason: REASON },
      { baseVersion: '1', ops: [], reason: REASON },
      { baseVersion: row.version, reason: REASON },
    ])
      await refusedUnwritten(
        () => api.send('PUT', '/v1/admin/note-types/outreach', json),
        422,
        'validation_failed',
      );
  });
});

// ------------------------------------------------------------------------------------------------
// What a publish checks before it stores a version (card P4-publish)
// ------------------------------------------------------------------------------------------------

describe('PUT /v1/admin/note-types/{key}: what it checks before it stores a version', () => {
  it('waits for the team lock before it reads or writes any table, then publishes', async () => {
    const row = await rowOf('harm_reduction');
    const { waited, relations, answer } = await whileLocked(h, team.teamId, () =>
      api.publish('harm_reduction', row.version, [
        { op: 'rename_label', path: row.definition.sections[0]!.id, label: 'Demo: Under the lock' },
      ]),
    );
    expect(waited, 'the publish waits for the team lock').toBe(true);
    expect(relations, 'the publish touched no table before the team lock').toEqual([]);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    await readBack('harm_reduction', row.version + 1);
  });

  it('refuses a version over the size limit, as the validator measures it, writing nothing', async () => {
    const row = await rowOf('outreach');
    // Words with no space after them, which a label may not have (as a title may not).
    const label = `Demo: ${'long '.repeat(Math.ceil(MAX_DEFINITION_BYTES / 5))}`.trimEnd();
    const details = await refusedUnwritten(
      () =>
        api.publish('outreach', row.version, [
          {
            op: 'add_field',
            sectionId: row.definition.sections[0]!.id,
            kind: 'text',
            label,
            lines: 'one',
            maxLength: 10,
          },
        ]),
      422,
      'invalid',
    );
    expect((details.problems as { rule: string }[]).map((p) => p.rule)).toEqual(['validate.too_large']);
  });

  it('refuses a publish that changes nothing, as a preset edit is refused: no version for nothing', async () => {
    const row = await rowOf('outreach');
    for (const ops of [
      [{ op: 'rename_type', title: row.title }],
      [
        { op: 'rename_type', title: 'Demo: Outreach, for a moment' },
        { op: 'rename_type', title: row.title },
      ],
    ] as NoteTypeEdit[][])
      await refusedUnwritten(() => api.publish('outreach', row.version, ops), 422, 'no_change');
  });

  it('refuses no operations, too many, and an operation carrying a mark, before anything is asked', async () => {
    const row = await rowOf('outreach');
    const rename: NoteTypeEdit = { op: 'rename_type', title: 'Demo: Outreach, many' };
    for (const ops of [
      [],
      Array.from({ length: 201 }, () => rename),
      [
        {
          op: 'add_field',
          sectionId: 'outreach',
          kind: 'text',
          label: 'Demo: x',
          lines: 'one',
          maxLength: 9,
          required: true,
        },
      ],
      [{ op: 'rename_label', path: 'outreach.new_need', label: 'Demo: x', sensitiveExam: true }],
    ])
      await refusedUnwritten(
        () =>
          api.send('PUT', '/v1/admin/note-types/outreach', { baseVersion: row.version, ops, reason: REASON }),
        422,
        'validation_failed',
      );
  });

  it('makes a carried option’s code above every one each note type it reaches has used, hidden ones too (rule 3)', async () => {
    // Wound care makes a field of its own and hides it, so its current version uses no code its
    // version before did; an option the quick encounter adds and carries into wound care gets a code
    // above them all, the same in both, never one wound care gave a meaning before.
    const t = await presetsTeam(h, 'Note Types Codes');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const at = async (key: string) => (await rowOf(key, theirs)).version;
    const made = await theirs.publish('wound_care', await at('wound_care'), [
      {
        op: 'add_field',
        sectionId: 'wound',
        kind: 'choice',
        label: 'Demo: Smell',
        many: false,
        options: ['Demo: None', 'Demo: Some'],
      },
    ]);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const hidden = await theirs.publish('wound_care', await at('wound_care'), [
      { op: 'set_hidden', path: 'wound.t_1', hidden: true },
    ]);
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
    const mark = await auditMark(h);
    const r = await theirs.publish('quick_encounter', await at('quick_encounter'), [
      { op: 'rename_type', title: 'Demo: Quick, with foil' },
      { op: 'add_option', path: 'wound.dressing', label: 'Demo: Foil' },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.alsoPublished).toEqual(['wound_care']);
    const codes = await Promise.all(
      [
        ['quick_encounter', 'wound.dressing'],
        ['wound_care', 'wound.treatment.dressing'],
      ].map(async ([key, path]) => {
        const { definition } = await storedAs(key!, await at(key!), t.teamId);
        return fieldOf(definition, path!).options!.at(-1);
      }),
    );
    expect(codes).toEqual([
      { code: 't_4', label: 'Demo: Foil' },
      { code: 't_4', label: 'Demo: Foil' },
    ]);
    expect((await auditAfter(h, mark)).map((e) => [e.action, e.entityId, e.details])).toEqual([
      // Each names the operations applied to it: wound care only the one carried there.
      [
        'note_type.published',
        'quick_encounter',
        { version: 2, operations: ['rename_type', 'add_option'], count: 2 },
      ],
      ['note_type.published', 'wound_care', { version: 4, operations: ['add_option'], count: 1 }],
    ]);
  });

  it('refuses an option operation whose reach would leave a field of another note type with no option, naming it', async () => {
    const t = await presetsTeam(h, 'Note Types Reach');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf('social_needs', theirs);
    const quick = fieldOf((await rowOf('quick_encounter', theirs)).definition, 'social.needs');
    const ops: NoteTypeEdit[] = quick.options!.map((o) => ({
      op: 'retire_option',
      path: 'needs.needs',
      code: o.code,
    }));
    const details = await refusedUnwritten(
      () => theirs.publish('social_needs', row.version, ops),
      422,
      'last_option',
      t.teamId,
    );
    expect(details).toEqual({ opIndex: ops.length - 1, noteTypeKey: 'quick_encounter' });
  });

  it('never edits from a stored version that is not the row it says, nor lists one', async () => {
    // Rows written by hand, each hash another definition's: the list and a publish answer a fault
    // and write nothing, rather than make the next version from one (D79), whether the row is the
    // current version or one before it, which a publish reads too.
    const byHand = async (label: string, bad: number, current: number) => {
      const t = await presetsTeam(h, label);
      const [v1] = await versionsOf(t.teamId, 'social_needs');
      await h.scratch.owner.begin(async (tx) => {
        const revision = await takeRevision(tx as unknown as InstallSql, t.teamId);
        for (let version = 2; version <= current; version++) {
          const definition = { ...v1!.definition, version, title: `Demo: By hand ${version}` };
          const hash = version === bad ? v1!.hash : await sha256Hex(canonicalJson(definition));
          await tx`
            insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin)
            values (${t.teamId}, 'social_needs', ${version}, ${tx.json(definition as never)}, ${hash}, 'team')`;
        }
        await tx`
          update sineobex.note_types set current_version = ${current}, revision = ${revision}
          where team_id = ${t.teamId} and key = 'social_needs'`;
      });
      return { t, theirs: noteTypesApi(t.teamId, t.admin) };
    };
    const atCurrent = await byHand('Note Types Rows', 2, 2);
    expect((await atCurrent.theirs.list()).status).toBe(500);
    await refusedUnwritten(
      () =>
        atCurrent.theirs.publish('social_needs', 2, [{ op: 'rename_type', title: 'Demo: From a bad row' }]),
      500,
      'internal',
      atCurrent.t.teamId,
    );
    const before = await byHand('Note Types Rows Before', 2, 3);
    // The list reads every version too, for what each showed before (its hidden parts, Show again).
    expect((await before.theirs.list()).status).toBe(500);
    await refusedUnwritten(
      () => before.theirs.publish('social_needs', 3, [{ op: 'rename_type', title: 'Demo: Over a bad row' }]),
      500,
      'internal',
      before.t.teamId,
    );
  });

  it('checks each note type a carried operation changes: a retire that leaves a condition of the reached one naming nothing', async () => {
    // Wound care shows the drainage type only for some drainage amounts, which the quick encounter's
    // drainage maps into: retiring one of them there retires it in wound care too, whose condition
    // would then name a code it no longer has.
    const t = await presetsTeam(h, 'Note Types Reached Check');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf('quick_encounter', theirs);
    const wound = await rowOf('wound_care', theirs);
    // Refused where it reaches wound care, by its index, naming the note type (review B-14).
    expect(
      await refusedUnwritten(
        () =>
          theirs.publish('quick_encounter', row.version, [
            { op: 'retire_option', path: 'wound.drainage', code: 'scant' },
          ]),
        422,
        'in_use',
        t.teamId,
      ),
    ).toEqual({ opIndex: 0, noteTypeKey: 'wound_care' });
    expect((await rowOf('wound_care', theirs)).version).toBe(wound.version);
  });

  it('rewords an option carried into the quick encounter, each version declaring its own rename', async () => {
    const t = await presetsTeam(h, 'Note Types Reached Rename');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const wound = await rowOf('wound_care', theirs);
    const quick = await rowOf('quick_encounter', theirs);
    const r = await theirs.publish('wound_care', wound.version, [
      { op: 'rename_option', path: 'wound.treatment.dressing', code: 'gauze', label: 'Demo: Gauze pad' },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.alsoPublished).toEqual(['quick_encounter']);
    for (const [key, version, path] of [
      ['wound_care', wound.version + 1, 'wound.treatment.dressing'],
      ['quick_encounter', quick.version + 1, 'wound.dressing'],
    ] as const) {
      const { definition } = await storedAs(key, version, t.teamId);
      expect(fieldOf(definition, path).options!.find((o) => o.code === 'gauze')!.label, key).toBe(
        'Demo: Gauze pad',
      );
    }
  });

  it('reads a removed quick encounter as an active one: what it maps to stays in use, and its lists move with it', async () => {
    // Removed, a note type keeps its mapsTo and comes back as it is (5.1, 5.4). So a hide of a field
    // the removed quick encounter maps to is refused, and an option operation reaches it (rule 5):
    // once restored, it maps only to what wound care has, and its next publish passes the validator.
    const t = await presetsTeam(h, 'Note Types Removed Quick');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const maps = await h.scratch.owner<{ id: string; version: number }[]>`
      select p.id, p.current_version as version from sineobex.team_presets p
      join sineobex.team_preset_versions v
        on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
      where p.team_id = ${t.teamId} and p.kind = 'field_supply_map' and p.state = 'active'
        and v.body ->> 'noteTypeKey' = 'quick_encounter'`;
    const presets = presetsApi(h, t.teamId, t.admin);
    for (const map of maps)
      expect((await presets.archive('field_supply_map', map.id, map.version)).status).toBe(200);
    const quick = await rowOf('quick_encounter', theirs);
    expect((await theirs.archive('quick_encounter', quick.version)).status).toBe(200);

    const wound = await rowOf('wound_care', theirs);
    expect(
      await refusedUnwritten(
        () =>
          theirs.publish('wound_care', wound.version, [
            { op: 'set_hidden', path: 'wound.type', hidden: true },
          ]),
        422,
        'in_use',
        t.teamId,
      ),
    ).toEqual({ opIndex: 0 });
    const retired = await theirs.publish('wound_care', wound.version, [
      { op: 'retire_option', path: 'wound.drainage_amount', code: 'none' },
    ]);
    expect(retired.status, JSON.stringify(retired.body)).toBe(200);
    expect(retired.body).toEqual({ version: wound.version + 1, alsoPublished: ['quick_encounter'] });
    // The removed one has its next version, stays removed, and its list moved with wound care's.
    const reached = await rowOf('quick_encounter', theirs);
    expect(reached).toMatchObject({ state: 'archived', version: quick.version + 1 });
    const { definition } = await storedAs('quick_encounter', quick.version + 1, t.teamId);
    expect(fieldOf(definition, 'wound.drainage').options!.map((o) => o.code)).not.toContain('none');
    expect(fieldOf(definition, 'wound.type').options!.length).toBeGreaterThan(0);

    expect((await theirs.restore('quick_encounter')).status).toBe(200);
    const renamed = await theirs.publish('quick_encounter', reached.version, [
      { op: 'rename_type', title: 'Demo: Quick, back again' },
    ]);
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------
// Remove and Restore
// ------------------------------------------------------------------------------------------------

describe('POST /v1/admin/note-types/{key}/archive and /restore', () => {
  it('removes a note type at the version it is at, and restores it there, each with its event and audit', async () => {
    const made = await api.create({
      title: 'Demo: Removed and back',
      kinds: ['non_medical'],
      group: 'outreach',
    });
    const key = made.body.key as string;
    const r0 = await revisionOf(team.teamId);
    const mark = await auditMark(h);
    const archived = await api.archive(key, 1);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body).toEqual({ revision: r0 + 1 });
    expect(await headOf(team.teamId, key)).toMatchObject({
      state: 'archived',
      currentVersion: 1,
      customized: true,
      revision: r0 + 1,
    });
    expect((await rowOf(key)).state).toBe('archived');
    const restored = await api.restore(key);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body).toEqual({ revision: r0 + 2 });
    expect(await headOf(team.teamId, key)).toMatchObject({ state: 'active', currentVersion: 1 });
    expect((await eventsOf(team.teamId, key)).map((e) => [e.act, e.version, e.reason])).toEqual([
      ['created', 1, REASON],
      ['archived', 1, REASON],
      ['restored', 1, REASON],
    ]);
    expect((await auditAfter(h, mark)).map((e) => [e.action, e.entityId, e.details.version])).toEqual([
      ['note_type.archived', key, 1],
      ['note_type.restored', key, 1],
    ]);
    expect(await versionsOf(team.teamId, key)).toHaveLength(1);
  });

  it('refuses to remove a note type an active field supply map names, with the count', async () => {
    const row = await rowOf('wound_care');
    const details = await refusedUnwritten(() => api.archive('wound_care', row.version), 409, 'referenced');
    expect(details).toEqual({ referencedBy: row.referencedBy });
  });

  it('refuses to remove the auto note type: a Medical note is never finished without it', async () => {
    const row = await rowOf('red_flags_disposition');
    await refusedUnwritten(() => api.archive('red_flags_disposition', row.version), 409, 'not_removable');
  });

  it('refuses a stale remove, a second remove and a restore of what is not removed', async () => {
    const made = await api.create({
      title: 'Demo: Removed twice',
      kinds: ['non_medical'],
      group: 'outreach',
    });
    const key = made.body.key as string;
    expect(refused(await api.archive(key, 2), 409, 'stale')).toEqual({ currentVersion: 1 });
    await refusedUnwritten(() => api.restore(key), 409, 'not_archived');
    expect((await api.archive(key, 1)).status).toBe(200);
    await refusedUnwritten(() => api.archive(key, 1), 409, 'archived');
  });

  it('refuses to restore a note type whose title another active one took meanwhile', async () => {
    const first = await api.create({ title: 'Demo: Taken title', kinds: ['non_medical'], group: 'outreach' });
    expect((await api.archive(first.body.key as string, 1)).status).toBe(200);
    expect(
      (await api.create({ title: 'Demo: Taken title', kinds: ['non_medical'], group: 'outreach' })).status,
    ).toBe(201);
    await refusedUnwritten(() => api.restore(first.body.key as string), 409, 'name_taken');
  });
});

// ------------------------------------------------------------------------------------------------
// Taking a platform update
// ------------------------------------------------------------------------------------------------

describe('POST /v1/admin/note-types/{key}/take-update', () => {
  /** A note type the team edits, then a platform version of it, which the installer only offers. */
  async function offered(
    key: string,
    change: (d: ResolvedNoteType) => ResolvedNoteType = (d) => ({ ...d, title: `${d.title}, again` }),
  ) {
    const row = await rowOf(key);
    // A title of its own: "Demo: Harm reduction, ours" is the copy's added above, and a rename into
    // a title another active note type holds is refused name_taken.
    const edited = await api.publish(key, row.version, [
      { op: 'rename_type', title: `Demo: ${row.title}, edited here` },
    ]);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const next = await platformNext(key, change);
    const unrelease = release(next);
    await phoneLists();
    return { next, unrelease, row: await rowOf(key) };
  }

  it('lists the update on offer as taking it would write it, and takes it in place, the platform’s again', async () => {
    const { next, unrelease, row } = await offered('psychological');
    try {
      expect(row.updateOnOffer).toBe(true);
      expect(row.updateChangesFixed).toBe(false);
      expect(row.update).toEqual({
        platformVersion: next.version,
        definition: { ...next.definition, version: row.version + 1 },
        changesFixed: [],
      });
      const mark = await auditMark(h);
      const r = await api.takeUpdate('psychological', {
        baseVersion: row.version,
        platformVersion: next.version,
        asNew: false,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toEqual({
        key: 'psychological',
        version: row.version + 1,
        revision: await revisionOf(team.teamId),
      });
      const stored = (await versionsOf(team.teamId, 'psychological')).at(-1)!;
      expect(stored).toMatchObject({
        version: row.version + 1,
        origin: 'preset',
        presetVersion: next.version,
      });
      expect(stored.definition).toEqual(row.update!.definition);
      expect(await headOf(team.teamId, 'psychological')).toMatchObject({
        title: next.definition.title,
        currentVersion: row.version + 1,
        customized: false,
      });
      expect((await eventsOf(team.teamId, 'psychological')).at(-1)).toEqual({
        act: 'update_taken',
        version: row.version + 1,
        reason: REASON,
        createdBy: team.admin.userId,
      });
      expect((await auditAfter(h, mark)).map((e) => [e.action, e.entityId])).toEqual([
        ['note_type.platform_update_taken', 'psychological'],
      ]);
      expect((await rowOf('psychological')).update).toBeNull();
      await readBack('psychological', row.version + 1);
    } finally {
      unrelease();
    }
  });

  it('takes only the platform version reviewed: another one on offer, or none, is stale', async () => {
    const { next, unrelease, row } = await offered('sexual_reproductive');
    try {
      const details = await refusedUnwritten(
        () =>
          api.takeUpdate('sexual_reproductive', {
            baseVersion: row.version,
            platformVersion: next.version - 1,
            asNew: false,
          }),
        409,
        'stale',
      );
      expect(details).toEqual({ currentVersion: row.version, platformVersion: next.version });
      expect(
        refused(
          await api.takeUpdate('sexual_reproductive', {
            baseVersion: row.version - 1,
            platformVersion: next.version,
            asNew: false,
          }),
          409,
          'stale',
        ),
      ).toEqual({ currentVersion: row.version, platformVersion: next.version });
    } finally {
      unrelease();
    }
    const social = await rowOf('outreach');
    await refusedUnwritten(
      () => api.takeUpdate('outreach', { baseVersion: social.version, platformVersion: 2, asNew: false }),
      409,
      'no_update',
    );
  });

  it('only takes as a new note type an update that changes what is fixed: the old one removed, kept in the history', async () => {
    const { next, unrelease, row } = await offered('general_primary_care', (d) => ({
      ...d,
      group: 'social',
    }));
    try {
      expect(row.updateChangesFixed).toBe(true);
      expect(row.update!.changesFixed).toEqual(['group']);
      const details = await refusedUnwritten(
        () =>
          api.takeUpdate('general_primary_care', {
            baseVersion: row.version,
            platformVersion: next.version,
            asNew: false,
          }),
        409,
        'fixed_field',
      );
      expect(details).toEqual({ fields: ['group'] });
      // As new, the old one is removed, which its active field supply maps refuse, as a Remove.
      expect(row.referencedBy.field_supply_map).toBeGreaterThan(0);
      const referenced = await refusedUnwritten(
        () =>
          api.takeUpdate('general_primary_care', {
            baseVersion: row.version,
            platformVersion: next.version,
            asNew: true,
          }),
        409,
        'referenced',
      );
      expect(referenced).toEqual({ referencedBy: row.referencedBy });
    } finally {
      unrelease();
    }
  });

  it('takes an update as a new note type: the platform’s definition named as its own row, the old one removed', async () => {
    const { next, unrelease, row } = await offered('harm_reduction', (d) => ({ ...d, sensitivity: 'none' }));
    try {
      expect(row.update!.changesFixed).toEqual(['sensitivity']);
      const mark = await auditMark(h);
      const r = await api.takeUpdate('harm_reduction', {
        baseVersion: row.version,
        platformVersion: next.version,
        asNew: true,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const key = r.body.key as string;
      expect(r.body).toEqual({
        key: expect.stringMatching(/^t_[0-9a-f]{12}$/),
        version: 1,
        revision: await revisionOf(team.teamId),
      });
      const [stored] = await versionsOf(team.teamId, key);
      expect(stored!.definition).toEqual({ ...next.definition, key, version: 1 });
      expect(stored).toMatchObject({ origin: 'preset', presetVersion: next.version });
      expect(await headOf(team.teamId, 'harm_reduction')).toMatchObject({ state: 'archived' });
      expect((await auditAfter(h, mark)).map((e) => [e.action, e.entityId, e.details.replaces])).toEqual([
        ['note_type.archived', 'harm_reduction', undefined],
        ['note_type.platform_update_taken', key, 'harm_reduction'],
      ]);
      // The old one, removed by the take, offers that update no more.
      const old = await rowOf('harm_reduction');
      expect([old.update, old.updateOnOffer]).toEqual([null, false]);
      await readBack(key, 1);
    } finally {
      unrelease();
    }
  });

  it('refuses to take an update in place on a removed note type', async () => {
    const { next, unrelease, row } = await offered('social_needs');
    try {
      expect((await api.archive('social_needs', row.version)).status).toBe(200);
      await refusedUnwritten(
        () =>
          api.takeUpdate('social_needs', {
            baseVersion: row.version,
            platformVersion: next.version,
            asNew: false,
          }),
        409,
        'archived',
      );
      expect((await api.restore('social_needs')).status).toBe(200);
    } finally {
      unrelease();
    }
  });
});

// ------------------------------------------------------------------------------------------------
// What each act checks besides (card P4-lifecycle), each in a team of its own
// ------------------------------------------------------------------------------------------------

describe('adding, removing, restoring and taking an update: what each checks', () => {
  /** A team of its own, and its note types offered a platform version of `key` the team edited first. */
  async function teamWithOffer(
    label: string,
    key: string,
    change: (d: ResolvedNoteType) => ResolvedNoteType = (d) => ({ ...d, title: `${d.title}, again` }),
  ) {
    const t = await presetsTeam(h, label);
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf(key, theirs);
    const edited = await theirs.publish(key, row.version, [
      { op: 'rename_type', title: `Demo: ${row.title}, ours` },
    ]);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const next = await platformNext(key, change);
    const unrelease = release(next);
    // A phone's list runs the installer, which offers the platform version over the team's own.
    const listed = await call(h, '/v1/forms/note-types', {
      token: await tokenOf(h, t.admin),
      teamId: t.teamId,
    });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    return { t, theirs, next, unrelease, row: await rowOf(key, theirs) };
  }

  it('each write waits for the team lock before it reads or writes any table', async () => {
    const t = await presetsTeam(h, 'Note Types Lock');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const blank = { title: 'Demo: Under the lock', kinds: ['non_medical'], group: 'outreach' };
    const made = await theirs.create({ ...blank, title: 'Demo: Made first' });
    const key = made.body.key as string;
    const gone = (await theirs.create({ ...blank, title: 'Demo: Gone first' })).body.key as string;
    expect((await theirs.archive(gone, 1)).status).toBe(200);
    for (const [name, write, status] of [
      ['create', () => theirs.create(blank), 201],
      ['archive', () => theirs.archive(key, 1), 200],
      ['restore', () => theirs.restore(gone), 200],
      // Refused once it holds the lock: what it refuses is worked out under it, too.
      [
        'take-update',
        () => theirs.takeUpdate('outreach', { baseVersion: 1, platformVersion: 2, asNew: false }),
        409,
      ],
    ] as [string, () => Promise<Answer>, number][]) {
      const { waited, relations, answer } = await whileLocked(h, t.teamId, write);
      expect(waited, `${name} waits for the team lock`).toBe(true);
      expect(relations, `${name} touched no table before the team lock`).toEqual([]);
      expect(answer.status, `${name}: ${JSON.stringify(answer.body)}`).toBe(status);
    }
  });

  it('copies a removed note type too, keeps what its marks protect, and stores kinds in one order', async () => {
    const t = await presetsTeam(h, 'Note Types Adds');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const source = await rowOf('harm_reduction', theirs);
    expect((await theirs.archive('harm_reduction', source.version)).status).toBe(200);
    const copy = await theirs.create({
      title: 'Demo: Ours, from a removed one',
      copyOf: 'harm_reduction',
    });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    const row = await rowOf(copy.body.key as string, theirs);
    // What its marks protect comes with it, and who may read it (rule 2).
    expect(row.protected).toEqual(source.protected);
    expect(row.protected.fields.length + row.protected.options.length).toBeGreaterThan(0);
    expect(row.definition.sensitivity).toBe('sensitive');
    expect(await headOf(t.teamId, row.key)).toMatchObject({
      state: 'active',
      customized: true,
      platformLatest: null,
    });
    const both = await theirs.create({
      title: 'Demo: Both, either way',
      kinds: ['non_medical', 'medical'],
      group: 'social',
    });
    expect(both.status, JSON.stringify(both.body)).toBe(201);
    expect((await storedAs(both.body.key as string, 1, t.teamId)).definition.kinds).toEqual([
      'medical',
      'non_medical',
    ]);
  });

  it('refuses a title sent with spaces around it, never trimming it, when adding and when renaming', async () => {
    const t = await presetsTeam(h, 'Note Types Titles');
    const theirs = noteTypesApi(t.teamId, t.admin);
    for (const title of [' Demo: Padded', 'Demo: Padded ', 'x'.repeat(81), 'Demo:\u0007bell'])
      await refusedUnwritten(
        () => theirs.create({ title, kinds: ['medical'], group: 'clinical' }),
        422,
        'validation_failed',
        t.teamId,
      );
    const row = await rowOf('outreach', theirs);
    await refusedUnwritten(
      () => theirs.publish('outreach', row.version, [{ op: 'rename_type', title: ' Demo: Padded' }]),
      422,
      'validation_failed',
      t.teamId,
    );
  });

  it('refuses a label, an answer’s words or a section’s title sent with spaces around them, as a title is, never trimming them', async () => {
    const t = await presetsTeam(h, 'Note Types Labels');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf('outreach', theirs);
    const text = { kind: 'text', lines: 'one', maxLength: 100 } as const;
    for (const [op, path] of [
      [{ op: 'rename_label', path: 'outreach.notes', label: ' Demo: Padded' }, 'ops.0.label'],
      [{ op: 'rename_label', path: 'outreach', label: 'Demo: Padded ' }, 'ops.0.label'],
      [{ op: 'add_option', path: 'outreach.support', label: 'Demo: Padded ' }, 'ops.0.label'],
      [
        { op: 'rename_option', path: 'outreach.support', code: 'food', label: '\tDemo: Padded' },
        'ops.0.label',
      ],
      [{ op: 'add_field', sectionId: 'outreach', ...text, label: 'Demo: Padded ' }, 'ops.0.label'],
      [
        {
          op: 'add_field',
          sectionId: 'outreach',
          kind: 'choice',
          label: 'Demo: Asked',
          many: false,
          options: ['Demo: Yes', ' Demo: No'],
        },
        'ops.0.options.1',
      ],
      [
        {
          op: 'add_section',
          title: ' Demo: Padded',
          afterSectionId: null,
          fields: [{ ...text, label: 'Demo: Notes' }],
        },
        'ops.0.title',
      ],
      [
        {
          op: 'add_section',
          title: 'Demo: Section',
          afterSectionId: null,
          fields: [{ ...text, label: 'Demo: Padded ' }],
        },
        'ops.0.fields.0.label',
      ],
    ] as [NoteTypeEdit, string][]) {
      const details = await refusedUnwritten(
        () => theirs.publish('outreach', row.version, [op]),
        422,
        'validation_failed',
        t.teamId,
      );
      expect(details.fields, `${op.op} ${path}`).toEqual([{ path, problem: 'custom' }]);
    }
    // Only spaces are no words at all: the operation's to refuse, by its index, as for a title.
    const blank = refused(
      await theirs.publish('outreach', row.version, [
        { op: 'rename_label', path: 'outreach.notes', label: '   ' },
      ]),
      422,
      'label_invalid',
    );
    expect(blank).toEqual({ opIndex: 0 });
  });

  it('refuses a take when nothing is on offer and the version sent is not the current one: stale, with none on offer', async () => {
    const t = await presetsTeam(h, 'Note Types No Offer');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf('outreach', theirs);
    const details = await refusedUnwritten(
      () => theirs.takeUpdate('outreach', { baseVersion: row.version + 1, platformVersion: 2, asNew: true }),
      409,
      'stale',
      t.teamId,
    );
    expect(details).toEqual({ currentVersion: row.version, platformVersion: null });
  });

  it('refuses to take an update whose title another active note type holds, in place and as new', async () => {
    const { t, theirs, next, unrelease, row } = await teamWithOffer('Note Types Take Title', 'psychological');
    try {
      expect(
        (
          await theirs.create({
            title: next.definition.title.toUpperCase(),
            kinds: ['medical'],
            group: 'psych',
          })
        ).status,
      ).toBe(201);
      for (const asNew of [false, true])
        await refusedUnwritten(
          () =>
            theirs.takeUpdate('psychological', {
              baseVersion: row.version,
              platformVersion: next.version,
              asNew,
            }),
          409,
          'name_taken',
          t.teamId,
        );
    } finally {
      unrelease();
    }
  });

  it('refuses to take an update phase 4’s validator refuses against the team, writing nothing', async () => {
    // The platform version names a note type this team does not hold.
    const { t, theirs, next, unrelease, row } = await teamWithOffer(
      'Note Types Take Invalid',
      'psychological',
      (d) => ({
        ...d,
        title: `${d.title}, again`,
        sections: d.sections.map((s, i) =>
          i === 0
            ? {
                ...s,
                fields: [
                  ...s.fields,
                  {
                    id: 'next_visit',
                    kind: 'action',
                    label: 'Demo: Open the next visit',
                    action: 'open_note_type',
                    noteType: 'demo_nowhere',
                  },
                ],
              }
            : s,
        ) as ResolvedNoteType['sections'],
      }),
    );
    try {
      for (const asNew of [false, true]) {
        const details = await refusedUnwritten(
          () =>
            theirs.takeUpdate('psychological', {
              baseVersion: row.version,
              platformVersion: next.version,
              asNew,
            }),
          422,
          'invalid',
          t.teamId,
        );
        expect((details.problems as { rule: string }[]).map((p) => p.rule)).toContain(
          'validate.unknown_note_type',
        );
      }
    } finally {
      unrelease();
    }
  });

  it('takes an update as a new note type from a removed one, which stays removed, and offers the new one nothing', async () => {
    const { t, theirs, next, unrelease, row } = await teamWithOffer(
      'Note Types Take Removed',
      'social_needs',
    );
    try {
      expect((await theirs.archive('social_needs', row.version)).status).toBe(200);
      const events = await eventsOf(t.teamId, 'social_needs');
      const mark = await auditMark(h);
      const r = await theirs.takeUpdate('social_needs', {
        baseVersion: row.version,
        platformVersion: next.version,
        asNew: true,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const key = r.body.key as string;
      expect(await eventsOf(t.teamId, 'social_needs')).toEqual(events);
      expect(await eventsOf(t.teamId, key)).toEqual([
        { act: 'update_taken', version: 1, reason: REASON, createdBy: t.admin.userId },
      ]);
      expect((await auditAfter(h, mark)).map((e) => [e.action, e.entityId, e.details])).toEqual([
        ['note_type.platform_update_taken', key, { version: 1, replaces: 'social_needs' }],
      ]);
      expect(await headOf(t.teamId, key)).toMatchObject({
        title: next.definition.title,
        state: 'active',
        currentVersion: 1,
        platformLatest: next.version,
        customized: false,
      });
      const made = await rowOf(key, theirs);
      expect([made.update, made.updateOnOffer]).toEqual([null, false]);
      // The removed one no longer offers the update it gave the new one, and can't give it twice.
      const old = await rowOf('social_needs', theirs);
      expect([old.state, old.update, old.updateOnOffer]).toEqual(['archived', null, false]);
      await refusedUnwritten(
        () =>
          theirs.takeUpdate('social_needs', {
            baseVersion: old.version,
            platformVersion: next.version,
            asNew: true,
          }),
        409,
        'no_update',
        t.teamId,
      );
      await storedAs(key, 1, t.teamId);
    } finally {
      unrelease();
    }
  });

  it('offers the platform’s later versions on the note type an update was taken as, never on the one it replaced', async () => {
    const { t, theirs, next, unrelease, row } = await teamWithOffer(
      'Note Types Taken Then Later',
      'social_needs',
    );
    let unreleaseLater: (() => void) | undefined;
    try {
      const r = await theirs.takeUpdate('social_needs', {
        baseVersion: row.version,
        platformVersion: next.version,
        asNew: true,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const key = r.body.key as string;
      // The new one names the platform's note type it came from; the old one gave it up.
      expect([await originOf(t.teamId, key), await originOf(t.teamId, 'social_needs')]).toEqual([
        'social_needs',
        null,
      ]);
      // Edited by the team, the new one is only offered the platform's next version.
      const edited = await theirs.publish(key, 1, [
        { op: 'rename_type', title: 'Demo: Social needs, the night round' },
      ]);
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const later = await platformNext('social_needs', (d) => ({ ...d, title: 'Social needs, third' }));
      unreleaseLater = release(later);
      const listed = await call(h, '/v1/forms/note-types', {
        token: await tokenOf(h, t.admin),
        teamId: t.teamId,
      });
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const made = await rowOf(key, theirs);
      expect([made.updateOnOffer, made.update]).toEqual([
        true,
        {
          platformVersion: later.version,
          definition: { ...later.definition, key, version: 3 },
          changesFixed: [],
        },
      ]);
      const old = await rowOf('social_needs', theirs);
      expect([old.update, old.updateOnOffer]).toEqual([null, false]);
      // Taken in place, the new one is the platform's again, at the version on offer.
      const take = await theirs.takeUpdate(key, {
        baseVersion: made.version,
        platformVersion: later.version,
        asNew: false,
      });
      expect(take.status, JSON.stringify(take.body)).toBe(200);
      expect((await versionsOf(t.teamId, key)).at(-1)).toMatchObject({
        version: 3,
        origin: 'preset',
        presetVersion: later.version,
      });
      expect(await headOf(t.teamId, key)).toMatchObject({ title: 'Social needs, third', customized: false });
      await storedAs(key, 3, t.teamId);
    } finally {
      unreleaseLater?.();
      unrelease();
    }
  });

  it('refuses to take an update as new on the auto note type, which can’t be removed', async () => {
    const t = await presetsTeam(h, 'Note Types Take Auto');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const row = await rowOf('red_flags_disposition', theirs);
    await refusedUnwritten(
      () =>
        theirs.takeUpdate('red_flags_disposition', {
          baseVersion: row.version,
          platformVersion: 2,
          asNew: true,
        }),
      409,
      'not_removable',
      t.teamId,
    );
  });

  it('takes an update in place over a label the team reworded: the platform words its own paths', async () => {
    const { t, theirs, next, unrelease, row } = await teamWithOffer('Note Types Take Label', 'outreach');
    try {
      // The team rewords a field the platform's version words as it always did.
      const reworded = await theirs.publish('outreach', row.version, [
        { op: 'rename_label', path: 'outreach.new_need', label: 'Demo: Anything new they need?' },
      ]);
      expect(reworded.status, JSON.stringify(reworded.body)).toBe(200);
      const r = await theirs.takeUpdate('outreach', {
        baseVersion: row.version + 1,
        platformVersion: next.version,
        asNew: false,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const { definition } = await storedAs('outreach', row.version + 2, t.teamId);
      expect(fieldOf(definition, 'outreach.new_need').label).toBe(
        fieldOf(next.definition, 'outreach.new_need').label,
      );
    } finally {
      unrelease();
    }
  });

  it('counts only active field supply maps: once its maps are removed, a note type can be removed', async () => {
    const t = await presetsTeam(h, 'Note Types Maps');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const maps = await h.scratch.owner<{ id: string; version: number }[]>`
      select p.id, p.current_version as version from sineobex.team_presets p
      join sineobex.team_preset_versions v
        on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
      where p.team_id = ${t.teamId} and p.kind = 'field_supply_map' and p.state = 'active'
        and v.body ->> 'noteTypeKey' = 'outreach'`;
    expect(maps.length).toBeGreaterThan(0);
    expect((await rowOf('outreach', theirs)).referencedBy).toEqual({ field_supply_map: maps.length });
    const presets = presetsApi(h, t.teamId, t.admin);
    for (const map of maps)
      expect((await presets.archive('field_supply_map', map.id, map.version)).status).toBe(200);
    const row = await rowOf('outreach', theirs);
    expect(row.referencedBy).toEqual({});
    expect((await theirs.archive('outreach', row.version)).status).toBe(200);
  });

  it('refuses a copied section the validator refuses where it lands, with what it found and its index', async () => {
    // A general primary care exam section shows by the exam's systems, which a blank note type lacks.
    const t = await presetsTeam(h, 'Note Types Copy Invalid');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const made = await theirs.create({
      title: 'Demo: Exams of our own',
      kinds: ['medical'],
      group: 'clinical',
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const key = made.body.key as string;
    const details = await refusedUnwritten(
      () =>
        theirs.publish(key, 1, [
          { op: 'copy_section', fromKey: 'general_primary_care', sectionId: 'eyes', afterSectionId: 'notes' },
        ]),
      422,
      'invalid',
      t.teamId,
    );
    expect(details.opIndex).toBe(0);
    expect((details.problems as unknown[]).length).toBeGreaterThan(0);
  });

  it('offers an update that only lists the same kinds in another order as one that changes nothing fixed', async () => {
    const { theirs, next, unrelease, row } = await teamWithOffer(
      'Note Types Kinds Order',
      'outreach',
      (d) => ({
        ...d,
        title: `${d.title}, again`,
        kinds: [...d.kinds].reverse(),
      }),
    );
    try {
      expect(next.definition.kinds).toEqual(['non_medical', 'medical']);
      expect([row.updateChangesFixed, row.update!.changesFixed]).toEqual([false, []]);
      const r = await theirs.takeUpdate('outreach', {
        baseVersion: row.version,
        platformVersion: next.version,
        asNew: false,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    } finally {
      unrelease();
    }
  });

  it('asks a take for a reason and a recent sign-in, and team.manage_presets, before it reads anything', async () => {
    const t = await presetsTeam(h, 'Note Types Take Asks');
    const take = { baseVersion: 1, platformVersion: 2, asNew: false };
    const path = '/v1/admin/note-types/outreach/take-update';
    const theirs = noteTypesApi(t.teamId, t.admin);
    for (const reason of [undefined, '  ', 'ab', 'x'.repeat(301)]) {
      const details = await refusedUnwritten(
        () => theirs.send('POST', path, reason === undefined ? take : { ...take, reason }),
        422,
        'validation_failed',
        t.teamId,
      );
      expect(JSON.stringify(details.fields)).toContain('reason');
    }
    const stale = noteTypesApi(t.teamId, t.admin, { token: await tokenOf(h, t.admin, STALE_MINUTES) });
    const mark = await auditMark(h);
    await refusedUnwritten(() => stale.takeUpdate('outreach', take), 403, 'reauth_required', t.teamId);
    expect(await auditAfter(h, mark)).toEqual([]);
    const staff = noteTypesApi(t.teamId, t.staff);
    refused(await staff.takeUpdate('outreach', take), 403, 'forbidden');
    expect((await auditAfter(h, mark)).map((e) => [e.action, e.details.permission])).toEqual([
      ['access.denied', 'team.manage_presets'],
    ]);
  });
});

// ------------------------------------------------------------------------------------------------
// Every write: a reason and a recent sign-in
// ------------------------------------------------------------------------------------------------

describe('a platform version under which a field supply map would fire on what some readers may not see (BM-77)', () => {
  /**
   * A team with a field supply map of its own on wound care's wound bed (slough), and the platform's
   * next wound care, which marks that answer a sensitive exam's: nothing fixed at creation changes,
   * and no other map reads it, so without the map it would be taken in place. `edit` makes the
   * team's copy its own first, so it is offered.
   */
  async function mappedTeam(label: string, edit: boolean) {
    const t = await presetsTeam(h, label);
    const theirs = noteTypesApi(t.teamId, t.admin);
    const presets = presetsApi(h, t.teamId, t.admin);
    if (edit) {
      const row = await rowOf('wound_care', theirs);
      expect(
        (
          await theirs.publish('wound_care', row.version, [
            { op: 'rename_type', title: 'Demo: Wound care, ours' },
          ])
        ).status,
      ).toBe(200);
    }
    const item = Object.entries(t.ids).find(([k]) => k.startsWith('item.'))![1];
    const made = await presets.create('field_supply_map', {
      name: 'Demo: Dressing for slough',
      noteTypeKey: 'wound_care',
      path: 'wound.bed',
      when: { includes: 'slough' },
      lines: [{ itemId: item, qty: 1 }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const next = await platformNext('wound_care', (d) => {
      const marked = structuredClone(d);
      const bed = marked.sections[0]!.fields.find((f) => f.id === 'bed') as { options: Option[] };
      bed.options = bed.options.map((o) => (o.code === 'slough' ? { ...o, sensitiveExam: true } : o));
      return marked;
    });
    const unrelease = release(next);
    return { t, theirs, presets, next, unrelease, map: { id: made.body.id as string, version: 1 } };
  }
  const listed = async (t: PresetsTeam) => {
    const r = await call(h, '/v1/forms/note-types', { token: await tokenOf(h, t.admin), teamId: t.teamId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body.noteTypes as { key: string; version: number }[]).find((n) => n.key === 'wound_care')!;
  };

  it('is only offered by the installer while the map is active, and taken in place once it is removed', async () => {
    const { t, theirs, presets, next, unrelease, map } = await mappedTeam('Note Types Map Held Back', false);
    try {
      expect(await listed(t)).toMatchObject({ version: 1 });
      expect(await headOf(t.teamId, 'wound_care')).toMatchObject({
        currentVersion: 1,
        platformLatest: next.version,
        customized: false,
      });
      expect((await rowOf('wound_care', theirs)).update).toMatchObject({ platformVersion: next.version });
      expect((await presets.archive('field_supply_map', map.id, map.version)).status).toBe(200);
      expect(await listed(t)).toMatchObject({ version: 2 });
      const { definition } = await storedAs('wound_care', 2, t.teamId);
      expect(fieldOf(definition, 'wound.bed').options!.find((o) => o.code === 'slough')).toMatchObject({
        sensitiveExam: true,
      });
    } finally {
      unrelease();
    }
  });

  it('is not taken in place while the map is active, writing nothing, and is once it is removed', async () => {
    const { t, theirs, presets, next, unrelease, map } = await mappedTeam('Note Types Map Take', true);
    try {
      await listed(t);
      const row = await rowOf('wound_care', theirs);
      const take = () =>
        theirs.takeUpdate('wound_care', {
          baseVersion: row.version,
          platformVersion: next.version,
          asNew: false,
        });
      expect(await refusedUnwritten(take, 409, 'sensitive_path', t.teamId)).toEqual({
        referencedBy: { field_supply_map: 1 },
      });
      expect((await presets.archive('field_supply_map', map.id, map.version)).status).toBe(200);
      const taken = await take();
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);
      expect(taken.body).toMatchObject({ key: 'wound_care', version: row.version + 1 });
    } finally {
      unrelease();
    }
  });
});

describe('every note type write', () => {
  /** Each write route, on a note type made for it, as a sign-in made just now carries it out. */
  async function writes(): Promise<[string, 'POST' | 'PUT', string, Json, number][]> {
    const made = async (title: string) =>
      (await api.create({ title, kinds: ['non_medical'], group: 'outreach' })).body.key as string;
    const edit = await made(`Demo: Written ${randomUUID().slice(0, 6)}`);
    const remove = await made(`Demo: Removed ${randomUUID().slice(0, 6)}`);
    const back = await made(`Demo: Restored ${randomUUID().slice(0, 6)}`);
    expect((await api.archive(back, 1)).status).toBe(200);
    return [
      [
        'POST /v1/admin/note-types',
        'POST',
        '/v1/admin/note-types',
        { title: `Demo: Added ${randomUUID().slice(0, 6)}`, kinds: ['medical'], group: 'clinical' },
        201,
      ],
      [
        'PUT /v1/admin/note-types/{key}',
        'PUT',
        `/v1/admin/note-types/${edit}`,
        { baseVersion: 1, ops: [{ op: 'rename_type', title: 'Demo: Renamed' }] },
        200,
      ],
      [
        'POST /v1/admin/note-types/{key}/archive',
        'POST',
        `/v1/admin/note-types/${remove}/archive`,
        { baseVersion: 1 },
        200,
      ],
      ['POST /v1/admin/note-types/{key}/restore', 'POST', `/v1/admin/note-types/${back}/restore`, {}, 200],
    ];
  }

  it('asks for a reason of 3 to 300 characters, and refuses one left out or too short before anything is written', async () => {
    for (const [name, method, path, body] of await writes())
      for (const reason of [undefined, '  ', 'ab', 'x'.repeat(301)]) {
        const details = await refusedUnwritten(
          () => api.send(method, path, reason === undefined ? body : { ...body, reason }),
          422,
          'validation_failed',
        );
        expect(JSON.stringify(details.fields), `${name}: ${reason}`).toContain('reason');
      }
  });

  it('asks for a recent sign-in: a stale one is refused reauth_required, written nowhere, then done with a fresh one', async () => {
    const stale = noteTypesApi(team.teamId, team.admin, {
      token: await tokenOf(h, team.admin, STALE_MINUTES),
    });
    for (const [name, method, path, body, done] of await writes()) {
      const mark = await auditMark(h);
      await refusedUnwritten(
        () => stale.send(method, path, { ...body, reason: REASON }),
        403,
        'reauth_required',
      );
      expect(await auditAfter(h, mark), name).toEqual([]);
      const r = await api.send(method, path, { ...body, reason: REASON });
      expect(r.status, `${name}: ${JSON.stringify(r.body)}`).toBe(done);
    }
  });

  it('is refused to a member without team.manage_presets, logged once, and writes nothing else', async () => {
    const writer = await memberOf(
      h,
      team.teamId,
      ['patients.view', 'encounters.chart'],
      'Note Types Clinician',
    );
    const them = noteTypesApi(team.teamId, writer);
    for (const [name, method, path, body] of await writes()) {
      const before = await footprint(team.teamId);
      const mark = await auditMark(h);
      refused(await them.send(method, path, { ...body, reason: REASON }), 403, 'forbidden');
      expect(
        (await auditAfter(h, mark)).map((e) => [e.action, e.details.permission]),
        name,
      ).toEqual([['access.denied', 'team.manage_presets']]);
      expect({ ...(await footprint(team.teamId)), audit: before.audit }, name).toEqual(before);
    }
  });

  it('keeps the reason in the history, never in an audit event', async () => {
    const reason = 'Demo: the team asked for a quieter form';
    const made = await api.create({
      title: `Demo: Reason kept ${randomUUID().slice(0, 6)}`,
      kinds: ['non_medical'],
      group: 'outreach',
      reason,
    });
    expect(made.status).toBe(201);
    const key = made.body.key as string;
    expect((await eventsOf(team.teamId, key)).map((e) => e.reason)).toEqual([reason]);
    const [event] = await h.scratch.owner<{ details: unknown }[]>`
      select details from sineobex.audit_events where action = 'note_type.created' and entity_id = ${key}`;
    expect(JSON.stringify(event!.details)).not.toContain('quieter');
  });
});

// ------------------------------------------------------------------------------------------------
// The history (design 8.1, as a preset's)
// ------------------------------------------------------------------------------------------------

describe('GET /v1/admin/note-types/{key}/history', () => {
  interface Event {
    act: string;
    version: number;
    source: 'team' | 'platform';
    by: { userId: string; displayName: string } | null;
    at: string;
    reason: string | null;
  }
  const historyOf = (key: string, a = api) => a.send('GET', `/v1/admin/note-types/${key}/history`);

  it('lists every act on a note type of the team’s own, oldest first, with who, whose version and why', async () => {
    const t = await presetsTeam(h, 'Note Types History');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const made = await theirs.create({
      title: 'Demo: Kept in the history',
      kinds: ['non_medical'],
      group: 'outreach',
    });
    const key = made.body.key as string;
    expect(
      (
        await theirs.publish(
          key,
          1,
          [{ op: 'rename_type', title: 'Demo: Kept, renamed' }],
          'Demo: plainer words',
        )
      ).status,
    ).toBe(200);
    expect((await theirs.archive(key, 2, 'Demo: not used now')).status).toBe(200);
    expect((await theirs.restore(key, 'Demo: wanted back')).status).toBe(200);
    const mark = await auditMark(h);
    const r = await historyOf(key, theirs);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const by = { userId: t.admin.userId, displayName: t.admin.displayName };
    const events = r.body as unknown as Event[];
    expect(events.map(({ at: _at, ...e }) => e)).toEqual([
      { act: 'created', version: 1, source: 'team', by, reason: REASON },
      { act: 'updated', version: 2, source: 'team', by, reason: 'Demo: plainer words' },
      { act: 'archived', version: 2, source: 'team', by, reason: 'Demo: not used now' },
      { act: 'restored', version: 2, source: 'team', by, reason: 'Demo: wanted back' },
    ]);
    for (const e of events) expect(Number.isNaN(Date.parse(e.at)), e.at).toBe(false);
    // Reading it is not audited (PL-13), and the reasons it shows are in no audit event (design 9).
    expect(await auditAfter(h, mark)).toEqual([]);
    const audited = await h.scratch.owner<{ details: unknown }[]>`
      select details from sineobex.audit_events where team_id = ${t.teamId} and entity = 'note_type'`;
    expect(JSON.stringify(audited)).not.toMatch(/plainer words|not used now|wanted back/);
  });

  it('names the platform as the installer of its note types, and a person who takes its update', async () => {
    const t = await presetsTeam(h, 'Note Types History Platform');
    const theirs = noteTypesApi(t.teamId, t.admin);
    const installed = await historyOf('outreach', theirs);
    expect(installed.status, JSON.stringify(installed.body)).toBe(200);
    expect((installed.body as unknown as Event[]).map(({ at: _at, ...e }) => e)).toEqual([
      { act: 'installed', version: 1, source: 'platform', by: null, reason: null },
    ]);
    const row = await rowOf('psychological', theirs);
    expect(
      (await theirs.publish('psychological', row.version, [{ op: 'rename_type', title: 'Demo: Ours now' }]))
        .status,
    ).toBe(200);
    const next = await platformNext('psychological', (d) => ({ ...d, title: `${d.title}, again` }));
    const unrelease = release(next);
    try {
      const listed = await call(h, '/v1/forms/note-types', {
        token: await tokenOf(h, t.admin),
        teamId: t.teamId,
      });
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const offered = await rowOf('psychological', theirs);
      const taken = await theirs.takeUpdate('psychological', {
        baseVersion: offered.version,
        platformVersion: next.version,
        asNew: false,
      });
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);
      const r = await historyOf('psychological', theirs);
      const by = { userId: t.admin.userId, displayName: t.admin.displayName };
      expect((r.body as unknown as Event[]).map(({ at: _at, ...e }) => e)).toEqual([
        { act: 'installed', version: 1, source: 'platform', by: null, reason: null },
        { act: 'updated', version: 2, source: 'team', by, reason: REASON },
        { act: 'update_taken', version: 3, source: 'platform', by, reason: REASON },
      ]);
    } finally {
      unrelease();
    }
  });

  it('answers 404 for a key the team holds no note type of, another team’s own among them', async () => {
    const theirs = noteTypesApi(other.teamId, other.admin);
    const made = await theirs.create({ title: 'Demo: Theirs alone', kinds: ['medical'], group: 'clinical' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    refused(await historyOf(made.body.key as string), 404, 'not_found');
    refused(await historyOf('no_such_type'), 404, 'not_found');
    refused(await historyOf('Not A Key'), 422, 'validation_failed');
  });

  it('is refused to a member without team.manage_presets, and logged', async () => {
    const writer = await memberOf(
      h,
      team.teamId,
      ['patients.view', 'encounters.chart'],
      'Note Types History Reader',
    );
    const mark = await auditMark(h);
    refused(await historyOf('outreach', noteTypesApi(team.teamId, writer)), 403, 'forbidden');
    expect((await auditAfter(h, mark)).map((e) => [e.action, e.details.permission])).toEqual([
      ['access.denied', 'team.manage_presets'],
    ]);
  });
});
