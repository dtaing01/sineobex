import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlagPill, FlagSwatch } from './FlagPill';

// A flag as staff see it (phase 5 design 8; PRD main 945): never by colour alone. Every name is
// made up but the platform's.
const pill = (props: Parameters<typeof FlagPill>[0]) => renderToStaticMarkup(createElement(FlagPill, props));

/** A pill's words, as a screen reader reads them: the swatch is hidden. */
const words = (html: string) =>
  html.replace(/<span[^>]*aria-hidden="true"[^>]*><\/span>/g, '').replace(/<[^>]+>/g, '');

describe('a flag’s pill', () => {
  it('reads the colour’s name, then the flag’s, with the colour drawn beside them and hidden from a screen reader', () => {
    const html = pill({ color: 'red', colorName: 'Red', name: 'High' });
    expect(words(html)).toBe('Red · High');
    expect(html).toMatch(
      /^<span class="sx-pill [^"]+"><span class="[^"]+" aria-hidden="true"><\/span>Red · High<\/span>$/,
    );
  });

  it('says a flag removed from the team’s list is no longer on it', () => {
    expect(words(pill({ color: 'purple', colorName: 'Purple', name: 'Pregnancy', archived: true }))).toBe(
      'Purple · Pregnancy · No longer on the team’s list',
    );
  });

  it('draws each palette colour its own way, and one it doesn’t know with the neutral line, its name as given', () => {
    const classes = (html: string) => /class="sx-pill ([^"]+)"/.exec(html)![1]!.split(' ');
    const palette = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'grey'].map((color) =>
      classes(pill({ color, colorName: color, name: 'Demo: Flag' })),
    );
    // The pill's own class, then its colour's: eight colours, eight classes.
    expect(new Set(palette.map((c) => c.at(-1))).size).toBe(8);
    const unknown = pill({ color: 'magenta', colorName: 'Magenta', name: 'Demo: Flag' });
    expect(classes(unknown)).toHaveLength(1);
    expect(words(unknown)).toBe('Magenta · Demo: Flag');
  });

  it('draws a colour on its own beside a name that says it, hidden from a screen reader', () => {
    expect(renderToStaticMarkup(createElement(FlagSwatch, { color: 'teal' }))).toMatch(
      /^<span class="[^" ]+ [^" ]+" aria-hidden="true"><\/span>$/,
    );
  });
});
