'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/forms';
import {
  createPreset,
  editPreset,
  namedPreset,
  presetFailure,
  presetNow,
  readTexts,
  sentValues,
} from '@/lib/presets';
import { presetRefusalState, type PresetRefusalContext } from '@/lib/refusals';

/**
 * Adding an item and editing one (phase 5 design 4.4, 5.1, 8.1): the Items pages' own forms.
 * Remove, Restore and taking Sineobex's update are every page's (actions/presets.ts). The API is the
 * one judge of a body (D114): each form sends what was typed, the API refuses with the path of each
 * problem, and the form says it beside the field, keeping what was typed. An edit that would leave
 * a Non-Medical bundle holding a medication is refused (409 bundle_not_medical) with 8.1's
 * sentence. A stale sign-in goes to /reauth and back to the page (unwrap).
 */

const LIST = '/team/presets/items';
const KIND = 'item';
const LOST = 'This can’t be found. Reload the page.';

/** The forms' words for the body's fields, for the error summary and beside each field. */
const CONTEXT: Omit<PresetRefusalContext, 'act'> = {
  kind: KIND,
  labels: {
    name: 'Name',
    categoryId: 'Category',
    unit: 'Counted in',
    medical: 'Medical',
    captureLot: 'Capture lot and expiry',
    result: 'Result',
    'result.options': 'Options',
    'result.options.*': 'Option',
    'result.unit': 'Unit of the result',
  },
  sentences: {
    unit: 'Enter 1 to 20 characters, such as tablet or packet.',
    'result.options': 'Give 2 to 12 options.',
    'result.options.*': 'Enter 1 to 40 characters.',
    'result.unit': 'Enter 1 to 20 characters, such as mg/dL.',
  },
};

/** A text as typed, less the spaces around it, which the API refuses and never trims. */
const typed = (values: Record<string, string>, name: string) => (values[name] ?? '').trim();

/**
 * The result the add form chose: none, a choice from the options typed, or a number in the unit
 * typed. Nothing chosen is sent as nothing, so the API answers at `result`.
 */
function newResult(values: Record<string, string>, form: FormData): unknown {
  switch (values['result.type']) {
    case 'none':
      return null;
    case 'choice':
      return { type: 'choice', options: readTexts(form, 'result.options') };
    case 'number':
      return { type: 'number', unit: typed(values, 'result.unit') };
    default:
      return undefined;
  }
}

/**
 * The result an edit sends: what kind it is is the API's, fixed at creation (4.4), and never the
 * form's; a choice's options and a number's unit are the form's, when it sent them.
 */
function editedResult(values: Record<string, string>, form: FormData, now: unknown): unknown {
  if (now === null || typeof now !== 'object') return now;
  const result = now as { type?: unknown };
  if (result.type === 'choice' && values['result.options.count'] !== undefined)
    return { ...result, options: readTexts(form, 'result.options') };
  if (result.type === 'number' && values['result.unit'] !== undefined)
    return { ...result, unit: typed(values, 'result.unit') };
  return now;
}

/** The fields both forms send as typed: a tick box that isn't ticked is sent as not ticked. */
function typedFields(values: Record<string, string>, form: FormData) {
  return {
    name: typed(values, 'name'),
    categoryId: values.categoryId ?? '',
    medical: form.get('medical') === 'on',
    captureLot: form.get('captureLot') === 'on',
  };
}

/**
 * Adds an item of the team's own, with what it is counted in and the kind of result it records,
 * which are fixed from then on (4.4).
 */
export async function addItemAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const fields = typedFields(values, form);
  const body = { ...fields, unit: typed(values, 'unit'), result: newResult(values, form) };
  try {
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { ...CONTEXT, act: 'save' });
  }
  revalidatePath(LIST);
  return { ok: true, message: `Added: ${fields.name}. It’s on the phones after their next sync.` };
}

/**
 * Edits an item at the version shown: its name, its category, Medical, Capture lot and expiry, and
 * a result's options or unit. The rest of its body is sent as the API lists it now: what it is
 * counted in and the kind of result it records can't change, and are never the form's to send.
 */
export async function saveItemAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: KIND });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const context = { ...CONTEXT, act: 'save' as const };
  const fields = typedFields(values, form);
  try {
    const now = await presetNow(KIND, preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, context);
    const body = { ...now.body, ...fields, result: editedResult(values, form, now.body.result) };
    await editPreset(KIND, preset.id, preset.baseVersion, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, context);
  }
  revalidatePath(`${LIST}/${preset.id}`);
  revalidatePath(LIST);
  return { ok: true, message: `Saved: ${fields.name}. It’s on the phones after their next sync.` };
}
