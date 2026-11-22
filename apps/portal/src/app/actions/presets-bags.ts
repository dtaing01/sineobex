'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/forms';
import {
  createPreset,
  editPreset,
  namedPreset,
  presetFailure,
  presetNow,
  readLines,
  sentValues,
} from '@/lib/presets';
import { presetRefusalState, type PresetRefusalContext } from '@/lib/refusals';

/**
 * Bag minimums' own forms (phase 5 design 4.4, 5.1, 8.1; PRD main 477, 930): adding a bag and
 * editing one, and the team's switch and template for new bags, each an edit of the team's
 * settings with its own reason. Remove, Restore and taking Sineobex's update are every page's
 * (actions/presets.ts). The API is the one judge of a body (D114): each form sends what was typed,
 * a new bag's minimums as the form holds them however they were filled, the API refuses with the
 * path of each problem, and the form says it beside the field, keeping what was typed. A stale
 * sign-in goes to /reauth and back to the page (unwrap).
 */

const PAGE = '/team/presets/bag-minimums';
/** The other page that shows the team's settings: their status check window. */
const CONDITION_SUPPLIES = '/team/presets/condition-supplies';
const KIND = 'bag';
const LOST = 'This can’t be found. Reload the page.';

/** The words for a list of minimums' fields, under the body field it is. */
const minimumsWords = (field: string, label: string) => ({
  labels: { [field]: label, [`${field}.*.itemId`]: 'Item', [`${field}.*.min`]: 'Minimum' },
  sentences: {
    [field]: 'Give at most 200 minimums.',
    [`${field}.*.min`]: 'Enter a whole number from 1 to 999.',
  },
});

/** A bag's forms' words for the body's fields, for the error summary and beside each field. */
const BAG: Omit<PresetRefusalContext, 'act'> = (() => {
  const words = minimumsWords('minimums', 'Minimums');
  return { kind: KIND, labels: { name: 'Name', ...words.labels }, sentences: words.sentences };
})();

/** The settings' forms' words: the switch and the template for new bags. */
const SETTINGS: PresetRefusalContext = (() => {
  const words = minimumsWords('newBagMinimums', 'Template for new bags');
  return {
    kind: 'settings',
    act: 'save',
    labels: { bagMinimumsOn: 'Bag minimums', ...words.labels },
    sentences: words.sentences,
  };
})();

/** A bag's fields as typed: its name, less the spaces around it, and its minimums. */
function typedBag(values: Record<string, string>, form: FormData) {
  return {
    name: (values.name ?? '').trim(),
    minimums: readLines(form, 'minimums', { quantity: 'min' }),
  };
}

/**
 * Adds a bag of the team's own: its name and its minimums, as the form holds them. Copy from only
 * filled the lines (8.1): it is no field of the body, and the server stores what is sent.
 */
export async function addBagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const body = typedBag(values, form);
  try {
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { ...BAG, act: 'save' });
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Added: ${body.name}. It’s on the phones after their next sync.` };
}

/**
 * Edits a bag at the version shown: its name and its minimums. Any field of its body the form
 * doesn't show is sent as the API lists it now, so nothing is lost.
 */
export async function saveBagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: KIND });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const context = { ...BAG, act: 'save' as const };
  const fields = typedBag(values, form);
  try {
    const now = await presetNow(KIND, preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, context);
    await editPreset(KIND, preset.id, preset.baseVersion, { ...now.body, ...fields }, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, context);
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Saved: ${fields.name}. It’s on the phones after their next sync.` };
}

/**
 * An edit of the team's settings at the version shown, `fields` over their body as the API lists
 * it now, so the other page's field goes back as it is.
 */
async function saveSettings(
  values: Record<string, string>,
  fields: Record<string, unknown>,
  message: string,
): Promise<ActionState> {
  const preset = namedPreset({ ...values, kind: 'settings' });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  try {
    const now = await presetNow('settings', preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, SETTINGS);
    await editPreset(
      'settings',
      preset.id,
      preset.baseVersion,
      { ...now.body, ...fields },
      values.reason ?? '',
    );
  } catch (err) {
    return presetFailure(err, values, SETTINGS);
  }
  revalidatePath(PAGE);
  revalidatePath(CONDITION_SUPPLIES);
  return { ok: true, message };
}

/**
 * Turns bag minimums on or off for the team (PRD main 477), with a reason. The form says which it
 * turns them to, so a form sent twice, or after another admin's change, never flips them back: the
 * API refuses a version that is no longer current.
 */
export async function switchBagMinimumsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const to = values.bagMinimumsOn;
  if (to !== 'true' && to !== 'false') return { error: LOST, values };
  return saveSettings(
    values,
    { bagMinimumsOn: to === 'true' },
    `Saved: bag minimums are ${to === 'true' ? 'on' : 'off'}. It’s on the phones after their next sync.`,
  );
}

/** Saves the template a new bag's minimums start from (8.1), with a reason. */
export async function saveBagTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  return saveSettings(
    values,
    { newBagMinimums: readLines(form, 'newBagMinimums', { quantity: 'min' }) },
    'Saved: Template for new bags. It’s on the phones after their next sync.',
  );
}
