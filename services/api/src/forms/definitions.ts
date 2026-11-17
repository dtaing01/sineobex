import {
  canonicalJson,
  installPresets,
  sha256Hex,
  type KeyVersion,
  type ResolvedNoteType,
} from '@sineobex/forms';
import type { TeamScope } from '../auth/context.ts';
import type { Tx } from '../db/database.ts';

/**
 * Note type definitions on the server (phase 4 design, forms 3): the team's list, installed on the
 * way, and one version's definition. Definitions hold no patient data, so neither read is audited
 * as a patient read; the install is audited when it writes.
 */

/** What the list says about a key: its newest version, and what the phone needs before opening it. */
export interface NoteTypeEntry {
  key: string;
  version: number;
  title: string;
  kinds: ResolvedNoteType['kinds'];
  sensitivity: ResolvedNoteType['sensitivity'];
  quick: boolean;
  auto: 'medical' | null;
  hash: string;
}

/** One version of a note type as the team holds it. */
export interface StoredDefinition {
  key: string;
  version: number;
  hash: string;
  definition: ResolvedNoteType;
}

/**
 * The team's note types, each at its newest version. Phase 4 offers every installed key; phase 5
 * reads its own table of offered keys here.
 *
 * It first installs the presets the team lacks (forms 3.2), so a team gets a new platform version
 * the first time one of its phones asks, with no deploy step, audited in the same transaction. A
 * held version whose definition is not the preset's is logged and its key skipped: a throw would
 * fail this route for the whole team at every sync.
 */
export async function listNoteTypes(scope: TeamScope): Promise<NoteTypeEntry[]> {
  const { teamId } = scope.team;
  return scope.tx(async (tx, audit) => {
    const { installed, differing } = await installPresets(tx, teamId, { onDiffer: 'skip' });
    if (installed.length > 0)
      await audit({
        action: 'forms.presets_installed',
        entity: 'team',
        entityId: teamId,
        details: { installed },
      });
    if (differing.length > 0) logDiffering(scope, differing);

    const rows = await tx<NoteTypeEntry[]>`
      select distinct on (key) key, version, hash,
             definition->>'title' as title, definition->'kinds' as kinds,
             definition->>'sensitivity' as sensitivity,
             coalesce(definition->'quick' = 'true'::jsonb, false) as quick,
             definition->>'auto' as auto
      from sineobex.note_type_versions
      where team_id = ${teamId}
      order by key, version desc`;
    return [...rows];
  });
}

function logDiffering(scope: TeamScope, differing: readonly KeyVersion[]): void {
  // The log carries no key: its allowlist has none, and the team's rows name them.
  scope.deps.log.error('forms.preset_differs', {
    requestId: scope.meta.requestId,
    teamId: scope.team.teamId,
    count: differing.length,
  });
}

/** How many definitions are kept, one per hash: every team holding a preset shares its one copy (D79). */
export const MAX_DEFINITIONS = 64;
/** How many teams' key and version are mapped to the hash of the definition they hold (D79). */
export const MAX_DEFINITION_NAMES = 4096;

/**
 * A row whose hash is not its definition's: 0017 checks a hash's form, not what it hashes (forms
 * 3.1). Never answered: a definition is only ever served under the hash it has. Names no key, so
 * nothing about the team's forms reaches a log through it.
 */
export class DefinitionMismatch extends Error {
  constructor() {
    super('A note type version holds a definition that is not the one its hash names.');
    this.name = 'DefinitionMismatch';
  }
}

/** A map that drops the entry used least recently once it holds `max`: a Map keeps insertion order. */
class Recent<K, V> {
  private readonly entries = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
}

// Rows are never changed (0017 is append-only), so a definition checked once is the definition for
// good, and neither map goes stale. Names are by team: two teams may hold one key and version with
// different definitions from phase 5 on. A missing row is not kept: it may be installed later.
const hashes = new Recent<string, string>(MAX_DEFINITION_NAMES);
const definitions = new Recent<string, StoredDefinition>(MAX_DEFINITIONS);

/**
 * One version of a note type the team holds, or undefined. The caller's transaction must run in
 * that team's scope, as every TeamScope transaction does: a kept definition is answered without
 * reading, so the team ID is what keeps teams apart.
 *
 * Each row is checked the first time it is read (D79): the hash of its canonical definition must
 * be its hash, and the definition must hold the row's key and version, or this throws
 * DefinitionMismatch and keeps nothing. A row that passes shares the
 * one frozen copy kept for its hash, so teams holding the same preset hold it once.
 */
export async function definitionFor(
  tx: Tx,
  teamId: string,
  key: string,
  version: number,
): Promise<StoredDefinition | undefined> {
  const name = `${teamId.toLowerCase()}\u0000${key}\u0000${version}`;
  const hash = hashes.get(name);
  const kept = hash === undefined ? undefined : definitions.get(hash);
  if (kept) return kept;
  const [row] = await tx<{ hash: string; definition: ResolvedNoteType }[]>`
    select hash, definition from sineobex.note_type_versions
    where team_id = ${teamId} and key = ${key} and version = ${version}`;
  if (!row) return undefined;
  if ((await sha256Hex(canonicalJson(row.definition))) !== row.hash) throw new DefinitionMismatch();
  // Its own key and version are in the definition, so one hash is one key and version, once the row
  // names the key and version its definition holds: a row filed under another (written by hand, or a
  // team's own type from phase 5) would answer another row's definition (review finding NOT-8).
  if (row.definition.key !== key || row.definition.version !== version) throw new DefinitionMismatch();
  const stored =
    definitions.get(row.hash) ??
    // Frozen: every caller shares the one copy, so none may change it under another.
    deepFreeze<StoredDefinition>({ key, version, hash: row.hash, definition: row.definition });
  definitions.set(row.hash, stored);
  hashes.set(name, row.hash);
  return stored;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
