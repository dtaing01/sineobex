import { describe, expect, it } from 'vitest';
import { movedSentence, ordinal, parseMove } from './flags';

// What the Flags page says after a move (phase 5 design 8.1): where the flag went, in plain words.
// Every name is made up but the platform's.
const FROST = '30f20000-0000-4000-8000-000000000001';
const WET = '30f20000-0000-4000-8000-000000000002';
const PREGNANCY = '30f20000-0000-4000-8000-000000000003';
const LIST = [
  { id: WET, name: 'Demo: Wet feet' },
  { id: FROST, name: 'Frost risk' },
  { id: PREGNANCY, name: 'Pregnancy' },
];

describe('a move’s line', () => {
  it('says where the flag went, counting from 1, among the flags of its list', () => {
    expect(movedSentence({ way: 'up', id: WET }, LIST, 'secondary')).toBe(
      'Demo: Wet feet moved up. It’s now 1st of 3 conditions.',
    );
    expect(movedSentence({ way: 'down', id: PREGNANCY }, LIST, 'secondary')).toBe(
      'Pregnancy moved down. It’s now 3rd of 3 conditions.',
    );
    expect(movedSentence({ way: 'down', id: FROST }, LIST, 'primary')).toBe(
      'Frost risk moved down. It’s now 2nd of 3 risk levels.',
    );
  });

  it('says only that it moved when the list no longer holds the flag', () => {
    expect(movedSentence({ way: 'up', id: '30f20000-0000-4000-8000-0000000000ff' }, LIST, 'secondary')).toBe(
      'The flag moved.',
    );
  });

  it('counts in English', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '10th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
      '112th',
    ]);
  });

  it('reads the way and the flag a move’s button names, and nothing else', () => {
    expect(parseMove(`up:${FROST}`)).toEqual({ way: 'up', id: FROST });
    expect(parseMove(`down:${FROST}`)).toEqual({ way: 'down', id: FROST });
    for (const bad of [`sideways:${FROST}`, 'up:', FROST, undefined, 3]) expect(parseMove(bad)).toBeNull();
  });
});
