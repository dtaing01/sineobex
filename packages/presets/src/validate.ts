/**
 * What a preset body's schema cannot hold (phase 5 design 4.4): the rules that read the team's
 * other presets and its note types. validatePreset runs on a body its kind's schema accepted
 * (schemas.ts). The admin routes answer 422 with its problems' paths, 409 for reference_archived
 * (P1); the installer skips and counts a platform entry it refuses (install.ts).
 * packages/contract/test-vectors/preset-validate.json pins it.
 *
 * Pure, and in the API's edge bundle: nothing here may import a package but zod and the forms index
 * (test/import-path.test.ts).
 */
import { checkAnswer, fieldAt, mayBeHidden } from '@sineobex/forms';
import type { AnswerTest, PathTarget, ResolvedNoteType } from '@sineobex/forms';
import type {
  BagBody,
  BundleBody,
  ConditionSupplyMapBody,
  FieldSupplyMapBody,
  FlagBody,
  ItemBody,
  PresetBody,
  PresetKind,
  SettingsBody,
} from './schemas.ts';

/**
 * A preset of the team, as the rules read it. A category carries its behaviour and an item its
 * category's, since the rules on results, the Medical switch and a bundle's tag read it; the heads
 * hold none, so a caller reads it from the bodies. A preset of any other kind carries none.
 */
export type PresetRef =
  | {
      kind: 'order_category' | 'item';
      state: 'active' | 'archived';
      behaviour: 'supply' | 'medication' | 'lab';
    }
  | { kind: Exclude<PresetKind, 'order_category' | 'item'>; state: 'active' | 'archived' };

const BEHAVIOURS: ReadonlySet<unknown> = new Set(['supply', 'medication', 'lab']);

/**
 * Whether a ref carries what the rules read of its kind. A category or an item given without a
 * behaviour, as refs read from the heads alone would be, is not: the result, Medical and bundle
 * rules would pass whatever they were asked for want of it.
 */
const readable = (ref: PresetRef) =>
  (ref.kind !== 'order_category' && ref.kind !== 'item') ||
  BEHAVIOURS.has((ref as { behaviour?: unknown }).behaviour);

const behaviourOf = (ref: PresetRef | null) =>
  ref !== null && 'behaviour' in ref ? ref.behaviour : undefined;

export type PresetProblemCode =
  | 'unknown_reference'
  | 'wrong_kind'
  | 'reference_archived'
  | 'result_mismatch'
  | 'medical_mismatch'
  | 'bundle_not_medical'
  | 'primary_sensitive'
  | 'unknown_note_type'
  | 'unknown_path'
  | 'path_kind'
  | 'when_invalid'
  | 'from_path'
  | 'sensitive_path'
  | 'settings_taken';

/** `path` is the body path at fault, its parts joined by dots, '' for the body itself. */
export type PresetProblem = { path: string; code: PresetProblemCode };

/**
 * The problems of a body against the team's presets and note types; none is `[]`. Every id is
 * checked, whatever else fails, and an id that names an archived preset is still read: an archived
 * Labs category still asks its item for a result. One settings preset per team.
 */
