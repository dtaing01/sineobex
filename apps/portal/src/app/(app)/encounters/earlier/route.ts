import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/app/(app)/patients/chart';
import { api } from '@/lib/api';
import { TIMELINE_PAGE, visitRow, type EarlierAnswer } from '@/lib/encounters';
import { errorCode, refusalRedirect } from '@/lib/refusals';
import { sameOrigin } from '@/lib/same-origin';

const answer = (body: EarlierAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Show earlier visits, on the patient page's timeline (lifecycle 5.2, 9.11): the group's next 50
 * visits after the one named, from the API's timeline route, which checks patients.view and logs
 * the read (`chart.timeline_viewed`). Posted by the timeline with the IDs in the body. A route
 * handler, not a server action: an action refreshes the page it is called from, so the chart would
 * be read, and logged, again with each page of visits.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return answer({ problem: 'Reload the page and try again.' }, 403);
  const body = (await request.json().catch(() => null)) as { patientId?: unknown; before?: unknown } | null;
  const patientId = typeof body?.patientId === 'string' ? body.patientId : '';
  const before = typeof body?.before === 'string' ? body.before : '';
  if (!UUID.test(patientId) || !UUID.test(before))
    return answer({ problem: 'Reload the page and try again.' }, 422);

  const { data, error, response } = await (
    await api()
  ).GET('/v1/patients/{patientId}/timeline', { params: { path: { patientId }, query: { before } } });
  if (response.ok && data) {
    return answer({ visits: data.encounters.map(visitRow), more: data.encounters.length === TIMELINE_PAGE });
  }
  const go = refusalRedirect(errorCode(error), `/patients/${patientId}`);
  if (go) return answer({ go });
  return answer({
    problem:
      response.status === 404
        ? 'The visits changed since this page was opened. Reload the page to see them.'
        : 'Earlier visits couldn’t be loaded. Try again.',
  });
}
