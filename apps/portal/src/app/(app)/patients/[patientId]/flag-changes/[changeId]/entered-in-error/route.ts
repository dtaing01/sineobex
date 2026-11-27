import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/app/(app)/patients/chart';
import { flagAnswer, flagMarkRequest, markFlagChange, type FlagAnswer } from '@/lib/flags';
import { sameOrigin } from '@/lib/same-origin';

const answer = (body: FlagAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Mark a flag change entered in error, posted by the Flags panel (phase 5 design 7, 8.1; section
 * 11, row 23): `{reason}`. The API checks that the change is the person's own or that they are a
 * Program Admin, and marks it once; a retry after a dropped answer finds the mark made (409
 * `already_marked`) and is answered done (lib/flags.ts), so a mark is never refused for having gone
 * through. A route handler, as Set or clear is (D115).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string; changeId: string }> },
) {
  if (!sameOrigin(request.headers))
    return answer({ ok: false, error: 'Reload the page and try again.' }, 403);
  const { patientId, changeId } = await params;
  if (!UUID.test(patientId) || !UUID.test(changeId))
    return answer({ ok: false, error: 'This change can’t be found. Reload the page.' }, 404);
  const sent = flagMarkRequest(await request.json().catch(() => null));
  if (!sent)
    return answer({ ok: false, error: 'Something about this request was wrong. Reload the page.' }, 422);
  const outcome = await markFlagChange(patientId, changeId, sent.reason);
  return answer(flagAnswer('mark', patientId, outcome), 'refused' in outcome ? outcome.refused.status : 200);
}
