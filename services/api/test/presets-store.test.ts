import { PLATFORM, presetWriteEffect, type PlatformEntry, type PresetHeadAfter } from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TeamScope } from '../src/auth/context.ts';
import { ApiError } from '../src/lib/errors.ts';
import { silentLogger } from '../src/lib/log.ts';
import {
  archivePreset,
  createPreset,
  editPreset,
  reorderFlags,
  restorePreset,
  takePlatformUpdate,
  type PresetWriteScope,
} from '../src/presets/store.ts';
import type { Deps } from '../src/types.ts';
import { createHarness, TEST_ISSUER, type Harness } from './harness.ts';
import { createTeam, expectAuditClean } from './patient-fixtures.ts';
import {
  auditAfter,
  auditMark,
  bodies,
  eventsOf,
  expectNothingWritten,
  footprint,
  headOf,
  idOf,
  memberOf,
  nextVersion,
  presetsApi,
  presetsTeam,
  releasePlatform,
  revisionOf,
  runInstaller,
  stateOf,
  versionsOf,
  whileLocked,
  type Answer,
  type Body,
  type ListedFlag,
  type Person,
  type PresetsTeam,
} from './presets-fixtures.ts';

// The preset store's own rules (phase 5 design 4.2, 5.1, 7, 9; card P1-store), held on the store
// itself, so they hold whichever route calls it: presets-routes, presets-revision, presets-audit and
// presets-refs hold the same through the routes. The store is called here with a team scope made
// by hand, as teamScope makes one for a member whose role holds team.manage_presets, signed in
// `minutesAgo` before the harness clock. Its last case holds the pull (card P1-pull) of a team the
// platform has given nothing, which presets-pull.test.ts, holding the real platform, cannot reach.

// This file's platform is its own copy, so a platform update can be released into it, or the
// platform emptied.
vi.mock('../../../packages/presets/data/platform.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});

// presetWriteEffect is the real one, unless a case answers for it once: so a case can show that the
// store writes what the effect answers (design 13.3), which no real answer tells apart.
vi.mock('@sineobex/presets', async (importOriginal) => {
  const real = (await importOriginal()) as { presetWriteEffect: typeof presetWriteEffect };
  return { ...real, presetWriteEffect: vi.fn(real.presetWriteEffect) };
});

let h: Harness;
let team: PresetsTeam;
let make: ReturnType<typeof bodies>;

beforeAll(async () => {
  h = await createHarness();
  team = await presetsTeam(h, 'Store');
  make = bodies(team);
});
afterAll(() => h?.close());

const REASON = 'Demo: the store was asked for this';

function scopeOf(who: Person, minutesAgo = 0): PresetWriteScope {
  const deps: Deps = {
    config: h.config,
    db: h.db,
    verifier: {
      verify: () => Promise.reject(new Error('no token is verified here')),
    },
    identityAdmin: h.identityAdmin,
    log: silentLogger,
    now: () => h.clock.now,
  };
  const authTime = new Date(h.clock.now.getTime() - minutesAgo * 60_000);
  return new TeamScope(
    deps,
    {
      userId: who.userId,
      email: who.email,
      displayName: who.displayName,
      isOwner: false,
      token: {
        issuer: TEST_ISSUER,
        subject: `store|${who.email}`,
        email: who.email,
        emailVerified: true,
        aal: 'aal2',
        sessionId: null,
        authTime,
        expiresAt: new Date(h.clock.now.getTime() + 3_600_000),
      },
    },
    {
      teamId: team.teamId,
      teamName: 'Demo Store team',
      teamSettings: {},
      membershipId: '00000000-0000-4000-8000-000000000001',
      roleId: '00000000-0000-4000-8000-000000000002',
      roleKey: 'program_admin',
      roleName: 'Program Admin',
      permissions: new Set(['team.manage_presets']),
      credential: 'none',
      credentialFields: {},
    },
    { requestId: 'presets-store-test', ip: null, deviceId: null },
  ) as PresetWriteScope;
}
const admin = () => scopeOf(team.admin);

/** The refusal an act answered: its status and code, and its details. */
async function refused(act: Promise<unknown>): Promise<{ status: number; code: string; details: Body }> {
  const err = await act.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`expected a refusal, got ${String(err)}`);
  return { status: err.status, code: err.code, details: (err.details ?? {}) as Body };
}

