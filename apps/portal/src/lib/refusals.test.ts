import { describe, expect, it } from 'vitest';
import {
  errorCode,
  PRESET_SENTENCES,
  presetRefusalState,
  REASON_PROBLEM,
  referencedSentence,
  refusalRedirect,
  usedBy,
  type PresetRefusalContext,
} from './refusals';
import { sameOrigin } from './same-origin';

// What every page and route handler does with an API refusal that asks for something first, and
// the check that a POST to a route handler comes from the portal's own pages.

describe('the refusals every page shares', () => {
  it('sends each "do something first" to the screen that does it', () => {
    expect(refusalRedirect('mfa_required', '/x')).toBe('/sign-in/mfa');
    expect(refusalRedirect('acknowledgement_required', '/x')).toBe('/acknowledge');
    expect(refusalRedirect('not_a_member', '/x')).toBe('/select-team?problem=not_a_member');
    expect(refusalRedirect('reauth_required', '/patients/a?b=c')).toBe(
      '/reauth?next=%2Fpatients%2Fa%3Fb%3Dc',
    );
    expect(refusalRedirect('content_changed', '/x')).toBeNull();
  });

  it('reads the code of an API error, or none', () => {
    expect(errorCode({ error: { code: 'no_handoff', message: 'm' } })).toBe('no_handoff');
    expect(errorCode('<html>')).toBe('error');
    expect(errorCode(undefined)).toBe('error');
  });
});

