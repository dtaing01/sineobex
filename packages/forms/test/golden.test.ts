import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical.ts';
import { effectiveAnswers } from '../src/interp/effective.ts';
import { expandQuick } from '../src/interp/expand.ts';
import { finishCheck } from '../src/interp/finish.ts';
import { handoffLines } from '../src/interp/handoff.ts';
import { readModel } from '../src/interp/read-model.ts';
import { recapLines } from '../src/interp/recap.ts';
import { visibleAnswers } from '../src/interp/visible.ts';
import { definitionModel } from '../src/interp/field-at.ts';
import { resolve } from '../src/resolve.ts';
import type { DefinitionFiles, ResolvedNoteType } from '../src/resolve.ts';
import { exportDefinitions, PRESETS_FILE } from '../scripts/export.ts';
import type { Preset } from '../scripts/export.ts';
import {
  FILLED,
  GOLDEN_ENTRY,
  GOLDEN_FILE,
  GOLDEN_NEW_ENTRY,
  GOLDEN_READERS,
  goldenOf,
  main,
  writeGolden,
} from '../scripts/golden.ts';
import { definitionFiles } from './fixtures/load.ts';
import { fixturePresets } from './fixtures/presets.ts';

// The golden file (forms 7.3): what the TypeScript interpreter says about every preset for five
// sets of answers made by rule, which the phone's interpreter is held to. Each case runs the export
// and then the golden script over a scratch copy of the fixture trees: the real tree is never
// written by a test.

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'forms-golden-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ENTRY = GOLDEN_ENTRY.id;
const AT = GOLDEN_ENTRY.at;

/** A made-up note type whose sections offer Normal, one of them repeating. */
const NORMAL_DEMO = {
  key: 'normal_demo',
  version: 1,
  title: 'Normal (test)',
  kinds: ['medical'],
  group: 'clinical',
  sensitivity: 'none',
  sections: [
    {
      id: 'vitals',
      title: 'Vitals',
      normal: true,
      fields: [
        {
          id: 'pupils',
          kind: 'choice',
          many: false,
          label: 'Pupils',
          options: [
            { code: 'unequal', label: 'Unequal' },
            { code: 'equal', label: 'Equal', normal: true },
          ],
        },
        // Normal hides it, so Normal does not fill it; the first option of Pupils shows it.
        {
          id: 'detail',
          kind: 'choice',
          many: true,
          label: 'Detail',
          showWhen: { field: 'vitals.pupils', is: 'unequal' },
          options: [
            { code: 'left_larger', label: 'Left larger', normal: true },
            { code: 'right_larger', label: 'Right larger' },
          ],
        },
        { id: 'pulse', kind: 'number', label: 'Pulse', min: 0, max: 250, decimals: 0, normal: 70 },
      ],
    },
    {
      id: 'sets',
      title: 'Sets',
      normal: true,
      repeat: { max: 3, itemTitle: 'Set {n}' },
      fields: [
        {
          id: 'rhythm',
          kind: 'choice',
          many: false,
          label: 'Rhythm',
          options: [
            { code: 'irregular', label: 'Irregular' },
            { code: 'regular', label: 'Regular', normal: true },
          ],
        },
      ],
    },
    {
      id: 'plan',
      title: 'Plan',
      fields: [
        {
          id: 'next',
          kind: 'choice',
          many: true,
          label: 'Next',
          required: true,
          options: [
            { code: 'rest', label: 'Rest', normal: true },
            { code: 'return', label: 'Return' },
          ],
        },
      ],
    },
  ],
};

/**
 * A package folder holding definitions/ copied from the fixture trees, released by the export: only
 * a released version is a preset (D78). The one fixture file no note type uses is left out, since a
 * release refuses it.
 */
