import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { expectAuditClean, logSpy } from './patient-fixtures.ts';
import {
  auditAfter,
  auditMark,
  bodies,
  createdPreset,
  expectNothingWritten,
  footprint,
  headOf,
  headXid,
  idOf,
  nextVersion,
  presetsApi,
  presetsTeam,
  releasePlatform,
  runInstaller,
  versionsOf,
  type Answer,
  type Body,
  type PresetsApi,
  type PresetsTeam,
} from './presets-fixtures.ts';

// The audit events of the admin preset writes (phase 5 design 9; CLAUDE.md: every action writes its
// audit event in the same database transaction), written before the routes (cards P1-store to
// P1-order). Each write audits in its own transaction, and a write whose audit fails is undone
// whole. The details, which the design leaves partly open and this file settles:
//
//   preset.created, preset.updated, preset.archived, preset.restored, preset.platform_update_taken
//     entity 'preset', entity ID the preset, the person as actor, no patient;
//     details {kind, version, revision, fields}: `version` the one the act made or stood on,
//     `revision` the one it took, `fields` the top-level field names of the body the act changed,
//     sorted (created, and taken as new: every field of the new body; updated, and taken in place:
//     those whose value changed; archived and restored: none). Taken as new, the event names the
//     new preset and its details add `replaces`, the old preset's ID; the old one, when the act
//     archived it, gets its own preset.archived.
//   preset.reordered
//     entity 'preset', no entity ID; details {tier, changed}: how many flags the order moved. An
//     order that moves none writes nothing, this event included.
//
// Never a value, a name or a reason: those are admin text, and a reason is kept only in
// team_preset_events (design 9). No log line carries one either.

vi.mock('../../../packages/presets/data/platform.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});

const spy = logSpy();
let h: Harness;
let team: PresetsTeam;
let api: PresetsApi;
let make: ReturnType<typeof bodies>;
let unrelease: () => void;

/** Every name, body text and reason this file sends: none may reach an audit detail or a log. */
const SECRETS = new Set<string>([
  'Demo: the team’s own audited criteria',
  'Demo: platform audited criteria',
  'Demo: audited criteria',
]);
const reasonOf = (what: string) => {
  const reason = `Demo: audited reason for ${what}`;
  SECRETS.add(reason);
  return reason;
};
const secretBody = (b: Body) => {
  for (const v of Object.values(b)) if (typeof v === 'string' && v.startsWith('Demo:')) SECRETS.add(v);
  return b;
};

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  team = await presetsTeam(h, 'Audit');
  api = presetsApi(h, team.teamId, team.admin);
  make = bodies(team);
  // An update on offer for each take below: an edited copy is offered the platform's next version.
  for (const key of ['flag.frost_risk', 'flag.dehydration_risk', 'flag.medium']) {
    const id = idOf(team, key);
    const body = (await versionsOf(h, id))[0]!.body;
    const r = await api.edit('flag', id, 1, { ...body, criteria: 'Demo: the team’s own audited criteria' });
    expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
  }
  unrelease = releasePlatform([
    nextVersion('flag.frost_risk', (b) => ({
      ...b,
      criteria: 'Demo: platform audited criteria',
      color: 'teal',
    })),
    nextVersion('flag.dehydration_risk', (b) => ({ ...b, criteria: 'Demo: platform audited criteria' })),
    nextVersion('flag.medium', (b) => ({ ...b, criteria: 'Demo: platform audited criteria' })),
  ]);
  await runInstaller(h, team.teamId);
});
afterAll(async () => {
  unrelease?.();
  await expectAuditClean(h, [...SECRETS]);
  spy.expectClean([...SECRETS]);
  await h?.close();
});

/** The audit events after `mark` in the team's chain whose action starts "preset.". */
const presetEvents = async (mark: string) =>
  (await auditAfter(h, mark)).filter((e) => e.teamId === team.teamId && e.action.startsWith('preset.'));

/** The transaction that wrote each of the preset's rows the act wrote: its head, newest version and event. */
async function writesOf(id: string): Promise<string[]> {
  const head = (await headOf(h, id))!;
  const [version] = await h.scratch.owner<{ xid: string }[]>`
    select xmin::text as xid from sineobex.team_preset_versions
    where preset_id = ${id} and version = ${head.currentVersion}`;
  const [event] = await h.scratch.owner<{ xid: string }[]>`
    select xmin::text as xid from sineobex.team_preset_events
    where preset_id = ${id} order by created_at desc, xmin::text::bigint desc limit 1`;
  return [await headXid(h, id), version!.xid, event!.xid];
}

const fieldsOf = (b: Body) => Object.keys(b).sort();
const changedFields = (before: Body, after: Body) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .sort();

