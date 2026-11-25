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
   * `categoryId`, a line's field as `lines.*.qty` ("Quantity on line 3"), or a list's own entries
   * as `result.options.*` ("Option 2"). A path with none is named by its sentence alone.
   */
  labels?: Readonly<Record<string, string>>;
  /**
   * What a problem at a field says beside it when the API's code is one of the body schema's own
   * bounds or types (too_small, too_big, invalid_type, …), by the same paths as `labels`: for a
   * field where each of those asks the person one thing, such as a choice nothing was chosen for
   * ("Choose what it holds.") or a number out of its range. A rule's problem at the field, such as
   * bundle_not_medical or option_twice, keeps its own sentence, which says what to change.
   */
  sentences?: Readonly<Record<string, string>>;
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

/**
 * A take refused stale (design 5.1, 8.1): the copy changed since the review, Sineobex offered a newer
 * version meanwhile (a phone's pull runs the installer), or the update went with a change to the
 * copy. The page is read again, so the review below already shows what is on offer now: each says
 * what happened and asks for no reload, which 8.1's stale sentence asks of a form that keeps what
 * it sent.
 */
export const TAKE_STALE = {
  copyChanged:
    'Someone else changed this while you were reviewing the update. Review it again below before you take it.',
  newerOffer:
    'Sineobex offered a newer version while you were reviewing this one. Review it below before you take it.',
  noOffer:
    'Someone else changed this while you were reviewing the update, and there’s no update to take now.',
} as const;

/**
 * Which of TAKE_STALE a take's stale answer is, from its details (`currentVersion`, and
 * `platformVersion`, the version on offer now or null) against the versions the form sent; 8.1's
 * stale sentence when the details say neither.
 */
function takeStale(details: Record<string, unknown> | undefined, values: Record<string, string>): string {
  const offered = details?.platformVersion;
  if (offered === null) return TAKE_STALE.noOffer;
  const current = details?.currentVersion;
  if (typeof current === 'number' && current !== Number(values.baseVersion)) return TAKE_STALE.copyChanged;
  if (typeof offered === 'number' && offered !== Number(values.platformVersion)) return TAKE_STALE.newerOffer;
  return PRESET_SENTENCES.stale;
}

export const REASON_PROBLEM = 'Give a reason of 3 to 300 characters.';

/** The summary's title over the fields a refusal names, each in a line of its own below it. */
export const FIELDS_TITLE = 'Some fields need changing. Check each one below.';

/**
 * What a preset's name left empty or too long says, on every form: each kind's name is 1 to 80
 * characters (packages/presets/src/schemas.ts), so its schema's bounds ask one thing of it.
 */
export const NAME_PROBLEM = 'Enter a name of 1 to 80 characters.';

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

/**
 * The referenced refusal (8.1): "Still used by 2 bundles and 1 mapping. Take it out of those
 * first.", and "… of that first." when one thing uses it: one preset, or the template for new bags
 * alone (the settings, which name an item there only).
 */
