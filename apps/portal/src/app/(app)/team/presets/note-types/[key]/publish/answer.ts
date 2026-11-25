import type { NoteTypeEdit } from '@/lib/presets';
import { publishedSentence, publishRefusal, refusalRedirect } from '@/lib/refusals';

/**
 * What the editor's Publish posts and is told (phase 5 design 8.1; D115): a route handler, since the
 * editor holds the operations not yet sent, which a page's re-render would lose. `publishRequest`
 * reads what the editor posted, or null for anything it never posts; `publishAnswer` says what the
 * editor shows once the API has answered: the published version ("Version 4 is live. Notes
 * already started stay on the version they began on."), or the refusal's sentence, by operation
 * where the API names one, or where the browser goes (a stale sign-in, to /reauth and back).
 *
 * Neither checks an operation's values: the API applies each in order and refuses one by its index
 * (design 5.4), so the editor holds no rule of its own (D114). The request only has to be the shape
 * the editor posts.
 */

export type PublishRequest = { baseVersion: number; ops: NoteTypeEdit[]; reason: string };

export type PublishAnswer =
  | { ok: true; version: number; alsoPublished: string[]; message: string }
  | { ok: false; error: string; opIndex?: number; noteTypeKey?: string; fieldErrors?: Record<string, string> }
  | { ok: false; redirect: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The editor's post: the version it opened, the operations it held, each named, and the reason. */
export function publishRequest(body: unknown): PublishRequest | null {
  if (!isRecord(body)) return null;
  const { baseVersion, ops, reason } = body;
  if (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 1) return null;
  if (!Array.isArray(ops) || !ops.every((op) => isRecord(op) && typeof op.op === 'string')) return null;
  if (typeof reason !== 'string') return null;
  return { baseVersion, ops: ops as NoteTypeEdit[], reason };
}

/** The editor's own address, where a fresh sign-in comes back to: the note type's key alone. */
export const editorAddress = (key: string) => `/team/presets/note-types/${key}`;

export function publishAnswer(
  key: string,
  outcome:
    | { published: { version: number; alsoPublished: string[] } }
    | { refused: { status: number; code: string; details?: Record<string, unknown> } },
): PublishAnswer {
  if ('published' in outcome) {
    const { version, alsoPublished } = outcome.published;
    return { ok: true, version, alsoPublished, message: publishedSentence(version) };
  }
  const { code, details } = outcome.refused;
  const go = refusalRedirect(code, editorAddress(key));
  if (go) return { ok: false, redirect: go };
  return { ok: false, ...publishRefusal(code, details) };
}
