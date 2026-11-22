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
 * Adding a bundle and editing one (phase 5 design 4.4, 5.1, 8.1): the Bundles pages' own forms.
 * Remove, Restore and taking Sineobex's update are every page's (actions/presets.ts). The API is
 * the one judge of a body (D114): each form sends what was typed, the API refuses with the path of
 * each problem, and the form says it beside the field, keeping what was typed; a bundle that holds
 * a medication and isn't Medical has 8.1's sentence. A stale sign-in goes to /reauth and back to
 * the page (unwrap).
 */

const LIST = '/team/presets/bundles';
const KIND = 'bundle';
const LOST = 'This can’t be found. Reload the page.';

/** The forms' words for the body's fields, for the error summary and beside each field. */
const CONTEXT: Omit<PresetRefusalContext, 'act'> = {
  kind: KIND,
  labels: {
    name: 'Name',
    medical: 'Medical or Non-Medical',
    lines: 'Items',
    'lines.*.itemId': 'Item',
    'lines.*.qty': 'Quantity',
    prompt: 'Ask before applying',
  },
  sentences: {
    // The form offers the two alone, so a problem of the schema's here is that none was chosen.
    medical: 'Choose Medical or Non-Medical.',
    lines: 'Give the bundle 1 to 40 items.',
    'lines.*.qty': 'Enter a whole number from 1 to 99.',
    prompt: 'Keep it to 300 characters.',
  },
};

/** A text as typed, less the spaces around it, which the API refuses and never trims. */
const typed = (values: Record<string, string>, name: string) => (values[name] ?? '').trim();

/** The fields a bundle's forms send, as typed: nothing chosen is sent as nothing. */
function typedBody(values: Record<string, string>, form: FormData) {
  return {
    name: typed(values, 'name'),
    medical: values.medical === 'true' ? true : values.medical === 'false' ? false : undefined,
    lines: readLines(form, 'lines', { quantity: 'qty', core: true }),
    prompt: typed(values, 'prompt'),
  };
}

/** Adds a bundle of the team's own: its name, its tag, its lines and its prompt. */
export async function addBundleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const body = typedBody(values, form);
  try {
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { ...CONTEXT, act: 'save' });
  }
  revalidatePath(LIST);
  return { ok: true, message: `Added: ${body.name}. It’s on the phones after their next sync.` };
}

/**
 * Edits a bundle at the version shown: its name, its tag, its lines and its prompt. Any field of
 * its body the form doesn't show is sent as the API lists it now, so nothing is lost.
 */
export async function saveBundleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: KIND });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const context = { ...CONTEXT, act: 'save' as const };
  const fields = typedBody(values, form);
  try {
    const now = await presetNow(KIND, preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, context);
    await editPreset(KIND, preset.id, preset.baseVersion, { ...now.body, ...fields }, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, context);
  }
  revalidatePath(`${LIST}/${preset.id}`);
  revalidatePath(LIST);
  return { ok: true, message: `Saved: ${fields.name}. It’s on the phones after their next sync.` };
}
