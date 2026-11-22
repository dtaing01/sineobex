import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PresetEvent } from '@/lib/presets';
import { ConditionSuppliesView, type ConditionSupply, type Settings } from './ConditionSuppliesView';

// Condition supplies (phase 5 design 8.1) as the page first draws them from the API's lists. An
// end-to-end test can't draw an update on offer on the seeded team (the platform holds version 1
// of every preset), so the offer's placing is checked here. Every name is made up.
const RASH = '30d20000-0000-4000-8000-000000000001';
const COUGH = '30d20000-0000-4000-8000-000000000002';
const OLD = '30d20000-0000-4000-8000-000000000003';
const SETTINGS = '30d20000-0000-4000-8000-000000000004';
const CREAM = '30d20000-0000-4000-8000-000000000011';
const LOZENGE = '30d20000-0000-4000-8000-000000000012';
const GONE = '30d20000-0000-4000-8000-000000000013';

const preset = <B>(id: string, body: B & { name: string }, over: Record<string, unknown> = {}) => ({
  id,
  name: body.name,
  state: 'active' as const,
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body,
  ...over,
});

const MAPS: ConditionSupply[] = [
  preset(RASH, {
    name: 'Demo: Rash or dermatitis',
    codes: ['R21', 'L30.9'],
    lines: [{ itemId: CREAM, qtyPerPatient: 1 }],
  }),
  preset(
    COUGH,
    {
      name: 'Demo: Cough',
      codes: ['R05'],
      lines: [
        { itemId: LOZENGE, qtyPerPatient: 6 },
        { itemId: GONE, qtyPerPatient: 1 },
      ],
    },
    { version: 3 },
  ),
  preset(OLD, { name: 'Demo: Old mapping', codes: ['R50.9'], lines: [] }, { state: 'archived' }),
];

const SETTINGS_ROW: Settings = preset(
  SETTINGS,
  {
    name: 'Team settings' as const,
    bagMinimumsOn: false,
    newBagMinimums: [{ itemId: CREAM, min: 2 }],
    problemCheckDays: 90,
  },
  { version: 4 },
);

const ITEMS = [
  { id: CREAM, name: 'Demo: Hydrocortisone cream', group: 'OTC' },
  { id: LOZENGE, name: 'Demo: Lozenges', group: 'OTC' },
  { id: GONE, name: 'Demo: Old syrup', group: 'OTC', removed: true },
];
const NAMES = Object.fromEntries(ITEMS.map((i) => [i.id, i.name]));

const installed: PresetEvent = {
  act: 'installed',
  version: 1,
  source: 'platform',
  by: null,
  at: '2026-11-02T15:04:00.000Z',
  reason: null,
  body: {},
};

const draw = (
  over: {
    maps?: ConditionSupply[];
    settings?: Settings | null;
    done?: string;
    preset?: string;
  } = {},
) =>
  renderToStaticMarkup(
    createElement(ConditionSuppliesView, {
      maps: over.maps ?? MAPS,
      histories: { [RASH]: [installed] },
      settings: over.settings === undefined ? SETTINGS_ROW : over.settings,
      settingsHistory: [installed],
      items: ITEMS,
      names: NAMES,
      ...(over.done ? { done: over.done } : {}),
      ...(over.preset ? { preset: over.preset } : {}),
    }),
  );

