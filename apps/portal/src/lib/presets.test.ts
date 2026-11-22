import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAreas, PRESET_AREAS, readHub, type HubLists, type PresetKind } from './presets';

// What the portal's preset pages read of the admin routes (phase 5 design 7, 8.1). The API answers
// every list here; `answers` stands in for it, kind by kind, and `asked` records the order the
// hub asks in. Every value is made up.
const asked: string[] = [];
let answers: (kind: PresetKind) => Promise<unknown>;

vi.mock('./api', () => ({
  api: async () => ({
    GET: async (_path: string, init: { params: { path: { kind: PresetKind } } }) => {
      const { kind } = init.params.path;
      asked.push(`ask ${kind}`);
      try {
        return await answers(kind);
      } finally {
        asked.push(`answered ${kind}`);
      }
    },
  }),
  // The fake's GET answers what unwrap would: the rows, or the refusal it throws.
  unwrap: async (call: Promise<unknown>) => call,
}));

const row = (state: 'active' | 'archived', updateOnOffer = false) => ({ state, updateOnOffer });

/** The hub's lists with nothing on offer: 4 categories, 2 items (1 archived), and 1 of each other kind. */
const lists = (): HubLists => ({
  order_category: [row('active'), row('active'), row('active'), row('active')],
  item: [row('active'), row('archived')],
  bundle: [row('active')],
  flag: [row('active')],
  condition_supply_map: [row('active')],
  bag: [row('active')],
  settings: [row('active')],
});

const card = (areas: ReturnType<typeof hubAreas>, key: string) => areas.find((a) => a.key === key)!;

describe('the hub’s cards', () => {
  it('count the active presets of each area, and offer nothing when nothing is on offer', () => {
    const areas = hubAreas(lists());
    expect(areas.map((a) => a.key)).toEqual([
      'categories',
      'items',
      'bundles',
      'flags',
      'condition-supplies',
      'bag-minimums',
    ]);
    expect(areas.map((a) => (a.loaded ? [a.count, a.updateAvailable] : null))).toEqual([
      [4, false],
      [1, false],
      [1, false],
      [1, false],
      [1, false],
      [1, false],
    ]);
  });

  it('say an update is available where an active preset of the area is offered one', () => {
    const offered = { ...lists(), bundle: [row('active'), row('active', true)] };
    const areas = hubAreas(offered);
    expect(card(areas, 'bundles')).toMatchObject({ loaded: true, count: 2, updateAvailable: true });
    expect(areas.filter((a) => a.loaded && a.updateAvailable).map((a) => a.key)).toEqual(['bundles']);
  });

  it('show the settings’ update on both pages that show the settings', () => {
    const areas = hubAreas({ ...lists(), settings: [row('active', true)] });
    expect(areas.filter((a) => a.loaded && a.updateAvailable).map((a) => a.key)).toEqual([
      'condition-supplies',
      'bag-minimums',
    ]);
    // The count is still the area's own kind.
    expect(card(areas, 'bag-minimums')).toMatchObject({ count: 1 });
  });

  it('never point at an update of a removed preset: it is restored before anything is offered', () => {
    const areas = hubAreas({ ...lists(), flag: [row('active'), row('archived', true)] });
    expect(card(areas, 'flags')).toMatchObject({ loaded: true, count: 1, updateAvailable: false });
  });

  it('leave unloaded every card whose list could not be read, and only those', () => {
    const areas = hubAreas({ ...lists(), settings: 'error', item: undefined });
    expect(areas.filter((a) => !a.loaded).map((a) => a.key)).toEqual([
      'items',
      'condition-supplies',
      'bag-minimums',
    ]);
  });
});

describe('reading the hub', () => {
  beforeEach(() => {
    asked.length = 0;
  });

  it('asks the first list alone, then every other kind once, the settings once for two cards', async () => {
    const all = lists();
    answers = async (kind) => all[kind];
    const areas = await readHub();
    const first = PRESET_AREAS[0]!.kinds[0]!;
    expect(asked.slice(0, 2)).toEqual([`ask ${first}`, `answered ${first}`]);
    expect(asked.filter((a) => a.startsWith('ask')).toSorted()).toEqual(
      ['bag', 'bundle', 'condition_supply_map', 'flag', 'item', 'order_category', 'settings'].map(
        (k) => `ask ${k}`,
      ),
    );
    expect(areas.every((a) => a.loaded)).toBe(true);
  });

  it('shows a list the API could not answer as its cards’ error, never the whole page’s', async () => {
    const all = lists();
    answers = async (kind) => {
      if (kind === 'bundle') throw new Error('the API answered 500');
      return all[kind];
    };
    const areas = await readHub();
    expect(areas.filter((a) => !a.loaded).map((a) => a.key)).toEqual(['bundles']);
  });

  it('lets a refused key send the person where every refused page does, after one refusal only', async () => {
    answers = async () => redirect('/home?denied=1');
    await expect(readHub()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    // One request, so the API logs one access.denied.
    expect(asked.filter((a) => a.startsWith('ask'))).toHaveLength(1);
  });
});
