/**
 * Expand on the Quick encounter (docs/design/phase-4/forms.md 6.4 and 7.1): the answers the phone
 * writes into the full note it creates, as ordinary changes, so nothing the person filled in is
 * typed again. The quick note keeps its own answers.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import type { ResolvedNoteType } from '../resolve.ts';
import type { Holds } from '../paths.ts';
import { checkAnswer } from './check-answer.ts';
import type { AnswerProblem } from './check-answer.ts';
import type { Answers } from './conditions.ts';
import { effectiveAnswers } from './effective.ts';
import { definitionModel, fieldAt } from './field-at.ts';
import type { TargetHolds } from './field-at.ts';

/**
 * For each repeating section of the full note, by its id, the entry Expand writes into: the ID the
 * phone made for it and the time it is added, its `entryAt`. A pure function makes neither.
 */
export type NewEntries = Readonly<Record<string, { readonly id: string; readonly at: string }>>;

/** A quick answer Expand did not write, for the person to see: where it is, where it would go, why not. */
export type LeftOut = {
  /** The quick note's path. */
  path: string;
  /** The full note's path, without an entry's part, as `mapsTo` writes it. */
  target: string;
  problem: AnswerProblem;
};

export type Expansion = {
  /** Path to value in the full note, in code-unit key order, an entry's `entryAt` among them. */
  answers: Record<string, unknown>;
  /** In the quick definition's order. */
  leftOut: LeftOut[];
};

/**
 * What Expand writes into a new note on `fullDefinition`, from `answers` of a quick note on
 * `quickDefinition`, the draft's own version: each answer that counts of a field whose `mapsTo`
 * names this full note type, at the target's path, with what follows the field's own path (a side,
 * `_other`, a region's part) kept. A target in a repeating section goes into the entry
 * `newEntryIds` gives for that section, and that entry's `entryAt` is written with the first
 * answer that goes into it; an entry nothing goes into is not made.
 *
 * The validator holds the newest quick version to the newest full one, but a draft on an older
 * quick version is not (6.4). PLAN-OPEN: what Expand does with such a draft (forms.md 10.1 #12).
 * The default built, for every draft alike: an answer is written only where the full version takes
 * it (`checkAnswer`) and is otherwise left out and listed. A choose-many is written in the full
 * field's order of options, the order a stored value must have. A number in another unit than the
 * full field's is left out as `wrong_type`: the stored number would be read in the full field's
 * unit, which checkAnswer cannot see.
 *
 * Throws when an answer goes into a repeating section that `newEntryIds` gives no usable entry for:
 * the caller makes one for every repeating section of the full note.
 */
export function expandQuick(
  quickDefinition: ResolvedNoteType,
  answers: Answers,
  fullDefinition: ResolvedNoteType,
  newEntryIds: NewEntries,
): Expansion {
  const counted = effectiveAnswers(quickDefinition, answers);
  const full = definitionModel(fullDefinition);
  const written: [string, unknown][] = [];
  const leftOut: LeftOut[] = [];
  const entered = new Set<string>();

  for (const node of definitionModel(quickDefinition).nodes) {
    const { mapsTo } = node.field;
    // The validator lets no grid cell and no field of a repeating section map (6.4).
    if (mapsTo === undefined || !node.base || node.section.section.repeat) continue;
    const colon = mapsTo.indexOf(':');
    if (mapsTo.slice(0, colon) !== fullDefinition.key) continue;
    const base = mapsTo.slice(colon + 1);
    const own = node.base.join('.');
    const section = full.nodes.find((n) => n.base?.join('.') === base)?.section.section;
    const repeat = section?.repeat ? section.id : null;

    for (const leaf of node.leaves) {
      if (!Object.hasOwn(counted, leaf.key)) continue;
      const target = base + leaf.key.slice(own.length);
      const entry = repeat === null ? null : entryOf(fullDefinition, repeat, newEntryIds);
      const path = entry === null ? target : `${repeat}.${entry}${target.slice(repeat!.length)}`;
      const holds = fieldAt(fullDefinition, path)?.holds ?? null;
      const value = inOrder(holds, counted[leaf.key]);
      const problem = otherUnit(leaf.holds, holds) ? 'wrong_type' : checkAnswer(fullDefinition, path, value);
      if (problem !== null) {
        leftOut.push({ path: leaf.key, target, problem });
        continue;
      }
      written.push([path, value]);
      if (repeat !== null && !entered.has(repeat)) {
        entered.add(repeat);
        written.push([`${repeat}.${entry}.entryAt`, newEntryIds[repeat]!.at]);
      }
    }
  }
  written.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { answers: Object.fromEntries(written), leftOut };
}

/** The new entry's ID in a repeating section, once its ID and time are ones the server takes. */
function entryOf(definition: ResolvedNoteType, section: string, entries: NewEntries): string {
  const entry = Object.hasOwn(entries, section) ? entries[section] : undefined;
  if (!entry || checkAnswer(definition, `${section}.${entry.id}.entryAt`, entry.at) !== null)
    throw new Error(`expandQuick: no usable new entry for the repeating section "${section}"`);
  return entry.id;
}

/** A choose-many's codes in the full field's order of options; a code it lacks goes last, as it was. */
function inOrder(holds: TargetHolds | null, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (holds?.type !== 'codes' || !holds.many) return [...value];
  const order = new Map(holds.options.map((option, index) => [option.code, index]));
  const place = (code: unknown) => order.get(code as string) ?? order.size;
  return [...value].sort((a, b) => place(a) - place(b));
}

/** Two numbers stored in different units (or one with a unit and one without). */
function otherUnit(from: Holds, to: TargetHolds | null): boolean {
  return from.type === 'number' && to?.type === 'number' && from.unit !== to.unit;
}
