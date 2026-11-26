import 'server-only';
import type { paths, Schemas } from '@sineobex/contract';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { api, PortalApiError, unwrap } from './api';
import type { ActionState } from './forms';
import { presetRefusalState, type PresetRefusalContext } from './refusals';

/**
 * The admin preset routes as the portal's preset pages call them (phase 5 design 7, 8.1): every
 * list, history and act, typed from the generated contract. The API is the one judge of a preset:
 * it parses each body by its kind's schema, checks it against the team's other presets, and
 * refuses by presetWriteEffect, so nothing here repeats a rule of its own (D114). A page only reads
 * a body in its kind's shape (4.4), which the API holds every stored version to.
 */

/** A kind of preset, as the admin routes' address names it. */
export type PresetKind = paths['/v1/admin/presets/{kind}']['get']['parameters']['path']['kind'];

/** Every kind, so an action can check the one a form sent before it reaches an address. */
export const PRESET_KINDS = [
  'order_category',
  'item',
  'bundle',
  'flag',
  'field_supply_map',
  'condition_supply_map',
  'bag',
  'settings',
] as const satisfies readonly PresetKind[];

// The contract's kinds, every one listed above: a kind the API adds fails the typecheck here.
const EVERY_KIND: Exclude<PresetKind, (typeof PRESET_KINDS)[number]> extends never ? true : never = true;
void EVERY_KIND;

export function isPresetKind(value: unknown): value is PresetKind {
  return (PRESET_KINDS as readonly unknown[]).includes(value);
}

// ------------------------------------------------------------------------------------------------
// Each kind's body, as the pages read it (design 4.4; packages/presets/src/schemas.ts)
// ------------------------------------------------------------------------------------------------

export interface CategoryBody {
  name: string;
  /** What its items are: Supplies, Medications or Tests. Fixed at creation. */
  behaviour: 'supply' | 'medication' | 'lab';
  sort: number;
}

export type LabResult = { type: 'choice'; options: string[] } | { type: 'number'; unit: string };

export interface ItemBody {
  name: string;
  categoryId: string;
  /** What 1 of it is. Fixed at creation. */
  unit: string;
  medical: boolean;
  captureLot: boolean;
  /** Set exactly when its category holds tests. Its type is fixed at creation. */
  result: LabResult | null;
}

export interface BundleLine {
  itemId: string;
  qty: number;
  core: boolean;
}

export interface BundleBody {
  name: string;
  medical: boolean;
  /** Asked before the bundle is applied; empty asks nothing. */
  prompt: string;
  lines: BundleLine[];
}

/** The eight colours a flag can have, each with the plain name its pill shows first ("Red · High"). */
export const FLAG_COLOR_NAMES = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  grey: 'Grey',
} as const;
export type FlagColor = keyof typeof FLAG_COLOR_NAMES;

export interface FlagBody {
  name: string;
  /** The risk level (primary) or a condition (secondary). Fixed at creation. */
  tier: 'primary' | 'secondary';
  criteria: string;
  color: FlagColor;
  /** Its place in its tier's list, lowest first. */
  rank: number;
  /** Fixed at creation. */
  sensitive: boolean;
}

export type AnswerTest = { equals: string | number | true } | { includes: string } | { answered: true };

export interface FieldSupplyBody {
  name: string;
  noteTypeKey: string;
  /** With `when`, or neither: then the map fires once for every note of the type. */
  path?: string;
  when?: AnswerTest;
  lines: { itemId: string; qty: number | { fromPath: string } }[];
}

export interface ConditionSupplyBody {
  name: string;
  codes: string[];
  lines: { itemId: string; qtyPerPatient: number }[];
}

export interface Minimum {
  itemId: string;
  min: number;
}

export interface BagBody {
  name: string;
  minimums: Minimum[];
}

export interface SettingsBody {
  name: 'Team settings';
  bagMinimumsOn: boolean;
  newBagMinimums: Minimum[];
  problemCheckDays: number;
}

