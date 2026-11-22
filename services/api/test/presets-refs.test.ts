import { randomUUID } from 'node:crypto';
import { PRESET_KINDS, type PresetKind } from '@sineobex/presets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  presetsApi,
  presetsTeam,
  referencesOf,
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

async function refusedUnwritten(act: () => Promise<Answer>, status: number, code: string) {
  const before = await footprint(h, team.teamId);
  const r = await act();
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(errorOf(r).code).toBe(code);
  await expectNothingWritten(h, team.teamId, before);
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
    /** The field's body with `id`, sent as `act`: on an edit, over a preset of the kind made for it. */
    async function send(field: IdField, id: string): Promise<Answer> {
      if (act === 'a create' || field.kind === 'settings') return write(field, field.body(id));
      const made = await createdPreset(api, field.kind, field.body(await fresh(field.names)));
      const body = { ...field.body(id), name: (await currentBody(made.id)).name };
      return api.edit(field.kind, made.id, 1, body);
    }

    it('refuses an ID that names no preset of the team: unknown_reference, at its path', async () => {
      for (const field of FIELDS) {
        for (const id of [
          randomUUID(),
          idOf(other, field.names === 'item' ? 'item.gauze' : 'order_category.supplies'),
        ]) {
          const details = await refusedUnwritten(() => send(field, id), 422, 'invalid');
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
        const details = await refusedUnwritten(() => send(field, id), 422, 'invalid');
        expect(details.problems, `${field.kind} ${field.path}`).toContainEqual({
          path: field.path,
          code: 'wrong_kind',
        });
      }
      // A map line names an item, never a bundle (12.2): a kit is an item.
      const bundle = await fresh('bundle');
      const details = await refusedUnwritten(
        () =>
          send(
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
        const details = await refusedUnwritten(() => send(field, id), 409, 'reference_archived');
        expect(details.problems, `${field.kind} ${field.path}`).toEqual([
          { path: field.path, code: 'reference_archived' },
        ]);
      }
    });

    it('takes an ID that names an active preset of the right kind', async () => {
      for (const field of FIELDS) {
        const r = await send(field, await fresh(field.names));
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
