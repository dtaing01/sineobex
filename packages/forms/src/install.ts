/**
 * Installing the presets (docs/design/phase-4/forms.md, 3.1 and 3.2; phase 5 design 4.3, 5.2):
 * writes a team's rows of sineobex.note_type_versions (migration 0017) and its note type heads
 * (sineobex.note_types, 0023) from the note type versions in generated/presets.json.
 *
 * Each key is decided by platformUpdateEffect, the one rule both installers share: a key the team
 * lacks is installed; a newer platform version is taken in place only by an active copy the team
 * never edited, when its kinds, group, sensitivity, quick and auto stay as they are; every other
 * newer version is offered, which moves only the head's platform_latest; an older or the same
 * version is skipped. So a team's own version is never overtaken by a platform one (PRD main 387).
 * Every version it writes is the team's next and names its own row (4.3): a platform version
 * installed or taken as the team's version N has its definition's `version` set to N, so where N is
 * not the platform's number its hash is not the bundled preset's and a phone downloads it.
 *
 * It runs inside a transaction its caller already holds (team creation, the seed, and the note
 * types list), so it takes that transaction and never opens one: this package imports no database
 * library, and the API is bundled for an edge runtime. The transaction's context must let it write
 * the team's rows: the team's own scope, or platform scope (0017's and 0023's policies have both
 * arms). It writes no audit event: its callers audit forms.presets_installed.
 *
 * A row is never changed (0017 is append-only). A platform row whose definition, named back as the
 * platform's version, is not the preset's means a released version was edited, which the lock
 * should have stopped: it is never overwritten, and never passed over in silence. By default the
 * installer throws PresetDiffers and the caller's transaction writes nothing. Where a throw would
 * fail every request of the team (the note types list), `onDiffer: 'skip'` reports the difference
 * and writes nothing for that key but a missing head, so the caller logs it.
 */
import PRESETS_FILE from '../generated/presets.json' with { type: 'json' };
import { canonicalJson, sha256Hex } from './canonical.ts';
import { copyPart } from './edit-protected.ts';
import { platformUpdateEffect } from './platform-effect.ts';
import type { ResolvedNoteType } from './resolve.ts';
import { lockTeam, takeRevision } from './revision.ts';

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
  /** The versions this call wrote, by the team's version numbers, in code-point order of their keys. */
  installed: KeyVersion[];
  /** Platform versions the team holds with another definition, by the team's key and version. Only with `onDiffer: 'skip'`. */
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

/**
 * Gives the team what planNoteTypes plans, in the caller's transaction, and answers what it wrote.
 * With nothing to write, which is every list of a team that is up to date, it reads and returns: no
 * lock and no revision, so the request waits on nobody. Otherwise it takes the team lock, which a
 * publish takes first too, and works its plan out again under it: a publish of the key's next
 * version, or another installer at the same moment, may have committed since the first read, and a
 * second plan sees it, so no version is written twice (0017's primary key) and none is put over a
 * version the team made meanwhile. Then each version, one revision for the run (takeRevision),
 * stamped on every head it inserts or upserts, and each install's and update's team_preset_events
 * row, with no reason and no author.
 */
