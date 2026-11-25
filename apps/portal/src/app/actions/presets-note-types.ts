'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PortalApiError } from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import {
  archiveNoteType,
  createNoteType,
  restoreNoteType,
  sentValues,
  takeNoteTypeUpdate,
  type NoteTypeKind,
} from '@/lib/presets';
import { noteTypeRefusalState, type NoteTypeAct } from '@/lib/refusals';

/**
 * Note types' own acts (phase 5 design 5.4, 7, 8.1): Add, a copy of one of the team's or a blank
 * one; Remove and Restore; taking Sineobex's update, in place or as a new note type. Each asks the
 * API, which takes the team lock, refuses by its rules and audits; a refusal comes back to the form
 * with its sentence (lib/refusals.ts) and what was typed, and a stale sign-in goes to /reauth and
 * back to the page (unwrap). Publish is the editor's route handler (note-types/[key]/publish).
 *
 * A done Remove, Restore or take sends the browser back to the list, which says what was done
 * (PresetNotice): the form has left with the note type's old place. A refusal another admin's
 * Remove or Restore caused meanwhile (archived, not_archived) comes back there too, saying so.
 */

const PAGE = '/team/presets/note-types';
const LOST = 'This can’t be found. Reload the page.';

/** A note type's key, as 0017 allows it: a platform key or a team's own `t_` one. Never a title. */
const KEY = /^[a-z][a-z0-9_]{1,60}$/;

/** The refusals another admin's Remove or Restore made meanwhile answer, as for presets. */
const MEANWHILE: ReadonlySet<string> = new Set(['archived', 'not_archived']);

/** The list again, saying what was done to which note type: an act's name and a key, nothing else. */
const listWith = (said: 'done' | 'refused', what: string, key: string) =>
  `${PAGE}?${new URLSearchParams({ [said]: what, noteType: key })}`;

/** A version a form sent: a whole number from 1, else null, which no page of the portal sends. */
function versionOf(typed: string | undefined): number | null {
  const n = Number(typed);
  return typed !== undefined && /^\d{1,9}$/.test(typed) && Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * What a note type form shows when the API refused it. A refusal another admin's act caused
 * meanwhile goes back to the list, which says so; anything that is no refusal, Next's redirects
 * among them (reauth_required to /reauth and back), goes on up.
 */
function failure(err: unknown, values: Record<string, string>, act: NoteTypeAct): ActionState {
  if (!(err instanceof PortalApiError)) throw err;
  const key = values.key ?? '';
  if (MEANWHILE.has(err.code) && KEY.test(key)) {
    revalidatePath(PAGE);
    redirect(listWith('refused', err.code, key));
  }
  return noteTypeRefusalState(err, values, act);
}

/** Adds a note type: `copyOf` names one to copy, or, left empty, `kinds` and `group` make a blank one. */
export async function addNoteTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  // Both kinds ticked come back ticked after a refusal: sentValues keeps a name's last value only.
  const ticked = form.getAll('kinds').filter((k): k is string => typeof k === 'string');
  if (ticked.length > 0) values.kinds = ticked.join(',');
  // The API refuses a title with spaces around it, and never trims.
  const title = (values.title ?? '').trim();
  const reason = values.reason ?? '';
  const copyOf = values.copyOf ?? '';
  // A copy takes its kinds and group from the note type it copies (5.4): only a blank one sends
  // them, Medical first, as the API stores them. A group nothing was chosen for is sent empty, so the
  // API names it beside the kinds in one answer.
  const kinds = (['medical', 'non_medical'] as const).filter((k) => ticked.includes(k)) as NoteTypeKind[];
  try {
    await createNoteType(
      copyOf === '' ? { title, kinds, group: values.group ?? '', reason } : { title, copyOf, reason },
    );
  } catch (err) {
    return failure(err, values, 'add');
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Added: ${title}. It’s on the phones after their next sync.` };
}

/** Removes a note type at the version shown: it is archived, and joins the Removed list. */
export async function removeNoteTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const key = values.key ?? '';
  const baseVersion = versionOf(values.baseVersion);
  if (!KEY.test(key) || baseVersion === null) return { error: LOST, values };
  try {
    await archiveNoteType(key, baseVersion, values.reason ?? '');
  } catch (err) {
    return failure(err, values, 'remove');
  }
  revalidatePath(PAGE);
  redirect(listWith('done', 'removed', key));
}

/** Restores a removed note type at the version it was removed at. */
export async function restoreNoteTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const key = values.key ?? '';
  if (!KEY.test(key)) return { error: LOST, values };
  try {
    await restoreNoteType(key, values.reason ?? '');
  } catch (err) {
    return failure(err, values, 'restore');
  }
  revalidatePath(PAGE);
  redirect(listWith('done', 'restored', key));
}

/**
 * Takes the update on offer, sending back the version shown and the platform version reviewed, as a
 * preset's take does (actions/presets.ts): refused stale, the list is read again so the review shows
 * what is on offer now, and only then does the form drop the versions it sent, so its next take sends
 * the ones the review now shows; any other refusal keeps them, so a change meanwhile is still stale.
 */
export async function takeNoteTypeUpdateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const key = values.key ?? '';
  const baseVersion = versionOf(values.baseVersion);
  const platformVersion = versionOf(values.platformVersion);
  if (
    !KEY.test(key) ||
    baseVersion === null ||
    platformVersion === null ||
    (values.asNew !== 'true' && values.asNew !== 'false')
  )
    return { error: LOST, values };
  const asNew = values.asNew === 'true';
  let taken: { key: string };
  try {
    taken = await takeNoteTypeUpdate(key, {
      baseVersion,
      platformVersion,
      asNew,
      reason: values.reason ?? '',
    });
  } catch (err) {
    const refused = failure(err, values, 'take');
    if (!(err instanceof PortalApiError && err.code === 'stale')) return refused;
    revalidatePath(PAGE);
    const { baseVersion: _shown, platformVersion: _offered, ...kept } = values;
    return { ...refused, values: kept };
  }
  revalidatePath(PAGE);
  // As new, the update is a note type of its own, and the old one is removed: the notice names the new.
  redirect(listWith('done', asNew ? 'added' : 'updated', taken.key));
}
