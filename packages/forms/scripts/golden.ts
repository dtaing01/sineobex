/**
 * The golden file (docs/design/phase-4/forms.md, 7.3): what the TypeScript interpreter says about
 * every note type version in generated/presets.json, written to generated/golden.json. The phone's
 * golden test recomputes all of it from the bundled presets, so the two interpreters are held
 * together on the real forms, not only on the small definitions of the vectors. Run as `pnpm
 * --filter @sineobex/forms golden`, after the export: it reads the presets the export wrote.
 *
 * Three sets of answers, each made by rule from the definition alone, so the phone makes the same:
 *  - `blank`: no answers.
 *  - `normal`: every section opened, then one-tap Normal applied to it, section by section in the
 *    definition's order, each against the answers so far. Opening a repeating section adds one
 *    entry, GOLDEN_ENTRY; any other section is opened by looking at it, which stores nothing.
 *  - `first`: every section opened, then the first option of every code answer picked: each
 *    choice, each part of a region (its region, side and surface), each grid cell and each side,
 *    hidden or not, a choose-many as a list of that one code. Nothing else is made up: no text,
 *    number, flag, date, time, duration or problem. This is the run that exercises every
 *    condition on a choice once (forms 10.4, risk 2).
 * For each: `finishCheck` and `recapLines` as they are, and the SHA-256 of `readModel`'s canonical
 * JSON with no correction, which holds its every label and value without copying the whole model.
 * The answers are written too, in code-unit key order, so a difference in the made-up answers (one-
 * tap Normal on the phone, say) is told apart from a difference in what is said about them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from '../src/canonical.ts';
import { NoteReading } from '../src/interp/conditions.ts';
import { definitionModel } from '../src/interp/field-at.ts';
import { finishCheck } from '../src/interp/finish.ts';
import type { FinishProblem } from '../src/interp/finish.ts';
import { normalAnswers } from '../src/interp/normal.ts';
import { readModel } from '../src/interp/read-model.ts';
import { recapLines } from '../src/interp/recap.ts';
import type { RecapLine } from '../src/interp/recap.ts';
import type { SectionNode } from '../src/paths.ts';
import type { ResolvedNoteType } from '../src/resolve.ts';
import { PRESETS_FILE } from './export.ts';
import type { Preset } from './export.ts';

/** Where the golden file is written, under the package folder. */
export const GOLDEN_FILE = 'generated/golden.json';

/** The one entry an opened repeating section gets: a valid entry ID and entryAt (2.3), fixed. */
export const GOLDEN_ENTRY = { id: 'e0000001', at: '2000-01-01T00:00:00Z' } as const;

export type GoldenCaseName = 'blank' | 'normal' | 'first';

export type GoldenCase = {
  name: GoldenCaseName;
  answers: Record<string, unknown>;
  finishCheck: FinishProblem[];
  recapLines: RecapLine[];
  /** The SHA-256, in hex, of the canonical JSON of `readModel(definition, answers, [])`. */
  readModelHash: string;
};

/** One preset as the golden file holds it: which version, its hash, and its three cases. */
export type Golden = { key: string; version: number; hash: string; cases: GoldenCase[] };

type Answers = Record<string, unknown>;

/** The three sets of answers for a definition, in their fixed order. */
export function answerSets(definition: ResolvedNoteType): { name: GoldenCaseName; answers: Answers }[] {
  const model = definitionModel(definition);

  const normal: Answers = {};
  for (const section of model.sections) {
    const entry = open(section, normal);
    Object.assign(normal, normalAnswers(definition, section.section.id, normal, entry));
  }

  const first: Answers = {};
  for (const section of model.sections) open(section, first);
  const reading = new NoteReading(definition, {});
  for (const leaf of model.leaves.values()) {
    if (leaf.holds.type !== 'codes') continue;
    const option = leaf.holds.options[0];
    // pathOf leaves the entry out of a section that does not repeat.
    if (option) first[reading.pathOf(leaf, GOLDEN_ENTRY.id)] = leaf.holds.many ? [option.code] : option.code;
  }

  return [
    { name: 'blank', answers: {} },
    { name: 'normal', answers: sorted(normal) },
    { name: 'first', answers: sorted(first) },
  ];
}

/** Opens a section: a repeating one gets GOLDEN_ENTRY, whose ID is returned. */
function open(section: SectionNode, answers: Answers): string | undefined {
  if (!section.section.repeat) return undefined;
  answers[`${section.section.id}.${GOLDEN_ENTRY.id}.entryAt`] = GOLDEN_ENTRY.at;
  return GOLDEN_ENTRY.id;
}

const sorted = (answers: Answers): Answers =>
  Object.fromEntries(Object.entries(answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** What the interpreter says about each preset, in the presets' order. */
export async function goldenOf(presets: readonly Preset[]): Promise<Golden[]> {
  const golden: Golden[] = [];
  for (const { key, version, hash, definition } of presets) {
    const cases: GoldenCase[] = [];
    for (const { name, answers } of answerSets(definition))
      cases.push({
        name,
        answers,
        finishCheck: finishCheck(definition, answers),
        recapLines: recapLines(definition, answers),
        readModelHash: await sha256Hex(canonicalJson(readModel(definition, answers, []))),
      });
    golden.push({ key, version, hash, cases });
  }
  return golden;
}

/** Reads `root`/generated/presets.json and writes `root`/generated/golden.json from it. */
export async function writeGolden(options: { root: string }): Promise<Golden[]> {
  const presets = JSON.parse(readFileSync(join(options.root, PRESETS_FILE), 'utf8')) as Preset[];
  const golden = await goldenOf(presets);
  const path = join(options.root, GOLDEN_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(golden, null, 2)}\n`);
  return golden;
}

/** The command: writes the file and says how much it holds. */
export async function main(
  args: readonly string[],
  options: { root: string; print: (line: string) => void },
): Promise<number> {
  if (args.length > 0) throw new Error(`unknown argument ${args.join(' ')}; the command takes no argument`);
  const golden = await writeGolden({ root: options.root });
  options.print(`Wrote ${GOLDEN_FILE}: ${golden.length} note type version(s), 3 cases each.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.exitCode = await main(process.argv.slice(2), { root, print: (line) => console.log(line) });
}