interface PresetBodies {
  order_category: CategoryBody;
  item: ItemBody;
  bundle: BundleBody;
  flag: FlagBody;
  field_supply_map: FieldSupplyBody;
  condition_supply_map: ConditionSupplyBody;
  bag: BagBody;
  settings: SettingsBody;
}

/** The body of a preset of kind K. A kind the API adds that has none here fails the typecheck. */
export type BodyOf<K extends PresetKind> = { [P in PresetKind]: PresetBodies[P] }[K];

/** The platform's newer version on offer to a copy, for the person to review before taking it. */
export interface PresetUpdate<K extends PresetKind = PresetKind> {
  /** Sent back with a take, so only the version reviewed is taken (5.1). */
  platformVersion: number;
  /** What taking it writes: the platform's body, naming the team's presets. */
  body: BodyOf<K>;
  /** The fields fixed at creation it changes: with any, it is taken only as a new preset. */
  changesFixed: string[];
}

/** A row of the admin list: a preset with its current body, what names it, and any update. */
export type PresetRow<K extends PresetKind = PresetKind> = Omit<Schemas['PresetView'], 'body' | 'update'> & {
  body: BodyOf<K>;
  update: PresetUpdate<K> | null;
};

export type PresetEvent = Schemas['PresetEvent'];

// ------------------------------------------------------------------------------------------------
// The calls
// ------------------------------------------------------------------------------------------------

/** Every preset of the kind, archived ones included, by name; reading them is not audited (PL-13). */
export async function listPresets<K extends PresetKind>(kind: K): Promise<PresetRow<K>[]> {
  const rows = await unwrap((await api()).GET('/v1/admin/presets/{kind}', { params: { path: { kind } } }));
  return rows as unknown as PresetRow<K>[];
}

/** Every act on one preset, oldest first, with who, when, whose version and why. */
export async function presetHistory(kind: PresetKind, id: string): Promise<PresetEvent[]> {
  return unwrap(
    (await api()).GET('/v1/admin/presets/{kind}/{id}/history', { params: { path: { kind, id } } }),
  );
}

/**
 * The team's settings and their history: the one preset of its kind a team holds (design 4.4),
 * which Condition supplies and Bag minimums both edit, each its own fields. Null when the list
 * holds none, which only a team the installer never reached could be.
 */
export async function teamSettings(): Promise<{
  row: PresetRow<'settings'>;
  history: PresetEvent[];
} | null> {
  const rows = await listPresets('settings');
  const row = rows.find((r) => r.state === 'active') ?? rows[0];
  return row ? { row, history: await presetHistory('settings', row.id) } : null;
}

/**
 * Adds a preset of the team's own at version 1. `body` is what the form sent, in its kind's shape
 * as far as the form can make it: the API answers where it is wrong (`invalid`, with paths).
 */
export async function createPreset(kind: PresetKind, body: unknown, reason: string) {
  return unwrap(
    (await api()).POST('/v1/admin/presets/{kind}', { params: { path: { kind } }, body: { body, reason } }),
  );
}

/** Gives a preset its next version; `baseVersion` is the one the person opened. */
export async function editPreset(
  kind: PresetKind,
  id: string,
  baseVersion: number,
  body: unknown,
  reason: string,
) {
  return unwrap(
    (await api()).PUT('/v1/admin/presets/{kind}/{id}', {
      params: { path: { kind, id } },
      body: { baseVersion, body, reason },
    }),
  );
}

/** Removes a preset (it is archived, never deleted), at the version the person was shown. */
export async function archivePreset(kind: PresetKind, id: string, baseVersion: number, reason: string) {
  return unwrap(
    (await api()).POST('/v1/admin/presets/{kind}/{id}/archive', {
      params: { path: { kind, id } },
      body: { baseVersion, reason },
    }),
  );
}

export async function restorePreset(kind: PresetKind, id: string, reason: string) {
  return unwrap(
    (await api()).POST('/v1/admin/presets/{kind}/{id}/restore', {
      params: { path: { kind, id } },
      body: { reason },
    }),
  );
}

/**
 * Takes the platform update on offer, in place or as a new preset. `platformVersion` is the list
 * row's `update.platformVersion`, `baseVersion` the version shown beside it and `baseState` the
 * row's state: any other answers stale, so only what the person reviewed is taken (5.1).
 */
