import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PresetRow } from '@/lib/presets';
import { UpdateOffer } from './UpdateOffer';
import { HistoryTable } from './VersionHistory';

// The update offer and the history (phase 5 design 5.1, 7, 8.1), as a page first draws them. An
// end-to-end test can't draw an offer on the seeded team: the platform data holds version 1 of
// every preset, and the team holds each at that version, so nothing is ever on offer there.
// Every name is made up.
const FLAG = '30f00000-0000-4000-8000-000000000001';

const flag = (over: Partial<PresetRow<'flag'>> = {}): PresetRow<'flag'> => ({
  id: FLAG,
  name: 'Frost risk',
  state: 'active',
  version: 3,
  customized: true,
  updateOnOffer: true,
  updateChangesFixed: false,
  referencedBy: {},
  body: {
    name: 'Frost risk',
    tier: 'secondary',
    criteria: 'Demo: ours',
    color: 'blue',
    rank: 30,
    sensitive: false,
  },
  update: {
    platformVersion: 2,
    body: { name: 'Frost risk', tier: 'secondary', criteria: '', color: 'blue', rank: 10, sensitive: false },
    changesFixed: [],
  },
  ...over,
});

const offer = (preset: PresetRow<'flag'>) =>
  renderToStaticMarkup(createElement(UpdateOffer, { kind: 'flag', preset, names: {} }));

