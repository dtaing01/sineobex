import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PLATFORM, PRESET_KINDS, type PlatformEntry, type PresetKind } from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, type Permission } from '../src/auth/permissions.ts';
import { createHarness, type Harness } from './harness.ts';
import { createTeam, logSpy } from './patient-fixtures.ts';
import {
  archiveDirect,
  asWriter,
  auditAfter,
  auditMark,
  editDirect,
  errorOf,
  idOf,
  insertPreset,
  memberOf,
  presetsApi,
  presetsTeam,
  revisionOf,
  stateOf,
  whileLocked,
  type Answer,
  type Body,
  type PresetsTeam,
} from './presets-fixtures.ts';

// The phone's presets pull (phase 5 design 6.1, 7; D130), written before the route (card P1-pull)
// and held to these shapes, which the design leaves partly open and this file settles:
//
// GET /v1/presets?since=<revision>&epoch=<epoch>, for any active member of the team, whatever the
// role, a role with no permission included; nobody else (403 not_a_member, logged by teamScope).
// 200 {reset, revision, epoch, presets}:
//   - presets: [{id, kind, state, version, originKey, body}], each head of the eight kinds the phone
//     reads whose revision is above `since`, or every head when `since` is left out or the answer is
//     a reset; archived ones included; each at its current version, `body` that version's body as
//     stored, `originKey` null for a team's own. Never a kind outside the eight (phase 10's
//     billing_code_map), and never another team's. Sensitive flags are there for every member: the
//     phone holds its own copy of the flag rule (design 7, GET /v1/presets/flags).
//   - revision: the greatest revision among the presets it holds, read in the same statement as
//     they are (presets-revision.test.ts holds a writer committing between two reads); `since` when
//     it holds none, and 0 when `since` is left out too.
//   - epoch: the team's (team_preset_state.epoch, renewed after a database restore).
//   - reset: true exactly when `since` is left out, or is above the team's revision, or `epoch` is
//     not the team's (left out included), and `presets` then holds every head, which the phone puts
//     in place of its copy; false otherwise.
//   `since` is a whole number from 0 and `epoch` a UUID: anything else is 422 validation_failed,
//   naming each field at fault, whoever asks (the query is read before the team). `epoch` is read
//   as a UUID, whatever its case; a `since` past what a JavaScript number holds exactly is read as
//   one never sent. The phone's test server holds the same lines (fake_parity_test.dart).
// It runs the preset installer first, in the same transaction (design 5.2). When the installer
// wrote (an install, an update or an offer) the pull audits preset.platform_installed: entity team,
// entity ID the team, the asking member as actor, details the installer's counts by kind,
// {install, update, offer, skipped}, as team creation audits them. When it wrote nothing, nothing is
// audited: the read names no patient (PL-13), and a team that is up to date takes no lock and no
// revision. Whenever it skipped an entry, the count is logged as preset.platform_skipped with
// `count` and `teamId`, never a key or a name, as team creation logs it.

interface Pulled {
  id: string;
  kind: PresetKind;
  state: 'active' | 'archived';
  version: number;
  originKey: string | null;
  body: Body;
}
interface Pull {
  reset: boolean;
  revision: number;
  epoch: string;
  presets: Pulled[];
}

const accessCases = (
  JSON.parse(
    readFileSync(new URL('../../../packages/contract/test-vectors/access.json', import.meta.url), 'utf8'),
  ) as { cases: { name: string; permissions: Permission[] }[] }
).cases;

