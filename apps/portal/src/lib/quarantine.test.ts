import { describe, expect, it } from 'vitest';
import { quarantineView } from './quarantine';

// What the review queue shows of a held change, and what a reviewer may decide on it (lifecycle
// 6.4 rule 2, review finding RD-3). Every value is made up.
describe('a held change on the queue page', () => {
  const item = {
    hidden: undefined,
    value: { text: 'Demo: came back for socks' },
    status: 'pending' as const,
  };

  it('shows its value, and offers accept and reject, to a reviewer who may read it', () => {
    expect(quarantineView(item)).toEqual({
      value: JSON.stringify(item.value, null, 2),
      decisions: ['accept', 'reject'],
    });
  });

  it('shows nothing of it, and offers reject only, to a reviewer who may not read it', () => {
    expect(quarantineView({ ...item, hidden: true, value: null })).toEqual({
      value: null,
      decisions: ['reject'],
    });
    // Even were a value sent with the mark, none is shown.
    expect(quarantineView({ ...item, hidden: true }).value).toBeNull();
  });

  it('offers nothing once it is decided', () => {
    expect(quarantineView({ ...item, status: 'accepted' }).decisions).toEqual([]);
    expect(quarantineView({ ...item, hidden: true, status: 'rejected' }).decisions).toEqual([]);
  });
});