const currentBody = async (id: string) => {
  const head = await headOf(h, id);
  return (await versionsOf(h, id)).find((v) => v.version === head!.currentVersion)!.body;
};

describe('every act takes the team lock first, then one revision (design 4.2)', () => {
  it('waits for the team lock before it reads or writes any table', async () => {
    const body = make.flag();
    const { id } = await createPreset(admin(), { kind: 'flag', body, reason: REASON });
    const gone = await createPreset(admin(), { kind: 'flag', body: make.flag(), reason: REASON });
    await archivePreset(admin(), { kind: 'flag', id: gone.id, baseVersion: 1, reason: REASON });
    const doomed = await createPreset(admin(), { kind: 'flag', body: make.flag(), reason: REASON });
    const tier = await listedFlags('primary');
    const acts: [string, () => Promise<unknown>][] = [
      ['create', () => createPreset(admin(), { kind: 'flag', body: make.flag(), reason: REASON })],
      [
        'edit',
        () =>
          editPreset(admin(), {
            kind: 'flag',
            id,
            baseVersion: 1,
            body: { ...body, criteria: 'Demo: edited under the lock' },
            reason: REASON,
          }),
      ],
      [
        'archive',
        () => archivePreset(admin(), { kind: 'flag', id: doomed.id, baseVersion: 1, reason: REASON }),
      ],
      ['restore', () => restorePreset(admin(), { kind: 'flag', id: gone.id, reason: REASON })],
      [
        // Refused once it holds the lock: no update is on offer.
        'take-update',
        () =>
          takePlatformUpdate(admin(), {
            kind: 'flag',
            id: idOf(team, 'flag.high'),
            baseVersion: 1,
            platformVersion: 1,
            asNew: false,
            reason: REASON,
          }).catch((e: unknown) => e),
      ],
      [
        'reorder',
        () => reorderFlags(admin(), { tier: 'primary', flags: [...tier].reverse(), reason: REASON }),
      ],
    ];
    for (const [name, act] of acts) {
      const { waited, relations } = await whileLocked(h, team.teamId, act);
      expect(waited, `${name} waits for the team lock`).toBe(true);
      expect(relations, `${name} touched no table before the team lock`).toEqual([]);
    }
  });

  it('takes one revision and stamps with it every head it touches, and only those', async () => {
    const body = make.bag();
    const r0 = await revisionOf(h, team.teamId);
    const made = await createPreset(admin(), { kind: 'bag', body, reason: REASON });
    expect(made).toEqual({ id: made.id, version: 1, revision: r0 + 1 });
    const edited = await editPreset(admin(), {
      kind: 'bag',
      id: made.id,
      baseVersion: 1,
      body: { ...body, minimums: [] },
      reason: REASON,
    });
    expect(edited).toEqual({ version: 2, revision: r0 + 2 });
    expect(
      await archivePreset(admin(), { kind: 'bag', id: made.id, baseVersion: 2, reason: REASON }),
    ).toEqual({
      revision: r0 + 3,
    });
    const before = await footprint(h, team.teamId);
    expect(await restorePreset(admin(), { kind: 'bag', id: made.id, reason: REASON })).toEqual({
      revision: r0 + 4,
    });
    const after = await footprint(h, team.teamId);
    expect(after.revision).toBe(r0 + 4);
    const changed = after.heads.filter(
      (x) => JSON.stringify(x) !== JSON.stringify(before.heads.find((b) => b.id === x.id)),
    );
    expect(changed.map((x) => [x.id, x.revision])).toEqual([[made.id, r0 + 4]]);
  });

  it('restores a preset at the version it is at, made the team’s own', async () => {
    const body = make.flag();
    const { id } = await createPreset(admin(), { kind: 'flag', body, reason: REASON });
    await editPreset(admin(), {
      kind: 'flag',
      id,
      baseVersion: 1,
      body: { ...body, rank: 61 },
      reason: REASON,
    });
    await archivePreset(admin(), { kind: 'flag', id, baseVersion: 2, reason: REASON });
    await restorePreset(admin(), { kind: 'flag', id, reason: REASON });
    expect(await headOf(h, id)).toMatchObject({ state: 'active', currentVersion: 2, customized: true });
    expect((await eventsOf(h, id)).map((e) => [e.act, e.version])).toEqual([
      ['created', 1],
      ['updated', 2],
      ['archived', 2],
      ['restored', 2],
    ]);
  });
});

