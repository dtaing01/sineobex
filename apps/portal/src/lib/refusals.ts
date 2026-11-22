import type { ActionState } from './forms';

/**
 * Where an API refusal that means "do something first" sends the person: sign in again, pass MFA,
 * acknowledge, choose a team, or confirm it's them (/reauth, then back to `next`, a same-site path).
 * Null for a refusal the page shows itself. One table for unwrap (api.ts) and for the route
 * handlers, which answer a form or a fetch and so can't redirect the way a page does.
 */
export function refusalRedirect(code: string, next: string): string | null {
  switch (code) {
    case 'unauthorized':
      return '/sign-in?ended=expired';
    case 'mfa_required':
      return '/sign-in/mfa';
    case 'acknowledgement_required':
      return '/acknowledge';
    case 'team_required':
    case 'not_a_member':
    case 'team_suspended':
      return `/select-team?problem=${code}`;
    case 'forbidden':
      // A typed URL to a screen the role can't use. The API has already logged the refusal.
      return '/home?denied=1';
    case 'reauth_required':
      return `/reauth?next=${encodeURIComponent(next)}`;
    default:
      return null;
  }
}

/** The code of an API error body (`{ error: { code } }`), or 'error' when it has none. */
export function errorCode(error: unknown): string {
  const code = (error as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === 'string' ? code : 'error';
}

// ------------------------------------------------------------------------------------------------
// The preset pages' refusals (phase 5 design 8.1)
// ------------------------------------------------------------------------------------------------

/** What a preset page asked of the API, as the sentences below tell its acts apart. */
export type PresetAct = 'save' | 'remove' | 'restore' | 'take' | 'move';

export interface PresetRefusalContext {
  /** The kind of preset the form writes, as the admin routes' address names it. */
  kind: string;
  act: PresetAct;
  /**
   * The form's words for the body paths its fields are named by, for the error summary: `name`,
   * `categoryId`, or a line's field as `lines.*.qty`. A path with none is named by its sentence alone.
   */
  labels?: Readonly<Record<string, string>>;
}

/** 8.1's sentences, word for word. */
export const PRESET_SENTENCES = {
  stale: 'Someone else changed this while you were editing. Reload to see their version.',
  updateChangesFixed:
    'This update changes something that can’t be changed here. Add it as a new one: this one is removed, and kept in the history.',
  itemInNonMedicalBundles:
    'Non-Medical bundles hold this item, and a bundle that holds a medication must be Medical. Make them Medical first.',
  bundleNotMedical: 'This bundle holds a medication, so it must be Medical.',
  restoredBundleNotMedical:
    'This bundle now holds a medication, so it must be Medical. Add a Medical bundle instead.',
  sensitivePath: 'Only some people may read this answer, so it can’t suggest supplies.',
} as const;

export const REASON_PROBLEM = 'Give a reason of 3 to 300 characters.';

/** What names a preset, by the kind of each preset that does, in the order the pages list kinds. */
const USED_BY: Readonly<Record<string, readonly [string, string]>> = {
  order_category: ['category', 'categories'],
  item: ['item', 'items'],
  bundle: ['bundle', 'bundles'],
  flag: ['flag', 'flags'],
  field_supply_map: ['mapping', 'mappings'],
  condition_supply_map: ['condition mapping', 'condition mappings'],
  bag: ['bag', 'bags'],
};

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * "2 bundles and 1 mapping": the API's `referencedBy` counts, by kind. The settings name an item
 * only in the template for new bags, so that is what they are called.
 */
export function usedBy(referencedBy: Readonly<Record<string, number>>): string {
  const counted = (kind: string, n: number) => {
    const noun = USED_BY[kind];
    return noun ? `${n} ${n === 1 ? noun[0] : noun[1]}` : `${n} other ${n === 1 ? 'preset' : 'presets'}`;
  };
  const kinds = Object.keys(referencedBy).filter((k) => (referencedBy[k] ?? 0) > 0);
  const known = Object.keys(USED_BY).filter((k) => kinds.includes(k));
  const others = kinds.filter((k) => !(k in USED_BY) && k !== 'settings');
  return listed([
    ...[...known, ...others].map((k) => counted(k, referencedBy[k]!)),
    ...(kinds.includes('settings') ? ['the template for new bags'] : []),
  ]);
}

/** The referenced refusal (8.1): "Still used by 2 bundles and 1 mapping. Take it out of those first." */
export function referencedSentence(referencedBy: unknown): string {
  const counts =
    referencedBy !== null && typeof referencedBy === 'object' ? (referencedBy as Record<string, number>) : {};
  const used = usedBy(counts);
  return used
    ? `Still used by ${used}. Take it out of those first.`
    : 'Still used. Take it out of those first.';
}

/** A kind's name in a sentence: "Another item already has this name." */
const NOUN: Readonly<Record<string, string>> = {
  order_category: 'category',
  item: 'item',
  bundle: 'bundle',
  flag: 'flag',
  field_supply_map: 'mapping',
  condition_supply_map: 'condition mapping',
  bag: 'bag',
};

/**
 * What a problem the API found at a field says beside it: a body's schema answers its own codes
 * (too_small, invalid_format, …) and validatePreset its rules' (design 4.4).
 */
const PROBLEMS: Readonly<Record<string, string>> = {
  item_twice: 'This item is on the list twice.',
  option_twice: 'This option is on the list twice.',
  untrimmed: 'Take out the spaces at the start or end.',
  too_small: 'This is too short or too small.',
  too_big: 'This is too long or too big.',
  unknown_reference: 'This isn’t on your team’s list.',
  wrong_kind: 'This isn’t the right kind for here.',
  reference_archived: 'This was removed. Choose another, or restore it first.',
  result_mismatch: 'An item records a result exactly when its category holds tests.',
  medical_mismatch: 'An item in a category that holds medications or tests is always Medical.',
  bundle_not_medical: PRESET_SENTENCES.bundleNotMedical,
  primary_sensitive: 'A risk level can’t be sensitive.',
  settings_taken: 'Your team has its settings already.',
  sensitive_path: PRESET_SENTENCES.sensitivePath,
  unknown_note_type: 'This note type isn’t on your team’s list.',
  unknown_path: 'This isn’t a field of the note type.',
  path_kind: 'This field can’t suggest supplies.',
  when_invalid: 'This answer isn’t one the field can hold.',
  from_path: 'The quantity has to come from a number in the same note.',
  path_without_when: 'Choose the answer, or Every note of this type.',
  when_without_path: 'Choose the field, or Every note of this type.',
  unstorable: 'This holds a character that can’t be saved. Type it again.',
  too_large: 'This is too long to save. Make it shorter.',
};

function problemSentence(code: string, path: string): string {
  const known = PROBLEMS[code];
  if (known) return known;
  // A schema's own code at an ID: nothing was chosen, or what was is no preset's.
  return /(^|\.)(itemId|categoryId)$/.test(path) ? 'Choose one from the list.' : 'Check this.';
}

/** The form's word for a path: `lines.2.qty` is the label of `lines.*.qty`, on line 3. */
function labelOf(path: string, labels: Readonly<Record<string, string>>): string | undefined {
  if (labels[path]) return labels[path];
  const line = /^([^.]+)\.(\d+)\.(.+)$/.exec(path);
  const lineLabel = line && labels[`${line[1]}.*.${line[3]}`];
  if (line && lineLabel) return `${lineLabel} on line ${Number(line[2]) + 1}`;
  return labels[path.split('.')[0]!];
}

type Problem = { path: string; code: string };

function problemsOf(details: Record<string, unknown> | undefined, key: string): Problem[] {
  const list = details?.[key];
  return Array.isArray(list)
    ? list.filter((p): p is Problem => typeof p?.path === 'string' && typeof p?.code === 'string')
    : [];
}

/**
 * What a preset form shows when the API refused it (phase 5 design 7, 8.1): the sentence for the
 * refusal and, where the API names fields, a sentence beside each, keyed by its body path, which is
 * how the preset forms name their fields. The form keeps what was sent.
 */
export function presetRefusalState(
  refusal: { code: string; message: string; details?: Record<string, unknown> },
  values: Record<string, string>,
  context: PresetRefusalContext,
): ActionState {
  const { code, details } = refusal;
  const { act } = context;
  const labels = context.labels ?? {};
  const noun = NOUN[context.kind] ?? 'preset';
  const at = (problems: readonly Problem[], sentence?: (p: Problem) => string) => {
    const fieldErrors: Record<string, string> = {};
    for (const p of problems) {
      if (p.path === '' || fieldErrors[p.path]) continue;
      const said = sentence ? sentence(p) : problemSentence(p.code, p.path);
      const label = labelOf(p.path, labels);
      fieldErrors[p.path] = label ? `${label}: ${said}` : said;
    }
    return fieldErrors;
  };
  const state = (error: string, fieldErrors: Record<string, string> = {}): ActionState => ({
    error,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    values,
  });

  switch (code) {
    // A flag order made from a list that has gained or lost a flag since is stale too (8.1).
    case 'stale':
    case 'ids_mismatch':
      return state(PRESET_SENTENCES.stale);
    case 'referenced':
      return state(referencedSentence(details?.referencedBy));
    case 'bundle_not_medical':
      return state(PRESET_SENTENCES.itemInNonMedicalBundles);
    case 'fixed_field': {
      if (act === 'take') return state(PRESET_SENTENCES.updateChangesFixed);
      const fields = Array.isArray(details?.fields) ? (details.fields as unknown[]) : [];
      return state(
        'Some of this can’t be changed once it’s made. Add a new one instead.',
        at(
          fields.filter((f): f is string => typeof f === 'string').map((path) => ({ path, code: 'fixed' })),
          () => 'This can’t be changed later.',
        ),
      );
    }
    case 'no_change':
      return state('You haven’t changed anything.');
    case 'name_taken':
      if (act === 'save')
        return state(`Another ${noun} already has this name.`, {
          name: `Another ${noun} already has this name.`,
        });
      return state(
        act === 'take'
          ? `Another ${noun} has the name this update gives it. Rename that one first.`
          : `Another ${noun} has this name now. Rename that one first.`,
      );
    case 'reference_archived':
      return state(
        act === 'take'
          ? 'This update names something your team removed. Restore that first.'
          : act === 'restore'
            ? 'It names something that was removed since. Restore that first.'
            : 'It names something that was removed. Choose another, or restore that one first.',
        act === 'save' ? at(problemsOf(details, 'problems')) : {},
      );
    case 'archived':
      return state(act === 'remove' ? 'This was removed already.' : 'This was removed. Restore it first.');
    case 'not_archived':
      return state('This is on the list already.');
    case 'not_removable':
      return state('The team’s settings can’t be removed.');
    case 'no_update':
      return state('There’s no update to take now.');
    case 'not_found':
      return state('This isn’t on your team’s list. Reload the page to see the list as it is now.');
    case 'validation_failed': {
      // The request's own refusal, before the key and the sign-in are asked: from a preset form,
      // only the reason can be wrong (the page writes every other field it sends).
      const fields = Array.isArray(details?.fields) ? (details.fields as { path?: unknown }[]) : [];
      return fields.some((f) => f?.path === 'reason')
        ? state(REASON_PROBLEM, { reason: REASON_PROBLEM })
        : state('Something in this form isn’t right. Reload the page and try again.');
    }
    case 'invalid': {
      const problems = problemsOf(details, 'problems');
      const has = (c: string) => problems.some((p) => p.code === c);
      // Neither sends a body, so there is no field to fix: what the preset now holds is said.
      if (act === 'take')
        return state('This update doesn’t fit your team’s other presets, so it can’t be taken as it is.');
      if (act === 'restore')
        return state(
          has('bundle_not_medical')
            ? PRESET_SENTENCES.restoredBundleNotMedical
            : 'This doesn’t fit your team’s other presets now, so it can’t be restored as it is.',
        );
      const whole = problems.find((p) => p.path === '');
      return state(
        has('bundle_not_medical')
          ? PRESET_SENTENCES.bundleNotMedical
          : has('sensitive_path')
            ? PRESET_SENTENCES.sensitivePath
            : whole
              ? problemSentence(whole.code, '')
              : 'Some fields need changing. Check each one below.',
        at(problems),
      );
    }
    default:
      return state(refusal.message || 'Something went wrong. Try again.');
  }
}
