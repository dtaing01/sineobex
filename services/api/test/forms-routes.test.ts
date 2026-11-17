import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@sineobex/forms';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixturePresets } from '../../../packages/forms/test/fixtures/presets.ts';
import type { TeamScope } from '../src/auth/context.ts';
import type { Tx } from '../src/db/database.ts';
import {
  DefinitionMismatch,
  definitionFor,
  listNoteTypes,
  MAX_DEFINITION_NAMES,
  MAX_DEFINITIONS,
} from '../src/forms/definitions.ts';
import { createHarness, type Harness } from './harness.ts';
import { auditMark, createTeam, expectAudit, logSpy, memberWith, type LogSpy } from './patient-fixtures.ts';

// Definitions on the server (phase 4 design, forms 3). The installer reads the made-up fixture
// note types here, whose fields these cases name; db/test/install-presets.test.ts installs the
// released ones.
// The factory imports the fixtures itself: it runs before this file's own imports are bound.
vi.mock('../../../packages/forms/generated/presets.json', async () => {
  const fixtures = await import('../../../packages/forms/test/fixtures/presets.ts');
  return { default: await fixtures.fixturePresets() };
});

type Json = Record<string, unknown>;

describe('a new team’s presets', () => {
  let h: Harness;
  let ownerToken: string;
  let presets: Awaited<ReturnType<typeof fixturePresets>>;

  const createTeam = async (name: string) => {
    const res = await h.request('/v1/owner/teams', { method: 'POST', token: ownerToken, json: { name } });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const installed = (teamId: string) =>
    h.scratch.owner<{ key: string; version: number; hash: string; origin: string; presetVersion: number }[]>`
      select key, version, hash, origin, preset_version as "presetVersion"
      from sineobex.note_type_versions where team_id = ${teamId} order by key, version`;

  beforeAll(async () => {
    presets = await fixturePresets();
    expect(presets.length).toBeGreaterThanOrEqual(2);
    h = await createHarness();
    await h.seedOwner('forms-owner@example.com', 'Forms Owner');
    ownerToken = await h.tokenFor('forms-owner@example.com');
  });
  afterAll(() => h.close());

  it('installs every preset when a team is created, and audits it in the team’s chain', async () => {
    const created = await createTeam('Demo Forms Team');
    expect(created.status).toBe(201);
    const teamId = created.body.id as string;
    expect(await installed(teamId)).toEqual(
      presets.map((p) => ({
        key: p.key,
        version: p.version,
        hash: p.hash,
        origin: 'preset',
        presetVersion: p.version,
      })),
    );
    const events = await h.scratch.owner<{ teamId: string | null; details: unknown }[]>`
      select team_id as "teamId", details from sineobex.audit_events
      where action = 'forms.presets_installed' and entity_id = ${teamId}`;
    expect(events).toEqual([
      { teamId, details: { installed: presets.map((p) => ({ key: p.key, version: p.version })) } },
    ]);
  });

  it('gives each team its own rows', async () => {
    const one = (await createTeam('Demo Forms Team One')).body.id as string;
    const two = (await createTeam('Demo Forms Team Two')).body.id as string;
    const rows = await h.scratch.owner<{ teamId: string; count: number }[]>`
      select team_id as "teamId", count(*)::int as count from sineobex.note_type_versions
      where team_id in (${one}, ${two}) group by team_id order by 1`;
    expect(rows.map((r) => r.count)).toEqual([presets.length, presets.length]);
  });

  it('creates no team when its presets cannot be installed: one transaction', async () => {
    // A hash 0017 refuses fails the install, and with it the team, its role and its audit events.
    const { PRESETS } = await import('@sineobex/forms');
    expect(PRESETS).toEqual(presets);
    const first = PRESETS[0] as { hash: string };
    const count = async () =>
      (
        await h.scratch.owner<{ teams: number; events: number }[]>`
        select (select count(*)::int from sineobex.teams) as teams,
               (select count(*)::int from sineobex.audit_events) as events`
      )[0];
    const before = await count();
    const hash = first.hash;
    first.hash = 'not a hash';
    try {
      expect((await createTeam('Demo Forms Team Broken')).status).toBe(500);
    } finally {
      first.hash = hash;
    }
    expect(await count()).toEqual(before);
  });
});

/** What the list says about one version (forms 3.3). */
const entryOf = (p: Awaited<ReturnType<typeof fixturePresets>>[number]) => ({
  key: p.key,
  version: p.version,
  title: p.definition.title,
  kinds: p.definition.kinds,
  sensitivity: p.definition.sensitivity,
  quick: p.definition.quick === true,
  auto: p.definition.auto ?? null,
  hash: p.hash,
});

/** A row the test writes itself, as the owner: another version, or a team's own copy. */
async function insertRow(
  h: Harness,
  teamId: string,
  definition: Record<string, unknown>,
  origin: 'preset' | 'team',
): Promise<string> {
  const hash = await sha256Hex(canonicalJson(definition));
  await h.scratch.owner`
    insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
    values (${teamId}, ${definition.key as string}, ${definition.version as number},
            ${JSON.stringify(definition)}::text::jsonb, ${hash}, ${origin},
            ${origin === 'preset' ? (definition.version as number) : null})`;
  return hash;
}

describe('GET /v1/forms/note-types', () => {
  let h: Harness;
  let spy: LogSpy;
  let presets: Awaited<ReturnType<typeof fixturePresets>>;

  const list = async (token: string, teamId?: string) => {
    const res = await h.request('/v1/forms/note-types', { token, ...(teamId ? { teamId } : {}) });
    return { res, body: (await res.json()) as { noteTypes: Json[]; error?: { code: string } } };
  };
  const eventsAfter = (mark: string) =>
    h.scratch.owner<
      { action: string }[]
    >`select action from sineobex.audit_events where id > ${mark}::bigint`;

  beforeAll(async () => {
    presets = await fixturePresets();
    spy = logSpy();
    h = await createHarness({ log: spy.log });
  });
  afterAll(() => h.close());

  it('answers a member whose role holds no permission, installing the presets the first time', async () => {
    const teamId = await createTeam(h, 'Demo Forms List Team');
    const member = await memberWith(h, teamId, []);
    const mark = await auditMark(h);
    const first = await list(member.token, teamId);
    expect(first.res.status).toBe(200);
    expect(first.res.headers.get('cache-control')).toBe('no-store');
    expect(first.body).toEqual({ noteTypes: presets.map(entryOf) });

    // The install is audited in the team's chain, by the member whose request wrote it.
    const [event] = await expectAudit(h, 'forms.presets_installed', { after: mark, teamId, count: 1 });
    expect(event).toMatchObject({
      actorUserId: member.userId,
      entity: 'team',
      entityId: teamId,
      details: { installed: presets.map((p) => ({ key: p.key, version: p.version })) },
    });
    expect((await eventsAfter(mark)).map((e) => e.action)).toEqual(['forms.presets_installed']);

    // Nothing left to install: the same answer, and the list itself is never audited.
    const again = await auditMark(h);
    const second = await list(member.token, teamId);
    expect(second.res.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await eventsAfter(again)).toEqual([]);
  });

  it('lists each key’s newest version', async () => {
    const teamId = await createTeam(h, 'Demo Forms Versions Team');
    const member = await memberWith(h, teamId, ['patients.view']);
    expect((await list(member.token, teamId)).res.status).toBe(200);
    const [checks] = presets;
    // Version 2 is no longer the Quick encounter.
    const v2: Record<string, unknown> = {
      ...checks!.definition,
      version: 2,
      title: 'Checks, reworded (test)',
    };
    delete v2.quick;
    const hash = await insertRow(h, teamId, v2, 'team');
    const { body } = await list(member.token, teamId);
    expect(body.noteTypes).toEqual([
      { ...entryOf(checks!), version: 2, title: 'Checks, reworded (test)', quick: false, hash },
      ...presets.slice(1).map(entryOf),
    ]);
  });

  it('logs a held version that differs from its preset, skips that key and still answers', async () => {
    const teamId = await createTeam(h, 'Demo Forms Differs Team');
    const member = await memberWith(h, teamId, []);
    const [checks, ...rest] = presets;
    const edited = { ...checks!.definition, title: 'Checks, edited after release (test)' };
    const hash = await insertRow(h, teamId, edited, 'preset');
    const mark = await auditMark(h);
    const lines = spy.lines.length;

    const { res, body } = await list(member.token, teamId);
    expect(res.status).toBe(200);
    // The team keeps the row it holds; the other keys are installed.
    expect(body.noteTypes).toEqual([
      { ...entryOf(checks!), title: 'Checks, edited after release (test)', hash },
      ...rest.map(entryOf),
    ]);
    const [event] = await expectAudit(h, 'forms.presets_installed', { after: mark, teamId, count: 1 });
    expect(event!.details).toEqual({ installed: rest.map((p) => ({ key: p.key, version: p.version })) });
    const logged = spy.lines.slice(lines).map((l) => JSON.parse(l) as Json);
    expect(logged).toContainEqual(
      expect.objectContaining({ level: 'error', event: 'forms.preset_differs', teamId, count: 1 }),
    );
  });

  it('shows a team only its own rows', async () => {
    const mine = await createTeam(h, 'Demo Forms Own Team');
    const theirs = await createTeam(h, 'Demo Forms Other Team');
    const member = await memberWith(h, mine, []);
    const other = await memberWith(h, theirs, []);
    const [checks] = presets;
    await insertRow(
      h,
      theirs,
      { ...checks!.definition, key: 'demo_their_own', title: 'Theirs (test)' },
      'team',
    );

    const { body } = await list(member.token, mine);
    expect(body.noteTypes.map((e) => e.key)).toEqual(presets.map((p) => p.key));
    expect(body.noteTypes.map((e) => e.hash)).toEqual(presets.map((p) => p.hash));
    const read = await h.request('/v1/forms/note-types/demo_their_own/1', {
      token: member.token,
      teamId: mine,
    });
    expect(read.status).toBe(404);
    expect((await list(other.token, theirs)).body.noteTypes.map((e) => e.key)).toContain('demo_their_own');

    // Another team's ID in the header is refused, and installs nothing there.
    const before = await h.scratch.owner<{ count: number }[]>`
      select count(*)::int as count from sineobex.note_type_versions where team_id = ${theirs}`;
    const refused = await list(member.token, theirs);
    expect(refused.res.status).toBe(403);
    expect(refused.body.error?.code).toBe('not_a_member');
    const after = await h.scratch.owner<{ count: number }[]>`
      select count(*)::int as count from sineobex.note_type_versions where team_id = ${theirs}`;
    expect(after).toEqual(before);
  });

  it('names the team in its own query, not only through row-level security', async () => {
    // A platform-scope transaction reads every team's rows (0017's policy), so here only the
    // query's own team filter keeps the other team's key out.
    const mine = await createTeam(h, 'Demo Forms Filter Team');
    const theirs = await createTeam(h, 'Demo Forms Filter Other Team');
    const [checks] = presets;
    await insertRow(
      h,
      theirs,
      { ...checks!.definition, key: 'demo_their_own', title: 'Theirs (test)' },
      'team',
    );
    const scope = {
      team: { teamId: mine },
      meta: { requestId: 'demo-request' },
      deps: { log: spy.log },
      tx: <T>(fn: (tx: Tx, audit: (e: unknown) => Promise<void>) => Promise<T>) =>
        h.db.tx({ teamId: mine, platform: true }, (tx) => fn(tx, async () => {})),
    } as unknown as TeamScope;
    const listed = await listNoteTypes(scope);
    expect(listed.map((e) => e.key)).toEqual(presets.map((p) => p.key));
  });

  it('needs a team, and a sign-in', async () => {
    const teamId = await createTeam(h, 'Demo Forms Header Team');
    const member = await memberWith(h, teamId, []);
    expect((await list(member.token)).body.error?.code).toBe('team_required');
    expect((await h.request('/v1/forms/note-types', { teamId })).status).toBe(401);
  });
});

describe('GET /v1/forms/note-types/{key}/{version}', () => {
  let h: Harness;
  let presets: Awaited<ReturnType<typeof fixturePresets>>;
  let teamId: string;
  let token: string;

  beforeAll(async () => {
    presets = await fixturePresets();
    h = await createHarness();
    teamId = await createTeam(h, 'Demo Forms Definition Team');
    token = (await memberWith(h, teamId, [])).token;
    // The list installs the presets.
    expect((await h.request('/v1/forms/note-types', { token, teamId })).status).toBe(200);
  });
  afterAll(() => h.close());

  it('answers the resolved definition and its hash, private and kept for a long time, unaudited', async () => {
    for (const p of presets) {
      const mark = await auditMark(h);
      const res = await h.request(`/v1/forms/note-types/${p.key}/${p.version}`, { token, teamId });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { key: string; version: number; hash: string; definition: unknown };
      expect(body).toEqual({ key: p.key, version: p.version, hash: p.hash, definition: p.definition });
      expect(await sha256Hex(canonicalJson(body.definition))).toBe(body.hash);
      expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(res.headers.get('pragma')).toBeNull();
      expect(res.headers.get('vary')).toMatch(/X-Team-Id/i);
      expect(
        await h.scratch.owner`select 1 from sineobex.audit_events where id > ${mark}::bigint`,
      ).toHaveLength(0);
    }
  });

  it('answers not found for a version the team does not hold, and lets no one keep that', async () => {
    const res = await h.request(`/v1/forms/note-types/${presets[0]!.key}/99`, { token, teamId });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a key or a version that cannot name a row', async () => {
    for (const path of [
      'Bad-Key/1',
      'checks_demo/0',
      'checks_demo/abc',
      'checks_demo/1.5',
      'checks_demo/-1',
    ]) {
      const res = await h.request(`/v1/forms/note-types/${path}`, { token, teamId });
      expect(res.status, path).toBe(422);
      expect(res.headers.get('cache-control'), path).toBe('no-store');
    }
  });

  it('answers an error, never the definition, for a row whose hash is not its definition’s', async () => {
    // 0017 checks a hash's form and not what it hashes (forms 3.1); definitionFor checks it (D79).
    const [p] = presets;
    const forged = { ...p!.definition, version: 7, title: 'Checks, under a hash not its own (test)' };
    await h.scratch.owner`
      insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin)
      values (${teamId}, ${p!.key}, 7, ${JSON.stringify(forged)}::text::jsonb, ${p!.hash}, 'team')`;
    // Never kept either: the second request is refused as the first was.
    for (const attempt of [1, 2]) {
      const res = await h.request(`/v1/forms/note-types/${p!.key}/7`, { token, teamId });
      expect(res.status, `attempt ${attempt}`).toBe(500);
      expect(await res.text()).not.toContain('not its own');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('refuses someone outside the team', async () => {
    const elsewhere = await createTeam(h, 'Demo Forms Elsewhere Team');
    const outsider = await memberWith(h, elsewhere, []);
    const res = await h.request(`/v1/forms/note-types/${presets[0]!.key}/1`, {
      token: outsider.token,
      teamId,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the cache headers', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    // Added before the first request, while the router can still take a route.
    h.app.get('/v1/test-own-cache-control', (c) => {
      c.header('Cache-Control', 'private, max-age=60');
      return c.json({});
    });
  });
  afterAll(() => h.close());

  it('keeps no-store on any other response that sets its own Cache-Control', async () => {
    // Only the definition's exact header is let through (app.ts): a handler that sets some other
    // lifetime, on a response that may hold patient data, still gets no-store and Pragma.
    const res = await h.request('/v1/test-own-cache-control');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
  });
});

describe('definitionFor', () => {
  // A transaction that answers from a map and counts its reads.
  const fakeTx = (rows: Map<string, Json>) => {
    const tx = Object.assign(
      async (_t: TemplateStringsArray, ...values: unknown[]) => {
        tx.reads++;
        const row = rows.get(values.join('/'));
        return row ? [row] : [];
      },
      { reads: 0 },
    );
    return tx;
  };

  it('reads a row once and keeps it, since a row never changes', async () => {
    const [p] = await fixturePresets();
    const teamId = randomUUID();
    const tx = fakeTx(
      new Map([[`${teamId}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: p!.definition }]]),
    );
    const first = await definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version);
    const second = await definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version);
    expect(first).toEqual({ key: p!.key, version: p!.version, hash: p!.hash, definition: p!.definition });
    expect(second).toEqual(first);
    expect(tx.reads).toBe(1);
  });

  it('keeps each team’s rows apart', async () => {
    const [p] = await fixturePresets();
    const one = randomUUID();
    const two = randomUUID();
    const tx = fakeTx(
      new Map([[`${one}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: p!.definition }]]),
    );
    expect(await definitionFor(tx as unknown as Tx, one, p!.key, p!.version)).toBeDefined();
    expect(await definitionFor(tx as unknown as Tx, two, p!.key, p!.version)).toBeUndefined();
  });

  it('reads a missing row again: it may be installed later', async () => {
    const [p] = await fixturePresets();
    const teamId = randomUUID();
    const rows = new Map<string, Json>();
    const tx = fakeTx(rows);
    expect(await definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version)).toBeUndefined();
    rows.set(`${teamId}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: p!.definition });
    expect(await definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version)).toBeDefined();
    expect(tx.reads).toBe(2);
  });

  // D79 (forms 3.3): what definitionFor keeps, and the check of each row it reads.

  /** One version of the first fixture note type per number, each with the hash of its own definition. */
  const versions = async (count: number) => {
    const [p] = await fixturePresets();
    return Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const definition = { ...p!.definition, version: i + 1, title: `Checks ${i + 1} (test)` };
        return { key: p!.key, version: i + 1, hash: await sha256Hex(canonicalJson(definition)), definition };
      }),
    );
  };

  it('checks a row against its hash the first time it reads it: a row that fails is an error, never answered or kept', async () => {
    const [p] = await fixturePresets();
    const teamId = randomUUID();
    // The hash of another definition, as 0017 lets a row hold: it checks the hash's form only.
    const forged = { ...p!.definition, title: 'Checks, edited under the old hash (test)' };
    const tx = fakeTx(
      new Map([[`${teamId}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: forged }]]),
    );
    await expect(definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version)).rejects.toThrow(
      DefinitionMismatch,
    );
    await expect(definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version)).rejects.toThrow(
      DefinitionMismatch,
    );
    expect(tx.reads).toBe(2);
    // Nor is the right definition, kept under that hash for another team, answered for this row.
    const other = randomUUID();
    const good = fakeTx(
      new Map([[`${other}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: p!.definition }]]),
    );
    expect(await definitionFor(good as unknown as Tx, other, p!.key, p!.version)).toBeDefined();
    await expect(definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version)).rejects.toThrow(
      DefinitionMismatch,
    );
  });

  it('refuses a row filed under a key or version its definition does not hold, before or after its hash is kept', async () => {
    const [p] = await fixturePresets();
    const [one, two] = [randomUUID(), randomUUID()];
    // Its hash is its definition's; the row names another key and version (review finding NOT-8).
    const row = { hash: p!.hash, definition: p!.definition };
    const tx = fakeTx(
      new Map([
        [`${one}/${p!.key}/${p!.version}`, row],
        [`${two}/test_other/5`, row],
        [`${two}/${p!.key}/${p!.version + 1}`, row],
      ]),
    );
    await expect(definitionFor(tx as unknown as Tx, two, 'test_other', 5)).rejects.toThrow(
      DefinitionMismatch,
    );
    expect(await definitionFor(tx as unknown as Tx, one, p!.key, p!.version)).toMatchObject({ key: p!.key });
    await expect(definitionFor(tx as unknown as Tx, two, 'test_other', 5)).rejects.toThrow(
      DefinitionMismatch,
    );
    await expect(definitionFor(tx as unknown as Tx, two, p!.key, p!.version + 1)).rejects.toThrow(
      DefinitionMismatch,
    );
  });

  it('keeps one frozen copy per hash, shared by every team that holds it', async () => {
    const [p] = await fixturePresets();
    const [one, two] = [randomUUID(), randomUUID()];
    // Each team's row is its own object, as two reads of the database give.
    const tx = fakeTx(
      new Map([
        [`${one}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: structuredClone(p!.definition) }],
        [`${two}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: structuredClone(p!.definition) }],
      ]),
    );
    const first = await definitionFor(tx as unknown as Tx, one, p!.key, p!.version);
    const second = await definitionFor(tx as unknown as Tx, two, p!.key, p!.version);
    expect(second).toBe(first);
    expect(tx.reads).toBe(2);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.definition.sections[0]!.fields[0])).toBe(true);
    expect(() => {
      (first!.definition as { title: string }).title = 'Changed (test)';
    }).toThrow(TypeError);
  });

  it('keeps at most 64 definitions, and drops the one used least recently', async () => {
    expect(MAX_DEFINITIONS).toBe(64);
    const all = await versions(MAX_DEFINITIONS + 1);
    const teamId = randomUUID();
    const tx = fakeTx(new Map(all.map((v) => [`${teamId}/${v.key}/${v.version}`, v])));
    const read = (v: (typeof all)[number]) => definitionFor(tx as unknown as Tx, teamId, v.key, v.version);
    for (const v of all.slice(0, MAX_DEFINITIONS)) await read(v);
    expect(tx.reads).toBe(MAX_DEFINITIONS);
    // The first is used again, so the second is now the one used least recently.
    expect((await read(all[0]!))!.hash).toBe(all[0]!.hash);
    expect(tx.reads).toBe(MAX_DEFINITIONS);
    await read(all[MAX_DEFINITIONS]!);
    expect(tx.reads).toBe(MAX_DEFINITIONS + 1);
    await read(all[0]!);
    expect(tx.reads).toBe(MAX_DEFINITIONS + 1);
    // Its team, key and version are still mapped to its hash; the definition must be read again.
    expect((await read(all[1]!))!.hash).toBe(all[1]!.hash);
    expect(tx.reads).toBe(MAX_DEFINITIONS + 2);
  });

  it('maps at most 4,096 teams, keys and versions to a hash, and drops the one used least recently', async () => {
    expect(MAX_DEFINITION_NAMES).toBe(4096);
    const [p] = await fixturePresets();
    const teams = Array.from({ length: MAX_DEFINITION_NAMES + 1 }, () => randomUUID());
    const tx = fakeTx(
      new Map(
        teams.map((id) => [`${id}/${p!.key}/${p!.version}`, { hash: p!.hash, definition: p!.definition }]),
      ),
    );
    const read = (teamId: string) => definitionFor(tx as unknown as Tx, teamId, p!.key, p!.version);
    for (const id of teams.slice(0, MAX_DEFINITION_NAMES)) await read(id);
    expect(tx.reads).toBe(MAX_DEFINITION_NAMES);
    await read(teams[0]!);
    expect(tx.reads).toBe(MAX_DEFINITION_NAMES);
    await read(teams[MAX_DEFINITION_NAMES]!);
    expect(tx.reads).toBe(MAX_DEFINITION_NAMES + 1);
    await read(teams[0]!);
    expect(tx.reads).toBe(MAX_DEFINITION_NAMES + 1);
    expect(await read(teams[1]!)).toBeDefined();
    expect(tx.reads).toBe(MAX_DEFINITION_NAMES + 2);
  });
});
