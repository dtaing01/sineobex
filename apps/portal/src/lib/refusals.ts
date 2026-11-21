/**
 * Where an API refusal that means "do something first" sends the person: sign in again, pass MFA,
 * acknowledge, choose a team, or confirm it's them (/reauth, then back to `next`, a same-site path).
 * Null for a refusal the page shows itself. One table for unwrap (api.ts) and for the route
 * handlers, which answer a form or a fetch and so can't redirect the way a page does.
 */
export function refusalRedirect(code: string, next: string): string | null {
  switch (code) {
    case 'unauthorized':
      return '/sign-in?ended=expired';
    case 'mfa_required':
      return '/sign-in/mfa';
    case 'acknowledgement_required':
      return '/acknowledge';
    case 'team_required':
    case 'not_a_member':
    case 'team_suspended':
      return `/select-team?problem=${code}`;
    case 'forbidden':
      // A typed URL to a screen the role can't use. The API has already logged the refusal.
      return '/home?denied=1';
    case 'reauth_required':
      return `/reauth?next=${encodeURIComponent(next)}`;
    default:
      return null;
  }
}

/** The code of an API error body (`{ error: { code } }`), or 'error' when it has none. */
export function errorCode(error: unknown): string {
  const code = (error as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === 'string' ? code : 'error';
}