describe('a refusal writes nothing and takes no revision (design 5.1)', () => {
  it('for each refusal the store answers, before anything is written', async () => {
    const body = make.flag();
    const { id } = await createPreset(admin(), { kind: 'flag', body, reason: REASON });
    const settings = idOf(team, 'settings.team');
    const cases: [string, () => Promise<unknown>, number, string][] = [
      [
        'stale',
        () =>
          editPreset(admin(), {
            kind: 'flag',
            id,
            baseVersion: 2,
            body: { ...body, rank: 1 },
            reason: REASON,
          }),
        409,
        'stale',
      ],
      [
        'name taken',
        () =>
          createPreset(admin(), { kind: 'flag', body: { ...make.flag(), name: body.name }, reason: REASON }),
        409,
        'name_taken',
      ],
      [
        'invalid body',
        () =>
          createPreset(admin(), { kind: 'flag', body: { ...make.flag(), color: 'nope' }, reason: REASON }),
        422,
        'invalid',
      ],
      [
        'unstorable body',
        () =>
          createPreset(admin(), {
            kind: 'flag',
            body: make.flag({ criteria: 'Demo: a\u0000b' }),
            reason: REASON,
          }),
        422,
        'invalid',
      ],
      [
        'bad reason',
        () => createPreset(admin(), { kind: 'flag', body: make.flag(), reason: '  ab  ' }),
        422,
        'validation_failed',
      ],
      [
        'referenced',
        () =>
          archivePreset(admin(), {
            kind: 'item',
            id: idOf(team, 'item.gauze'),
            baseVersion: 1,
            reason: REASON,
          }),
        409,
        'referenced',
      ],
      [
        'not removable',
        () => archivePreset(admin(), { kind: 'settings', id: settings, baseVersion: 1, reason: REASON }),
        409,
        'not_removable',
      ],
      [
        'no change',
        () => editPreset(admin(), { kind: 'flag', id, baseVersion: 1, body, reason: REASON }),
        422,
        'no_change',
      ],
      [
        'ids mismatch',
        () => reorderFlags(admin(), { tier: 'primary', flags: [{ id, baseVersion: 1 }], reason: REASON }),
        422,
        'ids_mismatch',
      ],
      [
        'stale order',
        async () =>
          reorderFlags(admin(), {
            tier: 'primary',
            // Each at a version it has not reached: the list it was made from is not the tier's now.
            flags: (await listedFlags('primary')).map((f) => ({ ...f, baseVersion: f.baseVersion + 1 })),
            reason: REASON,
          }),
        409,
        'stale',
      ],
      [
        'not found',
        () => editPreset(admin(), { kind: 'bag', id, baseVersion: 1, body, reason: REASON }),
        404,
        'not_found',
      ],
    ];
    for (const [name, act, status, code] of cases) {
      const before = await footprint(h, team.teamId);
      const r = await refused(act());
      expect([r.status, r.code], name).toEqual([status, code]);
      await expectNothingWritten(h, team.teamId, before);
    }
  });

  it('asks for a recent sign-in itself, whatever scope it is handed: nothing written, nothing logged', async () => {
    const stale = scopeOf(team.admin, 16);
    const before = await footprint(h, team.teamId);
    const r = await refused(createPreset(stale, { kind: 'flag', body: make.flag(), reason: REASON }));
    expect([r.status, r.code]).toEqual([403, 'reauth_required']);
    await expectNothingWritten(h, team.teamId, before);
    // Fourteen minutes is recent.
    await createPreset(scopeOf(team.admin, 14), { kind: 'flag', body: make.flag(), reason: REASON });
  });
});

