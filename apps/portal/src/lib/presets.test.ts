import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from './api';
import { PortalApiError } from './api';
import {
  donePath,
  hubAreas,
  namedPreset,
  PRESET_AREAS,
  presetFailure,
  presetNow,
  presetPage,
  readHub,
  readLines,
  readTexts,
  sentValues,
  wholeNumber,
  type HubLists,
  type PresetKind,
} from './presets';

// What the portal's preset pages read of the admin routes (phase 5 design 7, 8.1). The API answers
// every list here; `answers` stands in for it, kind by kind, and `asked` records the order the
// hub asks in. Every value is made up.
const asked: string[] = [];
let answers: (kind: PresetKind) => Promise<unknown>;

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
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

const ITEM = '30a00000-0000-4000-8000-000000000001';
const OTHER = '30a00000-0000-4000-8000-000000000002';

describe('what a preset form sent', () => {
  it('keeps every text but React’s own fields for the action', () => {
    const form = new FormData();
    form.set('$ACTION_ID_abc', '');
    form.set('$ACTION_REF_1', '');
    form.set('name', 'Demo: Rainy night');
    form.set('lines.0.itemId', ITEM);
    form.set('photo', new Blob(['x']));
    expect(sentValues(form)).toEqual({ name: 'Demo: Rainy night', 'lines.0.itemId': ITEM });
  });

  it('reads a bundle’s lines in order, as the body holds them', () => {
    const form = new FormData();
    form.set('lines.count', '3');
    form.set('lines.0.itemId', ITEM);
    form.set('lines.0.qty', '2');
    form.set('lines.0.core', 'on');
    form.set('lines.1.itemId', OTHER);
    form.set('lines.1.qty', ' 1 ');
    form.set('lines.2.itemId', '');
    form.set('lines.2.qty', 'two');
    form.set('minimums.0.itemId', ITEM);
    expect(readLines(form, 'lines', { quantity: 'qty', core: true })).toEqual([
      { itemId: ITEM, qty: 2, core: true },
      { itemId: OTHER, qty: 1, core: false },
      // As typed, so the API names the line to fix.
      { itemId: '', qty: 'two', core: false },
    ]);
  });

  it('reads a number as typed: a whole number as one, anything else as the text it is', () => {
    expect(wholeNumber('15')).toBe(15);
    expect(wholeNumber(' 007 ')).toBe(7);
    expect(wholeNumber('1000000')).toBe(1_000_000);
    // As typed, so the API names the field: it holds each field to its own range.
    for (const typed of ['', 'ten', '1.5', '-1', '1,000', '12345678'])
      expect(wholeNumber(typed), typed).toBe(typed.trim());
    expect(wholeNumber(undefined)).toBe('');
  });

  it('reads a list with no Core, by its own quantity, and none when it sent none', () => {
    const form = new FormData();
    form.set('minimums.count', '1');
    form.set('minimums.0.itemId', ITEM);
    form.set('minimums.0.min', '12');
    expect(readLines(form, 'minimums', { quantity: 'min' })).toEqual([{ itemId: ITEM, min: 12 }]);
    expect(readLines(form, 'lines', { quantity: 'qty', core: true })).toEqual([]);
  });

  it('reads a list of boxes in order, each without the spaces around it, an empty one as empty', () => {
    const form = new FormData();
    form.set('result.options.count', '3');
    form.set('result.options.1', ' Negative ');
    form.set('result.options.0', 'Positive');
    form.set('result.options.2', '');
    form.set('result.unit', 'mg/dL');
    expect(readTexts(form, 'result.options')).toEqual(['Positive', 'Negative', '']);
    // Only the list's own numbered boxes: neither the unit nor the options are entries of `result`.
    expect(readTexts(form, 'result')).toEqual([]);
    expect(readTexts(new FormData(), 'result.options')).toEqual([]);
  });
});

describe('where an act on a preset comes back to', () => {
  it('is a page of Team setup’s, by path alone, the form’s own choice first', () => {
    expect(presetPage('/team/presets/items', '/team/presets/items/' + ITEM)).toBe('/team/presets/items');
    expect(presetPage(undefined, '/team/presets/bundles/' + ITEM)).toBe('/team/presets/bundles/' + ITEM);
    expect(presetPage(undefined, '/team/presets')).toBe('/team/presets');
  });

  it('is never another page, an address with more than a path, or another site', () => {
    for (const crafted of [
      '/home',
      '/team/presetsx',
      '/team/presets/../members',
      '/team/presets/items?done=removed',
      '/team/presets/items#x',
      '//elsewhere.example.com/team/presets',
      'https://elsewhere.example.com/team/presets',
      '/team/presets/Items',
    ])
      expect(presetPage(crafted, null), crafted).toBe('/team/presets');
  });

  it('says what was done to which preset, by an act’s name and an ID only', () => {
    expect(donePath('/team/presets/items', 'removed', ITEM)).toBe(
      `/team/presets/items?done=removed&preset=${ITEM}`,
    );
  });

  it('names a preset only as a page writes one', () => {
    expect(namedPreset({ kind: 'item', id: ITEM, baseVersion: '3' })).toEqual({
      kind: 'item',
      id: ITEM,
      baseVersion: 3,
    });
    expect(namedPreset({ kind: 'bag', id: ITEM })).toEqual({ kind: 'bag', id: ITEM, baseVersion: null });
    expect(namedPreset({ kind: 'note_type', id: ITEM })).toBeNull();
    expect(namedPreset({ kind: 'item', id: 'not-an-id' })).toBeNull();
    for (const baseVersion of ['0', '1.5', '', 'x', '9007199254740993'])
      expect(namedPreset({ kind: 'item', id: ITEM, baseVersion }), baseVersion).toBeNull();
  });
});

describe('the preset an edit builds on', () => {
  it('is the API’s list row for the ID, or none when the team holds none of the kind with it', async () => {
    const rows = [
      { id: ITEM, name: 'Demo: Gauze', body: { name: 'Demo: Gauze' } },
      { id: OTHER, name: 'Demo: Socks', body: { name: 'Demo: Socks' } },
    ];
    answers = async (kind) => (kind === 'item' ? rows : []);
    expect(await presetNow('item', OTHER)).toBe(rows[1]);
    expect(await presetNow('item', '30a00000-0000-4000-8000-000000000009')).toBeNull();
    expect(await presetNow('bundle', ITEM)).toBeNull();
  });
});

describe('a preset form the API refused', () => {
  it('shows the refusal’s sentence and keeps what was sent', () => {
    const state = presetFailure(
      new PortalApiError(409, 'stale', 'm', { currentVersion: 4 }),
      { reason: 'Demo: a reason' },
      { kind: 'item', act: 'remove' },
    );
    expect(state).toEqual({
      error: 'Someone else changed this while you were editing. Reload to see their version.',
      values: { reason: 'Demo: a reason' },
    });
  });

  it('lets anything that is no refusal go on up: a sign-in to renew, a lost connection', () => {
    let reauth: unknown;
    try {
      redirect('/reauth?next=%2Fteam%2Fpresets%2Fitems');
    } catch (err) {
      reauth = err;
    }
    expect(() => presetFailure(reauth, {}, { kind: 'item', act: 'remove' })).toThrow(reauth as Error);
    const lost = new TypeError('fetch failed');
    expect(() => presetFailure(lost, {}, { kind: 'item', act: 'remove' })).toThrow(lost);
  });
});
