/**
 * Whether a POST to a route handler came from one of the portal's own pages. A server action gets
 * a check like this from Next; a route handler, which a form or a fetch posts to, makes it here, so
 * another site can't make a signed-in browser export a file or read a chart in its name (the
 * session cookie being SameSite=Lax is the first line).
 *
 * A browser says where a request comes from in `Sec-Fetch-Site`, whatever the page's referrer
 * policy. Without it, the `Origin` must name this host, but for `null`: the portal's pages send no
 * referrer (Referrer-Policy: no-referrer), and a browser then sends `Origin: null` with a form's
 * POST, as Next lets a server action through with it.
 */
export function sameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = headers.get('origin');
  if (origin === null || origin === 'null') return true;
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0]!.trim();
  try {
    return host !== '' && new URL(origin).host === host;
  } catch {
    return false;
  }
}
