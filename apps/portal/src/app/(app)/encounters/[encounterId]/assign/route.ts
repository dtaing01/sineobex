import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/app/(app)/patients/chart';
import { api } from '@/lib/api';
import { assignAnswer, assignRequest } from '@/lib/assign';
import { errorCode } from '@/lib/refusals';
import { sameOrigin } from '@/lib/same-origin';

const answer = (body: { go: string } | { problem: string }, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Assign, posted by the visit page's form (lifecycle 5.5, 9.12): the API checks the key, asks for a
 * recent sign-in, checks the person chosen as its assignees route does, and writes and logs the
 * assignment; this says where the browser goes next. A route handler, not a server action, for the
 * reason SignActions gives: the visit is loaded again, whole, after the act.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  if (!sameOrigin(request.headers)) return answer({ problem: 'Reload the page and try again.' }, 403);
  const { encounterId } = await params;
  if (!UUID.test(encounterId)) return answer({ problem: 'This visit can’t be found.' }, 404);
  const input = assignRequest(await request.json().catch(() => null));
  if (!input)
    return answer({ problem: 'Something about this request was wrong. Load the visit again.' }, 422);

  const { error, response } = await (
    await api()
  ).POST('/v1/notes/{noteId}/assign', {
    params: { path: { noteId: input.noteId } },
    body: { toUserId: input.toUserId, reason: input.reason },
  });
  return answer(assignAnswer(encounterId, input.noteId, response.status, errorCode(error)));
}
