import { describe, expect, it } from 'vitest';
import {
  errorCode,
  flagRefusal,
  flagRefusalSentence,
  PRESET_SENTENCES,
  presetRefusalState,
  NAME_PROBLEM,
  REASON_PROBLEM,
  referencedSentence,
  refusalRedirect,
  TAKE_STALE,
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
    for (const act of ['save', 'remove', 'move'] as const)
      expect(refused('stale', { kind: 'flag', act }, { currentVersion: 3 }).error).toBe(stale);
    expect(refused('ids_mismatch', { kind: 'flag', act: 'move' }).error).toBe(stale);
  });

  it('says why a take is stale, from what changed since the review, and asks for no reload', () => {
    // The form sent the copy at version 3 and Sineobex's version 2; the page is read again after.
    const sent = { ...values, baseVersion: '3', platformVersion: '2' };
    const take = (details?: Record<string, unknown>) =>
      presetRefusalState(
        { code: 'stale', message: 'The API’s own words.', ...(details ? { details } : {}) },
        sent,
        { kind: 'item', act: 'take' },
      );
    // Sineobex offered a newer version meanwhile; nobody changed the copy.
    expect(take({ currentVersion: 3, platformVersion: 3 }).error).toBe(
      'Sineobex offered a newer version while you were reviewing this one. Review it below before you take it.',
    );
    // Another admin changed the copy, with or without a newer version on offer too.
    for (const platformVersion of [2, 3])
      expect(take({ currentVersion: 4, platformVersion }).error).toBe(
        'Someone else changed this while you were reviewing the update. Review it again below before you take it.',
      );
    // The copy changed and nothing is on offer now: another admin took the update.
    expect(take({ currentVersion: 4, platformVersion: null }).error).toBe(
      'Someone else changed this while you were reviewing the update, and there’s no update to take now.',
    );
    expect(Object.values(TAKE_STALE).some((s) => s.includes('Reload'))).toBe(false);
    // Details that say neither: 8.1's sentence.
    expect(take().error).toBe(PRESET_SENTENCES.stale);
    expect(take({ currentVersion: 3, platformVersion: 2 }).error).toBe(PRESET_SENTENCES.stale);
    expect(take({ currentVersion: 4, platformVersion: 2 }).values).toEqual(sent);
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

  it('says "that" when one thing uses a preset, and keeps 8.1’s "those" for more', () => {
    expect(referencedSentence({ bundle: 1 })).toBe('Still used by 1 bundle. Take it out of that first.');
    expect(referencedSentence({ settings: 1 })).toBe(
      'Still used by the template for new bags. Take it out of that first.',
    );
    expect(referencedSentence({ bundle: 2, field_supply_map: 1 })).toBe(
      'Still used by 2 bundles and 1 mapping. Take it out of those first.',
    );
    expect(referencedSentence({ bundle: 2 })).toBe('Still used by 2 bundles. Take it out of those first.');
    expect(referencedSentence({ bag: 1, settings: 1 })).toBe(
      'Still used by 1 bag and the template for new bags. Take it out of those first.',
    );
    expect(referencedSentence({ bundle: 1, item: 0 })).toBe(
      'Still used by 1 bundle. Take it out of that first.',
    );
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
      // A name says what every form's name asks.
      name: 'Name: Enter a name of 1 to 80 characters.',
      behaviour: 'Choose what it holds.',
      sort: 'Place in the list: Enter a whole number.',
      'lines.1.qty': 'Quantity on line 2: Enter 1 to 99.',
    });
  });

  it('says what a name asks, empty or too long, on every form, and keeps a rule’s own sentence', () => {
    const r = (code: string, sentences?: Record<string, string>) =>
      refused(
        'invalid',
        { kind: 'item', act: 'save', labels: { name: 'Name' }, ...(sentences ? { sentences } : {}) },
        { problems: [{ path: 'name', code }] },
      ).fieldErrors?.name;
    expect(NAME_PROBLEM).toBe('Enter a name of 1 to 80 characters.');
    for (const code of ['too_small', 'too_big', 'invalid_type'])
      expect(r(code)).toBe('Name: Enter a name of 1 to 80 characters.');
    expect(r('untrimmed')).toBe('Name: Take out the spaces at the start or end.');
    expect(r('too_small', { name: 'Demo: a form’s own words.' })).toBe('Name: Demo: a form’s own words.');
  });

  it('keeps a rule’s own sentence at a field that has a sentence of the form’s own', () => {
    const context: PresetRefusalContext = {
      kind: 'bundle',
      act: 'save',
      labels: { medical: 'Medical or Non-Medical', 'lines.*.itemId': 'Item' },
      sentences: { medical: 'Choose Medical or Non-Medical.', 'lines.*.itemId': 'Choose an item.' },
    };
    // Nothing chosen: the schema's own code, which the form's sentence says better.
    expect(
      refused('invalid', context, { problems: [{ path: 'medical', code: 'invalid_type' }] }).fieldErrors,
    ).toEqual({ medical: 'Medical or Non-Medical: Choose Medical or Non-Medical.' });
    // A rule's problem there says what to change, whatever the form's sentence for the field.
    expect(
      refused('invalid', context, {
        problems: [
          { path: 'medical', code: 'bundle_not_medical' },
          { path: 'lines.1.itemId', code: 'item_twice' },
          { path: 'lines.2.itemId', code: 'reference_archived' },
        ],
      }).fieldErrors,
    ).toEqual({
      medical: 'Medical or Non-Medical: This bundle holds a medication, so it must be Medical.',
      'lines.1.itemId': 'Item on line 2: This item is on the list twice.',
      'lines.2.itemId': 'Item on line 3: This was removed. Choose another, or restore it first.',
    });
  });

  it('names a list’s own entry by its place in the list, with its own sentence', () => {
    const r = refused(
      'invalid',
      {
        kind: 'item',
        act: 'save',
        labels: { 'result.options': 'Options', 'result.options.*': 'Option', 'result.unit': 'Unit' },
        sentences: { 'result.options.*': 'Enter 1 to 40 characters.' },
      },
      {
        problems: [
          { path: 'result.options', code: 'too_small' },
          { path: 'result.options.0', code: 'too_big' },
          { path: 'result.options.2', code: 'option_twice' },
          { path: 'result.unit', code: 'too_small' },
        ],
      },
    );
    expect(r.fieldErrors).toEqual({
      'result.options': 'Options: This is too short or too small.',
      'result.options.0': 'Option 1: Enter 1 to 40 characters.',
      'result.options.2': 'Option 3: This option is on the list twice.',
      'result.unit': 'Unit: This is too short or too small.',
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
    // Named in its line, under a title of its own: the summary never says one sentence twice.
    expect(r.error).toBe('Some fields need changing. Check each one below.');
    expect(r.fieldErrors).toEqual({ reason: `Reason: ${REASON_PROBLEM}` });
    // A form whose Reason box has its own words is named by them.
    expect(
      presetRefusalState(
        { code: 'validation_failed', message: '', details: { fields: [{ path: 'reason' }] } },
        values,
        { kind: 'flag', act: 'move', labels: { reason: 'Reason for moving' } },
      ).fieldErrors,
    ).toEqual({ reason: 'Reason for moving: Give a reason of 3 to 300 characters.' });
    // Anything else malformed is the page's to write, never the person's to fix.
    expect(
      refused('validation_failed', save('item'), { fields: [{ path: 'baseVersion', problem: 'x' }] }).error,
    ).toBe('Something in this form isn’t right. Reload the page and try again.');
  });

  it('names a name in use, by kind, and by what can be done about it', () => {
    const saved = refused('name_taken', save('item'));
    expect(saved.error).toBe('Some fields need changing. Check each one below.');
    expect(saved.fieldErrors).toEqual({ name: 'Name: Another item already has this name.' });
    expect(Object.values(saved.fieldErrors ?? {})).not.toContain(saved.error);
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

// The Flags panel's refusals (phase 5 design 7, 8.1; card P5-portal-panel), written ahead of their
// code: each in plain words, none the API's code, and each a sentence of its own.
describe('the Flags panel’s refusals', () => {
  const cases: [Parameters<typeof flagRefusalSentence>[0], number, string][] = [
    ['change', 422, 'unknown_flag'],
    ['change', 422, 'reason_invalid'],
    ['change', 409, 'archived'],
    ['change', 404, 'not_found'],
    ['change', 403, 'forbidden'],
    ['mark', 403, 'forbidden'],
    ['mark', 404, 'not_found'],
    ['mark', 422, 'validation_failed'],
  ];

  it('words each one plainly, as a sentence, never with the API’s code', () => {
    for (const [act, status, code] of cases) {
      const sentence = flagRefusalSentence(act, status, code);
      expect(sentence, `${act} ${code}`).toMatch(/^[A-Z].*\.$/);
      // Neither the code nor the status: a reason's bounds (1 to 500, 3 to 300) are words the person needs.
      expect(sentence).not.toMatch(/[_{}<>]/);
      expect(sentence).not.toContain(String(status));
    }
    expect(
      new Set(cases.map(([act, status, code]) => flagRefusalSentence(act, status, code))).size,
    ).toBeGreaterThan(5);
  });

  it('says a removed flag can only be cleared, and the reason’s bounds for each act', () => {
    expect(flagRefusalSentence('change', 409, 'archived')).toContain('clear');
    expect(flagRefusalSentence('change', 422, 'reason_invalid')).toContain('500');
    expect(flagRefusalSentence('mark', 422, 'validation_failed')).toContain('3 to 300');
  });
});

// Each refusal beside the field it is about (card P5-portal-panel).
describe('the Flags panel’s refusals, by field', () => {
  it('puts a flag’s refusals beside the flag, and a reason’s beside the reason', () => {
    for (const code of ['unknown_flag', 'archived', 'flag_hidden'])
      expect(flagRefusal('change', code === 'flag_hidden' ? 403 : 409, code).field, code).toBe('flagId');
    expect(flagRefusal('change', 422, 'reason_invalid')).toEqual({
      error: 'Give a reason of 1 to 500 characters.',
      field: 'reason',
    });
    expect(
      flagRefusal('change', 422, 'validation_failed', { fields: [{ path: 'reason', problem: 'custom' }] }),
    ).toEqual({ error: 'Give a reason of 1 to 500 characters.', field: 'reason' });
    expect(flagRefusal('mark', 422, 'validation_failed', { fields: [{ path: 'reason' }] })).toEqual({
      error: 'Give a reason of 3 to 300 characters.',
      field: 'reason',
    });
    // About the act, not a field: said above the form.
    for (const [act, status, code] of [
      ['change', 404, 'not_found'],
      ['change', 403, 'forbidden'],
      ['change', 409, 'id_taken'],
      ['mark', 404, 'not_found'],
      ['mark', 403, 'forbidden'],
    ] as const)
      expect(flagRefusal(act, status, code).field, `${act} ${code}`).toBeUndefined();
  });
});
