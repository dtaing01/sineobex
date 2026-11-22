import type { InstallSql } from '@sineobex/forms';
import { changedFixedFields, installTeamPresets, PLATFORM, type PresetKind } from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import { logSpy } from './patient-fixtures.ts';
import {
  auditAfter,
  auditMark,
  bodies,
  createdPreset,
  demoName,
  errorOf,
  eventsOf,
  expectNothingWritten,
  footprint,
  headOf,
  idOf,
  nextVersion,
  presetsApi,
  presetsTeam,
  REASON,
  referencesOf,
  releasePlatform,
  revisionOf,
  runInstaller,
  STALE_MINUTES,
  tokenOf,
  versionsOf,
  type Answer,
  type Body,
  type PresetsApi,
  type PresetsTeam,
} from './presets-fixtures.ts';

// The admin preset routes (phase 5 design 5.1, 7, 9; D129, D131, D132), written before them (cards
// P1-store to P1-order) and held to the shapes below. Where the design leaves a shape open, this
// block settles it from the code's conventions (lib/errors.ts, routes/schemas.ts); the route cards
// build to it. "Admin" is team.manage_presets. presetWriteEffect (packages/presets/src/rules.ts)
// answers what each act does and refuses, in its order; the routes call it, never re-derive it.
//
//   GET  /v1/admin/presets/{kind}                        Admin               200 [row]
//   POST /v1/admin/presets/{kind}                        Admin, recent       201 {id, version: 1, revision}
//        {body, reason}
//   PUT  /v1/admin/presets/{kind}/{id}                   Admin, recent       200 {version, revision}
//        {baseVersion, body, reason}
//   POST /v1/admin/presets/{kind}/{id}/archive           Admin, recent       200 {revision}
//        {baseVersion, reason}
//   POST /v1/admin/presets/{kind}/{id}/restore           Admin, recent       200 {revision}
//        {reason}
//   POST /v1/admin/presets/{kind}/{id}/take-update       Admin, recent       200 {id, version, revision}
//        {baseVersion, reason, asNew}                                         (as new: the new preset's
//                                                                             id, version 1)
//   GET  /v1/admin/presets/{kind}/{id}/history           Admin               200 [event]
//   POST /v1/admin/preset-order/flag                     Admin, recent       200 {changed}
//        {tier, ids, reason}                                                  (how many flags moved)
//
// {kind} is one of the eight kinds, else 422 validation_failed. {id} names a preset of that kind in
// the caller's team, else 404 not_found (an unknown ID, another kind's, another team's). A list
// row is {id, name, state, version, customized, updateOnOffer, updateChangesFixed, referencedBy,
// body}, one for every preset of the kind, archived ones included: `referencedBy` counts the active
// presets whose body names it, by kind, only the kinds that do ({} when none); `updateOnOffer` is
// platform_latest above origin_version, and `updateChangesFixed` whether that platform version
// changes a field fixed at creation (false with no offer). A history row is {act, version, source,
// by, at, reason, body} for each of the preset's events, oldest first: `source` and `body` the
// version the act made or stood on, `by` {userId, displayName}, null for the installer, `at` the
// event's time as an ISO 8601 string, `reason` null for the installer.
//
// A write's reason is `reason`: a string, trimmed, 3 to 300 characters counted in code points, as
// the database counts them; anything else is 422 validation_failed, with `reason` among
// details.fields' paths. It is kept trimmed in team_preset_events and never in audit details.
// Every write asks for a sign-in within RECENT_AUTH_MINUTES: a stale one is 403 reauth_required,
// written nowhere. A caller without team.manage_presets is 403 forbidden, logged access.denied with
// {permission: 'team.manage_presets', route}, checked before the sign-in's age. Refusals, each
// {error: {code, message, details?}} (lib/errors.ts), and nothing written with any of them:
//   422 invalid          details.problems [{path, code}]: the body fails its kind's schema (each
//                        issue's path, joined by dots, under the body) or validatePreset (its
//                        problems as it answers them, sensitive_path among them). A text no
//                        database can store (a NUL, a lone surrogate) is refused here too.
//   409 reference_archived  details.problems [{path, code: 'reference_archived'}], when every
//                        problem validatePreset found is an archived reference.
//   409 name_taken       another active preset of the kind holds the name, as the database folds
//                        names (lower(), the unique index team_presets_active_name); a 23505 on
//                        that index is this answer too, never a 500.
//   409 stale            details.currentVersion: baseVersion is not the head's current version.
//   409 archived, not_archived, referenced (details.referencedBy, as a list row's), not_removable,
//       no_update
//   409 fixed_field      take-update in place, details.fields; 422 fixed_field on an edit,
//                        details.fields: changedFixedFields(kind, current, sent) either way.
//   422 no_change        the body sent, as its schema parses it, is the current one.
//   422 ids_mismatch     a reorder's ids are not exactly the tier's active flags (an archived one,
//                        another tier's, one twice, one left out, one unknown).
// What each write stores (design 4.1, 4.2, 5.1): every head it touches carries the one revision
// the write took, its team's next; a version a person writes is source 'team', created_by them; a
// version taken from the platform is source 'platform', created_by null, while its event names the
// person and the reason; each act writes one team_preset_events row per preset it changes, by the
// person, with the reason: created (v1), updated (the new version), archived and restored (the
// version it stands on), update_taken (in place, the new version; as new, the new preset's 1, and
// the old one, when it was active, archived at its version, its origin_key gone, with no event when
// it was archived already), reordered (each moved flag's new version). A head a person writes names
// them in updated_by (and created_by, when it is new).
//
// The audit events and their details are held by presets-audit.test.ts, the revision and the lock
// by presets-revision.test.ts, references across every kind by presets-refs.test.ts.

// This file's platform is its own copy, so the platform updates below can be released into it.
vi.mock('../../../packages/presets/data/platform.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});

const KINDS_MADE = [
  'order_category',
  'item',
  'bundle',
  'flag',
  'field_supply_map',
  'condition_supply_map',
  'bag',
] as const satisfies readonly PresetKind[];

const spy = logSpy();
let h: Harness;
let team: PresetsTeam;
let other: PresetsTeam;
let api: PresetsApi;
let make: ReturnType<typeof bodies>;

beforeAll(async () => {
  h = await createHarness({ log: spy.log });
  team = await presetsTeam(h, 'Routes');
  other = await presetsTeam(h, 'Routes Other');
  api = presetsApi(h, team.teamId, team.admin);
  make = bodies(team);
});
afterAll(async () => {
  // No reason, no name and no body text reaches a log line (design 9).
  spy.expectClean([
    'Demo: the team asked',
    'Demo: made for the test',
    'Demo: a reason',
    'Demo: category',
    'Demo: item',
  ]);
  await h?.close();
});

/** The refusal's status and code; answers its details. */
function refused(r: Answer, status: number, code: string) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(errorOf(r).code).toBe(code);
  return errorOf(r).details ?? {};
}

/** Runs `act`, which must be refused so, and checks it wrote nothing in the team. */
async function refusedUnwritten(
  act: () => Promise<Answer>,
  status: number,
  code: string,
  teamId = team.teamId,
) {
  const before = await footprint(h, teamId);
  const details = refused(await act(), status, code);
  await expectNothingWritten(h, teamId, before);
  return details;
}

/** The current body of a preset, as stored. */
const currentBody = async (id: string) => {
  const head = await headOf(h, id);
  return (await versionsOf(h, id)).find((v) => v.version === head!.currentVersion)!.body;
};

/** A valid body of the kind; an item is a supply item. */
const bodyOf = (kind: PresetKind) => (make as unknown as Record<PresetKind, () => Body>)[kind]();

/** A change to each kind's body that touches no field fixed at creation. */
const FREE_CHANGE: { [K in (typeof KINDS_MADE)[number] | 'settings']: (b: Body) => Body } = {
  order_category: (b) => ({ ...b, sort: 61 }),
  item: (b) => ({ ...b, captureLot: true }),
  bundle: (b) => ({ ...b, prompt: 'Demo: ask about pain first.' }),
  flag: (b) => ({ ...b, criteria: 'Demo: changed criteria', color: 'purple', rank: 55 }),
  field_supply_map: (b) => ({ ...b, when: { includes: 'clothing' } }),
  condition_supply_map: (b) => ({ ...b, codes: ['L30.9', 'R21'] }),
  bag: (b) => ({ ...b, minimums: [{ itemId: idOf(team, 'item.gauze'), min: 20 }] }),
  settings: (b) => ({ ...b, problemCheckDays: 60 }),
};

