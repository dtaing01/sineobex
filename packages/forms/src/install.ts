/**
 * Installing the presets (docs/design/phase-4/forms.md, 3.1 and 3.2): writes a team's rows of
 * sineobex.note_type_versions (migration 0017) for every note type version in
 * generated/presets.json that the team does not have yet.
 *
 * It runs inside a transaction its caller already holds (team creation, the seed, and from F3's
 * routes the note types list), so it takes that transaction and never opens one: this package
 * imports no database library, and the API is bundled for an edge runtime. The transaction's
 * context must let it write the team's rows: the team's own scope, or platform scope (0017's
 * policy has both arms).
 *
 * A row is never changed (0017 is append-only), so a team that already holds a key and version
 * keeps it. When that row's hash is not the preset's, a released version was edited, which the
 * lock should have stopped: it is never overwritten, and never passed over in silence. By default
 * the installer throws PresetDiffers and the caller's transaction writes nothing. Where a throw
 * would fail every request of the team (the note types route), `onDiffer: 'skip'` reports the
 * difference and installs none of that key's versions, so the caller logs it.
 */
import PRESETS_FILE from '../generated/presets.json' with { type: 'json' };
import type { ResolvedNoteType } from './resolve.ts';

/** One note type version as the server installs it (3.2) and the phone bundles it (3.4). */
export type Preset = { key: string; version: number; hash: string; definition: ResolvedNoteType };

/** What the export wrote, in key and version order: every definition in it passed every check. */
export const PRESETS: readonly Preset[] = PRESETS_FILE as unknown as readonly Preset[];

/**
 * The caller's transaction, as a tagged template that runs one statement and gives its rows.
 * postgres.js's transaction is one. The installer names its columns one word each, so a caller's
 * column-name transform changes nothing it reads.
 */
export type InstallSql = <T extends readonly object[]>(
  template: TemplateStringsArray,
  ...parameters: readonly (string | number)[]
) => PromiseLike<T>;

export type KeyVersion = { key: string; version: number };

export type InstallResult = {
  /** The versions this call wrote, in the presets' order. */
  installed: KeyVersion[];
  /** Versions the team holds with another definition. Only with `onDiffer: 'skip'`. */
  differing: KeyVersion[];
};

export type InstallOptions = {
  /** The presets to install; generated/presets.json when left out. */
  presets?: readonly Preset[];
  /** What a differing row does: throw (the default), or skip its key and report it. */
  onDiffer?: 'throw' | 'skip';
};

/** A team holds a key and version whose definition is not the preset's. Names no patient data. */
export class PresetDiffers extends Error {
  constructor(readonly differing: readonly KeyVersion[]) {
    super(
      `The team holds ${differing.map(name).join(', ')} with a definition that is not the preset's: a released version was edited.`,
    );
    this.name = 'PresetDiffers';
  }
}

const name = ({ key, version }: KeyVersion) => `${key} v${version}`;
const id = ({ key, version }: KeyVersion) => `${key}\u0000${version}`;

export async function installPresets(
  sql: InstallSql,
  teamId: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const presets = options.presets ?? PRESETS;
  const skip = options.onDiffer === 'skip';
  if (presets.length === 0) return { installed: [], differing: [] };

  const held = await hashesOf(sql, teamId);
  const differing = presets.filter((p) => held.has(id(p)) && held.get(id(p)) !== p.hash);
  if (differing.length > 0 && !skip) throw new PresetDiffers(differing.map(keyVersion));
  const skipped = new Set(differing.map((p) => p.key));
  const missing = presets.filter((p) => !held.has(id(p)) && !skipped.has(p.key));
  if (missing.length === 0) return { installed: [], differing: differing.map(keyVersion) };

  // One statement for every version, with `on conflict do nothing`: a transaction installing the
  // same team at the same moment waits on this one, then writes nothing twice. The rows travel as
  // text cast to jsonb: a parameter typed jsonb would be serialized again, as one JSON string.
  const rows = missing.map(({ key, version, hash, definition }) => ({ key, version, hash, definition }));
  const written = await sql<KeyVersion[]>`
    insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
    select ${teamId}::uuid, p.key, p.version, p.definition, p.hash, 'preset', p.version
    from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) as p (key text, version integer, definition jsonb, hash text)
    on conflict do nothing
    returning key, version`;
  const wrote = new Set(written.map(id));

  // A version not written was written by another transaction after the read above: it, too, must
  // hold the preset's definition.
  const late = missing.filter((p) => !wrote.has(id(p)));
  if (late.length > 0) {
    const now = await hashesOf(sql, teamId);
    const lateDiffering = late.filter((p) => now.get(id(p)) !== p.hash);
    if (lateDiffering.length > 0) {
      if (!skip) throw new PresetDiffers(lateDiffering.map(keyVersion));
      differing.push(...lateDiffering);
    }
  }
  return {
    installed: missing.filter((p) => wrote.has(id(p))).map(keyVersion),
    differing: differing.map(keyVersion),
  };
}

