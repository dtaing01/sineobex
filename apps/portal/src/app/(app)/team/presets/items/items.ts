import { aToZ, byName, inPlace } from '@/components/presets/order';
import type { ItemBody, PresetRow } from '@/lib/presets';

/**
 * How Items lists the team's items (phase 5 design 8.1): grouped by category, in the categories'
 * own order, each group A to Z, with a line of what each item is. Pure, so the page and its tests
 * read the same groups.
 */

export type Item = PresetRow<'item'>;
export type Category = PresetRow<'order_category'>;

/** One item as the list shows it: its name, a line of what it is, and whether an update is offered. */
export interface ListedItem {
  id: string;
  name: string;
  summary: string;
  updateAvailable: boolean;
}

/** One category's items as the list shows them. */
export interface ItemGroup {
  id: string;
  name: string;
  items: ListedItem[];
}

/** "Counted in tablet · Medical · Lot and expiry · Records a number in mg/dL". */
export function itemSummary(body: ItemBody): string {
  const result = body.result;
  return [
    `Counted in ${body.unit}`,
    body.medical ? 'Medical' : 'Non-Medical',
    ...(body.captureLot ? ['Lot and expiry'] : []),
    ...(result === null
      ? []
      : result.type === 'choice'
        ? ['Records a choice']
        : result.type === 'number'
          ? [`Records a number in ${result.unit}`]
          : ['Records a result']),
  ].join(' · ');
}

/**
 * The active items, grouped by their category: the categories in their place in the list, then
 * any category the page holds no active row of, by name, so an item is never left out. A category
 * that holds no active item has no group.
 */
export function itemGroups(items: readonly Item[], categories: readonly Category[]): ItemGroup[] {
  const active = aToZ(items.filter((i) => i.state === 'active'));
  const listed = inPlace(categories.filter((c) => c.state === 'active'));
  const named = new Map(categories.map((c) => [c.id, c.name]));
  const others = [...new Set(active.map((i) => i.body.categoryId))]
    .filter((id) => !listed.some((c) => c.id === id))
    .map((id) => ({ id, name: named.get(id) ?? 'Not on your team’s list' }))
    .sort((a, b) => byName.compare(a.name, b.name));
  return [...listed.map((c) => ({ id: c.id, name: c.name })), ...others]
    .map((c) => ({
      ...c,
      items: active
        .filter((i) => i.body.categoryId === c.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          summary: itemSummary(i.body),
          updateAvailable: i.updateOnOffer,
        })),
    }))
    .filter((g) => g.items.length > 0);
}
