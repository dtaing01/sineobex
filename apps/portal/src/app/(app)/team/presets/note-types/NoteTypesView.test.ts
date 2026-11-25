import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NoteTypeDefinition, NoteTypeRow } from '@/lib/presets';
import { NoteTypesView } from './NoteTypesView';

// Note types (phase 5 design 8.1) as the list page first draws them from GET /v1/admin/note-types,
// written ahead of the view (card P4-tests): it fails until card P4-list-page builds it. An
// end-to-end test can't draw an update on offer on the seeded team (the platform holds version 1 of
// every note type), so the offer's placing is checked here. Every name is made up.

const definition = (
  key: string,
  title: string,
  over: Partial<NoteTypeDefinition> = {},
): NoteTypeDefinition => ({
  key,
  version: 1,
  title,
  kinds: ['medical'],
  group: 'clinical',
  sensitivity: 'none',
  sections: [{ id: 'notes', title: 'Notes', fields: [{ id: 'notes', kind: 'text', label: 'Notes' }] }],
  ...over,
});

const noteType = (key: string, title: string, over: Partial<NoteTypeRow> = {}): NoteTypeRow => ({
  key,
  title,
  state: 'active',
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  definition: definition(key, title),
  protected: { whole: false, sections: [], fields: [], options: [] },
  ...over,
});

const ROWS: NoteTypeRow[] = [
  noteType('outreach', 'Demo: Outreach', {
    definition: definition('outreach', 'Demo: Outreach', {
      kinds: ['medical', 'non_medical'],
      group: 'outreach',
    }),
    referencedBy: { field_supply_map: 2 },
  }),
  noteType('red_flags_disposition', 'Demo: Red flags', {
    definition: definition('red_flags_disposition', 'Demo: Red flags', { auto: 'medical' }),
    protected: { whole: true, sections: ['notes'], fields: ['notes.notes'], options: [] },
  }),
  noteType('psychological', 'Demo: Behavioral health', {
    version: 3,
    customized: true,
    updateOnOffer: true,
    update: {
      platformVersion: 2,
      definition: definition('psychological', 'Demo: Behavioral health, newer'),
      changesFixed: [],
    },
  }),
  noteType('harm_reduction', 'Demo: Harm reduction', {
    customized: true,
    updateOnOffer: true,
    updateChangesFixed: true,
    update: {
      platformVersion: 2,
      definition: definition('harm_reduction', 'Demo: Harm reduction'),
      changesFixed: ['sensitivity'],
    },
  }),
  noteType('t_00000000000b', 'Demo: Old night list', {
    state: 'archived',
    definition: definition('t_00000000000b', 'Demo: Old night list', {
      kinds: ['non_medical'],
      group: 'outreach',
    }),
  }),
];

const draw = (
  rows: NoteTypeRow[] = ROWS,
  over: { done?: string; refused?: string; noteType?: string } = {},
) => renderToStaticMarkup(createElement(NoteTypesView, { rows, ...over }));
/** Each active note type's section, by its heading, in the order the page draws them. */
const headings = (html: string) =>
  [...html.matchAll(/<h2 id="note-type-[^"]+"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
/** One note type's section: from its heading to the next one's, or to Add a note type. */
const sectionOf = (html: string, key: string) => {
  const start = html.indexOf(`id="note-type-${key}"`);
  expect(start, key).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const next = rest.search(/id="note-type-|<h2[^>]*>Add a note type</);
  return next < 0 ? rest : rest.slice(0, next);
};

describe('the note types page', () => {
  it('draws a section for each active note type, in the list’s order, and the removed ones in the Removed list', () => {
    const html = draw();
    expect(headings(html)).toEqual([
      'Demo: Outreach',
      'Demo: Red flags',
      'Demo: Behavioral health',
      'Demo: Harm reduction',
    ]);
    expect(html).toMatch(/Removed[\s\S]*Demo: Old night list/);
    expect(html).toContain('Restore');
  });

  it('says which visits offer each one, and links to its editor by its key alone', () => {
    const html = draw();
    expect(sectionOf(html, 'outreach')).toContain('Medical and Non-Medical');
    expect(sectionOf(html, 'psychological')).toContain('Medical');
    expect(sectionOf(html, 'outreach')).toContain('href="/team/presets/note-types/outreach"');
    for (const href of html.matchAll(/href="([^"]+)"/g))
      if (href[1]!.startsWith('/team/presets/note-types/'))
        expect(href[1]).toMatch(/^\/team\/presets\/note-types\/[a-z][a-z0-9_]{1,60}$/);
  });

  it('offers Remove beside each active note type, the Red flags note too: the API answers why it can’t go', () => {
    const html = draw();
    for (const key of ['outreach', 'red_flags_disposition', 'psychological'])
      expect(sectionOf(html, key)).toContain('Remove');
  });

  it('draws Sineobex’s update in its own note type’s section, and an update that changes what is fixed as Add as new', () => {
    const html = draw();
    expect(sectionOf(html, 'psychological')).toContain(
      'Sineobex updated this preset. Your edited copy hasn’t changed.',
    );
    expect(sectionOf(html, 'psychological')).toContain('Replace with the new version');
    expect(sectionOf(html, 'harm_reduction')).toContain(
      'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
    );
    expect(sectionOf(html, 'harm_reduction')).toContain('Add as new');
    expect(sectionOf(html, 'outreach')).not.toContain('Sineobex updated');
    // Under the note type's h2, its offer's heading is an h3.
    expect(sectionOf(html, 'psychological')).toMatch(/<h3 id="offer-psychological"[^>]*>Update available/);
  });

  it('asks, to add one, for a note type to copy or for Medical, Non-Medical or both and a timeline group, with a reason', () => {
    const html = draw();
    const add = html.slice(html.search(/<h2[^>]*>Add a note type</));
    expect(add).toContain(
      'A note type can’t change between Medical and Non-Medical: Add a new note type instead.',
    );
    expect(add).toContain('name="copyOf"');
    expect(add).toMatch(/name="kinds"[^>]*value="medical"/);
    expect(add).toMatch(/name="kinds"[^>]*value="non_medical"/);
    expect(add).toContain('name="group"');
    expect(add).toContain('name="title"');
    expect(add).toContain('name="reason"');
    expect(add).toContain('Don’t put patient names here.');
  });

  it('says what was done, and what another admin’s act refused meanwhile, naming the note type', () => {
    expect(draw(ROWS, { done: 'removed', noteType: 't_00000000000b' })).toContain('Demo: Old night list');
    expect(draw(ROWS, { refused: 'archived', noteType: 'outreach' })).toMatch(/wasn’t saved|was removed/);
  });

  it('says whose version each one is at from its history: Sineobex’s for one removed and restored, never edited', () => {
    const platform = {
      version: 1,
      source: 'platform' as const,
      by: null,
      at: '2026-11-25T10:00:00.000Z',
      reason: null,
    };
    const restored = noteType('social_needs', 'Demo: Social needs', { customized: true });
    const html = renderToStaticMarkup(
      createElement(NoteTypesView, {
        rows: [restored],
        histories: {
          social_needs: [
            { ...platform, act: 'installed' },
            { ...platform, act: 'archived' },
            { ...platform, act: 'restored' },
          ],
        },
      }),
    );
    expect(sectionOf(html, 'social_needs')).toContain('Sineobex’s, used as is, version 1');
    expect(sectionOf(html, 'social_needs')).not.toContain('Your team’s');
  });

  it('says so when the team has no note types to show', () => {
    expect(draw([])).toMatch(/no note types/i);
  });
});