export function validatePreset(input: {
  kind: PresetKind;
  /** A body BODY_SCHEMAS[kind] accepted, as it parsed. */
  body: PresetBody;
  /** The team's presets by id. */
  refs: Readonly<Record<string, PresetRef>>;
  /** The current definition of each of the team's active note types, by key. */
  definitions: Readonly<Record<string, ResolvedNoteType>>;
  /** The preset's own id; null for one not made yet. */
  id: string | null;
}): PresetProblem[] {
  const problems: PresetProblem[] = [];
  const { refs } = input;
  /** The preset an id names, if it is one of the team's of the right kind; null otherwise. */
  const ref = (path: string, id: string, kind: PresetKind): PresetRef | null => {
    const found = Object.hasOwn(refs, id) ? refs[id] : undefined;
    // Another team's preset is not among refs, so it is unknown here too; so is one given without
    // what the rules read of it, which nothing here guesses.
    if (!found || !readable(found)) problems.push({ path, code: 'unknown_reference' });
    else if (found.kind !== kind) problems.push({ path, code: 'wrong_kind' });
    else {
      if (found.state === 'archived') problems.push({ path, code: 'reference_archived' });
      return found;
    }
    return null;
  };
  const items = (field: string, lines: readonly { itemId: string }[]) =>
    lines.map((line, i) => ref(`${field}.${i}.itemId`, line.itemId, 'item'));

  switch (input.kind) {
    case 'order_category':
      break;
    case 'item': {
      const body = input.body as ItemBody;
      // Nothing is read from a category that is not one.
      const behaviour = behaviourOf(ref('categoryId', body.categoryId, 'order_category'));
      if (behaviour === undefined) break;
      // What a category's behaviour asks of its items is why it is fixed at creation (rules.ts): an
      // item never moves into or out of a lab category.
      if ((body.result !== null) !== (behaviour === 'lab'))
        problems.push({ path: 'result', code: 'result_mismatch' });
      // PLAN-OPEN (BM-63): do safer-use supplies and naloxone count as Non-Medical? An item is
      // Medical in a medication or Labs category; its switch is free only in a supply category, so a
      // team that treats naloxone as Non-Medical moves it there.
      if (behaviour !== 'supply' && !body.medical)
        problems.push({ path: 'medical', code: 'medical_mismatch' });
      break;
    }
    case 'bundle': {
      const body = input.body as BundleBody;
      // A bundle holding a medication is Medical (PRD main 447); a Labs item does not make it so.
      const medication = items('lines', body.lines).some((item) => behaviourOf(item) === 'medication');
      if (medication && !body.medical) problems.push({ path: 'medical', code: 'bundle_not_medical' });
      break;
    }
    case 'flag': {
      const body = input.body as FlagBody;
      // A risk level orders the lists every reader works from (PRD main 120, 317); what is sensitive
      // about a patient is a condition, such as pregnancy (main 121).
      if (body.tier === 'primary' && body.sensitive)
        problems.push({ path: 'sensitive', code: 'primary_sensitive' });
      break;
    }
    case 'field_supply_map': {
      const body = input.body as FieldSupplyMapBody;
      items('lines', body.lines);
      problems.push(...mapProblems(body, input.definitions));
      break;
    }
    case 'condition_supply_map':
      // PLAN-OPEN (BM-77): a condition map may name a code on phase 3's sensitive list; phases 6 and
      // 7 count it only for a reader who may see sensitive problems.
      items('lines', (input.body as ConditionSupplyMapBody).lines);
      break;
    case 'bag':
      items('minimums', (input.body as BagBody).minimums);
      break;
    case 'settings': {
      items('newBagMinimums', (input.body as SettingsBody).newBagMinimums);
      // An archived settings preset is still the team's one: it is restored, never made again.
      if (Object.entries(refs).some(([id, r]) => r.kind === 'settings' && id !== input.id))
        problems.push({ path: '', code: 'settings_taken' });
      break;
    }
  }
  return problems;
}

/**
 * The active bundles a change to an item leaves holding a medication while Non-Medical (design 4.4;
 * PRD main 447: such a bundle needs a Medical encounter, an ordering credential and the allergy
 * check): each that names the item and that validatePreset finds bundle_not_medical against the
 * team's refs as the change leaves them (`after`), and not against them as they were (`before`). A
 * bundle checks the rule on its own write; an item moved into a medication category is checked
 * here, as the store's edit and update taken in place and the installer's update move one. A bundle
 * that breaks the rule already, by another of its items, is not this change's to answer for.
 */
export function bundlesLeftNotMedical(input: {
  itemId: string;
  /** The team's presets as the change finds them; only its active bundles are read. */
  presets: Iterable<{ id: string; kind: PresetKind; state: 'active' | 'archived'; body: PresetBody | null }>;
  before: Readonly<Record<string, PresetRef>>;
  after: Readonly<Record<string, PresetRef>>;
}): string[] {
  const notMedical = (id: string, body: BundleBody, refs: Readonly<Record<string, PresetRef>>) =>
    validatePreset({ kind: 'bundle', body, refs, definitions: {}, id }).some(
      (p) => p.code === 'bundle_not_medical',
    );
  const left: string[] = [];
  for (const p of input.presets) {
    if (p.kind !== 'bundle' || p.state !== 'active' || p.body === null) continue;
    const body = p.body as BundleBody;
    if (!body.lines.some((line) => line.itemId === input.itemId)) continue;
    if (notMedical(p.id, body, input.after) && !notMedical(p.id, body, input.before)) left.push(p.id);
  }
  return left;
}

// An entry's ID, any one: fieldAt finds a field of a repeating section only by an answer's path,
// and a map fires alike in every entry.
const AN_ENTRY = 'e0000000';

// PLAN-OPEN (BM-71): which fields may be mapped to supplies? A field or a grid cell that holds a
// choice, a number or a tick, and for "answered" also a text, a date or a duration; or every note
// of a type. Never a part only some readers may see (BM-77).
/** What a map may fire on. A time, and what stores nothing (a group, a grid as a whole, ...), are not. */
const MAPPED: ReadonlySet<string> = new Set(['codes', 'number', 'flag', 'text', 'date', 'duration']);

