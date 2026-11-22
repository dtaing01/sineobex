import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PresetEvent } from '@/lib/presets';
import { CategoriesView, inOrder, nextPlace, type Category } from './CategoriesView';

// Categories (phase 5 design 8.1) as the page first draws them from the API's list. An end-to-end
// test can't draw an update on offer on the seeded team (the platform holds version 1 of every
// preset), so the offer's placing is checked here. Every name is made up.
const OTC = '30c00000-0000-4000-8000-000000000001';
const LABS = '30c00000-0000-4000-8000-000000000002';
const OWN = '30c00000-0000-4000-8000-000000000003';
const OLD = '30c00000-0000-4000-8000-000000000004';

const category = (
  id: string,
  body: Category['body'],
  over: Partial<Omit<Category, 'body'>> = {},
): Category => ({
  id,
  name: body.name,
  state: 'active',
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body,
  ...over,
});

const ROWS: Category[] = [
  category(LABS, { name: 'Labs', behaviour: 'lab', sort: 30 }, { referencedBy: { item: 2 } }),
  category(OWN, { name: 'Demo: Hygiene kits', behaviour: 'supply', sort: 30 }, { version: 2 }),
  category(OTC, { name: 'OTC', behaviour: 'medication', sort: 10 }, { referencedBy: { item: 12 } }),
  category(OLD, { name: 'Demo: Old kits', behaviour: 'supply', sort: 90 }, { state: 'archived' }),
];

const installed: PresetEvent = {
  act: 'installed',
  version: 1,
  source: 'platform',
  by: null,
  at: '2026-11-02T15:04:00.000Z',
  reason: null,
  body: {},
};

const draw = (rows: Category[] = ROWS, over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(
    createElement(CategoriesView, { rows, histories: { [OTC]: [installed], [LABS]: [installed] }, ...over }),
  );

/** Each category's section, by its heading, in the order the page draws them. */
const headings = (html: string) =>
  [...html.matchAll(/<h2 id="category-[^"]+" class="px-h2">([^<]+)<\/h2>/g)].map((m) => m[1]);

/** One category's section of the page: up to the next category's, or to Add a category. */
const sectionOf = (html: string, id: string) => {
  const at = html.indexOf(`<section aria-labelledby="category-${id}"`);
  const next = html.indexOf('<section aria-labelledby="category-', at + 1);
  return html.slice(at, next < 0 ? html.indexOf('<section aria-labelledby="add-category"') : next);
};

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the list', () => {
  it('shows the active categories by their place in the list, two at one place by name', () => {
    const html = draw();
    expect(headings(html)).toEqual(['OTC', 'Demo: Hygiene kits', 'Labs']);
    expect(html).toContain('<h1 class="px-h1">Categories</h1>');
    expect(inOrder(ROWS).map((r) => r.name)).toEqual(['OTC', 'Demo: Hygiene kits', 'Labs', 'Demo: Old kits']);
  });

  it('says what each holds, its place and what uses it', () => {
    const html = draw();
    const otc = sectionOf(html, OTC);
    expect(otc).toContain('<dt>What it holds</dt><dd>Medications</dd>');
    expect(otc).toContain('<dt>Place in the list</dt><dd>10</dd>');
    expect(otc).toContain('<dt>Used by</dt><dd>12 items</dd>');
    expect(sectionOf(html, LABS)).toContain('<dt>What it holds</dt><dd>Tests</dd>');
    const own = sectionOf(html, OWN);
    expect(own).toContain('<dd>Supplies</dd>');
    expect(own).toContain('<dt>Used by</dt><dd>Nothing yet</dd>');
  });

  it('offers Edit and Remove on each, named for it, and its history in its own panel', () => {
    const otc = sectionOf(draw(), OTC);
    expect(otc).toContain('Edit<span class="sr-only"> OTC</span></button>');
    expect(otc).toContain('Remove<span class="sr-only"> OTC</span></button>');
    expect(otc).toMatch(new RegExp(`<section aria-labelledby="history-${OTC}" class="[^"]*flat[^"]*">`));
    expect(otc).toContain(`<h3 id="history-${OTC}" class="px-h3">History of OTC</h3>`);
    expect(otc).toContain('<td>Added by Sineobex, version 1</td>');
  });

  it('places Sineobex’s update in the section of the category it is for, and nowhere else', () => {
    const offered = ROWS.map((r) =>
      r.id === LABS
        ? {
            ...r,
            updateOnOffer: true,
            update: { platformVersion: 2, body: { ...r.body, sort: 25 }, changesFixed: [] },
          }
        : r,
    );
    const html = draw(offered);
    expect(html.split('Update available<span class="sr-only">')).toHaveLength(2);
    const labs = sectionOf(html, LABS);
    expect(labs).toContain('Update available<span class="sr-only"> for Labs</span></h3>');
    expect(labs).toContain('<p>Sineobex updated this preset. Your edited copy hasn’t changed.</p>');
    expect(labs).toContain(
      '<th scope="row">Place in the list <span class="sx-pill sx-pill--info">Changes</span></th><td>30</td><td>25</td>',
    );
    expect(labs).toContain('Replace with the new version</button>');
  });

  it('offers an update that changes what a category holds only as a new one', () => {
    const offered = ROWS.map((r) =>
      r.id === OTC
        ? {
            ...r,
            updateOnOffer: true,
            updateChangesFixed: true,
            update: {
              platformVersion: 2,
              body: { ...r.body, behaviour: 'supply' as const },
              changesFixed: ['behaviour'],
            },
          }
        : r,
    );
    const otc = sectionOf(draw(offered), OTC);
    expect(otc).toContain(
      '<p>This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.</p>',
    );
    expect(otc).toContain('Add as new</button>');
  });

  it('lists the removed ones under Removed, with Restore, and none of them above', () => {
    const html = draw();
    expect(headings(html)).not.toContain('Demo: Old kits');
    expect(html).toContain('Removed (1)</h2>');
    expect(html).toContain('Restore<span class="sr-only"> Demo: Old kits</span></button>');
  });

  it('says when no category is on the list', () => {
    const html = draw(ROWS.map((r) => ({ ...r, state: 'archived' as const })));
    expect(headings(html)).toEqual([]);
    expect(html).toContain('<p class="px-panel">No category is on your team’s list. Add one below.</p>');
    expect(html).toContain('Removed (4)</h2>');
  });

  it('names the category an act was done to, after the page is sent back', () => {
    const html = draw(ROWS, { done: 'removed', preset: OLD });
    expect(html).toContain('Removed: Demo: Old kits</h2>');
    expect(html).toContain('<p>It’s in the Removed list, where it can be restored.</p>');
    expect(draw(ROWS, { done: 'nonsense', preset: OLD })).not.toContain('px-alert--ok');
  });
});

