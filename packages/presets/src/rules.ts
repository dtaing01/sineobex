/**
 * What each act on a preset does and refuses (phase 5 design 5.1, 5.3), and what is fixed at
 * creation (4.4, D132). The admin routes refuse by presetWriteEffect and reorderRanks (P1); the
 * preset installer and the platform data's check read changedFixedFields.
 * packages/contract/test-vectors/preset-rules.json pins them.
 *
 * Pure, and in the API's edge bundle: it imports nothing but this package's types.
 */
import type { PresetBody, PresetKind } from './schemas.ts';

export type PresetAct =
  | 'create'
  | 'edit'
  | 'archive'
  | 'restore'
  | 'take_update'
  | 'take_update_as_new'
  /**
   * What a reorder does to each flag of the tier it sends: whether it refuses the order, and what
   * it writes for each one reorderRanks moves.
   */
  | 'reorder';

/** What an act reads, worked out by the route from the head, the body sent and the team's presets. */
export type PresetWriteInput = {
  act: PresetAct;
  kind: PresetKind;
  /** The head's; null for a create. */
  state: 'active' | 'archived' | null;
  /**
   * The version the admin's form was loaded at, or a reorder's list showed the flag at; null for a
   * create and a restore.
   */
  baseVersion: number | null;
  /** The head's; null for a create. */
  currentVersion: number | null;
  /** The body sent changes a field fixed at creation, against the current one. */
  changedFixed: boolean;
  /** The body sent is the current one. */
  sameBody: boolean;
  /** The active presets that point at this one, counted by kind. */
  referencedBy: Partial<Record<PresetKind, number>>;
  /** How many archived presets the new body points at. */
  archivedRefs: number;
  /** Another active preset of the kind holds the name the act would give this one. */
  nameTaken: boolean;
  /** platform_latest is above origin_version. */
  updateOnOffer: boolean;
  /** The newest platform body changes a field fixed at creation. */
  updateChangesFixed: boolean;
};

export type PresetRefusal =
  | 'archived'
  | 'not_archived'
  | 'stale'
  | 'no_change'
  | 'fixed_field'
  | 'name_taken'
  | 'reference_archived'
  | 'referenced'
  | 'not_removable'
  | 'no_update';

export type PresetHeadAfter = {
  stateAfter: 'active' | 'archived';
  versionAfter: number;
  customizedAfter: boolean;
};
/** A refusal, or the head after the act; taking an update as new also makes `created`. */
export type PresetWriteEffect = { refuse: PresetRefusal } | (PresetHeadAfter & { created?: PresetHeadAfter });

type Check = readonly [PresetRefusal, (input: PresetWriteInput) => boolean];

const archived: Check = ['archived', (i) => i.state === 'archived'];
// Any base but the current version: the admin's form was loaded before another write.
const stale: Check = ['stale', (i) => i.baseVersion !== i.currentVersion];
const nameTaken: Check = ['name_taken', (i) => i.nameTaken];
const pointsAtArchived: Check = ['reference_archived', (i) => i.archivedRefs > 0];
const referenced = (i: PresetWriteInput) => Object.values(i.referencedBy).some((count) => count > 0);
// The one settings preset per team: archiving it would leave the team with none.
const settings: Check = ['not_removable', (i) => i.kind === 'settings'];
const noUpdate: Check = ['no_update', (i) => !i.updateOnOffer];

// PLAN-OPEN (PL-12): is a preset nobody uses deleted, or archived like the rest? Archived: no act
// deletes, so every old note, order and report can still name what it used.
// PLAN-OPEN (BM-78): what happens to the patients who carry a flag when it is archived? Nothing:
// patients are not presets, so a flag is archived whoever carries it, and stays on each of them.
/** Each act's refusals, in the order they are tried: the first that holds is the answer. */
const REFUSALS: { readonly [A in PresetAct]: readonly Check[] } = {
  create: [nameTaken, pointsAtArchived],
  edit: [
    archived,
    stale,
    ['no_change', (i) => i.sameBody],
    ['fixed_field', (i) => i.changedFixed],
    nameTaken,
    pointsAtArchived,
  ],
  archive: [settings, archived, stale, ['referenced', referenced]],
  restore: [['not_archived', (i) => i.state !== 'archived'], nameTaken, pointsAtArchived],
  // PLAN-OPEN (PL-20): may a platform update change a field fixed at creation? No: it is taken only
  // as a new preset, the old one archived.
  take_update: [
    archived,
    stale,
    noUpdate,
    ['fixed_field', (i) => i.updateChangesFixed],
    nameTaken,
    pointsAtArchived,
  ],
  // The old one is archived, which no active preset may point at; one archived already stays as it is.
  take_update_as_new: [
    settings,
    stale,
    noUpdate,
    ['referenced', (i) => i.state === 'active' && referenced(i)],
    nameTaken,
    pointsAtArchived,
  ],
  // Each flag of the tier is read at the version the admin's list showed it, moved or not, so an
  // order never puts back a rank another write set since; a list that has gained or lost a flag
  // is reorderRanks' ids_mismatch. Only an active flag has a rank in a list.
  reorder: [archived, stale],
};

