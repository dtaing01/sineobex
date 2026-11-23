import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionForm } from '@/components/ActionForm';
import { CheckField } from './CheckField';
import { ChoiceGroup } from './ChoiceGroup';
import { FixedFact } from './FixedFact';
import { FreeText } from './FreeText';
import { ItemLines, type ItemLinesProps } from './ItemLines';
import { LongText } from './LongText';
import { noticeKey, PresetNotice } from './PresetNotice';
import { ReasonBox } from './ReasonBox';
import { RemovedList, RestorePresetForm } from './RemovedList';
import { RemoveForm, RemovePresetForm } from './RemoveForm';
import { TextList, type TextListProps } from './TextList';

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

describe('a free-text box', () => {
  it('is required, never filled in by the browser, and carries the warning under it', () => {
    const html = inForm(createElement(FreeText, { name: 'name', label: 'Name', defaultValue: 'Demo: Kits' }));
    expect(html).toContain('<label for="f-name">Name</label>');
    const input = tagOf(html, 'f-name');
    for (const attribute of [
      'name="name"',
      'type="text"',
      'required=""',
      'aria-required="true"',
      'aria-describedby="f-name-warning"',
      'autoComplete="off"',
      'value="Demo: Kits"',
    ])
      expect(input).toContain(attribute);
    expect(
      html.indexOf('<p id="f-name-warning" class="sx-help">Don’t put patient names here.</p>'),
    ).toBeGreaterThan(html.indexOf('<input id="f-name"'));
  });

  it('says its hint above the box, read with the warning', () => {
    const html = inForm(
      createElement(FreeText, { name: 'prompt', label: 'Ask', hint: 'Demo: asked first.' }),
    );
    expect(html).toContain('<p id="f-prompt-hint" class="sx-help">Demo: asked first.</p>');
    expect(tagOf(html, 'f-prompt')).toContain('aria-describedby="f-prompt-hint f-prompt-warning"');
  });
});

describe('a choice made once', () => {
  const choice = () =>
    inForm(
      createElement(ChoiceGroup, {
        name: 'behaviour',
        legend: 'What it holds',
        hint: 'What it holds can’t be changed later.',
        options: [
          { value: 'supply', label: 'Supplies', hint: 'Demo: either.' },
          { value: 'lab', label: 'Tests' },
        ],
      }),
    );

  it('reads its sentence with the group, and each option’s with the option', () => {
    const html = choice();
    expect(tagOf(html, 'f-behaviour')).toContain('aria-describedby="f-behaviour-hint"');
    expect(html).toContain('<legend>What it holds</legend>');
    expect(html).toContain(
      '<p id="f-behaviour-hint" class="sx-help">What it holds can’t be changed later.</p>',
    );
    expect(tagOf(html, 'f-behaviour-supply')).toContain('aria-describedby="f-behaviour-supply-hint"');
    expect(tagOf(html, 'f-behaviour-lab')).not.toContain('aria-describedby');
  });

  it('chooses nothing for the person, and the error summary’s link can focus it', () => {
    const html = choice();
    expect(html).not.toContain('checked');
    expect(tagOf(html, 'f-behaviour')).toContain('tabindex="-1"');
    expect(tagOf(html, 'f-behaviour-supply')).toContain('name="behaviour"');
  });

  it('starts an edit form from the preset’s own choice', () => {
    const html = inForm(
      createElement(ChoiceGroup, {
        name: 'medical',
        legend: 'Medical or Non-Medical',
        hint: 'Demo: a bundle’s tag.',
        options: [
          { value: 'true', label: 'Medical' },
          { value: 'false', label: 'Non-Medical' },
        ],
        defaultValue: 'false',
      }),
    );
    expect(tagOf(html, 'f-medical-false')).toContain('checked=""');
    expect(tagOf(html, 'f-medical-true')).not.toContain('checked');
  });

  it('draws an option’s mark before its label, so the label alone names it', () => {
    const html = inForm(
      createElement(ChoiceGroup, {
        name: 'color',
        legend: 'Colour',
        hint: 'Demo: a colour.',
        options: [
          { value: 'red', label: 'Red', mark: createElement('span', { 'aria-hidden': 'true' }) },
          { value: 'blue', label: 'Blue' },
        ],
      }),
    );
    expect(html).toMatch(
      /<label for="f-color-red" class="[^"]+"><span aria-hidden="true"><\/span>Red<\/label>/,
    );
    expect(html).toContain('<label for="f-color-blue">Blue</label>');
  });
});

