import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PresetEvent } from '@/lib/presets';
import { BagMinimumsView, type Bag, type Settings } from './BagMinimumsView';

// Bag minimums (phase 5 design 8.1) as the page first draws them from the API's lists. An
// end-to-end test can't draw an update on offer on the seeded team (the platform holds version 1
// of every preset), so the offer's placing is checked here. Every name is made up.
const OUTREACH = '30b20000-0000-4000-8000-000000000001';
const FOOT = '30b20000-0000-4000-8000-000000000002';
const OLD = '30b20000-0000-4000-8000-000000000003';
const SETTINGS = '30b20000-0000-4000-8000-000000000004';
const GAUZE = '30b20000-0000-4000-8000-000000000011';
const SOCKS = '30b20000-0000-4000-8000-000000000012';
const GONE = '30b20000-0000-4000-8000-000000000013';

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

const BAGS: Bag[] = [
  preset(OUTREACH, {
    name: 'Demo: Outreach backpack',
    minimums: [
      { itemId: SOCKS, min: 10 },
      { itemId: GONE, min: 2 },
    ],
  }),
  preset(FOOT, { name: 'Demo: Foot care bag', minimums: [] }, { version: 3 }),
  preset(OLD, { name: 'Demo: Old bag', minimums: [] }, { state: 'archived' }),
];

const settingsOf = (over: Partial<Settings['body']> = {}): Settings =>
  preset(
    SETTINGS,
    {
      name: 'Team settings' as const,
      bagMinimumsOn: false,
      newBagMinimums: [{ itemId: GAUZE, min: 20 }],
      problemCheckDays: 90,
      ...over,
    },
    { version: 4 },
  );

