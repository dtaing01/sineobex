import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionForm } from '@/components/ActionForm';
import { ItemLines, type ItemLinesProps } from './ItemLines';
import { PresetNotice } from './PresetNotice';
import { ReasonBox } from './ReasonBox';
import { RemovedList, RestorePresetForm } from './RemovedList';
import { RemoveForm, RemovePresetForm } from './RemoveForm';

// The parts every preset page places (phase 5 design 8.1), as a page first draws them: an
// end-to-end test reaches them through the pages that place them. Every name is made up.
const GAUZE = '30a00000-0000-4000-8000-000000000001';
const SOCKS = '30a00000-0000-4000-8000-000000000002';
const OLD = '30a00000-0000-4000-8000-000000000003';

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

const inForm = (...children: ReactNode[]) =>
  renderToStaticMarkup(
    createElement(ActionForm, {
      id: 'f',
      action: async () => ({}),
      label: 'A form',
      children: createElement(Fragment, null, ...children),
    }),
  );

describe('the Reason box', () => {
  it('is required, never filled in by the browser, and says what not to write, under it', () => {
    const html = inForm(createElement(ReasonBox));
    expect(html).toContain('<label for="f-reason">Reason</label>');
    const input = tagOf(html, 'f-reason');
    for (const attribute of [
      'name="reason"',
      'type="text"',
      'required=""',
      'aria-required="true"',
      'aria-describedby="f-reason-hint"',
      'autoComplete="off"',
      'maxLength="300"',
      'value=""',
    ])
      expect(input).toContain(attribute);
    // Under the box, as under every free-text box.
    expect(html.indexOf('Don’t put patient names here.')).toBeGreaterThan(
      html.indexOf('<input id="f-reason"'),
    );
    expect(html).toContain('<p id="f-reason-hint" class="sx-help">Don’t put patient names here.</p>');
  });
});

describe('item lines', () => {
  const items = [
    { id: GAUZE, name: 'Demo: Gauze', group: 'Supplies' },
    { id: SOCKS, name: 'Demo: Socks', group: 'Supplies' },
    { id: OLD, name: 'Demo: Old kit', group: 'Supplies', removed: true },
  ];
  const bundle: ItemLinesProps = {
    name: 'lines',
    legend: 'Items',
    items,
    lines: [
      { itemId: GAUZE, quantity: 2, core: true },
      { itemId: OLD, quantity: 1, core: false },
    ],
    quantity: { field: 'qty', label: 'Quantity' },
    core: true,
    max: 40,
  };

  it('draws each line with its item, its quantity and Core, posted at the body’s own paths', () => {
    const html = inForm(createElement(ItemLines, bundle));
    expect(html).toContain('<legend>Items</legend>');
    expect(html).toContain('<input type="hidden" name="lines.count" value="2"/>');
    expect(html).toContain('<legend>Line 1</legend>');
    expect(html).toContain('<select id="f-lines.0.itemId" name="lines.0.itemId" class="px-select">');
    expect(html).toContain(`<option value="${GAUZE}" selected="">Demo: Gauze</option>`);
    const qty = tagOf(html, 'f-lines.0.qty');
    for (const attribute of ['name="lines.0.qty"', 'inputMode="numeric"', 'autoComplete="off"', 'value="2"'])
      expect(qty).toContain(attribute);
    expect(html).toContain('<input id="f-lines.0.core" type="checkbox" name="lines.0.core" checked=""/>');
    expect(html).toContain('<input id="f-lines.1.core" type="checkbox" name="lines.1.core"/>');
    expect(html).toContain('Take out line 2</button>');
    expect(html).toContain('Add an item</button>');
    expect(html).toContain('<optgroup label="Supplies">');
  });

  it('offers a removed item only on the line that holds it, and says it is removed', () => {
    const html = inForm(createElement(ItemLines, bundle));
    const first = html.slice(html.indexOf('name="lines.0.itemId"'), html.indexOf('name="lines.0.qty"'));
    const second = html.slice(html.indexOf('name="lines.1.itemId"'), html.indexOf('name="lines.1.qty"'));
    expect(first).not.toContain(OLD);
    expect(second).toContain(`<option value="${OLD}" selected="">Demo: Old kit (removed)</option>`);
  });

  it('keeps a line naming an item the page does not list, so saving never drops it', () => {
    const html = inForm(
      createElement(ItemLines, {
        ...bundle,
        lines: [{ itemId: '30a00000-0000-4000-8000-0000000000ff', quantity: 1 }],
      }),
    );
    expect(html).toContain(
      '<option value="30a00000-0000-4000-8000-0000000000ff" selected="">An item no longer on the list</option>',
    );
  });

  it('has no Core where the list has none, and no Add an item at its most', () => {
    const html = inForm(
      createElement(ItemLines, {
        ...bundle,
        name: 'minimums',
        legend: 'Minimums',
        items: items.map(({ group: _, ...i }) => i),
        lines: [{ itemId: SOCKS, quantity: 10 }],
        quantity: { field: 'min', label: 'Minimum' },
        core: false,
        max: 1,
      }),
    );
    expect(html).toContain('name="minimums.0.min"');
    expect(html).toContain('<label for="f-minimums.0.min">Minimum</label>');
    expect(html).not.toContain('core');
    expect(html).not.toContain('Add an item');
    expect(html).not.toContain('<optgroup');
  });

  it('says so when the list holds none yet', () => {
    expect(inForm(createElement(ItemLines, { ...bundle, lines: [] }))).toContain(
      '<p class="sx-help">None yet.</p>',
    );
  });
});

