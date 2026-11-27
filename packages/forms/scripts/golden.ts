/**
 * The golden file (docs/design/phase-4/forms.md, 7.3): what the TypeScript interpreter says about
 * every note type version in generated/presets.json, written to generated/golden.json. The presets
 * carry only released versions (D78), so a draft has no golden line until it is released. The phone's
 * golden test recomputes all of it from the bundled presets, so the two interpreters are held
 * together on the real forms, not only on the small definitions of the vectors. Run as `pnpm
 * --filter @sineobex/forms golden`, after the export: it reads the presets the export wrote.
 *
 * Five sets of answers, each made by rule from the definition alone, so the phone makes the same.
 * Every set but `blank` first opens every section: a repeating section gets one entry,
 * GOLDEN_ENTRY; any other is opened by looking at it, which stores nothing.
 *  - `blank`: no answers.
 *  - `normal`: one-tap Normal applied to each section, in the definition's order, each against the
 *    answers so far.
 *  - `first`: the first option of every code answer picked: each choice, each part of a region (its
 *    region, side and surface), each grid cell and each side, hidden or not, a choose-many as a
 *    list of that one code. Nothing else is made up: no text, number, flag, date, time, duration or
 *    problem. This is the run that exercises every condition on a choice once (forms 10.4, risk 2).
 *  - `systems`: every answer that opens something set (each a condition names, and each a grid
 *    picks its rows in), then Normal as in `normal`: a choose-many takes every option it can hold
 *    together, a choose-one its first option, a flag is set, and nothing else is made up. So every
 *    exam system is picked and every module opened before Normal runs on it, and a flag that opens
 *    a sensitive exam's questions (Exam performed) is set while the consent it asks for is left
 *    blank, which Complete must then ask for (forms 9).
 *  - `every`: every answer filled, hidden or not, then Normal as in `normal`: a choose-many takes
 *    every option it can hold, a choose-one its last option, a flag is set, and every other kind a
 *    fixed value (FILLED; a text cut to its maxLength, a number its min). So every system is picked
 *    with a finding charted in each, and every follow-up a finding opens is reached.
 * For each: `finishCheck`, `recapLines` and the handoff of the note alone (GOLDEN_SENSITIVE_CODES
 * the sensitive list) as they are; the keys of
 * `effectiveAnswers` in their order; the SHA-256 of the canonical JSON of `readModel` with no
 * correction, of `visibleAnswers` for each of GOLDEN_READERS (of null for a reader who may not see
 * the note), and the content hash a sign-off would carry (GOLDEN_NOTE), each of which holds every
 * value without copying it; and, for each note type a `mapsTo` names, what Expand writes into its
 * newest version, a repeating section's entry being GOLDEN_NEW_ENTRY. The answers are written too,
 * in code-unit key order, so a difference in the made-up answers (one-tap Normal on the phone, say)
 * is told apart from a difference in what is said about them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from '../src/canonical.ts';
import { NoteReading } from '../src/interp/conditions.ts';
import { effectiveAnswers } from '../src/interp/effective.ts';
import { expandQuick } from '../src/interp/expand.ts';
import type { LeftOut } from '../src/interp/expand.ts';
import { definitionModel } from '../src/interp/field-at.ts';
import { finishCheck } from '../src/interp/finish.ts';
import type { FinishProblem } from '../src/interp/finish.ts';
import { handoffLines } from '../src/interp/handoff.ts';
import type { HandoffLine } from '../src/interp/handoff.ts';
import { normalAnswers } from '../src/interp/normal.ts';
import { readModel } from '../src/interp/read-model.ts';
import { recapLines } from '../src/interp/recap.ts';
import type { RecapLine } from '../src/interp/recap.ts';
import { visibleAnswers } from '../src/interp/visible.ts';
import type { NoteReader, SensitiveCodeRange } from '../src/interp/visible.ts';
import { leafAt } from '../src/paths.ts';
import type { FieldNode, Holds, Leaf, PathModel, SectionNode } from '../src/paths.ts';
import type { ResolvedNoteType } from '../src/resolve.ts';
import type { Condition } from '../src/types.ts';
import { PRESETS_FILE } from './export.ts';
import type { Preset } from './export.ts';

/** Where the golden file is written, under the package folder. */
export const GOLDEN_FILE = 'generated/golden.json';

/** The one entry an opened repeating section gets: a valid entry ID and entryAt (2.3), fixed. */
export const GOLDEN_ENTRY = { id: 'e0000001', at: '2000-01-01T00:00:00Z' } as const;

/** The entry Expand writes into in each repeating section of the full note. */
export const GOLDEN_NEW_ENTRY = { id: 'e0000002', at: '2000-01-02T00:00:00Z' } as const;

/** What `every` puts in an answer that is neither a code nor a flag (a text is cut to its maxLength). */
export const FILLED = {
  text: 'Demo',
  date: '2000-01-01',
  time: '12:00',
  duration: 10,
  problemCode: 'F11.20',
  problemLabel: 'Demo problem',
} as const;

