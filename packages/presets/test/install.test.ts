import { readFileSync } from 'node:fs';
import { PRESETS, type InstallSql, type PlatformUpdateInput, type ResolvedNoteType } from '@sineobex/forms';
import { describe, expect, it } from 'vitest';
import { installTeamPresets, PLATFORM, planTeamPresets, presetWriteEffect } from '../src/index.ts';
import type { HeldPreset, PlanStep, PlatformEntry, PresetBody } from '../src/index.ts';

// The preset installer (phase 5 design 5.2, D133): its plan, here, and on a stand-in for the
// caller's transaction; db/test/install-team-presets.test.ts runs it against the database, where
// it writes. The plan decides each platform entry by platformUpdateEffect, the one rule both
// installers share (platform-update.json, which this file reads too), and checks what it would
// write with validatePreset against the team's presets, skipping and counting what is refused.
//
// The signatures these tests are written to, in packages/presets/src/install.ts and exported from
// the package index (P0-install):
//
//   /** One entry of packages/presets/data/platform.json: a body names other entries by origin key. */
//   export type PlatformEntry = { originKey: string; platformVersion: number; kind: PresetKind; body: Record<string, unknown> };
//   /** The data file's entries, in its order. Several versions of one origin key may be there. */
//   export const PLATFORM: readonly PlatformEntry[];
//
//   /** A team's preset as the installer reads it: its head, and its current version's body. */
//   export type HeldPreset = {
//     id: string;
//     kind: PresetKind;
//     /** The head's name, which the database's unique name reads. */
//     name: string;
//     state: 'active' | 'archived';
//     originKey: string | null;
//     originVersion: number | null;
//     platformLatest: number | null;
//     customized: boolean;
//     currentVersion: number;
//     /** Null when its current version cannot be read. */
//     body: PresetBody | null;
//   };
//   /** What validatePreset refuses, a name taken, or a held copy whose body cannot be read. */
//   export type PlanProblem = PresetProblem | { path: 'name'; code: 'name_taken' }
//     | { path: 'currentVersion'; code: 'version_missing' };
//   export type PlanStep = { originKey: string; kind: PresetKind; platformVersion: number } & (
//     | { effect: 'install'; id: string; body: PresetBody }
//     | { effect: 'update'; id: string; version: number; body: PresetBody }
//     | { effect: 'offer'; id: string }
//     | { effect: 'skipped'; problems: PlanProblem[] }
//   );
//   /**
//    * For each origin key, its newest platform version, in the order the file first names the key:
//    * install, update or offer by platformUpdateEffect (changesFixed from changedFixedFields against
//    * the held body), with the body's origin keys put as the team's ids (a held preset's, or the
//    * new id of one installed earlier in the plan); an install or an update validatePreset refuses
//    * against the held presets and those installed before it is `skipped`, with its problems; an
//    * offer is a step only while platformLatest is below the platform version; a skip is no step.
//    * Names are compared within a kind through `fold`, the database's lower() of each name.
//    * Pure: newId is called once for each install, and for nothing else.
//    */
//   export function planTeamPresets(input: {
//     held: readonly HeldPreset[];
//     platform: readonly PlatformEntry[];
//     /** The current definition of each of the team's active note types. */
//     definitions: Readonly<Record<string, ResolvedNoteType>>;
//     newId: () => string;
//     fold: (name: string) => string;
//   }): PlanStep[];
//
//   /** Counts by kind; `skipped` is what validatePreset refused. */
//   export type TeamPresetsInstalled = Record<'install' | 'update' | 'offer' | 'skipped', Partial<Record<PresetKind, number>>>;
//   export function installTeamPresets(
//     sql: InstallSql,
//     teamId: string,
//     options?: { platform?: readonly PlatformEntry[]; newId?: () => string },
//   ): Promise<TeamPresetsInstalled>;

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** Ids as a team's install gives them, one by one. */
const ids = (from = 0x100) => {
  let next = from;
  const made: string[] = [];
  const newId = () => {
    const made1 = id(next++);
    made.push(made1);
    return made1;
  };
  return { newId, made };
};

