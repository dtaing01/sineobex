import { NextResponse, type NextRequest } from 'next/server';
import { UUID } from '@/app/(app)/patients/chart';
import { api } from '@/lib/api';
import { errorCode } from '@/lib/refusals';
import { sameOrigin } from '@/lib/same-origin';
import { SIGN_ACTS, signAnswer, signRequest, type SignAnswer } from '@/lib/sign';

const answer = (body: SignAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Co-sign or Attest, posted by the visit page (lifecycle 5.3, 5.4, 9.11) with the notes and hashes
 * of the read the person first saw. The API checks the role, the credential, each note's state and
 * each hash, writes and logs the act; this sends exactly the plan it was given, with the version of
 * the sentence the page shows, and says where the browser goes next.
 *
 * A route handler, not a server action: an action refreshes the page it is called from, so the
 * visit would be read, and logged, again for a render the browser throws away when it loads the
 * visit again after the act.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  if (!sameOrigin(request.headers)) return answer({ problem: 'Reload the page and try again.' }, 403);
  const { encounterId } = await params;
  if (!UUID.test(encounterId)) return answer({ problem: 'This visit can’t be found.' }, 404);
  const plan = signRequest(await request.json().catch(() => null));
  if (!plan) return answer({ problem: 'Something about this request was wrong. Load the visit again.' }, 422);

  const client = await api();
  const options = {
    params: { path: { encounterId } },
    body: { notes: plan.notes, statementVersion: SIGN_ACTS[plan.act].statementVersion },
  };
  const { error, response } =
    plan.act === 'cosign'
      ? await client.POST('/v1/encounters/{encounterId}/cosign', options)
      : await client.POST('/v1/encounters/{encounterId}/attest', options);
  return answer(signAnswer(encounterId, plan.act, response.status, errorCode(error)));
}
