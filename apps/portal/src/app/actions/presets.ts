'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PortalApiError } from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import {
  archivePreset,
  donePath,
  namedPreset,
  presetFailure,
  presetPage,
  restorePreset,
  sentValues,
  takePresetUpdate,
} from '@/lib/presets';

/**
 * The acts every preset page shares (phase 5 design 5.1, 8.1): Remove, Restore and taking
 * Sineobex's update, each with a reason. Each asks the API, which takes the team lock, refuses by its rules and audits; a refusal
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

/**
 * Takes the update on offer, in place or as a new preset (5.1), sending back the version shown and
 * the platform version offered, so only what was reviewed is taken. A take refused stale means the
 * copy changed, or a newer version came on offer, since the page was read: the page is read again,
 * so the review shows what is on offer now (8.1), and the form says why. Only then are the two
 * versions left out of what the form keeps, so its next take sends the ones the review now shows;
 * any other refusal keeps the versions sent, so a change made meanwhile is still refused stale.
 */
export async function takePresetUpdateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset(values);
  const platformVersion = Number(values.platformVersion);
  if (
    !preset ||
    preset.baseVersion === null ||
    !(Number.isSafeInteger(platformVersion) && platformVersion >= 1) ||
    (values.asNew !== 'true' && values.asNew !== 'false')
  )
    return { error: LOST, values };
  const asNew = values.asNew === 'true';
  let taken: { id: string };
  try {
    taken = await takePresetUpdate(preset.kind, preset.id, {
      baseVersion: preset.baseVersion,
      platformVersion,
      asNew,
      reason: values.reason ?? '',
    });
  } catch (err) {
    const refused = presetFailure(err, values, { kind: preset.kind, act: 'take' });
    if (!(err instanceof PortalApiError && err.code === 'stale')) return refused;
    revalidatePath(await landing(values));
    const { baseVersion: _shown, platformVersion: _offered, ...kept } = values;
    return { ...refused, values: kept };
  }
  const page = await landing(values);
  revalidatePath(page);
  // As new, the update is a preset of its own, and the old one is removed: the notice names the new.
  redirect(donePath(page, asNew ? 'added' : 'updated', taken.id));
}
