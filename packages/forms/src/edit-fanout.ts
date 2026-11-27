/**
 * One master list per field (phase 5 design 5.4, rule 5; PRD main 410 as PL-17 reads it). Stored
 * definitions are resolved, with no list to edit once, so an option operation on a field is also
 * applied to the field it maps to and to every field of the team's note types that maps to that
 * one, or to it: the quick form and the full modules it maps into (`mapsTo`). Each note type it
 * changes gets its next version in the publish's one transaction, a new code is the same in each,
 * and a protected field anywhere it reaches refuses the whole operation, naming that note type. An
 * `auto` note type is never reached. Other operations reach nothing.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import { canonicalJson } from './canonical.ts';
import {
  applyNoteTypeEdit,
  declaredRenames,
  OPTION_EDIT_OPS,
  type NoteTypeEdit,
  type NoteTypeEditRefusal,
} from './edit.ts';
import { copyPart, fieldPlace } from './edit-protected.ts';
import type { ResolvedField, ResolvedNoteType, ResolvedSection } from './resolve.ts';
import type { Rename } from './types.ts';

/** A field of one of the team's note types. */
export type NoteTypeField = { key: string; path: string };

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every field that stores an answer under its own path, at any depth but a grid's cell. */
function pathsOfFields(sections: readonly ResolvedSection[]): { path: string; field: ResolvedField }[] {
  const found: { path: string; field: ResolvedField }[] = [];
  const walk = (fields: readonly ResolvedField[], prefix: string) => {
    for (const field of fields) {
      const path = `${prefix}.${field.id}`;
      found.push({ path, field });
      if (field.kind === 'group') walk(field.fields, path);
    }
  };
  for (const section of sections) walk(section.fields, section.id);
  return found;
}

/** The note types a definition's fields map into, by key, a grid's cell among them. */
function mappedKeys(definition: ResolvedNoteType): Set<string> {
  const keys = new Set<string>();
  const walk = (fields: readonly ResolvedField[]) => {
    for (const field of fields) {
      if (field.mapsTo !== undefined) keys.add(field.mapsTo.split(':')[0]!);
      if (field.kind === 'group') walk(field.fields);
      if (field.kind === 'grid') walk([field.cell]);
    }
  };
  for (const section of definition.sections) walk(section.fields);
  return keys;
}

// PLAN-OPEN (PL-17): how does a team's edit keep "one master list per field" (PRD main 410) when
// stored definitions hold no lists? An option operation follows mapsTo between the quick form and
// the full note types it maps into; other fields that shared a list are edited one by one.
/**
 * The fields an option operation on `path` of note type `key` reaches besides itself: the field it
 * maps to, and every field that maps to that one or to it, in note types other than `key` that are
 * in `team` and not `auto`, by key and then path. Only a choice field, outside a grid's cell, holds
 * options to keep in step, and only one that is there is reached. `team` holds the current version
 * of each of the team's note types, the edited one included, and removed ones too: a removed one
 * keeps its mapsTo and comes back as it is, so its list moves with the others.
 */
export function optionReach(
  key: string,
  path: string,
  team: Readonly<Record<string, ResolvedNoteType>>,
): NoteTypeField[] {
  const own = Object.hasOwn(team, key) ? team[key]! : undefined;
  const field = own && fieldPlace(own, path)?.field;
  if (field?.kind !== 'choice') return [];
  // The master list: the field it maps into, or the field itself when it maps nowhere.
  const masters = new Set([`${key}:${path}`]);
  if (field.mapsTo !== undefined) masters.add(field.mapsTo);
  const reached: NoteTypeField[] = [];
  for (const other of Object.keys(team).sort(byCodePoint)) {
    const definition = team[other]!;
    if (other === key || definition.auto !== undefined) continue;
    const here = pathsOfFields(definition.sections)
      .filter(
        ({ path: at, field: f }) =>
          f.kind === 'choice' &&
          (masters.has(`${other}:${at}`) || (f.mapsTo !== undefined && masters.has(f.mapsTo))),
      )
      .map(({ path: at }) => at)
      .sort(byCodePoint);
    for (const at of here) reached.push({ key: other, path: at });
  }
  return reached;
}