describe('creating a preset (design 5.1, 7)', () => {
  for (const kind of KINDS_MADE) {
    it(`makes a ${kind} at version 1 as sent, with its event and the reason trimmed, at the team’s next revision`, async () => {
      const r0 = await revisionOf(h, team.teamId);
      const body = bodyOf(kind);
      const r = await api.create(kind, body, '   Demo: made for the test \n');
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toEqual({ id: expect.any(String), version: 1, revision: r0 + 1 });
      const id = r.body.id as string;
      expect(await headOf(h, id)).toMatchObject({
        teamId: team.teamId,
        kind,
        name: body.name,
        state: 'active',
        currentVersion: 1,
        originKey: null,
        originVersion: null,
        platformLatest: null,
        customized: false,
        revision: r0 + 1,
        createdBy: team.admin.userId,
        updatedBy: team.admin.userId,
      });
      expect(await versionsOf(h, id)).toEqual([
        { version: 1, body, source: 'team', createdBy: team.admin.userId },
      ]);
      expect(await eventsOf(h, id)).toEqual([
        { act: 'created', version: 1, reason: 'Demo: made for the test', createdBy: team.admin.userId },
      ]);
      expect(await revisionOf(h, team.teamId)).toBe(r0 + 1);
    });
  }

  it('makes a Labs item, which records a result', async () => {
    const body = make.labItem();
    const { id } = await createdPreset(api, 'item', body);
    expect(await versionsOf(h, id)).toEqual([expect.objectContaining({ body })]);
  });

  it('stores a body as its schema parses it: a default left out is filled in', async () => {
    const bundle = make.bundle();
    delete bundle.prompt;
    const flag = make.flag();
    delete flag.criteria;
    const b = await createdPreset(api, 'bundle', bundle);
    const f = await createdPreset(api, 'flag', flag);
    expect(await currentBody(b.id)).toEqual({ ...bundle, prompt: '' });
    expect(await currentBody(f.id)).toEqual({ ...flag, criteria: '' });
  });

  it('makes no second settings preset: 422 invalid, settings_taken', async () => {
    const details = await refusedUnwritten(() => api.create('settings', make.settings()), 422, 'invalid');
    expect(details.problems).toEqual([{ path: '', code: 'settings_taken' }]);
  });

  it('refuses a body its kind’s schema refuses: 422 invalid, at each field at fault', async () => {
    const cases: [PresetKind, Body, string][] = [
      ['order_category', make.order_category({ behaviour: 'tools' }), 'behaviour'],
      ['item', make.item({ unit: 'u'.repeat(21) }), 'unit'],
      ['item', make.item({ name: ' Demo: padded' }), 'name'],
      ['bundle', make.bundle({ lines: [] }), 'lines'],
      ['flag', make.flag({ color: 'magenta' }), 'color'],
      ['field_supply_map', { ...make.field_supply_map(), when: undefined }, 'when'],
      ['condition_supply_map', make.condition_supply_map({ codes: ['not a code'] }), 'codes.0'],
      [
        'bag',
        make.bag({
          minimums: [
            { itemId: idOf(team, 'item.gauze'), min: 1 },
            { itemId: idOf(team, 'item.gauze'), min: 2 },
          ],
        }),
        'minimums.1.itemId',
      ],
      ['settings', make.settings({ problemCheckDays: 400 }), 'problemCheckDays'],
    ];
    for (const [kind, body, path] of cases) {
      const details = await refusedUnwritten(() => api.create(kind, body), 422, 'invalid');
      const paths = (details.problems as { path: string }[]).map((p) => p.path);
      expect(paths, `${kind} ${path}`).toContainEqual(path);
    }
    // Every object is strict: a key the server does not know is refused, never stored.
    await refusedUnwritten(() => api.create('flag', { ...make.flag(), shade: 'dark' }), 422, 'invalid');
    // A body that is not an object at all.
    await refusedUnwritten(() => api.create('flag', 'Demo: a flag'), 422, 'invalid');
  });

  it('refuses a body validatePreset refuses: 422 invalid, with its problems', async () => {
    const cases: [PresetKind, Body, { path: string; code: string }][] = [
      [
        'item',
        make.item({ result: { type: 'number', unit: 'mg/dL' } }),
        { path: 'result', code: 'result_mismatch' },
      ],
      [
        'item',
        make.item({ categoryId: idOf(team, 'order_category.rx'), medical: false }),
        { path: 'medical', code: 'medical_mismatch' },
      ],
      [
        'bundle',
        make.bundle({
          medical: false,
          lines: [{ itemId: idOf(team, 'item.acetaminophen'), qty: 1, core: true }],
        }),
        { path: 'medical', code: 'bundle_not_medical' },
      ],
      [
        'flag',
        make.flag({ tier: 'primary', sensitive: true }),
        { path: 'sensitive', code: 'primary_sensitive' },
      ],
      [
        'bundle',
        make.bundle({ lines: [{ itemId: '00000000-0000-4000-8000-0000000000aa', qty: 1, core: true }] }),
        { path: 'lines.0.itemId', code: 'unknown_reference' },
      ],
      [
        'bundle',
        make.bundle({ lines: [{ itemId: idOf(team, 'order_category.supplies'), qty: 1, core: true }] }),
        { path: 'lines.0.itemId', code: 'wrong_kind' },
      ],
      [
        // Another team's preset is not among this team's: unknown here.
        'bag',
        make.bag({ minimums: [{ itemId: idOf(other, 'item.gauze'), min: 5 }] }),
        { path: 'minimums.0.itemId', code: 'unknown_reference' },
      ],
      [
        'field_supply_map',
        make.field_supply_map({ noteTypeKey: 'no_such_type' }),
        { path: 'noteTypeKey', code: 'unknown_note_type' },
      ],
      [
        // A sensitive note type is refused whole (sensitive_path): harm reduction holds naloxone.
        'field_supply_map',
        make.field_supply_map({
          noteTypeKey: 'harm_reduction',
          path: 'provided.naloxone',
          when: { equals: 'accepted' },
        }),
        { path: 'noteTypeKey', code: 'sensitive_path' },
      ],
      [
        // An exam only some readers of the note may read (general_primary_care's GU exam).
        'field_supply_map',
        make.field_supply_map({
          noteTypeKey: 'general_primary_care',
          path: 'exam.systems',
          when: { includes: 'gu' },
        }),
        { path: 'path', code: 'sensitive_path' },
      ],
      [
        'field_supply_map',
        make.field_supply_map({ path: 'outreach.no_such_field' }),
        { path: 'path', code: 'unknown_path' },
      ],
    ];
    for (const [kind, body, problem] of cases) {
      const details = await refusedUnwritten(() => api.create(kind, body), 422, 'invalid');
      expect(details.problems, `${kind} ${problem.code}`).toContainEqual(problem);
    }
  });

  it('lets a map fire on an exam every reader of the note reads', async () => {
    await createdPreset(
      api,
      'field_supply_map',
      make.field_supply_map({
        noteTypeKey: 'general_primary_care',
        path: 'exam.systems',
        when: { includes: 'skin' },
      }),
    );
  });

  it('refuses a text no database can store, never a 500', async () => {
    await refusedUnwritten(
      () => api.create('flag', make.flag({ name: 'Demo: nul \u0000 flag' })),
      422,
      'invalid',
    );
    await refusedUnwritten(
      () => api.create('flag', make.flag({ criteria: 'Demo: half a pair \ud800 here' })),
      422,
      'invalid',
    );
  });

  it('refuses a name another active preset of the kind holds, as the database folds names', async () => {
    const taken = await createdPreset(api, 'item', make.item({ name: 'Demo: Taken name' }));
    await refusedUnwritten(
      () => api.create('item', make.item({ name: 'Demo: Taken name' })),
      409,
      'name_taken',
    );
    await refusedUnwritten(
      () => api.create('item', make.item({ name: 'DEMO: taken NAME' })),
      409,
      'name_taken',
    );
    // Names are per kind, and an archived preset frees its name.
    await createdPreset(api, 'bundle', make.bundle({ name: 'Demo: Taken name' }));
    expect((await api.archive('item', taken.id, 1)).status).toBe(200);
    await createdPreset(api, 'item', make.item({ name: 'Demo: Taken name' }));
  });

  it('compares names as the database does, where JavaScript would fold them otherwise', async () => {
    // Final sigma: JavaScript folds ΟΔΟΣ to οδος, the database to οδοσ. Dotted İ: the database folds
    // it to i, JavaScript to i and a combining dot. Whatever the database answers is the answer.
    // Each pair is tried both ways round, so neither the name sent nor the name held may be folded
    // in JavaScript: with οδος held, ΟΔΟΣ folded so would be refused a name the database lets it take.
    for (const [first, second] of [
      ['Demo: ΟΔΟΣ kit', 'Demo: οδος kit'],
      ['Demo: οδος pack', 'Demo: ΟΔΟΣ pack'],
      ['Demo: İodine swab', 'Demo: iodine swab'],
      ['Demo: iodine pad', 'Demo: İodine pad'],
    ] as const) {
      await createdPreset(api, 'item', make.item({ name: first }));
      const [fold] = await h.scratch.owner<
        { same: boolean }[]
      >`select lower(${first}) = lower(${second}) as same`;
      if (fold!.same)
        await refusedUnwritten(() => api.create('item', make.item({ name: second })), 409, 'name_taken');
      else await createdPreset(api, 'item', make.item({ name: second }));
    }
  });

  it('answers name_taken, never a 500, when the database’s unique name refuses the insert', async () => {
    // A head of the same name written in the same statement, as only a writer that skipped the team
    // lock could: the route's own check found the name free, and the index refuses the insert.
    await h.scratch.owner.unsafe(`
      create function sineobex.test_name_race() returns trigger language plpgsql as $$
      begin
        if new.name = 'Demo: Raced name' and pg_trigger_depth() = 1 then
          insert into sineobex.team_presets (team_id, kind, name, current_version, revision)
          values (new.team_id, new.kind, new.name, 1, new.revision);
        end if;
        return new;
      end $$;
      create trigger test_name_race before insert on sineobex.team_presets
        for each row execute function sineobex.test_name_race()`);
    try {
      await refusedUnwritten(
        () => api.create('flag', make.flag({ name: 'Demo: Raced name' })),
        409,
        'name_taken',
      );
    } finally {
      await h.scratch.owner.unsafe(`
        drop trigger test_name_race on sineobex.team_presets;
        drop function sineobex.test_name_race()`);
    }
  });

  it('refuses a body that points at an archived preset: 409 reference_archived, with the path', async () => {
    const category = await createdPreset(api, 'order_category', make.order_category());
    expect((await api.archive('order_category', category.id, 1)).status).toBe(200);
    const details = await refusedUnwritten(
      () => api.create('item', make.item({ categoryId: category.id })),
      409,
      'reference_archived',
    );
    expect(details.problems).toEqual([{ path: 'categoryId', code: 'reference_archived' }]);
    // A name in use is answered first, as presetWriteEffect orders them.
    const named = await createdPreset(api, 'item', make.item());
    const name = (await currentBody(named.id)).name;
    await refusedUnwritten(
      () => api.create('item', make.item({ name, categoryId: category.id })),
      409,
      'name_taken',
    );
  });

  it('refuses a kind it does not know, and a body or reason that is not there', async () => {
    for (const kind of ['billing_code_map', 'nonsense']) {
      const r = await api.create(kind, make.flag());
      expect(r.status, kind).toBe(422);
      expect(errorOf(r).code).toBe('validation_failed');
    }
    const before = await footprint(h, team.teamId);
    const r = await api.send('POST', '/v1/admin/presets/flag', { reason: REASON });
    expect(r.status).toBe(422);
    expect(
      await api.send('POST', '/v1/admin/presets/flag', { body: make.flag() }).then((x) => x.status),
    ).toBe(422);
    await expectNothingWritten(h, team.teamId, before);
  });
});

