import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NoteTypeDefinition, NoteTypeRow, PresetRow } from '@/lib/presets';
import { FieldSuppliesView } from './FieldSuppliesView';

// Field supplies (phase 5 design 8.1) as the page first draws them, written ahead of the view (card
// P4-tests): it fails until card P4-field-supplies builds it. Each mapping is named with its note
// type's title and its field's label, read from GET /v1/admin/note-types, so the page holds no copy
// of a definition. Every name is made up.

const GAUZE = '30f10000-0000-4000-8000-000000000001';
const DRESSED = '30f10000-0000-4000-8000-000000000002';
const HIDDEN = '30f10000-0000-4000-8000-000000000003';
const RETIRED = '30f10000-0000-4000-8000-000000000004';
const EVERY = '30f10000-0000-4000-8000-000000000005';

const wound: NoteTypeDefinition = {
  key: 'wound_care',
  version: 2,
  title: 'Demo: Wound care',
  kinds: ['medical'],
  group: 'wound',
  sensitivity: 'none',
  sections: [
    {
      id: 'wound',
      title: 'Demo: Wound',
      fields: [
        {
          id: 'dressing',
          kind: 'choice',
          label: 'Demo: Dressing applied',
          options: [
            { code: 'gauze', label: 'Demo: Gauze' },
            { code: 'foam', label: 'Demo: Foam' },
          ],
        },
      ],
    },
  ],
};
const noteTypes: NoteTypeRow[] = [
  {
    key: 'wound_care',
    title: 'Demo: Wound care',
    state: 'active',
    version: 2,
    customized: true,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: { field_supply_map: 4 },
    definition: wound,
    protected: { sections: [], fields: [], options: [] },
  },
];

const map = (id: string, name: string, body: Record<string, unknown>): PresetRow<'field_supply_map'> =>
  ({
    id,
    name,
    state: 'active',
    version: 1,
    customized: false,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: {},
    body: { name, noteTypeKey: 'wound_care', lines: [{ itemId: GAUZE, qty: 1 }], ...body },
  }) as PresetRow<'field_supply_map'>;
const item = {
  id: GAUZE,
  name: 'Demo: Gauze pad',
  state: 'active',
  version: 1,
  body: { name: 'Demo: Gauze pad' },
} as unknown as PresetRow<'item'>;

const ROWS = [
  map(DRESSED, 'Demo: Gauze given', { path: 'wound.dressing', when: { includes: 'gauze' } }),
  map(HIDDEN, 'Demo: Pad given', { path: 'wound.pads', when: { answered: true } }),
  map(RETIRED, 'Demo: Film given', { path: 'wound.dressing', when: { includes: 'film' } }),
  map(EVERY, 'Demo: Every wound visit', {}),
];

const draw = (rows = ROWS) =>
  renderToStaticMarkup(createElement(FieldSuppliesView, { rows, noteTypes, items: [item], histories: {} }));
const sectionOf = (html: string, name: string) => {
  const start = html.indexOf(`>${name}</h2>`);
  expect(start, name).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<h2/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

describe('the field supplies page', () => {
  it('names each mapping’s note type, field and answer by their words, and its items', () => {
    const html = draw();
    const gauze = sectionOf(html, 'Demo: Gauze given');
    expect(gauze).toContain('Demo: Wound care');
    expect(gauze).toContain('Demo: Dressing applied');
    expect(gauze).toContain('Demo: Gauze');
    expect(gauze).toContain('Demo: Gauze pad');
  });

  it('says Every note of this type for a mapping with no field', () => {
    expect(sectionOf(draw(), 'Demo: Every wound visit')).toContain('Every note of this type');
  });

  it('warns where the field is hidden, or the answer retired, in the note type’s current version', () => {
    const html = draw();
    expect(sectionOf(html, 'Demo: Pad given')).toContain(
      'This field is hidden in the note type’s current version, so this mapping suggests nothing.',
    );
    expect(sectionOf(html, 'Demo: Film given')).toContain(
      'This answer was retired from the note type’s current version, so this mapping suggests nothing.',
    );
    expect(sectionOf(html, 'Demo: Gauze given')).not.toContain('suggests nothing');
  });

  it('asks, to add one, for the answer that means something was given, with a reason', () => {
    const html = draw();
    expect(html).toContain(
      'Map the answer that means something was given, not the question that asks about it.',
    );
    for (const name of ['name', 'noteTypeKey', 'path', 'when.kind', 'reason'])
      expect(html).toContain(`name="${name}"`);
    expect(html).toContain('Every note of this type');
    expect(html).toContain('Don’t put patient names here.');
  });
});
