import 'server-only';
import { createApiClient, type ApiClient } from '@sineobex/contract';
import { getIronSession } from 'iron-session';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiBaseUrl } from './env';
import { sessionOptions, type SessionData } from './session';

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** An error the API returned that a page or form should show. Messages are written by the API, never PHI. */
export class PortalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PortalApiError';
  }
}

export async function api(options: { team?: boolean } = {}): Promise<ApiClient> {
  const session = await getSession();
  if (!session.tokens) redirect('/sign-in');
  if (options.team !== false && !session.teamId) redirect('/select-team');
  return createApiClient({
    baseUrl: apiBaseUrl(),
    token: session.tokens.accessToken,
    ...(options.team !== false && session.teamId ? { teamId: session.teamId } : {}),
    fetch: (request: Request) => fetch(request, { cache: 'no-store' }),
  });
}

/** Only same-site relative paths, so a crafted `next` can't send someone to another site. */
export function safeNext(next: string | null | undefined, fallback = '/home'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/**
 * Unwraps an API call. Refusals that mean "you need to do something first" become redirects to
 * the screen that does it; everything else becomes a PortalApiError for the page to show.
 */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok) return data as T;
  const body = (
    error as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined
  )?.error;
  const code = body?.code ?? 'error';
  switch (code) {
    case 'unauthorized':
      return redirect('/sign-in?ended=expired');
    case 'mfa_required':
      return redirect('/sign-in/mfa');
    case 'acknowledgement_required':
      return redirect('/acknowledge');
    case 'team_required':
    case 'not_a_member':
    case 'team_suspended':
      return redirect(`/select-team?problem=${code}`);
    case 'forbidden':
      // A typed URL to a screen the role can't use. The API has already logged the refusal.
      return redirect('/home?denied=1');
    case 'reauth_required': {
      const path = (await headers()).get('x-pathname');
      return redirect(`/reauth?next=${encodeURIComponent(safeNext(path))}`);
    }
  }
  throw new PortalApiError(
    response.status,
    code,
    body?.message ?? 'Something went wrong. Try again.',
    body?.details,
  );
}
