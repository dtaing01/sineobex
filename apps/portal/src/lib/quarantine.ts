import type { Schemas } from '@sineobex/contract';
import { quarantineValue } from './labels';

type Item = Pick<Schemas['QuarantineItem'], 'hidden' | 'value' | 'status'>;

/**
 * What the review queue shows of a held change, and what a reviewer may decide on it (lifecycle
 * 6.4 rule 2, review finding RD-3). One the reviewer may not read (`hidden`) shows nothing of what
 * it holds and offers reject only: the API refuses their accept (403 `change_hidden`). A decided
 * one offers nothing.
 */
export function quarantineView(item: Item): { value: string | null; decisions: ('accept' | 'reject')[] } {
  const pending = item.status === 'pending';
  if (item.hidden) return { value: null, decisions: pending ? ['reject'] : [] };
  return { value: quarantineValue(item.value), decisions: pending ? ['accept', 'reject'] : [] };
}
