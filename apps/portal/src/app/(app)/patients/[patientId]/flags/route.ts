import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/app/(app)/patients/chart';
import { changeFlag, flagAnswer, flagChangeRequest, type FlagAnswer } from '@/lib/flags';
import { sameOrigin } from '@/lib/same-origin';

const answer = (body: FlagAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Set or clear a flag, posted by the Flags panel (phase 5 design 7, 8.1): `{id, flagId, action,
 * reason}`. The page made the change's ID once for the form, and the panel keeps it for the form's
 * life, so this sends it as posted: a double press or a retry after a dropped answer gets the first
 * answer from the API, never a second change (D115). The API checks the flag, the reason and the
 * person's role and sight of the flag (D114), and writes and logs the change; this says what the
 * panel shows: done, or the refusal in its words, with the API's status.
 *
 * A route handler, not a server action, as phase 4's acts are (D115): an action re-renders the page
 * it is called from, and the form would be drawn again with a new ID, so a retry would be a second
 * change.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  if (!sameOrigin(request.headers))
    return answer({ ok: false, error: 'Reload the page and try again.' }, 403);
  const { patientId } = await params;
  if (!UUID.test(patientId)) return answer({ ok: false, error: 'This patient can’t be found.' }, 404);
  const sent = flagChangeRequest(await request.json().catch(() => null));
  if (!sent)
    return answer({ ok: false, error: 'Something about this request was wrong. Reload the page.' }, 422);
  const outcome = await changeFlag(patientId, sent);
  return answer(
    flagAnswer('change', patientId, outcome),
    'refused' in outcome ? outcome.refused.status : 200,
  );
}