const ITEMS = [
  { id: GAUZE, name: 'Demo: Gauze', group: 'Supplies' },
  { id: SOCKS, name: 'Demo: Socks', group: 'Supplies' },
  { id: GONE, name: 'Demo: Old kit', group: 'Supplies', removed: true },
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

const draw = (over: { bags?: Bag[]; settings?: Settings | null; done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(
    createElement(BagMinimumsView, {
      bags: over.bags ?? BAGS,
      histories: { [OUTREACH]: [installed] },
      settings: over.settings === undefined ? settingsOf() : over.settings,
      settingsHistory: [installed],
      items: ITEMS,
      names: NAMES,
      ...(over.done ? { done: over.done } : {}),
      ...(over.preset ? { preset: over.preset } : {}),
    }),
  );

/** Each bag's section, by its heading, in the order the page draws them. */
const headings = (html: string) =>
  [...html.matchAll(/<h2 id="bag-[^"]+" class="px-h2">([^<]+)<\/h2>/g)].map((m) => m[1]);

/** One bag's section of the page: up to the next bag's, or to Add a bag. */
const sectionOf = (html: string, id: string) => {
  const at = html.indexOf(`<section aria-labelledby="bag-${id}"`);
  const next = html.indexOf('<section aria-labelledby="bag-', at + 1);
  return html.slice(at, next < 0 ? html.indexOf('<section aria-labelledby="add-bag"') : next);
};

/** The team's settings' section. */
const teamSettings = (html: string) =>
  html.slice(
    html.indexOf('<section aria-labelledby="team-settings"'),
    html.indexOf('<section aria-labelledby="bag-'),
  );

/** Add a bag's section, to the end of the page. */
const addBag = (html: string) => html.slice(html.indexOf('<section aria-labelledby="add-bag"'));

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the team’s switch', () => {
  it('says in 8.1’s words that bag minimums are off, and offers to turn them on with a reason', () => {
    const html = teamSettings(draw());
    expect(html).toContain('<h2 id="team-settings" class="px-h2">Your team’s settings</h2>');
    expect(html).toContain('<h3 class="px-h3">Restock reminders</h3>');
    expect(html).toContain('<p>Bag minimums are off. Nobody is reminded to restock.</p>');
    expect(html).toContain('aria-label="Turn bag minimums on"');
    expect(html).toContain('<input type="hidden" name="bagMinimumsOn" value="true"/>');
    expect(html).toContain(`<input type="hidden" name="id" value="${SETTINGS}"/>`);
    expect(html).toContain('<input type="hidden" name="baseVersion" value="4"/>');
    expect(html).toContain('<label for="bag-minimums-switch-reason">Reason</label>');
    expect(html).toContain('Turn on</button>');
  });

  it('says what being on means, and offers to turn them off', () => {
    const html = teamSettings(draw({ settings: settingsOf({ bagMinimumsOn: true }) }));
    expect(html).toContain(
      '<p>Bag minimums are on. When a bag drops below a minimum, after a visit or a count, the team is reminded to restock it, whether or not a route is planned.</p>',
    );
    expect(html).not.toContain('Nobody is reminded to restock.');
    expect(html).toContain('aria-label="Turn bag minimums off"');
    expect(html).toContain('<input type="hidden" name="bagMinimumsOn" value="false"/>');
    expect(html).toContain('Turn off</button>');
  });
});

describe('the template for new bags', () => {
  it('draws the template’s lines in their own form, at the settings’ version, with a reason', () => {
    const html = teamSettings(draw());
    expect(html).toContain('<h3 class="px-h3">Template for new bags</h3>');
    expect(html).toContain('<form id="bag-template"');
    expect(html).toContain('aria-label="Template for new bags"');
    expect(html).toContain('<input type="hidden" name="newBagMinimums.count" value="1"/>');
    expect(html).toContain(`<option value="${GAUZE}" selected="">Demo: Gauze</option>`);
    expect(tagOf(html, 'bag-template-newBagMinimums.0.min')).toContain('value="20"');
    expect(html).toContain('<label for="bag-template-reason">Reason</label>');
  });

  it('places the settings’ update and their history with them', () => {
    const offered = {
      ...settingsOf(),
      updateOnOffer: true,
      update: {
        platformVersion: 2,
        body: { ...settingsOf().body, newBagMinimums: [{ itemId: GAUZE, min: 30 }] },
        changesFixed: [],
      },
    };
    const html = teamSettings(draw({ settings: offered }));
    expect(html).toContain('Update available<span class="sr-only"> for Team settings</span></h3>');
    expect(html).toContain(
      '<th scope="row">Template for new bags <span class="sx-pill sx-pill--info">Changes</span></th><td><ul class="px-list"><li>Demo: Gauze: at least 20</li></ul></td><td><ul class="px-list"><li>Demo: Gauze: at least 30</li></ul></td>',
    );
    expect(html).toContain(`<h3 id="history-${SETTINGS}" class="px-h3">History of the team’s settings</h3>`);
  });

  it('says so when the team’s settings can’t be found, and offers neither form', () => {
    const html = teamSettings(draw({ settings: null }));
    expect(html).toContain('<p>Your team’s settings can’t be found. Reload the page to try again.</p>');
    expect(html).not.toContain('<form');
  });
});

describe('the bags', () => {
  it('lists the active bags A to Z, each with its minimums, a removed item named too', () => {
    const html = draw();
    expect(html).toContain('<h1 class="px-h1">Bag minimums</h1>');
    expect(headings(html)).toEqual(['Demo: Foot care bag', 'Demo: Outreach backpack']);
    expect(sectionOf(html, OUTREACH)).toContain(
      '<dt>Minimums</dt><dd><ul class="px-list"><li>Demo: Socks: at least 10</li><li>Demo: Old kit: at least 2</li></ul></dd>',
    );
    expect(sectionOf(html, FOOT)).toContain('<dt>Minimums</dt><dd>None</dd>');
  });

  it('offers Edit and Remove on each, named for it, and its history in its own panel', () => {
    const outreach = sectionOf(draw(), OUTREACH);
    expect(outreach).toContain('Edit<span class="sr-only"> Demo: Outreach backpack</span></button>');
    expect(outreach).toContain('Remove<span class="sr-only"> Demo: Outreach backpack</span></button>');
    expect(outreach).toMatch(
      new RegExp(`<section aria-labelledby="history-${OUTREACH}" class="[^"]*flat[^"]*">`),
    );
    expect(outreach).toContain(
      `<h3 id="history-${OUTREACH}" class="px-h3">History of Demo: Outreach backpack</h3>`,
    );
  });

  it('places Sineobex’s update in the section of the bag it is for, and nowhere else', () => {
    const offered = BAGS.map((b) =>
      b.id === FOOT
        ? {
            ...b,
            updateOnOffer: true,
            update: {
              platformVersion: 2,
              body: { ...b.body, minimums: [{ itemId: SOCKS, min: 4 }] },
              changesFixed: [],
            },
          }
        : b,
    );
    const html = draw({ bags: offered });
    expect(html.split('Update available<span class="sr-only">')).toHaveLength(2);
    expect(sectionOf(html, FOOT)).toContain(
      '<th scope="row">Minimums <span class="sx-pill sx-pill--info">Changes</span></th><td>None</td><td><ul class="px-list"><li>Demo: Socks: at least 4</li></ul></td>',
    );
  });

  it('says so when the team holds none, and lists the removed ones with Restore', () => {
    const html = draw({ bags: [BAGS[2]!] });
    expect(html).toContain('<p class="px-panel">No bag is on your team’s list. Add one below.</p>');
    expect(html).toContain('Removed (1)');
    expect(html).toContain('Restore<span class="sr-only"> Demo: Old bag</span></button>');
  });

  it('says what was done after an act, naming the bag or the team’s settings', () => {
    expect(draw({ done: 'restored', preset: OLD })).toContain('Restored: Demo: Old bag');
    expect(draw({ done: 'updated', preset: SETTINGS })).toContain('Update taken: Team settings');
  });
});

describe('Add a bag', () => {
  it('asks for a name and fills its minimums from the template to start with', () => {
    const html = addBag(draw());
    expect(html).toContain('<form id="new-bag"');
    expect(html).toContain('aria-label="Add a bag"');
    expect(html).toContain(
      '<p id="new-bag-name-hint" class="sx-help">Such as Wound care bag or Harm reduction bag.</p>',
    );
    expect(html).toContain('<input type="hidden" name="minimums.count" value="1"/>');
    expect(html).toContain(`<option value="${GAUZE}" selected="">Demo: Gauze</option>`);
    expect(tagOf(html, 'new-bag-minimums.0.min')).toContain('value="20"');
    expect(html).toContain('Add bag</button>');
  });

  it('offers Copy from: the template, then each active bag A to Z, said before it is chosen', () => {
    const html = addBag(draw());
    expect(html).toContain('<label for="new-bag-copyFrom">Copy from</label>');
    expect(tagOf(html, 'new-bag-copyFrom')).toContain('aria-describedby="new-bag-copyFrom-hint"');
    expect(html).toContain(
      'Choosing one fills the minimums below with its list, in place of what they hold. Change them before you add the bag, or later.',
    );
    const select = html.slice(html.indexOf('id="new-bag-copyFrom"'), html.indexOf('</select>'));
    expect(
      [...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]),
    ).toEqual([
      ['template', 'The template for new bags'],
      [FOOT, 'Demo: Foot care bag'],
      [OUTREACH, 'Demo: Outreach backpack'],
    ]);
    expect(select).toContain('<option value="template" selected="">');
    // The fill is said out loud once a source is chosen; nothing is said before.
    expect(html).toContain('<p role="status" class="sr-only"></p>');
  });

  it('reads what a minimum means with each list of them', () => {
    const html = draw();
    const hint =
      'The least of each item a bag should hold. While bag minimums are on, the team is reminded to restock a bag that holds fewer.';
    expect(tagOf(html, 'new-bag-minimums')).toContain('aria-describedby="new-bag-minimums-hint"');
    expect(tagOf(html, 'bag-template-newBagMinimums')).toContain(
      'aria-describedby="bag-template-newBagMinimums-hint"',
    );
    expect(html.split(hint)).toHaveLength(3);
  });

  it('starts empty when the team’s settings can’t be found', () => {
    const html = addBag(draw({ settings: null }));
    expect(html).toContain('<input type="hidden" name="minimums.count" value="0"/>');
    expect(html).toContain('<option value="template" selected="">The template for new bags</option>');
  });
});
