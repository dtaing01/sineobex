import { readFileSync } from 'node:fs';
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
    protected: { whole: false, sections: [], fields: [], options: [] },
    hidden: [],
    copySections: wound.sections.map((s) => ({ id: s.id, title: s.title, made: [] })),
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

  it('warns where the field is hidden, or the answer retired, in the note type’s current version, saying what to do', () => {
    const html = draw();
    // An edit of it is refused while its field is hidden (unknown_path): show the field again in its
    // note type, remove it, or map another (the accessibility review, settled point 3).
    expect(sectionOf(html, 'Demo: Pad given')).toContain(
      'This field is hidden in the note type’s current version, so this mapping suggests nothing and can’t be saved. Show the field again in its note type, remove this mapping, or add a mapping for another answer.',
    );
    expect(sectionOf(html, 'Demo: Film given')).toContain(
      'This answer was retired from the note type’s current version, so this mapping suggests nothing. Choose another answer under Edit, or remove it.',
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

describe('a mapping on a grid’s row its picker no longer offers (B-13), and a stored path (B-6)', () => {
  const VACCINE = '30f10000-0000-4000-8000-000000000006';
  const LONG = '30f10000-0000-4000-8000-000000000007';
  const clinic: NoteTypeDefinition = {
    key: 'general_primary_care',
    version: 2,
    title: 'Demo: Clinic visit',
    kinds: ['medical'],
    group: 'clinical',
    sensitivity: 'none',
    sections: [
      {
        id: 'preventive',
        title: 'Demo: Preventive care',
        fields: [
          // Pneumococcal was retired from the vaccines, so the grid no longer has its row.
          {
            id: 'vaccines',
            kind: 'choice',
            label: 'Demo: Vaccines',
            many: true,
            options: [{ code: 'flu', label: 'Demo: Flu' }],
          },
          {
            id: 'vaccine_status',
            kind: 'grid',
            label: 'Demo: Status for each vaccine',
            rows: { pickedIn: 'preventive.vaccines' },
            cell: {
              id: 'status',
              kind: 'choice',
              label: 'Demo: Status',
              options: [
                { code: 'given_today', label: 'Demo: Given today' },
                { code: 'declined', label: 'Demo: Declined' },
              ],
            },
          },
        ],
      },
    ],
  };
  const clinicRow: NoteTypeRow = {
    ...noteTypes[0]!,
    key: 'general_primary_care',
    title: 'Demo: Clinic visit',
    definition: clinic,
  };
  const rows = [
    map(VACCINE, 'Demo: Pneumococcal vaccine given', {
      noteTypeKey: 'general_primary_care',
      path: 'preventive.vaccine_status.pneumococcal',
      when: { equals: 'given_today' },
    }),
    map(LONG, 'Demo: Long hidden field', {
      path: 'wound.a_field_whose_stored_path_is_one_very_long_word_with_no_space',
      when: { answered: true },
    }),
  ];
  const html = renderToStaticMarkup(
    createElement(FieldSuppliesView, {
      rows,
      noteTypes: [...noteTypes, clinicRow],
      items: [item],
      histories: {},
    }),
  );
  const facts = (name: string) => {
    const section = sectionOf(html, name);
    return Object.fromEntries(
      [...section.matchAll(/<dt>([^<]+)<\/dt><dd([^>]*)>([^<]*)<\/dd>/g)].map((m) => [
        m[1],
        { attrs: m[2], text: m[3] },
      ]),
    );
  };

  it('says the row was retired, names the field in the version’s words, and its answer by the cell’s', () => {
    const vaccine = sectionOf(html, 'Demo: Pneumococcal vaccine given');
    expect(vaccine).toContain(
      'The row this mapping is on was retired from the note type’s current version, so this mapping suggests nothing and can’t be saved. Remove it, or add a mapping for another answer.',
    );
    expect(vaccine).not.toContain('This field is hidden');
    const { Field, Answer } = facts('Demo: Pneumococcal vaccine given');
    expect(Field!.text).toBe('Demo: Preventive care: Demo: Status for each vaccine: pneumococcal');
    expect(Answer!.text).toBe('Demo: Given today');
  });

  it('offers the cell’s answers in words in its Edit form', () => {
    const edit = renderToStaticMarkup(
      createElement(EditMapping, {
        row: rows[0]!,
        noteTypes: [clinicRow],
        items: [{ id: GAUZE, name: 'Demo: Gauze pad' }],
        names: {},
      }),
    );
    expect(edit).toContain('>Demo: Given today</option>');
    expect(edit).not.toContain('>given_today</option>');
  });

  it('lets a field or an answer shown as stored break anywhere, so it never pushes the page sideways', () => {
    const { Field, Answer } = facts('Demo: Long hidden field');
    expect(Field!.text).toBe('wound.a_field_whose_stored_path_is_one_very_long_word_with_no_space');
    for (const dd of [Field!, Answer!]) expect(dd.attrs).toMatch(/class="[^"]+"/);
    const css = readFileSync(new URL('./supplies.module.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.breaks\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe('a mapping named in the words of the version that last had its field or answer (item 10, B-6 and B-13’s rest)', () => {
  const PADS = '30f10000-0000-4000-8000-000000000008';
  const FILM = '30f10000-0000-4000-8000-000000000009';
  const NODE = '30f10000-0000-4000-8000-00000000000a';
  const VACCINE = '30f10000-0000-4000-8000-00000000000b';
  // What the list says the current versions lack, as the newest version that had each held it.
  const woundRow: NoteTypeRow = {
    ...noteTypes[0]!,
    hidden: [
      {
        kind: 'field',
        path: 'wound.pads',
        words: 'Demo: Pads applied',
        showAgain: true,
        part: { id: 'pads', kind: 'flag', label: 'Demo: Pads applied' },
      },
      { kind: 'option', path: 'wound.dressing', code: 'film', words: 'Demo: Film', showAgain: false },
      {
        kind: 'section',
        path: 'lymph',
        words: 'Demo: Lymph nodes',
        showAgain: true,
        part: {
          id: 'lymph',
          title: 'Demo: Lymph nodes',
          fields: [
            {
              id: 'nodes',
              kind: 'choice',
              label: 'Demo: Nodes',
              many: true,
              options: [{ code: 'neck', label: 'Demo: Neck' }],
            },
            {
              id: 'findings',
              kind: 'grid',
              label: 'Demo: Findings for each node',
              rows: { pickedIn: 'lymph.nodes' },
              cell: {
                id: 'cell',
                kind: 'group',
                label: 'Demo: Findings',
                fields: [{ id: 'enlarged', kind: 'flag', label: 'Demo: Enlarged' }],
              },
            },
          ],
        },
      },
    ],
  };
  const clinicRow: NoteTypeRow = {
    ...noteTypes[0]!,
    key: 'general_primary_care',
    title: 'Demo: Clinic visit',
    definition: {
      ...wound,
      key: 'general_primary_care',
      title: 'Demo: Clinic visit',
      sections: [
        {
          id: 'preventive',
          title: 'Demo: Preventive care',
          fields: [
            {
              id: 'vaccines',
              kind: 'choice',
              label: 'Demo: Vaccines',
              many: true,
              options: [{ code: 'flu', label: 'Demo: Flu' }],
            },
            {
              id: 'vaccine_status',
              kind: 'grid',
              label: 'Demo: Status for each vaccine',
              rows: { pickedIn: 'preventive.vaccines' },
              cell: {
                id: 'status',
                kind: 'choice',
                label: 'Demo: Status',
                options: [{ code: 'given_today', label: 'Demo: Given today' }],
              },
            },
          ],
        },
      ],
    },
    // Pneumococcal was retired from the vaccines, and with it the grid's row.
    hidden: [
      {
        kind: 'option',
        path: 'preventive.vaccines',
        code: 'pneumococcal',
        words: 'Demo: Pneumococcal',
        showAgain: false,
      },
    ],
  };
  const rows = [
    map(PADS, 'Demo: Pads given', {
      path: 'wound.pads',
      when: { answered: true },
      lines: [{ itemId: GAUZE, qty: { fromPath: 'wound.pads' } }],
    }),
    map(FILM, 'Demo: Film given', { path: 'wound.dressing', when: { includes: 'film' } }),
    map(NODE, 'Demo: Enlarged node', { path: 'lymph.findings.neck.enlarged', when: { answered: true } }),
    map(VACCINE, 'Demo: Pneumococcal given', {
      noteTypeKey: 'general_primary_care',
      path: 'preventive.vaccine_status.pneumococcal',
      when: { equals: 'given_today' },
    }),
  ];
  const html = renderToStaticMarkup(
    createElement(FieldSuppliesView, {
      rows,
      noteTypes: [woundRow, clinicRow],
      items: [item],
      histories: {},
    }),
  );
  const fact = (name: string, term: string) =>
    new RegExp(`<dt>${term}</dt><dd[^>]*>([^<]*)</dd>`).exec(sectionOf(html, name))?.[1];

  it('names a hidden field, a field of a hidden section and a retired grid row in those words', () => {
    expect(fact('Demo: Pads given', 'Field')).toBe('Demo: Wound: Demo: Pads applied');
    expect(sectionOf(html, 'Demo: Pads given')).toContain(
      'Demo: Gauze pad × the number in “Demo: Pads applied”',
    );
    expect(fact('Demo: Enlarged node', 'Field')).toBe(
      'Demo: Lymph nodes: Demo: Findings for each node: Demo: Neck: Demo: Enlarged',
    );
    expect(fact('Demo: Pneumococcal given', 'Field')).toBe(
      'Demo: Preventive care: Demo: Status for each vaccine: Demo: Pneumococcal',
    );
    // Still said to suggest nothing, by what the current version lacks.
    expect(sectionOf(html, 'Demo: Pads given')).toContain('This field is hidden');
    expect(sectionOf(html, 'Demo: Enlarged node')).toContain('This field is hidden');
    expect(sectionOf(html, 'Demo: Pneumococcal given')).toContain('The row this mapping is on was retired');
  });

  it('reviews Sineobex’s update to a mapping in its note type’s words, as the page names a mapping (item 18)', () => {
    const now = {
      name: 'Demo: Film given',
      noteTypeKey: 'wound_care',
      path: 'wound.dressing',
      when: { includes: 'film' },
      lines: [{ itemId: GAUZE, qty: 1 }],
    };
    const update = {
      ...now,
      path: 'wound.pads',
      when: { answered: true },
      lines: [{ itemId: GAUZE, qty: { fromPath: 'wound.pads' } }],
    };
    const offered = {
      ...map(FILM, 'Demo: Film given', now),
      customized: true,
      updateOnOffer: true,
      update: { platformVersion: 2, body: update, changesFixed: [] },
    } as PresetRow<'field_supply_map'>;
    const page = renderToStaticMarkup(
      createElement(FieldSuppliesView, {
        rows: [offered],
        noteTypes: [woundRow],
        items: [item],
        histories: {},
      }),
    );
    const review = page.slice(page.indexOf('<table'), page.indexOf('</table>'));
    expect(review).toContain('What taking the update changes in Demo: Film given');
    for (const words of [
      'Demo: Wound care',
      'Demo: Wound: Demo: Dressing applied',
      'Demo: Wound: Demo: Pads applied',
      'Demo: Film',
      'Ticked',
      'Demo: Gauze pad × 1',
      'Demo: Gauze pad × the number in “Demo: Pads applied”',
    ])
      expect(review, words).toContain(words);
    // Never the key, a stored path or a code.
    for (const stored of ['>wound_care<', 'wound.dressing', 'wound.pads', 'Includes film', 'Answered'])
      expect(review, stored).not.toContain(stored);
  });

  it('names a retired answer in those words, in its facts and in its Edit form, offering the current answers to choose', () => {
    expect(fact('Demo: Film given', 'Answer')).toBe('Demo: Film');
    const edit = renderToStaticMarkup(
      createElement(EditMapping, {
        row: rows[1]!,
        noteTypes: [woundRow],
        items: [{ id: GAUZE, name: 'Demo: Gauze pad' }],
        names: {},
      }),
    );
    expect(edit).toContain('<option value="includes:film" selected="">Demo: Film</option>');
    expect(edit).toContain('>Demo: Gauze</option>');
  });
});
