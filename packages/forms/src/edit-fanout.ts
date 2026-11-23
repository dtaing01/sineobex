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
 *
 * Written ahead of its code (card P4-tests): it throws until card P4-fanout builds it.
 */
import type { NoteTypeEdit, NoteTypeEditRefusal } from './edit.ts';
import type { ResolvedNoteType } from './resolve.ts';
import type { Rename } from './types.ts';

/** A field of one of the team's note types. */
export type NoteTypeField = { key: string; path: string };

/**
 * The fields an option operation on `path` of note type `key` reaches besides itself: the field it
 * maps to, and every field that maps to that one or to it, in note types other than `key` that are
 * in `team` and not `auto`, by key and then path. `team` holds the current version of each of the
 * team's active note types, the edited one included.
 */
export function optionReach(
  key: string,
  path: string,
  team: Readonly<Record<string, ResolvedNoteType>>,
): NoteTypeField[] {
  void key;
  void path;
  void team;
  throw new Error('P4-fanout');
}

/** A publish's answer across the team: each note type it changes, the edited one first, or its refusal. */
export type NoteTypeTeamOutcome =
  | { ok: true; published: { key: string; definition: ResolvedNoteType; renames: Rename[] }[] }
  | { ok: false; opIndex: number; refusal: NoteTypeEditRefusal };

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
  /** Every version of each of the team's active note types, oldest first, by key: `key`'s among them. */
  team: Readonly<Record<string, readonly ResolvedNoteType[]>>;
  /** The platform's note types, each at its newest released version, by key. */
  platform: Readonly<Record<string, ResolvedNoteType>>;
}): NoteTypeTeamOutcome {
  void input;
  throw new Error('P4-fanout');
}