/** The opening tag of the element with this ID or name, to read its attributes in any order. */
const hidden = (html: string, name: string) => {
  const at = html.indexOf(`name="${name}"`);
  return at < 0 ? null : html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('the update offer', () => {
  it('says Sineobex updated the preset, in 8.1’s words, with Review and Replace with the new version', () => {
    const html = offer(flag());
    expect(html).toContain('Update available<span class="sr-only"> for Frost risk</span>');
    expect(html).toContain('<p>Sineobex updated this preset. Your edited copy hasn’t changed.</p>');
    // Each control names its preset after its visible words (WCAG 2.5.3), as Edit and Remove do.
    expect(html).toContain(
      '<summary>Review<span class="sr-only"> Sineobex’s update to Frost risk</span></summary>',
    );
    expect(html).toContain(
      'Replace with the new version<span class="sr-only"> of Frost risk</span></button>',
    );
    expect(html).not.toContain('Add as new');
    expect(html).toContain('aria-label="Take Sineobex’s update to Frost risk"');
    expect(html).toContain('<label for="take-' + FLAG + '-reason">Reason</label>');
  });

  it('says the copy hasn’t changed only of a copy the team edited', () => {
    // A copy nobody edited is offered an update that changes a field fixed at creation (5.2).
    const fixed = {
      ...flag().update!,
      body: { ...flag().update!.body, sensitive: true },
      changesFixed: ['sensitive'],
    };
    const html = offer(flag({ customized: false, update: fixed }));
    expect(html).toContain('<p>Sineobex updated this preset.</p>');
    expect(html).not.toContain('Your edited copy');
    expect(html).toContain(
      '<p>This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.</p>',
    );
    expect(offer(flag({ customized: true }))).toContain(
      '<p>Sineobex updated this preset. Your edited copy hasn’t changed.</p>',
    );
  });

  it('sends back the version shown and the platform version offered, so only what was reviewed is taken', () => {
    const html = offer(flag());
    expect(hidden(html, 'baseVersion')).toContain('value="3"');
    expect(hidden(html, 'platformVersion')).toContain('value="2"');
    expect(hidden(html, 'asNew')).toContain('value="false"');
    expect(hidden(html, 'kind')).toContain('value="flag"');
    expect(hidden(html, 'id')).toContain(`value="${FLAG}"`);
    expect(hidden(html, 'back')).toBeNull();
  });

  it('reviews the update’s body against the copy’s, rank included, each change marked', () => {
    const html = offer(flag());
    expect(html).toContain('<caption>What taking the update changes in Frost risk</caption>');
    expect(html).toContain(
      '<th scope="row">Place in its list (lowest first) <span class="sx-pill sx-pill--info">Changes</span></th><td>30</td><td>10</td>',
    );
    expect(html).toContain(
      '<th scope="row">Criteria <span class="sx-pill sx-pill--info">Changes</span></th><td>Demo: ours</td><td>None</td>',
    );
    expect(html).toContain('<th scope="row">Colour</th><td>Blue</td><td>Blue</td>');
  });

  it('offers an update that changes a field fixed at creation only as a new one, with its sentence', () => {
    const fixed = flag({
      updateChangesFixed: true,
      update: {
        ...flag().update!,
        body: { ...flag().update!.body, sensitive: true },
        changesFixed: ['sensitive'],
      },
    });
    const html = renderToStaticMarkup(
      createElement(UpdateOffer, { kind: 'flag', preset: fixed, names: {}, back: '/team/presets/flags' }),
    );
    expect(html).toContain(
      '<p>This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.</p>',
    );
    expect(html).toContain(
      'Add as new<span class="sr-only"> from Sineobex’s update to Frost risk</span></button>',
    );
    expect(html).not.toContain('Replace with the new version');
    expect(hidden(html, 'asNew')).toContain('value="true"');
    expect(hidden(html, 'back')).toContain('value="/team/presets/flags"');
  });

  it('draws nothing while nothing is on offer, and offers a removed preset nothing', () => {
    expect(offer(flag({ update: null, updateOnOffer: false }))).toBe('');
    expect(offer(flag({ state: 'archived' }))).toBe('');
  });
});

describe('the history', () => {
  const events = [
    {
      act: 'installed' as const,
      version: 1,
      source: 'platform' as const,
      by: null,
      at: '2026-11-02T15:04:00.000Z',
      reason: null,
      body: {},
    },
    {
      act: 'updated' as const,
      version: 2,
      source: 'team' as const,
      by: { userId: '5eed0000-0000-4000-8000-000000000001', displayName: 'Riley Chen (demo)' },
      at: '2026-11-03T15:04:00.000Z',
      reason: 'Demo: our own words',
      body: {},
    },
    {
      act: 'update_taken' as const,
      version: 3,
      source: 'platform' as const,
      by: { userId: '5eed0000-0000-4000-8000-000000000001', displayName: 'Riley Chen (demo)' },
      at: '2026-11-04T15:04:00.000Z',
      reason: 'Demo: back to Sineobex’s',
      body: {},
    },
  ];

  it('lists every act oldest first: who, when, whose version and why', () => {
    const html = renderToStaticMarkup(createElement(HistoryTable, { events, id: FLAG }));
    expect(html).toContain(`<h2 id="history-${FLAG}" class="px-h2">History</h2>`);
    const rows = html.split('<tr>').slice(2);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(
      '<td>Added by Sineobex, version 1</td><td>Sineobex</td><td>Sineobex’s</td><td>—</td>',
    );
    expect(rows[1]).toContain(
      '<td>Edited, version 2</td><td>Riley Chen (demo)</td><td>Your team’s</td><td>Demo: our own words</td>',
    );
    // A platform version a person took is the platform's, and theirs is the act and the reason.
    expect(rows[2]).toContain(
      '<td>Sineobex’s update taken, version 3</td><td>Riley Chen (demo)</td><td>Sineobex’s</td><td>Demo: back to Sineobex’s</td>',
    );
    expect(rows[0]).toContain('<td>Nov 2, 2026, 10:04 AM</td>');
  });

  it('stands in a panel of its own, or in its preset’s, unboxed', () => {
    const boxed = renderToStaticMarkup(createElement(HistoryTable, { events, id: FLAG }));
    expect(boxed).toContain(`<section aria-labelledby="history-${FLAG}" class="px-panel">`);
    const flat = renderToStaticMarkup(createElement(HistoryTable, { events, id: FLAG, flat: true }));
    expect(flat).not.toContain('px-panel');
    expect(flat).toMatch(new RegExp(`<section aria-labelledby="history-${FLAG}" class="[^"]*flat[^"]*">`));
  });

  it('takes a heading of the page’s level and words', () => {
    const html = renderToStaticMarkup(
      createElement(HistoryTable, { events, id: FLAG, heading: 'History of Frost risk', headingLevel: 3 }),
    );
    expect(html).toContain(`<h3 id="history-${FLAG}" class="px-h3">History of Frost risk</h3>`);
  });
});