export async function installPresets(
  sql: InstallSql,
  teamId: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const presets = options.presets ?? PRESETS;
  const skip = options.onDiffer === 'skip';
  if (presets.length === 0) return { installed: [], differing: [] };

  const plan = async () => {
    const planned = await planNoteTypes({ ...(await heldBy(sql, teamId)), presets });
    if (planned.differing.length > 0 && !skip) throw new PresetDiffers(planned.differing);
    return planned;
  };
  let { steps, differing } = await plan();
  if (steps.length === 0) return { installed: [], differing };
  await lockTeam(sql, teamId);
  ({ steps, differing } = await plan());
  if (steps.length === 0) return { installed: [], differing };

  // The versions first, so a writer that skipped the team lock and wrote one of them after the plan
  // is found before anything else is written: the run throws before its revision is taken.
  const wrote = await writeVersions(sql, teamId, steps);
  const late = steps.flatMap((s) =>
    s.write !== null && !wrote.has(s.key) ? [{ step: s, at: { key: s.key, version: s.write.version } }] : [],
  );
  let lost = new Set<string>();
  if (late.length > 0) {
    // Such a version must hold what this run would have written; one that does is the run's all the
    // same, and its head and event are written, though this call did not write it. One that does
    // not is a differing row: nothing more is written for its key.
    const now = await hashesOf(sql, teamId);
    const lateDiffering = late
      .filter(({ step, at }) => now.get(id(at)) !== step.write!.hash)
      .map((l) => l.at);
    if (lateDiffering.length > 0 && !skip) throw new PresetDiffers(lateDiffering);
    lost = new Set(lateDiffering.map((at) => at.key));
    differing = [...differing, ...lateDiffering];
  }
  const kept = steps.filter((s) => !lost.has(s.key));
  if (kept.length === 0) return { installed: [], differing };

  const revision = await takeRevision(sql, teamId);
  await writeHeads(sql, teamId, revision, kept);
  await writeEvents(sql, teamId, kept);
  return {
    installed: kept.flatMap((s) =>
      s.write !== null && wrote.has(s.key) ? [{ key: s.key, version: s.write.version }] : [],
    ),
    differing,
  };
}

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
  /**
   * Its definition's title, null where it has none: a missing head takes the newest one's. The
   * installer reads it only for a key with no head, the one place it is used, so the list a phone
   * syncs by never opens every stored definition.
   */
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
  const heads = new Map(input.heads.map((h) => [h.key, h]));
  const rowsOf = byKey(input.versions);
  const platformOf = byKey(input.presets);
  const keys = [...new Set([...rowsOf.keys(), ...platformOf.keys()])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const steps: NoteTypeStep[] = [];
  const differing: KeyVersion[] = [];
  for (const key of keys) {
    const rows = [...(rowsOf.get(key) ?? [])].sort((a, b) => a.version - b.version);
    const platform = platformOf.get(key) ?? [];
    const newest = platform.reduce<Preset | undefined>(
      (n, p) => (n && n.version >= p.version ? n : p),
      undefined,
    );
    const held = heads.get(key);
    const head = held ?? (rows.length > 0 ? filledHead(key, rows) : undefined);
    const headOnly = (): NoteTypeStep => ({
      key,
      effect: null,
      platformVersion: newest?.version ?? null,
      head: head!,
      headMissing: true,
      write: null,
    });

    // A platform row is compared as the platform wrote it: the hash of the platform's definition
    // named as the row's version is the row's, exactly when the row is that definition named back.
    let differs = false;
    for (const row of rows) {
      if (row.origin !== 'preset' || row.presetVersion === null) continue;
      const preset = platform.find((p) => p.version === row.presetVersion);
      if (preset && row.hash !== (await hashAs(preset, row.version))) {
        differing.push({ key, version: row.version });
        differs = true;
      }
    }
    if (newest === undefined || differs) {
      if (!held && head) steps.push(headOnly());
      continue;
    }

    const newestRow = rows.at(-1);
    const lastTaken = rows.findLast((r) => r.origin === 'preset');
    const originVersion = lastTaken?.presetVersion ?? null;
    const taken = platform.find((p) => p.version === originVersion);
    const effect = platformUpdateEffect({
      exists: rows.length > 0,
      state: head?.state ?? null,
      customized: (head?.customized ?? false) || newestRow?.origin === 'team',
      originVersion,
      platformVersion: newest.version,
      changesFixed:
        originVersion !== null &&
        (taken === undefined || fixedOf(taken.definition) !== fixedOf(newest.definition)),
    });

    if (effect === 'install' || effect === 'update') {
      const version = (newestRow?.version ?? 0) + 1;
      steps.push({
        key,
        effect,
        platformVersion: newest.version,
        // Only an active copy the team never made its own is installed or taken in place.
        head: {
          key,
          title: newest.definition.title,
          state: 'active',
          currentVersion: version,
          platformLatest: newest.version,
          customized: false,
        },
        headMissing: !held,
        write: {
          version,
          presetVersion: newest.version,
          definition: { ...copyPart(newest.definition), version },
          hash: await hashAs(newest, version),
        },
      });
    } else if (effect === 'offer' && (head!.platformLatest ?? 0) < newest.version) {
      steps.push({
        key,
        effect,
        platformVersion: newest.version,
        head: { ...head!, platformLatest: newest.version },
        headMissing: !held,
        write: null,
      });
    } else if (!held) steps.push(headOnly());
  }
  return { steps, differing };
}

/** Each entry by its key, in the order given. */
function byKey<T extends { key: string }>(list: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const entry of list) {
    const held = map.get(entry.key);
    if (held) held.push(entry);
    else map.set(entry.key, [entry]);
  }
  return map;
}

/** The head 0023 gives a key the team holds: what its versions say, read as 0023 reads them. */
function filledHead(key: string, rows: readonly HeldNoteTypeVersion[]): NoteTypeHead {
  const newest = rows.at(-1)!;
  // btrim's default: spaces only.
  const title = newest.title !== null && /[^ ]/.test(newest.title) ? newest.title : key;
  return {
    key,
    title,
    state: 'active',
    currentVersion: newest.version,
    platformLatest: rows.findLast((r) => r.origin === 'preset')?.presetVersion ?? null,
    customized: rows.some((r) => r.origin === 'team'),
  };
}

/**
 * What a platform version may not change in a team's copy (design 5.2): its kinds as a set, group,
 * sensitivity, quick and auto. Medical is a property of the note through its type (D56), and who
 * may read a note follows its sensitivity, so such a version is only offered.
 */
const fixedOf = (d: ResolvedNoteType): string =>
  canonicalJson([[...d.kinds].sort(), d.group, d.sensitivity, d.quick === true, d.auto ?? null]);

