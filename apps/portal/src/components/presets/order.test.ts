import { describe, expect, it } from 'vitest';
import type { CategoryBody, FlagBody, ItemBody } from '@/lib/presets';
import { aToZ, inPlace, inRank, itemChoices, namesOf } from './order';

// The orders the preset pages list presets in (phase 5 design 8.1), as the API sorts its lists.
// Every name is made up.
const OTC = '30d00000-0000-4000-8000-000000000001';
const LABS = '30d00000-0000-4000-8000-000000000002';
const OWN = '30d00000-0000-4000-8000-000000000003';

const category = (id: string, name: string, sort: number, state: 'active' | 'archived' = 'active') => ({
  id,
  name,
  state,
  body: { name, behaviour: 'supply', sort } satisfies CategoryBody,
});

const item = (id: string, name: string, categoryId: string, state: 'active' | 'archived' = 'active') => ({
  id,
  name,
  state,
  body: {
    name,
    categoryId,
    unit: 'each',
    medical: false,
    captureLot: false,
    result: null,
  } satisfies ItemBody,
});

const id = (n: number) => `30d00000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

describe('the preset pages’ orders', () => {
  it('list names A to Z as a reader sorts them: any case, numbers by their value', () => {
    const rows = [
      item(id(1), 'gauze', OTC),
      item(id(2), 'Demo: Kit 10', OTC),
      item(id(3), 'Demo: Kit 9', OTC),
    ];
    expect(aToZ(rows).map((r) => r.name)).toEqual(['Demo: Kit 9', 'Demo: Kit 10', 'gauze']);
  });

  it('list categories by their place, then by name', () => {
    const rows = [category(LABS, 'Labs', 30), category(OWN, 'Demo: Kits', 30), category(OTC, 'OTC', 10)];
    expect(inPlace(rows).map((r) => r.name)).toEqual(['OTC', 'Demo: Kits', 'Labs']);
  });

  it('list a tier’s flags by rank, lowest first, then by name, as two flags an update gave one rank', () => {
    const flag = (n: number, name: string, rank: number) => ({
      id: id(n),
      name,
      body: {
        name,
        tier: 'secondary',
        criteria: '',
        color: 'blue',
        rank,
        sensitive: false,
      } satisfies FlagBody,
    });
    const rows = [
      flag(1, 'Demo: Wet feet', 20),
      flag(2, 'Demo: Heat risk', 20),
      flag(3, 'Demo: Sun risk', 10),
    ];
    expect(inRank(rows).map((r) => r.name)).toEqual(['Demo: Sun risk', 'Demo: Heat risk', 'Demo: Wet feet']);
  });

  it('offer a line’s items by category, in the categories’ order, each A to Z, a removed one marked', () => {
    const categories = [category(LABS, 'Labs', 30), category(OTC, 'OTC', 10)];
    const items = [
      item(id(1), 'Glucose test', LABS),
      item(id(2), 'Naloxone kit', OTC),
      item(id(3), 'Acetaminophen', OTC, 'archived'),
      item(id(4), 'Demo: Loose item', '30d00000-0000-4000-8000-0000000000ff'),
    ];
    expect(itemChoices(items, categories)).toEqual([
      { id: id(3), name: 'Acetaminophen', group: 'OTC', removed: true },
      { id: id(2), name: 'Naloxone kit', group: 'OTC' },
      { id: id(1), name: 'Glucose test', group: 'Labs' },
      // An item whose category the page didn't read comes last.
      { id: id(4), name: 'Demo: Loose item', group: 'Other' },
    ]);
  });

  it('name each preset by its ID, removed ones too', () => {
    expect(namesOf([category(OTC, 'OTC', 10)], [item(id(1), 'Gauze', OTC, 'archived')])).toEqual({
      [OTC]: 'OTC',
      [id(1)]: 'Gauze',
    });
  });
});
