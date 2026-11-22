import { describe, expect, it } from 'vitest';
import { describeField, reviewRows } from './review';

// The review of an update on offer (phase 5 design 5.1, 8.1): the copy's body beside the update's,
// in the words the pages use. Every name is made up.
const SUPPLIES = '30c00000-0000-4000-8000-000000000001';
const TESTS = '30c00000-0000-4000-8000-000000000002';
const SOCKS = '30a00000-0000-4000-8000-000000000001';
const names = { [SUPPLIES]: 'Demo: Supplies', [TESTS]: 'Demo: Labs', [SOCKS]: 'Demo: Socks' };

describe('the review of an update', () => {
  it('shows a flag’s rank beside the rest, marked when the update gives the platform’s back', () => {
    const now = {
      name: 'Frost risk',
      tier: 'secondary',
      criteria: 'Demo: the team’s own words',
      color: 'blue',
      rank: 30,
      sensitive: false,
    };
    const update = { ...now, criteria: '', rank: 10 };
    expect(reviewRows('flag', now, update, names)).toEqual([
      { field: 'name', label: 'Name', now: 'Frost risk', update: 'Frost risk', changes: false },
      { field: 'tier', label: 'List', now: 'Conditions', update: 'Conditions', changes: false },
      {
        field: 'criteria',
        label: 'Criteria',
        now: 'Demo: the team’s own words',
        update: 'None',
        changes: true,
      },
      { field: 'color', label: 'Colour', now: 'Blue', update: 'Blue', changes: false },
      { field: 'rank', label: 'Place in its list (lowest first)', now: '30', update: '10', changes: true },
      { field: 'sensitive', label: 'Sensitive', now: 'No', update: 'No', changes: false },
    ]);
  });

  it('names the presets a body names, and says so of one the team does not hold', () => {
    const now = {
      name: 'Demo: Rainy night',
      medical: false,
      prompt: '',
      lines: [{ itemId: SOCKS, qty: 1, core: true }],
    };
    const update = {
      ...now,
      prompt: 'Demo: Ask first.',
      lines: [
        { itemId: SOCKS, qty: 2, core: true },
        { itemId: '30a00000-0000-4000-8000-0000000000ff', qty: 1, core: false },
      ],
    };
    const rows = reviewRows('bundle', now, update, names);
    expect(rows.map((r) => [r.label, r.changes])).toEqual([
      ['Name', false],
      ['Medical or Non-Medical', false],
      ['Items', true],
      ['Ask before applying', true],
    ]);
    expect(rows[2]!.now).toEqual(['Demo: Socks × 1, core']);
    expect(rows[2]!.update).toEqual(['Demo: Socks × 2, core', 'Not on your team’s list × 1, optional']);
    expect(rows[3]).toMatchObject({ now: 'None', update: 'Demo: Ask first.' });
  });

  it('compares a body as stored, whatever order its keys came in', () => {
    const now = {
      name: 'Demo: Glucose',
      categoryId: TESTS,
      unit: 'test',
      medical: true,
      captureLot: false,
      result: { type: 'number', unit: 'mg/dL' },
    };
    const update = {
      result: { unit: 'mg/dL', type: 'number' },
      captureLot: false,
      medical: true,
      unit: 'test',
      categoryId: TESTS,
      name: 'Demo: Glucose',
    };
    expect(reviewRows('item', now, update, names).filter((r) => r.changes)).toEqual([]);
  });

  it('shows a field the page does not know, after the known ones, so nothing it changes is hidden', () => {
    const rows = reviewRows(
      'bag',
      { name: 'Demo: Bag', minimums: [] },
      { name: 'Demo: Bag', minimums: [], owner: 'x' },
      names,
    );
    expect(rows.map((r) => r.field)).toEqual(['name', 'minimums', 'owner']);
    expect(rows[2]).toMatchObject({ label: 'owner', now: 'None', update: 'x', changes: true });
  });

  it('leaves out the settings’ name, which is no choice', () => {
    const body = { name: 'Team settings', bagMinimumsOn: false, newBagMinimums: [], problemCheckDays: 90 };
    const rows = reviewRows('settings', body, { ...body, problemCheckDays: 60 }, names);
    expect(rows.map((r) => [r.label, r.now, r.update])).toEqual([
      ['Bag minimums', 'Off', 'Off'],
      ['Template for new bags', [], []],
      ['Check problems not updated in', '90 days', '60 days'],
    ]);
  });
});

describe('a field in words', () => {
  it('reads each kind’s values as its page says them', () => {
    expect(describeField('order_category', 'behaviour', 'lab', names)).toBe('Tests');
    expect(describeField('item', 'categoryId', SUPPLIES, names)).toBe('Demo: Supplies');
    expect(
      describeField('item', 'result', { type: 'choice', options: ['Positive', 'Negative'] }, names),
    ).toBe('A choice: Positive, Negative');
    expect(describeField('item', 'result', null, names)).toBe('None');
    expect(describeField('item', 'captureLot', true, names)).toBe('Yes');
    expect(describeField('bundle', 'medical', true, names)).toBe('Medical');
    expect(describeField('flag', 'tier', 'primary', names)).toBe('Risk level');
    expect(describeField('flag', 'color', 'grey', names)).toBe('Grey');
    expect(describeField('field_supply_map', 'path', undefined, names)).toBe('Every note of this type');
    expect(describeField('field_supply_map', 'when', { includes: 'skin' }, names)).toBe('Includes skin');
    expect(describeField('field_supply_map', 'when', { answered: true }, names)).toBe('Answered');
    expect(
      describeField('field_supply_map', 'lines', [{ itemId: SOCKS, qty: { fromPath: 'food.count' } }], names),
    ).toEqual(['Demo: Socks × the number in food.count']);
    expect(describeField('condition_supply_map', 'codes', ['L30.9', 'L03.116'], names)).toBe(
      'L30.9, L03.116',
    );
    expect(
      describeField('condition_supply_map', 'lines', [{ itemId: SOCKS, qtyPerPatient: 2 }], names),
    ).toEqual(['Demo: Socks × 2 per patient']);
    expect(describeField('bag', 'minimums', [{ itemId: SOCKS, min: 10 }], names)).toEqual([
      'Demo: Socks: at least 10',
    ]);
    expect(describeField('settings', 'bagMinimumsOn', true, names)).toBe('On');
  });
});
