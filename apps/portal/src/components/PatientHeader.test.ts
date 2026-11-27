import type { Schemas } from '@sineobex/contract';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PatientHeader } from './PatientHeader';

// The patient page's header (phase 5 design 8.1; card P5-portal-header), written ahead of its code:
// the risk level's pill, then each condition's, each by its colour's name and its own, never by
// colour alone; a flag removed from the team's list says so beside its pill. The API leaves out a
// flag the reader may not see (D114), so the header draws only what the chart holds. Every value is
// made up.
const flag = (
  name: string,
  color: string,
  colorName: string,
  tier: 'primary' | 'secondary',
  archived = false,
) => ({
  flagId: `30f3${name.length.toString().padStart(4, '0')}-0000-4000-8000-000000000001`,
  name,
  tier,
  color,
  colorName,
  rank: 10,
  archived,
});

const chart = (flags: unknown) =>
  ({
    canonicalId: '5eed0000-0000-4000-8000-0000000000f2',
    redirectedFrom: null,
    mergedFrom: [],
    duplicate: null,
    allergies: [],
    patient: { fields: { preferredName: { value: 'Demo Wren', version: 1 } }, attributes: {} },
    ...(flags === undefined ? {} : { flags }),
  }) as unknown as Schemas['PatientChart'];

const draw = (flags: unknown) =>
  renderToStaticMarkup(createElement(PatientHeader, { chart: chart(flags), today: '2026-10-22' }));

/** What a screen reader reads: the swatches are hidden from it. */
const words = (html: string) =>
  html.replace(/<span[^>]*aria-hidden="true"[^>]*><\/span>/g, '').replace(/<[^>]+>/g, '|');

describe('the header’s flags', () => {
  it('shows the risk level, then the conditions, each as its pill', () => {
    const html = draw({
      primary: flag('Demo: High', 'red', 'Red', 'primary'),
      secondary: [
        flag('Demo: Frost risk', 'blue', 'Blue', 'secondary'),
        flag('Demo: Wet feet', 'teal', 'Teal', 'secondary'),
      ],
      history: [],
    });
    const text = words(html);
    const at = (s: string) => text.indexOf(s);
    expect(at('Red · Demo: High')).toBeGreaterThan(-1);
    expect(at('Blue · Demo: Frost risk')).toBeGreaterThan(at('Red · Demo: High'));
    expect(at('Teal · Demo: Wet feet')).toBeGreaterThan(at('Blue · Demo: Frost risk'));
    expect(html.match(/class="sx-pill /g)).toHaveLength(3);
    // A patient with no flags, or a chart without them, has no pill.
    expect(draw({ primary: null, secondary: [], history: [] })).not.toContain('sx-pill');
    expect(draw(undefined)).not.toContain('sx-pill');
  });

  it('says a removed flag the patient still carries is no longer on the team’s list', () => {
    const text = words(
      draw({
        primary: null,
        secondary: [flag('Demo: Heat risk', 'orange', 'Orange', 'secondary', true)],
        history: [],
      }),
    );
    expect(text).toContain('Orange · Demo: Heat risk · No longer on the team’s list');
  });
});
