import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CategoryBody, ItemBody } from '@/lib/presets';
import { searched } from './ItemList';
import { itemGroups, itemSummary, type Category, type Item } from './items';
import { ItemsView } from './ItemsView';

// Items (phase 5 design 8.1) as the page first draws them from the API's lists. Every name is made
// up but the platform's own ones (OTC, Labs, Supplies, Gauze).
const OTC = '30e00000-0000-4000-8000-000000000001';
const LABS = '30e00000-0000-4000-8000-000000000002';
const SUPPLIES = '30e00000-0000-4000-8000-000000000003';
const SHELF = '30e00000-0000-4000-8000-000000000004';
const EMPTY = '30e00000-0000-4000-8000-000000000005';
const id = (n: number) => `30e00000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

const category = (
  categoryId: string,
  body: CategoryBody,
  state: 'active' | 'archived' = 'active',
): Category => ({
  id: categoryId,
  name: body.name,
  state,
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body,
});

const item = (
  itemId: string,
  body: Partial<ItemBody> & Pick<ItemBody, 'name' | 'categoryId'>,
  over: Partial<Item> = {},
): Item => {
  const full: ItemBody = { unit: 'each', medical: false, captureLot: false, result: null, ...body };
  return {
    id: itemId,
    name: full.name,
    state: 'active',
    version: 1,
    customized: false,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: {},
    body: full,
    ...over,
  };
};

const CATEGORIES: Category[] = [
  category(SUPPLIES, { name: 'Supplies', behaviour: 'supply', sort: 40 }),
  category(LABS, { name: 'Labs', behaviour: 'lab', sort: 30 }),
  category(OTC, { name: 'OTC', behaviour: 'medication', sort: 10 }),
  category(EMPTY, { name: 'Demo: Empty shelf', behaviour: 'supply', sort: 50 }),
  category(SHELF, { name: 'Demo: Old shelf', behaviour: 'supply', sort: 60 }, 'archived'),
];

const ITEMS: Item[] = [
  item(id(1), { name: 'Gauze', categoryId: SUPPLIES }),
  item(id(2), { name: 'Demo: Rain poncho', categoryId: SUPPLIES }),
  item(id(3), {
    name: 'Glucose test',
    categoryId: LABS,
    unit: 'test',
    medical: true,
    result: { type: 'number', unit: 'mg/dL' },
  }),
  item(id(4), {
    name: 'Demo: Strep test',
    categoryId: LABS,
    unit: 'test',
    medical: true,
    result: { type: 'choice', options: ['Positive', 'Negative'] },
  }),
  item(id(5), { name: 'Demo: Flu shot', categoryId: OTC, unit: 'dose', medical: true, captureLot: true }),
  item(id(6), { name: 'Demo: Old kit', categoryId: SHELF }, { state: 'archived' }),
];

const draw = (items: Item[] = ITEMS, over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(createElement(ItemsView, { items, categories: CATEGORIES, ...over }));

/** Each group's heading, in the order the page draws them. */
const groups = (html: string) =>
  [...html.matchAll(/<h2 id="items-in-[^"]+" class="px-h2">([^<]+)<\/h2>/g)].map((m) => m[1]);

/** One category's group of the page: up to the next group's, or to Add an item. */
const groupOf = (html: string, categoryId: string) => {
  const at = html.indexOf(`<section aria-labelledby="items-in-${categoryId}"`);
  const next = html.indexOf('<section aria-labelledby="items-in-', at + 1);
  return html.slice(at, next < 0 ? html.indexOf('<section aria-labelledby="add-item"') : next);
};

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, elementId: string) => {
  const at = html.indexOf(`id="${elementId}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the list', () => {
  it('groups the active items by category, in the categories’ place, each group A to Z', () => {
    const html = draw();
    expect(html).toContain('<h1 class="px-h1">Items</h1>');
    // A category holding no active item has no group, and a removed item is in none.
    expect(groups(html)).toEqual(['OTC', 'Labs', 'Supplies']);
    const names = (g: string) => [...g.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(names(groupOf(html, LABS))).toEqual(['Demo: Strep test', 'Glucose test']);
    expect(names(groupOf(html, SUPPLIES))).toEqual(['Demo: Rain poncho', 'Gauze']);
  });

  it('links each item to its own page, by its ID only, with a line of what it is', () => {
    const labs = groupOf(draw(), LABS);
    expect(labs).toContain(`<a href="/team/presets/items/${id(3)}">Glucose test</a>`);
    expect(labs).toContain('Counted in test · Medical · Records a number in mg/dL');
    expect(labs).toContain('Counted in test · Medical · Records a choice');
    expect(groupOf(draw(), OTC)).toContain('Counted in dose · Medical · Lot and expiry');
    expect(groupOf(draw(), SUPPLIES)).toContain('Counted in each · Non-Medical');
  });

  it('marks an item Sineobex offers an update of, in its own place', () => {
    const offered = ITEMS.map((i) => (i.id === id(1) ? { ...i, updateOnOffer: true } : i));
    const html = draw(offered);
    expect(html.split('Update available</span>')).toHaveLength(2);
    expect(groupOf(html, SUPPLIES)).toContain(
      `<a href="/team/presets/items/${id(1)}">Gauze</a><span class="sx-pill sx-pill--info">Update available</span>`,
    );
  });

  it('has a search box that is in no form and posts nothing, never filled in by the browser', () => {
    const html = draw();
    expect(html).toContain('<div role="search" aria-label="Items" class="px-panel">');
    expect(html).toContain('<label for="item-search">Search items</label>');
    const box = tagOf(html, 'item-search');
    for (const attribute of [
      'type="search"',
      'autoComplete="off"',
      'aria-describedby="item-search-hint item-search-found"',
    ])
      expect(box).toContain(attribute);
    expect(box).not.toContain('name=');
    // The only forms on the page are the add form and the Removed list's: the search is before both.
    expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf('<form'));
    expect(html).toContain('<p id="item-search-found" role="status" class="sx-help"></p>');
  });

  it('lists the removed ones under Removed, with Restore, and none of them above', () => {
    const html = draw();
    expect(html).toContain('Removed (1)</h2>');
    expect(html).toContain('Restore<span class="sr-only"> Demo: Old kit</span></button>');
    expect(html.slice(0, html.indexOf('add-item'))).not.toContain('Demo: Old kit');
  });

  it('says when no item is on the list', () => {
    const html = draw(ITEMS.map((i) => ({ ...i, state: 'archived' as const })));
    expect(groups(html)).toEqual([]);
    expect(html).toContain('<p class="px-panel">No item is on your team’s list. Add one below.</p>');
    expect(html).not.toContain('role="search"');
  });

  it('names the item an act was done to, after the page is sent back', () => {
    const html = draw(ITEMS, { done: 'removed', preset: id(6) });
    expect(html).toContain('Removed: Demo: Old kit</h2>');
    expect(draw(ITEMS, { done: 'nonsense', preset: id(6) })).not.toContain('px-alert--ok');
  });
});

