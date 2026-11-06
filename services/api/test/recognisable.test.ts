import { describe, expect, it } from 'vitest';
import {
  isRecognisable,
  isRecognisableField,
  RECOGNISABLE_FIELDS,
  recognisableAfter,
  recognisableCreate,
} from '../src/patients/recognisable.ts';

// Someone must stay recognisable: a name or what they look like (phase 3 design 2.3, D42).

const rec = (values: Record<string, unknown>) => ({ values });

describe('recognisable', () => {
  it('names the three synced fields that hold the four columns', () => {
    expect(RECOGNISABLE_FIELDS).toEqual(['preferredName', 'legalName', 'visualDescriptor']);
    expect(isRecognisableField('usualArea')).toBe(false);
    expect(isRecognisableField('legalName')).toBe(true);
  });

  it('counts a preferred name, either legal name part, or a description', () => {
    expect(isRecognisable({ preferredName: 'Del' })).toBe(true);
    expect(isRecognisable({ legalName: { given: null, family: 'Okoye' } })).toBe(true);
    expect(isRecognisable({ legalName: { given: 'Rae', family: null } })).toBe(true);
    expect(isRecognisable({ visualDescriptor: 'Demo: man in blue wheelchair' })).toBe(true);
    expect(isRecognisable({})).toBe(false);
    expect(
      isRecognisable({ preferredName: null, legalName: { given: null, family: null }, visualDescriptor: '' }),
    ).toBe(false);
    // Only what identifies someone counts.
    expect(isRecognisable({ usualArea: 'Demo: by the library steps' })).toBe(false);
  });

  it('refuses to clear the last of them, whichever it is', () => {
    const both = rec({ preferredName: 'Sunny', visualDescriptor: 'Demo: red scarf', legalName: null });
    expect(recognisableAfter(both, 'visualDescriptor', null)).toBe(true);
    expect(recognisableAfter(both, 'preferredName', null)).toBe(true);
    // Two phones each clear one: the second write would leave nothing.
    const afterFirst = rec({ preferredName: 'Sunny', visualDescriptor: null, legalName: null });
    expect(recognisableAfter(afterFirst, 'preferredName', null)).toBe(false);
    expect(recognisableAfter(afterFirst, 'preferredName', 'Sun')).toBe(true);
    const legalOnly = rec({
      preferredName: null,
      visualDescriptor: null,
      legalName: { given: 'Rae', family: 'Okoye' },
    });
    expect(recognisableAfter(legalOnly, 'legalName', { given: null, family: 'Okoye' })).toBe(true);
    expect(recognisableAfter(legalOnly, 'legalName', null)).toBe(false);
  });

  it('lets any other field change on a recognisable record', () => {
    const r = rec({ preferredName: 'Del' });
    expect(recognisableAfter(r, 'usualArea', null)).toBe(true);
    expect(recognisableAfter(rec({}), 'usualArea', 'Demo: Elm St')).toBe(false);
  });

  it('needs an intake to bring a name or a description', () => {
    expect(recognisableCreate({ preferredName: 'Del' })).toBe(true);
    expect(recognisableCreate({ visualDescriptor: 'Demo: tall, grey beard' })).toBe(true);
    expect(recognisableCreate({ legalName: { given: null, family: 'Okoye' } })).toBe(true);
    expect(recognisableCreate({})).toBe(false);
    expect(recognisableCreate({ preferredName: null, legalName: null, visualDescriptor: null })).toBe(false);
  });
});