const CATEGORY: PlatformEntry = {
  originKey: 'order_category.demo_supplies',
  platformVersion: 1,
  kind: 'order_category',
  body: { name: 'Demo: Supplies', behaviour: 'supply', sort: 10 },
};
const MEDS: PlatformEntry = {
  originKey: 'order_category.demo_otc',
  platformVersion: 1,
  kind: 'order_category',
  body: { name: 'Demo: OTC', behaviour: 'medication', sort: 20 },
};
const GAUZE: PlatformEntry = {
  originKey: 'item.demo_gauze',
  platformVersion: 1,
  kind: 'item',
  body: {
    name: 'Demo: Gauze',
    categoryId: 'order_category.demo_supplies',
    unit: 'each',
    medical: false,
    captureLot: false,
    result: null,
  },
};
const PAIN: PlatformEntry = {
  originKey: 'item.demo_pain',
  platformVersion: 1,
  kind: 'item',
  body: {
    name: 'Demo: Pain tablet',
    categoryId: 'order_category.demo_otc',
    unit: 'tablet',
    medical: true,
    captureLot: false,
    result: null,
  },
};
const BUNDLE: PlatformEntry = {
  originKey: 'bundle.demo_wound',
  platformVersion: 1,
  kind: 'bundle',
  body: {
    name: 'Demo: Wound bundle',
    medical: false,
    prompt: '',
    lines: [{ itemId: 'item.demo_gauze', qty: 2, core: true }],
  },
};
const FLAG: PlatformEntry = {
  originKey: 'flag.demo_frost',
  platformVersion: 1,
  kind: 'flag',
  body: {
    name: 'Demo: Frost risk',
    tier: 'secondary',
    criteria: '',
    color: 'blue',
    rank: 10,
    sensitive: false,
  },
};
const MAP: PlatformEntry = {
  originKey: 'field_supply_map.demo_dressing',
  platformVersion: 1,
  kind: 'field_supply_map',
  body: {
    name: 'Demo: Dressing applied',
    noteTypeKey: 'wound_care',
    path: 'wound.treatment.dressing',
    when: { answered: true },
    lines: [{ itemId: 'item.demo_gauze', qty: 1 }],
  },
};
const SETTINGS: PlatformEntry = {
  originKey: 'settings.team',
  platformVersion: 1,
  kind: 'settings',
  body: { name: 'Team settings', bagMinimumsOn: false, newBagMinimums: [], problemCheckDays: 90 },
};

/** The next platform version of an entry, with its body changed. */
const v2 = (entry: PlatformEntry, change: Record<string, unknown>, version = 2): PlatformEntry => ({
  ...entry,
  platformVersion: version,
  body: { ...entry.body, ...change },
});

/** What a team holds of an entry it was given at `version`, its body's origin keys as its ids. */
function held(
  entry: PlatformEntry,
  n: number,
  over: Partial<HeldPreset> = {},
  idsByKey: Record<string, string> = {},
): HeldPreset {
  const body = JSON.parse(
    JSON.stringify(entry.body, (_, v: unknown) => (typeof v === 'string' && idsByKey[v] ? idsByKey[v] : v)),
  ) as PresetBody;
  return {
    id: id(n),
    kind: entry.kind,
    name: (body as { name: string }).name,
    state: 'active',
    originKey: entry.originKey,
    originVersion: entry.platformVersion,
    platformLatest: entry.platformVersion,
    customized: false,
    currentVersion: 1,
    body,
    ...over,
  };
}

const definitions: Record<string, ResolvedNoteType> = {};
for (const p of PRESETS)
  if ((definitions[p.key]?.version ?? 0) < p.version) definitions[p.key] = p.definition;

/** A name folded as the database folds the ASCII names these tests give. */
const fold = (name: string) => name.toLowerCase();
const plan = (heldPresets: HeldPreset[], platform: PlatformEntry[], newId = ids().newId) =>
  planTeamPresets({ held: heldPresets, platform, definitions, newId, fold });
const effects = (steps: PlanStep[]) => steps.map((s) => `${s.originKey} ${s.effect}`);

