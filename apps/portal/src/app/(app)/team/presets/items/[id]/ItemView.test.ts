import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CategoryBody, ItemBody, PresetEvent } from '@/lib/presets';
import type { Category, Item } from '../items';
import { ItemView } from './ItemView';

// An item's own page (phase 5 design 8.1) as it first draws from the API's lists. An end-to-end
// test can't draw an update on offer on the seeded team (the platform holds version 1 of every
// preset), so the offer's placing is checked here. Every name is made up but the platform's own.
const OTC = '30e10000-0000-4000-8000-000000000001';
const LABS = '30e10000-0000-4000-8000-000000000002';
const SUPPLIES = '30e10000-0000-4000-8000-000000000003';
const ITEM = '30e10000-0000-4000-8000-000000000101';

const category = (id: string, body: CategoryBody): Category => ({
  id,
  name: body.name,
  state: 'active',
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: { item: 3 },
  body,
});

const CATEGORIES = [
  category(OTC, { name: 'OTC', behaviour: 'medication', sort: 10 }),
  category(LABS, { name: 'Labs', behaviour: 'lab', sort: 30 }),
  category(SUPPLIES, { name: 'Supplies', behaviour: 'supply', sort: 40 }),
];

const item = (body: Partial<ItemBody> = {}, over: Partial<Item> = {}): Item => {
  const full: ItemBody = {
    name: 'Demo: Wool socks',
    categoryId: SUPPLIES,
    unit: 'pair',
    medical: false,
    captureLot: true,
    result: null,
    ...body,
  };
  return {
    id: ITEM,
    name: full.name,
    state: 'active',
    version: 2,
    customized: true,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: { bundle: 2, bag: 1 },
    body: full,
    ...over,
  };
};

const added: PresetEvent = {
  act: 'created',
  version: 1,
  source: 'team',
  by: { userId: '30e10000-0000-4000-8000-000000000201', displayName: 'Demo: Alex' },
  at: '2026-11-02T15:04:00.000Z',
  reason: 'Demo: socks for the winter',
  body: {},
};

const draw = (row: Item = item(), over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(
    createElement(ItemView, { item: row, categories: CATEGORIES, history: [added], ...over }),
  );

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('an item’s page', () => {
  it('is headed by its name, says where it is and what uses it, and goes back to the list', () => {
    const html = draw();
    expect(html).toContain('<a href="/team/presets/items">← Items</a>');
    expect(html).toContain('<h1 class="px-h1">Demo: Wool socks</h1>');
    expect(html).toContain('In Supplies, counted in pair. Used by 2 bundles and 1 bag.');
    expect(draw(item({}, { referencedBy: {} }))).toContain(
      'In Supplies, counted in pair. Nothing uses it yet.',
    );
  });

  it('starts its form from the item as it is, at the version shown', () => {
    const html = draw();
    expect(html).toContain('aria-label="Edit Demo: Wool socks"');
    expect(html).toContain(`<input type="hidden" name="id" value="${ITEM}"/>`);
    expect(html).toContain('<input type="hidden" name="baseVersion" value="2"/>');
    expect(tagOf(html, 'edit-item-name')).toContain('value="Demo: Wool socks"');
    expect(html).toContain(`<option value="${SUPPLIES}" selected="">Supplies</option>`);
    expect(tagOf(html, 'edit-item-medical')).not.toContain('checked');
    expect(tagOf(html, 'edit-item-captureLot')).toContain('checked=""');
  });

  it('shows what it is counted in, read-only and never sent, with 8.1’s sentence', () => {
    const html = draw();
    const unit = tagOf(html, 'edit-item-unit');
    expect(unit).toContain('readOnly=""');
    expect(unit).toContain('value="pair"');
    expect(unit).not.toContain('name=');
    expect(html).toContain(
      '<p id="edit-item-unit-hint" class="sx-help">1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later.</p>',
    );
  });

  it('shows a result it doesn’t record as None, fixed, so a move into Labs is said beside it', () => {
    const html = draw();
    expect(tagOf(html, 'edit-item-result')).toContain('value="None"');
    expect(tagOf(html, 'edit-item-result')).toContain('readOnly=""');
    expect(html).not.toContain('name="result');
  });

  it('lets a test’s options change, never what kind of result it records', () => {
    const html = draw(
      item({
        name: 'Demo: Strep test',
        categoryId: LABS,
        unit: 'test',
        medical: true,
        result: { type: 'choice', options: ['Positive', 'Negative'] },
      }),
    );
    expect(html).toContain(
      'It records a choice from a list. What kind of result it records can’t be changed later; its options can.',
    );
    expect(html).not.toContain('name="result.type"');
    expect(html).toContain('<input type="hidden" name="result.options.count" value="2"/>');
    expect(tagOf(html, 'edit-item-result.options.0')).toContain('value="Positive"');
    expect(tagOf(html, 'edit-item-result.options.1')).toContain('value="Negative"');
    expect(html).toContain('Take out option 2</button>');
    expect(html).toContain('Add an option</button>');
  });

  it('lets a number’s unit change', () => {
    const html = draw(
      item({
        name: 'Glucose test',
        categoryId: LABS,
        unit: 'test',
        medical: true,
        result: { type: 'number', unit: 'mg/dL' },
      }),
    );
    expect(html).toContain(
      'It records a number. What kind of result it records can’t be changed later; its unit can.',
    );
    const unit = tagOf(html, 'edit-item-result.unit');
    expect(unit).toContain('name="result.unit"');
    expect(unit).toContain('value="mg/dL"');
  });

  it('offers Remove, landing on the list, and shows the history', () => {
    const html = draw();
    expect(html).toContain('<h2 id="remove-item" class="px-h2">Remove</h2>');
    expect(html).toContain('Remove<span class="sr-only"> Demo: Wool socks</span></button>');
    expect(html).toContain(`<h2 id="history-${ITEM}" class="px-h2">History</h2>`);
    expect(html).toContain('<td>Added, version 1</td>');
    expect(html).toContain('<td>Demo: socks for the winter</td>');
  });

  it('places Sineobex’s update, its review naming the categories, landing on the list', () => {
    const offered = item(
      {},
      {
        updateOnOffer: true,
        update: {
          platformVersion: 3,
          body: { ...item().body, categoryId: OTC, medical: true },
          changesFixed: [],
        },
      },
    );
    const html = draw(offered);
    expect(html).toContain('Update available<span class="sr-only"> for Demo: Wool socks</span></h2>');
    expect(html).toContain(
      '<th scope="row">Category <span class="sx-pill sx-pill--info">Changes</span></th><td>Supplies</td><td>OTC</td>',
    );
    expect(html).toContain('<input type="hidden" name="platformVersion" value="3"/>');
    expect(html).toContain('<input type="hidden" name="back" value="/team/presets/items"/>');
    expect(html).toContain(
      'Replace with the new version<span class="sr-only"> of Demo: Wool socks</span></button>',
    );
  });

  it('says a removed item is removed, and offers Restore instead of its form', () => {
    const html = draw(item({}, { state: 'archived', referencedBy: {} }));
    expect(html).toContain('<h2 id="removed-item" class="px-h2">Removed</h2>');
    expect(html).toContain('This item isn’t offered for new work. Restore it to offer it again.');
    expect(html).toContain('aria-label="Restore Demo: Wool socks"');
    expect(html).not.toContain('aria-label="Edit Demo: Wool socks"');
    expect(html).not.toContain('Update available');
  });

  it('says it was restored, after the page is sent back', () => {
    expect(draw(item(), { done: 'restored', preset: ITEM })).toContain('Restored: Demo: Wool socks</h2>');
  });
});