describe('a request that is not well formed (design 7)', () => {
  it('refuses a base version, an asNew, ids or an ID in the address that are not what they say, never with a 500', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const changed = FREE_CHANGE.flag(body);
    const tier = await activeFlags('secondary');
    const sends: [string, () => Promise<Answer>][] = [
      [
        'a base version as text',
        () =>
          api.send('PUT', `/v1/admin/presets/flag/${id}`, {
            baseVersion: '1',
            body: changed,
            reason: REASON,
          }),
      ],
      ['a fractional base version', () => api.edit('flag', id, 1.5, changed)],
      ['a base version below 1', () => api.archive('flag', id, 0)],
      ['no base version', () => api.send('POST', `/v1/admin/presets/flag/${id}/archive`, { reason: REASON })],
      [
        'an asNew that is not a boolean',
        () =>
          api.send('POST', `/v1/admin/presets/flag/${id}/take-update`, {
            baseVersion: 1,
            reason: REASON,
            asNew: 'yes',
          }),
      ],
      [
        'ids that are not a list',
        () =>
          api.send('POST', '/v1/admin/preset-order/flag', {
            tier: 'secondary',
            ids: tier[0],
            reason: REASON,
          }),
      ],
      ['an id that is no UUID', () => api.reorder('secondary', [...tier.slice(1), 'not-a-uuid'])],
    ];
    // Refused, as a malformed request or by what it then means, and nothing written.
    for (const [label, send] of sends) {
      const before = await footprint(h, team.teamId);
      const r = await send();
      expect([409, 422], `${label}: ${r.status} ${JSON.stringify(r.body)}`).toContainEqual(r.status);
      await expectNothingWritten(h, team.teamId, before);
    }
    // An ID in the address that is no UUID names no preset.
    for (const path of ['/v1/admin/presets/flag/not-a-uuid/history', '/v1/admin/presets/flag/12345']) {
      const r = await api.send('GET', path);
      expect([404, 422], path).toContainEqual(r.status);
    }
    const before = await footprint(h, team.teamId);
    const r = await api.edit('flag', 'not-a-uuid', 1, changed);
    expect([404, 422]).toContainEqual(r.status);
    await expectNothingWritten(h, team.teamId, before);
  });

  it('refuses a create or an edit with no body as malformed, naming it, as its contract holds it required', async () => {
    // Any JSON value reaches the store, which answers 422 invalid for one that is no body of the
    // kind; one left out is the request's own refusal, as a reason left out is.
    const { id } = await createdPreset(api, 'flag', make.flag());
    const sends: [string, () => Promise<Answer>][] = [
      ['create', () => api.send('POST', '/v1/admin/presets/flag', { reason: REASON })],
      ['edit', () => api.send('PUT', `/v1/admin/presets/flag/${id}`, { baseVersion: 1, reason: REASON })],
    ];
    for (const [act, send] of sends) {
      const before = await footprint(h, team.teamId);
      const r = await send();
      expect(r.status, `${act}: ${JSON.stringify(r.body)}`).toBe(422);
      expect(errorOf(r).code, act).toBe('validation_failed');
      expect(errorOf(r).details!.fields, act).toEqual([{ path: 'body', problem: 'invalid_type' }]);
      await expectNothingWritten(h, team.teamId, before);
    }
    // A body that is there but no object is the store's to refuse, with its path.
    for (const body of [null, 3, 'Demo: not a body']) {
      const r = await api.create('flag', body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(errorOf(r).code, JSON.stringify(body)).toBe('invalid');
    }
  });

  it('refuses a base version that is not a whole number from 1 as malformed, naming it, never as stale', async () => {
    // As stale, the answer would send the person to reload a preset nobody else changed.
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const bases: [string, Record<string, unknown>][] = [
      ['as text', { baseVersion: '1' }],
      ['fractional', { baseVersion: 1.5 }],
      ['zero', { baseVersion: 0 }],
      ['null', { baseVersion: null }],
      ['beyond the column', { baseVersion: 2 ** 31 }],
      ['left out', {}],
    ];
    for (const [label, base] of bases) {
      const sends: [string, () => Promise<Answer>][] = [
        [
          'edit',
          () =>
            api.send('PUT', `/v1/admin/presets/flag/${id}`, {
              ...base,
              body: FREE_CHANGE.flag(body),
              reason: REASON,
            }),
        ],
        [
          'archive',
          () => api.send('POST', `/v1/admin/presets/flag/${id}/archive`, { ...base, reason: REASON }),
        ],
      ];
      for (const [act, send] of sends) {
        const before = await footprint(h, team.teamId);
        const r = await send();
        expect(r.status, `${act}, ${label}: ${JSON.stringify(r.body)}`).toBe(422);
        expect(errorOf(r).code, `${act}, ${label}`).toBe('validation_failed');
        expect(
          (errorOf(r).details!.fields as { path: string }[]).map((f) => f.path),
          `${act}, ${label}`,
        ).toContainEqual('baseVersion');
        await expectNothingWritten(h, team.teamId, before);
      }
    }
  });
});

