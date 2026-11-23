import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemChoice } from '@/components/presets/ItemLines';
import type { BundleBody, PresetEvent } from '@/lib/presets';
import type { Bundle } from '../BundleFields';
import { BundleView } from './BundleView';

// A bundle's own page (phase 5 design 8.1) as it first draws from the API's lists. An end-to-end
// test can't draw an update on offer on the seeded team (the platform holds version 1 of every
// preset), so the offer's placing is checked here. Every name is made up but the platform's own.
const BUNDLE = '30e30000-0000-4000-8000-000000000001';
const GAUZE = '30e30000-0000-4000-8000-000000000101';
const DOXY = '30e30000-0000-4000-8000-000000000102';
const OLD = '30e30000-0000-4000-8000-000000000103';

const body: BundleBody = {
  name: 'Basic wound care',
  medical: true,
  prompt: 'Demo: Ask how the wound happened.',
  lines: [
    { itemId: GAUZE, qty: 2, core: true },
    { itemId: OLD, qty: 1, core: false },
  ],
};

const bundle = (over: Partial<Bundle> = {}): Bundle => ({
  id: BUNDLE,
  name: body.name,
  state: 'active',
  version: 3,
  customized: true,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body,
  ...over,
});

const ITEMS: ItemChoice[] = [
  { id: DOXY, name: 'Doxycycline 100 mg', group: 'Rx' },
  { id: GAUZE, name: 'Gauze', group: 'Supplies' },
  { id: OLD, name: 'Demo: Old dressing', group: 'Supplies', removed: true },
];
const NAMES = { [DOXY]: 'Doxycycline 100 mg', [GAUZE]: 'Gauze', [OLD]: 'Demo: Old dressing' };

const installed: PresetEvent = {
  act: 'installed',
  version: 1,
  source: 'platform',
  by: null,
  at: '2026-11-02T15:04:00.000Z',
  reason: null,
  body: {},
};

const draw = (row: Bundle = bundle(), over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(
    createElement(BundleView, { bundle: row, items: ITEMS, names: NAMES, history: [installed], ...over }),
  );

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('a bundle’s page', () => {
  it('is headed by its name, says what it is, and goes back to the list', () => {
    const html = draw();
    expect(html).toContain('<a href="/team/presets/bundles">← Bundles</a>');
    expect(html).toContain('<h1 class="px-h1">Basic wound care</h1>');
    expect(html).toContain('<p class="px-lede">Medical · 2 items, 1 optional · Asks before applying</p>');
  });

  it('starts its form from the bundle as it is, at the version shown', () => {
    const html = draw();
    expect(html).toContain('aria-label="Edit Basic wound care"');
    expect(html).toContain(`<input type="hidden" name="id" value="${BUNDLE}"/>`);
    expect(html).toContain('<input type="hidden" name="baseVersion" value="3"/>');
    expect(tagOf(html, 'edit-bundle-name')).toContain('value="Basic wound care"');
    expect(tagOf(html, 'edit-bundle-medical-true')).toContain('checked=""');
    expect(tagOf(html, 'edit-bundle-medical-false')).not.toContain('checked');
    expect(html).toContain('>Demo: Ask how the wound happened.</textarea>');
  });

  it('draws each line with its item, quantity and Core, a removed item only on the line that holds it', () => {
    const html = draw();
    expect(html).toContain('<input type="hidden" name="lines.count" value="2"/>');
    expect(html).toContain(`<option value="${GAUZE}" selected="">Gauze</option>`);
    expect(tagOf(html, 'edit-bundle-lines.0.qty')).toContain('value="2"');
    expect(tagOf(html, 'edit-bundle-lines.0.core')).toContain('checked=""');
    expect(tagOf(html, 'edit-bundle-lines.1.core')).not.toContain('checked');
    // Offered on the line that holds it, marked; on no other.
    expect(html.split('Demo: Old dressing (removed)</option>')).toHaveLength(2);
    expect(html).toContain(`<option value="${OLD}" selected="">Demo: Old dressing (removed)</option>`);
  });

  it('says under the prompt what it is for, in 8.1’s words', () => {
    expect(draw()).toContain(
      '<p id="edit-bundle-prompt-hint" class="sx-help">Asked before the bundle is used, so a bundle never stands in for an assessment.</p>',
    );
  });

  it('offers Remove, landing on the list, and shows the history', () => {
    const html = draw();
    expect(html).toContain('<h2 id="remove-bundle" class="px-h2">Remove</h2>');
    expect(html).toContain('Remove<span class="sr-only"> Basic wound care</span></button>');
    expect(html).toContain(`<h2 id="history-${BUNDLE}" class="px-h2">History</h2>`);
    expect(html).toContain('<td>Added by Sineobex, version 1</td>');
  });

  it('places Sineobex’s update, its review naming each line’s item, landing on the list', () => {
    const offered = bundle({
      updateOnOffer: true,
      update: {
        platformVersion: 2,
        body: { ...body, prompt: '', lines: [{ itemId: DOXY, qty: 1, core: false }] },
        changesFixed: [],
      },
    });
    const html = draw(offered);
    expect(html).toContain('Update available<span class="sr-only"> for Basic wound care</span></h2>');
    expect(html).toContain('<li>Gauze × 2, core</li><li>Demo: Old dressing × 1, optional</li>');
    expect(html).toContain('<li>Doxycycline 100 mg × 1, optional</li>');
    expect(html).toContain(
      '<th scope="row">Ask before applying <span class="sx-pill sx-pill--info">Changes</span></th>',
    );
    expect(html).toContain('<input type="hidden" name="back" value="/team/presets/bundles"/>');
    expect(html).toContain(
      'Replace with the new version<span class="sr-only"> of Basic wound care</span></button>',
    );
  });

  it('says a removed bundle is removed, and offers Restore instead of its form', () => {
    const html = draw(bundle({ state: 'archived' }));
    expect(html).toContain('<h2 id="removed-bundle" class="px-h2">Removed</h2>');
    expect(html).toContain('This bundle isn’t offered for new work. Restore it to offer it again.');
    expect(html).toContain('aria-label="Restore Basic wound care"');
    expect(html).not.toContain('aria-label="Edit Basic wound care"');
  });

  it('says it was restored, after the page is sent back', () => {
    expect(draw(bundle(), { done: 'restored', preset: BUNDLE })).toContain('Restored: Basic wound care</h2>');
  });
});
