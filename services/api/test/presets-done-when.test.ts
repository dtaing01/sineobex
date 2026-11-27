import { readFileSync } from 'node:fs';
import { PLATFORM, withIds, type PlatformEntry, type PresetKind } from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { expectAuditClean, logSpy } from './patient-fixtures.ts';
import {
  auditAfter,
  auditMark,
  eventsOf,
  footprint,
  headOf,
  headXid,
  revisionOf,
  stateOf,
  versionsOf,
  type Answer,
  type Body,
} from './presets-fixtures.ts';
import { addMember, call, FakePhone, intakeValue, push, register, results } from './sync-fixtures.ts';

// The phase 5 Done when, the API's half (design 10.1, card P6-server): "An admin adds a Labs item,
// a bundle and a secondary flag, and a phone sees all three after its next sync." Steps 2 to 5 as
// the admin routes take them, from the shared story (packages/contract/test-vectors/
// presets-done-when.json): each write's answer, the head, the version and the event holding the
// reason that it stores, and its audit event, in the write's own transaction and holding no
// reason; step 5's two refusals, which write nothing and leave the revision where step 4 left it.
// The staff member's phone frames them as it would: its first pull (step 1), from which the story
// counts R, and its next (step 6), which answers exactly the three. Step 8's change, pushed as the
// phone sends it, is read here for what only the server holds of it: its audit event, in the
// change's transaction, naming neither the flag nor the reason. The phone's tests
// (done_when_presets_test.dart, live_presets_test.dart) and the portal's (presets.spec.ts,
// patient-flags.spec.ts) read the same file. Everyone and everything here is made up.

type Who = 'programAdmin' | 'staff';
interface Person {
  email: string;
  displayName: string;
  role: string;
}
interface StoryPreset {
  ref: string;
  kind: PresetKind;
  step: number;
  body: Body;
  reason: string;
}
/** What steps 2 to 4 expect, each of the write that adds one of the story's presets. */
interface Added {
  status: number;
  version: number;
  revision: number;
  head: { state: string; version: number; customized: boolean; revision: number };
  storedVersion: { version: number; source: string; by: Who };
  event: { act: string; version: number; by: Who; holdsTheReason: boolean };
  audit: {
    action: string;
    entity: string;
    count: number;
    inTheWriteTransaction: boolean;
    holdsTheReason: boolean;
  };
  server: { revision: number };
}
interface Attempt {
  by: Who;
  signedInMinutesAgo: number;
  repeats: string;
  expect: {
    status: number;
    code: string;
    audit: null | { action: string; count: number; details: Record<string, unknown> };
  };
}
/** What the other steps this file reads expect, by step. */
interface Expected {
  1: {
    pull: { status: number; reset: boolean; revision: number };
    phone: { holds: string; revision: number };
    server: { revision: number };
  };
  5: { server: { revision: number; written: string } };
  6: {
    pull: {
      since: number;
      status: number;
      reset: boolean;
      presets: { ref: string; kind: string; name: string; version: number; state: string }[];
      exactly: boolean;
      revision: number;
    };
    phone: { revision: number };
  };
  8: {
    receipts: { status: string; hashConfirmed: boolean };
    server: {
      currentFlags: { primary: null; secondary: string[] };
      audit: {
        action: string;
        count: number;
        inTheWriteTransaction: boolean;
        details: Record<string, unknown>;
        holdsTheReason: boolean;
      };
    };
    chart: {
      flags: { primary: null; secondary: ({ flag: string; colorName: string } & Record<string, unknown>)[] };
      pill: string;
      history: { flag: string; action: string; by: Who; holdsTheReason: boolean }[];
    };
  };
}
interface Step {
  n: number;
  by?: Who;
  signedInMinutesAgo?: number;
  adds?: string;
  attempts?: Attempt[];
  flagChange?: { patient: string; flag: string; action: 'set' | 'clear'; reason: string };
  /** Each step's own shape: Added for steps 2 to 4, else Expected's. */
  expect: unknown;
}
interface Story {
  people: Record<Who, Person>;
  recentSignInMinutes: number;
  patient: {
    id: string;
    preferredName: string;
    visualDescriptor: string;
    usualArea: string;
    livingSituation: { kind: string };
    preferredLanguage: string;
  };
  presets: StoryPreset[];
  steps: Step[];
  neverInAuditDetails: string[];
  neverLogged: string[];
}
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

