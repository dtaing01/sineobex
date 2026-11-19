import type { Schemas } from '@sineobex/contract';
import { describe, expect, it } from 'vitest';
import { incompleteText, patientName, queueNoteLines, waitingText } from './worklists';

// The queues, the team's incomplete notes and Home's counts (lifecycle 3.7, 5.4, 5.6, 9.12, 9.14).
const person = (displayName: string) => ({ userId: '5eed3000-0000-4000-8000-000000000001', displayName });

function queued(over: Partial<Schemas['QueueNote']> = {}): Schemas['QueueNote'] {
  return {
    noteId: '5eed2100-0000-4000-8000-000000000001',
    noteTypeKey: 'red_flags_disposition',
    title: 'Red flags and disposition',
    author: person('Casey Nguyen (demo)'),
    completedAt: '2026-10-20T16:25:00Z',
    signedBefore: null,
    attestedBefore: null,
    canAct: true,
    ...over,
  };
}

describe('Home’s counts', () => {
  it('says how many notes are not complete and how many of them are older than a day', () => {
    expect(incompleteText(4, 2)).toBe('4 notes not complete. 2 are older than a day.');
    expect(incompleteText(1, 1)).toBe('1 note not complete. 1 is older than a day.');
    expect(incompleteText(3, 0)).toBe('3 notes not complete.');
    expect(incompleteText(0, 0)).toBe('No notes are incomplete.');
  });

  it('says how many visits wait for each act', () => {
    expect(waitingText(2, 'cosign')).toBe('2 visits wait for a co-signature.');
    expect(waitingText(1, 'cosign')).toBe('1 visit waits for a co-signature.');
    expect(waitingText(1, 'attest')).toBe('1 visit waits for attestation.');
    expect(waitingText(0, 'attest')).toBe('No visits wait for attestation.');
  });
});

describe('a patient, as a list names them', () => {
  it('is named as the API names them, and never made up', () => {
    expect(patientName('Marcus', '5eed0000-0000-4000-8000-000000000015')).toBe('Marcus');
    expect(patientName(null, '5eed0000-0000-4000-8000-000000000015')).toBe('No name recorded');
    expect(patientName(null, null)).toBe('No patient recorded');
  });
});

describe('a note waiting in a queue', () => {
  it('names its title, who wrote it and when it was completed, with the time in the team’s zone', () => {
    expect(queueNoteLines(queued(), 'cosign')).toEqual({
      title: 'Red flags and disposition',
      lines: ['Written by Casey Nguyen (demo), completed Oct 20, 2026, 12:25 PM.'],
    });
    expect(queueNoteLines(queued({ completedAt: null, title: '' }), 'cosign')).toEqual({
      title: 'Note',
      lines: ['Written by Casey Nguyen (demo).'],
    });
  });

  it('says first who signed or attested it before, when a correction sent it back (3.7)', () => {
    const lines = queueNoteLines(
      queued({ signedBefore: person('Jordan Lee (demo)'), attestedBefore: person('Alex Rivera (demo)') }),
      'attest',
    ).lines;
    expect(lines[0]).toBe(
      'Back after a correction. Signed before by Jordan Lee (demo). Attested before by Alex Rivera (demo).',
    );
  });

  it('says someone else has to act on a note the API says this person may not', () => {
    expect(queueNoteLines(queued({ canAct: false }), 'cosign').lines.at(-1)).toBe(
      'Someone else has to co-sign it.',
    );
    expect(queueNoteLines(queued({ canAct: false }), 'attest').lines.at(-1)).toBe(
      'Someone else has to attest it.',
    );
  });
});
