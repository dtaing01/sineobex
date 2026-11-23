import type { NoteTypeEdit } from '@/lib/presets';

/**
 * What the editor's Publish posts and is told (phase 5 design 8.1; D115): a route handler, since the
 * editor holds the operations not yet sent, which a page's re-render would lose. `publishRequest`
 * reads what the editor posted, or null for anything it never posts; `publishAnswer` says what the
 * editor shows once the API has answered: the published version ("Version 4 is live. Notes
 * already started stay on the version they began on."), or the refusal's sentence, by operation
 * where the API names one, or where the browser goes (a stale sign-in, to /reauth and back).
 *
 * Written ahead of its code (card P4-tests): both throw until card P4-editor builds them, as
 * answer.test.ts holds.
 */

export type PublishRequest = { baseVersion: number; ops: NoteTypeEdit[]; reason: string };

export type PublishAnswer =
  | { ok: true; version: number; alsoPublished: string[]; message: string }
  | { ok: false; error: string; opIndex?: number; fieldErrors?: Record<string, string> }
  | { ok: false; redirect: string };

export function publishRequest(body: unknown): PublishRequest | null {
  void body;
  throw new Error('P4-editor');
}

export function publishAnswer(
  key: string,
  outcome:
    | { published: { version: number; alsoPublished: string[] } }
    | { refused: { status: number; code: string; details?: Record<string, unknown> } },
): PublishAnswer {
  void key;
  void outcome;
  throw new Error('P4-editor');
}
