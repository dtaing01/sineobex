import { describe, expect, it } from 'vitest';
import type { NoteTypeDefinition } from '@/lib/presets';
import { noteTypeReviewRows } from './words';

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
