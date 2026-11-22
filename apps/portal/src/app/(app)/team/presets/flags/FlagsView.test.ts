import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlagBody } from '@/lib/presets';
import type { Flag } from './flags';
import { FlagsView, listedFlags } from './FlagsView';

// The Flags page (phase 5 design 8.1) as it first draws from the API's list. The platform's flags
// are named as the platform names them; every other name is made up.
const HIGH = '30f10000-0000-4000-8000-000000000001';
const MEDIUM = '30f10000-0000-4000-8000-000000000002';
const LOW = '30f10000-0000-4000-8000-000000000003';
const FROST = '30f10000-0000-4000-8000-000000000011';
const WET = '30f10000-0000-4000-8000-000000000012';
const PREGNANCY = '30f10000-0000-4000-8000-000000000013';
const GONE = '30f10000-0000-4000-8000-000000000014';
const ODD = '30f10000-0000-4000-8000-000000000015';

const flag = (
  id: string,
  name: string,
  body: Pick<FlagBody, 'tier' | 'color' | 'rank'> & Partial<FlagBody>,
  over: Partial<Flag> = {},
): Flag => ({
  id,
  name,
  state: 'active',
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body: { name, criteria: '', sensitive: false, ...body },
  ...over,
});

const ROWS: Flag[] = [
  flag(LOW, 'Low', { tier: 'primary', color: 'green', rank: 30 }),
  flag(HIGH, 'High', { tier: 'primary', color: 'red', rank: 10 }, { version: 3 }),
  flag(MEDIUM, 'Medium', { tier: 'primary', color: 'yellow', rank: 20 }, { updateOnOffer: true }),
  flag(PREGNANCY, 'Pregnancy', { tier: 'secondary', color: 'purple', rank: 30, sensitive: true }),
  // Two conditions an update gave one rank: by name.
  flag(WET, 'Demo: Wet feet', { tier: 'secondary', color: 'teal', rank: 10 }, { version: 2 }),
  flag(FROST, 'Frost risk', { tier: 'secondary', color: 'blue', rank: 10 }),
  flag(GONE, 'Demo: Heat risk', { tier: 'secondary', color: 'orange', rank: 5 }, { state: 'archived' }),
];