const pulled = (r: Answer) => {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as unknown as Pull;
};
const byId = (list: readonly Pulled[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
const idsOf = (list: readonly { id: string }[]) => list.map((p) => p.id).sort();

/** What the pull must answer from the database: each head above `since`, at its current version. */
async function heldAbove(h: Harness, teamId: string, since = -1): Promise<Pulled[]> {
  return [
    ...(await h.scratch.owner<Pulled[]>`
      select p.id, p.kind, p.state, p.current_version as version, p.origin_key as "originKey", v.body
      from sineobex.team_presets p
      join sineobex.team_preset_versions v
        on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
      where p.team_id = ${teamId} and p.revision > ${since}
      order by p.id`),
  ];
}
const greatestRevision = async (h: Harness, teamId: string) => {
  const [row] = await h.scratch.owner<{ max: number }[]>`
    select coalesce(max(revision), 0)::int as max from sineobex.team_presets where team_id = ${teamId}`;
  return row!.max;
};

/** The version of each origin key a team is given: the newest in the file. */
function newestOf(platform: readonly PlatformEntry[]): PlatformEntry[] {
  const newest = new Map<string, PlatformEntry>();
  for (const e of platform)
    if ((newest.get(e.originKey)?.platformVersion ?? 0) < e.platformVersion) newest.set(e.originKey, e);
  return [...newest.values()];
}
const countByKind = (list: readonly PlatformEntry[]) => {
  const counts: Partial<Record<PresetKind, number>> = {};
  for (const e of list) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
};

describe('the phone’s presets pull (phase 5 design 6.1)', () => {
  const spy = logSpy();
  let h: Harness;
  let team: PresetsTeam;
  let other: PresetsTeam;
  const asStaff = () => presetsApi(h, team.teamId, team.staff);

  beforeAll(async () => {
    h = await createHarness({ log: spy.log });
    team = await presetsTeam(h, 'Pull');
    other = await presetsTeam(h, 'Pull Other');
  });
  afterAll(async () => {
    // A preset's name and a reason are admin text: never in a log line (design 9).
    // Names too short to tell apart from the hex of an ID in a log line (ABD, Rx) are left out.
    spy.expectClean(
      [
        ...newestOf(PLATFORM).flatMap((e) => [e.originKey, String(e.body.name)]),
        'Demo: the team asked for this change',
        'Demo: pulled',
      ].filter((t) => t.length >= 4 && !/^[0-9a-f]+$/i.test(t)),
    );
    await h?.close();
  });

  it('answers every preset of the team at its current version, archived ones included, when no revision is sent', async () => {
    await archiveDirect(h, team.teamId, idOf(team, 'item.socks'), team.admin.userId);
    const flu = idOf(team, 'item.flu_vaccine');
    const [current] = await heldAbove(h, team.teamId).then((all) => all.filter((p) => p.id === flu));
    await editDirect(h, team.teamId, flu, { ...current!.body, captureLot: false }, team.admin.userId);

    const answer = pulled(await asStaff().pull());
    expect(answer.reset).toBe(true);
    expect(answer.epoch).toBe((await stateOf(h, team.teamId))!.epoch);
    expect(answer.revision).toBe(await greatestRevision(h, team.teamId));
    expect(byId(answer.presets)).toEqual(await heldAbove(h, team.teamId));
    for (const p of answer.presets)
      expect(Object.keys(p).sort()).toEqual(Object.keys(answer.presets[0]!).sort());
    expect(Object.keys(answer.presets[0]!).sort()).toEqual([
      'body',
      'id',
      'kind',
      'originKey',
      'state',
      'version',
    ]);
    // The archived item is there, for its name, and the edited one at its new version.
    expect(answer.presets.find((p) => p.id === idOf(team, 'item.socks'))).toMatchObject({
      state: 'archived',
    });
    expect(answer.presets.find((p) => p.id === flu)).toMatchObject({
      version: 2,
      body: { captureLot: false },
    });
    // Every platform preset is there, and nothing of the other team's.
    expect(new Set(answer.presets.map((p) => p.originKey))).toEqual(
      new Set(newestOf(PLATFORM).map((e) => e.originKey)),
    );
    const others = new Set(Object.values(other.ids));
    expect(answer.presets.filter((p) => others.has(p.id))).toEqual([]);
  });

  it('answers only what changed after the revision sent, with the greatest revision among it', async () => {
    const { epoch } = (await stateOf(h, team.teamId))!;
    const r0 = await revisionOf(h, team.teamId);
    const x = await insertPreset(h, team.teamId, 'flag', flagBody('Demo: pulled flag'), team.admin.userId);
    const y = idOf(team, 'item.handwarmers');
    await archiveDirect(h, team.teamId, y, team.admin.userId);
    const z = idOf(team, 'flag.dehydration_risk');
    const [zBody] = (await heldAbove(h, team.teamId)).filter((p) => p.id === z);
    await editDirect(
      h,
      team.teamId,
      z,
      { ...zBody!.body, criteria: 'Demo: pulled criteria' },
      team.admin.userId,
    );
    expect(await revisionOf(h, team.teamId)).toBe(r0 + 3);

    const since = async (n: number) => pulled(await asStaff().pull({ since: n, epoch }));
    const all = await since(r0);
    expect(all).toMatchObject({ reset: false, revision: r0 + 3, epoch });
    expect(idsOf(all.presets)).toEqual([x.id, y, z].sort());
    expect(byId(all.presets)).toEqual(await heldAbove(h, team.teamId, r0));
    const two = await since(r0 + 1);
    expect(two).toMatchObject({ reset: false, revision: r0 + 3 });
    expect(idsOf(two.presets)).toEqual([y, z].sort());
    const one = await since(r0 + 2);
    expect(one.presets).toEqual([
      expect.objectContaining({
        id: z,
        version: 2,
        body: expect.objectContaining({ criteria: 'Demo: pulled criteria' }),
      }),
    ]);
    // Nothing since the newest: the revision it was sent, and no preset.
    expect(await since(r0 + 3)).toEqual({ reset: false, revision: r0 + 3, epoch, presets: [] });
  });

  it('answers the greatest revision among the presets it holds, never one no preset carries', async () => {
    const { epoch } = (await stateOf(h, team.teamId))!;
    const r0 = await revisionOf(h, team.teamId);
    // A note type head takes the team's next revision too (design 4.3), and is no preset.
    await asWriter(h, team.teamId, async (tx, revision) => {
      await tx`
        insert into sineobex.note_types (team_id, key, title, current_version, revision)
        values (${team.teamId}, 'outreach', 'Outreach', 1, ${revision})
        on conflict (team_id, key) do update set revision = excluded.revision`;
    });
    expect(await revisionOf(h, team.teamId)).toBe(r0 + 1);
    expect(pulled(await asStaff().pull({ since: r0, epoch }))).toEqual({
      reset: false,
      revision: r0,
      epoch,
      presets: [],
    });
    // Not above the team's revision, so no reset.
    expect(pulled(await asStaff().pull({ since: r0 + 1, epoch }))).toEqual({
      reset: false,
      revision: r0 + 1,
      epoch,
      presets: [],
    });
  });

  it('answers everything as a reset when the revision sent is above the team’s', async () => {
    const { epoch, revision } = (await stateOf(h, team.teamId))!;
    const answer = pulled(await asStaff().pull({ since: revision + 1, epoch }));
    expect(answer.reset).toBe(true);
    expect(answer.epoch).toBe(epoch);
    expect(answer.revision).toBe(await greatestRevision(h, team.teamId));
    expect(byId(answer.presets)).toEqual(await heldAbove(h, team.teamId));
  });

  it('answers everything as a reset when the epoch sent is not the team’s, or a revision comes without one', async () => {
    const { epoch, revision } = (await stateOf(h, team.teamId))!;
    const everything = await heldAbove(h, team.teamId);
    const another = pulled(await asStaff().pull({ since: revision, epoch: randomUUID() }));
    expect(another).toMatchObject({ reset: true, epoch });
    expect(byId(another.presets)).toEqual(everything);
    const none = pulled(await asStaff().pull({ since: revision }));
    expect(none).toMatchObject({ reset: true, epoch });
    expect(byId(none.presets)).toEqual(everything);
    // The epoch is read as a UUID, so one in capitals is the team's.
    expect(pulled(await asStaff().pull({ since: revision, epoch: epoch.toUpperCase() })).reset).toBe(false);

    // A database restore renews the epoch (docs/setup.md): a phone holding the old one starts over.
    await h.scratch
      .owner`update sineobex.team_preset_state set epoch = gen_random_uuid() where team_id = ${team.teamId}`;
    const renewed = (await stateOf(h, team.teamId))!.epoch;
    expect(renewed).not.toBe(epoch);
    const old = pulled(await asStaff().pull({ since: revision, epoch }));
    expect(old).toMatchObject({ reset: true, epoch: renewed });
    expect(byId(old.presets)).toEqual(everything);
    expect(pulled(await asStaff().pull({ since: revision, epoch: renewed }))).toEqual({
      reset: false,
      revision,
      epoch: renewed,
      presets: [],
    });
  });

  it('answers everything as a reset when no revision is sent, whatever the epoch', async () => {
    // Everything is sent either way, so the phone puts it in place of its copy: a phone that lost
    // its revision but kept rows a restored server no longer has keeps none of them (design 6.1).
    const { epoch } = (await stateOf(h, team.teamId))!;
    const everything = await heldAbove(h, team.teamId);
    for (const query of [{}, { epoch }, { epoch: randomUUID() }]) {
      const answer = pulled(await asStaff().pull(query));
      expect(answer, JSON.stringify(query)).toMatchObject({ reset: true, epoch });
      expect(answer.revision).toBe(await greatestRevision(h, team.teamId));
      expect(byId(answer.presets)).toEqual(everything);
    }
  });

  it('refuses a revision that is not a whole number from 0, and an epoch that is not a UUID', async () => {
    const { epoch, revision } = (await stateOf(h, team.teamId))!;
    const fieldsOf = (r: Answer) =>
      (errorOf(r).details as { fields: { path: string }[] }).fields.map((f) => f.path);
    for (const [since, sent, paths] of [
      [-1, epoch, ['since']],
      [1.5, epoch, ['since']],
      ['abc', epoch, ['since']],
      ['12345678901234567890', epoch, ['since']],
      [1, 'not-an-epoch', ['epoch']],
      // zod's uuid() takes versions 1 to 8 only.
      [1, '5a1f0c2e-8b7d-0e6a-9c3b-1d2e3f4a5b6c', ['epoch']],
      ['x', 'y', ['since', 'epoch']],
    ] as const) {
      const r = await asStaff().pull({ since, epoch: sent });
      expect(r.status, `${since} ${sent}`).toBe(422);
      expect(errorOf(r).code).toBe('validation_failed');
      expect(fieldsOf(r), `${since} ${sent}`).toEqual(paths);
    }
    // The query is read before the team: one malformed is 422 to someone who is not a member too.
    const outsider = await memberOf(h, other.teamId, [...PERMISSION_KEYS], 'Pull Outsider Unread');
    const unread = await presetsApi(h, team.teamId, outsider).pull({ since: 'abc', epoch });
    expect([unread.status, errorOf(unread).code, fieldsOf(unread)]).toEqual([
      422,
      'validation_failed',
      ['since'],
    ]);
    // A number no revision can be is refused or answered as a reset, never a 500. Up to 19 digits
    // it is read, and past what a JavaScript number holds exactly it is one never sent.
    for (const huge of ['9223372036854775808', '9999999999999999999', '9007199254740992']) {
      const answer = pulled(await asStaff().pull({ since: huge, epoch }));
      expect(answer.reset, huge).toBe(true);
      expect(byId(answer.presets), huge).toEqual(await heldAbove(h, team.teamId));
    }
    // A revision written with leading zeros is read as its number, and the nil UUID is a UUID:
    // here another epoch than the team's, so a reset.
    expect(pulled(await asStaff().pull({ since: `0${revision}`, epoch })).reset).toBe(false);
    expect(
      pulled(await asStaff().pull({ since: 0, epoch: '00000000-0000-0000-0000-000000000000' })).reset,
    ).toBe(true);
  });

  it('gives every member every preset, sensitive flags included, whatever the role, and logs no refusal', async () => {
    const everything = await heldAbove(h, team.teamId);
    const pregnancy = idOf(team, 'flag.pregnancy');
    for (const c of [...accessCases, { name: 'no permission', permissions: [] as Permission[] }]) {
      const member = await memberOf(h, team.teamId, c.permissions, `Pull ${c.name}`);
      const mark = await auditMark(h);
      const answer = pulled(await presetsApi(h, team.teamId, member).pull());
      expect(byId(answer.presets), c.name).toEqual(everything);
      expect(
        answer.presets.some((p) => p.id === pregnancy && p.body.sensitive === true),
        c.name,
      ).toBe(true);
      // Nothing is logged of a read that names no patient: no refusal, no read event.
      expect(await auditAfter(h, mark), c.name).toEqual([]);
    }
  });

  it('refuses a member of another team, and logs it in the platform chain', async () => {
    const outsider = await memberOf(h, other.teamId, [...PERMISSION_KEYS], 'Pull Outsider');
    const mark = await auditMark(h);
    const r = await presetsApi(h, team.teamId, outsider).pull();
    expect(r.status).toBe(403);
    expect(errorOf(r).code).toBe('not_a_member');
    expect(r.body.presets).toBeUndefined();
    const events = await auditAfter(h, mark);
    expect(events).toEqual([
      expect.objectContaining({
        teamId: null,
        action: 'access.denied',
        actorUserId: outsider.userId,
        details: { rule: 'not_a_member', route: expect.any(String), teamId: team.teamId },
      }),
    ]);
  });

  it('takes no lock and no revision for a team that is up to date, and audits nothing', async () => {
    const before = await revisionOf(h, team.teamId);
    const mark = await auditMark(h);
    const { waited, answer } = await whileLocked(h, team.teamId, () => asStaff().pull());
    expect(waited).toBe(false);
    expect(answer.status).toBe(200);
    expect(await revisionOf(h, team.teamId)).toBe(before);
    expect(await auditAfter(h, mark)).toEqual([]);
  });

  describe('a team that does not hold every platform preset yet', () => {
    // A team made with no presets and no note types: its first pull installs every platform preset
    // but the field maps, which name note types it does not hold, and are skipped and counted.
    const maps = newestOf(PLATFORM).filter((e) => e.kind === 'field_supply_map');
    const installable = newestOf(PLATFORM).filter((e) => e.kind !== 'field_supply_map');

    it('gets them at its first pull, which audits the install once and logs its skips by count, never by key', async () => {
      const teamId = await createTeam(h, 'Demo Pull Bare Team');
      const member = await memberOf(h, teamId, [], 'Pull Bare');
      const lines = spy.lines.length;
      const mark = await auditMark(h);

      const first = pulled(await presetsApi(h, teamId, member).pull());
      expect(first.reset).toBe(true);
      expect(first.revision).toBe(1);
      expect(new Set(first.presets.map((p) => p.originKey))).toEqual(
        new Set(installable.map((e) => e.originKey)),
      );
      expect(byId(first.presets)).toEqual(await heldAbove(h, teamId));
      expect(await revisionOf(h, teamId)).toBe(1);

      expect(await auditAfter(h, mark)).toEqual([
        expect.objectContaining({
          teamId,
          action: 'preset.platform_installed',
          actorUserId: member.userId,
          entity: 'team',
          entityId: teamId,
          patientId: null,
          details: {
            install: countByKind(installable),
            update: {},
            offer: {},
            skipped: { field_supply_map: maps.length },
          },
        }),
      ]);
      const logged = spy.lines.slice(lines).map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(logged.filter((l) => l.event === 'preset.platform_skipped')).toEqual([
        expect.objectContaining({ teamId, count: maps.length }),
      ]);
      const text = spy.lines.slice(lines).join('\n');
      for (const e of maps) {
        expect(text).not.toContain(e.originKey);
        expect(text).not.toContain(String(e.body.name));
      }

      // The next pull has nothing to write: no audit, no revision; the skips are logged again.
      const again = spy.lines.length;
      const mark2 = await auditMark(h);
      const second = pulled(await presetsApi(h, teamId, member).pull({ since: 1, epoch: first.epoch }));
      expect(second).toEqual({ reset: false, revision: 1, epoch: first.epoch, presets: [] });
      expect(await revisionOf(h, teamId)).toBe(1);
      expect(await auditAfter(h, mark2)).toEqual([]);
      expect(
        spy.lines
          .slice(again)
          .map((l) => JSON.parse(l) as Record<string, unknown>)
          .filter((l) => l.event === 'preset.platform_skipped'),
      ).toEqual([expect.objectContaining({ teamId, count: maps.length })]);
    });

    it('installs and audits in the pull’s transaction: when the audit fails, nothing is installed', async () => {
      const teamId = await createTeam(h, 'Demo Pull Unaudited Team');
      const member = await memberOf(h, teamId, [], 'Pull Unaudited');
      await h.scratch.owner.unsafe(`
        create function sineobex.test_fail_install_audit() returns trigger language plpgsql as $$
        begin
          if new.action = 'preset.platform_installed' then raise exception 'refused for the test'; end if;
          return new;
        end $$;
        create trigger test_fail_install_audit before insert on sineobex.audit_events
          for each row execute function sineobex.test_fail_install_audit()`);
      try {
        const r = await presetsApi(h, teamId, member).pull();
        expect(r.status).toBe(500);
      } finally {
        await h.scratch.owner.unsafe(`
          drop trigger test_fail_install_audit on sineobex.audit_events;
          drop function sineobex.test_fail_install_audit()`);
      }
      const [counts] = await h.scratch.owner<{ heads: number; versions: number; events: number }[]>`
        select (select count(*)::int from sineobex.team_presets where team_id = ${teamId}) as heads,
               (select count(*)::int from sineobex.team_preset_versions where team_id = ${teamId}) as versions,
               (select count(*)::int from sineobex.team_preset_events where team_id = ${teamId}) as events`;
      expect(counts).toEqual({ heads: 0, versions: 0, events: 0 });
      expect(await stateOf(h, teamId)).toBeNull();
    });
  });
});

describe('the pull and a kind the phone does not read (design 6.1)', () => {
  // Phase 10 adds billing_code_map, a ninth kind no phone reads (phase 10 design 4.3). It does not
  // exist yet, so this file widens 0023's kind check in its own database, as phase 10's migration
  // will, and holds the pull to the eight kinds the phone reads.
  let h: Harness;
  let team: PresetsTeam;

  beforeAll(async () => {
    h = await createHarness();
    team = await presetsTeam(h, 'Pull Kinds');
    const [check] = await h.scratch.owner<{ name: string }[]>`
      select conname as name from pg_constraint
      where conrelid = 'sineobex.team_presets'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%order_category%'`;
    const kinds = [...PRESET_KINDS, 'billing_code_map'].map((k) => `'${k}'`).join(', ');
    await h.scratch.owner.unsafe(`
      alter table sineobex.team_presets drop constraint ${check!.name},
        add constraint ${check!.name} check (kind in (${kinds}))`);
  });
  afterAll(() => h?.close());

  it('never answers a kind outside the eight, in a pull, a pull since a revision or a reset', async () => {
    const { epoch } = (await stateOf(h, team.teamId))!;
    const r0 = await revisionOf(h, team.teamId);
    const billing = await insertPreset(
      h,
      team.teamId,
      'billing_code_map',
      { name: 'Demo: billing codes', codes: [] },
      team.admin.userId,
    );
    expect(billing.revision).toBe(r0 + 1);
    const api = presetsApi(h, team.teamId, team.staff);
    const everything = pulled(await api.pull());
    expect(everything.presets.map((p) => p.kind).filter((k) => !PRESET_KINDS.includes(k))).toEqual([]);
    expect(everything.presets.some((p) => p.id === billing.id)).toBe(false);
    expect(everything.revision).toBe(r0);
    // A pull since the last preset the phone reads holds nothing, and says so with its own revision.
    expect(pulled(await api.pull({ since: r0, epoch }))).toEqual({
      reset: false,
      revision: r0,
      epoch,
      presets: [],
    });
    const reset = pulled(await api.pull({ since: r0 + 5, epoch }));
    expect(reset.reset).toBe(true);
    expect(reset.presets.some((p) => p.id === billing.id)).toBe(false);

    // Nor is one of its heads a fault when it is broken (moved on with no version, at a revision of
    // its own): the pull answers only the eight kinds, so only theirs can be.
    await asWriter(h, team.teamId, async (tx, revision) => {
      await tx`
        update sineobex.team_presets
        set current_version = current_version + 1, customized = true, revision = ${revision}
        where id = ${billing.id}`;
    });
    expect(await revisionOf(h, team.teamId)).toBe(r0 + 2);
    expect(pulled(await api.pull({ since: r0, epoch }))).toEqual({
      reset: false,
      revision: r0,
      epoch,
      presets: [],
    });
    const again = pulled(await api.pull());
    expect([again.reset, again.revision]).toEqual([true, r0]);
    expect(again.presets.some((p) => p.id === billing.id)).toBe(false);
  });
});

describe('the pull and a head whose current version is missing (design 4.1, 6.1)', () => {
  // 0023 cannot hold a head to its version, so only its writers do. One that breaks that is a fault
  // the pull answers as every other reader does, a 500, never by leaving the head out under a
  // revision above it, after which no phone would ask for it again, repaired or not.
  const spy = logSpy();
  let h: Harness;
  let team: PresetsTeam;

  beforeAll(async () => {
    h = await createHarness({ log: spy.log });
    team = await presetsTeam(h, 'Pull Broken');
  });
  afterAll(() => h?.close());

  it('answers a fault while one is missing, and the head with its version once it is there', async () => {
    const { epoch, revision: r0 } = (await stateOf(h, team.teamId))!;
    const api = presetsApi(h, team.teamId, team.staff);
    // A writer that moves a head on and writes no version for it, then an ordinary write after it.
    const broken = idOf(team, 'item.handwarmers');
    const [held] = (await heldAbove(h, team.teamId)).filter((p) => p.id === broken);
    let taken = -1;
    await asWriter(h, team.teamId, async (tx, revision) => {
      taken = Number(revision);
      await tx`
        update sineobex.team_presets
        set current_version = current_version + 1, customized = true, revision = ${revision}
        where id = ${broken}`;
    });
    const after = await insertPreset(
      h,
      team.teamId,
      'flag',
      flagBody('Demo: pulled after'),
      team.admin.userId,
    );
    expect([taken, after.revision]).toEqual([r0 + 1, r0 + 2]);

    for (const query of [{ since: r0, epoch }, {}]) {
      const mark = await auditMark(h);
      const r = await api.pull(query);
      expect(r.status, JSON.stringify(query)).toBe(500);
      expect(errorOf(r).code).toBe('internal');
      expect(await auditAfter(h, mark)).toEqual([]);
    }
    // The fault is logged by its class alone, never the preset's name or its text.
    const faults = spy.lines.filter((l) => (JSON.parse(l) as { event: string }).event === 'unhandled_error');
    expect(faults).toHaveLength(2);
    spy.expectClean(['Handwarmers', 'item.handwarmers', 'Demo: pulled after', 'version is missing']);
    // Only a head the pull would answer is a fault: a pull since the broken head's own revision
    // answers the later one alone.
    const past = pulled(await api.pull({ since: taken, epoch }));
    expect([past.reset, past.revision, past.epoch]).toEqual([false, r0 + 2, epoch]);
    expect(past.presets.map((p) => p.id)).toEqual([after.id]);

    // Repaired: the version written. The next pull since what the phone holds brings the head.
    await h.scratch.owner`
      insert into sineobex.team_preset_versions (team_id, preset_id, version, body, source, created_by)
      values (${team.teamId}, ${broken}, ${held!.version + 1}, ${h.scratch.owner.json(held!.body as never)},
              'team', ${team.admin.userId})`;
    const answer = pulled(await api.pull({ since: r0, epoch }));
    expect(answer).toMatchObject({ reset: false, revision: r0 + 2 });
    expect(idsOf(answer.presets)).toEqual([broken, after.id].sort());
    expect(answer.presets.find((p) => p.id === broken)).toMatchObject({ version: held!.version + 1 });
  });
});

function flagBody(name: string): Body {
  return { name, tier: 'secondary', criteria: '', color: 'grey', rank: 90, sensitive: false };
}