describe('the preset installer', () => {
  it('is exported from the package index, with the platform data', () => {
    expect(typeof planTeamPresets).toBe('function');
    expect(typeof installTeamPresets).toBe('function');
    const file = JSON.parse(readFileSync(new URL('../data/platform.json', import.meta.url), 'utf8'));
    expect(PLATFORM).toEqual(file);
  });

  describe('its plan', () => {
    it('installs every entry in a team that holds none, in the file’s order, naming the ids it gives', () => {
      const { newId, made } = ids();
      const steps = plan([], [CATEGORY, GAUZE, BUNDLE, FLAG, SETTINGS], newId);
      expect(effects(steps)).toEqual([
        'order_category.demo_supplies install',
        'item.demo_gauze install',
        'bundle.demo_wound install',
        'flag.demo_frost install',
        'settings.team install',
      ]);
      expect(made).toHaveLength(5);
      const [category, gauze, bundle] = steps as Extract<PlanStep, { effect: 'install' }>[];
      expect(category!.id).toBe(made[0]);
      expect(gauze).toMatchObject({ id: made[1], platformVersion: 1, kind: 'item' });
      expect(gauze!.body).toEqual({ ...GAUZE.body, categoryId: made[0] });
      expect(bundle!.body).toEqual({ ...BUNDLE.body, lines: [{ itemId: made[1], qty: 2, core: true }] });
    });

    it('names a preset the team holds by its own id', () => {
      const category = held(CATEGORY, 1);
      const steps = plan([category], [CATEGORY, GAUZE]);
      expect(effects(steps)).toEqual(['item.demo_gauze install']);
      expect((steps[0] as Extract<PlanStep, { effect: 'install' }>).body).toMatchObject({
        categoryId: id(1),
      });
    });

    it('has nothing to do for a team that holds every entry at the platform’s version', () => {
      const { newId, made } = ids();
      const category = held(CATEGORY, 1);
      const gauze = held(GAUZE, 2, {}, { [CATEGORY.originKey]: id(1) });
      expect(plan([category, gauze], [CATEGORY, GAUZE], newId)).toEqual([]);
      expect(made).toEqual([]);
    });

    it('gives a team the newest version of an entry the file holds twice, never the older', () => {
      const newer = v2(CATEGORY, { name: 'Demo: Supplies and kits' });
      const steps = plan([], [CATEGORY, newer, GAUZE]);
      expect(effects(steps)).toEqual(['order_category.demo_supplies install', 'item.demo_gauze install']);
      expect(steps[0]).toMatchObject({ platformVersion: 2, body: newer.body });
    });

    it('updates a copy the team never edited to the next version, and names the version it makes', () => {
      const category = held(CATEGORY, 1, { currentVersion: 3, originVersion: 1, platformLatest: 1 });
      const newer = v2(CATEGORY, { name: 'Demo: Supplies and kits', sort: 15 });
      expect(plan([category], [newer])).toEqual([
        {
          effect: 'update',
          originKey: CATEGORY.originKey,
          kind: 'order_category',
          platformVersion: 2,
          id: id(1),
          version: 4,
          body: newer.body,
        },
      ]);
    });

    it('offers, never writes, an update to a copy the team edited, archived, or whose fixed field it changes', () => {
      const edited = held(FLAG, 1, { customized: true, currentVersion: 2 });
      const archived = held(CATEGORY, 2, { state: 'archived', customized: true });
      const gauze = held(GAUZE, 3, {}, { [CATEGORY.originKey]: id(2) });
      const steps = plan(
        [edited, archived, gauze],
        [
          v2(CATEGORY, { sort: 11 }),
          v2(GAUZE, { unit: 'box' }),
          v2(FLAG, { criteria: 'Demo: below freezing.' }),
        ],
      );
      expect(steps).toEqual([
        {
          effect: 'offer',
          originKey: CATEGORY.originKey,
          kind: 'order_category',
          platformVersion: 2,
          id: id(2),
        },
        { effect: 'offer', originKey: GAUZE.originKey, kind: 'item', platformVersion: 2, id: id(3) },
        { effect: 'offer', originKey: FLAG.originKey, kind: 'flag', platformVersion: 2, id: id(1) },
      ]);
    });

    it('only offers a newer version of a flag the team reordered: its rank is the team’s', () => {
      const after = presetWriteEffect({
        act: 'reorder',
        kind: 'flag',
        state: 'active',
        baseVersion: null,
        currentVersion: 1,
        changedFixed: false,
        sameBody: false,
        referencedBy: {},
        archivedRefs: 0,
        nameTaken: false,
        updateOnOffer: false,
        updateChangesFixed: false,
      });
      if ('refuse' in after) throw new Error(`a reorder was refused: ${after.refuse}`);
      const reordered = held(FLAG, 1, {
        currentVersion: after.versionAfter,
        customized: after.customizedAfter,
        body: { ...FLAG.body, rank: 20 } as PresetBody,
      });
      expect(effects(plan([reordered], [v2(FLAG, { criteria: 'Demo: below freezing.' })]))).toEqual([
        'flag.demo_frost offer',
      ]);
    });

    it('offers an update once: a copy whose newest platform version is offered already is no step', () => {
      const edited = held(FLAG, 1, { customized: true, currentVersion: 2, platformLatest: 2 });
      expect(plan([edited], [v2(FLAG, { criteria: 'Demo: below freezing.' })])).toEqual([]);
      // A newer one is offered again.
      expect(effects(plan([edited], [v2(FLAG, { criteria: 'Demo: freezing.' }, 3)]))).toEqual([
        'flag.demo_frost offer',
      ]);
    });

    it('decides every case of platform-update.json as platformUpdateEffect does', () => {
      const vectors = JSON.parse(
        readFileSync(new URL('../../contract/test-vectors/platform-update.json', import.meta.url), 'utf8'),
      ) as { cases: { name: string; input: PlatformUpdateInput; expected: string }[] };
      for (const { name, input, expected } of vectors.cases) {
        const entry = input.changesFixed
          ? v2(FLAG, { tier: 'primary' }, input.platformVersion)
          : v2(FLAG, { criteria: 'Demo: newer.' }, input.platformVersion);
        const team = input.exists
          ? [
              held(FLAG, 1, {
                state: input.state!,
                customized: input.customized,
                originVersion: input.originVersion,
                platformLatest: input.originVersion,
                currentVersion: 1,
              }),
            ]
          : [];
        const steps = plan(team, [entry]);
        expect(
          steps.map((s) => s.effect),
          name,
        ).toEqual(expected === 'skip' ? [] : [expected]);
      }
    });

    it('skips and reports an entry validatePreset refuses: a new bundle whose item the team archived', () => {
      const category = held(CATEGORY, 1);
      const gauze = held(GAUZE, 2, { state: 'archived', customized: true }, { [CATEGORY.originKey]: id(1) });
      const steps = plan([category, gauze], [CATEGORY, GAUZE, BUNDLE]);
      expect(steps).toEqual([
        {
          effect: 'skipped',
          originKey: BUNDLE.originKey,
          kind: 'bundle',
          platformVersion: 1,
          problems: [{ path: 'lines.0.itemId', code: 'reference_archived' }],
        },
      ]);
    });

    it('skips an update validatePreset refuses, and never writes its body', () => {
      const category = held(CATEGORY, 1);
      const gauze = held(GAUZE, 2, { state: 'archived', customized: true }, { [CATEGORY.originKey]: id(1) });
      const bundle = held(BUNDLE, 3, {}, { [GAUZE.originKey]: id(2) });
      const steps = plan(
        [category, gauze, bundle],
        [CATEGORY, GAUZE, v2(BUNDLE, { prompt: 'Demo: ask first.' })],
      );
      expect(steps.map((s) => s.effect)).toEqual(['skipped']);
      expect((steps[0] as Extract<PlanStep, { effect: 'skipped' }>).problems).toEqual([
        { path: 'lines.0.itemId', code: 'reference_archived' },
      ]);
    });

    it('skips an entry that names one the team neither holds nor is given', () => {
      // The item's category is neither among the entries given nor held by the team.
      const steps = plan([], [GAUZE]);
      expect(steps.map((s) => s.effect)).toEqual(['skipped']);
      expect((steps[0] as Extract<PlanStep, { effect: 'skipped' }>).problems.map((p) => p.code)).toContain(
        'unknown_reference',
      );
    });

    it('checks a map against the team’s note types, and refuses a second settings preset', () => {
      expect(effects(plan([], [CATEGORY, GAUZE, MAP]))).toEqual([
        'order_category.demo_supplies install',
        'item.demo_gauze install',
        'field_supply_map.demo_dressing install',
      ]);
      const noNoteTypes = planTeamPresets({
        held: [],
        platform: [CATEGORY, GAUZE, MAP],
        definitions: {},
        newId: ids().newId,
        fold,
      });
      expect(noNoteTypes.at(-1)).toMatchObject({
        effect: 'skipped',
        problems: [{ path: 'noteTypeKey', code: 'unknown_note_type' }],
      });
      const own: HeldPreset = {
        ...held(SETTINGS, 9),
        originKey: null,
        originVersion: null,
        platformLatest: null,
      };
      expect(plan([own], [SETTINGS])).toEqual([
        {
          effect: 'skipped',
          originKey: SETTINGS.originKey,
          kind: 'settings',
          platformVersion: 1,
          problems: [{ path: '', code: 'settings_taken' }],
        },
      ]);
    });

    it('checks a medication item against the category it is given in the same plan', () => {
      const painBundle = {
        ...BUNDLE,
        body: { ...BUNDLE.body, lines: [{ itemId: 'item.demo_pain', qty: 1, core: true }] },
      };
      const steps = plan([], [MEDS, PAIN, painBundle]);
      // The bundle holds a medication and is Non-Medical: refused, as an admin's would be.
      expect(effects(steps)).toEqual([
        'order_category.demo_otc install',
        'item.demo_pain install',
        'bundle.demo_wound skipped',
      ]);
      expect((steps[2] as Extract<PlanStep, { effect: 'skipped' }>).problems).toEqual([
        { path: 'medical', code: 'bundle_not_medical' },
      ]);
    });

    it('leaves alone a held preset the platform no longer names, and a team’s own', () => {
      const gone = held(FLAG, 1);
      const own: HeldPreset = {
        ...held(CATEGORY, 2),
        originKey: null,
        originVersion: null,
        platformLatest: null,
      };
      expect(plan([gone, own], [])).toEqual([]);
    });

    it('is pure: what it is given is not changed', () => {
      const team = [held(CATEGORY, 1)];
      const platform = [CATEGORY, GAUZE, BUNDLE];
      const before = structuredClone({ team, platform });
      plan(team, platform);
      expect({ team, platform }).toEqual(before);
    });

    // An active preset's name is its own within its kind, ignoring case (0023's unique index): an
    // entry that would take one is never written, since the head's insert would do nothing and its
    // version and event nothing either, and an update renaming into one would fail the caller.
    const own = (entry: PlatformEntry, n: number, over: Partial<HeldPreset> = {}): HeldPreset => ({
      ...held(entry, n, over, { [CATEGORY.originKey]: id(1) }),
      originKey: null,
      originVersion: null,
      platformLatest: null,
    });
    const nameTaken = { path: 'name', code: 'name_taken' };

    it('skips an install whose name, ignoring case, an active preset of its kind holds', () => {
      const category = held(CATEGORY, 1);
      const ours = own({ ...GAUZE, body: { ...GAUZE.body, name: 'demo: GAUZE' } }, 2);
      expect(plan([category, ours], [CATEGORY, GAUZE])).toEqual([
        {
          effect: 'skipped',
          originKey: GAUZE.originKey,
          kind: 'item',
          platformVersion: 1,
          problems: [nameTaken],
        },
      ]);
      // An archived preset frees its name, and a preset of another kind never held it.
      const archived = own(GAUZE, 2, { state: 'archived', customized: true });
      const category2 = own({ ...MEDS, body: { ...MEDS.body, name: 'Demo: Gauze' } }, 3);
      expect(effects(plan([category, archived, category2], [CATEGORY, GAUZE]))).toEqual([
        'item.demo_gauze install',
      ]);
    });

    it('skips an update that renames a copy into a name another active preset holds; its own name is its own', () => {
      const category = held(CATEGORY, 1);
      const ours = own({ ...CATEGORY, body: { ...CATEGORY.body, name: 'Demo: Supplies and kits' } }, 2);
      expect(plan([category, ours], [v2(CATEGORY, { name: 'Demo: SUPPLIES and kits' })])).toEqual([
        {
          effect: 'skipped',
          originKey: CATEGORY.originKey,
          kind: 'order_category',
          platformVersion: 2,
          problems: [nameTaken],
        },
      ]);
      expect(effects(plan([category, ours], [v2(CATEGORY, { name: 'demo: supplies', sort: 12 })]))).toEqual([
        'order_category.demo_supplies update',
      ]);
    });

    it('keeps a name taken for the rest of the run once a step gives it, or a copy leaves it', () => {
      const socks = { ...GAUZE, originKey: 'item.demo_socks' };
      // A copy renamed away from a name: an install of that name waits for the next run.
      const category = held(CATEGORY, 1);
      const gauze = held(GAUZE, 2, {}, { [CATEGORY.originKey]: id(1) });
      expect(effects(plan([category, gauze], [v2(GAUZE, { name: 'Demo: Gauze pads' }), socks]))).toEqual([
        'item.demo_gauze update',
        'item.demo_socks skipped',
      ]);
      // Two entries of one name in one run: the first is installed.
      expect(effects(plan([], [CATEGORY, GAUZE, socks]))).toEqual([
        'order_category.demo_supplies install',
        'item.demo_gauze install',
        'item.demo_socks skipped',
      ]);
    });

    // PostgreSQL's lower() folds 'İ' to 'i', where JS's toLowerCase gives 'i' and a combining dot:
    // a name is compared through the fold the installer asks the database for, never JS's.
    it('compares names as the database folds them, through the fold it is given', () => {
      const asTheDatabase = (name: string) => name.toLowerCase().replaceAll('i̇', 'i');
      const ours = own({ ...CATEGORY, body: { ...CATEGORY.body, name: 'DEMO: SUPPLİES' } }, 2);
      const steps = planTeamPresets({
        held: [ours],
        platform: [CATEGORY, GAUZE],
        definitions,
        newId: ids().newId,
        fold: asTheDatabase,
      });
      // The category is never given, so neither is the item that names it.
      expect(steps).toEqual([
        {
          effect: 'skipped',
          originKey: CATEGORY.originKey,
          kind: 'order_category',
          platformVersion: 1,
          problems: [nameTaken],
        },
        {
          effect: 'skipped',
          originKey: GAUZE.originKey,
          kind: 'item',
          platformVersion: 1,
          problems: [{ path: 'categoryId', code: 'unknown_reference' }],
        },
      ]);
      // A copy the platform renames into such a name is not updated either.
      const copy = held(CATEGORY, 1);
      const kits = own({ ...CATEGORY, body: { ...CATEGORY.body, name: 'DEMO: SUPPLİES AND KİTS' } }, 2);
      expect(
        planTeamPresets({
          held: [copy, kits],
          platform: [v2(CATEGORY, { name: 'Demo: Supplies and kits' })],
          definitions,
          newId: ids().newId,
          fold: asTheDatabase,
        }),
      ).toEqual([
        {
          effect: 'skipped',
          originKey: CATEGORY.originKey,
          kind: 'order_category',
          platformVersion: 2,
          problems: [nameTaken],
        },
      ]);
    });

    it('reads a name taken from the head, which the database’s unique name reads', () => {
      // A head whose name differs from its body's, as no writer should leave one: the head's counts.
      const ours = {
        ...own({ ...GAUZE, body: { ...GAUZE.body, name: 'Demo: Lint' } }, 2),
        name: 'Demo: Gauze',
      };
      expect(effects(plan([held(CATEGORY, 1), ours], [CATEGORY, GAUZE]))).toEqual([
        'item.demo_gauze skipped',
      ]);
      // So is a copy's own: an update giving it the name its body holds is a rename, checked as one.
      const copy = { ...held(CATEGORY, 1), name: 'Demo: Supplies, renamed' };
      const archived = own(CATEGORY, 2, { state: 'archived' });
      const active = own({ ...CATEGORY, body: { ...CATEGORY.body, name: 'Demo: SUPPLIES' } }, 3);
      expect(effects(plan([copy, archived], [v2(CATEGORY, { sort: 11 })]))).toEqual([
        'order_category.demo_supplies update',
      ]);
      expect(effects(plan([copy, active], [v2(CATEGORY, { sort: 11 })]))).toEqual([
        'order_category.demo_supplies skipped',
      ]);
    });

    it('holds a head whose current version cannot be read, and writes nothing over it', () => {
      const unread: HeldPreset = { ...held(CATEGORY, 1), body: null };
      // Held, so never installed again: at the platform's version there is nothing to do.
      expect(plan([unread], [CATEGORY])).toEqual([]);
      // A newer version cannot be checked against what it holds, so nothing is written.
      expect(plan([unread], [v2(CATEGORY, { sort: 11 })])).toEqual([
        {
          effect: 'skipped',
          originKey: CATEGORY.originKey,
          kind: 'order_category',
          platformVersion: 2,
          problems: [{ path: 'currentVersion', code: 'version_missing' }],
        },
      ]);
      // An item the team holds in it has no behaviour to read, so a bundle naming that item is not
      // checked against a guess: it is skipped.
      const gauze = held(GAUZE, 2, {}, { [CATEGORY.originKey]: id(1) });
      expect(plan([unread, gauze], [BUNDLE])).toEqual([
        {
          effect: 'skipped',
          originKey: BUNDLE.originKey,
          kind: 'bundle',
          platformVersion: 1,
          problems: [{ path: 'lines.0.itemId', code: 'unknown_reference' }],
        },
      ]);
      // Its name stays taken, and nothing that names it is written, since it cannot be checked.
      const sameName = { ...CATEGORY, originKey: 'order_category.demo_other' };
      expect(effects(plan([unread], [CATEGORY, sameName, GAUZE]))).toEqual([
        'order_category.demo_other skipped',
        'item.demo_gauze skipped',
      ]);
    });

    it('never writes a body under a copy of another kind', () => {
      const wrong: HeldPreset = { ...held(CATEGORY, 1), originKey: FLAG.originKey };
      expect(plan([wrong], [v2(FLAG, { criteria: 'Demo: newer.' })])).toEqual([
        {
          effect: 'skipped',
          originKey: FLAG.originKey,
          kind: 'flag',
          platformVersion: 2,
          problems: [{ path: 'kind', code: 'wrong_kind' }],
        },
      ]);
    });

    it('reads an item’s behaviour from its category, whatever order the team’s presets come in', () => {
      const otc = held(MEDS, 2);
      const pain = held(PAIN, 3, {}, { [MEDS.originKey]: id(2) });
      const painBundle = {
        ...BUNDLE,
        body: { ...BUNDLE.body, lines: [{ itemId: PAIN.originKey, qty: 1, core: true }] },
      };
      // The item before its category, as a database may answer them: the bundle holds a medication.
      expect(plan([pain, otc], [MEDS, PAIN, painBundle])).toEqual([
        {
          effect: 'skipped',
          originKey: BUNDLE.originKey,
          kind: 'bundle',
          platformVersion: 1,
          problems: [{ path: 'medical', code: 'bundle_not_medical' }],
        },
      ]);
    });

    it('checks what follows an update against the body the update gives', () => {
      // The platform moves the team's Gauze from Supplies into OTC: a new Non-Medical bundle holding
      // it now holds a medication, and is refused as an admin's would be.
      const supplies = held(CATEGORY, 1);
      const otc = held(MEDS, 2);
      const gauze = held(GAUZE, 3, {}, { [CATEGORY.originKey]: id(1) });
      const moved = v2(GAUZE, { categoryId: MEDS.originKey, medical: true });
      const steps = plan([supplies, otc, gauze], [CATEGORY, MEDS, moved, BUNDLE]);
      expect(effects(steps)).toEqual(['item.demo_gauze update', 'bundle.demo_wound skipped']);
      expect((steps[1] as Extract<PlanStep, { effect: 'skipped' }>).problems).toEqual([
        { path: 'medical', code: 'bundle_not_medical' },
      ]);
    });

    describe('an item the platform moves into a medication category (design 4.4)', () => {
      // A bundle holding a medication is Medical (PRD main 447), and only a bundle's own check reads
      // that: an update in place of the item would leave a Non-Medical bundle the team holds holding
      // one. So the item waits, skipped and counted, until no active Non-Medical bundle names it.
      const supplies = held(CATEGORY, 1);
      const otc = held(MEDS, 2);
      const gauze = held(GAUZE, 3, {}, { [CATEGORY.originKey]: id(1) });
      const bundle = (over: Partial<HeldPreset> = {}) => held(BUNDLE, 4, over, { [GAUZE.originKey]: id(3) });
      const moved = v2(GAUZE, { categoryId: MEDS.originKey, medical: true });
      const tagged = v2(BUNDLE, { medical: true });

      it('skips the item while a Non-Medical bundle the team edited names it, and only offers the bundle its tag', () => {
        const steps = plan(
          [supplies, otc, gauze, bundle({ customized: true })],
          [CATEGORY, MEDS, moved, tagged],
        );
        expect(steps).toEqual([
          {
            effect: 'skipped',
            originKey: GAUZE.originKey,
            kind: 'item',
            platformVersion: 2,
            problems: [{ path: 'categoryId', code: 'bundle_not_medical' }],
          },
          { effect: 'offer', originKey: BUNDLE.originKey, kind: 'bundle', platformVersion: 2, id: id(4) },
        ]);
      });

      it('moves the item at the next run once the bundle is Medical, and the bundle the platform tags then', () => {
        // The team never edited its bundle: this run tags it Medical and skips the item, the next
        // run moves the item, since no Non-Medical bundle names it any more.
        const first = plan([supplies, otc, gauze, bundle()], [CATEGORY, MEDS, moved, tagged]);
        expect(effects(first)).toEqual(['item.demo_gauze skipped', 'bundle.demo_wound update']);
        const taggedBody = (first[1] as Extract<PlanStep, { effect: 'update' }>).body;
        const after = bundle({ originVersion: 2, platformLatest: 2, currentVersion: 2, body: taggedBody });
        const second = plan([supplies, otc, gauze, after], [CATEGORY, MEDS, moved, tagged]);
        expect(effects(second)).toEqual(['item.demo_gauze update']);
      });

      it('updates an item that stays where it is, whatever a bundle holding it breaks already', () => {
        // A Non-Medical bundle already holding a medication (a writer before this rule) breaks it by
        // another item: renaming that item moves nothing, so it is not held back for the bundle.
        const pain = held(PAIN, 5, {}, { [MEDS.originKey]: id(2) });
        const broken = bundle({
          customized: true,
          body: {
            ...bundle().body!,
            lines: [
              { itemId: id(3), qty: 1, core: true },
              { itemId: id(5), qty: 1, core: true },
            ],
          } as PresetBody,
        });
        const renamed = v2(PAIN, { name: 'Demo: Pain tablets' });
        expect(effects(plan([supplies, otc, gauze, pain, broken], [CATEGORY, MEDS, GAUZE, renamed]))).toEqual(
          ['item.demo_pain update'],
        );
      });

      it('moves the item when the bundle naming it is archived, or Medical already', () => {
        for (const over of [{ state: 'archived' as const, customized: true }, { customized: true }]) {
          const held4 =
            over.state === 'archived'
              ? bundle(over)
              : bundle({ ...over, body: { ...bundle().body!, medical: true } as PresetBody });
          expect(
            effects(plan([supplies, otc, gauze, held4], [CATEGORY, MEDS, moved])),
            JSON.stringify(over),
          ).toEqual(['item.demo_gauze update']);
        }
      });
    });
  });

  describe('on a stand-in for the caller’s transaction', () => {
    type Kind =
      | 'lock'
      | 'revision'
      | 'read'
      | 'head insert'
      | 'head update'
      | 'version insert'
      | 'event insert'
      | 'audit';
    /**
     * What the database answers a statement the installer sends: the revision taken, the names it
     * folds, and the id of each head it writes (each but the last `dropped`, as a head a unique
     * index refused under `on conflict do nothing`); no rows for anything else.
     */
    const answer = (text: string, parameters: readonly (string | number)[], dropped = 0): object[] => {
      if (/team_preset_state/.test(text)) return [{ revision: '7' }];
      if (/lower\(/.test(text))
        return (JSON.parse(String(parameters[0])) as string[]).map((name) => ({ name, folded: fold(name) }));
      if (/insert into sineobex\.team_presets\b/.test(text)) {
        const heads = JSON.parse(String(parameters.find((p) => String(p).startsWith('[')))) as {
          id: string;
        }[];
        return heads.slice(0, heads.length - dropped).map(({ id }) => ({ id }));
      }
      return [];
    };
    /** A transaction in which the team holds nothing: every read answers no rows. */
    function standIn(dropped = 0) {
      const asked: { kind: Kind; text: string }[] = [];
      const sql: InstallSql = async (template, ...parameters) => {
        const text = template.join('?').replace(/\s+/g, ' ');
        const kind: Kind = /pg_advisory_xact_lock/.test(text)
          ? 'lock'
          : /team_preset_state/.test(text)
            ? 'revision'
            : /audit/.test(text)
              ? 'audit'
              : /insert into sineobex\.team_presets\b/.test(text)
                ? 'head insert'
                : /update sineobex\.team_presets\b/.test(text)
                  ? 'head update'
                  : /insert into sineobex\.team_preset_versions/.test(text)
                    ? 'version insert'
                    : /insert into sineobex\.team_preset_events/.test(text)
                      ? 'event insert'
                      : 'read';
        asked.push({ kind, text });
        return answer(text, parameters, dropped) as never;
      };
      return { sql, asked };
    }
    const TEAM = '00000000-0000-4000-8000-0000000000aa';

    it('asks nothing, locks nothing and takes no revision when the platform has no entries', async () => {
      const { sql, asked } = standIn();
      expect(await installTeamPresets(sql, TEAM, { platform: [] })).toEqual({
        install: {},
        update: {},
        offer: {},
        skipped: {},
      });
      expect(asked).toEqual([]);
    });

    it('takes no lock and writes nothing when all it would do is skip, and counts the skips', async () => {
      // No note types in the stand-in's team: the map is refused.
      const { sql, asked } = standIn();
      const map = { ...MAP, body: { ...MAP.body, lines: [{ itemId: id(5), qty: 1 }] } };
      const counts = await installTeamPresets(sql, TEAM, { platform: [map] });
      expect(counts).toEqual({ install: {}, update: {}, offer: {}, skipped: { field_supply_map: 1 } });
      expect(asked.map((a) => a.kind).filter((k) => k !== 'read')).toEqual([]);
    });

    it('reads, then locks and works its plan out again, then takes one revision, then writes, auditing nothing', async () => {
      const { sql, asked } = standIn();
      const { newId } = ids();
      const counts = await installTeamPresets(sql, TEAM, { platform: [CATEGORY, GAUZE, FLAG], newId });
      expect(counts).toEqual({
        install: { order_category: 1, item: 1, flag: 1 },
        update: {},
        offer: {},
        skipped: {},
      });
      const kinds = asked.map((a) => a.kind);
      const first = (k: Kind) => kinds.indexOf(k);
      const writes = kinds.flatMap((k, i) => (/insert|update/.test(k) ? [i] : []));
      expect(first('read')).toBe(0);
      expect(first('lock')).toBeGreaterThan(first('read'));
      // The plan is worked out again under the lock: a read between the lock and the first write.
      expect(kinds.slice(first('lock') + 1, writes[0]).includes('read')).toBe(true);
      // One revision for the whole run, taken before any head is written (a head needs it).
      expect(kinds.filter((k) => k === 'revision')).toHaveLength(1);
      expect(first('revision')).toBeLessThan(Math.min(...writes));
      expect(kinds).not.toContain('audit');
      // Each head written with on conflict do nothing; each entry its version and its event.
      for (const a of asked.filter((x) => x.kind === 'head insert')) expect(a.text).toMatch(/on conflict/);
      for (const k of ['head insert', 'version insert', 'event insert'] as Kind[])
        expect(kinds, k).toContain(k);
      // Nothing after the run's last write is a lock or a revision.
      expect(kinds.slice(Math.max(...writes)).filter((k) => k === 'lock' || k === 'revision')).toEqual([]);
    });

    it('asks the database to fold the names it compares, and only when it may write', async () => {
      const { sql, asked } = standIn();
      await installTeamPresets(sql, TEAM, { platform: [CATEGORY, GAUZE] });
      const folds = asked.filter((a) => /lower\(/.test(a.text));
      expect(folds.length).toBeGreaterThan(0);
      // Before the lock, and again under it, with each plan.
      const at = (a: (typeof asked)[number]) => asked.indexOf(a);
      const lock = asked.findIndex((a) => a.kind === 'lock');
      expect(folds.some((a) => at(a) < lock) && folds.some((a) => at(a) > lock)).toBe(true);
    });

    it('stops, writing nothing more, when the database writes fewer heads than it planned', async () => {
      // A head a unique index refused under on conflict do nothing: only a writer that never took the
      // team lock could have made one. Every entry naming it would point at nothing, for good.
      const { sql, asked } = standIn(1);
      const run = installTeamPresets(sql, TEAM, { platform: [CATEGORY, GAUZE, FLAG] });
      await expect(run).rejects.toThrow();
      const error = (await run.then(
        () => null,
        (e: unknown) => e,
      )) as Error;
      // The message names no preset: it may reach a log.
      for (const name of [
        'Demo: Supplies',
        'Demo: Gauze',
        'Demo: Frost risk',
        'order_category.demo_supplies',
      ])
        expect(error.message).not.toContain(name);
      const kinds = asked.map((a) => a.kind);
      expect(kinds.slice(kinds.indexOf('head insert') + 1)).toEqual([]);
    });

    it('reads a note type only when a map that names it may be written', async () => {
      // A team that holds what it reads back; no note type is there to read.
      const asked: { text: string; parameters: readonly (string | number)[] }[] = [];
      const holding =
        (team: HeldPreset[]): InstallSql =>
        async (template, ...parameters) => {
          const text = template.join('?').replace(/\s+/g, ' ');
          asked.push({ text, parameters });
          return (/from sineobex\.team_presets p\b/.test(text) ? team : answer(text, parameters)) as never;
        };
      const readsOf = () => asked.filter((a) => /note_type/.test(a.text));
      const ids = { [CATEGORY.originKey]: id(1), [GAUZE.originKey]: id(2) };
      const settled = [held(CATEGORY, 1), held(GAUZE, 2, {}, ids), held(MAP, 3, {}, ids)];
      const newer = v2(MAP, { name: 'Demo: Dressing on' });

      // Settled, or a newer map only offered (the team edited it): no body to check, nothing read.
      expect(await installTeamPresets(holding(settled), TEAM, { platform: [CATEGORY, GAUZE, MAP] })).toEqual({
        install: {},
        update: {},
        offer: {},
        skipped: {},
      });
      const edited = [...settled.slice(0, 2), held(MAP, 3, { customized: true, currentVersion: 2 }, ids)];
      await installTeamPresets(holding(edited), TEAM, { platform: [CATEGORY, GAUZE, newer] });
      expect(readsOf()).toEqual([]);
      // Nor is a name folded: nothing may be written, so no name is compared.
      expect(asked.filter((a) => /lower\(/.test(a.text))).toEqual([]);

      // A newer map the team never edited is checked against its note type, which is read; the
      // stand-in holds none, so the update is skipped, and nothing is locked or written.
      expect(
        await installTeamPresets(holding(settled), TEAM, { platform: [CATEGORY, GAUZE, newer] }),
      ).toEqual({
        install: {},
        update: {},
        offer: {},
        skipped: { field_supply_map: 1 },
      });
      expect(readsOf().map((a) => a.parameters)).toEqual([[TEAM, JSON.stringify(['wound_care'])]]);
    });
  });
});