export function referencedSentence(referencedBy: unknown): string {
  const counts =
    referencedBy !== null && typeof referencedBy === 'object' ? (referencedBy as Record<string, number>) : {};
  const used = usedBy(counts);
  const users = Object.entries(counts).reduce(
    (n, [kind, count]) =>
      n + (typeof count === 'number' && count > 0 ? (kind === 'settings' ? 1 : count) : 0),
    0,
  );
  return used
    ? `Still used by ${used}. Take it out of ${users === 1 ? 'that' : 'those'} first.`
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

/**
 * Whether a code is one of the body schema's bounds or types, which a form's own sentence for the
 * field says better: too_small, too_big, or a code PROBLEMS has no sentence for (invalid_type,
 * invalid_value, …). Every other code names what to change, and keeps its own sentence.
 */
const schemaBound = (code: string) =>
  code === 'too_small' || code === 'too_big' || !Object.hasOwn(PROBLEMS, code);

/**
 * An entry of a list in a body: a line's field (`lines.2.qty`, written `lines.*.qty` in a form's
 * words) or an entry of its own (`result.options.1`, written `result.options.*`).
 */
const IN_LIST = /^(.+?)\.(\d+)(?:\.([^\d].*))?$/;

/** A list entry's pattern in a form's words, and which entry it is, counted from 1. */
function listEntry(path: string): { pattern: string; nth: number; field: boolean } | null {
  const m = IN_LIST.exec(path);
  if (!m) return null;
  const [, list, index, field] = m;
  return {
    pattern: field === undefined ? `${list}.*` : `${list}.*.${field}`,
    nth: Number(index) + 1,
    field: field !== undefined,
  };
}

/** The form's word for a path: `lines.2.qty` is the label of `lines.*.qty` on line 3, `result.options.1` Option 2. */
function labelOf(path: string, labels: Readonly<Record<string, string>>): string | undefined {
  if (labels[path]) return labels[path];
  const entry = listEntry(path);
  const entryLabel = entry && labels[entry.pattern];
  if (entry && entryLabel)
    return entry.field ? `${entryLabel} on line ${entry.nth}` : `${entryLabel} ${entry.nth}`;
  return labels[path.split('.')[0]!];
}

/**
 * The form's own sentence for a path, a list entry's by its pattern (`lines.*.qty`); a preset's name
 * has the one every form shares.
 */
function sentenceOf(path: string, sentences: Readonly<Record<string, string>>): string | undefined {
  const entry = listEntry(path);
  return (
    sentences[path] ??
    (entry ? sentences[entry.pattern] : undefined) ??
    (path === 'name' ? NAME_PROBLEM : undefined)
  );
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
  const sentences = context.sentences ?? {};
  const noun = NOUN[context.kind] ?? 'preset';
  const at = (problems: readonly Problem[], sentence?: (p: Problem) => string) => {
    const fieldErrors: Record<string, string> = {};
    for (const p of problems) {
      if (p.path === '' || fieldErrors[p.path]) continue;
      const said = sentence
        ? sentence(p)
        : ((schemaBound(p.code) ? sentenceOf(p.path, sentences) : undefined) ??
          problemSentence(p.code, p.path));
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
  // One field to fix, named in its line as every field's problem is, under a title of its own, so
  // the summary never says one sentence twice.
  const oneField = (path: string, fallback: string, said: string) =>
    state(FIELDS_TITLE, { [path]: `${labelOf(path, labels) ?? fallback}: ${said}` });

  switch (code) {
    case 'stale':
      return state(act === 'take' ? takeStale(details, values) : PRESET_SENTENCES.stale);
    // A flag order made from a list that has gained or lost a flag since is stale too (8.1).
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
      if (act === 'save') return oneField('name', 'Name', `Another ${noun} already has this name.`);
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
        ? oneField('reason', 'Reason', REASON_PROBLEM)
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
              : FIELDS_TITLE,
        at(problems),
      );
    }
    default:
      return state(refusal.message || 'Something went wrong. Try again.');
  }
}

// ------------------------------------------------------------------------------------------------
// The note type pages' refusals (phase 5 design 5.4, 7, 8.1)
// ------------------------------------------------------------------------------------------------

/** 8.1's sentences of the note type pages, word for word. */
export const NOTE_TYPE_SENTENCES = {
  protectedPart: 'This part can’t be changed.',
  kindsFixed: 'A note type can’t change between Medical and Non-Medical: Add a new note type instead.',
  notCopyable:
    'This section comes from a note type for other visits or other readers, so it can’t be copied here.',
  /** 8.1's protected rows, said once of a note type every part of which is protected. */
  wholeProtected: 'Nothing in this note type can be changed.',
} as const;

/** What the editor says once a publish is live (8.1), with the version the API made. */
export function publishedSentence(version: number): string {
  return `Version ${version} is live. Notes already started stay on the version they began on.`;
}

/** What a note type page asked of the API, as the sentences below tell its acts apart. */
export type NoteTypeAct = 'add' | 'remove' | 'restore' | 'take';

/** The add form's words for its fields, for the error summary and beside each field. */
const NOTE_TYPE_LABELS: Readonly<Record<string, string>> = {
  title: 'Title',
  copyOf: 'Copy of',
  kinds: 'Which visits',
  group: 'Timeline group',
  reason: 'Reason',
};

/**
 * What a field of the add form says when the request's own check refused it (validation_failed):
 * each asks one thing, whatever the check's code. The form sends each as chosen or typed (D114).
 */
const NOTE_TYPE_FIELD_PROBLEMS: Readonly<Record<string, string>> = {
  title: 'Enter a title of 1 to 80 characters.',
  copyOf: 'Choose a note type to copy, or start a blank one.',
  kinds: 'Choose Medical, Non-Medical or both.',
  group: 'Choose where the timeline files its notes.',
  reason: REASON_PROBLEM,
};

/**
 * What a note type form shows when the API refused it (phase 5 design 5.1, 7, 8.1): the sentence
 * for its refusal and, where it is one field's to fix, that field's beside it, keyed by the name the
 * form gives it. The form keeps what was sent. A take refused stale says which changed, as a
 * preset's does. A refusal another admin's Remove or Restore caused meanwhile never reaches here:
 * the action sends the browser back to the page, which says so.
 */
export function noteTypeRefusalState(
  refusal: { code: string; message: string; details?: Record<string, unknown> },
  values: Record<string, string>,
  act: NoteTypeAct,
): ActionState {
  const { code, details } = refusal;
  const state = (error: string, fieldErrors: Record<string, string> = {}): ActionState => ({
    error,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    values,
  });
  const field = (path: string, said: string) => `${NOTE_TYPE_LABELS[path] ?? path}: ${said}`;

  switch (code) {
    case 'stale':
      return state(act === 'take' ? takeStale(details, values) : PRESET_SENTENCES.stale);
    case 'referenced':
      return state(referencedSentence(details?.referencedBy));
    case 'not_removable':
      return state(
        act === 'take'
          ? 'The Red flags note can’t be removed, so its update can’t be added as a new one.'
          : 'The Red flags note can’t be removed: a Medical note can’t be finished without it.',
      );
    case 'not_copyable':
      return state(FIELDS_TITLE, {
        copyOf: field(
          'copyOf',
          'The quick encounter and the Red flags note can’t be copied. Choose another, or start a blank one.',
        ),
      });
    case 'name_taken':
      if (act === 'add')
        return state(FIELDS_TITLE, { title: field('title', 'Another note type already has this name.') });
      return state(
        act === 'take'
          ? 'Another note type has the name this update gives it. Rename that one first.'
          : 'Another note type has this name now. Rename that one first.',
      );
    case 'fixed_field':
      return state(PRESET_SENTENCES.updateChangesFixed);
    case 'archived':
      return state(act === 'remove' ? 'This was removed already.' : 'This was removed. Restore it first.');
    case 'not_archived':
      return state('This is on the list already.');
    case 'no_update':
      return state('There’s no update to take now.');
    case 'not_found':
      return state('This isn’t on your team’s list. Reload the page to see the list as it is now.');
    case 'invalid':
      return state(
        act === 'take'
          ? 'This update doesn’t fit your team’s other note types, so it can’t be taken as it is.'
          : 'This note type doesn’t pass Sineobex’s checks, so it can’t be added as it is. Copy another, or start a blank one.',
      );
    case 'validation_failed': {
      const fields = Array.isArray(details?.fields) ? (details.fields as { path?: unknown }[]) : [];
      const fieldErrors: Record<string, string> = {};
      for (const f of fields) {
        const path = typeof f?.path === 'string' ? f.path.split('.')[0]! : '';
        const said = NOTE_TYPE_FIELD_PROBLEMS[path];
        if (said && !fieldErrors[path] && (act === 'add' || path === 'reason'))
          fieldErrors[path] = field(path, said);
      }
      return Object.keys(fieldErrors).length > 0
        ? state(FIELDS_TITLE, fieldErrors)
        : state('Something in this form isn’t right. Reload the page and try again.');
    }
    default:
      return state(refusal.message || 'Something went wrong. Try again.');
  }
}

/**
 * What an operation the API refused at Publish says (design 5.4), beside the change it refused: the
 * codes of packages/forms' operations. Every refusal is the API's (D114); the editor only says it.
 */
const OPERATION_REFUSALS: Readonly<Record<string, string>> = {
  protected: NOTE_TYPE_SENTENCES.protectedPart,
  not_copyable: NOTE_TYPE_SENTENCES.notCopyable,
  in_use: 'Another field’s question asks about this, or a field fills from it, so it can’t be hidden.',
  not_found:
    'This part isn’t in the note type at this point. Undo this change, or reload to see the note type as it is now.',
  title_invalid: 'Give the note type a title of 1 to 80 characters.',
  label_invalid: 'Type the words it shows: they can’t be left empty.',
  last_option: 'A question needs one answer at least, so its last one can’t be retired.',
  last_field: 'A section needs one field at least, so its last one can’t be hidden.',
  last_section: 'A note type needs one section at least, so its last one can’t be hidden.',
  too_many_fields: 'This note type holds as many fields of your team’s own as it can.',
  too_many_sections: 'This note type holds as many sections of your team’s own as it can.',
  // Said of a section it no longer holds; one it holds now is said by the editor (ID_TAKEN.now).
  id_taken: 'This note type has held this section, or parts of it, before, so it can’t be copied in again.',
  invalid: 'This change doesn’t fit the rest of the note type, so it can’t be made.',
};

/**
 * A copy of a section refused id_taken (design 5.4, rule 3): the note type holds that section now, or
 * held it, or a part of it, in an earlier version. Only the editor knows which, from the version it
 * opened, so it says `now` of a section that version holds; the API's sentence is `before`.
 */
export const ID_TAKEN = {
  now: 'This note type already has this section, so it can’t be copied in again.',
  before: OPERATION_REFUSALS.id_taken!,
} as const;

/**
 * A Publish sent again after its connection dropped, refused stale (D115): a version newer than the
 * one the editor opened is live, which may be that Publish, whose answer was lost on the way.
 */
export function liveAfterDrop(version: number): string {
  return `Version ${version} is live now. It may be the Publish whose answer was lost on the way, or someone else’s. Load it to see which before you publish again.`;
}

/** What a refused Publish says, and which held change it names, where the API names one. */
export interface PublishRefusal {
  error: string;
  /** The held change the API refused, by its place in what was sent. */
  opIndex?: number;
  /** Another note type, where a field of it that the change reaches refused it (rule 5). */
  noteTypeKey?: string;
  fieldErrors?: Record<string, string>;
  /** For stale: the version live now, as the API answered it. */
  currentVersion?: number;
}

/** An answer a condition asks for, retired: what shows only for it would never show (in_use). */
const ASKED_FOR = 'Part of this note type is shown only for this answer, so it can’t be retired.';

/** A number field added with a range no answer fits (the validator's number_range_empty). */
const NO_NUMBER_FITS =
  'No number fits between the lowest and highest it takes, so it could never be answered. Undo it and add it again.';

/** The sentence for an operation's refusal, by its code and, where the words differ, its kind. */
function operationRefusal(
  code: string,
  op: string | undefined,
  details: Record<string, unknown> | undefined,
) {
  if (code === 'in_use' && op === 'retire_option') return ASKED_FOR;
  const problems = Array.isArray(details?.problems) ? (details.problems as { path?: unknown }[]) : [];
  if (code === 'invalid' && problems.some((p) => typeof p?.path === 'string' && p.path.endsWith('.max')))
    return NO_NUMBER_FITS;
  return OPERATION_REFUSALS[code] ?? 'This change can’t be made.';
}

/**
 * A Publish refused (design 7's PUT): an operation's own code names the change by its index, and the
 * editor says it beside that change, in words for its kind (`op`, the operation sent at that index);
 * a refusal of the whole publish says what to do, never which change, since the API names none.
 */
export function publishRefusal(
  code: string,
  details: Record<string, unknown> | undefined,
  op?: string,
): PublishRefusal {
  const opIndex = details?.opIndex;
  const noteTypeKey = details?.noteTypeKey;
  if (typeof opIndex === 'number' && Number.isInteger(opIndex) && opIndex >= 0)
    return {
      error: operationRefusal(code, op, details),
      opIndex,
      ...(typeof noteTypeKey === 'string' ? { noteTypeKey } : {}),
    };
  switch (code) {
    case 'stale': {
      const current = details?.currentVersion;
      return {
        error: PRESET_SENTENCES.stale,
        ...(typeof current === 'number' && Number.isSafeInteger(current) ? { currentVersion: current } : {}),
      };
    }
    case 'archived':
      return {
        error:
          'This note type was removed while you were editing, so nothing was published. Restore it first.',
      };
    case 'no_change':
      return { error: 'These changes leave the note type as it is, so there’s nothing to publish.' };
    case 'not_found':
      return {
        error: 'This note type isn’t on your team’s list. Reload the page to see the list as it is now.',
      };
    case 'invalid':
      // The checks found it in the version as a whole, so no change is named, nor the last one blamed.
      return {
        error:
          'This version doesn’t pass Sineobex’s checks, so it wasn’t published. Undo changes one at a time, pressing Publish after each, to find the one that causes it.',
      };
    case 'validation_failed': {
      const fields = Array.isArray(details?.fields)
        ? (details.fields as { path?: unknown; problem?: unknown }[])
        : [];
      if (fields.some((f) => f?.path === 'reason'))
        return { error: FIELDS_TITLE, fieldErrors: { reason: `Reason: ${REASON_PROBLEM}` } };
      // A change the request's own check refused, such as a number typed as words: named by its place.
      for (const f of fields) {
        const at = typeof f?.path === 'string' ? /^ops\.(\d+)\.(.+)$/.exec(f.path) : null;
        if (!at) continue;
        return {
          error: /(^|\.)(min|max)$/.test(at[2]!)
            ? 'Enter numbers for the lowest and highest it takes.'
            : 'Something in this change isn’t right. Undo it and make it again.',
          opIndex: Number(at[1]),
        };
      }
      const ops = fields.find((f) => typeof f?.path === 'string' && f.path.split('.')[0] === 'ops');
      if (ops?.path === 'ops' && ops.problem === 'too_small')
        return { error: 'Make a change before you publish.' };
      if (ops?.path === 'ops' && ops.problem === 'too_big')
        return {
          error: 'That’s more changes than one publish can hold. Publish some of them, then the rest.',
        };
      return { error: 'Something in these changes isn’t right. Reload the page and try again.' };
    }
    default:
      return { error: 'Something went wrong, so nothing was published. Try again.' };
  }
}
