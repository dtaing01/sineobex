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
  readTexts,
  sentValues,
  wholeNumber,
} from '@/lib/presets';
import { presetRefusalState, type PresetRefusalContext } from '@/lib/refusals';

/**
 * Condition supplies' own forms (phase 5 design 4.4, 5.1, 8.1): adding a condition mapping and
 * editing one, and the team's status check window, an edit of the team's settings with its own
 * reason. Remove, Restore and taking Sineobex's update are every page's (actions/presets.ts). The
 * API is the one judge of a body (D114): each form sends what was typed, the API refuses with the
 * path of each problem, and the form says it beside the field, keeping what was typed. A stale
 * sign-in goes to /reauth and back to the page (unwrap).
 */

const PAGE = '/team/presets/condition-supplies';
/** The other page that shows the team's settings: their switch and their template for new bags. */
const BAG_MINIMUMS = '/team/presets/bag-minimums';
const KIND = 'condition_supply_map';
const LOST = 'This can’t be found. Reload the page.';

/** The mapping forms' words for the body's fields, for the error summary and beside each field. */
const CONTEXT: Omit<PresetRefusalContext, 'act'> = {
  kind: KIND,
  labels: {
    name: 'Name',
    codes: 'Condition codes',
    'codes.*': 'Condition code',
    lines: 'Items',
    'lines.*.itemId': 'Item',
    'lines.*.qtyPerPatient': 'Quantity per patient',
  },
  sentences: {
    codes: 'Give 1 to 20 condition codes.',
    // The schema's one problem at a code: it isn't one, by the shape a problem's code has (4.4).
    'codes.*': 'Enter a code as a problem records it, such as R21 or L30.9.',
    lines: 'Give the mapping 1 to 10 items.',
    'lines.*.qtyPerPatient': 'Enter a whole number from 1 to 99.',
  },
};

/** The status check window's words: the field is 8.1's "Check problems not updated in [90] days". */
const WINDOW_CONTEXT: PresetRefusalContext = {
  kind: 'settings',
  act: 'save',
  labels: { problemCheckDays: 'Check problems not updated in' },
  sentences: { problemCheckDays: 'Enter a whole number of days from 7 to 365.' },
};

/** A text as typed, less the spaces around it, which the API refuses and never trims. */
const typed = (values: Record<string, string>, name: string) => (values[name] ?? '').trim();

/** The fields a mapping's forms send, as typed: its name, its codes and its lines. */
function typedBody(values: Record<string, string>, form: FormData) {
  return {
    name: typed(values, 'name'),
    codes: readTexts(form, 'codes'),
    lines: readLines(form, 'lines', { quantity: 'qtyPerPatient' }),
  };
}

/** Adds a condition mapping of the team's own: its name, its codes and its items per patient. */
export async function addConditionSupplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const body = typedBody(values, form);
  try {
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { ...CONTEXT, act: 'save' });
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Added: ${body.name}. It’s on the phones after their next sync.` };
}

/**
 * Edits a condition mapping at the version shown: its name, its codes and its lines. Any field of
 * its body the form doesn't show is sent as the API lists it now, so nothing is lost.
 */
export async function saveConditionSupplyAction(_: ActionState, form: FormData): Promise<ActionState> {
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
  revalidatePath(PAGE);
  return { ok: true, message: `Saved: ${fields.name}. It’s on the phones after their next sync.` };
}

/**
 * Sets how long a New or Ongoing problem may go without an update before it is due a status check
 * (8.1; design 11, row 21): an edit of the team's settings at the version shown, the rest of their
 * body sent as the API lists it now. The number is sent as typed, and the API holds it to its range.
 */
export async function saveProblemCheckAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: 'settings' });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const days = wholeNumber(values.problemCheckDays);
  try {
    const now = await presetNow('settings', preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, WINDOW_CONTEXT);
    await editPreset(
      'settings',
      preset.id,
      preset.baseVersion,
      { ...now.body, problemCheckDays: days },
      values.reason ?? '',
    );
  } catch (err) {
    return presetFailure(err, values, WINDOW_CONTEXT);
  }
  revalidatePath(PAGE);
  revalidatePath(BAG_MINIMUMS);
  return {
    ok: true,
    message: `Saved: Check problems not updated in ${days} days. It’s on the phones after their next sync.`,
  };
}
