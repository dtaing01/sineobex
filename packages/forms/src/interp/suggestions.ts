/**
 * The summary screen's suggested next steps (docs/design/phase-4/lifecycle.md 9.6; forms.md 2.2
 * and 7.1): the note types that the options picked in a note suggest, each a chip that adds one.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { Leaf } from '../paths.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers } from './effective.ts';
import { definitionModel, fieldAt } from './field-at.ts';

/**
 * The `suggests` keys of the options picked in answers that count, each once, in the order the
 * definition lists them: fields as written, a field's options as listed. That order does not hang
 * on which entry picked an option, nor on when, so two phones show the same chips.
 *
 * Only a stored code is picked: a choice's, a region's region, side or surface, a choice in a
 * grid's cell. A grid's fixed row is not picked, so a `suggests` on one suggests nothing.
 */
export function suggestions(definition: ResolvedNoteType, answers: Answers): string[] {
  const picked = new Map<Leaf, Set<string>>();
  for (const [path, value] of Object.entries(effectiveAnswers(definition, answers))) {
    const leaf = fieldAt(definition, path)?.leaf;
    if (leaf?.holds.type !== 'codes') continue;
    const codes = picked.get(leaf) ?? new Set<string>();
    for (const code of typeof value === 'string' ? [value] : (value as string[])) codes.add(code);
    picked.set(leaf, codes);
  }
  const keys: string[] = [];
  for (const node of definitionModel(definition).nodes)
    for (const leaf of node.leaves) {
      // A group's or a grid's leaves are its fields'; each is read once, at its own field.
      if (leaf.node !== node || leaf.holds.type !== 'codes') continue;
      const codes = picked.get(leaf);
      if (!codes) continue;
      for (const option of leaf.holds.options)
        if (option.suggests !== undefined && codes.has(option.code) && !keys.includes(option.suggests))
          keys.push(option.suggests);
    }
  return keys;
}
