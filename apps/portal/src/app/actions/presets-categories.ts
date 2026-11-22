'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/forms';
import {
  createPreset,
  editPreset,
  namedPreset,
  presetFailure,
  presetNow,
  sentValues,
  wholeNumber,
} from '@/lib/presets';
import { presetRefusalState, type PresetRefusalContext } from '@/lib/refusals';

/**
 * Adding a category and editing one (phase 5 design 4.4, 5.1, 8.1): Categories' own forms. Remove,
 * Restore and taking Sineobex's update are every page's (actions/presets.ts). The API is the one
 * judge of a body (D114): each form sends what was typed, the API refuses with the path of each
 * problem, and the form says it beside the field, keeping what was typed. A stale sign-in goes to
 * /reauth and back to the page (unwrap).
 */

const PAGE = '/team/presets/categories';
const KIND = 'order_category';
const LOST = 'This can’t be found. Reload the page.';

/** The forms' words for the body's fields, for the error summary and beside each field. */
const CONTEXT: Omit<PresetRefusalContext, 'act'> = {
  kind: KIND,
  labels: { name: 'Name', sort: 'Place in the list' },
  sentences: {
    // The add form offers the three alone, so a problem here is that none was chosen.
    behaviour: 'Choose what it holds.',
    sort: 'Enter a whole number from 0 to 1,000,000.',
  },
};

/** The name as typed, less the spaces around it, which the API refuses and never trims. */
const typedName = (values: Record<string, string>) => (values.name ?? '').trim();

/**
 * Adds a category of the team's own at the end of the list (the page sends the next place), with
 * what it holds, which is fixed from then on (4.4).
 */
export async function addCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const name = typedName(values);
  // Nothing chosen is sent as nothing, so the API answers at `behaviour`.
  const body = { name, behaviour: values.behaviour, sort: wholeNumber(values.sort) };
  try {
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { ...CONTEXT, act: 'save' });
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Added: ${name}. It’s on the phones after their next sync.` };
}

/**
 * Renames a category or moves it in the list, at the version shown. The rest of its body is sent
 * as the API lists it now: what it holds can't change, and is never the form's to send.
 */
export async function saveCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: KIND });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const context = { ...CONTEXT, act: 'save' as const };
  const name = typedName(values);
  try {
    const now = await presetNow(KIND, preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, context);
    await editPreset(
      KIND,
      preset.id,
      preset.baseVersion,
      { ...now.body, name, sort: wholeNumber(values.sort) },
      values.reason ?? '',
    );
  } catch (err) {
    return presetFailure(err, values, context);
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Saved: ${name}. It’s on the phones after their next sync.` };
}