export async function takePresetUpdate(kind: PresetKind, id: string, take: Schemas['TakePresetUpdate']) {
  return unwrap(
    (await api()).POST('/v1/admin/presets/{kind}/{id}/take-update', {
      params: { path: { kind, id } },
      body: take,
    }),
  );
}

/**
 * Puts a tier's flags in a new order. `flags` is every active flag of the tier, each with the
 * version the list showed it at; the answer is how many moved, so a page reloads the tier before
 * its next move, or that move is refused stale by design (7).
 */
export async function reorderFlags(order: Schemas['ReorderFlags']) {
  return unwrap((await api()).POST('/v1/admin/preset-order/flag', { body: order }));
}

// ------------------------------------------------------------------------------------------------
// The hub (8.1): a card per area, with its count and "Update available"
// ------------------------------------------------------------------------------------------------

/** What a card of the hub counts: a kind of preset, or the team's note types (unit P4). */
export type HubKind = PresetKind | 'note_type';

/** One area of Team setup: a page under /team/presets and the kinds of preset it shows. */
export interface PresetArea {
  key: string;
  title: string;
  href: string;
  /** The kind its count counts. */
  counted: HubKind;
  /** Every kind the page shows, whose update on offer it offers: the settings show on two pages. */
  kinds: readonly HubKind[];
  noun: readonly [one: string, many: string];
}

// In 8.1's order. Field supplies counts its mappings; the note types they name are its page's to read.
export const PRESET_AREAS: readonly PresetArea[] = [
  {
    key: 'categories',
    title: 'Categories',
    href: '/team/presets/categories',
    counted: 'order_category',
    kinds: ['order_category'],
    noun: ['category', 'categories'],
  },
  {
    key: 'items',
    title: 'Items',
    href: '/team/presets/items',
    counted: 'item',
    kinds: ['item'],
    noun: ['item', 'items'],
  },
  {
    key: 'bundles',
    title: 'Bundles',
    href: '/team/presets/bundles',
    counted: 'bundle',
    kinds: ['bundle'],
    noun: ['bundle', 'bundles'],
  },
  {
    key: 'flags',
    title: 'Flags',
    href: '/team/presets/flags',
    counted: 'flag',
    kinds: ['flag'],
    noun: ['flag', 'flags'],
  },
  {
    key: 'field-supplies',
    title: 'Field supplies',
    href: '/team/presets/field-supplies',
    counted: 'field_supply_map',
    kinds: ['field_supply_map'],
    noun: ['mapping', 'mappings'],
  },
  {
    key: 'condition-supplies',
    title: 'Condition supplies',
    href: '/team/presets/condition-supplies',
    counted: 'condition_supply_map',
    kinds: ['condition_supply_map', 'settings'],
    noun: ['mapping', 'mappings'],
  },
  {
    key: 'bag-minimums',
    title: 'Bag minimums',
    href: '/team/presets/bag-minimums',
    counted: 'bag',
    kinds: ['bag', 'settings'],
    noun: ['bag', 'bags'],
  },
  {
    key: 'note-types',
    title: 'Note types',
    href: '/team/presets/note-types',
    counted: 'note_type',
    kinds: ['note_type'],
    noun: ['note type', 'note types'],
  },
];

/** A card of the hub: its count of active presets and whether any is offered an update, or neither. */
export type HubArea = Pick<PresetArea, 'key' | 'title' | 'href' | 'noun'> &
  ({ loaded: true; count: number; updateAvailable: boolean } | { loaded: false });

/** Each kind's list as the hub read it, or 'error' where the API could not be read. */
export type HubLists = Partial<
  Record<HubKind, readonly Pick<PresetRow, 'state' | 'updateOnOffer'>[] | 'error'>
>;

/**
 * The hub's cards from the lists it read. A card counts its kind's active presets, and offers an
 * update when a preset it shows has one, a removed one too: its page offers that one as a new
 * preset, in its Removed list (UpdateOffer), so a badge never points at an offer its page does not
 * show, and never hides one the API would take.
 */
