'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/lib/forms';
import {
  archivePreset,
  donePath,
  namedPreset,
  presetFailure,
  presetPage,
  restorePreset,
  sentValues,
} from '@/lib/presets';

/**
 * The acts every preset page shares (phase 5 design 5.1, 8.1): Remove and Restore, each with a
 * reason. Each asks the API, which takes the team lock, refuses by its rules and audits; a refusal
 * comes back to the form with its sentence (lib/refusals.ts) and what was typed, and a stale
 * sign-in goes to /reauth and back to the page (unwrap). A done act sends the browser back to the
 * page, which says what was done (PresetNotice): the form has left with the preset's old place.
 */

const LOST = 'This can’t be found. Reload the page.';

/** Where an act comes back to: the form's `back`, else the page it was sent from. */
async function landing(values: Record<string, string>): Promise<string> {
  return presetPage(values.back, (await headers()).get('x-pathname'));
}

/** Removes a preset at the version shown: it is archived, and joins the Removed list. */
export async function removePresetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset(values);
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  try {
    await archivePreset(preset.kind, preset.id, preset.baseVersion, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { kind: preset.kind, act: 'remove' });
  }
  const page = await landing(values);
  revalidatePath(page);
  redirect(donePath(page, 'removed', preset.id));
}

/** Restores a removed preset at the version it was removed at. */
export async function restorePresetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset(values);
  if (!preset) return { error: LOST, values };
  try {
    await restorePreset(preset.kind, preset.id, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { kind: preset.kind, act: 'restore' });
  }
  const page = await landing(values);
  revalidatePath(page);
  redirect(donePath(page, 'restored', preset.id));
}
