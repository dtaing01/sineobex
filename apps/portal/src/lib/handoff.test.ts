import { describe, expect, it } from 'vitest';
import { attachment, handoffRedirect, handoffState, TIME_ZONE } from './handoff';

// The EMS handoff's export from the visit page (lifecycle 5.7, 9.11).
const VISIT = '5eed2000-0000-4000-8000-000000000001';

describe('where an export the API refused sends the browser', () => {
  it('goes through /reauth when the API asks for a recent sign-in, and back to the visit', () => {
    const to = handoffRedirect(VISIT, 403, 'reauth_required');
    expect(to).toBe(`/reauth?next=${encodeURIComponent(`/encounters/${VISIT}?handoff=reauthed`)}`);
  });

  it('shows no_handoff and cannot_see_red_flags as states of the visit page', () => {
    expect(handoffRedirect(VISIT, 404, 'no_handoff')).toBe(`/encounters/${VISIT}?handoff=no_handoff`);
    expect(handoffRedirect(VISIT, 403, 'cannot_see_red_flags')).toBe(
      `/encounters/${VISIT}?handoff=cannot_see_red_flags`,
    );
    expect(handoffState('no_handoff')).toBe('no_handoff');
    expect(handoffState('cannot_see_red_flags')).toBe('cannot_see_red_flags');
  });

  it('sends a visit the team no longer has to its page, and anything else back with a failure', () => {
    expect(handoffRedirect(VISIT, 404, 'not_found')).toBe(`/encounters/${VISIT}`);
    expect(handoffRedirect(VISIT, 422, 'validation_failed')).toBe(`/encounters/${VISIT}?handoff=failed`);
    expect(handoffRedirect(VISIT, 500, 'error')).toBe(`/encounters/${VISIT}?handoff=failed`);
  });

  it('signs in again, or leaves a screen the role can’t use, as every page does', () => {
    expect(handoffRedirect(VISIT, 401, 'unauthorized')).toBe('/sign-in?ended=expired');
    expect(handoffRedirect(VISIT, 403, 'forbidden')).toBe('/home?denied=1');
  });

  it('shows only the states it knows', () => {
    expect(handoffState('reauthed')).toBe('reauthed');
    expect(handoffState('toString')).toBeNull();
    expect(handoffState('<b>')).toBeNull();
    expect(handoffState(['no_handoff'])).toBeNull();
  });
});

describe('the time zone the export sends', () => {
  it('takes a zone’s name and nothing else', () => {
    for (const zone of ['America/Detroit', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5', 'UTC'])
      expect(TIME_ZONE.test(zone)).toBe(true);
    for (const text of ['', 'Del Smith', 'America/Detroit?x=1', '../etc', 'a/b/c/d', 'America/Détroit'])
      expect(TIME_ZONE.test(text)).toBe(false);
  });
});

describe('the file', () => {
  it('keeps the name the API gives it', () => {
    expect(attachment('attachment; filename="ems-handoff.pdf"')).toBe(
      'attachment; filename="ems-handoff.pdf"',
    );
  });

  it('is always an attachment, never shown in the page', () => {
    expect(attachment(null)).toBe('attachment');
    expect(attachment('inline; filename="ems-handoff.pdf"')).toBe('attachment');
  });
});