export function hubAreas(lists: HubLists, areas: readonly PresetArea[] = PRESET_AREAS): HubArea[] {
  return areas.map((area) => {
    const { key, title, href, noun } = area;
    const read = area.kinds.map((kind) => lists[kind]);
    if (read.some((list) => list === undefined || list === 'error'))
      return { key, title, href, noun, loaded: false };
    const rows = (kind: HubKind) => lists[kind] as Pick<PresetRow, 'state' | 'updateOnOffer'>[];
    return {
      key,
      title,
      href,
      noun,
      loaded: true,
      count: rows(area.counted).filter((r) => r.state === 'active').length,
      updateAvailable: area.kinds.some((kind) => rows(kind).some((r) => r.updateOnOffer)),
    };
  });
}

/**
 * Reads what the hub's cards show. The first list is asked alone: a person without
 * team.manage_presets is refused there, logged once (access.denied), and sent where the portal
 * sends every refused page, before the others are asked. A list the API cannot answer leaves its
 * cards unloaded, never the whole page; Next's own redirects pass through.
 */
export async function readHub(areas: readonly PresetArea[] = PRESET_AREAS): Promise<HubArea[]> {
  const kinds = [...new Set(areas.flatMap((a) => a.kinds))];
  const settle = async (kind: HubKind) => {
    try {
      return [kind, kind === 'note_type' ? await listNoteTypes() : await listPresets(kind)] as const;
    } catch (err) {
      unstable_rethrow(err);
      return [kind, 'error'] as const;
    }
  };
  const [first, ...rest] = kinds;
  const lists: HubLists = {};
  if (first) {
    const [kind, rows] = await settle(first);
    lists[kind] = rows;
  }
  for (const [kind, rows] of await Promise.all(rest.map(settle))) lists[kind] = rows;
  return hubAreas(lists, areas);
}

// ------------------------------------------------------------------------------------------------
// What a preset form sends, and what it is told
// ------------------------------------------------------------------------------------------------

/**
 * Every text the form sent, so a refused form keeps what was typed, its lines among them; React's
 * own fields for the action are left out.
 */
export function sentValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries())
    if (typeof value === 'string' && !key.startsWith('$ACTION')) out[key] = value;
  return out;
}

/**
 * A whole number as the person typed it into a form, or the text as typed when it is none (a
 * blank, "1.5", "ten"), so the API answers its path and the form says which field to fix. The API
 * holds each field to its own range; this only reads what was typed.
 */
export function wholeNumber(typed: string | undefined): number | string {
  const raw = (typed ?? '').trim();
  return /^\d{1,7}$/.test(raw) ? Number(raw) : raw;
}

/**
 * One preset as the API lists it now, or null when the team holds none of the kind with that ID.
 * An edit sends its form's fields over this body, so whatever the form doesn't show (what a
 * category holds, a flag's place in its tier, a field a later phase adds) goes back as it is. The
 * edit sends the version the person opened, so a body changed since is refused stale, never
 * overwritten.
 */
export async function presetNow<K extends PresetKind>(kind: K, id: string): Promise<PresetRow<K> | null> {
  return (await listPresets(kind)).find((p) => p.id === id) ?? null;
}

/** What a line's quantity is called in its kind's body: a bundle's, a map's, a bag's. */
export type LineQuantity = 'qty' | 'qtyPerPatient' | 'min';

/**
 * The lines ItemLines posted under `name` (`lines.0.itemId`, `lines.0.qty`, `lines.0.core`), in
 * order, as the body holds them. A quantity that is not a whole number is sent as typed, so the
 * API answers its path, and the form shows the person which line to fix.
 */