describe('a tick box', () => {
  it('reads its line on what ticking it means with it, and starts from the preset’s own', () => {
    const html = inForm(
      createElement(CheckField, { name: 'medical', label: 'Medical', hint: 'Demo: offered at a visit.' }),
      createElement(CheckField, {
        name: 'captureLot',
        label: 'Capture lot and expiry',
        defaultChecked: true,
      }),
    );
    const medical = tagOf(html, 'f-medical');
    for (const attribute of ['name="medical"', 'type="checkbox"', 'aria-describedby="f-medical-hint"'])
      expect(medical).toContain(attribute);
    expect(medical).not.toContain('checked');
    expect(html).toContain('<label for="f-medical">Medical</label>');
    expect(html).toContain('<span id="f-medical-hint" class="sx-help">Demo: offered at a visit.</span>');
    const lot = tagOf(html, 'f-captureLot');
    expect(lot).toContain('checked=""');
    expect(lot).not.toContain('aria-describedby');
  });
});

describe('a box for a sentence or two', () => {
  it('may be left empty, says what it is for under it, then the warning, and is never filled in', () => {
    const html = inForm(
      createElement(LongText, {
        name: 'prompt',
        label: 'Ask before applying',
        defaultValue: 'Demo: ask first.',
        hint: 'Demo: what it is for.',
      }),
    );
    expect(html).toContain('<label for="f-prompt">Ask before applying (optional)</label>');
    const box = tagOf(html, 'f-prompt');
    expect(box.startsWith('<textarea')).toBe(true);
    for (const attribute of [
      'name="prompt"',
      'autoComplete="off"',
      'aria-describedby="f-prompt-hint f-prompt-warning"',
    ])
      expect(box).toContain(attribute);
    expect(box).not.toContain('required');
    expect(html).toContain('>Demo: ask first.</textarea>');
    const hint = html.indexOf('<p id="f-prompt-hint" class="sx-help">Demo: what it is for.</p>');
    const warning = html.indexOf(
      '<p id="f-prompt-warning" class="sx-help">Don’t put patient names here.</p>',
    );
    expect(hint).toBeGreaterThan(html.indexOf('<textarea'));
    expect(warning).toBeGreaterThan(hint);
  });
});

