'use server';

import { revalidatePath } from 'next/cache';
import { parseMove } from '@/app/(app)/team/presets/flags/flags';
import { FIELD_LABELS } from '@/components/presets/review';
import { PortalApiError } from '@/lib/api';
import type { ActionState } from '@/lib/forms';
import {
  createPreset,
  editPreset,
  listPresets,
  namedPreset,
  presetFailure,
  presetNow,
  reorderFlags,
  sentValues,
  type PresetRow,
} from '@/lib/presets';
import { presetRefusalState, type PresetRefusalContext } from '@/lib/refusals';

/**
 * Adding a flag, moving one up or down its list and editing one (phase 5 design 4.4, 5.1, 7, 8.1):
 * the Flags pages' own forms. Remove, Restore and taking Sineobex's update are every page's
 * (actions/presets.ts). The API is the one judge of a body and of an order (D114): each form sends
 * what was typed or shown, the API refuses with the path of each problem, and the form says it
 * beside the field, keeping what was typed. A stale sign-in goes to /reauth and back to the page
 * (unwrap).
 */

const PAGE = '/team/presets/flags';
const KIND = 'flag';
const LOST = 'This can’t be found. Reload the page.';
const LABELS = FIELD_LABELS.flag;

/** The forms' words for the body's fields, for the error summary and beside each field. */
const CONTEXT: Omit<PresetRefusalContext, 'act'> = {
  kind: KIND,
  labels: {
    name: LABELS.name,
    tier: LABELS.tier,
    color: LABELS.color,
    criteria: LABELS.criteria,
    sensitive: LABELS.sensitive,
  },
  sentences: {
    // Fields where each of the schema's problems asks one thing: a list or a colour nobody chose,
    // criteria past their length.
    tier: 'Choose Risk level or Conditions.',
    color: 'Choose a colour.',
    criteria: 'Keep it to 500 characters.',
  },
};

/** A text as typed, less the spaces around it, which the API refuses and never trims. */
const typed = (values: Record<string, string>, name: string) => (values[name] ?? '').trim();

// The highest rank the body takes (packages/presets/src/schemas.ts): a list that ends there adds a
// tie at the end, which the name settles.
const LAST_RANK = 1_000_000;

/**
 * Where a new flag goes: after every flag of its list, removed ones too, so one restored later
 * comes back where it was. A form that chose no list is refused at `tier` whatever its rank.
 */
function nextRank(flags: readonly PresetRow<'flag'>[], tier: string | undefined): number {
  const ranks = flags.filter((f) => f.body.tier === tier).map((f) => f.body.rank);
  return Math.min(LAST_RANK, Math.max(0, ...ranks) + 10);
}

/**
 * Adds a flag of the team's own at the end of its list: its name, which list it is on and whether
 * it is sensitive, both fixed from then on (4.4), its colour and its criteria.
 */
export async function addFlagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const name = typed(values, 'name');
  try {
    // Nothing chosen is sent as nothing, so the API answers at the field.
    const body = {
      name,
      tier: values.tier,
      criteria: typed(values, 'criteria'),
      color: values.color,
      rank: nextRank(await listPresets(KIND), values.tier),
      sensitive: values.sensitive === 'on',
    };
    await createPreset(KIND, body, values.reason ?? '');
  } catch (err) {
    return presetFailure(err, values, { ...CONTEXT, act: 'save' });
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Added: ${name}. It’s on the phones after their next sync.` };
}

/**
 * Edits a flag at the version shown: its name, its colour and its criteria. The rest of its body
 * is sent as the API lists it now: which list it is on and whether it is sensitive can't change
 * (4.4), and its rank is the list's to move, so none is ever the form's to send.
 */
export async function saveFlagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const preset = namedPreset({ ...values, kind: KIND });
  if (!preset || preset.baseVersion === null) return { error: LOST, values };
  const context = { ...CONTEXT, act: 'save' as const };
  const name = typed(values, 'name');
  try {
    const now = await presetNow(KIND, preset.id);
    if (!now) return presetRefusalState({ code: 'not_found', message: '' }, values, context);
    await editPreset(
      KIND,
      preset.id,
      preset.baseVersion,
      { ...now.body, name, color: values.color, criteria: typed(values, 'criteria') },
      values.reason ?? '',
    );
  } catch (err) {
    return presetFailure(err, values, context);
  }
  revalidatePath(`${PAGE}/${preset.id}`);
  revalidatePath(PAGE);
  return { ok: true, message: `Saved: ${name}. It’s on the phones after their next sync.` };
}

type Listed = { id: string; baseVersion: number };

/**
 * The tier's flags as its list showed them, in order, each at the version shown
 * (`flags.0.id`, `flags.0.baseVersion`, …); null for a form no page writes.
 */
function listedOrder(values: Record<string, string>): Listed[] | null {
  const order: Listed[] = [];
  for (let i = 0; `flags.${i}.id` in values; i++) {
    const flag = namedPreset({
      kind: KIND,
      id: values[`flags.${i}.id`]!,
      baseVersion: values[`flags.${i}.baseVersion`] ?? '',
    });
    if (!flag || flag.baseVersion === null) return null;
    order.push({ id: flag.id, baseVersion: flag.baseVersion });
  }
  return order;
}

/**
 * Moves a flag one place up or down its list: the button pressed names the flag and the way
 * (`move`, `up:<id>` or `down:<id>`), and the order sent is every flag the list showed, each at the
 * version it showed (7), with the two swapped. Its answer says only how many flags moved, so the
 * page is read again: the next move is made from the versions this one wrote, or it would be
 * refused stale by design. An order made from a list another write has changed since, refused
 * stale or ids_mismatch, reads the list again too, and says so with the stale sentence (8.1). A
 * move done keeps its reason in the form for the next one, and names the flag it moved, so the
 * list can say where it went and keep the person's place on it.
 */
export async function moveFlagAction(_: ActionState, form: FormData): Promise<ActionState> {
  const values = sentValues(form);
  const tier = values.tier;
  const order = listedOrder(values);
  const move = parseMove(values.move);
  const from = move && order ? order.findIndex((f) => f.id === move.id) : -1;
  const to = move?.way === 'up' ? from - 1 : from + 1;
  if ((tier !== 'primary' && tier !== 'secondary') || !order || from < 0 || to < 0 || to >= order.length)
    return { error: LOST, values };
  const flags = [...order];
  [flags[from], flags[to]] = [flags[to]!, flags[from]!];
  const reason = values.reason ?? '';
  try {
    await reorderFlags({ tier, flags, reason });
  } catch (err) {
    // The list's Reason box is "Reason for moving" (FlagOrder), and a refused reason is named so.
    const refused = await presetFailure(err, values, {
      kind: KIND,
      act: 'move',
      labels: { reason: 'Reason for moving' },
    });
    if (err instanceof PortalApiError && (err.code === 'stale' || err.code === 'ids_mismatch'))
      revalidatePath(PAGE);
    return refused;
  }
  revalidatePath(PAGE);
  return { ok: true, values: { reason, move: values.move! } };
}
