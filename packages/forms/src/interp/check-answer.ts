/**
 * Whether one answer fits its definition (docs/design/phase-4/forms.md, 7.1): the server calls it
 * on every answer it is sent (lifecycle 4.4), and the phone before it saves. It sees one answer and
 * no other: changes arrive in any order, so an answer in a field that is hidden now, or in a row
 * whose option is not picked, is still taken. Visibility is applied when reading and signing.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { Holds } from '../paths.ts';
import { fieldAt } from './field-at.ts';

export type AnswerProblem =
  | 'unknown_path'
  | 'wrong_type'
  | 'unknown_option'
  | 'out_of_range'
  | 'too_long'
  | 'excluded_pair'
  | 'exclusive_with_others';

/**
 * A problem label is copied from the problem code list. The design sets no limit; this is phase 3's
 * for a code's display text (services/api/src/sync/entities/values.ts, ProblemCode).
 */
export const MAX_PROBLEM_LABEL = 300;

export { MAX_DURATION_DAYS } from '../types.ts';

/** ICD-10-CM by its shape only, as phase 3 checks it, so a code-set update never refuses an answer. */
const PROBLEM_CODE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** An entry's `entryAt`: a UTC time, as the phone writes it (toUtc().toIso8601String()). */
const ENTRY_AT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/;

/**
 * Null when `value` may be stored at `path` of a note on `definition`, or the one problem with it:
 * the first check that fails, in the order of the type's members. Null is the clear of an answer
 * and passes wherever an answer is stored.
 */
export function checkAnswer(
  definition: ResolvedNoteType,
  path: string,
  value: unknown,
): AnswerProblem | null {
  const holds = fieldAt(definition, path)?.holds;
  if (!holds) return 'unknown_path';
  if (value === null) return null;
  switch (holds.type) {
    case 'codes':
      return holds.many ? checkMany(holds, value) : checkOne(holds, value);
    case 'text':
      return checkText(value, holds.maxLength);
    case 'problemLabel':
      return checkText(value, MAX_PROBLEM_LABEL);
    case 'number':
      if (typeof value !== 'number') return 'wrong_type';
      // A value at more decimals than the field's is not one of its values (validate.number_range_empty
      // reads the range the same way). Its shortest decimal form is what the person typed.
      if (value < holds.min || value > holds.max || Number(value.toFixed(holds.decimals)) !== value)
        return 'out_of_range';
      return null;
    case 'duration':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'wrong_type';
      return value < 0 || value > holds.max ? 'out_of_range' : null;
    case 'flag':
    case 'entryRemoved':
      // A tick and a removal store true; each is undone by clearing it.
      return value === true ? null : 'wrong_type';
    case 'date': {
      // The range (past, future) is the picker's: there is no clock here, and an answer made in range
      // must still be taken when it syncs days later.
      const m = typeof value === 'string' ? DATE.exec(value) : null;
      return m && isRealDate(m[1]!, m[2]!, m[3]!) ? null : 'wrong_type';
    }
    case 'time':
      return typeof value === 'string' && TIME.test(value) ? null : 'wrong_type';
    case 'problemCode':
      return typeof value === 'string' && PROBLEM_CODE.test(value) ? null : 'wrong_type';
    case 'entryAt': {
      const m = typeof value === 'string' ? ENTRY_AT.exec(value) : null;
      const d = m ? DATE.exec(m[1]!) : null;
      return d && isRealDate(d[1]!, d[2]!, d[3]!) ? null : 'wrong_type';
    }
  }
}

type Codes = Extract<Holds, { type: 'codes' }>;

function checkOne(holds: Codes, value: unknown): AnswerProblem | null {
  if (typeof value !== 'string') return 'wrong_type';
  return holds.options.some((o) => o.code === value) ? null : 'unknown_option';
}

function checkMany(holds: Codes, value: unknown): AnswerProblem | null {
  if (!Array.isArray(value) || !value.every((code) => typeof code === 'string')) return 'wrong_type';
  const codes = value as string[];
  if (new Set(codes).size !== codes.length) return 'wrong_type';
  const order = new Map(holds.options.map((o, i) => [o.code, i]));
  if (!codes.every((code) => order.has(code))) return 'unknown_option';
  // In the definition's order (2.3), so one set of picks is one stored value, and hashes as one.
  if (codes.some((code, i) => i > 0 && order.get(code)! < order.get(codes[i - 1]!)!)) return 'wrong_type';
  const held = new Set(codes);
  if (holds.excludes.some(([a, b]) => held.has(a) && held.has(b))) return 'excluded_pair';
  if (codes.length > 1 && holds.options.some((o) => o.exclusive && held.has(o.code)))
    return 'exclusive_with_others';
  return null;
}

function checkText(value: unknown, maxLength: number): AnswerProblem | null {
  if (typeof value !== 'string') return 'wrong_type';
  // Postgres stores no NUL and no half of a surrogate pair, so the server's sync check refuses both
  // (services/api/src/sync/records.ts, jsonProblem); refused here too, the phone never saves one.
  // A string walks by code point, so a half with no partner is the only one in the surrogate range.
  for (const c of value) {
    const point = c.codePointAt(0)!;
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) return 'wrong_type';
  }
  // Characters, not UTF-16 units: an emoji is one character to the person typing it.
  let length = 0;
  for (const _ of value) if (++length > maxLength) return 'too_long';
  return null;
}

function isRealDate(year: string, month: string, day: string): boolean {
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return days !== undefined && d >= 1 && d <= days;
}