/** Each mapping's section, by its heading, in the order the page draws them. */
const headings = (html: string) =>
  [...html.matchAll(/<h2 id="mapping-[^"]+" class="px-h2">([^<]+)<\/h2>/g)].map((m) => m[1]);

/** One mapping's section of the page: up to the next mapping's, or to Add a mapping. */
const sectionOf = (html: string, id: string) => {
  const at = html.indexOf(`<section aria-labelledby="mapping-${id}"`);
  const next = html.indexOf('<section aria-labelledby="mapping-', at + 1);
  return html.slice(at, next < 0 ? html.indexOf('<section aria-labelledby="add-mapping"') : next);
};

/** The status check's section, to the end of the page. */
const statusCheck = (html: string) => html.slice(html.indexOf('<section aria-labelledby="status-check"'));

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the mappings', () => {
  it('lists the active mappings A to Z, as the API sorts names', () => {
    const html = draw();
    expect(html).toContain('<h1 class="px-h1">Condition supplies</h1>');
    expect(headings(html)).toEqual(['Demo: Cough', 'Demo: Rash or dermatitis']);
  });

  it('says each one’s codes and its items per patient, naming a removed item too', () => {
    const html = draw();
    expect(sectionOf(html, RASH)).toContain(
      '<dt>Condition codes</dt><dd>R21, L30.9</dd></div><div><dt>Items</dt><dd><ul class="px-list"><li>Demo: Hydrocortisone cream × 1 per patient</li></ul></dd>',
    );
    expect(sectionOf(html, COUGH)).toContain(
      '<li>Demo: Lozenges × 6 per patient</li><li>Demo: Old syrup × 1 per patient</li>',
    );
  });

  it('offers Edit and Remove on each, named for it, and its history in its own panel', () => {
    const rash = sectionOf(draw(), RASH);
    expect(rash).toContain('Edit<span class="sr-only"> Demo: Rash or dermatitis</span></button>');
    expect(rash).toContain('Remove<span class="sr-only"> Demo: Rash or dermatitis</span></button>');
    expect(rash).toMatch(new RegExp(`<section aria-labelledby="history-${RASH}" class="[^"]*flat[^"]*">`));
    expect(rash).toContain(`<h3 id="history-${RASH}" class="px-h3">History of Demo: Rash or dermatitis</h3>`);
    expect(rash).toContain('<td>Added by Sineobex, version 1</td>');
  });

  it('places Sineobex’s update in the section of the mapping it is for, its review naming the items', () => {
    const offered = MAPS.map((m) =>
      m.id === RASH
        ? {
            ...m,
            updateOnOffer: true,
            update: {
              platformVersion: 2,
              body: { ...m.body, lines: [{ itemId: CREAM, qtyPerPatient: 2 }] },
              changesFixed: [],
            },
          }
        : m,
    );
    const html = draw({ maps: offered });
    expect(html.split('Update available<span class="sr-only">')).toHaveLength(2);
    const rash = sectionOf(html, RASH);
    expect(rash).toContain('Update available<span class="sr-only"> for Demo: Rash or dermatitis</span></h3>');
    expect(rash).toContain(
      '<th scope="row">Items <span class="sx-pill sx-pill--info">Changes</span></th><td><ul class="px-list"><li>Demo: Hydrocortisone cream × 1 per patient</li></ul></td><td><ul class="px-list"><li>Demo: Hydrocortisone cream × 2 per patient</li></ul></td>',
    );
    expect(rash).toContain('Replace with the new version</button>');
  });

  it('says so when the team holds none, and lists the removed ones with Restore', () => {
    const html = draw({ maps: [MAPS[2]!] });
    expect(html).toContain(
      '<p class="px-panel">No condition mapping is on your team’s list. Add one below.</p>',
    );
    expect(html).toContain('Removed (1)');
    expect(html).toContain('Restore<span class="sr-only"> Demo: Old mapping</span></button>');
  });

  it('says what was done after an act, naming the mapping or the team’s settings', () => {
    expect(draw({ done: 'removed', preset: OLD })).toContain('Removed: Demo: Old mapping');
    expect(draw({ done: 'updated', preset: SETTINGS })).toContain('Update taken: Team settings');
  });
});

