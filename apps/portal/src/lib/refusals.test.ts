import { describe, expect, it } from 'vitest';
import { errorCode, refusalRedirect } from './refusals';
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
