import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RemoveForm, RemovePresetForm } from '@/components/presets/RemoveForm';
import type { FlagBody, PresetEvent } from '@/lib/presets';
import type { Flag } from '../flags';
import { FlagView, REMOVE_NOTE } from './FlagView';

// A flag's own page (phase 5 design 8.1) as it first draws from the API's list. An end-to-end test
// can't draw an update on offer on the seeded team (the platform holds version 1 of every preset),
// so the offer's placing is checked here. The platform's flags are named as the platform names
// them; every other name is made up.
const HIGH = '30f30000-0000-4000-8000-000000000001';
const PREGNANCY = '30f30000-0000-4000-8000-000000000002';

const HIGH_BODY: FlagBody = {
  name: 'High',
  tier: 'primary',
  criteria: 'Demo: discharged from hospital this week.',
  color: 'red',
  rank: 20,
  sensitive: false,
};

const flag = (over: Partial<Flag> = {}, body: Partial<FlagBody> = {}): Flag => ({
  id: HIGH,
  name: body.name ?? HIGH_BODY.name,
  state: 'active',
  version: 4,
  customized: true,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  body: { ...HIGH_BODY, ...body },
  ...over,
});

const installed: PresetEvent = {
  act: 'installed',
  version: 1,
  source: 'platform',
  by: null,
  at: '2026-11-02T15:04:00.000Z',
  reason: null,
  body: {},
};

const draw = (row: Flag = flag(), over: { done?: string; preset?: string } = {}) =>
  renderToStaticMarkup(createElement(FlagView, { flag: row, history: [installed], ...over }));

/**
 * Every element the view places, depth first, each part as it is given: a form behind a button
 * isn't drawn until the button is pressed, but the part that draws it holds what it will say.
 */
const placed = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(placed);
  if (!isValidElement<{ children?: unknown }>(node)) return [];
  return [node as ReactElement<Record<string, unknown>>, ...placed(node.props.children)];
};