// The hash of a platform version named as a team's version: worked out for every platform row a
// team holds under another number, at every list a phone syncs by, so it is kept once worked out.
// A preset never changes once released, and its hash names its definition.
const RENAMED_MAX = 1024;
const renamed = new Map<string, Promise<string>>();

/** The hash of `preset`'s definition with its `version` set to `version`: the bundled hash at its own number. */
function hashAs(preset: Preset, version: number): Promise<string> {
  if (version === preset.version) return Promise.resolve(preset.hash);
  const key = `${preset.hash}\u0000${version}`;
  let hash = renamed.get(key);
  if (hash === undefined) {
    hash = sha256Hex(canonicalJson({ ...preset.definition, version }));
    if (renamed.size >= RENAMED_MAX) renamed.delete(renamed.keys().next().value!);
    renamed.set(key, hash);
  }
  return hash;
}

/**
 * The team's heads, and every version it holds without its definition: what the plan reads. A
 * version's title is read only where its key has no head, so a team that is up to date costs the
 * list two reads of its rows' columns and opens no definition.
 */
async function heldBy(sql: InstallSql, teamId: string) {
  const heads = await sql<NoteTypeHead[]>`
    select key, title, state, current_version as "currentVersion", platform_latest as "platformLatest",
           customized
    from sineobex.note_types where team_id = ${teamId}::uuid`;
  const versions = await sql<HeldNoteTypeVersion[]>`
    select v.key, v.version, v.origin, v.preset_version as "presetVersion", v.hash,
           case when h.key is null then v.definition ->> 'title' end as title
    from sineobex.note_type_versions v
    left join sineobex.note_types h on h.team_id = v.team_id and h.key = v.key
    where v.team_id = ${teamId}::uuid`;
  return { heads: [...heads], versions: [...versions] };
}

/**
 * Every install's and update's version, in one statement, with `on conflict do nothing`, and the
 * keys it wrote. The rows travel as text cast to jsonb: a parameter typed jsonb would be serialized
 * again, as one JSON string.
 */
async function writeVersions(sql: InstallSql, teamId: string, steps: readonly NoteTypeStep[]) {
  const rows = steps.flatMap(({ key, write }) =>
    write === null
      ? []
      : [
          {
            key,
            version: write.version,
            definition: write.definition,
            hash: write.hash,
            platform: write.presetVersion,
          },
        ],
  );
  if (rows.length === 0) return new Set<string>();
  const written = await sql<{ key: string }[]>`
    insert into sineobex.note_type_versions (team_id, key, version, definition, hash, origin, preset_version)
    select ${teamId}::uuid, v.key, v.version, v.definition, v.hash, 'preset', v.platform
    from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb)
      as v (key text, version integer, definition jsonb, hash text, platform integer)
    on conflict do nothing
    returning key`;
  return new Set(written.map((row) => row.key));
}

/**
 * Every head the run writes, as the plan leaves it, at the run's revision: a missing head is
 * inserted whole; an existing one takes the title, current version and platform_latest the plan
 * gives it, its state and customized being the installer's to read, never to change. An update
 * gives the copy back to the platform's version, by nobody; an offer, which leaves the current
 * version, leaves who last changed it.
 */
async function writeHeads(sql: InstallSql, teamId: string, revision: number, steps: readonly NoteTypeStep[]) {
  const rows = steps.map(({ head }) => ({
    key: head.key,
    title: head.title,
    state: head.state,
    version: head.currentVersion,
    latest: head.platformLatest,
    customized: head.customized,
  }));
  await sql`
    insert into sineobex.note_types as t
      (team_id, key, title, state, current_version, platform_latest, customized, revision)
    select ${teamId}::uuid, h.key, h.title, h.state, h.version, h.latest, h.customized, ${revision}::bigint
    from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb)
      as h (key text, title text, state text, version integer, latest integer, customized boolean)
    on conflict (team_id, key) do update
      set title = excluded.title, current_version = excluded.current_version,
          platform_latest = excluded.platform_latest, revision = excluded.revision,
          updated_by = case when excluded.current_version = t.current_version then t.updated_by end`;
}

/** Each install's and update's act, with the version it made: the installer's, so no reason and no author. */
async function writeEvents(sql: InstallSql, teamId: string, steps: readonly NoteTypeStep[]) {
  const rows = steps.flatMap(({ key, effect, write }) =>
    write === null
      ? []
      : [{ key, act: effect === 'install' ? 'installed' : 'platform_updated', version: write.version }],
  );
  if (rows.length === 0) return;
  await sql`
    insert into sineobex.team_preset_events (team_id, note_type_key, act, version)
    select ${teamId}::uuid, e.key, e.act, e.version
    from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) as e (key text, act text, version integer)`;
}

async function hashesOf(sql: InstallSql, teamId: string): Promise<Map<string, string>> {
  const rows = await sql<{ key: string; version: number; hash: string }[]>`
    select key, version, hash from sineobex.note_type_versions where team_id = ${teamId}::uuid`;
  return new Map(rows.map((row) => [id(row), row.hash]));
}