const story = JSON.parse(
  readFileSync(
    new URL('../../../packages/contract/test-vectors/presets-done-when.json', import.meta.url),
    'utf8',
  ),
) as Story;
const step = (n: number) => story.steps.find((s) => s.n === n)!;
const expectAt = <N extends keyof Expected>(n: N) => step(n).expect as Expected[N];
const presetOf = (ref: string) => story.presets.find((p) => p.ref === ref)!;

/** The newest platform version of each origin key: what a new team is given (design 5.2). */
function newestOf(platform: readonly PlatformEntry[]): PlatformEntry[] {
  const newest = new Map<string, PlatformEntry>();
  for (const e of platform)
    if ((newest.get(e.originKey)?.platformVersion ?? 0) < e.platformVersion) newest.set(e.originKey, e);
  return [...newest.values()];
}

const spy = logSpy();
let h: Harness;
let teamId: string;
const userIds = {} as Record<Who, string>;
let phone: FakePhone;

/** R: the team's revision once step 1 has run, which every revision of the story counts from. */
let R: number;
/** The epoch step 1's pull answered, which the phone sends with its revision at step 6. */
let epoch: string;
/** The team's ID of each platform preset, by origin key, as step 1's pull gave them to the phone. */
let platformIds: Map<string, string>;
/** The ID of each preset the story's steps made, by its ref. */
const made = new Map<string, string>();

/**
 * A body of the story as the team holds it: each {platform: originKey} the team's copy of that
 * platform preset and each {preset: ref} the preset an earlier step made, by ID (the story's note).
 */
function asHeld(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asHeld);
  if (value === null || typeof value !== 'object') return value;
  if ('platform' in value) return platformIds.get(String(value.platform));
  if ('preset' in value) return made.get(String(value.preset));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asHeld(v)]));
}

/** The story's person calling the API, signed in `minutesAgo` before the harness clock. */
async function as(
  who: Who,
  method: 'GET' | 'POST',
  path: string,
  json?: unknown,
  minutesAgo = 0,
): Promise<Answer> {
  const token = await h.tokenFor(story.people[who].email, {
    authTime: new Date(h.clock.now.getTime() - minutesAgo * 60_000),
  });
  return call(h, path, { method, token, teamId, ...(json === undefined ? {} : { json }) });
}

async function userIdOf(email: string): Promise<string> {
  const [row] = await h.scratch.owner<{ id: string }[]>`select id from sineobex.users where email = ${email}`;
  return row!.id;
}

/** The transaction that wrote each of a preset's versions, then each of its events. */
async function rowXids(presetId: string): Promise<string[]> {
  const versions = await h.scratch.owner<{ xid: string }[]>`
    select xmin::text as xid from sineobex.team_preset_versions where preset_id = ${presetId}`;
  const events = await h.scratch.owner<{ xid: string }[]>`
    select xmin::text as xid from sineobex.team_preset_events where preset_id = ${presetId}`;
  return [...versions, ...events].map((r) => r.xid);
}

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  // The team as the owner console makes one, so it holds every platform preset (design 5.2), with
  // the story's people as db/seed/seed.ts makes its staff: only an owner appoints a Program Admin.
  await h.seedOwner('owner@example.com', 'Owner (demo)');
  const owner = await h.tokenFor('owner@example.com');
  const created = await call(h, '/v1/owner/teams', {
    method: 'POST',
    token: owner,
    json: { name: 'Demo Done when team' },
  });
  expect(created.status).toBe(201);
  teamId = created.body.id as string;
  const { programAdmin, staff } = story.people;
  expect(programAdmin.role).toBe('program_admin');
  const appointed = await call(h, `/v1/owner/teams/${teamId}/program-admins`, {
    method: 'POST',
    token: owner,
    json: { email: programAdmin.email, displayName: programAdmin.displayName },
  });
  expect(appointed.status).toBe(201);
  userIds.programAdmin = await userIdOf(programAdmin.email);
  await h.acknowledge(userIds.programAdmin);
  const member = await addMember(
    h,
    { teamId, adminToken: await h.tokenFor(programAdmin.email) },
    staff.email,
    staff.displayName,
    staff.role,
  );
  userIds.staff = member.id;
  phone = await FakePhone.create();
  await register(h, phone, member.token, teamId);
});