const keyVersion = ({ key, version }: KeyVersion): KeyVersion => ({ key, version });

// ------------------------------------------------------------------------------------------------
// Phase 5: each key by platformUpdateEffect (design 4.3, 5.2). Written ahead of its code (card
// P4-tests): planNoteTypes throws until card P4-install builds it, and installPresets above is
// changed to work from it, as packages/forms/test/install-update.test.ts and
// db/test/install-presets.test.ts hold.
// ------------------------------------------------------------------------------------------------

/** A note type's head (0023) as the installer reads it and writes it. */
export type NoteTypeHead = {
  key: string;
  title: string;
  state: 'active' | 'archived';
  currentVersion: number;
  /** The newest platform version the installer has seen; above the version last taken, one is on offer. */
  platformLatest: number | null;
  /** The team edited, archived or restored it: a platform version is then only offered. */
  customized: boolean;
};

/** One row of note_type_versions as the installer reads it: never its definition. */
export type HeldNoteTypeVersion = {
  key: string;
  version: number;
  origin: 'preset' | 'team';
  /** The platform version a preset row was installed or taken from; null for the team's own. */
  presetVersion: number | null;
  hash: string;
  /** Its definition's title, null where it has none: a missing head takes the newest one's. */
  title: string | null;
};

/** What one run writes for one key. */
export type NoteTypeStep = {
  key: string;
  /**
   * What platformUpdateEffect answered for the key's newest platform version; null for a key whose
   * missing head is all the run writes (a skip, a key the platform does not ship, or one that differs).
   */
  effect: 'install' | 'update' | 'offer' | null;
  /** The key's newest platform version; null for a key the platform does not ship. */
  platformVersion: number | null;
  /** The head as the run leaves it, stamped with the run's revision when it is written. */
  head: NoteTypeHead;
  /** The key had no head (a team made after 0023 and before this installer): it is inserted. */
  headMissing: boolean;
  /**
   * The version an install or an update writes, `origin = 'preset'`: the team's next (1 for a new
   * key, else one more than its newest row), its definition's `version` rewritten to it (4.3), and
   * the hash of that definition. Null for an offer and a missing head alone.
   */
  write: { version: number; presetVersion: number; definition: ResolvedNoteType; hash: string } | null;
};

export type NoteTypePlan = {
  /** One step for each key the run writes anything for, in code-point order of the keys. */
  steps: NoteTypeStep[];
  /**
   * Preset rows whose definition, with its version set back to the row's `preset_version`, is not
   * the platform's: by the team's key and version. Nothing but a missing head is written for their keys.
   */
  differing: KeyVersion[];
};

/**
 * What one run of the note type installer writes (design 5.2), from what the team holds: for each
 * key the presets name, its newest platform version, decided by platformUpdateEffect with `exists`
 * whether the team holds any version of the key, `originVersion` the newest preset row's
 * `presetVersion`, `state` and `customized` the head's (a key whose newest row is the team's own is
 * customized whatever its head says: forms 3.2's rule), and `changesFixed` whether the platform's
 * kinds, group, sensitivity, quick or auto differ from those of the platform version last taken
 * (treated as changed when that version is not among the presets). An offer is a step only while
 * the head's `platformLatest` is below the platform version. A key the team holds without a head
 * gets one, as 0023 fills it: the newest version's title (the key where it has none), that version
 * current, `platformLatest` the newest preset row's, customized when any version is the team's own,
 * active. Pure, as planTeamPresets is: no database, and what it is given is not changed.
 */
export async function planNoteTypes(input: {
  heads: readonly NoteTypeHead[];
  versions: readonly HeldNoteTypeVersion[];
  presets: readonly Preset[];
}): Promise<NoteTypePlan> {
  void input;
  throw new Error('P4-install');
}

async function hashesOf(sql: InstallSql, teamId: string): Promise<Map<string, string>> {
  const rows = await sql<{ key: string; version: number; hash: string }[]>`
    select key, version, hash from sineobex.note_type_versions where team_id = ${teamId}::uuid`;
  return new Map(rows.map((row) => [id(row), row.hash]));
}