const draw = (rows: readonly Flag[] = ROWS, over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(createElement(FlagsView, { rows, ...over }));

/** The part of the page between two headings' IDs: a tier's list, the add form. */
const between = (html: string, from: string, to: string) =>
  html.slice(html.indexOf(`id="${from}"`), to ? html.indexOf(`id="${to}"`) : undefined);

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

/** Each pill's words, in the page's order. */
const pills = (html: string) =>
  [...html.matchAll(/aria-hidden="true"><\/span>([^<]+)<\/span><\/a>/g)].map((m) => m[1]);

describe('the Flags page', () => {
  it('is headed Flags, with what flags are for', () => {
    const html = draw();
    expect(html).toContain('<h1 class="px-h1">Flags</h1>');
    expect(html).toContain(
      '<p class="px-lede">What staff mark patients with: one risk level each, and any conditions. Open a flag to change it, remove it or see its history.</p>',
    );
  });

  it('lists the risk levels by rank, highest risk first, then the conditions, a removed one in neither', () => {
    const html = draw();
    expect(html).toContain('<h2 id="tier-primary" class="px-h2">Risk level</h2>');
    expect(html).toContain('Highest risk first. A patient has one risk level at a time.');
    expect(html).toContain('<h2 id="tier-secondary" class="px-h2">Conditions</h2>');
    expect(html).toContain('A patient can have several conditions at once.');
    expect(pills(between(html, 'tier-primary', 'tier-secondary'))).toEqual([
      'Red · High',
      'Yellow · Medium',
      'Green · Low',
    ]);
    expect(pills(between(html, 'tier-secondary', 'add-flag'))).toEqual([
      'Teal · Demo: Wet feet',
      'Blue · Frost risk',
      'Purple · Pregnancy',
    ]);
    expect(between(html, 'tier-primary', 'removed-flag')).not.toContain('Demo: Heat risk');
  });

  it('opens each flag’s page from its pill, and says which is sensitive and which Sineobex updated', () => {
    const html = draw();
    expect(html).toContain(`<a href="/team/presets/flags/${HIGH}">`);
    expect(html).toContain(
      'Purple · Pregnancy</span></a><span class="sx-pill sx-pill--neutral">Sensitive</span>',
    );
    expect(html).toContain(
      'Yellow · Medium</span></a><span class="sx-pill sx-pill--info">Update available</span>',
    );
    expect(html.match(/>Sensitive<\/span>/g)).toHaveLength(1);
    expect(html.match(/>Update available<\/span>/g)).toHaveLength(1);
  });

  it('moves a flag up or down, sending every flag of its list in order with the version shown', () => {
    const order = between(draw(), 'tier-primary', 'tier-secondary');
    expect(order).toContain('aria-label="Order of the risk levels"');
    expect(order).toContain('<input type="hidden" name="tier" value="primary"/>');
    const hidden = [...order.matchAll(/name="flags\.(\d)\.(id|baseVersion)" value="([^"]+)"/g)].map((m) =>
      m.slice(1).join(' '),
    );
    expect(hidden).toEqual([
      `0 id ${HIGH}`,
      '0 baseVersion 3',
      `1 id ${MEDIUM}`,
      '1 baseVersion 1',
      `2 id ${LOW}`,
      '2 baseVersion 1',
    ]);
    // The first can only go down, the last only up; each button names its flag.
    const buttons = [
      ...order.matchAll(
        /value="((?:up|down):[^"]+)"[^>]*>(Move (?:up|down))<span class="sr-only"> ([^<]+)</g,
      ),
    ].map((m) => `${m[2]} ${m[3]} ${m[1]}`);
    expect(buttons).toEqual([
      `Move down High down:${HIGH}`,
      `Move up Medium up:${MEDIUM}`,
      `Move down Medium down:${MEDIUM}`,
      `Move up Low up:${LOW}`,
    ]);
    expect(tagOf(order, `order-primary-move-down-${HIGH}`)).toContain('name="move"');
  });

  it('asks a reason for a move, and moves nothing when Enter is pressed in it', () => {
    const order = between(draw(), 'tier-primary', 'tier-secondary');
    expect(order).toContain('<label for="order-primary-reason">Reason for moving</label>');
    expect(order).toContain(
      'To change the order, give a reason, then move a flag up or down. Each move keeps the reason in the history of the flags it moves.',
    );
    // Enter in a text box presses the form's first submit button: a disabled one, before any move.
    const first = order.indexOf('type="submit"');
    expect(order.slice(order.lastIndexOf('<', first), order.indexOf('>', first) + 1)).toBe(
      '<button type="submit" disabled="" hidden="">',
    );
    expect(first).toBeLessThan(order.indexOf('name="move"'));
  });

  it('keeps a line on the page that says where each move took its flag, empty until a move', () => {
    const order = between(draw(), 'tier-primary', 'tier-secondary');
    expect(order).toContain('<p role="status" class="sr-only"></p>');
  });

  it('draws a list of one flag with nothing to move, and an empty list with what to do', () => {
    const one = draw([flag(HIGH, 'High', { tier: 'primary', color: 'red', rank: 10 })]);
    const primary = between(one, 'tier-primary', 'tier-secondary');
    expect(pills(primary)).toEqual(['Red · High']);
    expect(primary).not.toContain('<form');
    expect(primary).not.toContain('Move');
    expect(between(one, 'tier-secondary', 'add-flag')).toContain(
      '<p>No condition is on your team’s list. Add one below.</p>',
    );
    expect(between(draw([]), 'tier-primary', 'tier-secondary')).toContain(
      '<p>No risk level is on your team’s list. Add one below.</p>',
    );
  });

  it('asks a new flag’s name, list, colour, criteria and whether it is sensitive, with 8.1’s sentence', () => {
    const add = between(draw(), 'add-flag', 'removed-flag');
    expect(add).toContain('aria-label="Add a flag"');
    expect(add).toContain('<label for="new-flag-name">Name</label>');
    // Which list: nothing chosen, fixed from then on.
    expect(add).toContain('<legend>List</legend>');
    expect(add).toContain(
      '<p id="new-flag-tier-hint" class="sx-help">Which list a flag is on can’t be changed later.</p>',
    );
    expect(add).toContain(
      '<span id="new-flag-tier-primary-hint" class="sx-help">A patient has one risk level at a time. A risk level can’t be sensitive.</span>',
    );
    expect(add).toContain(
      '<span id="new-flag-tier-secondary-hint" class="sx-help">A patient can have several conditions at once.</span>',
    );
    // The palette in its order, each by its name, nothing chosen.
    expect(
      [
        ...add.matchAll(/<label for="new-flag-color-[a-z]+"[^>]*><span[^>]*><\/span>([A-Za-z]+)<\/label>/g),
      ].map((m) => m[1]),
    ).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Grey']);
    expect(add).toContain('Staff see the colour with its name, as in Red · High.');
    expect(add).not.toContain('checked');
    expect(add).toContain('<label for="new-flag-criteria">Criteria (optional)</label>');
    expect(add).toContain('Staff read these when they choose a flag. Nothing flags a patient by itself.');
    expect(tagOf(add, 'new-flag-sensitive')).toContain('aria-describedby="new-flag-sensitive-hint"');
    expect(add).toContain(
      '<span id="new-flag-sensitive-hint" class="sx-help">Sensitive flags are hidden from Billing and Data. Whether a flag is sensitive can’t be changed later.</span>',
    );
    expect(add).toContain('It goes at the end of its list. Move it up or down from there.');
    expect(add).toContain('<label for="new-flag-reason">Reason</label>');
    expect(add).toContain('>Add flag</button>');
  });

  it('lists a removed flag under Removed, with Restore', () => {
    const html = draw();
    expect(html).toContain('<h2 id="removed-flag" class="px-h2">Removed (1)</h2>');
    expect(html).toContain('Restore<span class="sr-only"> Demo: Heat risk</span></button>');
  });

  it('says what an act did once it lands here, naming the flag', () => {
    const html = draw(ROWS, { done: 'removed', preset: GONE });
    expect(html).toContain('Removed: Demo: Heat risk');
    expect(html).toContain('It’s in the Removed list, where it can be restored.');
  });

  it('names each flag’s colour by the palette, and a colour it doesn’t know as sent', () => {
    const odd = flag(ODD, 'Demo: Odd', { tier: 'primary', color: 'magenta' as never, rank: 10 });
    expect(listedFlags([odd, ...ROWS], 'primary').map((f) => [f.name, f.colorName, f.version])).toEqual([
      ['Demo: Odd', 'magenta', 1],
      ['High', 'Red', 3],
      ['Medium', 'Yellow', 1],
      ['Low', 'Green', 1],
    ]);
  });
});
