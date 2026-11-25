import { NextResponse, type NextRequest } from 'next/server';
import { publishNoteType } from '@/lib/presets';
import { sameOrigin } from '@/lib/same-origin';
import { publishAnswer, publishRequest, type PublishAnswer } from './answer';

const answer = (body: PublishAnswer, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** A note type's key, as 0017 allows it: what the address may name, never a title. */
const KEY = /^[a-z][a-z0-9_]{1,60}$/;

/**
 * Publish, posted by the note type editor (phase 5 design 5.4, 8.1) with the version it opened,
 * the operations it held, in the order they were made, and the reason. The API applies them, checks
 * the result and stores the next version, or refuses one operation by its index; this sends exactly
 * what the editor held and says what it shows next.
 *
 * A route handler, not a server action (D115): an action re-renders the page it is called from, and
 * the editor would lose the operations it holds. The version the editor opened is kept for the life
 * of its form, so a retry after a dropped connection is never a second version: the API refuses a
 * second publish from the same version as stale (design 7).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  if (!sameOrigin(request.headers))
    return answer({ ok: false, error: 'Reload the page and try again.' }, 403);
  const { key } = await params;
  if (!KEY.test(key)) return answer({ ok: false, error: 'This note type can’t be found.' }, 404);
  const sent = publishRequest(await request.json().catch(() => null));
  if (!sent)
    return answer({ ok: false, error: 'Something about this request was wrong. Reload the page.' }, 422);
  return answer(publishAnswer(key, await publishNoteType(key, sent)));
}