afterAll(async () => {
  // Nothing the story typed is in an audit event's details or a log line, over the whole run.
  await expectAuditClean(h, story.neverInAuditDetails);
  spy.expectClean(story.neverLogged);
  await h?.close();
});

describe('the Done when, the API’s half (design 10.1)', () => {
  it('step 1, as the server answers it: the phone registers the patient, then its first pull holds every platform preset at its newest version, at R', async () => {
    // Registered by the staff member's phone before step 1, so step 8's change names a patient the
    // server knows (the story's note).
    const { id, ...fields } = story.patient;
    const registered = await phone.change({
      entity: 'patient',
      recordId: id,
      op: 'create',
      value: intakeValue(fields),
    });
    const sent = results(
      (await push(h, phone, await h.tokenFor(story.people.staff.email), teamId, [registered])).body,
    );
    expect(sent.map((r) => r.status)).toEqual(['accepted']);

    // The pull with no revision of the phone's own.
    const expected = expectAt(1);
    const r = await as('staff', 'GET', '/v1/presets');
    expect(r.status).toBe(expected.pull.status);
    const first = r.body as unknown as Pull;
    expect(first.reset).toBe(expected.pull.reset);
    R = await revisionOf(h, teamId);
    expect(first.revision).toBe(R + expected.pull.revision);
    expect(R + expected.phone.revision).toBe(first.revision);
    epoch = first.epoch;
    expect(epoch).toBe((await stateOf(h, teamId))!.epoch);

    // Every platform preset, by origin key, at its newest version, naming the team's presets by ID.
    expect(expected.phone.holds).toMatch(/^every platform preset/);
    platformIds = new Map(first.presets.flatMap((x) => (x.originKey ? [[x.originKey, x.id] as const] : [])));
    const newest = newestOf(PLATFORM);
    expect(new Set(platformIds.keys())).toEqual(new Set(newest.map((e) => e.originKey)));
    expect(first.presets).toHaveLength(newest.length);
    for (const e of newest) {
      const held = first.presets.find((x) => x.originKey === e.originKey)!;
      expect(
        { kind: held.kind, state: held.state, version: held.version, body: held.body },
        e.originKey,
      ).toEqual({
        kind: e.kind,
        state: 'active',
        version: 1,
        body: withIds(e.kind, e.body, platformIds),
      });
    }
    // The story's names are new to the team.
    for (const preset of story.presets)
      expect(first.presets.filter((x) => x.kind === preset.kind && x.body.name === preset.body.name)).toEqual(
        [],
      );
  });

  for (const n of [2, 3, 4]) {
    const s = step(n);
    const preset = presetOf(s.adds!);
    it(`step ${n}: the Program Admin, signed in just now, adds ${preset.body.name} with a reason: 201 at R+${(s.expect as Added).revision}, the reason kept in its event and not in its audit event, which is in the write’s transaction`, async () => {
      const expected = s.expect as Added;
      const by = s.by!;
      expect([by, s.signedInMinutesAgo]).toEqual(['programAdmin', 0]);
      const body = asHeld(preset.body) as Body;
      const mark = await auditMark(h);
      const r = await as(by, 'POST', `/v1/admin/presets/${preset.kind}`, { body, reason: preset.reason });
      expect(r.status, JSON.stringify(r.body)).toBe(expected.status);
      const id = r.body.id as string;
      made.set(preset.ref, id);
      expect(r.body).toEqual({ id, version: expected.version, revision: R + expected.revision });

      // Its head, at version 1 and the write's revision, the team's own.
      expect(await headOf(h, id)).toMatchObject({
        teamId,
        kind: preset.kind,
        name: preset.body.name,
        state: expected.head.state,
        currentVersion: expected.head.version,
        customized: expected.head.customized,
        revision: R + expected.head.revision,
        originKey: null,
        createdBy: userIds[by],
        updatedBy: userIds[by],
      });
      // Its stored version, the body as sent, by the admin.
      expect(await versionsOf(h, id)).toEqual([
        {
          version: expected.storedVersion.version,
          body,
          source: expected.storedVersion.source,
          createdBy: userIds[expected.storedVersion.by],
        },
      ]);
      // Its event, holding the reason.
      expect(expected.event.holdsTheReason).toBe(true);
      expect(await eventsOf(h, id)).toEqual([
        {
          act: expected.event.act,
          version: expected.event.version,
          reason: preset.reason,
          createdBy: userIds[expected.event.by],
        },
      ]);

      // Its one audit event, the only one the write logged: on the preset, by the admin, with no
      // patient, holding its kind, version and revision and not the reason.
      const logged = (await auditAfter(h, mark)).filter((e) => e.teamId === teamId);
      expect(logged.map((e) => e.action)).toEqual(Array(expected.audit.count).fill(expected.audit.action));
      const [event] = logged;
      expect(event).toMatchObject({
        entity: expected.audit.entity,
        entityId: id,
        actorUserId: userIds[by],
        patientId: null,
        details: { kind: preset.kind, version: expected.version, revision: R + expected.revision },
      });
      expect(expected.audit.holdsTheReason).toBe(false);
      const details = JSON.stringify(event!.details);
      for (const text of [preset.reason, ...story.neverInAuditDetails]) expect(details).not.toContain(text);
      // In the write's own transaction: the head, its version, its event and the audit event were
      // written by one.
      expect(expected.audit.inTheWriteTransaction).toBe(true);
      const xid = await headXid(h, id);
      expect([...(await rowXids(id)), event!.xid]).toEqual([xid, xid, xid]);
      expect(await revisionOf(h, teamId)).toBe(R + expected.server.revision);
    });
  }

  it('step 5: the staff member is refused step 2’s write, logged access.denied; the admin with a sign-in older than 15 minutes is refused reauth_required, logged nowhere; nothing is written, and the revision stays where step 4 left it', async () => {
    const s = step(5);
    const before = await footprint(h, teamId);
    const expected = expectAt(5);
    expect(before.revision).toBe(R + expected.server.revision);
    expect(expected.server.written).toMatch(/^nothing/);
    let audited = before.audit;
    for (const attempt of s.attempts!) {
      const repeated = presetOf(attempt.repeats);
      expect(repeated.step).toBe(2);
      if (attempt.signedInMinutesAgo > 0)
        expect(attempt.signedInMinutesAgo).toBeGreaterThan(story.recentSignInMinutes);
      const mark = await auditMark(h);
      const r = await as(
        attempt.by,
        'POST',
        `/v1/admin/presets/${repeated.kind}`,
        { body: asHeld(repeated.body), reason: repeated.reason },
        attempt.signedInMinutesAgo,
      );
      // Read so that a write let through fails here by its status, not by a missing error.
      expect([r.status, r.body.error?.code], attempt.by).toEqual([
        attempt.expect.status,
        attempt.expect.code,
      ]);
      const logged = (await auditAfter(h, mark)).filter((e) => e.teamId === teamId);
      if (attempt.expect.audit === null) {
        expect(logged, attempt.by).toEqual([]);
      } else {
        const { action, count, details } = attempt.expect.audit;
        expect(logged.map((e) => e.action)).toEqual(Array(count).fill(action));
        expect(logged[0]).toMatchObject({ actorUserId: userIds[attempt.by], details });
        for (const text of [repeated.reason, ...story.neverInAuditDetails])
          expect(JSON.stringify(logged[0]!.details)).not.toContain(text);
      }
      audited += logged.length;
      // No head, version, event or preset audit event, and the same revision.
      expect(await footprint(h, teamId), attempt.by).toEqual({ ...before, audit: audited });
    }
  });

  it('step 6: the phone’s next pull, with the revision and the epoch it holds, answers exactly the three at R+3', async () => {
    const expected = expectAt(6).pull;
    expect(step(6).by).toBe('staff');
    const r = await as('staff', 'GET', `/v1/presets?since=${R + expected.since}&epoch=${epoch}`);
    expect(r.status).toBe(expected.status);
    const next = r.body as unknown as Pull;
    expect([next.reset, next.epoch]).toEqual([expected.reset, epoch]);
    expect(expected.exactly).toBe(true);
    const refOf = (id: string) => [...made].find(([, madeId]) => madeId === id)?.[0];
    expect(
      next.presets.map((p) => ({
        ref: refOf(p.id),
        kind: p.kind,
        name: p.body.name,
        version: p.version,
        state: p.state,
      })),
    ).toEqual(expected.presets);
    // Each as the admin added it.
    for (const p of next.presets)
      expect([p.originKey, p.body]).toEqual([null, asHeld(presetOf(refOf(p.id)!).body)]);
    expect(next.revision).toBe(R + expected.revision);
    expect(R + expectAt(6).phone.revision).toBe(next.revision);
  });

  it('step 8, as the server holds it: the phone’s flag change accepted with its hash, the flag on the chart, and one patient_flag.changed in the change’s transaction naming neither the flag nor the reason', async () => {
    const s = step(8);
    const change = s.flagChange!;
    expect([s.by, change.patient]).toEqual(['staff', story.patient.id]);
    const flagId = made.get(change.flag)!;
    const value = { patientId: change.patient, flagId, action: change.action, reason: change.reason };
    // Set offline a few minutes before the phone syncs.
    const offline = await phone.change({
      entity: 'patient_flag_change',
      op: 'create',
      value,
      deviceTime: new Date(h.clock.now.getTime() - 5 * 60_000).toISOString(),
    });
    const mark = await auditMark(h);
    const sent = await push(h, phone, await h.tokenFor(story.people.staff.email), teamId, [offline]);
    expect(sent.status).toBe(200);
    const [receipt] = results(sent.body);
    const expected = expectAt(8);
    expect(expected.receipts).toEqual({ status: 'accepted', hashConfirmed: true });
    expect([receipt!.changeId, receipt!.status, receipt!.hash]).toEqual([
      offline.changeId,
      'accepted',
      offline.valueHash,
    ]);

    // The audit event, one, on the change and its patient, in the transaction that stored the change
    // and its receipt: its action and tier, never its flag or its reason (CO-14, design 9).
    const audit = expected.server.audit;
    const logged = (await auditAfter(h, mark)).filter((e) => e.action === audit.action);
    expect(logged).toHaveLength(audit.count);
    const [event] = logged;
    expect(event).toMatchObject({
      entity: 'patient_flag_change',
      entityId: offline.recordId,
      patientId: change.patient,
      actorUserId: userIds.staff,
      details: audit.details,
    });
    expect(event!.details).not.toHaveProperty('flagId');
    expect(audit.holdsTheReason).toBe(false);
    const details = JSON.stringify(event!.details);
    for (const text of [flagId, change.reason, ...story.neverInAuditDetails])
      expect(details).not.toContain(text);
    expect(audit.inTheWriteTransaction).toBe(true);
    const [row] = await h.scratch.owner<{ xid: string }[]>`
      select xmin::text as xid from sineobex.patient_flag_changes where id = ${offline.recordId}`;
    const [kept] = await h.scratch.owner<{ xid: string }[]>`
      select xmin::text as xid from sineobex.sync_changes where change_id = ${offline.changeId}`;
    expect([kept!.xid, event!.xid]).toEqual([row!.xid, row!.xid]);

    // The chart as the portal reads it: the flag among the conditions, no risk level, and the change
    // in its history, by the staff member, with the reason.
    const read = await as('programAdmin', 'GET', `/v1/patients/${change.patient}`);
    expect(read.status).toBe(200);
    const flags = read.body.flags as {
      primary: unknown;
      secondary: { flagId: string }[];
      history: { flagId: string; action: string; authorName: string; reason?: string }[];
    };
    const current = expected.server.currentFlags;
    expect(flags.primary).toBe(current.primary);
    expect(flags.secondary.map((f) => f.flagId)).toEqual(
      current.secondary.map((ref: string) => made.get(ref)),
    );
    const chart = expected.chart;
    expect(flags.primary).toBe(chart.flags.primary);
    expect(flags.secondary).toEqual(
      chart.flags.secondary.map(({ flag, ...shown }) => ({
        flagId: made.get(flag),
        ...shown,
      })),
    );
    // A pill reads the colour's name, then the flag's.
    expect(chart.pill).toBe(`${chart.flags.secondary[0]!.colorName} · ${presetOf(change.flag).body.name}`);
    expect(
      flags.history.map((row) => ({
        flagId: row.flagId,
        action: row.action,
        by: row.authorName,
        reason: row.reason,
      })),
    ).toEqual(
      chart.history.map((row: { flag: string; action: string; by: Who; holdsTheReason: boolean }) => ({
        flagId: made.get(row.flag),
        action: row.action,
        by: story.people[row.by].displayName,
        reason: row.holdsTheReason ? change.reason : undefined,
      })),
    );
  });
});