async function exported(...from: string[]) {
  const root = mkdtempSync(join(scratch, 'tree-'));
  const definitions = join(root, 'definitions');
  for (const name of from) cpSync(join(FIXTURES, name), definitions, { recursive: true });
  rmSync(join(definitions, 'modules/demo_exam/v2.json'), { force: true });
  const write = (path: string, content: unknown) => {
    mkdirSync(dirname(join(definitions, path)), { recursive: true });
    writeFileSync(join(definitions, path), JSON.stringify(content, null, 2));
  };
  write('note-types/normal_demo/v1.json', NORMAL_DEMO);
  const phoneAsset = join(root, 'phone', 'presets.json');
  const result = await exportDefinitions({ root, phoneAsset, release: true });
  expect(result.problems).toEqual([]);
  return {
    root,
    presets: result.presets,
    golden: join(root, GOLDEN_FILE),
    write,
    run: () => exportDefinitions({ root, phoneAsset }),
  };
}

const caseOf = (golden: Awaited<ReturnType<typeof goldenOf>>, key: string, name: string) => {
  const found = golden.find((g) => g.key === key)?.cases.find((c) => c.name === name);
  if (!found) throw new Error(`no ${name} case for ${key}`);
  return found;
};

describe('the golden file', () => {
  it('holds every preset in the presets’ order, with its hash, and five cases named by their rule', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    expect(golden.map(({ key, version, hash }) => ({ key, version, hash }))).toEqual(
      t.presets.map(({ key, version, hash }) => ({ key, version, hash })),
    );
    for (const preset of golden)
      expect(preset.cases.map((c) => c.name)).toEqual(['blank', 'normal', 'first', 'systems', 'every']);
    const written = readFileSync(t.golden, 'utf8');
    expect(JSON.parse(written)).toEqual(golden);
    expect(written.endsWith(']\n')).toBe(true);
  });

  it('gives each case what finishCheck, recapLines and the hash of readModel’s canonical JSON say for its answers', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    const definitions = new Map<string, ResolvedNoteType>(t.presets.map((p) => [p.key, p.definition]));
    let checked = 0;
    for (const preset of golden) {
      const definition = definitions.get(preset.key)!;
      for (const c of preset.cases) {
        expect(c.finishCheck).toEqual(finishCheck(definition, c.answers));
        expect(c.recapLines).toEqual(recapLines(definition, c.answers));
        expect(c.readModelHash).toBe(await sha256Hex(canonicalJson(readModel(definition, c.answers, []))));
        expect(c.handoffLines).toEqual(handoffLines([definition], [c.answers]));
        expect(c.effectiveKeys).toEqual(Object.keys(effectiveAnswers(definition, c.answers)));
        for (const [who, reader] of Object.entries(GOLDEN_READERS))
          expect(c.visibleHashes[who as keyof typeof GOLDEN_READERS]).toBe(
            await sha256Hex(canonicalJson(visibleAnswers(definition, c.answers, reader))),
          );
        checked++;
      }
    }
    expect(checked).toBe(4 * 5);
  });

  it('starts from no answers', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    for (const preset of golden) expect(caseOf(golden, preset.key, 'blank').answers).toEqual({});
    expect(caseOf(golden, 'normal_demo', 'blank').finishCheck).toEqual([
      { section: 'plan', path: 'plan.next', problem: 'required' },
    ]);
  });

  it('opens every section, a repeating one with one entry, and applies one-tap Normal to each', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    const normal = caseOf(golden, 'normal_demo', 'normal');
    expect(normal.answers).toEqual({
      'vitals.pupils': 'equal',
      'vitals.pulse': 70,
      [`sets.${ENTRY}.entryAt`]: AT,
      [`sets.${ENTRY}.rhythm`]: 'regular',
    });
    // Plan offers no Normal, so it is still asked for.
    expect(normal.finishCheck).toEqual([{ section: 'plan', path: 'plan.next', problem: 'required' }]);
    expect(normal.recapLines).toEqual([
      { section: 'vitals', text: 'Pupils: Equal; Pulse: 70' },
      { section: 'sets', text: 'Set 1: Rhythm: Regular' },
    ]);
    // A section that does not offer Normal, or that is hidden, is only opened.
    expect(caseOf(golden, 'full_demo', 'normal').answers).toEqual({ [`wounds.${ENTRY}.entryAt`]: AT });
  });

  it('picks the first option of every choice, and every part of a region, at every depth', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    const first = caseOf(golden, 'normal_demo', 'first');
    expect(first.answers).toEqual({
      'vitals.pupils': 'unequal',
      'vitals.detail': ['left_larger'],
      [`sets.${ENTRY}.entryAt`]: AT,
      [`sets.${ENTRY}.rhythm`]: 'irregular',
      'plan.next': ['rest'],
    });
    expect(first.finishCheck).toEqual([]);

    const checks = caseOf(golden, 'checks_demo', 'first').answers;
    expect(checks).toMatchObject({
      'visit.systems': ['none'],
      'visit.concern': 'yes',
      'ears.hearing.right': 'intact',
      'ears.hearing.left': 'intact',
      [`findings.${ENTRY}.where.region`]: 'arm',
      [`findings.${ENTRY}.where.side`]: 'right',
      [`findings.${ENTRY}.where.surface`]: 'anterior',
      [`findings.${ENTRY}.pulses.radial`]: 'zero',
      'status.reflexes.knee.right': 'zero',
    });
    // Nothing but codes and the entries: no text, number, flag, date or problem is made up.
    for (const [path, value] of Object.entries(checks))
      if (!path.endsWith('.entryAt'))
        expect(typeof value === 'string' || (Array.isArray(value) && value.length === 1)).toBe(true);
    // "Yes" shows the required story, which no rule fills.
    expect(caseOf(golden, 'checks_demo', 'first').finishCheck).toContainEqual({
      section: 'visit',
      path: 'visit.story',
      problem: 'required',
    });
  });

  it('sets every answer that opens something, then applies one-tap Normal', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    // Pupils opens Detail, so it takes its first option; Normal then fills Detail, now shown.
    expect(caseOf(golden, 'normal_demo', 'systems').answers).toEqual({
      'vitals.pupils': 'unequal',
      'vitals.detail': ['left_larger'],
      'vitals.pulse': 70,
      [`sets.${ENTRY}.entryAt`]: AT,
      [`sets.${ENTRY}.rhythm`]: 'regular',
    });
    const checks = caseOf(golden, 'checks_demo', 'systems').answers;
    // What did you examine? opens the exam's sections: every option it can hold together, not None.
    expect(checks['visit.systems']).toEqual(['eyes', 'ears', 'skin', 'other']);
    // Nothing that opens nothing is made up: no text, and no number Normal does not fill.
    for (const value of Object.values(checks)) expect(typeof value).not.toBe('number');
  });

  it('fills every answer, a choose-one with its last option and a choose-many with all it can hold', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    const every = caseOf(golden, 'normal_demo', 'every');
    expect(every.answers).toEqual({
      'vitals.pupils': 'equal',
      'vitals.detail': ['left_larger', 'right_larger'],
      'vitals.pulse': 0,
      [`sets.${ENTRY}.entryAt`]: AT,
      [`sets.${ENTRY}.rhythm`]: 'regular',
      'plan.next': ['rest', 'return'],
    });
    // Every kind of answer is reached somewhere in the fixtures, at the value FILLED gives it.
    const values = new Set(
      golden.flatMap((g) =>
        Object.values(caseOf(golden, g.key, 'every').answers).map((v) => JSON.stringify(v)),
      ),
    );
    for (const value of Object.values(FILLED)) expect(values).toContain(JSON.stringify(value));
    expect(values).toContain('true');
  });

  it('expands a quick note into each note type its mapsTo name, into a new entry where it repeats', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    const definitions = new Map<string, ResolvedNoteType>(t.presets.map((p) => [p.key, p.definition]));
    const every = caseOf(golden, 'checks_demo', 'every');
    expect(every.expansions.map((e) => e.key)).toEqual(['full_demo']);
    const [expansion] = every.expansions;
    const entries = { wounds: GOLDEN_NEW_ENTRY };
    expect(expansion).toEqual({
      key: 'full_demo',
      version: 1,
      ...expandQuick(definitions.get('checks_demo')!, every.answers, definitions.get('full_demo')!, entries),
    });
    expect(Object.keys(expansion!.answers).length).toBeGreaterThan(0);
    for (const preset of golden)
      if (preset.key !== 'checks_demo') for (const c of preset.cases) expect(c.expansions).toEqual([]);
  });

  it('writes the answers in code-unit key order, and the same bytes on a second run', async () => {
    const t = await exported('definitions', 'example');
    const golden = await writeGolden({ root: t.root });
    for (const preset of golden)
      for (const c of preset.cases) expect(Object.keys(c.answers)).toEqual(Object.keys(c.answers).sort());
    const once = readFileSync(t.golden, 'utf8');
    await writeGolden({ root: t.root });
    expect(readFileSync(t.golden, 'utf8')).toBe(once);
  });

  it('covers what the presets carry: the released versions, never a draft (D78)', async () => {
    const t = await exported('definitions', 'example');
    const released = t.presets.map(({ key, version }) => `${key} ${version}`);
    expect(released).toContain('normal_demo 1');
    t.write('note-types/normal_demo/v2.json', { ...NORMAL_DEMO, version: 2 });
    t.write('note-types/draft_demo/v1.json', { ...NORMAL_DEMO, key: 'draft_demo' });
    const result = await t.run();
    expect(result.problems).toEqual([]);
    const golden = await writeGolden({ root: t.root });
    expect(golden.map(({ key, version }) => `${key} ${version}`)).toEqual(released);
    expect(golden.map(({ key, version, hash }) => ({ key, version, hash }))).toEqual(
      result.presets.map(({ key, version, hash }) => ({ key, version, hash })),
    );
  });

  it('is an empty list when there is no preset', async () => {
    const root = mkdtempSync(join(scratch, 'empty-'));
    mkdirSync(join(root, 'generated'));
    writeFileSync(join(root, PRESETS_FILE), '[]\n');
    expect(await writeGolden({ root })).toEqual([]);
    expect(readFileSync(join(root, GOLDEN_FILE), 'utf8')).toBe('[]\n');
  });

  it('is what is committed for the package’s own presets', async () => {
    const presets = JSON.parse(readFileSync(join(PACKAGE, PRESETS_FILE), 'utf8')) as Preset[];
    const committed = readFileSync(join(PACKAGE, GOLDEN_FILE), 'utf8');
    expect(`${JSON.stringify(await goldenOf(presets), null, 2)}\n`).toBe(committed);
  });
});