describe('editing a preset (design 5.1, 7)', () => {
  for (const kind of KINDS_MADE) {
    it(`gives a ${kind} its next version, customized, with its event and reason`, async () => {
      const body = bodyOf(kind);
      const { id } = await createdPreset(api, kind, body);
      const r0 = await revisionOf(h, team.teamId);
      const changed = FREE_CHANGE[kind](body);
      const r = await api.edit(kind, id, 1, changed, '  Demo: a reason to edit  ');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toEqual({ version: 2, revision: r0 + 1 });
      expect(await headOf(h, id)).toMatchObject({
        state: 'active',
        currentVersion: 2,
        name: changed.name,
        customized: true,
        revision: r0 + 1,
        createdBy: team.admin.userId,
        updatedBy: team.admin.userId,
      });
      expect(await versionsOf(h, id)).toEqual([
        { version: 1, body, source: 'team', createdBy: team.admin.userId },
        { version: 2, body: changed, source: 'team', createdBy: team.admin.userId },
      ]);
      expect((await eventsOf(h, id)).map((e) => [e.act, e.version, e.reason, e.createdBy])).toEqual([
        ['created', 1, REASON, team.admin.userId],
        ['updated', 2, 'Demo: a reason to edit', team.admin.userId],
      ]);
    });
  }

  it('edits the team’s settings, and a platform preset, which becomes the team’s own', async () => {
    const settings = idOf(team, 'settings.team');
    const current = await headOf(h, settings);
    const body = FREE_CHANGE.settings(await currentBody(settings));
    const r = await api.edit('settings', settings, current!.currentVersion, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await headOf(h, settings)).toMatchObject({
      currentVersion: current!.currentVersion + 1,
      customized: true,
      originKey: 'settings.team',
    });
    const frost = idOf(team, 'flag.frost_risk');
    const edited = await api.edit('flag', frost, 1, FREE_CHANGE.flag(await currentBody(frost)));
    expect(edited.status).toBe(200);
    expect(await headOf(h, frost)).toMatchObject({
      customized: true,
      originKey: 'flag.frost_risk',
      originVersion: 1,
    });
  });

  it('moves an item between two categories that are not Labs', async () => {
    const own = await createdPreset(api, 'order_category', make.order_category());
    const body = make.item();
    const { id } = await createdPreset(api, 'item', body);
    expect((await api.edit('item', id, 1, { ...body, categoryId: own.id })).status).toBe(200);
  });

  it('refuses a field fixed at creation, for every kind that has one: 422 fixed_field', async () => {
    const cases: [PresetKind, Body, (b: Body) => Body][] = [
      ['order_category', make.order_category(), (b) => ({ ...b, behaviour: 'lab' })],
      ['item', make.item(), (b) => ({ ...b, unit: 'box' })],
      [
        'item',
        make.labItem(),
        (b) => ({ ...b, result: { type: 'choice', options: ['Demo: low', 'Demo: high'] } }),
      ],
      [
        // Into Labs: no result becomes one, which is result.type, so an item never moves into Labs.
        'item',
        make.item(),
        (b) => ({
          ...b,
          categoryId: idOf(team, 'order_category.labs'),
          medical: true,
          result: { type: 'number', unit: 'mg/dL' },
        }),
      ],
      ['flag', make.flag(), (b) => ({ ...b, tier: 'primary' })],
      ['flag', make.flag(), (b) => ({ ...b, sensitive: true })],
      [
        'field_supply_map',
        make.field_supply_map(),
        (b) => ({ ...b, path: 'outreach.type', when: { includes: 'outreach' } }),
      ],
      ['field_supply_map', make.field_supply_map(), (b) => ({ ...b, path: undefined, when: undefined })],
      [
        'field_supply_map',
        make.field_supply_map(),
        (b) => ({
          ...b,
          noteTypeKey: 'quick_encounter',
          path: 'social.support',
          when: { includes: 'hygiene_kit' },
        }),
      ],
    ];
    for (const [kind, body, change] of cases) {
      const { id } = await createdPreset(api, kind, body);
      const sent = JSON.parse(JSON.stringify(change(body))) as Body;
      const details = await refusedUnwritten(() => api.edit(kind, id, 1, sent), 422, 'fixed_field');
      expect(details.fields, kind).toEqual(changedFixedFields(kind, body as never, sent as never));
      expect((details.fields as string[]).length).toBeGreaterThan(0);
    }
  });

  it('lets every field change on a kind with none fixed', async () => {
    const item = idOf(team, 'item.bandage');
    const cases: [PresetKind, Body, Body][] = [
      [
        'bundle',
        make.bundle(),
        {
          name: demoName('bundle'),
          medical: true,
          prompt: 'Demo: ask first.',
          lines: [{ itemId: item, qty: 3, core: false }],
        },
      ],
      [
        'condition_supply_map',
        make.condition_supply_map(),
        { name: demoName('condition map'), codes: ['R21'], lines: [{ itemId: item, qtyPerPatient: 2 }] },
      ],
      ['bag', make.bag(), { name: demoName('bag'), minimums: [{ itemId: item, min: 3 }] }],
    ];
    for (const [kind, body, next] of cases) {
      const { id } = await createdPreset(api, kind, body);
      const r = await api.edit(kind, id, 1, next);
      expect(r.status, `${kind}: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it('refuses a stale base: 409 stale, with the current version', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    expect((await api.edit('flag', id, 1, FREE_CHANGE.flag(body))).status).toBe(200);
    for (const base of [1, 3]) {
      const details = await refusedUnwritten(
        () => api.edit('flag', id, base, { ...body, rank: 77 }),
        409,
        'stale',
      );
      expect(details.currentVersion).toBe(2);
    }
  });

  it('refuses an edit of an archived preset: 409 archived, before a stale base', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    expect((await api.archive('flag', id, 1)).status).toBe(200);
    await refusedUnwritten(() => api.edit('flag', id, 1, FREE_CHANGE.flag(body)), 409, 'archived');
    await refusedUnwritten(() => api.edit('flag', id, 7, FREE_CHANGE.flag(body)), 409, 'archived');
  });

  it('refuses a body that changes nothing: 422 no_change, as its schema parses it, whatever the key order', async () => {
    const body = make.bundle();
    const { id } = await createdPreset(api, 'bundle', body);
    await refusedUnwritten(() => api.edit('bundle', id, 1, body), 422, 'no_change');
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    await refusedUnwritten(() => api.edit('bundle', id, 1, reordered), 422, 'no_change');
    const { prompt: _prompt, ...noPrompt } = body;
    await refusedUnwritten(() => api.edit('bundle', id, 1, noPrompt), 422, 'no_change');
    // A stale base is answered before an unchanged body.
    await refusedUnwritten(() => api.edit('bundle', id, 2, body), 409, 'stale');
  });

  it('refuses a name another active preset holds, but not the preset’s own name in another case', async () => {
    const a = make.flag();
    const b = make.flag();
    await createdPreset(api, 'flag', a);
    const { id } = await createdPreset(api, 'flag', b);
    await refusedUnwritten(() => api.edit('flag', id, 1, { ...b, name: a.name }), 409, 'name_taken');
    const recased = String(b.name).toUpperCase().replace('DEMO:', 'Demo:');
    expect((await api.edit('flag', id, 1, { ...b, name: recased })).status).toBe(200);
    // The head carries the new name, which the database's unique name reads.
    expect(await headOf(h, id)).toMatchObject({ name: recased, currentVersion: 2 });
    const renamed = { ...b, name: demoName('flag renamed') };
    expect((await api.edit('flag', id, 2, renamed)).status).toBe(200);
    expect(await headOf(h, id)).toMatchObject({ name: renamed.name });
    // Its old name is free again.
    await createdPreset(api, 'flag', make.flag({ name: recased }));
  });

  it('refuses a fixed field before a name in use, as presetWriteEffect orders them', async () => {
    const a = make.flag();
    const b = make.flag();
    await createdPreset(api, 'flag', a);
    const { id } = await createdPreset(api, 'flag', b);
    await refusedUnwritten(
      () => api.edit('flag', id, 1, { ...b, name: a.name, tier: 'primary' }),
      422,
      'fixed_field',
    );
  });

  it('refuses an edit that points at an archived preset: 409 reference_archived', async () => {
    const gone = await createdPreset(api, 'item', make.item());
    expect((await api.archive('item', gone.id, 1)).status).toBe(200);
    const body = make.bundle();
    const { id } = await createdPreset(api, 'bundle', body);
    const details = await refusedUnwritten(
      () => api.edit('bundle', id, 1, { ...body, lines: [{ itemId: gone.id, qty: 1, core: true }] }),
      409,
      'reference_archived',
    );
    expect(details.problems).toEqual([{ path: 'lines.0.itemId', code: 'reference_archived' }]);
  });

  it('refuses an invalid body: 422 invalid', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const details = await refusedUnwritten(
      () => api.edit('flag', id, 1, { ...body, rank: -1 }),
      422,
      'invalid',
    );
    expect((details.problems as { path: string }[]).map((p) => p.path)).toContainEqual('rank');
  });

  it('answers 404 for a preset that is not one of this kind in this team', async () => {
    const { id } = await createdPreset(api, 'flag', make.flag());
    await refusedUnwritten(
      () => api.edit('flag', '00000000-0000-4000-8000-0000000000ab', 1, make.flag()),
      404,
      'not_found',
    );
    await refusedUnwritten(() => api.edit('bundle', id, 1, make.bundle()), 404, 'not_found');
    await refusedUnwritten(
      () => api.edit('item', idOf(other, 'item.gauze'), 1, make.item()),
      404,
      'not_found',
    );
    // And the route that answers them finds a preset that is one.
    expect((await api.edit('flag', id, 1, make.flag())).status).toBe(200);
  });

  it('finds a preset whose ID the address writes in capitals, as the database reads a UUID', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const r = await api.edit('flag', id.toUpperCase(), 1, FREE_CHANGE.flag(body));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await headOf(h, id)).toMatchObject({ currentVersion: 2 });
  });
});

describe('archiving and restoring a preset (design 5.1, 7)', () => {
  for (const kind of KINDS_MADE) {
    it(`archives a ${kind} at the version it is at, and restores it there, customized, an event each`, async () => {
      const { id } = await createdPreset(api, kind, bodyOf(kind));
      const r0 = await revisionOf(h, team.teamId);
      const archived = await api.archive(kind, id, 1, ' Demo: a reason to archive ');
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      expect(archived.body).toEqual({ revision: r0 + 1 });
      expect(await headOf(h, id)).toMatchObject({
        state: 'archived',
        currentVersion: 1,
        customized: true,
        revision: r0 + 1,
        updatedBy: team.admin.userId,
      });
      const restored = await api.restore(kind, id, 'Demo: a reason to restore');
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      expect(restored.body).toEqual({ revision: r0 + 2 });
      expect(await headOf(h, id)).toMatchObject({
        state: 'active',
        currentVersion: 1,
        customized: true,
        revision: r0 + 2,
      });
      // Neither act writes a version: the body is as it was.
      expect((await versionsOf(h, id)).map((v) => v.version)).toEqual([1]);
      expect((await eventsOf(h, id)).map((e) => [e.act, e.version, e.reason])).toEqual([
        ['created', 1, REASON],
        ['archived', 1, 'Demo: a reason to archive'],
        ['restored', 1, 'Demo: a reason to restore'],
      ]);
    });
  }

  it('never archives the settings preset: 409 not_removable, before a stale base', async () => {
    const settings = idOf(team, 'settings.team');
    const head = await headOf(h, settings);
    await refusedUnwritten(
      () => api.archive('settings', settings, head!.currentVersion),
      409,
      'not_removable',
    );
    await refusedUnwritten(() => api.archive('settings', settings, 99), 409, 'not_removable');
  });

  it('refuses a preset an active preset points at: 409 referenced, with the counts by kind', async () => {
    const item = await createdPreset(api, 'item', make.item());
    const line = [{ itemId: item.id, qty: 1, core: true }];
    const b1 = await createdPreset(api, 'bundle', make.bundle({ lines: line }));
    await createdPreset(api, 'bundle', make.bundle({ lines: line }));
    await createdPreset(api, 'bag', make.bag({ minimums: [{ itemId: item.id, min: 4 }] }));
    await createdPreset(
      api,
      'field_supply_map',
      make.field_supply_map({ lines: [{ itemId: item.id, qty: 1 }] }),
    );
    const details = await refusedUnwritten(() => api.archive('item', item.id, 1), 409, 'referenced');
    expect(details.referencedBy).toEqual({ bundle: 2, bag: 1, field_supply_map: 1 });
    expect(details.referencedBy).toEqual((await referencesOf(h, team.teamId)).get(item.id));
    // An archived preset points at nothing: once one bundle is archived it counts no more.
    expect((await api.archive('bundle', b1.id, 1)).status).toBe(200);
    const again = await refusedUnwritten(() => api.archive('item', item.id, 1), 409, 'referenced');
    expect(again.referencedBy).toEqual({ bundle: 1, bag: 1, field_supply_map: 1 });
  });

  it('refuses a category an active item is in, and a platform item its bundles and maps hold', async () => {
    const category = await createdPreset(api, 'order_category', make.order_category());
    await createdPreset(api, 'item', make.item({ categoryId: category.id }));
    const details = await refusedUnwritten(
      () => api.archive('order_category', category.id, 1),
      409,
      'referenced',
    );
    expect(details.referencedBy).toEqual({ item: 1 });
    const gauze = idOf(team, 'item.gauze');
    const counts = await refusedUnwritten(() => api.archive('item', gauze, 1), 409, 'referenced');
    expect(counts.referencedBy).toEqual((await referencesOf(h, team.teamId)).get(gauze));
  });

  it('refuses a stale base, and an archive of an archived preset', async () => {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    expect((await api.edit('flag', id, 1, FREE_CHANGE.flag(body))).status).toBe(200);
    const details = await refusedUnwritten(() => api.archive('flag', id, 1), 409, 'stale');
    expect(details.currentVersion).toBe(2);
    expect((await api.archive('flag', id, 2)).status).toBe(200);
    await refusedUnwritten(() => api.archive('flag', id, 2), 409, 'archived');
    await refusedUnwritten(() => api.archive('flag', id, 1), 409, 'archived');
  });

  it('refuses to restore an active preset: 409 not_archived', async () => {
    const { id } = await createdPreset(api, 'flag', make.flag());
    await refusedUnwritten(() => api.restore('flag', id), 409, 'not_archived');
    await refusedUnwritten(() => api.restore('settings', idOf(team, 'settings.team')), 409, 'not_archived');
  });

  it('refuses to restore a preset whose name another active one took meanwhile', async () => {
    const body = make.item();
    const { id } = await createdPreset(api, 'item', body);
    expect((await api.archive('item', id, 1)).status).toBe(200);
    await createdPreset(
      api,
      'item',
      make.item({ name: String(body.name).toUpperCase().replace('DEMO:', 'Demo:') }),
    );
    await refusedUnwritten(() => api.restore('item', id), 409, 'name_taken');
  });

  it('refuses to restore a preset that points at one archived meanwhile', async () => {
    const category = await createdPreset(api, 'order_category', make.order_category());
    const { id } = await createdPreset(api, 'item', make.item({ categoryId: category.id }));
    expect((await api.archive('item', id, 1)).status).toBe(200);
    // An archived item points at nothing, so its category may go too.
    expect((await api.archive('order_category', category.id, 1)).status).toBe(200);
    const details = await refusedUnwritten(() => api.restore('item', id), 409, 'reference_archived');
    expect(details.problems).toEqual([{ path: 'categoryId', code: 'reference_archived' }]);
  });

  it('answers 404 for a preset that is not one of this kind in this team', async () => {
    const { id } = await createdPreset(api, 'flag', make.flag());
    await refusedUnwritten(() => api.archive('bundle', id, 1), 404, 'not_found');
    await refusedUnwritten(() => api.archive('flag', idOf(other, 'flag.frost_risk'), 1), 404, 'not_found');
    await refusedUnwritten(
      () => api.restore('flag', '00000000-0000-4000-8000-0000000000ac'),
      404,
      'not_found',
    );
    // And the routes that answer them find a preset that is one.
    expect((await api.archive('flag', id, 1)).status).toBe(200);
    expect((await api.restore('flag', id)).status).toBe(200);
  });

  it('finds a preset whose ID the address writes in capitals, as the database reads a UUID', async () => {
    const { id } = await createdPreset(api, 'flag', make.flag());
    expect((await api.archive('flag', id.toUpperCase(), 1)).status).toBe(200);
    expect(await headOf(h, id)).toMatchObject({ state: 'archived' });
    expect((await api.restore('flag', id.toUpperCase())).status).toBe(200);
    expect(await headOf(h, id)).toMatchObject({ state: 'active' });
  });
});

describe('a write’s reason (design 7; PL-14)', () => {
  const at = (n: number) => 'r'.repeat(n);
  const refusedReasons: [string, unknown][] = [
    ['two characters once trimmed', '   ab   '],
    ['only white space', '  \t\n  '],
    ['301 characters', at(301)],
    ['301 code points, the last an astral one', `${at(300)}😀`],
    ['two code points in three UTF-16 units', 'a😀'],
    ['a NUL inside', 'Demo: a\u0000reason'],
    ['not a string', 42],
    ['null', null],
  ];
  const acceptedReasons: [string, string, string][] = [
    ['three characters', 'abc', 'abc'],
    ['three once trimmed', ' \t abc \n', 'abc'],
    ['300 characters', at(300), at(300)],
    ['300 code points, the last an astral one', `  ${at(299)}😀  `, `${at(299)}😀`],
  ];
  const expectReasonRefused = (r: Answer, label: string) => {
    expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(422);
    // A NUL is refused whichever check finds it; every other bad reason fails the request schema.
    if (errorOf(r).code === 'invalid') expect(label).toBe('a NUL inside');
    else {
      expect(errorOf(r).code, label).toBe('validation_failed');
      expect(
        (errorOf(r).details!.fields as { path: string }[]).map((f) => f.path),
        label,
      ).toContainEqual('reason');
    }
  };

  /** Each act, on a preset made for it, and whether its reason is kept on its own preset. */
  const acts: Record<string, () => Promise<(reason: unknown) => Promise<{ r: Answer; id: string }>>> = {
    create: async () => async (reason) => {
      const r = await api.create('flag', make.flag(), reason);
      return { r, id: r.body.id as string };
    },
    edit: async () => {
      const body = make.flag();
      const { id } = await createdPreset(api, 'flag', body);
      return async (reason) => ({ r: await api.edit('flag', id, 1, FREE_CHANGE.flag(body), reason), id });
    },
    archive: async () => {
      const { id } = await createdPreset(api, 'flag', make.flag());
      return async (reason) => ({ r: await api.archive('flag', id, 1, reason), id });
    },
    restore: async () => {
      const { id } = await createdPreset(api, 'flag', make.flag());
      expect((await api.archive('flag', id, 1)).status).toBe(200);
      return async (reason) => ({ r: await api.restore('flag', id, reason), id });
    },
  };

  for (const [name, prepare] of Object.entries(acts)) {
    it(`${name}: refuses a reason that is not 3 to 300 characters once trimmed, and writes nothing`, async () => {
      const act = await prepare();
      for (const [label, reason] of refusedReasons) {
        const before = await footprint(h, team.teamId);
        const { r } = await act(reason);
        expectReasonRefused(r, label);
        await expectNothingWritten(h, team.teamId, before);
      }
    });

    it(`${name}: keeps a reason of 3 to 300 code points, trimmed`, async () => {
      for (const [label, reason, kept] of acceptedReasons) {
        const act = await prepare();
        const { r, id } = await act(reason);
        expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
        const events = await eventsOf(h, id);
        expect(events.at(-1)!.reason, label).toBe(kept);
      }
    });
  }

  it('reorder and take-update refuse a bad reason too', async () => {
    const tier = await activeFlags('secondary');
    for (const [label, reason] of refusedReasons) {
      const before = await footprint(h, team.teamId);
      expectReasonRefused(await api.reorder('secondary', [...tier].reverse(), reason), label);
      expectReasonRefused(await api.takeUpdate('flag', idOf(team, 'flag.high'), 1, false, reason), label);
      await expectNothingWritten(h, team.teamId, before);
    }
    // A reason left out is refused like one too short.
    const before = await footprint(h, team.teamId);
    expectReasonRefused(await api.send('POST', '/v1/admin/presets/flag', { body: make.flag() }), 'left out');
    expectReasonRefused(
      await api.send('POST', '/v1/admin/preset-order/flag', { tier: 'secondary', ids: tier }),
      'left out',
    );
    await expectNothingWritten(h, team.teamId, before);
  });
});

/** The team's active flags of a tier, by rank. */
async function activeFlags(tier: 'primary' | 'secondary', teamId = team.teamId): Promise<string[]> {
  const rows = await h.scratch.owner<{ id: string }[]>`
    select p.id from sineobex.team_presets p
    join sineobex.team_preset_versions v on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.kind = 'flag' and p.state = 'active' and v.body ->> 'tier' = ${tier}
    order by (v.body ->> 'rank')::int, p.name`;
  return rows.map((r) => r.id);
}

describe('who may write, and a recent sign-in (design 7; D98)', () => {
  /** Every write route, each on a preset made for it. */
  async function writes(): Promise<[string, (a: PresetsApi) => Promise<Answer>][]> {
    const body = make.flag();
    const { id } = await createdPreset(api, 'flag', body);
    const gone = await createdPreset(api, 'flag', make.flag());
    expect((await api.archive('flag', gone.id, 1)).status).toBe(200);
    const tier = await activeFlags('primary');
    return [
      ['create', (a) => a.create('flag', make.flag())],
      ['edit', (a) => a.edit('flag', id, 1, FREE_CHANGE.flag(body))],
      ['archive', (a) => a.archive('flag', id, 1)],
      ['restore', (a) => a.restore('flag', gone.id)],
      ['take-update', (a) => a.takeUpdate('flag', idOf(team, 'flag.high'), 1, false)],
      ['reorder', (a) => a.reorder('primary', [...tier].reverse())],
    ];
  }

  it('refuses every write with a sign-in older than 15 minutes: reauth_required, logged nowhere, nothing written', async () => {
    const stale = presetsApi(h, team.teamId, team.admin, {
      token: await tokenOf(h, team.admin, STALE_MINUTES),
    });
    for (const [name, write] of await writes()) {
      const mark = await auditMark(h);
      const before = await footprint(h, team.teamId);
      refused(await write(stale), 403, 'reauth_required');
      await expectNothingWritten(h, team.teamId, before);
      expect(await auditAfter(h, mark), name).toEqual([]);
    }
  });

  it('accepts every write with a sign-in just inside 15 minutes', async () => {
    const recent = presetsApi(h, team.teamId, team.admin, { token: await tokenOf(h, team.admin, 14) });
    for (const [name, write] of await writes()) {
      const r = await write(recent);
      expect(r.status === 403 && errorOf(r).code === 'reauth_required', name).toBe(false);
    }
  });

  it('refuses every admin route to a member without team.manage_presets, and logs it, before the sign-in’s age', async () => {
    const reads: [string, (a: PresetsApi) => Promise<Answer>][] = [
      ['list', (a) => a.list('flag')],
      ['history', (a) => a.history('flag', idOf(team, 'flag.high'))],
    ];
    for (const token of [await tokenOf(h, team.staff), await tokenOf(h, team.staff, STALE_MINUTES)]) {
      const staff = presetsApi(h, team.teamId, team.staff, { token });
      for (const [name, route] of [...(await writes()), ...reads]) {
        const before = await footprint(h, team.teamId);
        const mark = await auditMark(h);
        refused(await route(staff), 403, 'forbidden');
        const events = await auditAfter(h, mark);
        expect(events, name).toEqual([
          expect.objectContaining({
            teamId: team.teamId,
            action: 'access.denied',
            actorUserId: team.staff.userId,
            details: {
              permission: 'team.manage_presets',
              route: expect.stringMatching(/^\/v1\/admin\/preset/),
            },
          }),
        ]);
        expect(await footprint(h, team.teamId), name).toEqual({ ...before, audit: before.audit + 1 });
      }
    }
  });

  it('asks no recent sign-in of the reads', async () => {
    const stale = presetsApi(h, team.teamId, team.admin, {
      token: await tokenOf(h, team.admin, STALE_MINUTES),
    });
    expect((await stale.list('flag')).status).toBe(200);
    expect((await stale.history('flag', idOf(team, 'flag.high'))).status).toBe(200);
  });
});

describe('the admin list (design 7)', () => {
  it('lists every preset of the kind, archived ones included, with what points at each', async () => {
    const gone = await createdPreset(api, 'bag', make.bag());
    expect((await api.archive('bag', gone.id, 1)).status).toBe(200);
    const refs = await referencesOf(h, team.teamId);
    for (const kind of [...KINDS_MADE, 'settings'] as const) {
      const r = await api.list(kind);
      expect(r.status).toBe(200);
      const rows = r.body as unknown as Record<string, unknown>[];
      const heads = await h.scratch.owner<{ id: string }[]>`
        select id from sineobex.team_presets where team_id = ${team.teamId} and kind = ${kind}`;
      expect(rows.map((x) => x.id).sort(), kind).toEqual(heads.map((x) => x.id).sort());
      for (const row of rows) {
        const id = row.id as string;
        const head = (await headOf(h, id))!;
        expect(row, kind).toMatchObject({
          id,
          name: head.name,
          state: head.state,
          version: head.currentVersion,
          customized: head.customized,
          updateOnOffer: false,
          updateChangesFixed: false,
          referencedBy: refs.get(id) ?? {},
          body: await currentBody(id),
        });
      }
    }
    const bags = (await api.list('bag')).body as unknown as { id: string; state: string }[];
    expect(bags.find((b) => b.id === gone.id)?.state).toBe('archived');
  });

  it('lists a kind by name as a reader sorts names, whatever the database’s collation', async () => {
    // In code point order, and so under the C collation, "Banana" comes before "apple" and "10"
    // before "9".
    const names = ['Demo: apple kit', 'Demo: Banana kit', 'Demo: kit 9', 'Demo: kit 10'];
    for (const name of [...names].reverse()) await createdPreset(api, 'item', make.item({ name }));
    const r = await api.list('item');
    expect(r.status).toBe(200);
    const listed = (r.body as unknown as { name: string }[]).map((x) => x.name);
    expect(listed.filter((n) => names.includes(n))).toEqual(names);
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    expect(listed).toEqual([...listed].sort((a, b) => collator.compare(a, b)));
  });

  it('writes no audit event: presets hold no patient data (PL-13)', async () => {
    const mark = await auditMark(h);
    expect((await api.list('flag')).status).toBe(200);
    expect(await auditAfter(h, mark)).toEqual([]);
  });

  it('names no other team’s preset', async () => {
    const r = await api.list('item');
    expect(r.status).toBe(200);
    const others = new Set(Object.values(other.ids));
    expect((r.body as unknown as { id: string }[]).filter((x) => others.has(x.id))).toEqual([]);
  });

  it('refuses a kind it does not know', async () => {
    const r = await api.list('billing_code_map');
    expect(r.status).toBe(422);
    expect(errorOf(r).code).toBe('validation_failed');
  });
});

describe('a preset’s history (design 7)', () => {
  it('shows every event, oldest first, each with its version’s body, who, when and why', async () => {
    const v1 = make.flag();
    const { id } = await createdPreset(api, 'flag', v1, 'Demo: a reason to add');
    const v2 = FREE_CHANGE.flag(v1);
    expect((await api.edit('flag', id, 1, v2, 'Demo: a reason to edit')).status).toBe(200);
    expect((await api.archive('flag', id, 2, 'Demo: a reason to archive')).status).toBe(200);
    expect((await api.restore('flag', id, 'Demo: a reason to restore')).status).toBe(200);
    const r = await api.history('flag', id);
    expect(r.status).toBe(200);
    const rows = r.body as unknown as { at: string }[];
    const by = { userId: team.admin.userId, displayName: team.admin.displayName };
    expect(rows).toEqual([
      {
        act: 'created',
        version: 1,
        source: 'team',
        by,
        at: expect.any(String),
        reason: 'Demo: a reason to add',
        body: v1,
      },
      {
        act: 'updated',
        version: 2,
        source: 'team',
        by,
        at: expect.any(String),
        reason: 'Demo: a reason to edit',
        body: v2,
      },
      {
        act: 'archived',
        version: 2,
        source: 'team',
        by,
        at: expect.any(String),
        reason: 'Demo: a reason to archive',
        body: v2,
      },
      {
        act: 'restored',
        version: 2,
        source: 'team',
        by,
        at: expect.any(String),
        reason: 'Demo: a reason to restore',
        body: v2,
      },
    ]);
    const times = rows.map((x) => Date.parse(x.at));
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const x of rows) expect(x.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/);
  });

  it('shows the installer’s act on a platform preset, by nobody and with no reason', async () => {
    const r = await presetsApi(h, other.teamId, other.admin).history('flag', idOf(other, 'flag.high'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      {
        act: 'installed',
        version: 1,
        source: 'platform',
        by: null,
        at: expect.any(String),
        reason: null,
        body: await currentBody(idOf(other, 'flag.high')),
      },
    ]);
  });

  it('writes no audit event: the history holds the admins’ reasons and bodies, no patient data (PL-13)', async () => {
    const mark = await auditMark(h);
    expect((await api.history('flag', idOf(team, 'flag.high'))).status).toBe(200);
    expect(await auditAfter(h, mark)).toEqual([]);
  });

  it('answers 404 for a preset that is not one of this kind in this team', async () => {
    refused(await api.history('bundle', idOf(team, 'flag.high')), 404, 'not_found');
    refused(await api.history('flag', idOf(other, 'flag.high')), 404, 'not_found');
    refused(await api.history('flag', '00000000-0000-4000-8000-0000000000ad'), 404, 'not_found');
    // And the route that answers them finds a preset that is one, its ID in capitals too.
    expect((await api.history('flag', idOf(team, 'flag.high'))).status).toBe(200);
    expect((await api.history('flag', idOf(team, 'flag.high').toUpperCase())).status).toBe(200);
  });

  it('orders the acts by the version each made, though a pull’s transaction began before', async () => {
    // A phone's pull begins, an admin takes the update on offer, then the pull installs a newer
    // version in place (5.2). Its event's time is when its transaction began, before the admin's.
    const t = await presetsTeam(h, 'Routes History Order');
    const a = presetsApi(h, t.teamId, t.admin);
    const medium = idOf(t, 'flag.medium');
    const edited = { ...(await currentBody(medium)), criteria: 'Demo: the team’s own criteria' };
    expect((await a.edit('flag', medium, 1, edited, 'Demo: our words')).status).toBe(200);
    const unrelease = [
      releasePlatform([nextVersion('flag.medium', (b) => ({ ...b, criteria: 'Demo: the second' }))]),
    ];
    let go = () => {};
    let pull: Promise<unknown> = Promise.resolve();
    try {
      expect((await runInstaller(h, t.teamId)).offer).toEqual({ flag: 1 });
      let begun!: () => void;
      const started = new Promise<void>((resolve) => (begun = resolve));
      const gate = new Promise<void>((resolve) => (go = resolve));
      const held = h.scratch.owner.begin(async (tx) => {
        await tx`select 1`;
        begun();
        await gate;
        return installTeamPresets(tx as unknown as InstallSql, t.teamId);
      });
      pull = held;
      await started;
      const taken = await a.takeUpdate('flag', medium, 2, false, 'Demo: the platform’s words');
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);
      unrelease.push(
        releasePlatform([nextVersion('flag.medium', (b) => ({ ...b, criteria: 'Demo: the third' }))]),
      );
      go();
      expect((await held).update).toEqual({ flag: 1 });
      const history = (await a.history('flag', medium)).body as unknown as {
        act: string;
        version: number;
        at: string;
      }[];
      expect(history.map((x) => [x.act, x.version])).toEqual([
        ['installed', 1],
        ['updated', 2],
        ['update_taken', 3],
        ['platform_updated', 4],
      ]);
      expect(Date.parse(history[3]!.at)).toBeLessThan(Date.parse(history[2]!.at));
    } finally {
      // A case that fails part way still lets the pull's transaction end.
      go();
      await pull.catch(() => {});
      for (const undo of unrelease.reverse()) undo();
    }
  });
});

describe('bags and their minimums (design 4.4, 8.1)', () => {
  it('makes a bag from the team’s template and another from that bag, each stored as sent', async () => {
    const settings = idOf(team, 'settings.team');
    const head = await headOf(h, settings);
    const template = [
      { itemId: idOf(team, 'item.gauze'), min: 5 },
      { itemId: idOf(team, 'item.bandage'), min: 8 },
    ];
    const body = { ...(await currentBody(settings)), bagMinimumsOn: true, newBagMinimums: template };
    expect((await api.edit('settings', settings, head!.currentVersion, body)).status).toBe(200);
    // Add bag fills the new bag's minimums from the template; Copy from fills them from a bag.
    const fromTemplate = await createdPreset(api, 'bag', make.bag({ minimums: template }));
    expect(await currentBody(fromTemplate.id)).toEqual(expect.objectContaining({ minimums: template }));
    const copied = (await currentBody(fromTemplate.id)).minimums;
    const fromBag = await createdPreset(api, 'bag', make.bag({ minimums: copied }));
    expect(await currentBody(fromBag.id)).toEqual(expect.objectContaining({ minimums: template }));
    // And a team turns bag minimums off again.
    const off = await api.edit('settings', settings, head!.currentVersion + 1, {
      ...body,
      bagMinimumsOn: false,
    });
    expect(off.status).toBe(200);
    expect(await currentBody(settings)).toMatchObject({ bagMinimumsOn: false, newBagMinimums: template });
  });
});

describe('a tier’s flag order (design 5.1, 5.3, 7)', () => {
  let t: PresetsTeam;
  let a: PresetsApi;
  beforeAll(async () => {
    t = await presetsTeam(h, 'Routes Order');
    a = presetsApi(h, t.teamId, t.admin);
  });
  const ranks = async (ids: readonly string[]) =>
    Promise.all(
      ids.map(async (id) => [
        id,
        (await versionsOf(h, id)).at(-1)!.body.rank,
        (await headOf(h, id))!.currentVersion,
      ]),
    );

  it('gives each flag whose rank changes its next version, the team’s own, at one revision', async () => {
    const [high, medium, low] = [idOf(t, 'flag.high'), idOf(t, 'flag.medium'), idOf(t, 'flag.low')];
    expect(await activeFlags('primary', t.teamId)).toEqual([high, medium, low]);
    const r0 = await revisionOf(h, t.teamId);
    const r = await a.reorder('primary', [low, medium, high], ' Demo: low risk first for the test ');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ changed: 2 });
    expect(await ranks([low, medium, high])).toEqual([
      [low, 10, 2],
      [medium, 20, 1],
      [high, 30, 2],
    ]);
    for (const id of [low, high]) {
      expect(await headOf(h, id)).toMatchObject({
        customized: true,
        revision: r0 + 1,
        updatedBy: t.admin.userId,
      });
      const [, v2] = await versionsOf(h, id);
      expect(v2).toMatchObject({ version: 2, source: 'team', createdBy: t.admin.userId });
      expect((await eventsOf(h, id)).at(-1)).toEqual({
        act: 'reordered',
        version: 2,
        reason: 'Demo: low risk first for the test',
        createdBy: t.admin.userId,
      });
    }
    // The flag that kept its rank is untouched.
    expect(await headOf(h, medium)).toMatchObject({ customized: false, currentVersion: 1, revision: 1 });
    expect(await eventsOf(h, medium)).toEqual([expect.objectContaining({ act: 'installed' })]);
    expect(await revisionOf(h, t.teamId)).toBe(r0 + 1);
  });

  it('writes nothing for an order that changes no rank', async () => {
    const tier = await activeFlags('secondary', t.teamId);
    const before = await footprint(h, t.teamId);
    const r = await a.reorder('secondary', tier);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ changed: 0 });
    await expectNothingWritten(h, t.teamId, before);
  });

  it('refuses ids that are not exactly the tier’s active flags: 422 ids_mismatch', async () => {
    const tier = await activeFlags('secondary', t.teamId);
    const gone = await createdPreset(a, 'flag', bodies(t).flag());
    expect((await a.archive('flag', gone.id, 1)).status).toBe(200);
    const primary = await activeFlags('primary', t.teamId);
    for (const ids of [
      tier.slice(1),
      [...tier, primary[0]!],
      [...tier, tier[0]!],
      [...tier, gone.id],
      [...tier.slice(1), '00000000-0000-4000-8000-0000000000ae'],
      [],
    ]) {
      await refusedUnwritten(() => a.reorder('secondary', ids), 422, 'ids_mismatch', t.teamId);
    }
    // The tier is its active flags: with the archived one left out, the order is taken.
    expect((await a.reorder('secondary', [...tier].reverse())).status).toBe(200);
  });

  it('takes an order whose IDs are written in capitals, as the database reads a UUID', async () => {
    const tier = await activeFlags('secondary', t.teamId);
    const r = await a.reorder(
      'secondary',
      [...tier].reverse().map((id) => id.toUpperCase()),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as { changed: number }).changed).toBeGreaterThan(0);
    expect(await activeFlags('secondary', t.teamId)).toEqual([...tier].reverse());
  });

  it('refuses an ID that is no UUID as malformed, naming it, never as a list that changed', async () => {
    // As ids_mismatch, the answer would send the person to reload a list nobody changed.
    const tier = await activeFlags('secondary', t.teamId);
    const before = await footprint(h, t.teamId);
    const r = await a.reorder('secondary', [...tier.slice(1), 'not-a-uuid']);
    expect(r.status).toBe(422);
    expect(errorOf(r)).toMatchObject({
      code: 'validation_failed',
      details: { fields: [expect.objectContaining({ path: `ids.${tier.length - 1}` })] },
    });
    await expectNothingWritten(h, t.teamId, before);
  });

  it('refuses a tier it does not know', async () => {
    const before = await footprint(h, t.teamId);
    const r = await a.reorder('tertiary', []);
    expect(r.status).toBe(422);
    expect(errorOf(r).code).toBe('validation_failed');
    await expectNothingWritten(h, t.teamId, before);
  });
});

describe('taking a platform update (design 5.1, 5.2, 7)', () => {
  // A team made before a release, then the release: versions of some platform presets, each
  // installed as platformUpdateEffect says. A copy the team edited, archived or ranked, and one
  // whose new version changes a field fixed at creation, is offered; the rest are updated in place.
  let u: PresetsTeam;
  let a: PresetsApi;
  let unrelease: () => void;
  let heatRisk: string;
  const ids = (key: string) => idOf(u, key);

  beforeAll(async () => {
    u = await presetsTeam(h, 'Routes Updates');
    a = presetsApi(h, u.teamId, u.admin);
    const m = bodies(u);
    const edit = async (kind: PresetKind, key: string, change: (b: Body) => Body) => {
      const id = ids(key);
      const head = (await headOf(h, id))!;
      const r = await a.edit(kind, id, head.currentVersion, change(await currentBody(id)));
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
    };
    // Edited copies, which an update can only be offered to.
    await edit('flag', 'flag.frost_risk', (b) => ({ ...b, criteria: 'Demo: the team’s own criteria' }));
    await edit('flag', 'flag.dehydration_risk', (b) => ({ ...b, criteria: 'Demo: the team’s own words' }));
    await edit('bundle', 'bundle.general_pain', (b) => ({ ...b, prompt: 'Demo: ask about pain first.' }));
    await edit('settings', 'settings.team', (b) => ({ ...b, problemCheckDays: 120 }));
    // A name the platform's next version takes, held by the team's own flag.
    heatRisk = (await createdPreset(a, 'flag', m.flag({ name: 'Demo: Heat risk' }))).id;
    // Archived copies: one whose update points at it, one the update is for.
    expect((await a.archive('item', ids('item.glucose_test'), 1)).status).toBe(200);
    expect((await a.archive('flag', ids('flag.low'), 1)).status).toBe(200);
    // A flag the team ranked: its next version is only offered (5.1, reorder).
    const tier = await activeFlags('primary', u.teamId);
    expect((await a.reorder('primary', [...tier].reverse())).status).toBe(200);

    unrelease = releasePlatform([
      nextVersion('flag.frost_risk', (b) => ({ ...b, criteria: 'Demo: the platform’s new criteria' })),
      nextVersion('flag.dehydration_risk', (b) => ({ ...b, name: 'Demo: Heat risk' })),
      nextVersion('bundle.general_pain', (b) => ({
        ...b,
        lines: [...(b.lines as Body[]), { itemId: 'item.glucose_test', qty: 1, core: false }],
      })),
      nextVersion('item.pregnancy_test', (b) => ({ ...b, unit: 'kit' })),
      nextVersion('item.socks', (b) => ({ ...b, unit: 'pair' })),
      nextVersion('settings.team', (b) => ({ ...b, problemCheckDays: 60 })),
      nextVersion('order_category.otc', (b) => ({ ...b, sort: 15 })),
      nextVersion('flag.low', (b) => ({ ...b, criteria: 'Demo: the platform’s low criteria' })),
      nextVersion('flag.high', (b) => ({ ...b, criteria: 'Demo: the platform’s high criteria' })),
    ]);
    const installed = await runInstaller(h, u.teamId);
    expect(installed.update).toEqual({ order_category: 1 });
    expect(installed.offer).toEqual({ flag: 4, bundle: 1, item: 2, settings: 1 });
  });
  afterAll(() => unrelease?.());

  it('lists each update on offer, and whether it changes a field fixed at creation', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    for (const kind of ['flag', 'item', 'bundle', 'settings', 'order_category'] as const)
      for (const row of (await a.list(kind)).body as unknown as Record<string, unknown>[])
        rows.set(row.id as string, row);
    const offered = (key: string) => rows.get(ids(key))!;
    expect(offered('flag.frost_risk')).toMatchObject({ updateOnOffer: true, updateChangesFixed: false });
    expect(offered('item.pregnancy_test')).toMatchObject({ updateOnOffer: true, updateChangesFixed: true });
    expect(offered('item.socks')).toMatchObject({ updateOnOffer: true, updateChangesFixed: true });
    expect(offered('flag.low')).toMatchObject({ updateOnOffer: true, state: 'archived' });
    expect(offered('flag.high')).toMatchObject({ updateOnOffer: true, updateChangesFixed: false });
    // Updated in place by the installer, as nobody: on offer no more.
    expect(offered('order_category.otc')).toMatchObject({
      updateOnOffer: false,
      version: 2,
      customized: false,
    });
    expect(offered('flag.medium')).toMatchObject({ updateOnOffer: false });
  });

  it('takes an update in place: the platform’s body as the next version, by nobody, its event the person’s', async () => {
    const frost = ids('flag.frost_risk');
    const r0 = await revisionOf(h, u.teamId);
    const r = await a.takeUpdate('flag', frost, 2, false, ' Demo: we want the new criteria ');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ id: frost, version: 3, revision: r0 + 1 });
    expect(await headOf(h, frost)).toMatchObject({
      state: 'active',
      currentVersion: 3,
      customized: false,
      originKey: 'flag.frost_risk',
      originVersion: 2,
      platformLatest: 2,
      revision: r0 + 1,
      updatedBy: u.admin.userId,
    });
    expect((await versionsOf(h, frost)).at(-1)).toEqual({
      version: 3,
      body: platformBody('flag.frost_risk', 2),
      source: 'platform',
      createdBy: null,
    });
    expect((await eventsOf(h, frost)).at(-1)).toEqual({
      act: 'update_taken',
      version: 3,
      reason: 'Demo: we want the new criteria',
      createdBy: u.admin.userId,
    });
    const row = ((await a.list('flag')).body as unknown as Record<string, unknown>[]).find(
      (x) => x.id === frost,
    );
    expect(row).toMatchObject({ updateOnOffer: false, customized: false });
    // The history shows the platform's version, taken by the person, with their reason.
    const history = (await a.history('flag', frost)).body as unknown as Record<string, unknown>[];
    expect(history.at(-1)).toEqual({
      act: 'update_taken',
      version: 3,
      source: 'platform',
      by: { userId: u.admin.userId, displayName: u.admin.displayName },
      at: expect.any(String),
      reason: 'Demo: we want the new criteria',
      body: platformBody('flag.frost_risk', 2),
    });
  });

  it('shows an update the installer made in place in the history, by nobody', async () => {
    const otc = ids('order_category.otc');
    const history = (await a.history('order_category', otc)).body as unknown as Record<string, unknown>[];
    expect(history.map((x) => [x.act, x.version, x.source, x.by, x.reason])).toEqual([
      ['installed', 1, 'platform', null, null],
      ['platform_updated', 2, 'platform', null, null],
    ]);
  });

  it('refuses in place an update that changes a field fixed at creation: 409 fixed_field', async () => {
    const preg = ids('item.pregnancy_test');
    const details = await refusedUnwritten(
      () => a.takeUpdate('item', preg, 1, false),
      409,
      'fixed_field',
      u.teamId,
    );
    expect(details.fields).toEqual(['unit']);
  });

  it('refuses in place an update whose name another active preset holds', async () => {
    await refusedUnwritten(
      () => a.takeUpdate('flag', ids('flag.dehydration_risk'), 2, false),
      409,
      'name_taken',
      u.teamId,
    );
  });

  it('refuses in place an update that points at an archived preset', async () => {
    const details = await refusedUnwritten(
      () => a.takeUpdate('bundle', ids('bundle.general_pain'), 2, false),
      409,
      'reference_archived',
      u.teamId,
    );
    expect(details.problems).toEqual([{ path: 'lines.1.itemId', code: 'reference_archived' }]);
  });

  it('refuses in place an update of an archived copy, a stale base, and a preset with no update on offer', async () => {
    await refusedUnwritten(() => a.takeUpdate('flag', ids('flag.low'), 1, false), 409, 'archived', u.teamId);
    const stale = await refusedUnwritten(
      () => a.takeUpdate('flag', ids('flag.high'), 1, false),
      409,
      'stale',
      u.teamId,
    );
    expect(stale.currentVersion).toBe(2);
    const medium = (await headOf(h, ids('flag.medium')))!.currentVersion;
    await refusedUnwritten(
      () => a.takeUpdate('flag', ids('flag.medium'), medium, false),
      409,
      'no_update',
      u.teamId,
    );
    await refusedUnwritten(() => a.takeUpdate('flag', heatRisk, 1, false), 409, 'no_update', u.teamId);
    await refusedUnwritten(() => a.takeUpdate('flag', heatRisk, 1, true), 409, 'no_update', u.teamId);
  });

  it('takes an update the settings preset is offered in place, never as a new one', async () => {
    const settings = ids('settings.team');
    await refusedUnwritten(() => a.takeUpdate('settings', settings, 2, true), 409, 'not_removable', u.teamId);
    const r = await a.takeUpdate('settings', settings, 2, false);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await currentBody(settings)).toEqual(platformBody('settings.team', 2));
  });

  it('takes an update as a new preset: the old one archived and no longer the platform’s, the new one with its origin', async () => {
    const preg = ids('item.pregnancy_test');
    const r0 = await revisionOf(h, u.teamId);
    const r = await a.takeUpdate('item', preg, 1, true, 'Demo: counted in kits from now on');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ id: expect.any(String), version: 1, revision: r0 + 1 });
    const fresh = r.body.id as string;
    expect(fresh).not.toBe(preg);
    // The old one: archived at its version, the team's own, with no origin.
    expect(await headOf(h, preg)).toMatchObject({
      state: 'archived',
      currentVersion: 1,
      customized: true,
      originKey: null,
      revision: r0 + 1,
      updatedBy: u.admin.userId,
    });
    expect((await eventsOf(h, preg)).at(-1)).toEqual({
      act: 'archived',
      version: 1,
      reason: 'Demo: counted in kits from now on',
      createdBy: u.admin.userId,
    });
    // The new one: the platform's body, its ids the team's, under the old one's name, which the
    // same act frees.
    expect(await headOf(h, fresh)).toMatchObject({
      kind: 'item',
      name: 'Pregnancy test',
      state: 'active',
      currentVersion: 1,
      originKey: 'item.pregnancy_test',
      originVersion: 2,
      platformLatest: 2,
      customized: false,
      revision: r0 + 1,
      createdBy: u.admin.userId,
    });
    expect(await versionsOf(h, fresh)).toEqual([
      { version: 1, body: platformBody('item.pregnancy_test', 2), source: 'platform', createdBy: null },
    ]);
    expect(await eventsOf(h, fresh)).toEqual([
      {
        act: 'update_taken',
        version: 1,
        reason: 'Demo: counted in kits from now on',
        createdBy: u.admin.userId,
      },
    ]);
    // The origin moved with it: the installer installs no third copy.
    const again = await runInstaller(h, u.teamId);
    expect(again.install).toEqual({});
    const copies = await h.scratch.owner<{ n: number }[]>`
      select count(*)::int as n from sineobex.team_presets
      where team_id = ${u.teamId} and kind = 'item' and lower(name) = 'pregnancy test'`;
    expect(copies[0]!.n).toBe(2);
  });

  it('takes an update of an archived copy as a new preset, the old one left archived with no event', async () => {
    const low = ids('flag.low');
    const events = (await eventsOf(h, low)).length;
    const r = await a.takeUpdate('flag', low, 1, true);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await headOf(h, low)).toMatchObject({ state: 'archived', originKey: null, customized: true });
    expect(await eventsOf(h, low)).toHaveLength(events);
    expect(await headOf(h, r.body.id as string)).toMatchObject({
      name: 'Low',
      state: 'active',
      originKey: 'flag.low',
      originVersion: 2,
    });
  });

  it('refuses as new an update whose old copy an active preset points at: 409 referenced', async () => {
    const socks = ids('item.socks');
    const details = await refusedUnwritten(
      () => a.takeUpdate('item', socks, 1, true),
      409,
      'referenced',
      u.teamId,
    );
    expect(details.referencedBy).toEqual((await referencesOf(h, u.teamId)).get(socks));
    expect(details.referencedBy).toMatchObject({ bundle: 1, field_supply_map: 1 });
  });

  it('refuses as new an update whose name another active preset holds, the old one’s own aside', async () => {
    await refusedUnwritten(
      () => a.takeUpdate('flag', ids('flag.dehydration_risk'), 2, true),
      409,
      'name_taken',
      u.teamId,
    );
  });

  it('refuses as new an update that points at an archived preset', async () => {
    const details = await refusedUnwritten(
      () => a.takeUpdate('bundle', ids('bundle.general_pain'), 2, true),
      409,
      'reference_archived',
      u.teamId,
    );
    expect(details.problems).toEqual([{ path: 'lines.1.itemId', code: 'reference_archived' }]);
  });

  it('refuses as new a stale base and an update not on offer', async () => {
    await refusedUnwritten(() => a.takeUpdate('flag', ids('flag.high'), 1, true), 409, 'stale', u.teamId);
    const medium = (await headOf(h, ids('flag.medium')))!.currentVersion;
    await refusedUnwritten(
      () => a.takeUpdate('flag', ids('flag.medium'), medium, true),
      409,
      'no_update',
      u.teamId,
    );
  });

  it('offers, never applies, a platform version of a flag the team ranked', async () => {
    const high = ids('flag.high');
    expect(await headOf(h, high)).toMatchObject({
      customized: true,
      currentVersion: 2,
      originVersion: 1,
      platformLatest: 2,
    });
    expect((await currentBody(high)).criteria).not.toBe('Demo: the platform’s high criteria');
  });

  it('answers 404 for a preset that is not one of this kind in this team', async () => {
    await refusedUnwritten(
      () => a.takeUpdate('bundle', ids('flag.high'), 2, false),
      404,
      'not_found',
      u.teamId,
    );
    await refusedUnwritten(
      () => a.takeUpdate('flag', idOf(team, 'flag.high'), 1, false),
      404,
      'not_found',
      u.teamId,
    );
    // And the route that answers them finds a preset that is one: a stale base, here.
    refused(await a.takeUpdate('flag', ids('flag.high'), 1, false), 409, 'stale');
  });

  it('refuses an asNew sent as text, which would read as true, as malformed: nothing taken either way', async () => {
    for (const asNew of ['false', 0, null]) {
      const before = await footprint(h, u.teamId);
      const r = await a.send('POST', `/v1/admin/presets/flag/${ids('flag.high')}/take-update`, {
        baseVersion: 2,
        reason: REASON,
        asNew,
      });
      expect(r.status, JSON.stringify(asNew)).toBe(422);
      expect(errorOf(r).code).toBe('validation_failed');
      await expectNothingWritten(h, u.teamId, before);
    }
  });

  it('finds a preset whose ID the address writes in capitals, as the database reads a UUID', async () => {
    const high = ids('flag.high');
    const r = await a.takeUpdate('flag', high.toUpperCase(), 2, false);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ id: high, version: 3 });
    expect(await headOf(h, high)).toMatchObject({ currentVersion: 3, customized: false, originVersion: 2 });
  });

  /** The platform's body of a version, with the team's ids where it names an entry by origin key. */
  function platformBody(originKey: string, version: number): Body {
    const entry = PLATFORM.find((e) => e.originKey === originKey && e.platformVersion === version)!;
    const swap = (v: unknown): unknown => {
      if (typeof v === 'string') return Object.hasOwn(u.ids, v) ? u.ids[v] : v;
      if (Array.isArray(v)) return v.map(swap);
      if (v !== null && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
      return v;
    };
    return swap(entry.body) as Body;
  }
});

describe('taking a platform update: what it names and what it renames (design 4.1, 5.1; risk 12.1.1)', () => {
  // A team of its own, each case releasing the version it takes, so no case leans on another's.
  let v: PresetsTeam;
  let a: PresetsApi;
  let m: ReturnType<typeof bodies>;

  beforeAll(async () => {
    v = await presetsTeam(h, 'Routes Taken Bodies');
    a = presetsApi(h, v.teamId, v.admin);
    m = bodies(v);
  });

  /** Edits a platform copy, so its next platform version is only offered, and answers its version. */
  async function edited(kind: PresetKind, id: string, change: (b: Body) => Body): Promise<number> {
    const head = (await headOf(h, id))!;
    const r = await a.edit(kind, id, head.currentVersion, change(await currentBody(id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.version as number;
  }

  const rowOf = async (kind: PresetKind, id: string) =>
    ((await a.list(kind)).body as unknown as Record<string, unknown>[]).find((r) => r.id === id);

  it('refuses an update the team’s presets refuse for anything but an archived preset, in place and as new: 422 invalid', async () => {
    // Ids in a body have no foreign key (risk 12.1.1): an offered version can name an entry the team
    // does not hold, its install skipped, say, and only the API stops it from being stored.
    const hygiene = idOf(v, 'bundle.hygiene');
    const version = await edited('bundle', hygiene, (b) => ({ ...b, prompt: 'Demo: ask what they need.' }));
    const undo = releasePlatform([
      nextVersion('bundle.hygiene', (b) => ({
        ...b,
        lines: [...(b.lines as Body[]), { itemId: 'item.demo_not_held', qty: 1, core: true }],
      })),
    ]);
    try {
      expect((await runInstaller(h, v.teamId)).offer).toEqual({ bundle: 1 });
      expect(await rowOf('bundle', hygiene)).toMatchObject({ updateOnOffer: true });
      for (const asNew of [false, true]) {
        const details = await refusedUnwritten(
          () => a.takeUpdate('bundle', hygiene, version, asNew),
          422,
          'invalid',
          v.teamId,
        );
        expect(details.problems, `asNew ${asNew}`).toEqual([
          { path: 'lines.1.itemId', code: 'unknown_reference' },
        ]);
      }
    } finally {
      undo();
    }
  });

  it('takes in place an update that renames the preset: the head’s name moves with the body’s', async () => {
    // The head's name is a copy of its body's (4.1), and the unique name and every name check read
    // the head: one left behind would keep the old name taken and leave the new one free.
    const dehydration = idOf(v, 'flag.dehydration_risk');
    const version = await edited('flag', dehydration, (b) => ({ ...b, criteria: 'Demo: our own words' }));
    const undo = releasePlatform([
      nextVersion('flag.dehydration_risk', (b) => ({ ...b, name: 'Demo: Thirst risk' })),
    ]);
    try {
      await runInstaller(h, v.teamId);
      const r = await a.takeUpdate('flag', dehydration, version, false);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await headOf(h, dehydration)).toMatchObject({
        name: 'Demo: Thirst risk',
        currentVersion: version + 1,
      });
      expect((await currentBody(dehydration)).name).toBe('Demo: Thirst risk');
      expect(await rowOf('flag', dehydration)).toMatchObject({ name: 'Demo: Thirst risk' });
      // The new name is held, as the database folds it, and the old one is free.
      await refusedUnwritten(
        () => a.create('flag', m.flag({ name: 'demo: THIRST risk' })),
        409,
        'name_taken',
        v.teamId,
      );
      expect((await a.create('flag', m.flag({ name: 'Dehydration risk' }))).status).toBe(201);
    } finally {
      undo();
    }
  });
});
