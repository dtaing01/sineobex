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
  type AnswerTest,
} from '@/lib/presets';
import { presetRefusalState, type PresetRefusalContext } from '@/lib/refusals';

/**
 * Field supplies' own forms (phase 5 design 4.4, 8.1): a mapping from a note type's field, a grid's
 * cell or every note of the type to the items it suggests. Remove, Restore and taking Sineobex's
 * update are every page's (actions/presets.ts). The API is the one judge of a body (D114): each form
 * sends what was typed, field by body path, and says each problem beside its field, keeping what was
 * typed. A stale sign-in goes to /reauth and back to the page (unwrap).
 *
 * A mapping's form names each field as its body does: `name`; `noteTypeKey`; `path`, the field or a
 * grid's cell, empty for Every note of this type; `when.kind` (answered, equals or includes) and
 * `when.value`, the answer it fires on, both empty with no field; `lines.<n>.itemId` and
 * `lines.<n>.qty`, the items it suggests.
 */

const PAGE = '/team/presets/field-supplies';
const KIND = 'field_supply_map';
const LOST = 'This can’t be found. Reload the page.';

/** The mapping forms' words for the body's fields, for the error summary and beside each field. */
const CONTEXT: PresetRefusalContext = {
  kind: KIND,
  act: 'save',
  labels: {
    name: 'Name',
    noteTypeKey: 'Note type',
    path: 'Field',
    when: 'Answer',
    lines: 'Items',
    'lines.*.itemId': 'Item',
    'lines.*.qty': 'Quantity',
  },
  sentences: {
    // The schema's own problems at each: nothing was chosen, or what was is no one the page offers.
    noteTypeKey: 'Choose a note type.',
    path: 'Choose a field, or Every note of this type.',
    when: 'Choose the answer it fires on.',
    lines: 'Give the mapping 1 to 10 items.',
    'lines.*.qty': 'Enter a whole number from 1 to 99.',
  },
};

/** A text as typed, less the spaces around it, which the API refuses and never trims. */
const typed = (values: Record<string, string>, name: string) => (values[name] ?? '').trim();

/**
 * The value an `equals` was sent with, as the body holds it: true for a tick, a number for a
 * number's answer, else an option's code. A code starts with a letter (forms' OPTION_CODE), so a
 * number is never one; no option is coded `true`, and the team's own codes are made `t_` and a number.
 */
function equalsValue(value: string): string | number | true {
  if (value === 'true') return true;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

/**
 * The answer the form sent, as the body's `when`: none when it sent none (Every note of this type),
 * and 'lost' for a test no page of the portal sends.
 */
function typedWhen(values: Record<string, string>): AnswerTest | undefined | 'lost' {
  const value = values['when.value'] ?? '';
  switch (values['when.kind'] ?? '') {
    case '':
      return undefined;
    case 'answered':
      return { answered: true };
    case 'includes':
      return { includes: value };
    case 'equals':
      return { equals: equalsValue(value) };
    default:
      return 'lost';
  }
}

/** Whether the form sent lines: an edit form whose lines it can't hold shows them, and sends none. */
const sentLines = (form: FormData) => [...form.keys()].some((k) => k.startsWith('lines.'));

/** Adds a mapping of the team's own: its name, where it fires, and the items it suggests. */
export async function addFieldSupplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const when = typedWhen(values);
  if (when === 'lost') return { error: LOST, values };
  const path = values.path ?? '';
  const body = {
    name: typed(values, 'name'),
    noteTypeKey: values.noteTypeKey ?? '',
    ...(path === '' ? {} : { path }),
    ...(when === undefined ? {} : { when }),
    lines: readLines(form, 'lines', { quantity: 'qty' }),
  };
  try {
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, CONTEXT);
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Added: ${body.name}. It’s on the phones after their next sync.` };
}

/**
 * Gives a mapping its next version at the version shown: its name, its answer and its lines. Its note
 * type and its field are fixed when it is made (4.4): they, and any field of its body the form
 * doesn't show, are sent as the API lists them now, so nothing is lost.
 */
export async function saveFieldSupplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: KIND });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const when = typedWhen(values);
  if (when === 'lost') return { error: LOST, values };
  const fields = {
    name: typed(values, 'name'),
    ...(when === undefined ? {} : { when }),
    ...(sentLines(form) ? { lines: readLines(form, 'lines', { quantity: 'qty' }) } : {}),
  };
  try {
    const now = await presetNow(KIND, preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, CONTEXT);
    await editPreset(KIND, preset.id, preset.baseVersion, { ...now.body, ...fields }, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, CONTEXT);
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Saved: ${fields.name}. It’s on the phones after their next sync.` };
}
