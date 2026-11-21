/**
 * One-tap Normal (docs/design/phase-4/forms.md, 6.3 and 7.1): the answers it would add to one
 * section, or to one entry of a repeating section. The phone writes each answer returned, one
 * change each, so a finding already charted is never overwritten.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { FieldNode, Leaf } from '../paths.ts';
import { NoteReading, ownLeaves } from './conditions.ts';
import type { Answers } from './conditions.ts';

/**
 * The answers Normal would add, as a new object of path to value in code-unit key order. Nothing
 * for a section that does not offer Normal (`normal: true`), that is hidden, that repeats when no
 * entry that is there is named, or that does not repeat when an entry is named.
 *
 * A field is filled when it shows, no set flag clears it, it holds no answer (a blank, or a value
 * checkAnswer refuses, is none: finishCheck asks for it too), and neither it nor a group or grid
 * around it is `noNormal` or `collapsed`. A collapsed part is optional (coordinator decision B3):
 * only the clinician says it was examined, so Normal fills nothing in it, a grid's cells included,
 * even once it is opened and partly charted. A choose-one takes its normal option, a choose-many every normal option
 * in the definition's order (the validator holds that one answer takes them: normal_conflict), a
 * number its `normal` value; each side and each counting row is filled on its own. Other kinds
 * have no normal.
 *
 * Visible means visible once Normal's answers are in: every normal is put in at once, and only
 * those that count with all of them in are kept. A follow-up that a normal answer hides is not
 * filled (6.3: the cranial nerve groups that stay hidden while the screen is Grossly intact), one
 * that a normal answer shows is, and the order the fields are written in decides nothing.
 *
 * Normal never makes an answer that counts stop counting (coordinator decision D2): a finding
 * already charted in a follow-up stays, and the normal that would hide it is not filled. When the
 * normals all in at once would hide one, they are taken one at a time, in the definition's order
 * (fields as written, rows in their order, right before left), each kept when, with those kept
 * before it, it hides no answer that counts; those passed over are tried again, in order, until a
 * round keeps none. Only the kept ones that count with all of them in are returned.
 */
export function normalAnswers(
  definition: ResolvedNoteType,
  sectionId: string,
  answers: Answers,
  entryId?: string,
): Record<string, unknown> {
  const reading = new NoteReading(definition, answers);
  const section = reading.model.sections.find((s) => s.section.id === sectionId);
  const entry = entryId ?? null;
  if (!section?.section.normal || (section.section.repeat !== undefined) !== (entry !== null)) return {};

  const offered: [string, unknown][] = [];
  for (const node of reading.model.nodes) {
    if (node.section !== section || leftAlone(node)) continue;
    for (const leaf of ownLeaves(node)) {
      const value = normalOf(leaf);
      const path = reading.pathOf(leaf, entry);
      if (value !== undefined && reading.answer(path) === undefined) offered.push([path, value]);
    }
  }

  // The answers that count now, which no normal may hide.
  const counted = Object.keys(answers).filter((path) => reading.counting(path) !== undefined);
  const hides = (added: Record<string, unknown>) => {
    const after = new NoteReading(definition, { ...answers, ...added });
    return counted.some((path) => after.counting(path) === undefined);
  };
  let added: Record<string, unknown> = Object.fromEntries(offered);
  if (hides(added)) {
    added = {};
    let waiting = offered;
    for (;;) {
      const passed = waiting.filter(([path, value]) => {
        if (hides({ ...added, [path]: value })) return true;
        added[path] = value;
        return false;
      });
      if (passed.length === waiting.length) break;
      waiting = passed;
    }
  }
  const after = new NoteReading(definition, { ...answers, ...added });
  const kept = Object.keys(added)
    .filter((path) => after.counts(path))
    .sort();
  return Object.fromEntries(kept.map((path) => [path, added[path]]));
}

/** `noNormal` on the field or on a group or grid it is in, or `collapsed` on such a group or grid. */
function leftAlone(node: FieldNode): boolean {
  for (let at: FieldNode | null = node; at; at = at.parent) {
    const { field } = at;
    if (field.noNormal || ((field.kind === 'group' || field.kind === 'grid') && field.collapsed)) return true;
  }
  return false;
}

/** What Normal fills at a leaf, or undefined where the field has no normal. */
function normalOf(leaf: Leaf): unknown {
  const { holds, node } = leaf;
  if (holds.type === 'codes') {
    const codes = holds.options.filter((option) => option.normal).map((option) => option.code);
    if (codes.length === 0) return undefined;
    return holds.many ? codes : codes[0];
  }
  return node.field.kind === 'number' ? node.field.normal : undefined;
}
