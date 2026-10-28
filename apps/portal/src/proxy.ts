import { getIronSession, nextProxyCookies } from 'iron-session';
import { NextResponse, type NextRequest } from 'next/server';
import { authProvider } from '@/lib/auth';
import { idleState, REFRESH_MARGIN_MS, sessionOptions, type SessionData } from '@/lib/session';

// Pages anyone may load. Everything else needs a session that has passed MFA. /c is where a Street
// Medicine ID card's QR code leads, so anyone who finds a card may open it; it shows no team and
// no patient data, and the card's token stays in the fragment, which never reaches this server.
const PUBLIC_PATHS = new Set(['/sign-in', '/sign-in/mfa', '/sign-in/mfa/enroll', '/c']);

function securityHeaders(response: NextResponse, csp: string, isDev: boolean) {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (!isDev)
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return response;
}

/**
 * Per-request CSP nonce, security headers, and the session gate: idle sign-out after 15 minutes
 * (module 9), token refresh, and redirects for anyone not fully signed in. Pages render per
 * request and every response is no-store, so patient data never lands in a browser or proxy cache.
 */
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const path = request.nextUrl.pathname;

  if (PUBLIC_PATHS.has(path)) return securityHeaders(response, csp, isDev);

  const redirect = (to: string) =>
    securityHeaders(NextResponse.redirect(new URL(to, request.url)), csp, isDev);
  const session = await getIronSession<SessionData>(nextProxyCookies(request, response), sessionOptions());
  const now = Date.now();

  if (!session.tokens) return redirect(session.pending ? '/sign-in/mfa' : '/sign-in');
  const state = idleState(session, now);
  if (state !== 'active') {
    session.destroy();
    const out = redirect(`/sign-in?ended=${state}`);
    out.cookies.delete(sessionOptions().cookieName);
    return out;
  }

  if (session.tokens.expiresAt - now < REFRESH_MARGIN_MS) {
    try {
      session.tokens = await authProvider().refresh(session.tokens.refreshToken);
    } catch {
      session.destroy();
      const out = redirect('/sign-in?ended=expired');
      out.cookies.delete(sessionOptions().cookieName);
      return out;
    }
  }
  session.lastActivity = now;
  await session.save();
  return securityHeaders(response, csp, isDev);
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|fonts/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
