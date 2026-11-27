/**
 * The answers that count (docs/design/phase-4/forms.md, 7.1): those of visible fields, in entries
 * that are there, by the rules of conditions.ts. Every other function of the interpreter reads a
 * note through them, a finished note keeps only them, and the hash a signer sends is taken over
 * them (lifecycle 4.5).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import { NoteReading } from './conditions.ts';
import type { Answers } from './conditions.ts';

/**
 * A new object of path to value, holding each answer of `answers` that counts, as stored (a list
 * copied, not shared). A blank is no answer and is left out, as is an answer `checkAnswer`
 * refuses, so the content hash's own blank rule changes nothing here. An entry that is there keeps
 * its `entryAt`. The paths are in UTF-16 code-unit order, the order canonicalJson writes keys in,
 * so the same answers always give the same object, key for key.
 */
export function effectiveAnswers(definition: ResolvedNoteType, answers: Answers): Record<string, unknown> {
  const reading = new NoteReading(definition, answers);
  const kept: [string, unknown][] = [];
  for (const path of Object.keys(answers)) {
    const value = reading.counting(path);
    if (value !== undefined) kept.push([path, Array.isArray(value) ? [...value] : value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(kept);
}
