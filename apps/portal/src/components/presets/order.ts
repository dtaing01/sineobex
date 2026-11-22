import type { PresetRow } from '@/lib/presets';
import type { ItemChoice } from './ItemLines';

/**
 * The orders the preset pages list presets in, and the names they read each other's IDs by (phase 5
 * design 8.1). Names compare as the API sorts its lists (routes/presets-admin.ts), so a page and
 * the API never disagree about which comes first.
 */
export const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Named = Pick<PresetRow, 'id' | 'name'>;

/** Presets A to Z, as the API lists them. */
export function aToZ<T extends Named>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => byName.compare(a.name, b.name) || byId(a, b));
}

type Category = Pick<PresetRow<'order_category'>, 'id' | 'name' | 'state' | 'body'>;

/** The team's categories as staff find them: by place in the list, lowest first, then by name. */
export function inPlace<T extends Category>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.body.sort - b.body.sort || byName.compare(a.name, b.name) || byId(a, b));
}

type Flag = Pick<PresetRow<'flag'>, 'id' | 'name' | 'body'>;

/**
 * A tier's flags as staff see them: by rank, lowest first (a risk level's highest risk first), then
 * by name, as two flags an update gave one rank are ordered (design 5.1, 5.3).
 */
export function inRank<T extends Flag>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.body.rank - b.body.rank || byName.compare(a.name, b.name) || byId(a, b));
}

/** Each preset's name by its ID, archived ones too: what an update's review names IDs by. */
export function namesOf(...lists: readonly (readonly Named[])[]): Record<string, string> {
  return Object.fromEntries(lists.flatMap((rows) => rows.map((r) => [r.id, r.name] as const)));
}

type Item = Pick<PresetRow<'item'>, 'id' | 'name' | 'state' | 'body'>;

/**
 * The items a line may name (ItemLines), grouped by their category in the categories' order, each
 * group A to Z: the active ones, and the archived ones, which a line offers only when it holds one.
 * An item whose category the page didn't read comes last, under "Other".
 */
export function itemChoices(items: readonly Item[], categories: readonly Category[]): ItemChoice[] {
  const order = inPlace(categories);
  const place = new Map(order.map((c, i) => [c.id, i]));
  const group = new Map(order.map((c) => [c.id, c.name]));
  return [...items]
    .sort(
      (a, b) =>
        (place.get(a.body.categoryId) ?? order.length) - (place.get(b.body.categoryId) ?? order.length) ||
        byName.compare(a.name, b.name) ||
        byId(a, b),
    )
    .map((i) => ({
      id: i.id,
      name: i.name,
      group: group.get(i.body.categoryId) ?? 'Other',
      ...(i.state === 'archived' ? { removed: true } : {}),
    }));
}
