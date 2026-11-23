'use server';

import type { ActionState } from '@/lib/forms';

/**
 * Note types' own acts (phase 5 design 5.4, 7, 8.1): Add, a copy of one of the team's or a blank
 * one; Remove and Restore; taking Sineobex's update, in place or as a new note type. Each asks the
 * API, which takes the team lock, refuses by its rules and audits; a refusal comes back to the form
 * with its sentence (lib/refusals.ts) and what was typed, and a stale sign-in goes to /reauth and
 * back to the page (unwrap). Publish is the editor's route handler (note-types/[key]/publish).
 *
 * Written ahead of its code (card P4-tests): each action throws until card P4-list-page builds it,
 * as presets-note-types.test.ts holds.
 */

/** Adds a note type: `copyOf` names one to copy, or, left empty, `kinds` and `group` make a blank one. */
export async function addNoteTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  void form;
  throw new Error('P4-list-page');
}

/** Removes a note type at the version shown: it is archived, and joins the Removed list. */
export async function removeNoteTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  void form;
  throw new Error('P4-list-page');
}

/** Restores a removed note type at the version it was removed at. */
export async function restoreNoteTypeAction(_: ActionState, form: FormData): Promise<ActionState> {
  void form;
  throw new Error('P4-list-page');
}

/** Takes the update on offer, sending back the version shown and the platform version reviewed. */
export async function takeNoteTypeUpdateAction(_: ActionState, form: FormData): Promise<ActionState> {
  void form;
  throw new Error('P4-list-page');
}