/**
 * Every note type besides `key` that an option operation of a publish on `key` may reach, whatever
 * its operations: what a caller reads every version of before it calls editNoteTypes, so a code it
 * makes is above every one each note type it reaches has used (rule 3), and the others at their
 * current version alone. A field maps only in a quick note type (validate's maps_to_not_quick), and
 * a quick type's fields come from its own versions or, by a copy, from another quick type's or the
 * platform's. So these are the note types a mapsTo names in any version of `key` (and, for a quick
 * `key`, in the team's quick types and the platform's), and the note types whose current version
 * maps into one of those or into `key`; never an `auto` one. `team` holds the current version of
 * each of the team's note types, removed ones too, `key`'s among them or not.
 */
export function mayReach(input: {
  key: string;
  versions: readonly ResolvedNoteType[];
  team: Readonly<Record<string, ResolvedNoteType>>;
  platform: Readonly<Record<string, ResolvedNoteType>>;
}): string[] {
  const { key, versions, team, platform } = input;
  const quick = versions.at(-1)?.quick === true;
  const sources = quick
    ? [
        ...versions,
        ...Object.values(platform).filter((d) => d.quick === true),
        ...Object.values(team).filter((d) => d.quick === true),
      ]
    : versions;
  const named = new Set([key]);
  for (const definition of sources) for (const k of mappedKeys(definition)) named.add(k);
  return Object.keys(team)
    .filter((k) => {
      const definition = team[k]!;
      if (k === key || definition.auto !== undefined) return false;
      return named.has(k) || [...mappedKeys(definition)].some((target) => named.has(target));
    })
    .sort(byCodePoint);
}

/** A publish's answer across the team: each note type it changes, the edited one first, or its refusal. */
export type NoteTypeTeamOutcome =
  | { ok: true; published: { key: string; definition: ResolvedNoteType; renames: Rename[] }[] }
  | { ok: false; opIndex: number; refusal: NoteTypeEditRefusal };

/** One note type a publish changes, with the operations it applied there, by their index among those sent. */
export type NoteTypePublished = {
  key: string;
  definition: ResolvedNoteType;
  renames: Rename[];
  applied: number[];
};

/** editNoteTypes' answer, with the operations applied to each note type it publishes. */
export type NoteTypeTeamEdit =
  { ok: true; published: NoteTypePublished[] } | { ok: false; opIndex: number; refusal: NoteTypeEditRefusal };

/**
 * Every operation of one publish on note type `key`, in order (applyNoteTypeEdit), each option
 * operation also applied to every field it reaches (optionReach), with the reached field's path:
 * the next version of each note type it changes, the edited one first, then the others by key, each
 * with the renames its own version declares. A reached note type that ends the publish unchanged is
 * not published. The first refusal refuses the whole publish.
 */
export function editNoteTypes(input: {
  key: string;
  edits: readonly NoteTypeEdit[];
  /** Every version of each of the team's note types, removed ones too, oldest first, by key: `key`'s among them. */
  team: Readonly<Record<string, readonly ResolvedNoteType[]>>;
  /** The platform's note types, each at its newest released version, by key. */
  platform: Readonly<Record<string, ResolvedNoteType>>;
}): NoteTypeTeamOutcome {
  const outcome = editNoteTypesApplied(input);
  if (!outcome.ok) return outcome;
  return { ok: true, published: outcome.published.map(({ applied: _applied, ...p }) => p) };
}

const carried: ReadonlySet<string> = new Set(OPTION_EDIT_OPS);

/**
 * The option operation as it reaches a field of another note type, at that field's path: a rename,
 * a retire or a move of an option the field lacks leaves it as it is (null), and a move before an
 * option it lacks puts the option at its end.
 */
