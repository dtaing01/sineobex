import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemChoice } from '@/components/presets/ItemLines';
import type { BundleBody } from '@/lib/presets';
import { bundleSummary, type Bundle } from './BundleFields';
import { BundlesView } from './BundlesView';

// Bundles (phase 5 design 8.1) as the page first draws them from the API's lists. Every name is
// made up but the platform's own.
const WOUND = '30e20000-0000-4000-8000-000000000001';
const RAINY = '30e20000-0000-4000-8000-000000000002';
const OLD = '30e20000-0000-4000-8000-000000000003';
const GAUZE = '30e20000-0000-4000-8000-000000000101';
const DOXY = '30e20000-0000-4000-8000-000000000102';
const GONE = '30e20000-0000-4000-8000-000000000103';

const bundle = (id: string, body: BundleBody, over: Partial<Bundle> = {}): Bundle => ({
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

const BUNDLES: Bundle[] = [
  bundle(RAINY, {
    name: 'Demo: Rainy night',
    medical: false,
    prompt: 'Demo: Ask whether they have somewhere dry to sleep.',
    lines: [{ itemId: GAUZE, qty: 1, core: true }],
  }),
  bundle(WOUND, {
    name: 'Basic wound care',
    medical: true,
    prompt: '',
    lines: [
      { itemId: GAUZE, qty: 1, core: true },
      { itemId: DOXY, qty: 1, core: false },
    ],
  }),
  bundle(OLD, { name: 'Demo: Old bundle', medical: false, prompt: '', lines: [] }, { state: 'archived' }),
];

const ITEMS: ItemChoice[] = [
  { id: DOXY, name: 'Doxycycline 100 mg', group: 'Rx' },
  { id: GAUZE, name: 'Gauze', group: 'Supplies' },
  { id: GONE, name: 'Demo: Old kit', group: 'Supplies', removed: true },
];

const draw = (rows: Bundle[] = BUNDLES, over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(createElement(BundlesView, { bundles: rows, items: ITEMS, ...over }));

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the list', () => {
  it('lists the active bundles A to Z, each opening its own page by its ID, with a line of what it is', () => {
    const html = draw();
    expect(html).toContain('<h1 class="px-h1">Bundles</h1>');
    expect(html).toContain('<h2 id="bundle-list" class="px-h2">Your team’s bundles</h2>');
    const list = html.slice(html.indexOf('bundle-list'), html.indexOf('add-bundle'));
    expect([...list.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])).toEqual([
      [`/team/presets/bundles/${WOUND}`, 'Basic wound care'],
      [`/team/presets/bundles/${RAINY}`, 'Demo: Rainy night'],
    ]);
    expect(list).toContain('Medical · 2 items, 1 optional');
    expect(list).toContain('Non-Medical · 1 item · Asks before applying');
  });

  it('marks a bundle Sineobex offers an update of', () => {
    const html = draw(BUNDLES.map((b) => (b.id === WOUND ? { ...b, updateOnOffer: true } : b)));
    expect(html).toContain(
      `<a href="/team/presets/bundles/${WOUND}">Basic wound care</a><span class="sx-pill sx-pill--info">Update available</span>`,
    );
    expect(html.split('Update available</span>')).toHaveLength(2);
  });

  it('lists the removed ones under Removed, with Restore, and none of them above', () => {
    const html = draw();
    expect(html).toContain('Removed (1)</h2>');
    expect(html).toContain('Restore<span class="sr-only"> Demo: Old bundle</span></button>');
    expect(html.slice(0, html.indexOf('add-bundle'))).not.toContain('Demo: Old bundle');
  });

  it('says when no bundle is on the list', () => {
    const html = draw(BUNDLES.map((b) => ({ ...b, state: 'archived' as const })));
    expect(html).toContain('<p class="px-panel">No bundle is on your team’s list. Add one below.</p>');
    expect(html).not.toContain('bundle-list');
  });

  it('names the bundle an act was done to, after the page is sent back', () => {
    expect(draw(BUNDLES, { done: 'restored', preset: OLD })).toContain('Restored: Demo: Old bundle</h2>');
  });

  it('says what a bundle is in one line', () => {
    expect(bundleSummary(BUNDLES[0]!.body)).toBe('Non-Medical · 1 item · Asks before applying');
  });
});

describe('Add a bundle', () => {
  const add = () => {
    const html = draw();
    return html.slice(html.indexOf('<section aria-labelledby="add-bundle"'));
  };

  it('asks for a name, with the warning under the box', () => {
    const html = add();
    expect(html).toContain('<h2 id="add-bundle" class="px-h2">Add a bundle</h2>');
    expect(html).toContain('aria-label="Add a bundle"');
    expect(tagOf(html, 'new-bundle-name')).toContain('aria-describedby="new-bundle-name-warning"');
  });

  it('asks Medical or Non-Medical, none chosen, each saying where it is offered', () => {
    const html = add();
    expect(html).toContain('<legend>Medical or Non-Medical</legend>');
    expect(html).toContain(
      '<p id="new-bundle-medical-hint" class="sx-help">A bundle that holds a medication must be Medical.</p>',
    );
    expect(html).toContain('Offered only at a Medical visit.');
    expect(html).toContain('Offered at any visit.');
    expect(tagOf(html, 'new-bundle-medical-true')).not.toContain('checked');
    expect(tagOf(html, 'new-bundle-medical-false')).not.toContain('checked');
  });

  it('asks for its items, each with a quantity and Core, saying what Core means', () => {
    const html = add();
    expect(html).toContain('<legend>Items</legend>');
    expect(html).toContain(
      'A core item is ticked when the bundle is used; an optional one is left for staff to tick.',
    );
    expect(tagOf(html, 'new-bundle-lines')).toContain('aria-describedby="new-bundle-lines-hint"');
    expect(html).toContain('<input type="hidden" name="lines.count" value="0"/>');
    expect(html).toContain('Add an item</button>');
  });

  it('asks what to ask before applying it, with 8.1’s sentence under the box, then the warning', () => {
    const html = add();
    expect(html).toContain('<label for="new-bundle-prompt">Ask before applying (optional)</label>');
    expect(html).toContain(
      '<p id="new-bundle-prompt-hint" class="sx-help">Asked before the bundle is used, so a bundle never stands in for an assessment.</p>',
    );
    expect(tagOf(html, 'new-bundle-prompt')).toContain(
      'aria-describedby="new-bundle-prompt-hint new-bundle-prompt-warning"',
    );
  });

  it('asks for a reason, as every write does', () => {
    const html = add();
    expect(html).toContain('<label for="new-bundle-reason">Reason</label>');
    expect(html).toContain('Add bundle</button>');
  });
});