export function readLines(
  form: FormData,
  name: string,
  options: { quantity: LineQuantity; core?: boolean },
): Record<string, unknown>[] {
  const prefix = `${name}.`;
  let count = 0;
  for (const key of form.keys()) {
    if (!key.startsWith(prefix)) continue;
    const index = Number(key.slice(prefix.length).split('.')[0]);
    if (Number.isInteger(index) && index >= 0) count = Math.max(count, index + 1);
  }
  return Array.from({ length: count }, (_, i) => {
    const text = (field: string) => {
      const v = form.get(`${prefix}${i}.${field}`);
      return typeof v === 'string' ? v : '';
    };
    return {
      itemId: text('itemId'),
      [options.quantity]: wholeNumber(text(options.quantity)),
      ...(options.core ? { core: form.get(`${prefix}${i}.core`) === 'on' } : {}),
    };
  });
}

/**
 * The texts a list of boxes posted under `name` (`result.options.0`, `result.options.1`), in order,
 * each without the spaces around it, which the API refuses and never trims. A box left empty is
 * sent empty, so the API answers its path.
 */
export function readTexts(form: FormData, name: string): string[] {
  const prefix = `${name}.`;
  let count = 0;
  for (const key of form.keys()) {
    const index = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    if (/^\d{1,3}$/.test(index)) count = Math.max(count, Number(index) + 1);
  }
  return Array.from({ length: count }, (_, i) => {
    const v = form.get(`${prefix}${i}`);
    return typeof v === 'string' ? v.trim() : '';
  });
}

/** A page under /team/presets, by path alone: where an act on a preset comes back to. */
const PRESET_PAGE = /^\/team\/presets(\/[a-z0-9-]+)*$/;

/**
 * Where an act comes back to: the page the form asked for, else the one it was sent from, so long
 * as either is a page of Team setup's (a crafted `back` never leaves it); else the hub.
 */
export function presetPage(...paths: (string | null | undefined)[]): string {
  return paths.find((p): p is string => typeof p === 'string' && PRESET_PAGE.test(p)) ?? '/team/presets';
}

/** The page again, saying what was done to which preset: an act's name and an ID, nothing else. */
export function donePath(page: string, done: string, id: string): string {
  return `${page}?${new URLSearchParams({ done, preset: id })}`;
}

/**
 * The refusals another admin's Remove or Restore made meanwhile answer (5.1): a save, a take or a
 * Remove refused `archived`, and a Restore refused `not_archived`. The page, read again, draws the
 * preset in its new state, so the refused form would leave with its sentence and say nothing: the
 * act comes back to the page it was sent from instead, which says so (PresetNotice).
 */
const MEANWHILE: ReadonlySet<string> = new Set(['archived', 'not_archived']);

/**
 * The notice of another admin's act meanwhile that a refusal answers: a MEANWHILE code, or a take
 * refused stale because the copy is no longer in the state it was reviewed in (5.1), which the page
 * now draws in its new place, said as the Remove or Restore that moved it. Null for any other.
 */
export function meanwhileNotice(code: string, details: unknown, sent: string | undefined): string | null {
  if (MEANWHILE.has(code)) return code;
  const state = (details as { state?: unknown } | undefined)?.state;
  if (code !== 'stale' || sent === undefined || state === sent) return null;
  return state === 'archived' ? 'archived' : state === 'active' ? 'not_archived' : null;
}

