import { describe, expect, it } from 'vitest';
import type { NoteTypeDefinition, NoteTypeRow } from '@/lib/presets';
import { copySources, noteTypeReviewRows } from './words';

// The review of a note type's update on offer (phase 5 design 5.1, 8.1): only what was reviewed is
// taken, so every part the update changes is shown before and after. Every name is made up.

const definition = (title: string, sectionTitle: string): NoteTypeDefinition => ({
  key: 'wound_care',
  version: 1,
  title,
  kinds: ['medical'],
  group: 'wound',
  sensitivity: 'none',
  sections: [
    { id: 'wound', title: sectionTitle, fields: [{ id: 'bed', kind: 'choice', label: 'Demo: Wound bed' }] },
  ],
});

describe('the review of a note type’s update', () => {
  it('shows a section’s title now beside the update’s, and marks the row when they differ (B-12)', () => {
    const [row] = noteTypeReviewRows(
      definition('Demo: Wound care', 'Demo: Wound'),
      definition('Demo: Wound care', 'Demo: Wound details'),
    ).filter((r) => r.field === 'section:wound');
    expect(row).toMatchObject({
      now: ['Its title: Demo: Wound', 'Demo: Wound bed'],
      update: ['Its title: Demo: Wound details', 'Demo: Wound bed'],
      changes: true,
    });
  });

  it('marks no section the update leaves as it is', () => {
    const same = definition('Demo: Wound care', 'Demo: Wound');
    const [row] = noteTypeReviewRows(same, same).filter((r) => r.field === 'section:wound');
    expect(row).toMatchObject({ now: row!.update, changes: false });
  });
});

describe('what a section can be copied from (design 5.4’s copy_section)', () => {
  const row = (key: string, title: string, over: Partial<NoteTypeRow> = {}): NoteTypeRow => ({
    key,
    title,
    state: 'active',
    version: 2,
    customized: true,
    updateOnOffer: false,
    updateChangesFixed: false,
    update: null,
    referencedBy: {},
    definition: definition(title, 'Demo: Wound'),
    protected: { whole: false, sections: [], fields: [], options: [] },
    hidden: [],
    copySections: [{ id: 'wound', title: 'Demo: Wound', made: [] }],
    ...over,
  });

  it('offers every other note type with the sections a copy from it reads, the platform’s where the team’s copy hid one (item 11)', () => {
    const rows = [
      row('general_primary_care', 'Demo: Clinic', {
        // The team hid Eyes; a copy from the platform's note type reads the platform's version still.
        copySections: [
          { id: 'eyes', title: 'Demo: Eyes', made: [] },
          { id: 'ears', title: 'Demo: Ears', made: [] },
        ],
      }),
      // With the ids the team made in each, which a refused copy is named by (item 10).
      row('t_00000000000e', 'Demo: Round', {
        state: 'archived',
        copySections: [{ id: 't_1', title: 'Demo: Kit check', made: ['t_1', 't_2'] }],
      }),
      row('t_00000000000f', 'Demo: This one'),
    ];
    expect(copySources(rows, 't_00000000000f')).toEqual([
      {
        key: 'general_primary_care',
        title: 'Demo: Clinic',
        sections: [
          { id: 'eyes', title: 'Demo: Eyes', made: [] },
          { id: 'ears', title: 'Demo: Ears', made: [] },
        ],
      },
      {
        key: 't_00000000000e',
        title: 'Demo: Round (removed)',
        sections: [{ id: 't_1', title: 'Demo: Kit check', made: ['t_1', 't_2'] }],
      },
    ]);
  });
});