describe('the search', () => {
  const all = itemGroups(ITEMS, CATEGORIES);

  it('keeps the items whose names hold what was typed, in any case and without accents, and drops empty groups', () => {
    expect(searched(all, '  TEST ').map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['Labs', ['Demo: Strep test', 'Glucose test']],
    ]);
    expect(searched(all, 'gáuze').flatMap((g) => g.items.map((i) => i.name))).toEqual(['Gauze']);
    expect(searched(all, 'nothing like it')).toEqual([]);
  });

  it('shows every item while nothing is typed', () => {
    expect(searched(all, ' ')).toEqual(all);
  });

  it('says what each item is in one line', () => {
    expect(itemSummary(ITEMS[0]!.body)).toBe('Counted in each · Non-Medical');
  });
});

describe('Add an item', () => {
  const add = () => {
    const html = draw();
    return html.slice(html.indexOf('<section aria-labelledby="add-item"'));
  };

  it('asks for a name, with the warning under the box', () => {
    const html = add();
    expect(html).toContain('<h2 id="add-item" class="px-h2">Add an item</h2>');
    expect(html).toContain('aria-label="Add an item"');
    expect(tagOf(html, 'new-item-name')).toContain('aria-describedby="new-item-name-warning"');
  });

  it('offers the categories by what they hold, in their place, a removed one not at all', () => {
    const html = add();
    const select = html.slice(html.indexOf('<select id="new-item-categoryId"'), html.indexOf('</select>'));
    expect(select).toContain('name="categoryId"');
    expect(select).toContain('<option value="" selected="">Choose a category</option>');
    expect([...select.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1])).toEqual([
      'Medications',
      'Tests',
      'Supplies',
    ]);
    expect([...select.matchAll(/<option value="[0-9a-f-]{36}">([^<]+)<\/option>/g)].map((m) => m[1])).toEqual(
      ['OTC', 'Labs', 'Supplies', 'Demo: Empty shelf'],
    );
  });

  it('says under Counted in what 1 of it means and that it can’t be changed later', () => {
    const html = add();
    expect(html).toContain('<label for="new-item-unit">Counted in</label>');
    expect(html).toContain(
      '<p id="new-item-unit-hint" class="sx-help">1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later.</p>',
    );
    expect(tagOf(html, 'new-item-unit')).toContain(
      'aria-describedby="new-item-unit-hint new-item-unit-warning"',
    );
  });

  it('asks Medical and Capture lot and expiry, each saying what it means, neither ticked', () => {
    const html = add();
    expect(html).toContain('<label for="new-item-medical">Medical</label>');
    expect(html).toContain(
      'Offered only at a Medical visit. An item in a category that holds medications or tests is always Medical.',
    );
    expect(html).toContain('<label for="new-item-captureLot">Capture lot and expiry</label>');
    expect(html).toContain('Staff record its lot and expiry date each time they give one.');
    expect(tagOf(html, 'new-item-medical')).not.toContain('checked');
    expect(tagOf(html, 'new-item-captureLot')).not.toContain('checked');
  });

  it('asks what result a test records, None to start with, which can’t be changed later', () => {
    const html = add();
    expect(html).toContain('<legend>Result</legend>');
    expect(tagOf(html, 'new-item-result')).toContain('aria-describedby="new-item-result-hint"');
    expect(html).toContain(
      'Only an item in a category that holds tests records a result. What kind of result it records can’t be changed later.',
    );
    const kinds = [...html.matchAll(/<label for="new-item-result-(\w+)">([^<]+)<\/label>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(kinds).toEqual([
      ['none', 'None'],
      ['choice', 'A choice from a list'],
      ['number', 'A number'],
    ]);
    expect(tagOf(html, 'new-item-result-none')).toContain('checked=""');
    expect(tagOf(html, 'new-item-result-none')).toContain('name="result.type"');
    // The options and the unit are drawn once a choice or a number is chosen.
    expect(html).not.toContain('result.options');
    expect(html).not.toContain('result.unit');
  });

  it('asks for a reason, as every write does', () => {
    const html = add();
    expect(html).toContain('<label for="new-item-reason">Reason</label>');
    expect(html).toContain('Add item</button>');
  });
});