// What the golden file will hold once the definitions are released: the real note types as the
// export would write them, resolved here so a draft is held too. Each case of the phone's golden
// test is only as good as the answers reach (review DIF-1): every section of every note type, each
// exam module opened before Normal runs on it, a sensitive exam's consent asked for, and Expand
// into each note type the quick encounter names.
describe('the golden cases on the real note types', async () => {
  const files = definitionFiles('../../definitions') as DefinitionFiles;
  const presets: Preset[] = [];
  for (const file of Object.keys(files.noteTypes).sort()) {
    const resolved = resolve(file, files);
    if (!resolved.ok) throw new Error(`${file} does not resolve`);
    const { definition } = resolved;
    presets.push({
      key: definition.key,
      version: definition.version,
      hash: await sha256Hex(canonicalJson(definition)),
      definition,
    });
  }
  const golden = await goldenOf(presets);
  const sections = (key: string) =>
    definitionModel(presets.find((p) => p.key === key)!.definition).sections.map((s) => s.section);
  const counted = (key: string, name: string) =>
    new Set(
      caseOf(golden, key, name)
        .effectiveKeys.filter((path) => !path.endsWith('.entryAt'))
        .map((path) => path.split('.')[0]),
    );

  it('reaches every section of every note type with an answer that counts', () => {
    for (const { key } of golden) {
      const reached = new Set(['first', 'systems', 'every'].flatMap((name) => [...counted(key, name)]));
      expect(
        sections(key)
          .filter((s) => !reached.has(s.id))
          .map((s) => `${key} ${s.id}`),
      ).toEqual([]);
    }
  });

  it('opens every exam module before Normal runs on it', () => {
    const general = sections('general_primary_care').filter((s) => s.normal);
    expect(general.length).toBeGreaterThan(20);
    const systems = counted('general_primary_care', 'systems');
    expect(general.filter((s) => !systems.has(s.id)).map((s) => s.id)).toEqual([]);
  });

  it('asks for the consent of each sensitive exam whose questions it opened, which Normal never fills', () => {
    const exams = sections('general_primary_care').filter((s) => s.sensitiveExam);
    expect(exams.map((s) => s.id)).toEqual(expect.arrayContaining(['gu', 'breast', 'rectal']));
    const { finishCheck: problems, answers } = caseOf(golden, 'general_primary_care', 'systems');
    for (const { id } of exams) {
      expect(answers[`${id}.performed`]).toBe(true);
      expect(answers).not.toHaveProperty(`${id}.consented`);
      expect(problems).toContainEqual({ section: id, path: `${id}.consented`, problem: 'required' });
    }
  });

  it('expands the quick encounter into each note type it names, writing answers into each', () => {
    const every = caseOf(golden, 'quick_encounter', 'every');
    expect(every.expansions.map((e) => e.key)).toEqual([
      'general_primary_care',
      'social_needs',
      'wound_care',
    ]);
    for (const expansion of every.expansions)
      expect(Object.keys(expansion.answers), expansion.key).not.toEqual([]);
  });
});