describe('a POST to a route handler', () => {
  const from = (origin: string | null, host = 'portal.example.org', extra: Record<string, string> = {}) =>
    sameOrigin(new Headers({ host, ...(origin === null ? {} : { origin }), ...extra }));

  it('is taken from the portal’s own pages', () => {
    expect(from('https://portal.example.org')).toBe(true);
    expect(
      from('https://portal.example.org', 'internal:3100', { 'x-forwarded-host': 'portal.example.org' }),
    ).toBe(true);
    // The portal's pages send no referrer, so a browser names their origin as null.
    expect(from('null')).toBe(true);
    expect(from(null)).toBe(true);
    expect(from('null', 'portal.example.org', { 'sec-fetch-site': 'same-origin' })).toBe(true);
  });

  it('is refused from another site', () => {
    expect(from('https://elsewhere.example.com')).toBe(false);
    expect(from('https://portal.example.org.elsewhere.example.com')).toBe(false);
    expect(from('https://portal.example.org', '')).toBe(false);
    // What the browser says of where the request comes from wins over an origin it hides.
    expect(from('null', 'portal.example.org', { 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(from(null, 'portal.example.org', { 'sec-fetch-site': 'same-site' })).toBe(false);
  });
});

// The preset pages' refusals (phase 5 design 7, 8.1): every code the admin preset routes answer
// (services/api/src/presets/store.ts, routes/presets-admin.ts) has its sentence, 8.1's word for word
// where 8.1 gives one. Every value is made up.
describe('a preset form the API refused', () => {
  const values = { reason: 'Demo: a reason', name: 'Demo: Rain poncho' };
  const refused = (
    code: string,
    context: PresetRefusalContext,
    details?: Record<string, unknown>,
    message = 'The API’s own words.',
  ) => presetRefusalState({ code, message, ...(details ? { details } : {}) }, values, context);
  const save = (kind: string, labels?: Record<string, string>): PresetRefusalContext => ({
    kind,
    act: 'save',
    ...(labels ? { labels } : {}),
  });

  it('keeps what was sent, whatever it says', () => {
    expect(refused('stale', save('item')).values).toEqual(values);
    expect(refused('no_change', save('item')).values).toEqual(values);
  });

  it('says a stale version, or a flag list changed since, in 8.1’s words', () => {
    const stale = 'Someone else changed this while you were editing. Reload to see their version.';
    expect(PRESET_SENTENCES.stale).toBe(stale);
    for (const act of ['save', 'remove', 'take', 'move'] as const)
      expect(refused('stale', { kind: 'flag', act }, { currentVersion: 3 }).error).toBe(stale);
    expect(refused('ids_mismatch', { kind: 'flag', act: 'move' }).error).toBe(stale);
  });

  it('counts what still uses a preset, by kind, in the order the pages list kinds', () => {
    expect(
      refused(
        'referenced',
        { kind: 'item', act: 'remove' },
        { referencedBy: { field_supply_map: 1, bundle: 2 } },
      ).error,
    ).toBe('Still used by 2 bundles and 1 mapping. Take it out of those first.');
    expect(usedBy({ item: 1 })).toBe('1 item');
    expect(usedBy({ bag: 2, condition_supply_map: 1, bundle: 1 })).toBe(
      '1 bundle, 1 condition mapping and 2 bags',
    );
    expect(usedBy({ settings: 1, bag: 1 })).toBe('1 bag and the template for new bags');
    expect(usedBy({ billing_code_map: 1 })).toBe('1 other preset');
    expect(referencedSentence(undefined)).toBe('Still used. Take it out of those first.');
  });

  it('tells an item’s save from a bundle’s, and a bundle’s save from its restore, on bundle_not_medical', () => {
    // An item moved into a medication category under Non-Medical bundles: 409, with their count.
    expect(refused('bundle_not_medical', save('item'), { bundles: 2 }).error).toBe(
      'Non-Medical bundles hold this item, and a bundle that holds a medication must be Medical. Make them Medical first.',
    );
    // A bundle saved Non-Medical holding one: 422 invalid, at its tag.
    const bundle = refused('invalid', save('bundle', { medical: 'Medical or Non-Medical' }), {
      problems: [{ path: 'medical', code: 'bundle_not_medical' }],
    });
    expect(bundle.error).toBe('This bundle holds a medication, so it must be Medical.');
    expect(bundle.fieldErrors).toEqual({
      medical: 'Medical or Non-Medical: This bundle holds a medication, so it must be Medical.',
    });
    // A bundle restored while an item it holds is a medication: 422 invalid, and no field to fix.
    const restored = refused(
      'invalid',
      { kind: 'bundle', act: 'restore' },
      { problems: [{ path: 'medical', code: 'bundle_not_medical' }] },
    );
    expect(restored.error).toBe(
      'This bundle now holds a medication, so it must be Medical. Add a Medical bundle instead.',
    );
    expect(restored.fieldErrors).toBeUndefined();
  });

  it('offers an update that changes a fixed field only as a new one, in 8.1’s words', () => {
    expect(refused('fixed_field', { kind: 'flag', act: 'take' }, { fields: ['tier'] }).error).toBe(
      'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
    );
    // An edit that changes one names each field beside it.
    const edit = refused('fixed_field', save('item', { unit: 'Counted in' }), {
      fields: ['unit', 'result.type'],
    });
    expect(edit.error).toBe('Some of this can’t be changed once it’s made. Add a new one instead.');
    expect(edit.fieldErrors).toEqual({
      unit: 'Counted in: This can’t be changed later.',
      'result.type': 'This can’t be changed later.',
    });
  });

  it('says what a supply map may not fire on, in 8.1’s words', () => {
    const r = refused('invalid', save('field_supply_map', { path: 'Field' }), {
      problems: [{ path: 'path', code: 'sensitive_path' }],
    });
    expect(r.error).toBe('Only some people may read this answer, so it can’t suggest supplies.');
    expect(r.fieldErrors).toEqual({
      path: 'Field: Only some people may read this answer, so it can’t suggest supplies.',
    });
  });

  it('puts each problem the API found beside its field, a line’s on its line', () => {
    const r = refused(
      'invalid',
      save('bundle', { name: 'Name', 'lines.*.itemId': 'Item', 'lines.*.qty': 'Quantity', lines: 'Items' }),
      {
        problems: [
          { path: 'name', code: 'untrimmed' },
          { path: 'lines.0.qty', code: 'too_small' },
          { path: 'lines.2.itemId', code: 'item_twice' },
          { path: 'lines.1.itemId', code: 'invalid_format' },
          { path: 'prompt', code: 'too_big' },
        ],
      },
    );
    expect(r.error).toBe('Some fields need changing. Check each one below.');
    expect(r.fieldErrors).toEqual({
      name: 'Name: Take out the spaces at the start or end.',
      'lines.0.qty': 'Quantity on line 1: This is too short or too small.',
      'lines.2.itemId': 'Item on line 3: This item is on the list twice.',
      'lines.1.itemId': 'Item on line 2: Choose one from the list.',
      prompt: 'This is too long or too big.',
    });
  });

  it('says a form’s own sentence for a field where every problem asks one thing, a line’s too', () => {
    const r = refused(
      'invalid',
      {
        kind: 'order_category',
        act: 'save',
        labels: { name: 'Name', sort: 'Place in the list', 'lines.*.qty': 'Quantity' },
        sentences: {
          behaviour: 'Choose what it holds.',
          sort: 'Enter a whole number.',
          'lines.*.qty': 'Enter 1 to 99.',
        },
      },
      {
        problems: [
          { path: 'name', code: 'too_small' },
          { path: 'behaviour', code: 'invalid_value' },
          { path: 'sort', code: 'too_big' },
          { path: 'lines.1.qty', code: 'invalid_type' },
        ],
      },
    );
    expect(r.fieldErrors).toEqual({
      // A field with no sentence of the form's own says the code's.
      name: 'Name: This is too short or too small.',
      behaviour: 'Choose what it holds.',
      sort: 'Place in the list: Enter a whole number.',
      'lines.1.qty': 'Quantity on line 2: Enter 1 to 99.',
    });
  });

  it('says a problem with the whole body as the summary', () => {
    expect(refused('invalid', save('bundle'), { problems: [{ path: '', code: 'too_large' }] }).error).toBe(
      'This is too long to save. Make it shorter.',
    );
    expect(
      refused('invalid', save('settings'), { problems: [{ path: '', code: 'settings_taken' }] }).error,
    ).toBe('Your team has its settings already.');
  });

  it('says a refused reason beside the Reason box', () => {
    const r = refused('validation_failed', save('item'), {
      fields: [{ path: 'reason', problem: 'too_small' }],
    });
    expect(r.error).toBe(REASON_PROBLEM);
    expect(r.fieldErrors).toEqual({ reason: 'Give a reason of 3 to 300 characters.' });
    // Anything else malformed is the page's to write, never the person's to fix.
    expect(
      refused('validation_failed', save('item'), { fields: [{ path: 'baseVersion', problem: 'x' }] }).error,
    ).toBe('Something in this form isn’t right. Reload the page and try again.');
  });

  it('names a name in use, by kind, and by what can be done about it', () => {
    const saved = refused('name_taken', save('item'));
    expect(saved.error).toBe('Another item already has this name.');
    expect(saved.fieldErrors).toEqual({ name: 'Another item already has this name.' });
    expect(refused('name_taken', { kind: 'condition_supply_map', act: 'restore' }).error).toBe(
      'Another condition mapping has this name now. Rename that one first.',
    );
    expect(refused('name_taken', { kind: 'flag', act: 'take' }).error).toBe(
      'Another flag has the name this update gives it. Rename that one first.',
    );
  });

  it('says a removed preset named, by act', () => {
    const saved = refused('reference_archived', save('bundle', { 'lines.*.itemId': 'Item' }), {
      problems: [{ path: 'lines.0.itemId', code: 'reference_archived' }],
    });
    expect(saved.error).toBe(
      'It names something that was removed. Choose another, or restore that one first.',
    );
    expect(saved.fieldErrors).toEqual({
      'lines.0.itemId': 'Item on line 1: This was removed. Choose another, or restore it first.',
    });
    expect(refused('reference_archived', { kind: 'bundle', act: 'restore' }).error).toBe(
      'It names something that was removed since. Restore that first.',
    );
    expect(refused('reference_archived', { kind: 'bundle', act: 'take' }).error).toBe(
      'This update names something your team removed. Restore that first.',
    );
  });

  it('has a sentence for every other refusal the preset routes answer', () => {
    const say = (code: string, act: PresetRefusalContext['act'] = 'save', kind = 'item') =>
      refused(code, { kind, act }).error;
    expect(say('no_change')).toBe('You haven’t changed anything.');
    expect(say('archived')).toBe('This was removed. Restore it first.');
    expect(say('archived', 'remove')).toBe('This was removed already.');
    expect(say('not_archived', 'restore')).toBe('This is on the list already.');
    expect(say('not_removable', 'remove', 'settings')).toBe('The team’s settings can’t be removed.');
    expect(say('no_update', 'take')).toBe('There’s no update to take now.');
    expect(say('not_found', 'remove')).toBe(
      'This isn’t on your team’s list. Reload the page to see the list as it is now.',
    );
    expect(say('invalid', 'take')).toBe(
      'This update doesn’t fit your team’s other presets, so it can’t be taken as it is.',
    );
    // A code the routes do not answer today shows the API's own words.
    expect(say('something_new')).toBe('The API’s own words.');
  });
});
