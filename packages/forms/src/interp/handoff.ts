/**
 * The EMS handoff summary (docs/design/phase-4/lifecycle.md 5.7 and 9.8; forms.md 6.2, 7.1 and
 * 10.1 #6): what the medic is shown full-screen on the phone, and what the portal's PDF prints,
 * built the same way on both from the notes of one visit.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { FieldNode } from '../paths.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers } from './effective.ts';
import { layOut } from './layout.ts';
import { recapLines } from './recap.ts';

export type HandoffLine = {
  /** `field`: an answer of a field marked `handoff`. `recap`: a line of a note's recap. */
  kind: 'field' | 'recap';
  /** The note's place in the list given. */
  note: number;
  /** The section's id. */
  section: string;
  /** A field line: the answer's labels; a recap line: the section's title. */
  label: string;
  value: string;
};

/**
 * The handoff of the notes `definitions[i]` and `answersByNote[i]` describe, each note its own
 * version's definition. Each note's answers are those its reader may see (visibleAnswers, applied
 * by the caller), so a handoff never shows a reader a note they may not open; null, a note they
 * may not see at all, gives no line.
 *
 * PLAN-OPEN: the content of the summary (forms.md 10.1 #6). The default built: first the answers
 * that count of every field marked `handoff` (with everything in it), note by note in the order
 * given, each laid out and written as the read model writes it, its labels joined by ', ', an
 * entry's title first in a repeating section; then each note's recap (recapLines), in the same
 * order of notes. The patient's name, age and allergies come from the chart, not from here.
 */
export function handoffLines(
  definitions: readonly ResolvedNoteType[],
  answersByNote: readonly (Answers | null)[],
): HandoffLine[] {
  if (definitions.length !== answersByNote.length)
    throw new Error(`handoffLines: ${definitions.length} definitions for ${answersByNote.length} notes`);
  const fields: HandoffLine[] = [];
  const recaps: HandoffLine[] = [];
  definitions.forEach((definition, note) => {
    const answers = answersByNote[note];
    if (!answers) return;
    const line = (section: string, labels: string[], value: string) =>
      fields.push({ kind: 'field', note, section, label: labels.join(', '), value });
    for (const { section, items, entries } of layOut(
      definition,
      effectiveAnswers(definition, answers),
      (node) => !marked(node),
    )) {
      for (const item of items) line(section.id, item.labels, item.value);
      for (const entry of entries ?? [])
        for (const item of entry.items) line(section.id, [entry.title, ...item.labels], item.value);
    }
    for (const { section, text } of recapLines(definition, answers))
      recaps.push({
        kind: 'recap',
        note,
        section,
        label: definition.sections.find((s) => s.id === section)!.title,
        value: text,
      });
  });
  return [...fields, ...recaps];
}

/**
 * Whether a field is in the handoff, or holds a field that is: it, or a group or grid around it,
 * is marked; or a field in it is, which then goes in alone.
 */
function marked(node: FieldNode): boolean {
  for (let at: FieldNode | null = node; at; at = at.parent) if (at.field.handoff) return true;
  return holdsMarked(node);
}

function holdsMarked(node: FieldNode): boolean {
  return [...node.children, ...(node.cell ? [node.cell] : [])].some(
    (child) => child.field.handoff === true || holdsMarked(child),
  );
}
