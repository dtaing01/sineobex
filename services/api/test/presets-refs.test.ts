import { randomUUID } from 'node:crypto';
import {
  heldBy,
  PRESET_KINDS,
  presetRefs,
  validatePreset,
  type PresetBody,
  type PresetKind,
} from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
import {
  bodies,
  createdPreset,
  errorOf,
  expectNothingWritten,
  footprint,
  headOf,
  idOf,
  idsNamedBy,
  nextVersion,
  presetsApi,
  presetsTeam,
  referencesOf,
  releasePlatform,
  runInstaller,
  versionsOf,
  type Answer,
  type Body,
  type PresetsApi,
  type PresetsTeam,
} from './presets-fixtures.ts';

// IDs inside a preset's body have no foreign key: only the API checks them (phase 5 design 4.4,
// risk 1). Written before the routes (cards P1-store to P1-order), these walk every kind and every
// field of a body that names another preset: on a create and on an edit, an ID must name a preset
// of the same team (unknown_reference otherwise, another team's included), of the right kind
// (wrong_kind), and not archived (409 reference_archived); and an archive is refused while an
// active preset names the preset (409 referenced, with the counts by kind), so no active body is
// left naming an archived preset or nothing at all. The shapes are presets-routes.test.ts's.

// This file's platform is its own copy, so a platform update can be released into it.
vi.mock('../../../packages/presets/data/platform.json', async (importOriginal) => {
  const real = (await importOriginal()) as { default: unknown[] };
  return { default: [...real.default] };
});

/** Each field of a body that names a preset, the kind it must name, and how a body is made with it. */
interface IdField {
  kind: PresetKind;
  path: string;
  names: PresetKind;
  body: (id: string) => Body;
}

let h: Harness;
let team: PresetsTeam;
let other: PresetsTeam;
let api: PresetsApi;
let make: ReturnType<typeof bodies>;
let FIELDS: IdField[];

beforeAll(async () => {
  h = await createHarness();
  team = await presetsTeam(h, 'Refs');
  other = await presetsTeam(h, 'Refs Other');
  api = presetsApi(h, team.teamId, team.admin);
  make = bodies(team);
  const gauze = idOf(team, 'item.gauze');
  FIELDS = [
    {
      kind: 'item',
      path: 'categoryId',
      names: 'order_category',
      body: (id) => make.item({ categoryId: id }),
    },
    {
      kind: 'bundle',
      path: 'lines.1.itemId',
      names: 'item',
      body: (id) =>
        make.bundle({
          lines: [
            { itemId: gauze, qty: 1, core: true },
            { itemId: id, qty: 1, core: false },
          ],
        }),
    },
    {
      kind: 'field_supply_map',
      path: 'lines.0.itemId',
      names: 'item',
      body: (id) => make.field_supply_map({ lines: [{ itemId: id, qty: 1 }] }),
    },
    {
      kind: 'condition_supply_map',
      path: 'lines.0.itemId',
      names: 'item',
      body: (id) => make.condition_supply_map({ lines: [{ itemId: id, qtyPerPatient: 1 }] }),
    },
    {
      kind: 'bag',
      path: 'minimums.0.itemId',
      names: 'item',
      body: (id) => make.bag({ minimums: [{ itemId: id, min: 3 }] }),
    },
    {
      kind: 'settings',
      path: 'newBagMinimums.0.itemId',
      names: 'item',
      body: (id) => make.settings({ newBagMinimums: [{ itemId: id, min: 3 }] }),
    },
  ];
});
afterAll(() => h?.close());

const currentVersion = async (id: string) => (await headOf(h, id))!.currentVersion;
const currentBody = async (id: string) => {
  const version = await currentVersion(id);
  return (await versionsOf(h, id)).find((v) => v.version === version)!.body;
};

/** A new active preset of the kind, for a body to name. */
async function fresh(kind: PresetKind): Promise<string> {
  const make2 = make as unknown as Record<string, () => Body>;
  return (await createdPreset(api, kind, make2[kind]!())).id;
}