describe('a field fixed at creation', () => {
  it('is shown in the form, read-only and never sent, with why under its label', () => {
    const html = inForm(
      createElement(FixedFact, { name: 'unit', label: 'Counted in', value: 'tablet', hint: 'Demo: fixed.' }),
    );
    expect(html).toContain('<label for="f-unit">Counted in</label>');
    const input = tagOf(html, 'f-unit');
    for (const attribute of ['readOnly=""', 'value="tablet"', 'aria-describedby="f-unit-hint"'])
      expect(input).toContain(attribute);
    expect(input).not.toContain('name=');
    expect(html).toContain('<p id="f-unit-hint" class="sx-help">Demo: fixed.</p>');
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

  it('reads its hint with the group, as the error is', () => {
    const html = inForm(createElement(ItemLines, { ...bundle, hint: 'Demo: what Core means.' }));
    expect(tagOf(html, 'f-lines')).toContain('aria-describedby="f-lines-hint"');
    expect(html).toContain(
      '<legend>Items</legend><p id="f-lines-hint" class="sx-help">Demo: what Core means.</p>',
    );
  });

  it('says so when the list holds none yet', () => {
    expect(inForm(createElement(ItemLines, { ...bundle, lines: [] }))).toContain(
      '<p class="sx-help">None yet.</p>',
    );
  });
});

describe('a list of short texts', () => {
  const codes: TextListProps = {
    name: 'codes',
    legend: 'Condition codes',
    hint: 'Demo: what a code looks like.',
    entry: 'Condition code',
    addLabel: 'Add a code',
    stored: ['R21', 'L30.9'],
    max: 20,
  };

  it('draws a box for each, posted at the body’s own paths, each named by its place', () => {
    const html = inForm(createElement(TextList, codes));
    expect(html).toContain('<legend>Condition codes</legend>');
    expect(html).toContain('<input type="hidden" name="codes.count" value="2"/>');
    expect(html).toContain('<label for="f-codes.0">Condition code 1</label>');
    const second = tagOf(html, 'f-codes.1');
    for (const attribute of ['name="codes.1"', 'type="text"', 'autoComplete="off"', 'value="L30.9"'])
      expect(second).toContain(attribute);
    expect(html).toContain('Take out condition code 2</button>');
    expect(html).toContain('Add a code</button>');
  });

  it('reads its hint with the group, and the warning with each box', () => {
    const html = inForm(createElement(TextList, codes));
    expect(tagOf(html, 'f-codes')).toContain('aria-describedby="f-codes-hint"');
    expect(html).toContain('<p id="f-codes-hint" class="sx-help">Demo: what a code looks like.</p>');
    expect(tagOf(html, 'f-codes.0')).toContain('aria-describedby="f-codes-warning"');
    expect(html).toContain('<p id="f-codes-warning" class="sx-help">Don’t put patient names here.</p>');
  });

  it('offers no Add at its most', () => {
    expect(inForm(createElement(TextList, { ...codes, max: 2 }))).not.toContain('Add a code');
  });
});

describe('the Removed list', () => {
  const row = (id: string, name: string, state: 'active' | 'archived') => ({
    id,
    name,
    state,
    version: 2,
    customized: true,
    body: { name, behaviour: 'supply' as const, sort: 10 },
    update: null,
  });
  const presets = [row(GAUZE, 'Demo: Gauze', 'active'), row(OLD, 'Demo: Old kit', 'archived')];

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

  it('offers a removed copy Sineobex’s update beside it, as a new one only', () => {
    const offered = presets.map((p) =>
      p.state === 'archived'
        ? { ...p, update: { platformVersion: 2, body: { ...p.body, sort: 20 }, changesFixed: [] } }
        : p,
    );
    const html = renderToStaticMarkup(
      createElement(RemovedList, { kind: 'order_category', presets: offered }),
    );
    const entry = html.slice(html.indexOf('Demo: Old kit</span>'));
    expect(entry).toContain('Update available<span class="sr-only"> for Demo: Old kit</span></h3>');
    expect(entry).toContain('<p>Sineobex updated this preset.</p>');
    expect(entry).toContain(
      '<p>This one is removed, so add the update as a new one: this one stays removed, and kept in the history.</p>',
    );
    expect(entry).toContain(
      'Add as new<span class="sr-only"> from Sineobex’s update to Demo: Old kit</span></button>',
    );
    expect(entry).toContain('<input type="hidden" name="asNew" value="true"/>');
    expect(entry).not.toContain('Replace with the new version');
    // Without an update, a removed one has Restore alone.
    expect(renderToStaticMarkup(createElement(RemovedList, { kind: 'item', presets }))).not.toContain(
      'Update available',
    );
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

  it('says an act was refused because another admin removed or restored the preset meanwhile', () => {
    const removed = renderToStaticMarkup(
      createElement(PresetNotice, { refused: 'archived', preset: OLD, presets }),
    );
    expect(removed).toContain('class="px-alert px-alert--info"');
    expect(removed).toContain('Removed by another admin: Demo: Old kit</h2>');
    expect(removed).toContain(
      '<p>It was removed while you were working on it, so what you sent wasn’t saved. It isn’t offered for new work, and can be restored.</p>',
    );
    const restored = renderToStaticMarkup(
      createElement(PresetNotice, { refused: 'not_archived', preset: OLD, presets }),
    );
    expect(restored).toContain('Restored by another admin: Demo: Old kit</h2>');
    expect(restored).toContain(
      '<p>It was restored while you were working on it, so what you sent wasn’t saved. It’s offered again, on the phones after their next sync.</p>',
    );
    for (const refused of ['stale', 'toString', ['archived', 'archived']])
      expect(renderToStaticMarkup(createElement(PresetNotice, { refused, preset: OLD, presets }))).toBe('');
    // Each notice starts the page's view afresh; an address with neither keeps it.
    expect(new Set([noticeKey('removed', undefined, OLD), noticeKey(undefined, 'archived', OLD)]).size).toBe(
      2,
    );
    expect(noticeKey(undefined, 'stale', OLD)).toBe('');
  });
});
