import { installPresets, type KeyVersion, type ResolvedNoteType } from '@sineobex/forms';
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

// Rows are never changed (0017 is append-only), so a definition read once is the definition for
// good, and the cache never goes stale. Keyed by team: two teams may hold one key and version with
// different definitions from phase 5 on. A missing row is not kept: it may be installed later.
const cache = new Map<string, StoredDefinition>();

/**
 * One version of a note type the team holds, or undefined. The caller's transaction must run in
 * that team's scope, as every TeamScope transaction does: a cached row is answered without
 * reading, so the team ID is what keeps teams apart.
 */
export async function definitionFor(
  tx: Tx,
  teamId: string,
  key: string,
  version: number,
): Promise<StoredDefinition | undefined> {
  const id = `${teamId.toLowerCase()}\u0000${key}\u0000${version}`;
  const kept = cache.get(id);
  if (kept) return kept;
  const [row] = await tx<{ hash: string; definition: ResolvedNoteType }[]>`
    select hash, definition from sineobex.note_type_versions
    where team_id = ${teamId} and key = ${key} and version = ${version}`;
  if (!row) return undefined;
  // Frozen: every caller shares the one copy, so none may change it under another.
  const stored = deepFreeze<StoredDefinition>({ key, version, hash: row.hash, definition: row.definition });
  cache.set(id, stored);
  return stored;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