describe('the Removed list', () => {
  const presets = [
    { id: GAUZE, name: 'Demo: Gauze', state: 'active' as const },
    { id: OLD, name: 'Demo: Old kit', state: 'archived' as const },
  ];

  it('lists the removed presets, each with Restore, and none of the others', () => {
    const html = renderToStaticMarkup(createElement(RemovedList, { kind: 'item', presets }));
    expect(html).toContain('<h2 id="removed-item" class="px-h2">Removed (1)</h2>');
    expect(html).toContain('Demo: Old kit</span>');
    expect(html).not.toContain('Demo: Gauze');
    // Restore shows its form when pressed: until then no form, and no reason box, is drawn.
    expect(html).toContain(
      '<button type="button" class="sx-btn sx-btn--secondary" aria-expanded="false">Restore<span class="sr-only"> Demo: Old kit</span></button>',
    );
    expect(html).not.toContain('<form');
  });

  it('restores with a reason', () => {
    const html = renderToStaticMarkup(
      createElement(RestorePresetForm, { kind: 'item', preset: { id: OLD, name: 'Demo: Old kit' } }),
    );
    expect(html).toContain('aria-label="Restore Demo: Old kit"');
    expect(html).toContain(
      `<input type="hidden" name="kind" value="item"/><input type="hidden" name="id" value="${OLD}"/>`,
    );
    expect(html).toContain('<label for="restore-' + OLD + '-reason">Reason</label>');
    expect(html).toContain('Restore</button>');
  });

  it('draws nothing while nothing is removed', () => {
    expect(renderToStaticMarkup(createElement(RemovedList, { kind: 'item', presets: [presets[0]!] }))).toBe(
      '',
    );
  });
});

describe('Remove', () => {
  const preset = { id: GAUZE, name: 'Demo: Frost watch', version: 3 };

  it('shows its form when pressed, named for the preset', () => {
    const html = renderToStaticMarkup(createElement(RemoveForm, { kind: 'flag', preset }));
    expect(html).toContain(
      '<button type="button" class="sx-btn sx-btn--secondary" aria-expanded="false">Remove<span class="sr-only"> Demo: Frost watch</span></button>',
    );
    // Until it is pressed no form is drawn: a closed disclosure's buttons would hold the theme
    // checks up for good (Disclosure.tsx).
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<details');
  });

  it('sends the version shown and a reason', () => {
    const html = renderToStaticMarkup(
      createElement(RemovePresetForm, {
        kind: 'flag',
        preset,
        note: 'Patients who have this flag keep it until someone clears it.',
        back: '/team/presets/flags',
      }),
    );
    expect(html).toContain('aria-label="Remove Demo: Frost watch"');
    expect(html).toContain('<input type="hidden" name="kind" value="flag"/>');
    expect(html).toContain('<input type="hidden" name="baseVersion" value="3"/>');
    expect(html).toContain('<input type="hidden" name="back" value="/team/presets/flags"/>');
    expect(html).toContain('<p>Patients who have this flag keep it until someone clears it.</p>');
    expect(html).toContain('<label for="remove-' + GAUZE + '-reason">Reason</label>');
    expect(html).toContain('sx-btn--danger');
  });
});

describe('the notice after an act', () => {
  const presets = [{ id: OLD, name: 'Demo: Old kit' }];

  it('says what was done, naming the preset', () => {
    const html = renderToStaticMarkup(createElement(PresetNotice, { done: 'removed', preset: OLD, presets }));
    expect(html).toContain('Removed: Demo: Old kit</h2>');
    expect(html).toContain('<p>It’s in the Removed list, where it can be restored.</p>');
    expect(
      renderToStaticMarkup(createElement(PresetNotice, { done: 'restored', preset: GAUZE, presets })),
    ).toContain('>Restored</h2><p>It’s offered again, on the phones after their next sync.</p>');
  });

  it('draws nothing for an address that names no act', () => {
    for (const done of [undefined, 'deleted', ['removed', 'removed'], 'toString'])
      expect(renderToStaticMarkup(createElement(PresetNotice, { done, preset: OLD, presets }))).toBe('');
  });
});