/** The note, visit and patient a case's content hash is worked out for (lifecycle 4.5). */
export const GOLDEN_NOTE = {
  noteId: '00000000-0000-4000-8000-000000000001',
  encounterId: '00000000-0000-4000-8000-000000000002',
  patientId: '00000000-0000-4000-8000-000000000003',
  summary: 'Demo summary',
} as const;

/** The sensitive diagnosis codes the readers and the handoff are given. FILLED's problem code is in it, so a diagnosis `every` makes is sensitive. */
export const GOLDEN_SENSITIVE_CODES: readonly SensitiveCodeRange[] = [{ from: 'F10', to: 'F19' }];

const reader = (facts: Partial<NoteReader>): NoteReader => ({
  actsAsAuthor: false,
  viewSensitive: true,
  viewSensitiveExams: true,
  readsMedical: true,
  chartsMedical: true,
  ordersMedications: true,
  sensitiveCodes: GOLDEN_SENSITIVE_CODES,
  ...facts,
});

/**
 * Three readers, none acting as the author, so each of visibleAnswers' rules is run: one who may
 * read everything; one without view_sensitive_exams or a clinical credential (no sensitive exam,
 * no treatment record); one without view_sensitive (no sensitive note type, no sensitive diagnosis).
 */
export const GOLDEN_READERS = {
  full: reader({}),
  noExams: reader({ viewSensitiveExams: false, chartsMedical: false }),
  noSensitive: reader({ viewSensitive: false, viewSensitiveExams: false }),
} as const;

export type GoldenCaseName = 'blank' | 'normal' | 'first' | 'systems' | 'every';
export type GoldenReader = keyof typeof GOLDEN_READERS;

/** What Expand writes from a case's answers into the newest version of a note type a mapsTo names. */
export type GoldenExpansion = {
  key: string;
  version: number;
  answers: Record<string, unknown>;
  leftOut: LeftOut[];
};

export type GoldenCase = {
  name: GoldenCaseName;
  answers: Record<string, unknown>;
  finishCheck: FinishProblem[];
  recapLines: RecapLine[];
  /** `handoffLines` of this note alone, as its author sees it, with GOLDEN_SENSITIVE_CODES. */
  handoffLines: HandoffLine[];
  /** The paths of `effectiveAnswers`, in its order. */
  effectiveKeys: string[];
  /** The SHA-256, in hex, of the canonical JSON of `readModel(definition, answers, [])`. */
  readModelHash: string;
  /** For each reader, the SHA-256 of the canonical JSON of `visibleAnswers`, null included. */
  visibleHashes: Record<GoldenReader, string>;
  /** The content hash a sign-off of this note would carry, for GOLDEN_NOTE. */
  contentHash: string;
  expansions: GoldenExpansion[];
};

/** One preset as the golden file holds it: which version, its hash, and its cases. */
export type Golden = { key: string; version: number; hash: string; cases: GoldenCase[] };

type Answers = Record<string, unknown>;

/** The five sets of answers for a definition, in their fixed order. */
export function answerSets(definition: ResolvedNoteType): { name: GoldenCaseName; answers: Answers }[] {
  const model = definitionModel(definition);
  const reading = new NoteReading(definition, {});
  // pathOf leaves the entry out of a section that does not repeat.
  const pathOf = (leaf: Leaf) => reading.pathOf(leaf, GOLDEN_ENTRY.id);
  const withNormal = (answers: Answers) => {
    for (const section of model.sections)
      Object.assign(answers, normalAnswers(definition, section.section.id, answers, entryOf(section)));
    return answers;
  };

  const normal = withNormal(opened(model));

  const first = opened(model);
  for (const leaf of model.leaves.values()) {
    if (leaf.holds.type !== 'codes') continue;
    const option = leaf.holds.options[0];
    if (option) first[pathOf(leaf)] = leaf.holds.many ? [option.code] : option.code;
  }

  const opens = openers(model);
  const systems = opened(model);
  for (const leaf of model.leaves.values()) {
    if (!opens.has(leaf.key)) continue;
    const { holds } = leaf;
    if (holds.type === 'flag') systems[pathOf(leaf)] = true;
    else if (holds.type === 'codes' && holds.options[0])
      systems[pathOf(leaf)] = holds.many ? holdable(holds) : holds.options[0].code;
  }
  withNormal(systems);

  const every = opened(model);
  for (const leaf of model.leaves.values()) {
    const value = filled(leaf.holds);
    if (value !== undefined) every[pathOf(leaf)] = value;
  }
  withNormal(every);

  return [
    { name: 'blank', answers: {} },
    { name: 'normal', answers: sorted(normal) },
    { name: 'first', answers: sorted(first) },
    { name: 'systems', answers: sorted(systems) },
    { name: 'every', answers: sorted(every) },
  ];
}

/** Every section opened: a repeating one gets GOLDEN_ENTRY. */
function opened(model: PathModel): Answers {
  const answers: Answers = {};
  for (const section of model.sections)
    if (section.section.repeat) answers[`${section.section.id}.${GOLDEN_ENTRY.id}.entryAt`] = GOLDEN_ENTRY.at;
  return answers;
}