function reaching(edit: NoteTypeEdit, definition: ResolvedNoteType, path: string): NoteTypeEdit | null {
  const place = fieldPlace(definition, path);
  if (place?.field.kind !== 'choice') return null;
  const has = (code: string) =>
    (place.field as { options: { code: string }[] }).options.some((o) => o.code === code);
  switch (edit.op) {
    case 'add_option':
      return { ...edit, path };
    case 'rename_option':
    case 'retire_option':
      return has(edit.code) ? { ...edit, path } : null;
    case 'move_option':
      if (!has(edit.code)) return null;
      return { ...edit, path, before: edit.before !== null && has(edit.before) ? edit.before : null };
    default:
      return null;
  }
}

/** editNoteTypes, with the operations applied to each note type it publishes: what each one's audit names. */
export function editNoteTypesApplied(input: {
  key: string;
  edits: readonly NoteTypeEdit[];
  team: Readonly<Record<string, readonly ResolvedNoteType[]>>;
  platform: Readonly<Record<string, ResolvedNoteType>>;
}): NoteTypeTeamEdit {
  const { key, edits, team, platform } = input;
  const versionsOf = (k: string) => (Object.hasOwn(team, k) ? team[k]! : []);
  const own = versionsOf(key);
  const newest = own.at(-1);
  if (!newest) throw new Error('a note type is edited from its newest version, and there is none');
  // Each note type at the version the publish has made of it so far; the others at their current one.
  const current = new Map(
    Object.keys(team).flatMap((k) => {
      const at = versionsOf(k).at(-1);
      return at ? [[k, at] as const] : [];
    }),
  );
  current.set(key, newest);
  const now = new Map(current);
  const renamed = new Map<string, Rename[]>();
  const applied = new Map<string, number[]>();
  const record = (k: string, definition: ResolvedNoteType, renames: readonly Rename[], opIndex: number) => {
    now.set(k, definition);
    renamed.set(k, [...(renamed.get(k) ?? []), ...renames]);
    applied.set(k, [...(applied.get(k) ?? []), opIndex]);
  };
  const othersOf = (k: string) => Object.fromEntries([...now].filter(([other]) => other !== k));

  for (const [opIndex, edit] of edits.entries()) {
    const reach = carried.has(edit.op)
      ? optionReach(key, (edit as { path: string }).path, Object.fromEntries(now))
      : [];
    // One code in every field it reaches: above every one each of their note types has used (rule 3).
    const taken =
      reach.length === 0
        ? undefined
        : [...own, now.get(key)!, ...reach.flatMap((r) => [...versionsOf(r.key), now.get(r.key)!])];
    const step = applyNoteTypeEdit(now.get(key)!, edit, {
      versions: own,
      team: othersOf(key),
      platform,
      ...(taken === undefined ? {} : { taken }),
    });
    if (!step.ok) return { ok: false, opIndex, refusal: step.refusal };
    const steps: [string, ResolvedNoteType, Rename[]][] = [[key, step.definition, step.renames]];
    for (const { key: other, path } of reach) {
      // At the version made so far: of this operation too, should it reach two fields of one type.
      const at = steps.findLast(([k]) => k === other)?.[1] ?? now.get(other)!;
      const edited = reaching(edit, at, path);
      if (edited === null) continue;
      const there = applyNoteTypeEdit(at, edited, {
        versions: versionsOf(other),
        team: othersOf(other),
        platform,
        taken,
      });
      if (!there.ok) return { ok: false, opIndex, refusal: { ...there.refusal, noteTypeKey: other } };
      steps.push([other, there.definition, there.renames]);
    }
    for (const [k, definition, renames] of steps) record(k, definition, renames, opIndex);
  }

  const published: NoteTypePublished[] = [];
  for (const k of [key, ...[...applied.keys()].filter((k) => k !== key).sort(byCodePoint)]) {
    const definition = now.get(k)!;
    // A note type an operation reached and left as it was gets no version for nothing.
    if (k !== key && canonicalJson(definition) === canonicalJson(current.get(k))) continue;
    const versions = k === key ? own : versionsOf(k);
    const next = copyPart({ ...definition, key: k, version: versions.at(-1)!.version + 1 });
    published.push({
      key: k,
      definition: next,
      renames: declaredRenames(versions, next, renamed.get(k) ?? []),
      applied: [...new Set(applied.get(k) ?? [])],
    });
  }
  return { ok: true, published };
}
