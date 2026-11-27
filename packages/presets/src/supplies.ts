/**
 * The supplies a note suggests, and the lines a bundle applies (phase 5 design 5.3; PRD main
 * 424-431, 441-442). Phase 6 calls both, and the phone has its own copies (P2-supplies);
 * packages/contract/test-vectors/supply-suggest.json pins the two.
 *
 * Pure, and in the API's edge bundle: nothing here may import a package but zod and the forms index
 * (test/import-path.test.ts).
 */
import { fieldAt } from '@sineobex/forms';
import type { AnswerTest, PathTarget, ResolvedNoteType } from '@sineobex/forms';
import type { BundleBody, FieldSupplyMapBody } from './schemas.ts';

export type ItemState = { state: 'active' | 'archived' };
export type SupplySuggestion = { itemId: string; qty: number; mapId: string };
export type BundleLine = { itemId: string; qty: number; checked: boolean };

/** Where a map fired: once for the note, or in one entry of a repeating section. */
type Firing = { section: string; entry: string } | null;

/**
 * What a note suggests: one suggestion for each map and item, the quantities of that map's lines
 * naming the item summed over every place the map fires; a sum of 0 is no suggestion. Maps come in
 * the order given, each map's items in the order its lines first name them. Two maps naming one
 * item give a suggestion each, so whoever confirms them can tell what each came from.
 *
 * `answers` are what the suggesting person may see of the note (visibleAnswers, forms 7.1): an
 * answer hidden from them, or in a field a condition hides, is not there to fire a map. A line whose
 * item is archived, or not among `items`, is skipped.
 */
export function suggestSupplies(input: {
  /** The team's active field supply maps. */
  maps: readonly { id: string; body: FieldSupplyMapBody }[];
  /** The team's items by id. */
  items: Readonly<Record<string, ItemState>>;
  noteTypeKey: string;
  /** The note's own version. */
  definition: ResolvedNoteType;
  /** What the suggesting person may see of the note: visibleAnswers (forms 7.1). */
  answers: Readonly<Record<string, unknown>>;
}): SupplySuggestion[] {
  const { definition, answers } = input;
  const suggestions: SupplySuggestion[] = [];
  for (const { id, body: map } of input.maps) {
    if (map.noteTypeKey !== input.noteTypeKey) continue;
    // With no path a map fires once for the note, whatever its answers ("wound care → 1 bandage").
    const firings: Firing[] =
      map.path === undefined ? [null] : map.when ? firingsOf(definition, answers, map.path, map.when) : [];
    const totals = new Map<string, number>();
    for (const firing of firings)
      for (const line of map.lines) {
        if (!active(input.items, line.itemId)) continue;
        const qty =
          typeof line.qty === 'number'
            ? line.qty
            : quantityAt(definition, answers, line.qty.fromPath, firing);
        totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + qty);
      }
    for (const [itemId, qty] of totals) if (qty > 0) suggestions.push({ itemId, qty, mapId: id });
  }
  return suggestions;
}

/** A bundle's lines given `multiplier` times ("- 2 kits +"): a core line checked, an optional one not. */
export function bundleLines(
  bundle: BundleBody,
  items: Readonly<Record<string, ItemState>>,
  multiplier: number,
): BundleLine[] {
  return bundle.lines.flatMap((line) =>
    active(items, line.itemId)
      ? [{ itemId: line.itemId, qty: line.qty * multiplier, checked: line.core }]
      : [],
  );
}

const active = (items: Readonly<Record<string, ItemState>>, id: string) =>
  Object.hasOwn(items, id) && items[id]!.state === 'active';

/**
 * Each place the note holds an answer at the map's path that passes its test: one in a note, or one
 * in each entry of a repeating section, so each wound dressed is its own firing. A path this version
 * of the note type lacks names no answer, and never fires.
 */
function firingsOf(
  definition: ResolvedNoteType,
  answers: Readonly<Record<string, unknown>>,
  path: string,
  when: AnswerTest,
): Firing[] {
  const firings: Firing[] = [];
  for (const [at, value] of Object.entries(answers)) {
    const target = fieldAt(definition, at);
    if (!target || (target.points !== 'field' && target.points !== 'cell') || target.key !== path) continue;
    if (passes(target, value, when))
      firings.push(target.entry === null ? null : { section: target.section.id, entry: target.entry });
  }
  return firings;
}

/**
 * `includes` a code: a choose-many holding it, or a choose-one that is it. `equals`: a choose-one
 * that is the value, a choose-many holding it alone, a number equal to it, a tick when it is true.
 */
function passes(target: PathTarget, value: unknown, when: AnswerTest): boolean {
  if ('answered' in when) return true;
  if (target.holds?.type === 'codes') {
    const codes: unknown[] = Array.isArray(value) ? value : [value];
    return 'includes' in when
      ? codes.includes(when.includes)
      : codes.length === 1 && codes[0] === when.equals;
  }
  if ('includes' in when) return false;
  return (target.holds?.type === 'number' || target.holds?.type === 'flag') && value === when.equals;
}

/**
 * A quantity read from the note: the whole number from 0 to 99 at `fromPath`, in the entry the map
 * fired in when the path is in its repeating section; anything else, or no answer, is 0.
 */
function quantityAt(
  definition: ResolvedNoteType,
  answers: Readonly<Record<string, unknown>>,
  fromPath: string,
  firing: Firing,
): number {
  const [section = '', ...rest] = fromPath.split('.');
  let at = fromPath;
  if (definition.sections.find((s) => s.id === section)?.repeat) {
    // validatePreset lets a map read a repeating section only from within the same one.
    if (firing?.section !== section) return 0;
    at = [section, firing.entry, ...rest].join('.');
  }
  const value = Object.hasOwn(answers, at) ? answers[at] : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99 ? value : 0;
}
