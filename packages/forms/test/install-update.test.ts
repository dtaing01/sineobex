import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  planNoteTypes,
  sha256Hex,
  type HeldNoteTypeVersion,
  type NoteTypeHead,
  type NoteTypePlan,
  type NoteTypeStep,
  type PlatformUpdateInput,
  type Preset,
  type ResolvedNoteType,
} from '../src/index.ts';

// The note type installer as phase 5 changes it (design 4.3, 5.2; card P4-install), written ahead
// of its code (card P4-tests): its plan, here, key by key; db/test/install-presets.test.ts holds the
// installer that writes it to 0017 and 0023. Each key the presets name is decided by
// platformUpdateEffect, the one rule both installers share (platform-update.json, read here too):
// install a key the team lacks, update in place a copy the team never edited when nothing fixed at
// creation changes, offer every other newer version, which moves only the head's platform_latest,
// and skip a version no newer than the team's. A team's own version is never overtaken (PRD main
// 387; forms 3.2's rule, with the archived case added). Every version it writes names its own row:
// the team's next version, its definition's `version` rewritten to it (4.3). A key the team holds
// without a head gets one. PresetDiffers is raised only for a platform row whose definition, set
// back to its platform version, is not the platform's.
//
// The signature these tests are written to, in packages/forms/src/install.ts and exported from the
// package index (P4-install):
//
//   export type NoteTypeHead = { key; title; state: 'active' | 'archived'; currentVersion; platformLatest: number | null; customized };
//   export type HeldNoteTypeVersion = { key; version; origin: 'preset' | 'team'; presetVersion: number | null; hash; title: string | null };
//   export type NoteTypeStep = {
//     key: string;
//     effect: 'install' | 'update' | 'offer' | null;
//     platformVersion: number | null;
//     head: NoteTypeHead;
//     headMissing: boolean;
//     write: { version: number; presetVersion: number; definition: ResolvedNoteType; hash: string } | null;
//   };
//   export type NoteTypePlan = { steps: NoteTypeStep[]; differing: KeyVersion[] };
//   export function planNoteTypes(input: {
//     heads: readonly NoteTypeHead[];
//     versions: readonly HeldNoteTypeVersion[];
//     presets: readonly Preset[];
//   }): Promise<NoteTypePlan>;

const hashOf = (definition: ResolvedNoteType) => sha256Hex(canonicalJson(definition));

/** A made-up note type at a version, with what each test changes. */
const typeOf = (key: string, version: number, over: Partial<ResolvedNoteType> = {}): ResolvedNoteType => ({
  key,
  version,
  title: `Demo: ${key} version ${version}`,
  kinds: ['non_medical'],
  group: 'outreach',
  sensitivity: 'none',
  sections: [
    {
      id: 'notes',
      title: 'Demo: Notes',
      fields: [
        { id: 'said', kind: 'text', label: `Demo: Said, as of ${version}`, lines: 'one', maxLength: 200 },
      ],
    },
  ],
  ...over,
});

/** A platform version, as the export writes it to generated/presets.json. */
const presetOf = async (definition: ResolvedNoteType): Promise<Preset> => ({
  key: definition.key,
  version: definition.version,
  hash: await hashOf(definition),
  definition,
});

/** The platform's definition at `preset`, named as the team's version `version` (4.3). */
const asVersion = (preset: Preset, version: number): ResolvedNoteType => ({ ...preset.definition, version });

/** A row the team holds of a platform version: the team's version `version`, written as the installer writes it. */
const heldPreset = async (preset: Preset, version = preset.version): Promise<HeldNoteTypeVersion> => ({
  key: preset.key,
  version,
  origin: 'preset',
  presetVersion: preset.version,
  hash: await hashOf(asVersion(preset, version)),
  title: preset.definition.title,
});

/** A version of the team's own, as a publish writes it. */
const heldOwn = async (definition: ResolvedNoteType): Promise<HeldNoteTypeVersion> => ({
  key: definition.key,
  version: definition.version,
  origin: 'team',
  presetVersion: null,
  hash: await hashOf(definition),
  title: definition.title,
});

/** A head as a write leaves it. */
const headOf = (key: string, over: Partial<NoteTypeHead> = {}): NoteTypeHead => ({
  key,
  title: `Demo: ${key} version 1`,
  state: 'active',
  currentVersion: 1,
  platformLatest: 1,
  customized: false,
  ...over,
});

