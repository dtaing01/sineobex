import { describe, expect, it } from 'vitest';
import { applyNoteTypeEdits, hiddenParts, type ResolvedNoteType } from '../src/index.ts';

// What a note type no longer shows (phase 5 design 5.4's Show again, 8.1's warning rows): the parts
// an earlier version had and the current one lacks, in the words of the newest version that had
// them, with Show again where set_hidden would copy one back. Every name is made up.

const v1: ResolvedNoteType = {
  key: 't_00000000000c',
  version: 1,
  title: 'Demo: Round',
  kinds: ['non_medical'],
  group: 'outreach',
  sensitivity: 'none',
  sections: [
    {
      id: 'given',
      title: 'Demo: Given',
      fields: [
        {
          id: 'kits',
          kind: 'choice',
          label: 'Demo: Kits',
          many: true,
          options: [
            { code: 'socks', label: 'Demo: Socks' },
            { code: 'food', label: 'Demo: Food' },
            { code: 'gloves', label: 'Demo: Gloves' },
          ],
        },
        { id: 'said', kind: 'text', label: 'Demo: What they said', lines: 'one', maxLength: 200 },
      ],
    },
    {
      id: 'needs',
      title: 'Demo: Needs',
      fields: [
        {
          id: 'shelter',
          kind: 'group',
          label: 'Demo: Shelter',
          layout: 'stack',
          fields: [
            { id: 'bed', kind: 'flag', label: 'Demo: Needs a bed' },
            { id: 'where', kind: 'text', label: 'Demo: Where they sleep', lines: 'one', maxLength: 200 },
          ],
        },
        { id: 'more', kind: 'text', label: 'Demo: More', lines: 'one', maxLength: 200 },
      ],
    },
  ],
};

/** The next version, made the way a publish makes it: by the operations, in order. */
function published(versions: readonly ResolvedNoteType[], edits: Parameters<typeof applyNoteTypeEdits>[0]) {
  const outcome = applyNoteTypeEdits(edits, { versions, team: {}, platform: {} });
  if (!outcome.ok) throw new Error(`refused: ${JSON.stringify(outcome)}`);
  return [...versions, outcome.definition];
}

describe('what a note type no longer shows', () => {
  it('is nothing for a note type that hid nothing', () => {
    expect(hiddenParts([v1])).toEqual([]);
    expect(hiddenParts(published([v1], [{ op: 'rename_type', title: 'Demo: Round, renamed' }]))).toEqual([]);
    expect(hiddenParts([])).toEqual([]);
  });

  it('names each part in the words of the newest version that had it, and offers Show again for each it can copy back', () => {
    // Version 2 rewords what version 3 then hides, and retires an answer; a field of a group goes too.
    const v2 = published(
      [v1],
      [
        { op: 'rename_label', path: 'given.said', label: 'Demo: What was said' },
        { op: 'rename_option', path: 'given.kits', code: 'gloves', label: 'Demo: Gloves, nitrile' },
        { op: 'retire_option', path: 'given.kits', code: 'food' },
        { op: 'set_hidden', path: 'needs.shelter.where', hidden: true },
      ],
    );
    const v3 = published(v2, [
      { op: 'set_hidden', path: 'given.said', hidden: true },
      { op: 'retire_option', path: 'given.kits', code: 'gloves' },
    ]);
    const [, said, shelter] = [v1, v2.at(-1)!, v1.sections[1]!.fields[0]!];
    // Newest version first, each in the order it writes them.
    expect(hiddenParts(v3)).toEqual([
      { kind: 'option', path: 'given.kits', code: 'gloves', words: 'Demo: Gloves, nitrile' },
      {
        kind: 'field',
        path: 'given.said',
        words: 'Demo: What was said',
        showAgain: true,
        part: said.sections[0]!.fields[1],
      },
      { kind: 'option', path: 'given.kits', code: 'food', words: 'Demo: Food' },
      {
        kind: 'field',
        path: 'needs.shelter.where',
        words: 'Demo: Where they sleep',
        showAgain: true,
        part: (shelter as { fields: unknown[] }).fields[1],
      },
    ]);
  });

  it('offers no Show again for a part inside a hidden one, which comes back with it, nor for an answer', () => {
    const v2 = published([v1], [{ op: 'set_hidden', path: 'needs.shelter.where', hidden: true }]);
    const v3 = published(v2, [{ op: 'set_hidden', path: 'needs', hidden: true }]);
    expect(hiddenParts(v3).map((p) => [p.kind, p.path, 'showAgain' in p ? p.showAgain : '-'])).toEqual([
      ['section', 'needs', true],
      ['field', 'needs.shelter', false],
      ['field', 'needs.shelter.bed', false],
      ['field', 'needs.more', false],
      ['field', 'needs.shelter.where', false],
    ]);
    // The section as version 2 held it, without the field that version had hidden already.
    expect(hiddenParts(v3)[0]).toMatchObject({ part: v2.at(-1)!.sections[1] });
    // Shown again, the section is back as version 2 had it, and the field it lacked is offered now.
    const v4 = published(v3, [{ op: 'set_hidden', path: 'needs', hidden: false }]);
    expect(hiddenParts(v4).map((p) => [p.kind, p.path, 'showAgain' in p ? p.showAgain : '-'])).toEqual([
      ['field', 'needs.shelter.where', true],
    ]);
  });

  it('offers no Show again in a note type nothing in which can be changed', () => {
    const auto = { ...v1, auto: 'medical' as const };
    const later = { ...auto, version: 2, sections: [auto.sections[0]!] };
    expect(hiddenParts([auto, later])).toEqual([
      expect.objectContaining({ kind: 'section', path: 'needs', showAgain: false }),
      expect.objectContaining({ kind: 'field', path: 'needs.shelter', showAgain: false }),
      expect.objectContaining({ kind: 'field', path: 'needs.shelter.bed', showAgain: false }),
      expect.objectContaining({ kind: 'field', path: 'needs.shelter.where', showAgain: false }),
      expect.objectContaining({ kind: 'field', path: 'needs.more', showAgain: false }),
    ]);
  });
});