const entryOf = (section: SectionNode) => (section.section.repeat ? GOLDEN_ENTRY.id : undefined);

/**
 * The answers that open something: each a condition names, read from where it is written (one in
 * a grid's cell starting ./ names a row's answer and is left), and each a grid picks its rows in.
 */
function openers(model: PathModel): Set<string> {
  const keys = new Set<string>();
  const read = (condition: Condition | undefined, carrier: FieldNode | SectionNode) => {
    if (!condition) return;
    if ('all' in condition) condition.all.forEach((c) => read(c, carrier));
    else if ('any' in condition) condition.any.forEach((c) => read(c, carrier));
    else if ('not' in condition) read(condition.not, carrier);
    else {
      const named = leafAt(model, condition.field, carrier, null);
      if ('leaf' in named) keys.add(named.leaf.key);
    }
  };
  for (const section of model.sections) read(section.section.showWhen, section);
  for (const node of model.nodes) {
    read(node.field.showWhen, node);
    if (node.picked) keys.add(node.picked.key);
  }
  return keys;
}

/** Every option a choose-many can hold together: no exclusive one, and of a pair it may not hold, the first. */
function holdable(holds: Extract<Holds, { type: 'codes' }>): string[] {
  let codes = holds.options.filter((o) => !o.exclusive).map((o) => o.code);
  for (const [one, other] of holds.excludes)
    if (codes.includes(one) && codes.includes(other)) codes = codes.filter((code) => code !== other);
  return codes.length > 0 || holds.options.length === 0 ? codes : [holds.options[0]!.code];
}

/** What `every` puts at a leaf. */
function filled(holds: Holds): unknown {
  switch (holds.type) {
    case 'codes':
      if (holds.many) return holdable(holds);
      return holds.options.at(-1)?.code;
    case 'flag':
      return true;
    case 'text':
      return FILLED.text.slice(0, holds.maxLength);
    case 'number':
      return holds.min;
    default:
      return FILLED[holds.type];
  }
}

const sorted = (answers: Answers): Answers =>
  Object.fromEntries(Object.entries(answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const hashOf = (value: unknown) => sha256Hex(canonicalJson(value));

/** The note types a quick definition's mapsTo name, in code-unit order. */
function mapsToKeys(definition: ResolvedNoteType): string[] {
  const keys = new Set<string>();
  for (const node of definitionModel(definition).nodes) {
    const { mapsTo } = node.field;
    if (mapsTo !== undefined) keys.add(mapsTo.slice(0, mapsTo.indexOf(':')));
  }
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** What the interpreter says about each preset, in the presets' order. */
export async function goldenOf(presets: readonly Preset[]): Promise<Golden[]> {
  // What a mapsTo names: the newest version of the note type (forms.md 6.4).
  const newest = new Map<string, Preset>();
  for (const preset of presets)
    if ((newest.get(preset.key)?.version ?? 0) < preset.version) newest.set(preset.key, preset);

  const golden: Golden[] = [];
  for (const { key, version, hash, definition } of presets) {
    const targets = mapsToKeys(definition).flatMap((target) => {
      const full = newest.get(target);
      return full ? [full] : [];
    });
    const cases: GoldenCase[] = [];
    for (const { name, answers } of answerSets(definition)) {
      const visibleHashes = {} as Record<GoldenReader, string>;
      for (const [who, reader] of Object.entries(GOLDEN_READERS) as [GoldenReader, NoteReader][])
        visibleHashes[who] = await hashOf(visibleAnswers(definition, answers, reader));
      const expansions: GoldenExpansion[] = targets.map((full) => {
        const entries = Object.fromEntries(
          full.definition.sections.filter((s) => s.repeat).map((s) => [s.id, GOLDEN_NEW_ENTRY]),
        );
        const expansion = expandQuick(definition, answers, full.definition, entries);
        return { key: full.key, version: full.version, ...expansion };
      });
      cases.push({
        name,
        answers,
        finishCheck: finishCheck(definition, answers),
        recapLines: recapLines(definition, answers),
        handoffLines: handoffLines([definition], [answers], GOLDEN_SENSITIVE_CODES),
        effectiveKeys: Object.keys(effectiveAnswers(definition, answers)),
        readModelHash: await hashOf(readModel(definition, answers, [])),
        visibleHashes,
        // services/api/src/encounters/content-hash.ts's noteContent, which the API's test of it
        // holds to this; the phone's golden test calls its own noteContentHash.
        contentHash: await hashOf({
          v: 1,
          ...GOLDEN_NOTE,
          noteTypeKey: definition.key,
          noteTypeVersion: definition.version,
          answers: effectiveAnswers(definition, answers),
        }),
        expansions,
      });
    }
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
  options.print(`Wrote ${GOLDEN_FILE}: ${golden.length} note type version(s), 5 cases each.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.exitCode = await main(process.argv.slice(2), { root, print: (line) => console.log(line) });
}
