import { canonicalJson, copyPart, PRESETS, type Preset, type ResolvedNoteType } from '@sineobex/forms';
import type { Tx } from '../db/database.ts';
import { checkedRow } from '../forms/definitions.ts';

/**
 * A team's note types as Team setup's note type pages read and change them (phase 5 design 4.3,
 * 5.1, 5.2, 5.4, 7, 9): the heads (note_types, 0023), each with its current version's resolved
 * definition, read as definitionFor reads a version (D79), and what a platform version on offer
 * would write. The definitions are phase 4's rows (note_type_versions, 0017), which no write here
 * ever changes: a version a team makes is a new row.
 */

/** A note type's head with its current version's definition. */
export interface HeldNoteType {
  readonly key: string;
  readonly title: string;
  readonly state: 'active' | 'archived';
  readonly currentVersion: number;
  /** The newest platform version the installer has seen; above `lastTaken`, one is on offer. */
  readonly platformLatest: number | null;
  /** The team edited, archived or restored it: a platform version is then only offered. */
  readonly customized: boolean;
  /** The platform version its newest platform row was installed or taken from; null with none. */
  readonly lastTaken: number | null;
  /** Its current version's definition, checked as definitionFor checks it, and frozen. */
  readonly definition: ResolvedNoteType;
}

/** Every note type the team holds, archived ones too, and what names each. */
export interface TeamNoteTypes {
  readonly all: readonly HeldNoteType[];
  get(key: string): HeldNoteType | undefined;
  /** How many active field supply maps name each note type in their current body, by key. */
  readonly maps: ReadonlyMap<string, number>;
}

/**
 * Every head of the team with its current version's definition, and the active field supply maps
 * naming each (design 4.4): what the admin list shows, and what a write reads under the team lock,
 * so it holds until the write commits. Each definition is checked as definitionFor checks a version
 * (its hash, its own key and version), so an edit is never made from a row that is not what it says.
 */
export async function loadTeamNoteTypes(tx: Tx, teamId: string): Promise<TeamNoteTypes> {
  const rows = await tx<
    (Omit<HeldNoteType, 'definition'> & { hash: string | null; definition: ResolvedNoteType | null })[]
  >`
    select h.key, h.title, h.state, h.current_version, h.platform_latest, h.customized, v.hash,
           v.definition,
           (select n.preset_version from sineobex.note_type_versions n
            where n.team_id = h.team_id and n.key = h.key and n.origin = 'preset'
            order by n.version desc limit 1) as last_taken
    from sineobex.note_types h
    left join sineobex.note_type_versions v
      on v.team_id = h.team_id and v.key = h.key and v.version = h.current_version
    where h.team_id = ${teamId}`;
  const all: HeldNoteType[] = [];
  for (const { hash, definition, ...head } of rows) {
    // Every writer writes a head with its version (the installer, this module); 0023 cannot hold it.
    if (hash === null || definition === null) throw new Error('a note type’s current version is missing');
    const stored = await checkedRow(teamId, {
      key: head.key,
      version: head.currentVersion,
      hash,
      definition,
    });
    all.push({ ...head, definition: stored.definition });
  }
  const byKey = new Map(all.map((n) => [n.key, n]));
  const maps = await tx<{ key: string; n: number }[]>`
    select v.body ->> 'noteTypeKey' as key, count(*)::int as n
    from sineobex.team_presets p
    join sineobex.team_preset_versions v
      on v.team_id = p.team_id and v.preset_id = p.id and v.version = p.current_version
    where p.team_id = ${teamId} and p.kind = 'field_supply_map' and p.state = 'active'
    group by 1`;
  return {
    all,
    get: (key) => byKey.get(key),
    maps: new Map(maps.map((m) => [m.key, m.n])),
  };
}

/**
 * The active presets that name a note type, counted by their kind: the field supply maps whose
 * current body names it (design 4.4), the one kind that names a note type. A note type such a map
 * names cannot be removed (`referenced`, 5.4).
 */
export function referencedBy(team: TeamNoteTypes, key: string): { field_supply_map?: number } {
  const n = team.maps.get(key);
  return n === undefined ? {} : { field_supply_map: n };
}

/** What a platform version may not change in a team's note type (5.2, 5.4 rule 2), in this order. */
export const FIXED_NOTE_TYPE_FIELDS = ['kinds', 'group', 'sensitivity', 'quick', 'auto'] as const;
export type FixedNoteTypeField = (typeof FIXED_NOTE_TYPE_FIELDS)[number];

const fixedValue: Record<FixedNoteTypeField, (d: ResolvedNoteType) => unknown> = {
  // As a set: Medical is a property of the note through its type (D56), whatever the order.
  kinds: (d) => canonicalJson([...d.kinds].sort()),
  group: (d) => d.group,
  sensitivity: (d) => d.sensitivity,
  quick: (d) => d.quick === true,
  auto: (d) => d.auto ?? null,
};

/** The fixed fields `after` changes from `before`. */
export function changedFixed(before: ResolvedNoteType, after: ResolvedNoteType): FixedNoteTypeField[] {
  return FIXED_NOTE_TYPE_FIELDS.filter((field) => fixedValue[field](before) !== fixedValue[field](after));
}

/** The platform version on offer to a note type, as taking it in place would write it. */
export interface NoteTypeUpdate {
  /** The platform's version, as the release holds it. */
  readonly preset: Preset;
  /** Its definition named as the note type's next version (4.3): what a take in place stores. */
  readonly definition: ResolvedNoteType;
  /** The fixed fields it would change; with any, it is taken only as a new note type (5.1). */
  readonly changesFixed: FixedNoteTypeField[];
}

/**
 * The update on offer to a note type (5.1, 5.2): the platform's version at platform_latest, once that
 * is above the platform version last taken; null when none is, or when the release no longer holds
 * that version. Read from the release at each call, so what is offered is what the installer saw.
 */
export function noteTypeUpdateOf(held: HeldNoteType): NoteTypeUpdate | null {
  if (held.platformLatest === null || held.platformLatest <= (held.lastTaken ?? 0)) return null;
  const preset = PRESETS.find((p) => p.key === held.key && p.version === held.platformLatest);
  if (!preset) return null;
  return {
    preset,
    definition: { ...copyPart(preset.definition), version: held.currentVersion + 1 },
    changesFixed: changedFixed(held.definition, preset.definition),
  };
}
