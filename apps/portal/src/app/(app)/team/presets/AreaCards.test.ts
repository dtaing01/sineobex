import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HubArea } from '@/lib/presets';
import { AreaCards, AreasLoading } from './AreaCards';

// The hub's cards in the states an end-to-end test can't draw on the seeded team: its platform
// presets are all at the version the platform holds, so nothing is on offer, and the API answers
// every list (phase 5 design 8.1, "Loading; error").
const area = (over: Partial<HubArea> & Pick<HubArea, 'key'>): HubArea =>
  ({
    title: 'Bundles',
    href: '/team/presets/bundles',
    noun: ['bundle', 'bundles'],
    loaded: true,
    count: 18,
    updateAvailable: false,
    ...over,
  }) as HubArea;

describe('the hub’s cards', () => {
  it('link each area’s page, with its count', () => {
    const html = renderToStaticMarkup(
      createElement(AreaCards, {
        areas: [
          area({ key: 'bundles' }),
          area({
            key: 'bag-minimums',
            title: 'Bag minimums',
            href: '/team/presets/bag-minimums',
            noun: ['bag', 'bags'],
            count: 1,
          }),
        ],
      }),
    );
    expect(html).toContain('<h2><a href="/team/presets/bundles">Bundles</a></h2><p>18 bundles</p>');
    expect(html).toContain('<h2><a href="/team/presets/bag-minimums">Bag minimums</a></h2><p>1 bag</p>');
    expect(html).not.toContain('Update available');
  });

  it('say an update is available in words, never by colour alone', () => {
    const html = renderToStaticMarkup(
      createElement(AreaCards, { areas: [area({ key: 'bundles', updateAvailable: true })] }),
    );
    expect(html).toContain('<span class="sx-pill sx-pill--info">Update available</span>');
  });

  it('say on its own card that a list could not be loaded, and still link its page', () => {
    const html = renderToStaticMarkup(
      createElement(AreaCards, {
        areas: [
          area({ key: 'bundles', loaded: false } as Partial<HubArea> & { key: string }),
          area({
            key: 'flags',
            title: 'Flags',
            href: '/team/presets/flags',
            noun: ['flag', 'flags'],
            count: 6,
          }),
        ],
      }),
    );
    expect(html).toContain(
      '<h2><a href="/team/presets/bundles">Bundles</a></h2><p class="px-alert px-alert--error">This list couldn’t be loaded. Reload the page to try again.</p>',
    );
    expect(html).toContain('<p>6 flags</p>');
    expect(html).not.toContain('18 bundles');
  });
});

describe('the hub while its cards are read', () => {
  it('says so, as a status a screen reader announces', () => {
    expect(renderToStaticMarkup(createElement(AreasLoading))).toBe(
      '<p role="status" class="px-panel">Loading presets…</p>',
    );
  });
});