/** The page again, saying another admin's act refused one on a preset: a code and an ID, nothing else. */
export function refusedPath(page: string, refused: string, id: string): string {
  return `${page}?${new URLSearchParams({ refused, preset: id })}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The preset a form names, as its page wrote it: a kind, an ID and, where the act needs one, the
 * version shown. Null for anything else, which no page of the portal sends.
 */
export function namedPreset(
  values: Record<string, string>,
): { kind: PresetKind; id: string; baseVersion: number | null } | null {
  const { kind, id } = values;
  if (!isPresetKind(kind) || !UUID.test(id ?? '')) return null;
  const base = values.baseVersion === undefined ? null : Number(values.baseVersion);
  if (base !== null && !(Number.isSafeInteger(base) && base >= 1)) return null;
  return { kind, id: id!, baseVersion: base };
}

/**
 * What a preset form shows when the API refused it: the sentence for its refusal (lib/refusals.ts)
 * and, where the API names fields, each beside its field. A refusal another admin's Remove or
 * Restore caused (MEANWHILE) sends the browser back to the page it came from, which says so. Anything
 * that is no refusal, Next's redirects among them (reauth_required to /reauth and back), goes on up.
 */
export async function presetFailure(
  err: unknown,
  values: Record<string, string>,
  context: PresetRefusalContext,
): Promise<ActionState> {
  if (!(err instanceof PortalApiError)) throw err;
  const id = values.id ?? '';
  const notice = meanwhileNotice(err.code, err.details, values.baseState);
  if (notice !== null && UUID.test(id)) {
    const page = presetPage((await headers()).get('x-pathname'));
    revalidatePath(page);
    redirect(refusedPath(page, notice, id.toLowerCase()));
  }
  return presetRefusalState(err, values, context);
}

// ------------------------------------------------------------------------------------------------
// Note types (phase 5 design 5.4, 7, 8.1): the note type pages read and change them here. A team
// changes a note type through fixed operations (5.4), never by writing a definition; what each does,
// what is protected and every refusal are the API's (packages/forms through the admin routes), so
// nothing here repeats a rule (D114). A page reads a definition in the format of @sineobex/forms,
// which the API holds every stored version to.
// ------------------------------------------------------------------------------------------------

/** Which encounters offer a note type: Medical only, Non-Medical only, or both (D56). */
export type NoteTypeKind = 'medical' | 'non_medical';
/** A note type's timeline group, fixed at creation. */
export type NoteTypeGroup = 'clinical' | 'psych' | 'social' | 'outreach' | 'harm_reduction' | 'wound';

/** An option of a choice, with phase 4's marks as it carries them (forms 2.2). */
export interface NoteTypeOption {
  code: string;
  label: string;
  [mark: string]: unknown;
}

/** A field of a note type, a group's fields among them. */
export interface NoteTypeField {
  id: string;
  kind: string;
  label: string;
  options?: NoteTypeOption[];
  fields?: NoteTypeField[];
  [mark: string]: unknown;
}

export interface NoteTypeSection {
  id: string;
  title: string;
  fields: NoteTypeField[];
  [mark: string]: unknown;
}

/** A resolved definition, as GET /v1/admin/note-types answers each one (packages/forms). */
export interface NoteTypeDefinition {
  key: string;
  version: number;
  title: string;
  kinds: NoteTypeKind[];
  group: NoteTypeGroup;
  sensitivity: 'none' | 'sensitive';
  quick?: true;
  auto?: 'medical';
  sections: NoteTypeSection[];
}

/** What an edit may not touch (design 5.4): sections by id, fields by path, options by path and code. */
export interface ProtectedParts {
  /** Nothing in it can be changed, its title and what an edit would add included: the Red flags note. */
  whole: boolean;
  sections: string[];
  fields: string[];
  options: { path: string; code: string }[];
}

/** A row of the admin list of note types (design 7). */
export interface NoteTypeRow {
  key: string;
  title: string;
  state: 'active' | 'archived';
  /** Its current version: a publish, a Remove and a take send it back. */
  version: number;
  customized: boolean;
  updateOnOffer: boolean;
  updateChangesFixed: boolean;
  /** The platform version on offer, as taking it in place would write it; null when none is. */
  update: { platformVersion: number; definition: NoteTypeDefinition; changesFixed: string[] } | null;
  /** The active field supply maps that name it ({field_supply_map: n}); it can't be removed while any do. */
  referencedBy: Record<string, number>;
  definition: NoteTypeDefinition;
  protected: ProtectedParts;
  /** What earlier versions had and the current one lacks, newest first (design 5.4, 8.1). */
  hidden: HiddenPart[];
  /**
   * The sections a copy from it reads: the platform's newest for a platform note type, else its
   * current; each with the ids and codes the team made in it (`t_` and a number), its own among them.
   */
  copySections: { id: string; title: string; made: string[] }[];
}

/**
 * A part an earlier version had and the current one lacks, in the words of the newest version that
 * had it: a section by its id, a field by its path, an answer by its field's path and its code.
 * Show again is offered where the API says it copies one back (`showAgain`); `part` is a section or a
 * field as that version held it, so what is inside it can be named.
 */
export interface HiddenPart {
  kind: 'section' | 'field' | 'option';
  path: string;
  code?: string;
  words: string;
  showAgain: boolean;
  part?: NoteTypeSection | NoteTypeField;
}

/** One operation of a publish (design 5.4), as packages/forms writes it. */
export type NoteTypeEdit = { op: string } & Record<string, unknown>;

/** One act in a note type's history, as the history route answers it: who, when, whose version, why. */
export type NoteTypeEvent = Schemas['NoteTypeEvent'];

/** Every note type of the team, removed ones included, by title; reading them is not audited (PL-13). */
export async function listNoteTypes(): Promise<NoteTypeRow[]> {
  const rows = await unwrap((await api()).GET('/v1/admin/note-types'));
  return rows as unknown as NoteTypeRow[];
}

/** Every act on one note type, oldest first, with who, when, whose version and why. */
export async function noteTypeHistory(key: string): Promise<NoteTypeEvent[]> {
  return unwrap((await api()).GET('/v1/admin/note-types/{key}/history', { params: { path: { key } } }));
}

/** Adds a note type: blank, with its kinds and timeline group, or a copy of one the team has. */
export async function createNoteType(
  body: { title: string; reason: string } & ({ copyOf: string } | { kinds: NoteTypeKind[]; group: string }),
): Promise<{ key: string; version: 1 }> {
  // A group the form sent as typed: the API answers one that is none of the six at its path.
  return unwrap((await api()).POST('/v1/admin/note-types', { body: body as Schemas['CreateNoteType'] }));
}

/** Removes a note type (it is archived, never deleted), at the version the person was shown. */
export async function archiveNoteType(
  key: string,
  baseVersion: number,
  reason: string,
): Promise<{ revision: number }> {
  return unwrap(
    (await api()).POST('/v1/admin/note-types/{key}/archive', {
      params: { path: { key } },
      body: { baseVersion, reason },
    }),
  );
}

export async function restoreNoteType(key: string, reason: string): Promise<{ revision: number }> {
  return unwrap(
    (await api()).POST('/v1/admin/note-types/{key}/restore', { params: { path: { key } }, body: { reason } }),
  );
}

/**
 * Takes the platform update on offer, in place or as a new note type, as a preset's is taken (5.1):
 * `platformVersion` is the list row's `update.platformVersion` and `baseVersion` the version shown
 * beside it, so only what the person reviewed is taken.
 */
export async function takeNoteTypeUpdate(
  key: string,
  take: { baseVersion: number; platformVersion: number; asNew: boolean; reason: string },
): Promise<{ key: string; version: number; revision: number }> {
  return unwrap(
    (await api()).POST('/v1/admin/note-types/{key}/take-update', { params: { path: { key } }, body: take }),
  );
}

/** What the API answered a Publish: the version it made, or its refusal as it came. */
export type PublishOutcome =
  | { published: { version: number; alsoPublished: string[] } }
  | { refused: { status: number; code: string; details?: Record<string, unknown> } };

/**
 * Publishes the operations the editor held, as the note type's next version (design 5.4), and
 * answers what the API said, a refusal included: the editor's route handler says it (publish/
 * answer.ts), and never redirects, since a redirect would lose what the editor holds.
 */
export async function publishNoteType(
  key: string,
  body: { baseVersion: number; ops: NoteTypeEdit[]; reason: string },
): Promise<PublishOutcome> {
  const { data, error, response } = await (
    await api()
  ).PUT('/v1/admin/note-types/{key}', {
    params: { path: { key } },
    // Each operation as the editor made it: the API checks its shape and its values (D114).
    body: body as unknown as Schemas['PublishNoteType'],
  });
  if (response.ok && data) return { published: { version: data.version, alsoPublished: data.alsoPublished } };
  const refused = (error as { error?: { code?: unknown; details?: unknown } } | undefined)?.error;
  const details = refused?.details;
  return {
    refused: {
      status: response.status,
      code: typeof refused?.code === 'string' ? refused.code : 'error',
      ...(details !== null && typeof details === 'object'
        ? { details: details as Record<string, unknown> }
        : {}),
    },
  };
}