const effects = (plan: NoteTypePlan) => plan.steps.map((s) => `${s.key} ${s.effect ?? 'head only'}`);
const stepOf = (plan: NoteTypePlan, key: string): NoteTypeStep => {
  const step = plan.steps.find((s) => s.key === key);
  if (!step) throw new Error(`the plan has no step for ${key}`);
  return step;
};

describe('the note type installer’s plan, key by key', () => {
  it('is exported from the package index', () => {
    expect(typeof planNoteTypes).toBe('function');
  });

  it('gives a team that holds nothing each key, as its version 1, at the platform’s newest version', async () => {
    const outreach1 = await presetOf(typeOf('demo_outreach', 1));
    const outreach3 = await presetOf(typeOf('demo_outreach', 3, { title: 'Demo: Outreach, third' }));
    const social1 = await presetOf(typeOf('demo_social', 1));
    const plan = await planNoteTypes({ heads: [], versions: [], presets: [outreach1, social1, outreach3] });
    expect(effects(plan)).toEqual(['demo_outreach install', 'demo_social install']);
    expect(plan.differing).toEqual([]);
    const outreach = stepOf(plan, 'demo_outreach');
    // Version 1 is the team's, holding the platform's version 3, renamed to name its own row (4.3):
    // its hash is not the bundled preset's, so a phone downloads it rather than reading the bundle.
    const definition = asVersion(outreach3, 1);
    expect(outreach).toEqual({
      key: 'demo_outreach',
      effect: 'install',
      platformVersion: 3,
      headMissing: true,
      head: {
        key: 'demo_outreach',
        title: 'Demo: Outreach, third',
        state: 'active',
        currentVersion: 1,
        platformLatest: 3,
        customized: false,
      },
      write: { version: 1, presetVersion: 3, definition, hash: await hashOf(definition) },
    });
    expect(outreach.write!.hash).not.toBe(outreach3.hash);
    // At the platform's own number, the definition is the bundled preset's, hash and all.
    expect(stepOf(plan, 'demo_social').write).toEqual({
      version: 1,
      presetVersion: 1,
      definition: social1.definition,
      hash: social1.hash,
    });
  });

  it('has nothing to do for a team that holds each key at the platform’s version, with its head', async () => {
    const outreach = await presetOf(typeOf('demo_outreach', 1));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(outreach)],
      presets: [outreach],
    });
    expect(plan).toEqual({ steps: [], differing: [] });
  });

  it('updates in place a copy the team never edited, as the team’s next version', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2, { title: 'Demo: Outreach, second' }));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(v1)],
      presets: [v1, v2],
    });
    expect(plan.steps).toEqual([
      {
        key: 'demo_outreach',
        effect: 'update',
        platformVersion: 2,
        headMissing: false,
        head: headOf('demo_outreach', {
          title: 'Demo: Outreach, second',
          currentVersion: 2,
          platformLatest: 2,
        }),
        write: { version: 2, presetVersion: 2, definition: v2.definition, hash: v2.hash },
      },
    ]);
  });

  it('names an update by the team’s next version when that is not the platform’s number', async () => {
    // A team made once version 2 was out holds it as its version 1; version 3 is its version 2.
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const v3 = await presetOf(typeOf('demo_outreach', 3));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { platformLatest: 2 })],
      versions: [await heldPreset(v2, 1)],
      presets: [v2, v3],
    });
    const definition = asVersion(v3, 2);
    expect(stepOf(plan, 'demo_outreach')).toMatchObject({
      effect: 'update',
      platformVersion: 3,
      write: { version: 2, presetVersion: 3, definition, hash: await hashOf(definition) },
      head: { currentVersion: 2, platformLatest: 3 },
    });
    expect(plan.differing).toEqual([]);
  });

  it('goes straight to the newest platform version, past those between', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const v3 = await presetOf(typeOf('demo_outreach', 3));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(v1)],
      presets: [v1, v2, v3],
    });
    expect(plan.steps.map((s) => [s.effect, s.write?.version, s.write?.presetVersion])).toEqual([
      ['update', 2, 3],
    ]);
  });

  it('only offers a newer version to a copy the team edited or archived, and writes no version', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    for (const head of [
      headOf('demo_outreach', { customized: true }),
      headOf('demo_outreach', { state: 'archived', customized: true }),
      // An archive that left customized as it was is still the team's: nothing is put over it.
      headOf('demo_outreach', { state: 'archived' }),
    ]) {
      const plan = await planNoteTypes({
        heads: [head],
        versions: [await heldPreset(v1)],
        presets: [v1, v2],
      });
      expect(plan.steps, JSON.stringify(head)).toEqual([
        {
          key: 'demo_outreach',
          effect: 'offer',
          platformVersion: 2,
          headMissing: false,
          head: { ...head, platformLatest: 2 },
          write: null,
        },
      ]);
    }
  });

  it('offers once: a head that records the newest platform version already is no step', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { customized: true, platformLatest: 2 })],
      versions: [await heldPreset(v1)],
      presets: [v1, v2],
    });
    expect(plan.steps).toEqual([]);
  });

  it('a team’s version 2, then platform versions 2 and 3: an offer of 3, nothing written, nothing differing', async () => {
    // The case phase 4's installer got wrong: it would have tried to write the platform's version 2
    // over the team's own (a primary key it holds with another hash), and version 3 above it.
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const v3 = await presetOf(typeOf('demo_outreach', 3));
    const own2 = typeOf('demo_outreach', 2, { title: 'Demo: Outreach, the team’s own' });
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { title: own2.title, currentVersion: 2, customized: true })],
      versions: [await heldPreset(v1), await heldOwn(own2)],
      presets: [v1, v2, v3],
    });
    expect(plan).toEqual({
      steps: [
        {
          key: 'demo_outreach',
          effect: 'offer',
          platformVersion: 3,
          headMissing: false,
          head: headOf('demo_outreach', {
            title: own2.title,
            currentVersion: 2,
            customized: true,
            platformLatest: 3,
          }),
          write: null,
        },
      ],
      differing: [],
    });
  });

  it('never puts a platform version over a key whose newest row is the team’s own, whatever its head says', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const own2 = typeOf('demo_outreach', 2, { title: 'Demo: Outreach, written straight in' });
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(v1), await heldOwn(own2)],
      presets: [v1, v2],
    });
    expect(effects(plan)).toEqual(['demo_outreach offer']);
    expect(stepOf(plan, 'demo_outreach').write).toBeNull();
  });

  it('updates again in place once a team took the update it was offered: its newest row is the platform’s', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const v3 = await presetOf(typeOf('demo_outreach', 3));
    // Edited (2, the team's), then version 2 of the platform taken in place (3, the platform's).
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { currentVersion: 3, platformLatest: 2 })],
      versions: [
        await heldPreset(v1),
        await heldOwn(typeOf('demo_outreach', 2, { title: 'Demo: Outreach, edited' })),
        await heldPreset(v2, 3),
      ],
      presets: [v1, v2, v3],
    });
    expect(stepOf(plan, 'demo_outreach')).toMatchObject({
      effect: 'update',
      write: { version: 4, presetVersion: 3, definition: asVersion(v3, 4) },
    });
  });

  it('only offers a version that changes what is fixed at creation: kinds, group, sensitivity, quick or auto', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    for (const change of [
      { kinds: ['medical'] },
      { group: 'social' },
      { sensitivity: 'sensitive' },
      { quick: true },
      { auto: 'medical', kinds: ['medical'] },
    ] as Partial<ResolvedNoteType>[]) {
      const v2 = await presetOf(typeOf('demo_outreach', 2, change));
      const plan = await planNoteTypes({
        heads: [headOf('demo_outreach')],
        versions: [await heldPreset(v1)],
        presets: [v1, v2],
      });
      expect(effects(plan), JSON.stringify(change)).toEqual(['demo_outreach offer']);
    }
  });

  it('only offers a version that makes the type one added by itself, though it stays Medical', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1, { kinds: ['medical'], group: 'clinical' }));
    const v2 = await presetOf(
      typeOf('demo_outreach', 2, { kinds: ['medical'], group: 'clinical', auto: 'medical' }),
    );
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(v1)],
      presets: [v1, v2],
    });
    expect(effects(plan)).toEqual(['demo_outreach offer']);
  });

  it('takes in place a version that lists the same kinds in another order: kinds are a set', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1, { kinds: ['medical', 'non_medical'] }));
    const v2 = await presetOf(typeOf('demo_outreach', 2, { kinds: ['non_medical', 'medical'] }));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(v1)],
      presets: [v1, v2],
    });
    expect(effects(plan)).toEqual(['demo_outreach update']);
  });

  it('reads the version last taken from the newest platform row: one taken in place is not taken again', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { currentVersion: 2, platformLatest: 2 })],
      versions: [await heldPreset(v1), await heldPreset(v2)],
      presets: [v1, v2],
    });
    expect(plan).toEqual({ steps: [], differing: [] });
  });

  it('offers, never updates, when the platform version the team last took is no longer among the presets', async () => {
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach')],
      versions: [await heldPreset(v1)],
      presets: [v2],
    });
    expect(effects(plan)).toEqual(['demo_outreach offer']);
  });

  it('skips a platform version no newer than the one the team holds', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { currentVersion: 2, platformLatest: 2 })],
      versions: [await heldPreset(v1), await heldPreset(v2)],
      presets: [v1],
    });
    expect(plan.steps).toEqual([]);
  });

  it('never installs over a key the team holds only as its own', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const own = typeOf('demo_outreach', 1, { title: 'Demo: Outreach, the team’s' });
    const plan = await planNoteTypes({
      heads: [headOf('demo_outreach', { title: own.title, platformLatest: null, customized: true })],
      versions: [await heldOwn(own)],
      presets: [v1],
    });
    expect(effects(plan)).toEqual(['demo_outreach offer']);
    expect(stepOf(plan, 'demo_outreach').write).toBeNull();
  });

  describe('a key the team holds without a head (a team made after 0023, before this installer)', () => {
    it('gets the head 0023 would have given it, and nothing else when the platform has nothing new', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const plan = await planNoteTypes({ heads: [], versions: [await heldPreset(v1)], presets: [v1] });
      expect(plan.steps).toEqual([
        {
          key: 'demo_outreach',
          effect: null,
          platformVersion: 1,
          headMissing: true,
          head: headOf('demo_outreach'),
          write: null,
        },
      ]);
    });

    it('gets its head with the update it is given in the same step', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const v2 = await presetOf(typeOf('demo_outreach', 2));
      const plan = await planNoteTypes({ heads: [], versions: [await heldPreset(v1)], presets: [v1, v2] });
      expect(stepOf(plan, 'demo_outreach')).toMatchObject({
        effect: 'update',
        headMissing: true,
        head: { currentVersion: 2, platformLatest: 2, customized: false, state: 'active' },
        write: { version: 2, presetVersion: 2 },
      });
    });

    it('is customized when any version is the team’s own, so a platform version is only offered', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const v2 = await presetOf(typeOf('demo_outreach', 2));
      const own2 = typeOf('demo_outreach', 2, { title: 'Demo: Outreach, the team’s own' });
      const plan = await planNoteTypes({
        heads: [],
        versions: [await heldPreset(v1), await heldOwn(own2)],
        presets: [v1, v2],
      });
      expect(plan.steps).toEqual([
        {
          key: 'demo_outreach',
          effect: 'offer',
          platformVersion: 2,
          headMissing: true,
          head: headOf('demo_outreach', {
            title: own2.title,
            currentVersion: 2,
            platformLatest: 2,
            customized: true,
          }),
          write: null,
        },
      ]);
    });

    it('is given to a key of the team’s own the platform never ships, its title the newest version’s', async () => {
      const first = typeOf('t_000000000005', 1, { title: 'Demo: Night outreach' });
      const second = typeOf('t_000000000005', 2, { title: 'Demo: Night outreach, reworded' });
      const plan = await planNoteTypes({
        heads: [],
        versions: [await heldOwn(second), await heldOwn(first)],
        presets: [],
      });
      expect(plan.steps).toEqual([
        {
          key: 't_000000000005',
          effect: null,
          platformVersion: null,
          headMissing: true,
          head: {
            key: 't_000000000005',
            title: 'Demo: Night outreach, reworded',
            state: 'active',
            currentVersion: 2,
            platformLatest: null,
            customized: true,
          },
          write: null,
        },
      ]);
    });

    it('is titled by its key where the newest version has no title, as 0023 titles one', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const held = { ...(await heldPreset(v1)), title: null };
      const blank = { ...(await heldPreset(v1)), title: '  ' };
      for (const version of [held, blank]) {
        const plan = await planNoteTypes({ heads: [], versions: [version], presets: [v1] });
        expect(stepOf(plan, 'demo_outreach').head.title).toBe('demo_outreach');
      }
    });
  });

  describe('a platform version the team holds with another definition', () => {
    it('is reported by the team’s key and version, and its key gets no version', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const v2 = await presetOf(typeOf('demo_outreach', 2));
      const edited = {
        ...(await heldPreset(v1)),
        hash: await hashOf({ ...v1.definition, title: 'Demo: Edited after release' }),
      };
      const plan = await planNoteTypes({
        heads: [headOf('demo_outreach')],
        versions: [edited],
        presets: [v1, v2],
      });
      expect(plan).toEqual({ steps: [], differing: [{ key: 'demo_outreach', version: 1 }] });
    });

    it('is compared with its version set back to the platform’s: a version renamed to its row is not one', async () => {
      const v2 = await presetOf(typeOf('demo_outreach', 2));
      // The platform's version 2, held as the team's version 1 and so renamed: the platform's still.
      const plan = await planNoteTypes({
        heads: [headOf('demo_outreach', { platformLatest: 2 })],
        versions: [await heldPreset(v2, 1)],
        presets: [v2],
      });
      expect(plan).toEqual({ steps: [], differing: [] });
      // The same row with the bundled preset's own hash names version 2 while it is filed as 1.
      const misnamed = { ...(await heldPreset(v2, 1)), hash: v2.hash };
      expect(
        (
          await planNoteTypes({
            heads: [headOf('demo_outreach', { platformLatest: 2 })],
            versions: [misnamed],
            presets: [v2],
          })
        ).differing,
      ).toEqual([{ key: 'demo_outreach', version: 1 }]);
    });

    it('still gets its missing head, and nothing more', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const edited = {
        ...(await heldPreset(v1)),
        hash: await hashOf({ ...v1.definition, title: 'Demo: Edited' }),
      };
      const plan = await planNoteTypes({ heads: [], versions: [edited], presets: [v1] });
      expect(plan.differing).toEqual([{ key: 'demo_outreach', version: 1 }]);
      expect(plan.steps).toEqual([
        expect.objectContaining({ key: 'demo_outreach', effect: null, headMissing: true, write: null }),
      ]);
    });

    it('is never a team’s own version, nor one the platform no longer ships', async () => {
      const v1 = await presetOf(typeOf('demo_outreach', 1));
      const own = typeOf('demo_outreach', 2, { title: 'Demo: The team’s' });
      const gone = { ...(await heldPreset(await presetOf(typeOf('demo_outreach', 7)))) };
      const plan = await planNoteTypes({
        heads: [headOf('demo_outreach', { customized: true, currentVersion: 7, platformLatest: 7 })],
        versions: [await heldPreset(v1), await heldOwn(own), gone],
        presets: [v1],
      });
      expect(plan.differing).toEqual([]);
    });
  });

  it('decides every case of platform-update.json as platformUpdateEffect does', async () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../contract/test-vectors/platform-update.json', import.meta.url), 'utf8'),
    ) as { cases: { name: string; input: PlatformUpdateInput; expected: string }[] };
    for (const { name, input, expected } of vectors.cases) {
      const held = input.originVersion ?? 1;
      const origin = await presetOf(typeOf('demo_outreach', held));
      const newest = await presetOf(
        typeOf('demo_outreach', input.platformVersion, input.changesFixed ? { group: 'social' } : {}),
      );
      const presets = input.platformVersion === held ? [origin] : [origin, newest];
      const plan = await planNoteTypes({
        heads: input.exists
          ? [
              headOf('demo_outreach', {
                state: input.state!,
                customized: input.customized,
                currentVersion: held,
                platformLatest: held,
              }),
            ]
          : [],
        versions: input.exists ? [await heldPreset(origin, held)] : [],
        presets,
      });
      expect(
        plan.steps.map((s) => s.effect),
        name,
      ).toEqual(expected === 'skip' ? [] : [expected]);
    }
  });

  it('plans in the code-point order of the keys, whatever order it is given them in', async () => {
    const keys = ['demo_b', 'demo_a_b', 'demo_a'];
    const presets = await Promise.all(keys.map((k) => presetOf(typeOf(k, 1))));
    const plan = await planNoteTypes({ heads: [], versions: [], presets });
    expect(plan.steps.map((s) => s.key)).toEqual(['demo_a', 'demo_a_b', 'demo_b']);
  });

  it('is pure: what it is given is not changed', async () => {
    const v1 = await presetOf(typeOf('demo_outreach', 1));
    const v2 = await presetOf(typeOf('demo_outreach', 2));
    const input = { heads: [headOf('demo_outreach')], versions: [await heldPreset(v1)], presets: [v1, v2] };
    const before = canonicalJson(input);
    const plan = await planNoteTypes(input);
    expect(canonicalJson(input)).toBe(before);
    // Nor is what it answers a part of what it was given.
    plan.steps[0]!.write!.definition.title = 'Demo: Changed by its caller';
    expect(v2.definition.title).toBe('Demo: demo_outreach version 2');
  });
});