describe('its audit events and its reason (design 7, 9)', () => {
  it('keeps the reason trimmed in the act’s event, by the person, and audits field names only', async () => {
    const body = make.flag({ criteria: 'Demo: store criteria' });
    const mark = await auditMark(h);
    const { id, revision } = await createPreset(admin(), {
      kind: 'flag',
      body,
      reason: '   Demo: a store reason, padded   ',
    });
    expect(await eventsOf(h, id)).toEqual([
      { act: 'created', version: 1, reason: 'Demo: a store reason, padded', createdBy: team.admin.userId },
    ]);
    const events = await auditAfter(h, mark);
    expect(events).toEqual([
      expect.objectContaining({
        teamId: team.teamId,
        action: 'preset.created',
        actorUserId: team.admin.userId,
        entity: 'preset',
        entityId: id,
        details: { kind: 'flag', version: 1, revision, fields: Object.keys(body).sort() },
      }),
    ]);
    await expectAuditClean(h, ['Demo: a store reason', 'Demo: store criteria', String(body.name)], mark);
  });

  it('is undone whole when its audit event cannot be written', async () => {
    await h.scratch.owner.unsafe(`
      create function sineobex.test_fail_store_audit() returns trigger language plpgsql as $$
      begin
        if new.action like 'preset.%' then raise exception 'refused for the test'; end if;
        return new;
      end $$;
      create trigger test_fail_store_audit before insert on sineobex.audit_events
        for each row execute function sineobex.test_fail_store_audit()`);
    try {
      const before = await footprint(h, team.teamId);
      await expect(
        createPreset(admin(), { kind: 'flag', body: make.flag(), reason: REASON }),
      ).rejects.toThrow();
      await expectNothingWritten(h, team.teamId, before);
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_fail_store_audit on sineobex.audit_events;
        drop function sineobex.test_fail_store_audit()`);
    }
  });
});

describe('taking a platform update (design 5.1)', () => {
  it('writes the platform’s version, by nobody, while its event names the person and the reason', async () => {
    const id = idOf(team, 'flag.frost_risk');
    const own = await currentBody(id);
    await editPreset(admin(), {
      kind: 'flag',
      id,
      baseVersion: 1,
      body: { ...own, criteria: 'Demo: the team’s own criteria' },
      reason: REASON,
    });
    const unrelease = releasePlatform([
      nextVersion('flag.frost_risk', (b) => ({ ...b, criteria: 'Demo: the platform’s criteria' })),
    ]);
    try {
      await runInstaller(h, team.teamId);
      const taken = await takePlatformUpdate(admin(), {
        kind: 'flag',
        id,
        baseVersion: 2,
        platformVersion: 2,
        asNew: false,
        reason: REASON,
      });
      expect(taken).toMatchObject({ id, version: 3 });
      expect((await versionsOf(h, id)).at(-1)).toMatchObject({
        version: 3,
        source: 'platform',
        createdBy: null,
        body: { criteria: 'Demo: the platform’s criteria' },
      });
      expect((await eventsOf(h, id)).at(-1)).toEqual({
        act: 'update_taken',
        version: 3,
        reason: REASON,
        createdBy: team.admin.userId,
      });
      expect(await headOf(h, id)).toMatchObject({ customized: false, originVersion: 2, platformLatest: 2 });
    } finally {
      unrelease();
    }
  });

  it('as a new preset: the old one is archived and no longer the platform’s, the new one takes its key', async () => {
    const id = idOf(team, 'flag.dehydration_risk');
    const own = await currentBody(id);
    await editPreset(admin(), {
      kind: 'flag',
      id,
      baseVersion: 1,
      body: { ...own, criteria: 'Demo: the team’s criteria' },
      reason: REASON,
    });
    const unrelease = releasePlatform([
      nextVersion('flag.dehydration_risk', (b) => ({ ...b, color: 'teal' })),
    ]);
    try {
      await runInstaller(h, team.teamId);
      const taken = await takePlatformUpdate(admin(), {
        kind: 'flag',
        id,
        baseVersion: 2,
        platformVersion: 2,
        asNew: true,
        reason: REASON,
      });
      expect(taken.version).toBe(1);
      expect(await headOf(h, id)).toMatchObject({ state: 'archived', originKey: null, customized: true });
      expect(await headOf(h, taken.id)).toMatchObject({
        state: 'active',
        originKey: 'flag.dehydration_risk',
        originVersion: 2,
        revision: taken.revision,
        createdBy: team.admin.userId,
      });
      expect((await headOf(h, id))!.revision).toBe(taken.revision);
      expect((await eventsOf(h, id)).at(-1)).toMatchObject({ act: 'archived', version: 2 });
      expect(await versionsOf(h, taken.id)).toEqual([
        expect.objectContaining({ version: 1, source: 'platform', createdBy: null }),
      ]);
    } finally {
      unrelease();
    }
  });
});

/** Answers once as the real effect would, its head after the act changed by `change`. */
const answerOnce = (change: (answer: PresetHeadAfter & { created?: PresetHeadAfter }) => object) => {
  const effect = vi.mocked(presetWriteEffect);
  const real = effect.getMockImplementation()!;
  effect.mockImplementationOnce((input) => {
    const answer = real(input);
    return 'refuse' in answer ? answer : ({ ...answer, ...change(answer) } as typeof answer);
  });
};

describe('a tier’s flag order (design 5.1)', () => {
  it('gives only the flags whose rank changes their next version, and writes nothing for an order as it is', async () => {
    const tier = await listedFlags('secondary');
    const ranks = await Promise.all(tier.map(async (f) => (await currentBody(f.id)).rank as number));
    const r0 = await revisionOf(h, team.teamId);
    const order = [...tier].reverse();
    const { changed } = await reorderFlags(admin(), { tier: 'secondary', flags: order, reason: REASON });
    const moved = order.filter((f, i) => ranks[tier.indexOf(f)] !== (i + 1) * 10);
    expect(changed).toBe(moved.length);
    expect(await revisionOf(h, team.teamId)).toBe(r0 + 1);
    for (const f of moved)
      expect(await headOf(h, f.id)).toMatchObject({
        currentVersion: f.baseVersion + 1,
        revision: r0 + 1,
        customized: true,
      });
    // Sent again from the same list, the order is stale: the flags it moved are at their next
    // version. It names each of them, in the order sent, and writes nothing.
    const before = await footprint(h, team.teamId);
    const stale = await refused(reorderFlags(admin(), { tier: 'secondary', flags: order, reason: REASON }));
    expect(stale).toMatchObject({ status: 409, code: 'stale' });
    expect(stale.details).toEqual({
      flags: moved.map((f) => ({ id: f.id, currentVersion: f.baseVersion + 1 })),
    });
    await expectNothingWritten(h, team.teamId, before);
    // From a list loaded now, the order as it is moves none and writes nothing.
    const relisted = await listedFlags('secondary');
    expect(relisted.map((f) => f.id)).toEqual(order.map((f) => f.id));
    expect(await reorderFlags(admin(), { tier: 'secondary', flags: relisted, reason: REASON })).toEqual({
      changed: 0,
    });
    await expectNothingWritten(h, team.teamId, before);
  });

  it('writes each flag it moves as presetWriteEffect answers it for that flag (design 13.3)', async () => {
    // The tier as a reorder above left it, at 10, 20 and 30: reversed, the first and last move.
    const order = (await listedFlags('primary')).reverse();
    expect(order.length).toBe(3);
    const [first, middle, last] = order as [ListedFlag, ListedFlag, ListedFlag];
    // The effect is asked of each flag in the order sent; an answer no reorder gives today, for the
    // first only, so only a store that writes each flag's own answer shows it.
    answerOnce(() => ({ customizedAfter: false }));
    expect(await reorderFlags(admin(), { tier: 'primary', flags: order, reason: REASON })).toEqual({
      changed: 2,
    });
    expect(await headOf(h, first.id)).toMatchObject({
      currentVersion: first.baseVersion + 1,
      customized: false,
    });
    expect(await headOf(h, last.id)).toMatchObject({
      currentVersion: last.baseVersion + 1,
      customized: true,
    });
    expect((await headOf(h, middle.id))!.currentVersion).toBe(middle.baseVersion);
  });
});

describe('the pull of a team the platform has given nothing yet (routes/presets.ts)', () => {
  // A team with no state row has taken no revision, so it holds no preset and has no epoch of its
  // own; the pull reads, never writes one, and answers a fixed epoch that its first revision's
  // replaces, so the phone then starts over.
  const NO_EPOCH = '00000000-0000-0000-0000-000000000000';
  const pulled = (r: Answer) => {
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as unknown as { reset: boolean; revision: number; epoch: string; presets: unknown[] };
  };

  it('answers no preset at revision 0 under a fixed epoch, then a reset under the team’s own', async () => {
    const teamId = await createTeam(h, 'Demo Store Unwritten Team');
    const api = presetsApi(h, teamId, await memberOf(h, teamId, [], 'Store Unwritten'));
    const platform = PLATFORM as PlatformEntry[];
    const held = platform.splice(0);
    let first: ReturnType<typeof pulled>;
    try {
      first = pulled(await api.pull());
      expect(first).toEqual({ reset: true, revision: 0, epoch: NO_EPOCH, presets: [] });
      expect(pulled(await api.pull({ since: 0, epoch: NO_EPOCH }))).toEqual({ ...first, reset: false });
      expect(await stateOf(h, teamId)).toBeNull();
    } finally {
      platform.push(...held);
    }
    const second = pulled(await api.pull({ since: 0, epoch: NO_EPOCH }));
    expect(second.reset).toBe(true);
    expect(second.epoch).toBe((await stateOf(h, teamId))!.epoch);
    expect(second.epoch).not.toBe(NO_EPOCH);
    expect(second.presets.length).toBeGreaterThan(0);
  });
});

describe('a new preset, as presetWriteEffect answers it (design 5.1, 13.3)', () => {
  // The effect is the one authority on what an act does: the store writes its answer, never a value
  // of its own, so the store and the seed, the other writer of a team's own presets, never drift.
  it('takes a created head’s state, version and customized from the effect', async () => {
    // An answer no create gives today, so only a store that writes the effect's answer shows it.
    answerOnce(() => ({ stateAfter: 'archived', customizedAfter: true }));
    const made = await createPreset(admin(), { kind: 'flag', body: make.flag(), reason: REASON });
    expect(made.version).toBe(1);
    expect(await headOf(h, made.id)).toMatchObject({
      state: 'archived',
      currentVersion: 1,
      customized: true,
    });
  });

  it('takes the head of a preset an update makes as new from the effect’s `created`', async () => {
    // Edited, so its next platform version is only offered; the order above may have moved it.
    const id = idOf(team, 'flag.pregnancy');
    const own = await currentBody(id);
    const { version } = await editPreset(admin(), {
      kind: 'flag',
      id,
      baseVersion: (await headOf(h, id))!.currentVersion,
      body: { ...own, criteria: 'Demo: the team’s pregnancy criteria' },
      reason: REASON,
    });
    const unrelease = releasePlatform([nextVersion('flag.pregnancy', (b) => ({ ...b, color: 'teal' }))]);
    try {
      await runInstaller(h, team.teamId);
      answerOnce((answer) => ({ created: { ...answer.created!, customizedAfter: true } }));
      const taken = await takePlatformUpdate(admin(), {
        kind: 'flag',
        id,
        baseVersion: version,
        platformVersion: 2,
        asNew: true,
        reason: REASON,
      });
      expect(await headOf(h, taken.id)).toMatchObject({
        state: 'active',
        currentVersion: 1,
        customized: true,
        originKey: 'flag.pregnancy',
      });
    } finally {
      unrelease();
    }
  });
});

/** The team's active flags of a tier, by rank, each at its version: the list an order is made from. */
async function listedFlags(tier: 'primary' | 'secondary'): Promise<ListedFlag[]> {
  const rows = await h.scratch.owner<ListedFlag[]>`
    select p.id, p.current_version as "baseVersion" from sineobex.team_presets p
    join sineobex.team_preset_versions v on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${team.teamId} and p.kind = 'flag' and p.state = 'active' and v.body ->> 'tier' = ${tier}
    order by (v.body ->> 'rank')::int, p.id`;
  return rows.map((r) => ({ id: r.id, baseVersion: r.baseVersion }));
}
