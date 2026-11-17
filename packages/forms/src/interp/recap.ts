/**
 * The automatic recap (docs/design/phase-4/lifecycle.md 8.1; forms.md 6.6 and 7.1): one short
 * line for each section that has an answer, worked out every time it is shown and never stored,
 * from the note type version the note was written on. It shows in a section's collapsed header,
 * on the summary screen and on the visit, and so on the patient's overview: nothing from a
 * sensitive exam is in it, for any reader (lifecycle 6.4 rules 3 and 8).
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { FieldNode } from '../paths.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers } from './effective.ts';
import { layOut } from './layout.ts';
import type { Item } from './layout.ts';
import { withoutSensitiveExams } from './sensitive-exams.ts';

export type RecapLine = { section: string; text: string };

/**
 * The lines of the sections with an answer that counts, in the definition's order. Each item is
 * its labels joined by ', ', then ': ' and its value, as the read model writes them (layout.ts);
 * items are joined by '; '. In a repeating section each entry with an answer is its title
 * (`itemTitle`, {n} its number), ': ' and its items, and entries are joined by '. '.
 *
 * Left out: what a sensitive exam put there (sensitive-exams.ts), and a field marked
 * `recap: false` with everything in it. Who may read the rest is visibleAnswers' rule: the caller
 * passes the answers the reader may see.
 */
export function recapLines(definition: ResolvedNoteType, answers: Answers): RecapLine[] {
  const shown = withoutSensitiveExams(definition, effectiveAnswers(definition, answers));
  return layOut(definition, shown, leftOut).map(({ section, items, entries }) => ({
    section: section.id,
    text: entries
      ? entries.map((entry) => `${entry.title}: ${joined(entry.items)}`).join('. ')
      : joined(items),
  }));
}

function leftOut(node: FieldNode): boolean {
  return node.field.recap === false;
}

function joined(items: Item[]): string {
  return items.map((item) => `${item.labels.join(', ')}: ${item.value}`).join('; ');
}