describe('the edit form', () => {
  it('is drawn once Edit is pressed, so nothing of it is drawn yet', () => {
    expect(draw()).not.toContain(`id="edit-${OTC}"`);
  });
});

describe('Add a category', () => {
  const add = () => {
    const html = draw();
    return html.slice(html.indexOf('<section aria-labelledby="add-category"'));
  };

  it('asks for a name, with the warning under the box, and what it holds, which can’t be changed later', () => {
    const html = add();
    expect(html).toContain('<h2 id="add-category" class="px-h2">Add a category</h2>');
    expect(html).toContain('aria-label="Add a category"');
    const name = tagOf(html, 'new-category-name');
    for (const attribute of ['name="name"', 'type="text"', 'required=""', 'autoComplete="off"', 'value=""'])
      expect(name).toContain(attribute);
    expect(name).toContain('aria-describedby="new-category-name-warning"');
    expect(html).toContain(
      '<p id="new-category-name-warning" class="sx-help">Don’t put patient names here.</p>',
    );
    expect(html.indexOf('new-category-name-warning" class')).toBeGreaterThan(
      html.indexOf('<input id="new-category-name"'),
    );
    const group = tagOf(html, 'new-category-behaviour');
    expect(group).toContain('aria-describedby="new-category-behaviour-hint"');
    expect(html).toContain('<legend>What it holds</legend>');
    expect(html).toContain(
      '<p id="new-category-behaviour-hint" class="sx-help">What it holds can’t be changed later.</p>',
    );
  });

  it('offers Supplies, Medications and Tests, each saying what it means for its items, none chosen', () => {
    const html = add();
    const choices = [...html.matchAll(/<label for="new-category-behaviour-(\w+)">([^<]+)<\/label>/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(choices).toEqual([
      ['supply', 'Supplies'],
      ['medication', 'Medications'],
      ['lab', 'Tests'],
    ]);
    expect(html).toContain('Its items can be Medical or Non-Medical.');
    expect(html).toContain('Its items are always Medical.');
    expect(html).toContain('Its items are always Medical, and each records a result.');
    expect(html).not.toContain('checked=""');
  });

  it('puts the new one after every category the team holds, removed ones too', () => {
    expect(add()).toContain('<input type="hidden" name="sort" value="100"/>');
    expect(nextPlace([])).toBe(10);
    expect(nextPlace([category(OWN, { name: 'Demo: Last', behaviour: 'supply', sort: 999_995 })])).toBe(
      1_000_000,
    );
  });

  it('asks for a reason, as every write does', () => {
    expect(add()).toContain('<label for="new-category-reason">Reason</label>');
  });
});
