import { refusalRedirect } from './refusals';

/**
 * The EMS handoff's export from the visit page (phase 4 design, lifecycle 5.7, 9.11): what the
 * route handler sends the API, and where it sends the browser when the API gives no file.
 */

/**
 * The shape of an IANA time zone's name, as the API takes it (TIME_ZONE_PATTERN, handoff.ts): the
 * one query string the export carries, so it carries nothing else. A name of another shape is not
 * sent, and the file's times are printed in UTC, labelled UTC.
 */
export const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]{0,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;

/** What the visit page says when it comes back from an export (`?handoff=`): a state, not an error. */
export const HANDOFF_STATES = {
  reauthed: { tone: 'ok', text: 'You confirmed it’s you. Export the handoff again.' },
  // The API's own sentences.
  no_handoff: { tone: 'info', text: 'This visit has no EMS handoff: EMS was not activated in it.' },
  cannot_see_red_flags: {
    tone: 'info',
    text: 'Only someone who may read the visit’s Red flags note may export its handoff.',
  },
  failed: { tone: 'error', text: 'The handoff couldn’t be exported. Try again.' },
} as const;

export type HandoffState = keyof typeof HANDOFF_STATES;

export function handoffState(value: unknown): HandoffState | null {
  return typeof value === 'string' && Object.hasOwn(HANDOFF_STATES, value) ? (value as HandoffState) : null;
}

/**
 * Where the browser goes when the API gives no file: through /reauth and back to the visit when it
 * asks for a recent sign-in, to sign-in and the like as every page goes, else back to the visit
 * with the state to show. A visit the team no longer has goes back to its page, which says so.
 */
export function handoffRedirect(encounterId: string, status: number, code: string): string {
  const visit = `/encounters/${encounterId}`;
  const to = refusalRedirect(code, `${visit}?handoff=reauthed`);
  if (to) return to;
  if (code === 'no_handoff' || code === 'cannot_see_red_flags') return `${visit}?handoff=${code}`;
  if (status === 404) return visit;
  return `${visit}?handoff=failed`;
}

/** The file keeps the name the API gives it (`ems-handoff.pdf`, the same for every visit). */
export function attachment(disposition: string | null): string {
  return disposition && /^attachment\b/i.test(disposition) ? disposition : 'attachment';
}