const head = (stateAfter: 'active' | 'archived', versionAfter: number, customizedAfter: boolean) => ({
  stateAfter,
  versionAfter,
  customizedAfter,
});

/**
 * What an act does to the head, or why it is refused. An edit, an archive, a restore and a reorder
 * make the copy the team's own (`customized`), so no platform update overwrites it (PRD main 387):
 * a platform version of a flag the team ranked would put its own rank back. Taking an update gives
 * the copy back to the platform.
 */
export function presetWriteEffect(input: PresetWriteInput): PresetWriteEffect {
  const refused = REFUSALS[input.act].find(([, holds]) => holds(input));
  if (refused) return { refuse: refused[0] };
  const version = input.currentVersion ?? 0;
  switch (input.act) {
    case 'create':
      return head('active', 1, false);
    case 'edit':
      return head('active', version + 1, true);
    case 'archive':
      return head('archived', version, true);
    case 'restore':
      return head('active', version, true);
    case 'take_update':
      return head('active', version + 1, false);
    case 'take_update_as_new':
      return { ...head('archived', version, true), created: head('active', 1, false) };
    case 'reorder':
      return head('active', version + 1, true);
  }
}

/**
 * The tier's flags whose rank a new order changes, in that order: each flag's rank is its place,
 * counting from 1, times 10, so a flag added later can be placed between two. `ordered` must hold
 * every active flag of the tier once, and nothing else: a list loaded before another admin's
 * change would otherwise drop or revive a flag. Every flag of the order is then asked of
 * presetWriteEffect's `reorder` at the version the list showed it, and each flag this answers is
 * written as that says: its next version, the team's own.
 */
export function reorderRanks(
  current: readonly { id: string; rank: number }[],
  ordered: readonly string[],
): { id: string; rank: number }[] | { refuse: 'ids_mismatch' } {
  const ranks = new Map(current.map(({ id, rank }) => [id, rank]));
  if (
    ordered.length !== ranks.size ||
    new Set(ordered).size !== ordered.length ||
    !ordered.every((id) => ranks.has(id))
  )
    return { refuse: 'ids_mismatch' };
  return ordered.flatMap((id, i) => (ranks.get(id) === (i + 1) * 10 ? [] : [{ id, rank: (i + 1) * 10 }]));
}

// PLAN-OPEN (BM-64): can an item's unit change after it is made? No: the item is archived and a new
// one added, so old counts keep their meaning.
// PLAN-OPEN (PL-20): may a flag's sensitivity change after it is made? No, as its tier cannot.
/**
 * Each kind's fields fixed at creation, in the order changedFixedFields reports them: what a count,
 * a rank or a reader means (D132). An item's `result.type` is null without a result, so no item
 * moves into or out of a lab category; a map's `path` is null on a map on every note.
 */
export const FIXED_FIELDS: { readonly [K in PresetKind]: readonly string[] } = {
  order_category: ['behaviour'],
  item: ['unit', 'result.type'],
  bundle: [],
  flag: ['tier', 'sensitive'],
  field_supply_map: ['noteTypeKey', 'path'],
  condition_supply_map: [],
  bag: [],
  settings: [],
};

/** The fields fixed at creation that `after` changes from `before`. */
export function changedFixedFields(kind: PresetKind, before: PresetBody, after: PresetBody): string[] {
  return FIXED_FIELDS[kind].filter((field) => valueAt(before, field) !== valueAt(after, field));
}

/** A dotted field of a body, null where the body has none. Every fixed field holds a text or a tick. */
function valueAt(body: PresetBody, field: string): unknown {
  let value: unknown = body;
  for (const part of field.split('.'))
    value =
      value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  return value ?? null;
}