describe('Add a mapping', () => {
  const add = () => {
    const html = draw();
    return html.slice(html.indexOf('<section aria-labelledby="add-mapping"'));
  };

  it('asks for a name, one code to start with, and lines with a quantity per patient', () => {
    const html = add();
    expect(html).toContain('<form id="new-mapping"');
    expect(html).toContain('aria-label="Add a mapping"');
    expect(html).toContain(
      '<p id="new-mapping-name-hint" class="sx-help">What the condition is called, such as Rash or dermatitis.</p>',
    );
    expect(html).toContain('<input type="hidden" name="codes.count" value="1"/>');
    expect(tagOf(html, 'new-mapping-codes.0')).toContain('value=""');
    expect(html).toContain('Add a code</button>');
    expect(html).toContain('<input type="hidden" name="lines.count" value="0"/>');
    expect(html).toContain('Add mapping</button>');
  });

  it('says what a code is and what a line counts, each read with its group', () => {
    const html = add();
    expect(tagOf(html, 'new-mapping-codes')).toContain('aria-describedby="new-mapping-codes-hint"');
    expect(html).toContain(
      '<p id="new-mapping-codes-hint" class="sx-help">ICD-10-CM codes, such as R21 or L30.9: 1 to 20 of them. A problem counts only when its code is one of these exactly, so L30 doesn’t count L30.9.</p>',
    );
    expect(tagOf(html, 'new-mapping-lines')).toContain('aria-describedby="new-mapping-lines-hint"');
    expect(html).toContain(
      'For each patient on a route with one of these conditions, New or Ongoing, the bag check counts this many of each item.',
    );
  });
});

describe('the status check window', () => {
  it('shows the team’s number of days in 8.1’s words, with “days” read with the box', () => {
    const html = statusCheck(draw());
    expect(html).toContain('<h2 id="status-check" class="px-h2">Status check</h2>');
    expect(html).toContain(
      '<p>A problem that is New or Ongoing and not updated in this many days, from 7 to 365, is marked Status check due, so staff check its status at the patient’s next visit.</p>',
    );
    expect(html).toContain(
      '<label for="status-check-form-problemCheckDays">Check problems not updated in</label>',
    );
    const box = tagOf(html, 'status-check-form-problemCheckDays');
    for (const attribute of [
      'name="problemCheckDays"',
      'inputMode="numeric"',
      'autoComplete="off"',
      'value="90"',
      'aria-describedby="status-check-form-problemCheckDays-unit"',
    ])
      expect(box).toContain(attribute);
    expect(html).toContain('<span id="status-check-form-problemCheckDays-unit" class="unit">days</span>');
  });

  it('saves it with a reason, at the settings’ version, and shows their history', () => {
    const html = statusCheck(draw());
    expect(html).toContain(`<input type="hidden" name="id" value="${SETTINGS}"/>`);
    expect(html).toContain('<input type="hidden" name="baseVersion" value="4"/>');
    expect(html).toContain('<label for="status-check-form-reason">Reason</label>');
    expect(html).toContain(`<h3 id="history-${SETTINGS}" class="px-h3">History of the team’s settings</h3>`);
  });

  it('places the settings’ update here, its review saying every field', () => {
    const offered = {
      ...SETTINGS_ROW,
      updateOnOffer: true,
      update: {
        platformVersion: 2,
        body: { ...SETTINGS_ROW.body, problemCheckDays: 120 },
        changesFixed: [],
      },
    };
    const html = statusCheck(draw({ settings: offered }));
    expect(html).toContain('Update available<span class="sr-only"> for Team settings</span></h3>');
    expect(html).toContain('<th scope="row">Bag minimums</th><td>Off</td><td>Off</td>');
    expect(html).toContain(
      '<th scope="row">Template for new bags</th><td><ul class="px-list"><li>Demo: Hydrocortisone cream: at least 2</li></ul></td>',
    );
    expect(html).toContain(
      '<th scope="row">Check problems not updated in <span class="sx-pill sx-pill--info">Changes</span></th><td>90 days</td><td>120 days</td>',
    );
  });

  it('says so when the team’s settings can’t be found, and offers no form', () => {
    const html = statusCheck(draw({ settings: null }));
    expect(html).toContain('<p>Your team’s settings can’t be found. Reload the page to try again.</p>');
    expect(html).not.toContain('<form');
  });
});
