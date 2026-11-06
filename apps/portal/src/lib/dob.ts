import type { Schemas } from '@sineobex/contract';

/**
 * The date-of-birth rule (phase 3 design 11.3), the same as the phone's lib/patients/dob.dart.
 * Both are pinned by packages/contract/test-vectors/dob.json. Forms send only the structured
 * birth; the API never parses typed dates and checks ranges only.
 */

export type BirthMode = 'date' | 'age';

export type Birth =
  | { precision: 'day'; date: string }
  | { precision: 'year'; year: number }
  | { precision: 'estimated'; year: number };

export type BirthError =
  'unreadable' | 'bad_year' | 'invalid_month' | 'invalid_day' | 'future' | 'before_1900';

export type ParsedBirth =
  | { ok: true; birth: Birth; readBack: string; needsConfirmation: boolean }
  | { ok: false; error: BirthError; message: string };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Ages that make a guess likely ("24" meant 1924, "26" meant 2026), so the person confirms. */
// PLAN-OPEN: the DOB range that asks for confirmation (design 14.1, #21): under 14 or over 100.
const YOUNGEST_UNCHECKED = 14;
const OLDEST_UNCHECKED = 100;

// PLAN-OPEN: day-month order in typed dates (design 14.1, #20): month first, for the US pilot.
const SEPARATED = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d+)$/;

const fail = (error: BirthError, message: string): ParsedBirth => ({ ok: false, error, message });

const unreadable = (mode: BirthMode) =>
  fail(
    'unreadable',
    mode === 'age'
      ? 'Type the age in years, as a number.'
      : 'Type the date as month, day and year, for example 3/7/1946, or just the year.',
  );

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (month: number, year: number) =>
  month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function parts(today: string): { y: number; m: number; d: number } {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** Whole years from `date` to `today`, both YYYY-MM-DD. */
function ageOn(date: string, today: string): number {
  const b = parts(date);
  const t = parts(today);
  return t.y - b.y - (t.m < b.m || (t.m === b.m && t.d < b.d) ? 1 : 0);
}

/**
 * A recorded birth in words, as the form reads it back: "March 7, 1946 · age 80", "Born in 1946 ·
 * about 80 (year only)", "About 46 years old · born around 1980". Month spelled out, never 03/07.
 */
export function birthReadBack(birth: Birth, today: string): string {
  const year = parts(today).y;
  switch (birth.precision) {
    case 'day': {
      const { y, m, d } = parts(birth.date);
      return `${MONTHS[m - 1]} ${d}, ${y} · age ${ageOn(birth.date, today)}`;
    }
    case 'year':
      return `Born in ${birth.year} · about ${year - birth.year} (year only)`;
    case 'estimated':
      return `About ${year - birth.year} years old · born around ${birth.year}`;
  }
}

/** The same, for a birth as the API returns it. */
export function birthViewReadBack(birth: Schemas['BirthView'], today: string): string {
  if (birth.precision === 'day' && birth.date)
    return birthReadBack({ precision: 'day', date: birth.date }, today);
  if (birth.year === undefined) return 'Not recorded';
  return birthReadBack(
    { precision: birth.precision === 'estimated' ? 'estimated' : 'year', year: birth.year },
    today,
  );
}

function accepted(birth: Birth, today: string, guessed: boolean): ParsedBirth {
  const age = birth.precision === 'day' ? ageOn(birth.date, today) : parts(today).y - birth.year;
  return {
    ok: true,
    birth,
    readBack: birthReadBack(birth, today),
    needsConfirmation: guessed || age < YOUNGEST_UNCHECKED || age > OLDEST_UNCHECKED,
  };
}

function fullDate(month: number, day: number, yearText: string, today: string): ParsedBirth {
  if (yearText.length !== 2 && yearText.length !== 4)
    return fail('bad_year', 'Type the year with 2 or 4 digits.');
  if (month < 1 || month > 12) return fail('invalid_month', 'The month comes first, and it is 1 to 12.');
  if (day < 1 || day > daysIn(month, 2000)) {
    return fail(
      'invalid_day',
      `${MONTHS[month - 1]} has ${month === 2 ? '28 or 29' : daysIn(month, 2001)} days.`,
    );
  }
  const t = parts(today);
  let year = Number(yearText);
  if (yearText.length === 2) {
    // A two-digit year always means the past: the latest year ending in those digits whose full
    // date is not after today (Oct 19). "46" is 1946; "10/23/26" on Oct 22, 2026 is 1926.
    year += Math.floor(t.y / 100) * 100;
    if (iso(year, month, day) > today) year -= 100;
  }
  if (day > daysIn(month, year))
    return fail('invalid_day', `${year} isn’t a leap year, so February has 28 days.`);
  if (year < 1900) return fail('before_1900', 'That is before 1900. Check the year.');
  const date = iso(year, month, day);
  if (date > today) return fail('future', 'That date is in the future.');
  // Ask once when the form guessed: an expanded year, or a day that could be the month.
  return accepted({ precision: 'day', date }, today, yearText.length === 2 || (day <= 12 && day !== month));
}

function yearOnly(yearText: string, today: string): ParsedBirth {
  const current = parts(today).y;
  let year = Number(yearText);
  if (yearText.length === 2) {
    // For a year alone, the latest year ending in those digits before the current one.
    year += Math.floor(current / 100) * 100;
    if (year >= current) year -= 100;
  }
  if (year < 1900) return fail('before_1900', 'That is before 1900. Check the year.');
  if (year > current) return fail('future', 'That year is in the future.');
  return accepted({ precision: 'year', year }, today, yearText.length === 2);
}

/**
 * Reads a typed birth date, or an age in age mode, as of `today` (YYYY-MM-DD, the team's date).
 * Date mode takes 3/7/46, 03-07-46, 030746, 3/7/1946, 03071946, 1946 or 46, month first. Age mode
 * stores an estimated year, so "46" heard as an age can't silently become a birth year.
 */
export function parseBirth(input: string, mode: BirthMode, today: string): ParsedBirth {
  const text = input.trim();
  if (mode === 'age') {
    if (!/^\d{1,3}$/.test(text)) return unreadable(mode);
    const year = parts(today).y - Number(text);
    if (year < 1900) return fail('before_1900', 'That age would mean born before 1900. Check the age.');
    return accepted({ precision: 'estimated', year }, today, false);
  }
  const separated = SEPARATED.exec(text);
  if (separated) return fullDate(Number(separated[1]), Number(separated[2]), separated[3]!, today);
  if (!/^\d+$/.test(text)) return unreadable(mode);
  switch (text.length) {
    case 2:
    case 4:
      return yearOnly(text, today);
    case 6:
    case 8:
      return fullDate(Number(text.slice(0, 2)), Number(text.slice(2, 4)), text.slice(4), today);
    case 1:
    case 3:
      return fail('bad_year', 'Type the year with 2 or 4 digits.');
    default:
      return unreadable(mode);
  }
}

/** Today's date where the team works, as YYYY-MM-DD (the zone formatDateTime uses). */
export function teamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Detroit',
  }).format(now);
}
