/**
 * What stops Complete (docs/design/phase-4/forms.md, 7.1; lifecycle 3.3 and 4.6): a visible
 * required field that is empty. The phone asks it before it makes a sign-off, and the server again
 * before it finishes a note or takes a correction.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import { NoteReading, ownLeaves } from './conditions.ts';
import type { Answers } from './conditions.ts';

/** `required`: a visible required field holds no answer. */
export type FinishProblem = { section: string; path: string; problem: 'required' };

/**
 * One problem for each answer a visible required field is missing: a field with sides is recorded
 * once for each side, and a field in a grid's cell once for each row that counts, so each is asked
 * for. Inside a repeating section the check is made in each entry that is there; a section with
 * no entry asks for nothing. A field that does not count (hidden, cleared by a set flag, in a row
 * not picked) is not asked for.
 *
 * Empty is the same for every kind that may be required (choice, text, number, flag, date, time,
 * duration): no answer that checkAnswer takes, or a blank (null, "", []). So 0 fills a number or a
 * duration, a lone exclusive None fills a choose-many, a choice of Other fills it without its text,
 * a text of spaces fills it, and a flag is filled only when ticked.
 *
 * In the definition's order: section by section, entries in the order they were added, fields as
 * written, rows in their order, right before left.
 */
export function finishCheck(definition: ResolvedNoteType, answers: Answers): FinishProblem[] {
  const reading = new NoteReading(definition, answers);
  const problems: FinishProblem[] = [];
  for (const section of reading.model.sections) {
    const nodes = reading.model.nodes.filter((node) => node.section === section && node.field.required);
    const entries = section.section.repeat ? reading.entries(section) : [null];
    for (const entry of entries)
      for (const node of nodes)
        for (const leaf of ownLeaves(node)) {
          const path = reading.pathOf(leaf, entry);
          if (reading.fieldCounts(node, leaf.row, entry) && reading.answer(path) === undefined)
            problems.push({ section: section.section.id, path, problem: 'required' });
        }
  }
  return problems;
}
