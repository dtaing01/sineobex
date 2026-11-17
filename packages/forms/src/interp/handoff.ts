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
import { fieldAt } from './field-at.ts';
import { layOut } from './layout.ts';
import { recapLines } from './recap.ts';
import { withoutSensitiveExams } from './sensitive-exams.ts';

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
 * that count of every field marked `handoff` (with everything in it), less what a sensitive exam
 * put there and less a quick note's answer that Expand carried into a full note of the visit,
 * which then answers at the field it maps to (`expanded`), note by note in the order given, each
 * laid out and written as the read model writes it, its labels joined by ', ', an entry's title
 * first in a repeating section; then each note's recap (recapLines), less every `treatmentRecord`
 * section, in the same order of notes. The patient's name, age and allergies come from the chart,
 * not from here.
 */
export function handoffLines(
  definitions: readonly ResolvedNoteType[],
  answersByNote: readonly (Answers | null)[],
): HandoffLine[] {
  if (definitions.length !== answersByNote.length)
    throw new Error(`handoffLines: ${definitions.length} definitions for ${answersByNote.length} notes`);
  const fields: HandoffLine[] = [];
  const recaps: HandoffLine[] = [];
  const held = answeredFields(definitions, answersByNote);
  definitions.forEach((definition, note) => {
    const answers = answersByNote[note];
    if (!answers) return;
    const line = (section: string, labels: string[], value: string) =>
      fields.push({ kind: 'field', note, section, label: labels.join(', '), value });
    // The summary is shown to EMS, so nothing a sensitive exam put there is in it, as in the recap
    // (lifecycle 6.4 rule 8); the validator keeps a handoff field out of a restricted section.
    for (const { section, items, entries } of layOut(
      definition,
      withoutSensitiveExams(definition, effectiveAnswers(definition, answers)),
      (node) => !marked(node) || expanded(node, held),
    )) {
      // Nothing is struck here, so every item has a value.
      for (const item of items) line(section.id, item.labels, item.value!);
      for (const entry of entries ?? [])
        for (const item of entry.items) line(section.id, [entry.title, ...item.labels], item.value!);
    }
    for (const { section, text } of recapLines(definition, answers)) {
      const { title, treatmentRecord } = definition.sections.find((s) => s.id === section)!;
      // EMS may not read a treatment record (validate.handoff_restricted), whoever shows the
      // summary: a reader who may see the section would otherwise hand it over in its recap.
      if (treatmentRecord) continue;
      recaps.push({ kind: 'recap', note, section, label: title, value: text });
    }
  });
  return [...fields, ...recaps];
}

/**
 * For each note type of the visit, by key, the answers that count in its notes, by their path
 * without an entry's part (a leaf's key): what a `mapsTo` names.
 */
function answeredFields(
  definitions: readonly ResolvedNoteType[],
  answersByNote: readonly (Answers | null)[],
): Map<string, Set<string>> {
  const held = new Map<string, Set<string>>();
  definitions.forEach((definition, note) => {
    const answers = answersByNote[note];
    if (!answers) return;
    const keys = held.get(definition.key) ?? new Set<string>();
    held.set(definition.key, keys);
    for (const path of Object.keys(effectiveAnswers(definition, answers))) {
      const leaf = fieldAt(definition, path)?.leaf;
      if (leaf) keys.add(leaf.key);
    }
  });
  return held;
}

/**
 * Whether a quick field's answer was carried into a full note of the visit (Expand, forms 6.4): it,
 * or a group or grid around it, maps to a note type of which a note holds an answer that counts at
 * the target of one of its answers. The full note's line stands for it, and stays right when that
 * note is corrected; the quick note keeps the answer, and its recap still shows it.
 */
function expanded(node: FieldNode, held: Map<string, Set<string>>): boolean {
  let mapped: FieldNode | null = node;
  while (mapped && mapped.field.mapsTo === undefined) mapped = mapped.parent;
  const mapsTo = mapped?.field.mapsTo;
  if (!mapped?.base || mapsTo === undefined) return false;
  const colon = mapsTo.indexOf(':');
  const answered = held.get(mapsTo.slice(0, colon));
  if (!answered) return false;
  const own = mapped.base.join('.');
  return node.leaves.some((leaf) => answered.has(mapsTo.slice(colon + 1) + leaf.key.slice(own.length)));
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
