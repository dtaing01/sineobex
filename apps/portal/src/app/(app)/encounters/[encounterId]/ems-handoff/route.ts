import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/app/(app)/patients/chart';
import { api } from '@/lib/api';
import { attachment, handoffRedirect, TIME_ZONE } from '@/lib/handoff';
import { errorCode } from '@/lib/refusals';
import { sameOrigin } from '@/lib/same-origin';

/**
 * Export EMS handoff (PDF), posted by the visit page's form (lifecycle 5.7, 9.11). The API checks
 * who may export it, asks for a recent sign-in, builds the file and logs the export; this hands the
 * file to the browser as an attachment, never cached, under the name the API gives it. When the
 * API gives no file, the browser goes through /reauth and back, or back to the visit page with the
 * state to show (no_handoff, cannot_see_red_flags). Only a POST from the portal's own page exports:
 * a link, a prefetch or another site can't.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const { encounterId } = await params;
  if (!UUID.test(encounterId)) return new NextResponse(null, { status: 404 });
  const zone = (await request.formData().catch(() => null))?.get('timeZone');
  const timeZone = typeof zone === 'string' && TIME_ZONE.test(zone) ? zone : undefined;

  const { data, error, response } = await (
    await api()
  ).GET('/v1/encounters/{encounterId}/ems-handoff', {
    params: { path: { encounterId }, ...(timeZone ? { query: { timeZone } } : {}) },
    parseAs: 'arrayBuffer',
  });
  if (response.ok && data) {
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachment(response.headers.get('content-disposition')),
        'Cache-Control': 'no-store',
      },
    });
  }
  // 303: the browser follows with a GET, as after any form.
  const to = handoffRedirect(encounterId, response.status, errorCode(error));
  return NextResponse.redirect(new URL(to, request.url), 303);
}
