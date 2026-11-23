'use server';

import type { ActionState } from '@/lib/forms';

/**
 * Field supplies' own forms (phase 5 design 4.4, 8.1): a mapping from a note type's field, a grid's
 * cell or every note of the type to the items it suggests. Remove, Restore and taking Sineobex's
 * update are every page's (actions/presets.ts). The API is the one judge of a body (D114): each form
 * sends what was typed, field by body path, and says each problem beside its field.
 *
 * Written ahead of its code (card P4-tests): each action throws until card P4-field-supplies builds
 * it, as presets-field-supplies.test.ts holds.
 */

/** Adds a mapping of the team's own. */
export async function addFieldSupplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  void form;
  throw new Error('P4-field-supplies');
}

/** Gives a mapping its next version, at the version shown, its body the API's with the form's fields over it. */
export async function saveFieldSupplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  void form;
  throw new Error('P4-field-supplies');
}