/** The opening tag of the element with this ID, to read its attributes in any order. */
const tagOf = (html: string, id: string) => {
  const at = html.indexOf(`id="${id}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('a flag’s page', () => {
  it('is headed by its name, says what it is and how staff see it, and goes back to the list', () => {
    const html = draw();
    expect(html).toContain('<a href="/team/presets/flags">← Flags</a>');
    expect(html).toContain('<h1 class="px-h1">High</h1>');
    expect(html).toMatch(
      /<p class="px-lede">A risk level, shown to staff as <span class="sx-pill [^"]+"><span [^>]+><\/span>Red · High<\/span>\.<\/p>/,
    );
    const pregnancy = draw(
      flag({ id: PREGNANCY }, { name: 'Pregnancy', tier: 'secondary', color: 'purple', sensitive: true }),
    );
    expect(pregnancy).toContain('A sensitive condition, shown to staff as');
    expect(pregnancy).toContain('Purple · Pregnancy');
    expect(draw(flag({}, { tier: 'secondary', name: 'Demo: Wet feet', color: 'teal' }))).toContain(
      'A condition, shown to staff as',
    );
  });

  it('starts its form from the flag as it is, at the version shown', () => {
    const html = draw();
    expect(html).toContain('aria-label="Edit High"');
    expect(html).toContain(`<input type="hidden" name="id" value="${HIGH}"/>`);
    expect(html).toContain('<input type="hidden" name="baseVersion" value="4"/>');
    expect(tagOf(html, 'edit-flag-name')).toContain('value="High"');
    expect(tagOf(html, 'edit-flag-color-red')).toContain('checked=""');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('>Demo: discharged from hospital this week.</textarea>');
    expect(html).toContain(
      '<p id="edit-flag-criteria-hint" class="sx-help">Staff read these when they choose a flag. Nothing flags a patient by itself.</p>',
    );
  });

  it('shows which list it is on and whether it is sensitive, fixed at creation, and never sends them', () => {
    const html = draw();
    const tier = tagOf(html, 'edit-flag-tier');
    expect(tier).toContain('readOnly=""');
    expect(tier).toContain('value="Risk level"');
    expect(tier).not.toContain('name=');
    expect(html).toContain(
      '<p id="edit-flag-tier-hint" class="sx-help">Which list a flag is on can’t be changed later.</p>',
    );
    const sensitive = tagOf(html, 'edit-flag-sensitive');
    expect(sensitive).toContain('value="No"');
    expect(sensitive).not.toContain('name=');
    expect(sensitive).toContain('aria-describedby="edit-flag-sensitive-hint"');
    expect(html).toContain(
      '<p id="edit-flag-sensitive-hint" class="sx-help">Sensitive flags are hidden from Billing and Data. Whether a flag is sensitive can’t be changed later.</p>',
    );
    expect(tagOf(draw(flag({}, { tier: 'secondary', sensitive: true })), 'edit-flag-sensitive')).toContain(
      'value="Yes"',
    );
    // Its rank is the list's to move: the form has no field for it.
    expect(html).not.toContain('name="rank"');
  });

  it('offers Remove, landing on the list, with 8.1’s line that patients keep the flag', () => {
    const html = draw();
    expect(html).toContain('<h2 id="remove-flag" class="px-h2">Remove</h2>');
    expect(html).toContain(
      'A removed flag isn’t offered when staff flag a patient. It keeps its history, and can be restored from the Flags list.',
    );
    expect(html).toContain('Remove<span class="sr-only"> High</span></button>');
    expect(REMOVE_NOTE).toBe('Patients who have this flag keep it until someone clears it.');
    const remove = placed(FlagView({ flag: flag(), history: [installed] })).find(
      (e) => e.type === RemoveForm,
    );
    expect(remove?.props).toMatchObject({ kind: 'flag', note: REMOVE_NOTE, back: '/team/presets/flags' });
    // The form the button shows, as the page places it.
    const form = renderToStaticMarkup(
      createElement(RemovePresetForm, {
        kind: 'flag',
        preset: flag(),
        note: REMOVE_NOTE,
        back: '/team/presets/flags',
      }),
    );
    expect(form).toContain('<p>Patients who have this flag keep it until someone clears it.</p>');
  });

  it('shows the history', () => {
    const html = draw();
    expect(html).toContain(`<h2 id="history-${HIGH}" class="px-h2">History</h2>`);
    expect(html).toContain('<td>Added by Sineobex, version 1</td>');
  });

  it('places Sineobex’s update, its review showing the rank taking it gives back, landing on the list', () => {
    const offered = flag({
      updateOnOffer: true,
      update: { platformVersion: 2, body: { ...HIGH_BODY, color: 'orange', rank: 10 }, changesFixed: [] },
    });
    const html = draw(offered);
    expect(html).toContain('Update available<span class="sr-only"> for High</span></h2>');
    expect(html).toContain(
      '<th scope="row">Place in its list (lowest first) <span class="sx-pill sx-pill--info">Changes</span></th>',
    );
    expect(html).toContain('<th scope="row">Colour <span class="sx-pill sx-pill--info">Changes</span></th>');
    expect(html).toContain('<td>Red</td><td>Orange</td>');
    expect(html).toContain('<input type="hidden" name="back" value="/team/presets/flags"/>');
    expect(html).toContain('<input type="hidden" name="platformVersion" value="2"/>');
    expect(html).toContain('Replace with the new version</button>');
  });

  it('offers an update that would make it sensitive only as a new flag', () => {
    const offered = flag(
      { id: PREGNANCY, updateOnOffer: true, updateChangesFixed: true },
      { name: 'Pregnancy', tier: 'secondary', color: 'purple' },
    );
    offered.update = {
      platformVersion: 2,
      body: { ...offered.body, sensitive: true },
      changesFixed: ['sensitive'],
    };
    const html = draw(offered);
    expect(html).toContain(
      'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
    );
    expect(html).toContain('Add as new</button>');
    expect(html).toContain(
      '<th scope="row">Sensitive <span class="sx-pill sx-pill--info">Changes</span></th>',
    );
  });

  it('says a removed flag is removed, that patients keep it, and offers Restore instead of its form', () => {
    const html = draw(flag({ state: 'archived' }));
    expect(html).toContain('<h2 id="removed-flag" class="px-h2">Removed</h2>');
    expect(html).toContain(
      'This flag isn’t offered when staff flag a patient, and patients who have it keep it until someone clears it. Restore it to offer it again.',
    );
    expect(html).toContain('aria-label="Restore High"');
    expect(html).not.toContain('aria-label="Edit High"');
    expect(html).not.toContain('Update available');
  });

  it('says it was restored, after the page is sent back', () => {
    expect(draw(flag(), { done: 'restored', preset: HIGH })).toContain('Restored: High</h2>');
  });
});