/** A new archived preset of the kind. */
async function archived(kind: PresetKind): Promise<string> {
  const id = await fresh(kind);
  const r = await api.archive(kind, id, 1);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return id;
}

/** A preset of another kind than `names`. */
const wrongKindFor = (names: PresetKind): Promise<string> => fresh(names === 'item' ? 'flag' : 'item');

/** Writes `body` as the field's kind: a create, or for the one settings preset an edit of it. */
async function write(field: IdField, body: Body): Promise<Answer> {
  if (field.kind !== 'settings') return api.create(field.kind, body);
  const settings = idOf(team, 'settings.team');
  return api.edit('settings', settings, await currentVersion(settings), body);
}

async function refusedUnwritten(
  act: () => Promise<Answer>,
  status: number,
  code: string,
  teamId = team.teamId,
) {
  const before = await footprint(h, teamId);
  const r = await act();
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(errorOf(r).code).toBe(code);
  await expectNothingWritten(h, teamId, before);
  return errorOf(r).details ?? {};
}

describe('every ID a body names (design 4.4, risk 1)', () => {
  it('covers every kind whose body names a preset, and only those', () => {
    const naming = new Set(FIELDS.map((f) => f.kind));
    expect(naming).toEqual(
      new Set(['item', 'bundle', 'field_supply_map', 'condition_supply_map', 'bag', 'settings']),
    );
    // The others name none: a category, a flag. Nothing names a bundle, a map, a bag or the settings.
    expect(PRESET_KINDS.filter((k) => !naming.has(k))).toEqual(['order_category', 'flag']);
  });

  describe.each([['a create'], ['an edit']] as const)('on %s', (act) => {
    /**
     * The field's body with `id`, ready to send as `act`: on an edit, over a preset of the kind made
     * for it first, so that what a refusal must leave as it was is counted after it.
     */
    async function prepared(field: IdField, id: string): Promise<() => Promise<Answer>> {
      if (act === 'a create' || field.kind === 'settings') return () => write(field, field.body(id));
      const made = await createdPreset(api, field.kind, field.body(await fresh(field.names)));
      const body = { ...field.body(id), name: (await currentBody(made.id)).name };
      return () => api.edit(field.kind, made.id, 1, body);
    }

    it('refuses an ID that names no preset of the team: unknown_reference, at its path', async () => {
      for (const field of FIELDS) {
        for (const id of [
          randomUUID(),
          idOf(other, field.names === 'item' ? 'item.gauze' : 'order_category.supplies'),
        ]) {
          const details = await refusedUnwritten(await prepared(field, id), 422, 'invalid');
          expect(details.problems, `${field.kind} ${field.path}`).toContainEqual({
            path: field.path,
            code: 'unknown_reference',
          });
        }
      }
    });

    it('refuses an ID that names a preset of another kind: wrong_kind, at its path', async () => {
      for (const field of FIELDS) {
        const id = await wrongKindFor(field.names);
        const details = await refusedUnwritten(await prepared(field, id), 422, 'invalid');
        expect(details.problems, `${field.kind} ${field.path}`).toContainEqual({
          path: field.path,
          code: 'wrong_kind',
        });
      }
      // A map line names an item, never a bundle (12.2): a kit is an item.
      const bundle = await fresh('bundle');
      const details = await refusedUnwritten(
        await prepared(
          FIELDS.find((f) => f.kind === 'field_supply_map')!,
          bundle,
        ),
        422,
        'invalid',
      );
      expect(details.problems).toContainEqual({ path: 'lines.0.itemId', code: 'wrong_kind' });
    });

    it('refuses an ID that names an archived preset: 409 reference_archived, at its path', async () => {
      for (const field of FIELDS) {
        const id = await archived(field.names);
        const details = await refusedUnwritten(await prepared(field, id), 409, 'reference_archived');
        expect(details.problems, `${field.kind} ${field.path}`).toEqual([
          { path: field.path, code: 'reference_archived' },
        ]);
      }
    });

    it('takes an ID that names an active preset of the right kind', async () => {
      for (const field of FIELDS) {
        const r = await (await prepared(field, await fresh(field.names)))();
        expect(r.status, `${field.kind}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
      }
    });
  });
});

describe('an archive while an active preset names it (design 5.1)', () => {
  it('is refused for every kind that names it, with the counts by kind, and taken once none does', async () => {
    const item = await fresh('item');
    const referrers: [PresetKind, string][] = [];
    for (const field of FIELDS.filter((f) => f.names === 'item')) {
      const r = await write(field, field.body(item));
      expect(r.status, `${field.kind}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
      referrers.push([
        field.kind,
        field.kind === 'settings' ? idOf(team, 'settings.team') : (r.body.id as string),
      ]);
    }
    const details = await refusedUnwritten(() => api.archive('item', item, 1), 409, 'referenced');
    expect(details.referencedBy).toEqual({
      bundle: 1,
      field_supply_map: 1,
      condition_supply_map: 1,
      bag: 1,
      settings: 1,
    });
    // Each referrer in turn stops naming it: archived, or for the settings edited.
    for (const [kind, id] of referrers) {
      if (kind === 'settings') {
        const r = await api.edit(
          'settings',
          id,
          await currentVersion(id),
          make.settings({ newBagMinimums: [] }),
        );
        expect(r.status, JSON.stringify(r.body)).toBe(200);
      } else expect((await api.archive(kind, id, await currentVersion(id))).status).toBe(200);
      const left = (await referencesOf(h, team.teamId)).get(item);
      if (left !== undefined) {
        const again = await refusedUnwritten(() => api.archive('item', item, 1), 409, 'referenced');
        expect(again.referencedBy).toEqual(left);
      }
    }
    expect((await api.archive('item', item, 1)).status).toBe(200);
  });

  it('is refused for a category while an active item is in it', async () => {
    const category = await fresh('order_category');
    const item = await createdPreset(api, 'item', make.item({ categoryId: category }));
    const details = await refusedUnwritten(
      () => api.archive('order_category', category, 1),
      409,
      'referenced',
    );
    expect(details.referencedBy).toEqual({ item: 1 });
    expect((await api.archive('item', item.id, 1)).status).toBe(200);
    expect((await api.archive('order_category', category, 1)).status).toBe(200);
  });

  it('counts a map once however many of its lines name the item, in a refusal and in the list', async () => {
    // Neither map names each item once (only a bundle and a bag do), so one map may name an item in
    // two lines: it is still one preset to change before the item can go.
    const item = await fresh('item');
    const conditionMap = make.condition_supply_map({
      lines: [
        { itemId: item, qtyPerPatient: 1 },
        { itemId: item, qtyPerPatient: 2 },
      ],
    });
    const fieldMap = make.field_supply_map({
      lines: [
        { itemId: item, qty: 1 },
        { itemId: item, qty: 2 },
      ],
    });
    expect((await api.create('condition_supply_map', conditionMap)).status).toBe(201);
    expect((await api.create('field_supply_map', fieldMap)).status).toBe(201);
    const counts = { condition_supply_map: 1, field_supply_map: 1 };
    expect((await referencesOf(h, team.teamId)).get(item)).toEqual(counts);
    const details = await refusedUnwritten(() => api.archive('item', item, 1), 409, 'referenced');
    expect(details.referencedBy).toEqual(counts);
    const rows = (await api.list('item')).body as unknown as Record<string, unknown>[];
    expect(rows.find((r) => r.id === item)!.referencedBy).toEqual(counts);
  });

  it('is never refused for what nothing can name: a flag, a bundle, a map, a bag', async () => {
    for (const kind of ['flag', 'bundle', 'field_supply_map', 'condition_supply_map', 'bag'] as const) {
      const id = await fresh(kind);
      expect((await api.archive(kind, id, 1)).status, kind).toBe(200);
    }
  });
});

describe('the team’s presets as a whole, after every act (design 4.4, risk 1)', () => {
  it('never holds an active body naming an archived preset, another team’s, or none, and lists what names each', async () => {
    // A team's presets made, edited, archived and restored through the routes, over the platform's.
    const category = await fresh('order_category');
    const items = [
      (await createdPreset(api, 'item', make.item({ categoryId: category }))).id,
      await fresh('item'),
      (await createdPreset(api, 'item', make.labItem())).id,
    ];
    const bundle = await createdPreset(
      api,
      'bundle',
      make.bundle({ lines: items.map((itemId) => ({ itemId, qty: 1, core: true })) }),
    );
    await createdPreset(api, 'bag', make.bag({ minimums: items.map((itemId) => ({ itemId, min: 2 })) }));
    await createdPreset(
      api,
      'condition_supply_map',
      make.condition_supply_map({ lines: [{ itemId: items[1]!, qtyPerPatient: 2 }] }),
    );
    // The bundle drops the first item, which is then archived and its category with it.
    const bundleBody = await currentBody(bundle.id);
    const kept = (bundleBody.lines as { itemId: string }[]).filter((l) => l.itemId !== items[0]);
    expect((await api.edit('bundle', bundle.id, 1, { ...bundleBody, lines: kept })).status).toBe(200);
    const bags = await h.scratch.owner<{ id: string }[]>`
      select id from sineobex.team_presets where team_id = ${team.teamId} and kind = 'bag' and state = 'active'`;
    for (const { id } of bags) {
      const body = await currentBody(id);
      const minimums = (body.minimums as { itemId: string }[]).filter((m) => m.itemId !== items[0]);
      if (minimums.length !== (body.minimums as unknown[]).length)
        expect((await api.edit('bag', id, await currentVersion(id), { ...body, minimums })).status).toBe(200);
    }
    expect((await api.archive('item', items[0]!, 1)).status).toBe(200);
    expect((await api.archive('order_category', category, 1)).status).toBe(200);
    // A restore is refused while what it names is archived; the item stays archived.
    expect((await api.restore('item', items[0]!)).status).toBe(409);

    const rows = await h.scratch.owner<{ id: string; kind: PresetKind; state: string; body: Body }[]>`
      select p.id, p.kind, p.state, v.body from sineobex.team_presets p
      join sineobex.team_preset_versions v
        on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
      where p.team_id = ${team.teamId}`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const NAMES: Record<string, PresetKind> = { categoryId: 'order_category' };
    for (const row of rows) {
      const named = idsNamedBy(row.body);
      for (const id of named) {
        const target = byId.get(id);
        expect(target, `${row.kind} ${row.id} names ${id}, a preset of this team`).toBeDefined();
        const expected = id === row.body.categoryId ? NAMES.categoryId : 'item';
        expect(target!.kind, `${row.kind} ${row.id} names a ${expected}`).toBe(expected);
        if (row.state === 'active')
          expect(target!.state, `active ${row.kind} ${row.id} names ${id}`).toBe('active');
      }
    }
    // What each list row says names it is what the bodies say.
    const refs = await referencesOf(h, team.teamId);
    for (const kind of PRESET_KINDS) {
      const r = await api.list(kind);
      expect(r.status).toBe(200);
      for (const row of r.body as unknown as { id: string; referencedBy: unknown }[])
        expect(row.referencedBy, `${kind} ${row.id}`).toEqual(refs.get(row.id) ?? {});
    }
  });
});

describe('a bundle holding a medication is Medical, whatever moves the item (design 4.4; PRD main 447)', () => {
  // A Medical bundle needs a Medical encounter and an ordering credential, and runs the allergy
  // check first. A bundle's own write checks the rule; an item's category may change between a
  // supply and a medication one (only a lab move is fixed), so moving the item checks every active
  // bundle that names it, and a restored bundle is checked as a written one is.
  let m: PresetsTeam;
  let a: PresetsApi;

  beforeAll(async () => {
    m = await presetsTeam(h, 'Refs Medication');
    a = presetsApi(h, m.teamId, m.admin);
  });

  /** Every active bundle of the team that holds a medication and is not Medical. */
  async function bundlesNotMedical(): Promise<string[]> {
    const held = await heldBy(h.scratch.owner as never, m.teamId);
    const refs = presetRefs(held);
    return held
      .filter((p) => p.kind === 'bundle' && p.state === 'active')
      .filter((p) =>
        validatePreset({ kind: 'bundle', body: p.body as PresetBody, refs, definitions: {}, id: p.id }).some(
          (x) => x.code === 'bundle_not_medical',
        ),
      )
      .map((p) => p.id);
  }
  const inOtc = (body: Body) => ({ ...body, categoryId: idOf(m, 'order_category.otc'), medical: true });
  const head = async (id: string) => (await headOf(h, id))!.currentVersion;

  it('refuses an edit that moves an item into a medication category while a Non-Medical bundle holds it', async () => {
    // Socks are in the platform's Winter/frostbite, a Non-Medical bundle (design 4.6).
    const socks = idOf(m, 'item.socks');
    const moved = inOtc(await bodyOf(socks));
    const details = await refusedUnwritten(
      async () => a.edit('item', socks, await head(socks), moved),
      409,
      'bundle_not_medical',
      m.teamId,
    );
    expect(details).toEqual({ bundles: 1 });
    // Tagged Medical first, the bundle lets the item move.
    const winter = idOf(m, 'bundle.winter_frostbite');
    expect(
      (await a.edit('bundle', winter, await head(winter), { ...(await bodyOf(winter)), medical: true }))
        .status,
    ).toBe(200);
    expect((await a.edit('item', socks, await head(socks), moved)).status).toBe(200);
    expect(await bundlesNotMedical()).toEqual([]);
  });

  it('refuses in place a platform update that moves an item so, and takes it once no such bundle holds it', async () => {
    // The team edited its Hygiene kit, so the platform's next version, in OTC, is only offered.
    const kit = idOf(m, 'item.hygiene_kit');
    const ours = { ...(await bodyOf(kit)), captureLot: true };
    expect((await a.edit('item', kit, await head(kit), ours)).status).toBe(200);
    const undo = releasePlatform([
      nextVersion('item.hygiene_kit', (b) => ({ ...inOtc(b), categoryId: 'order_category.otc' })),
    ]);
    try {
      expect((await runInstaller(h, m.teamId)).offer).toEqual({ item: 1 });
      const details = await refusedUnwritten(
        async () => a.takeUpdate('item', kit, await head(kit), false),
        409,
        'bundle_not_medical',
        m.teamId,
      );
      expect(details).toEqual({ bundles: 1 });
      const hygiene = idOf(m, 'bundle.hygiene');
      expect((await a.archive('bundle', hygiene, await head(hygiene))).status).toBe(200);
      expect((await a.takeUpdate('item', kit, await head(kit), false)).status).toBe(200);
      expect(await bundlesNotMedical()).toEqual([]);
    } finally {
      undo();
    }
  });

  it('refuses to restore a Non-Medical bundle whose item became a medication while it was archived', async () => {
    const summer = idOf(m, 'bundle.summer_dehydration');
    const packet = idOf(m, 'item.electrolyte_packet');
    expect((await a.archive('bundle', summer, await head(summer))).status).toBe(200);
    // No active bundle holds the packet now, so it moves.
    expect((await a.edit('item', packet, await head(packet), inOtc(await bodyOf(packet)))).status).toBe(200);
    const details = await refusedUnwritten(() => a.restore('bundle', summer), 422, 'invalid', m.teamId);
    expect(details.problems).toEqual([{ path: 'medical', code: 'bundle_not_medical' }]);
    expect(await bundlesNotMedical()).toEqual([]);
  });

  /** A preset's current body, as stored. */
  async function bodyOf(id: string): Promise<Body> {
    const version = await head(id);
    return (await versionsOf(h, id)).find((v) => v.version === version)!.body;
  }
});
