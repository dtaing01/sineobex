import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { birthReadBack, birthViewReadBack, parseBirth, teamToday, type BirthMode } from './dob';

// The vectors the phone's parser passes too (phase 3 design 11.3).
const vectors = JSON.parse(
  readFileSync(new URL('../../../../packages/contract/test-vectors/dob.json', import.meta.url), 'utf8'),
) as {
  today: string;
  errors: string[];
  cases: {
    input: string;
    mode: BirthMode;
    birth?: unknown;
    readBack?: string;
    needsConfirmation?: boolean;
    error?: string;
    message?: string;
  }[];
};

describe('parseBirth', () => {
  it.each(vectors.cases.map((c) => [`${c.mode} "${c.input}"`, c] as const))('%s', (_, c) => {
    const result = parseBirth(c.input, c.mode, vectors.today);
    if (c.error) {
      expect(result).toMatchObject({
        ok: false,
        error: c.error,
        ...(c.message ? { message: c.message } : {}),
      });
      expect(vectors.errors).toContain(c.error);
    } else {
      expect(result).toEqual({
        ok: true,
        birth: c.birth,
        readBack: c.readBack,
        needsConfirmation: c.needsConfirmation,
      });
    }
  });

  it('gives every refusal words of its own, and never echoes what was typed', () => {
    for (const [input, mode] of [
      ['4/31/1980', 'date'],
      ['2/29/81', 'date'],
      ['5', 'date'],
      ['12345', 'date'],
      ['', 'age'],
    ] as const) {
      const result = parseBirth(input, mode, vectors.today);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message.length).toBeGreaterThan(10);
        if (input) expect(result.message).not.toContain(input);
      }
    }
    expect(parseBirth('4/31/1980', 'date', vectors.today)).toMatchObject({ message: 'April has 30 days.' });
    expect(parseBirth('2/29/81', 'date', vectors.today)).toMatchObject({ error: 'invalid_day' });
  });

  it('takes spaces and dots between the parts, and a year typed alone as this year', () => {
    expect(parseBirth(' 3 / 7 / 46 ', 'date', vectors.today)).toMatchObject({
      birth: { precision: 'day', date: '1946-03-07' },
    });
    expect(parseBirth('3.15.1946', 'date', vectors.today)).toMatchObject({ needsConfirmation: false });
    expect(parseBirth('2026', 'date', vectors.today)).toMatchObject({
      birth: { precision: 'year', year: 2026 },
      needsConfirmation: true,
    });
    expect(parseBirth('2027', 'date', vectors.today)).toMatchObject({ error: 'future' });
  });
});

describe('read-back', () => {
  it('reads a recorded birth back as the form does', () => {
    expect(birthReadBack({ precision: 'day', date: '1946-03-07' }, vectors.today)).toBe(
      'March 7, 1946 · age 80',
    );
    expect(birthViewReadBack({ precision: 'year', year: 1946 }, vectors.today)).toBe(
      'Born in 1946 · about 80 (year only)',
    );
    expect(birthViewReadBack({ precision: 'estimated', year: 1980 }, vectors.today)).toBe(
      'About 46 years old · born around 1980',
    );
  });

  it('dates today where the team works, not in UTC', () => {
    // 02:30 UTC on Oct 23 is still Oct 22 in Detroit.
    expect(teamToday(new Date('2026-10-23T02:30:00Z'))).toBe('2026-10-22');
  });
});
