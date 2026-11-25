import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Presets from '@/lib/presets';
import type { NoteTypeDefinition, NoteTypeEvent, NoteTypeRow } from '@/lib/presets';
import { NOTE_TYPE_SENTENCES } from '@/lib/refusals';

// A note type's own page (phase 5 design 8.1) as the server first draws it from the list and the
// history, with the API's answers stood in. An end-to-end test can't draw an update on offer on the
// seeded team (the platform holds version 1 of every note type), so what the page places around one
// is checked here. Every name is made up.

let rows: NoteTypeRow[] = [];
let history: NoteTypeEvent[] = [];
vi.mock('@/lib/presets', async (importOriginal) => ({
  ...(await importOriginal<typeof Presets>()),
  listNoteTypes: async () => rows,
  noteTypeHistory: async () => history,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
const { default: NoteTypePage } = await import('./page');

const definition = (key: string, over: Partial<NoteTypeDefinition> = {}): NoteTypeDefinition => ({
  key,
  version: 1,
  title: 'Demo: Night round',
  kinds: ['non_medical'],
  group: 'outreach',
  sensitivity: 'none',
  sections: [
    { id: 'notes', title: 'Demo: Notes', fields: [{ id: 'notes', kind: 'text', label: 'Demo: Notes' }] },
  ],
  ...over,
});

const row = (key: string, over: Partial<NoteTypeRow> = {}): NoteTypeRow => ({
  key,
  title: 'Demo: Night round',
  state: 'active',
  version: 1,
  customized: false,
  updateOnOffer: false,
  updateChangesFixed: false,
  update: null,
  referencedBy: {},
  definition: definition(key),
  protected: { whole: false, sections: [], fields: [], options: [] },
  ...over,
});

const event = (over: Partial<NoteTypeEvent> = {}): NoteTypeEvent => ({
  act: 'installed',
  version: 1,
  source: 'platform',
  by: null,
  at: '2026-11-25T10:00:00.000Z',
  reason: null,
  ...over,
});

const draw = async (key: string) =>
  renderToStaticMarkup(
    await NoteTypePage({ params: Promise.resolve({ key }), searchParams: Promise.resolve({}) }),
  );

beforeEach(() => {
  rows = [];
  history = [event()];
});

describe('a note type’s own page', () => {
  it('draws no editor for a note type that can’t be changed at all, and says so once', async () => {
    const sections = [
      {
        id: 'flags',
        title: 'Demo: Red flags',
        fields: [{ id: 'asked', kind: 'action', label: 'Demo: Asked' }],
      },
      {
        id: 'follow_up',
        title: 'Demo: Follow up',
        fields: [{ id: 'when', kind: 'text', label: 'Demo: When' }],
      },
    ];
    rows = [
      row('red_flags_disposition', {
        title: 'Demo: Red flags',
        definition: definition('red_flags_disposition', { auto: 'medical', kinds: ['medical'], sections }),
        protected: {
          whole: true,
          sections: ['flags', 'follow_up'],
          fields: ['flags.asked', 'follow_up.when'],
          options: [],
        },
      }),
    ];
    const html = await draw('red_flags_disposition');
    expect(html).toContain(NOTE_TYPE_SENTENCES.wholeProtected);
    for (const offered of [
      'Rename<span class="sr-only"> the note type',
      'Add a section',
      'Copy a section',
      'Changes to publish',
      '>Publish<',
      'Change it here',
    ])
      expect(html, offered).not.toContain(offered);
    // What it holds is still shown, section by section.
    expect(html).toContain('Demo: Red flags');
    expect(html).toContain('Demo: Follow up');
  });

  it('draws the editor for a note type with parts that can be changed', async () => {
    rows = [row('outreach')];
    const html = await draw('outreach');
    expect(html).not.toContain(NOTE_TYPE_SENTENCES.wholeProtected);
    expect(html).toContain('Change it here');
    expect(html).toContain('Changes to publish');
  });
});