/**
 * A map's path, then each quantity read from the note. A note type the team does not offer, or a
 * sensitive one, stops both. The path reports the first that fails of unknown_path, path_kind,
 * when_invalid and sensitive_path; each fromPath, from_path then sensitive_path.
 */
function mapProblems(
  map: FieldSupplyMapBody,
  definitions: Readonly<Record<string, ResolvedNoteType>>,
): PresetProblem[] {
  const definition = Object.hasOwn(definitions, map.noteTypeKey) ? definitions[map.noteTypeKey] : undefined;
  if (!definition) return [{ path: 'noteTypeKey', code: 'unknown_note_type' }];
  // PLAN-OPEN (BM-77): may a supply mapping read a sensitive answer? No: nothing of a sensitive
  // note type, and nothing visibleAnswers may take out from a reader who may read the note.
  if (mayBeHidden(definition)) return [{ path: 'noteTypeKey', code: 'sensitive_path' }];
  const problems: PresetProblem[] = [];
  // Where the map fires: a field or a cell, or with no path (or none that can fire) every note.
  let fires: PathTarget | null = null;
  if (map.path !== undefined && map.when !== undefined) {
    const target = answerAt(definition, map.path);
    if (!target) problems.push({ path: 'path', code: 'unknown_path' });
    else if (target.holds === null || !MAPPED.has(target.holds.type))
      problems.push({ path: 'path', code: 'path_kind' });
    else {
      fires = target;
      if (!fits(definition, target, map.path, map.when))
        problems.push({ path: 'when', code: 'when_invalid' });
      else if (mayBeHidden(definition, map.path, map.when))
        problems.push({ path: 'path', code: 'sensitive_path' });
    }
  }
  map.lines.forEach((line, i) => {
    if (typeof line.qty === 'number') return;
    const at = `lines.${i}.qty.fromPath`;
    const from = answerAt(definition, line.qty.fromPath);
    if (!from || from.holds?.type !== 'number' || !oneAnswerWhere(from, fires))
      problems.push({ path: at, code: 'from_path' });
    else if (mayBeHidden(definition, line.qty.fromPath)) problems.push({ path: at, code: 'sensitive_path' });
  });
  return problems;
}

/**
 * What a path, written without an entry part, names: a field's or a grid cell's own answer, or a
 * field's or a cell's own path where nothing is stored. Not an entry's own answer, the text of an
 * Other option, a side, or a region's or a diagnosis's part: a map fires on a field, not a part.
 */
function answerAt(definition: ResolvedNoteType, path: string): PathTarget | null {
  const target = fieldAt(definition, inAnEntry(definition, path));
  if (!target || (target.points !== 'field' && target.points !== 'cell')) return null;
  return target.side === null && target.part === null ? target : null;
}

/** The path as a note's answer holds it: in a repeating section, with an entry's part put back. */
function inAnEntry(definition: ResolvedNoteType, path: string): string {
  const [section, ...rest] = path.split('.');
  const repeats = definition.sections.find((s) => s.id === section)?.repeat !== undefined;
  return repeats ? [section, AN_ENTRY, ...rest].join('.') : path;
}

/**
 * Whether a test fits the field: `answered` fits every field a map fires on; `includes` names a
 * code a choice holds; `equals` a code a choice holds, a number the field takes, or true for a tick.
 */
function fits(definition: ResolvedNoteType, target: PathTarget, path: string, when: AnswerTest): boolean {
  if ('answered' in when) return true;
  const holds = target.holds!;
  if ('includes' in when)
    return holds.type === 'codes' && holds.options.some((o) => o.code === when.includes);
  switch (holds.type) {
    case 'codes':
      return holds.options.some((o) => o.code === when.equals);
    case 'number':
      return (
        typeof when.equals === 'number' &&
        checkAnswer(definition, inAnEntry(definition, path), when.equals) === null
      );
    case 'flag':
      return when.equals === true;
    default:
      return false;
  }
}

/**
 * Whether a number has one answer where a map fires, so a quantity can be read from it: a map on a
 * grid's cell reads a cell in the same row of the same grid; a map in a repeating section, a field
 * of its own section, so of the same entry; any other map, a map on every note included, a field
 * outside every repeating section.
 */
function oneAnswerWhere(from: PathTarget, fires: PathTarget | null): boolean {
  if (fires?.points === 'cell')
    return from.points === 'cell' && from.row === fires.row && from.leaf?.node.grid === fires.leaf?.node.grid;
  if (fires?.section.repeat) return from.section.id === fires.section.id;
  return from.section.repeat === undefined;
}