// The phone's golden test (apps/mobile/test/forms/golden_test.dart) holds its interpreter to
// golden.json, which is empty until the definitions are typed. So it also reads this sample: the
// fixture note types and the conformance vectors' definitions as presets, and what this
// interpreter says about each. A change to either interpreter, the fixtures or the vectors'
// definitions shows here; `pnpm --filter @sineobex/forms exec vitest run test/golden.test.ts -u`
// writes the sample again, and the phone's test then says whether Dart agrees.
const SAMPLE = '../../../apps/mobile/test/forms/golden_sample.json';

describe('the phone’s golden sample', () => {
  it('is what goldenOf says for the fixture note types and the vectors’ definitions', async () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../contract/test-vectors/forms-conformance.json', import.meta.url), 'utf8'),
    ) as { definitions: Record<string, ResolvedNoteType> };
    const presets: Preset[] = [...(await fixturePresets())];
    for (const definition of Object.values(vectors.definitions))
      presets.push({
        key: definition.key,
        version: definition.version,
        hash: await sha256Hex(canonicalJson(definition)),
        definition,
      });
    const sample = {
      note: 'Written by packages/forms/test/golden.test.ts; read by golden_test.dart. Do not edit.',
      presets,
      golden: await goldenOf(presets),
    };
    await expect(`${JSON.stringify(sample, null, 2)}\n`).toMatchFileSnapshot(SAMPLE);
  });
});

describe('the command', () => {
  it('writes the file, says so, and takes no argument', async () => {
    const t = await exported('definitions');
    const lines: string[] = [];
    expect(await main([], { root: t.root, print: (line) => lines.push(line) })).toBe(0);
    expect(lines).toEqual([`Wrote ${GOLDEN_FILE}: 3 note type version(s), 5 cases each.`]);
    await expect(main(['--release'], { root: t.root, print: () => {} })).rejects.toThrow(/no argument/);
  });
});
