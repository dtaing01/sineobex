import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NoteTypeDefinition, NoteTypeRow, PresetRow } from '@/lib/presets';
import { EditMapping, FieldSuppliesView } from './FieldSuppliesView';

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

// Card P4-field-supplies: what the page draws beyond the cases written ahead of it.
describe('the field supplies page, further', () => {
  const removed: NoteTypeRow = {
    ...noteTypes[0]!,
    key: 't_000000000002',
    title: 'Demo: Old round',
    state: 'archived',
    definition: { ...wound, key: 't_000000000002', title: 'Demo: Old round' },
  };
  const counted = { itemId: GAUZE, qty: 2 };
  const fromNote = { itemId: GAUZE, qty: { fromPath: 'wound.dressing' } };

  it('warns where the note type was removed, or isn’t on the team’s list at all', () => {
    const html = renderToStaticMarkup(
      createElement(FieldSuppliesView, {
        rows: [
          map(DRESSED, 'Demo: On a removed one', { noteTypeKey: removed.key }),
          map(HIDDEN, 'Demo: On none', { noteTypeKey: 't_000000000009' }),
        ],
        noteTypes: [...noteTypes, removed],
        items: [item],
        histories: {},
      }),
    );
    expect(sectionOf(html, 'Demo: On a removed one')).toContain(
      'This note type was removed, so this mapping suggests nothing.',
    );
    const none = sectionOf(html, 'Demo: On none');
    expect(none).toContain('This note type isn’t on your team’s list, so this mapping suggests nothing.');
    // A key the list doesn't hold is shown as it is stored.
    expect(none).toContain('t_000000000009');
  });

  it('says each line’s item and count, and a count the note holds by its field’s words', () => {
    const html = draw([map(DRESSED, 'Demo: Counted', { lines: [counted, fromNote] })]);
    const section = sectionOf(html, 'Demo: Counted');
    expect(section).toContain('Demo: Gauze pad × 2');
    expect(section).toContain('Demo: Gauze pad × the number in “Demo: Dressing applied”');
  });

  it('offers a new mapping the team’s active note types only, and Every note of this type first', () => {
    const html = renderToStaticMarkup(
      createElement(FieldSuppliesView, {
        rows: [],
        noteTypes: [...noteTypes, removed],
        items: [item],
        histories: {},
      }),
    );
    const add = html.slice(html.indexOf('id="add-mapping"'));
    expect(add).toContain(
      '<option value="" selected="">Choose a note type</option><option value="wound_care">Demo: Wound care</option></select>',
    );
    expect(add).not.toContain('Demo: Old round');
    expect(add).toMatch(
      /name="path"[^>]*><option value="" selected="">Every note of this type<\/option><\/select>/,
    );
    // No field yet, so no answer: both are sent empty.
    expect(add).toContain('<input type="hidden" name="when.kind" value=""/>');
    expect(html).toContain('No field supply mapping is on your team’s list. Add one below.');
  });

  const edit = (row: PresetRow<'field_supply_map'>, types = noteTypes) =>
    renderToStaticMarkup(
      createElement(EditMapping, {
        row,
        noteTypes: types,
        items: [{ id: GAUZE, name: 'Demo: Gauze pad' }],
        names: { [GAUZE]: 'Demo: Gauze pad' },
      }),
    );

  it('edits a mapping’s answer and lines, its note type and field shown and never sent', () => {
    const html = edit(
      map(DRESSED, 'Demo: Gauze given', { path: 'wound.dressing', when: { includes: 'gauze' } }),
    );
    for (const name of ['noteTypeKey', 'path']) expect(html).not.toContain(`name="${name}"`);
    expect(html).toContain('value="Demo: Wound care"');
    expect(html).toContain('value="Demo: Wound: Demo: Dressing applied"');
    expect(html).toContain('Which note type a mapping is for can’t be changed later.');
    expect(html).toContain('Which field a mapping fires on can’t be changed later.');
    // The answer it holds is chosen; it is sent as the body's test and its value.
    expect(html).toContain('<option value="includes:gauze" selected="">Demo: Gauze</option>');
    expect(html).toContain('<input type="hidden" name="when.kind" value="includes"/>');
    expect(html).toContain('<input type="hidden" name="when.value" value="gauze"/>');
    expect(html).toContain('name="lines.0.qty"');
    expect(html).toContain('name="baseVersion" value="1"');
  });

  it('asks no answer of a mapping on every note of its type', () => {
    const html = edit(map(EVERY, 'Demo: Every wound visit', {}));
    expect(html).toContain('value="Every note of this type"');
    expect(html).not.toContain('name="when.kind"');
  });

  it('shows lines whose counts come from the note, and sends none, so the edit keeps them', () => {
    const html = edit(
      map(DRESSED, 'Demo: Counted', { path: 'wound.dressing', when: { answered: true }, lines: [fromNote] }),
    );
    expect(html).not.toContain('name="lines.');
    expect(html).toContain('Demo: Gauze pad × the number in “Demo: Dressing applied”');
    expect(html).toContain('Some quantities here come from the note, which this form can’t change.');
  });

  it('keeps an answer the field no longer offers, as it is, so a save leaves it alone', () => {
    const html = edit(
      map(RETIRED, 'Demo: Film given', { path: 'wound.dressing', when: { includes: 'film' } }),
    );
    expect(html).toContain('<option value="includes:film" selected="">film</option>');
  });
});
