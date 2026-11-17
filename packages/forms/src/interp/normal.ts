/**
 * One-tap Normal (docs/design/phase-4/forms.md, 6.3 and 7.1): the answers it would add to one
 * section, or to one entry of a repeating section. The phone writes each answer returned, one
 * change each, so a finding already charted is never overwritten.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { FieldNode, Leaf } from '../paths.ts';
import { isBlank, NoteReading, ownLeaves } from './conditions.ts';
import type { Answers } from './conditions.ts';

/**
 * The answers Normal would add, as a new object of path to value in code-unit key order. Nothing
 * for a section that does not offer Normal (`normal: true`), that is hidden, that repeats when no
 * entry that is there is named, or that does not repeat when an entry is named.
 *
 * A field is filled when it shows, no set flag clears it, nothing is stored at its path (a blank
 * is nothing), and neither it nor a group or grid around it is `noNormal`. A choose-one takes its
 * first normal option, a choose-many every normal option in the definition's order, a number its
 * `normal` value; each side and each counting row is filled on its own. Other kinds have no normal.
 *
 * Visible means visible once Normal's answers are in: every normal is put in at once, and only
 * those that count with all of them in are kept. A follow-up that a normal answer hides is not
 * filled (6.3: the cranial nerve groups that stay hidden while the screen is Grossly intact), one
 * that a normal answer shows is, and the order the fields are written in decides nothing. A kept
 * answer counts, and an answer left out never counted, so no condition read it: with these added,
 * every visible field that has a normal holds an answer.
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

  const added: Record<string, unknown> = {};
  for (const node of reading.model.nodes) {
    if (node.section !== section || noNormal(node)) continue;
    for (const leaf of ownLeaves(node)) {
      const value = normalOf(leaf);
      const path = reading.pathOf(leaf, entry);
      if (value !== undefined && isBlank(reading.stored(path))) added[path] = value;
    }
  }
  const after = new NoteReading(definition, { ...answers, ...added });
  const kept = Object.keys(added)
    .filter((path) => after.counts(path))
    .sort();
  return Object.fromEntries(kept.map((path) => [path, added[path]]));
}

/** `noNormal` on the field or on a group or grid it is in. */
function noNormal(node: FieldNode): boolean {
  for (let at: FieldNode | null = node; at; at = at.parent) if (at.field.noNormal) return true;
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