describe('each preset write’s audit event (design 9)', () => {
  it('a create: preset.created with its kind, version, revision and every field’s name, in the write’s transaction', async () => {
    const body = secretBody(make.flag({ criteria: 'Demo: audited criteria on create' }));
    const mark = await auditMark(h);
    const r = await api.create('flag', body, reasonOf('a create'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    const events = await presetEvents(mark);
    expect(events).toEqual([
      expect.objectContaining({
        action: 'preset.created',
        entity: 'preset',
        entityId: id,
        actorUserId: team.admin.userId,
        patientId: null,
        details: { kind: 'flag', version: 1, revision: r.body.revision, fields: fieldsOf(body) },
      }),
    ]);
    const [head] = await writesOf(id);
    expect(new Set([...(await writesOf(id)), events[0]!.xid])).toEqual(new Set([head]));
  });

  it('a create of a body that leaves out what its schema fills in names every field as stored', async () => {
    // A bundle's prompt defaults to '' (design 4.4): the version stored holds it, so the event names
    // it, whatever the person sent.
    const sent = secretBody(make.bundle());
    delete sent.prompt;
    const mark = await auditMark(h);
    const r = await api.create('bundle', sent, reasonOf('a create with a default'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const stored = (await versionsOf(h, r.body.id as string))[0]!.body;
    expect(stored.prompt).toBe('');
    const events = await presetEvents(mark);
    expect(events.map((e) => e.details)).toEqual([
      { kind: 'bundle', version: 1, revision: r.body.revision, fields: fieldsOf(stored) },
    ]);
    expect(events[0]!.details.fields).toContain('prompt');
  });

  it('an edit: preset.updated with the names of the fields it changed, and nothing of their values', async () => {
    const body = secretBody(make.flag());
    const { id } = await createdPreset(api, 'flag', body);
    const next = secretBody({ ...body, criteria: 'Demo: audited criteria on edit', color: 'purple' });
    const mark = await auditMark(h);
    const r = await api.edit('flag', id, 1, next, reasonOf('an edit'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const events = await presetEvents(mark);
    expect(events).toEqual([
      expect.objectContaining({
        action: 'preset.updated',
        entity: 'preset',
        entityId: id,
        actorUserId: team.admin.userId,
        details: { kind: 'flag', version: 2, revision: r.body.revision, fields: ['color', 'criteria'] },
      }),
    ]);
    expect(new Set([...(await writesOf(id)), events[0]!.xid]).size).toBe(1);
  });

  it('an archive and a restore: an event each, at the version they stand on, naming no field', async () => {
    const body = secretBody(make.bag());
    const { id } = await createdPreset(api, 'bag', body);
    for (const [act, action] of [
      ['archive', 'preset.archived'],
      ['restore', 'preset.restored'],
    ] as const) {
      const mark = await auditMark(h);
      const r =
        act === 'archive'
          ? await api.archive('bag', id, 1, reasonOf(act))
          : await api.restore('bag', id, reasonOf(act));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const events = await presetEvents(mark);
      expect(events).toEqual([
        expect.objectContaining({
          action,
          entity: 'preset',
          entityId: id,
          actorUserId: team.admin.userId,
          details: { kind: 'bag', version: 1, revision: r.body.revision, fields: [] },
        }),
      ]);
      expect(await headXid(h, id)).toBe(events[0]!.xid);
    }
  });

  it('an update taken in place: preset.platform_update_taken with the fields the platform changed', async () => {
    const id = idOf(team, 'flag.frost_risk');
    const before = (await versionsOf(h, id)).at(-1)!.body;
    const mark = await auditMark(h);
    const r = await api.takeUpdate('flag', id, 2, false, reasonOf('an update in place'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await versionsOf(h, id)).at(-1)!.body;
    const events = await presetEvents(mark);
    expect(events).toEqual([
      expect.objectContaining({
        action: 'preset.platform_update_taken',
        entity: 'preset',
        entityId: id,
        actorUserId: team.admin.userId,
        details: {
          kind: 'flag',
          version: 3,
          revision: r.body.revision,
          fields: changedFields(before, after),
        },
      }),
    ]);
    expect(changedFields(before, after)).toEqual(['color', 'criteria']);
    expect(new Set([...(await writesOf(id)), events[0]!.xid]).size).toBe(1);
  });

  it('an update taken as new: the new preset’s event names the old one, which gets its own archive event', async () => {
    const old = idOf(team, 'flag.dehydration_risk');
    const mark = await auditMark(h);
    const r = await api.takeUpdate('flag', old, 2, true, reasonOf('an update as new'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const fresh = r.body.id as string;
    const events = await presetEvents(mark);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'preset.platform_update_taken',
        entity: 'preset',
        entityId: fresh,
        actorUserId: team.admin.userId,
        details: {
          kind: 'flag',
          version: 1,
          revision: r.body.revision,
          fields: fieldsOf((await versionsOf(h, fresh))[0]!.body),
          replaces: old,
        },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'preset.archived',
        entity: 'preset',
        entityId: old,
        actorUserId: team.admin.userId,
        details: { kind: 'flag', version: 2, revision: r.body.revision, fields: [] },
      }),
    );
    // One transaction: both heads, the new version, both events and both audit events.
    expect(
      new Set([await headXid(h, old), ...(await writesOf(fresh)), ...events.map((e) => e.xid)]).size,
    ).toBe(1);
  });

  it('a reorder: one preset.reordered for the tier, with how many flags it moved', async () => {
    const tier = await api.flagList('primary');
    const ids = tier.map((x) => x.id);
    expect(ids.length).toBe(3);
    const mark = await auditMark(h);
    const r = await api.reorder('primary', [...tier].reverse(), reasonOf('a reorder'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ changed: 2 });
    const events = await presetEvents(mark);
    expect(events).toEqual([
      expect.objectContaining({
        action: 'preset.reordered',
        entity: 'preset',
        entityId: null,
        actorUserId: team.admin.userId,
        patientId: null,
        details: { tier: 'primary', changed: 2 },
      }),
    ]);
    // The flags it moved, the first and the last, were written in the event's transaction.
    for (const id of [ids[0]!, ids[2]!]) expect(await headXid(h, id)).toBe(events[0]!.xid);
  });

  it('writes no audit event for a refusal, nor for an order that moves no flag', async () => {
    const mark = await auditMark(h);
    const settings = idOf(team, 'settings.team');
    expect((await api.archive('settings', settings, 1)).status).toBe(409);
    expect((await api.create('flag', make.flag({ color: 'nope' }))).status).toBe(422);
    // The primary flags as the reorder above left them, at ranks 10, 20 and 30: sent as they are.
    const tier = await api.flagList('primary');
    // An order sent at versions its flags are not at: refused stale.
    const stale = await api.reorder(
      'primary',
      [...tier].reverse().map((f) => ({ ...f, baseVersion: f.baseVersion + 1 })),
    );
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'stale' } });
    const r = await api.reorder('primary', tier);
    expect(r.body).toEqual({ changed: 0 });
    expect(await auditAfter(h, mark)).toEqual([]);
  });
});

describe('a write whose audit event cannot be written is undone whole (design 7, 9)', () => {
  /** Runs `act` while the audit chain refuses `action`, and answers the act's answer. */
  async function withAuditRefused(action: string, act: () => Promise<Answer>): Promise<Answer> {
    await h.scratch.owner.unsafe(`
      create function sineobex.test_fail_preset_audit() returns trigger language plpgsql as $$
      begin
        if new.action = '${action}' then raise exception 'refused for the test'; end if;
        return new;
      end $$;
      create trigger test_fail_preset_audit before insert on sineobex.audit_events
        for each row execute function sineobex.test_fail_preset_audit()`);
    try {
      return await act();
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_fail_preset_audit on sineobex.audit_events;
        drop function sineobex.test_fail_preset_audit()`);
    }
  }

  it('for every write: a 500, and no head, version, event or revision left behind', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const gone = await createdPreset(api, 'flag', make.flag());
    expect((await api.archive('flag', gone.id, 1)).status).toBe(200);
    const tier = await api.flagList('primary');
    const medium = idOf(team, 'flag.medium');
    const mediumVersion = (await headOf(h, medium))!.currentVersion;
    const cases: [string, string, () => Promise<Answer>][] = [
      ['create', 'preset.created', () => api.create('flag', make.flag())],
      ['edit', 'preset.updated', () => api.edit('flag', id, 1, { ...body, rank: 66 })],
      ['archive', 'preset.archived', () => api.archive('flag', id, 1)],
      ['restore', 'preset.restored', () => api.restore('flag', gone.id)],
      [
        'take-update',
        'preset.platform_update_taken',
        () => api.takeUpdate('flag', medium, mediumVersion, false),
      ],
      [
        'take-update as new',
        'preset.platform_update_taken',
        () => api.takeUpdate('flag', medium, mediumVersion, true),
      ],
      ['reorder', 'preset.reordered', () => api.reorder('primary', [...tier].reverse())],
    ];
    for (const [name, action, act] of cases) {
      const before = await footprint(h, team.teamId);
      const r = await withAuditRefused(action, act);
      expect(r.status, `${name}: ${JSON.stringify(r.body)}`).toBe(500);
      await expectNothingWritten(h, team.teamId, before);
    }
    // And each goes through once the audit chain takes it again.
    expect((await api.edit('flag', id, 1, { ...body, rank: 66 })).status).toBe(200);
  });
});
