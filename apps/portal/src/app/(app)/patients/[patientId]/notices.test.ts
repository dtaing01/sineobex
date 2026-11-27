import { describe, expect, it } from 'vitest';
import { pageNotices } from './notices';

// What a patient's page says after an act sends it back with ?corrected=, ?decided= or ?flag= (item
// 23): only the page's own notices, so a name every object inherits, such as constructor, says
// nothing, where it handed React a function.
describe('the notices a patient’s page reads from its address', () => {
  it('says what a correction, a decision or a flag change did', () => {
    expect(pageNotices({ corrected: 'legalName' }).corrected).toBe(
      'Legal name corrected. The old value, the new one and your reason are in the history.',
    );
    expect(pageNotices({ decided: 'alternate' }).decided).toBe(
      'Decided. The chart now shows the value you chose; the one it replaced stays in its history.',
    );
    expect(pageNotices({ flag: 'saved' }).flag).toBe('Flag saved. The history below shows the change.');
    expect(pageNotices({})).toEqual({ corrected: undefined, decided: undefined, flag: undefined });
  });

  it('says nothing for ?corrected= naming what an object inherits, or anything it doesn’t know', () => {
    for (const named of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'nope', ''])
      expect(pageNotices({ corrected: named }).corrected, named).toBeUndefined();
    expect(pageNotices({ corrected: ['legalName', 'birth'] }).corrected).toBeUndefined();
  });

  it('says nothing for ?decided= naming what an object inherits, or anything it doesn’t know', () => {
    for (const named of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'nope', ''])
      expect(pageNotices({ decided: named }).decided, named).toBeUndefined();
    expect(pageNotices({ decided: ['current'] }).decided).toBeUndefined();
  });

  it('says nothing for ?flag= naming what an object inherits, as before', () => {
    for (const named of ['constructor', 'toString', '__proto__'])
      expect(pageNotices({ flag: named }).flag, named).toBeUndefined();
  });
});
