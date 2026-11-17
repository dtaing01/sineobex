/**
 * The export (docs/design/phase-4/forms.md, 2.1, 4.1 and 4.2): reads definitions/ from disk, runs
 * every check over it, and writes generated/presets.json and the phone's copy of it. Run as
 * `pnpm forms:export`; `--release` also releases the tree (below).
 *
 * The checks are the package's own (src/); this file reads the files, calls them in the order
 * their headers ask for, and prints what they find. The order:
 *  1. Every file is read and placed by its path, and each definition file is held to the schema
 *     (checkFile). Any problem here stops the run: every later check reads files that passed it,
 *     without looking again.
 *  2. Each note type version is resolved and validated, against the newest version of every other
 *     note type (for mapsTo, suggests and open_note_type); then the lock, the version rules, the
 *     spec check and the shape check run over the whole tree.
 * A module included by two note types, or a list named in five places, is checked each time and
 * reported once (same file, place and rule).
 *
 * Nothing is written while any problem stands: the generated files only ever hold definitions that
 * passed every check, which is all the server, the database and the phone trust.
 *
 * Release (`--release`, card F6-release): a released file can never change again, so nothing is
 * released that nothing checks or uses. A piece no definition names, and a list or module no note
 * type uses, is refused (`export.unused_file`); then definitions.lock.json is written over every
 * file present. Without `--release` those are notes, and the lock is never written.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from '../src/canonical.ts';
import { checkLock, LOCK_FILE, lockOf, lockText } from '../src/lock.ts';
import { pathModel } from '../src/paths.ts';
import { resolve } from '../src/resolve.ts';
import type { DefinitionFiles, FileProblem, Origin, ResolvedNoteType } from '../src/resolve.ts';
import { checkFile } from '../src/schema.ts';
import type { FileKind } from '../src/schema.ts';
import { checkShapes } from '../src/shape-check.ts';
import { checkSpec, pieceDiff, pieceShape, pieceText, readPieces, unnamedPieces } from '../src/spec-check.ts';
import type { Pieces } from '../src/spec-check.ts';
import type { Module, NoteType, OptionList } from '../src/types.ts';
import { validate } from '../src/validate.ts';
import { checkVersions } from '../src/versions.ts';

/** Where the export writes the presets, under the package folder. */
export const PRESETS_FILE = 'generated/presets.json';

/** One note type version as the server installs it (3.2) and the phone bundles it (3.4). */
export type Preset = { key: string; version: number; hash: string; definition: ResolvedNoteType };

/** Something worth knowing that fails nothing. */
export type Note = { file: string; message: string };

export type ExportOptions = {
  /** The package folder: definitions/ and the lock are read from it, generated/ is written in it. */
  root: string;
  /** Where the phone's copy of the presets goes: apps/mobile/assets/forms/presets.json. */
  phoneAsset: string;
  release?: boolean;
};

export type ExportResult = {
  /** Every problem, each once. Nothing was written when there is one. */
  problems: FileProblem[];
  notes: Note[];
  /** The presets, in their fixed order; empty when there are problems. */
  presets: Preset[];
  /** For each note type version file, the most answers a note on it can hold (2.4). */
  answers: Record<string, number>;
};

// The places of 2.1, as the resolver looks each kind up and the lock holds it.
const KINDS: { kind: FileKind; path: RegExp }[] = [
  { kind: 'noteType', path: /^note-types\/[a-z][a-z0-9_]{1,60}\/v[1-9][0-9]*\.json$/ },
  { kind: 'module', path: /^modules\/[a-z][a-z0-9_]{1,60}\/v[1-9][0-9]*\.json$/ },
  { kind: 'list', path: /^lists\/[a-z][a-z0-9_]{1,60}\.json$/ },
];

type Tree = { files: DefinitionFiles; pieces: Pieces; lock: unknown };

/** Runs every check over the tree under `root` and, when nothing fails, writes what it makes. */
export async function exportDefinitions(options: ExportOptions): Promise<ExportResult> {
  const release = options.release === true;
  const problems = new Problems();
  const notes: Note[] = [];
  const answers: Record<string, number> = {};
  const failed = (): ExportResult => ({ problems: problems.all(), notes, presets: [], answers });

  const tree = readTree(options.root, problems);
  if (!tree) return failed();
  const { files, pieces } = tree;

  // Each version resolved once; the validator, the presets and the notes all read these.
  const resolutions = new Map<string, { definition: ResolvedNoteType; origins: Origin[] }>();
  for (const file of Object.keys(files.noteTypes)) {
    const resolved = resolve(file, files);
    if (resolved.ok) resolutions.set(file, resolved);
    else problems.add(resolved.problems);
  }
  const newest = new Map<string, ResolvedNoteType>();
  for (const { definition } of resolutions.values()) {
    const known = newest.get(definition.key);
    if (!known || known.version < definition.version) newest.set(definition.key, definition);
  }
  for (const [file, { definition, origins }] of resolutions) {
    problems.add(validate(definition, { origins, noteType: (key) => newest.get(key) }));
    answers[file] = mostAnswers(definition);
  }
  problems.add(await checkLock(tree.lock, files, pieces));
  problems.add(checkVersions(files));
  problems.add(checkSpec(pieces, files));
  problems.add(checkShapes(pieces, files));

  // What nothing uses yet. Known only when every note type resolved: one that did not would use
  // files nobody can tell, and the resolver's problem fails the run already.
  const unused: Note[] = [];
  for (const piece of unnamedPieces(pieces, files))
    unused.push({ file: pieceFileOf(piece, pieces), message: 'is a piece no definition names yet' });
  if (resolutions.size === Object.keys(files.noteTypes).length) {
    const used = new Set([...resolutions.values()].flatMap(({ origins }) => origins.map((o) => o.file)));
    for (const file of [...Object.keys(files.modules), ...Object.keys(files.lists)])
      if (!used.has(file)) unused.push({ file, message: 'is used by no note type yet' });
  }
  if (release)
    problems.add(
      unused.map(({ file, message }) => ({
        file,
        path: '$',
        rule: 'export.unused_file',
        message: `${message}: a released file can never change, so nothing is released that nothing checks or uses`,
      })),
    );
  else notes.push(...unused);
  for (const [file, count] of Object.entries(answers))
    notes.push({ file, message: `a note on it can hold at most ${count} answers` });

  if (problems.size > 0) return failed();

  const presets: Preset[] = [];
  for (const { definition } of resolutions.values())
    presets.push({
      key: definition.key,
      version: definition.version,
      hash: await sha256Hex(canonicalJson(definition)),
      definition,
    });
  presets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.version - b.version));
  const text = `${JSON.stringify(presets, null, 2)}\n`;
  for (const path of [join(options.root, PRESETS_FILE), options.phoneAsset]) writeText(path, text);
  if (release) writeText(join(options.root, LOCK_FILE), lockText(await lockOf(files, pieces)));
  return { problems: [], notes, presets, answers };
}

/**
 * The most answers a note on this definition can hold: every path, and each repeating section at
 * its `repeat.max`, each entry with its `entryAt` and `entryRemoved` (2.3). Printed, never refused
 * (2.4): whoever sets the server's MAX_NOTE_FIELDS sees how near a form comes to it.
 */
function mostAnswers(definition: ResolvedNoteType): number {
  const model = pathModel(definition);
  let count = 0;
  for (const leaf of model.leaves.values()) count += leaf.node.section.section.repeat?.max ?? 1;
  for (const { section } of model.sections) if (section.repeat) count += 2 * section.repeat.max;
  return count;
}

/** A piece is named by its text, or by whichever of its files there is. */
function pieceFileOf(name: string, pieces: Pieces): string {
  const piece = pieces[name]!;
  if (piece.text !== undefined) return pieceText(name);
  return piece.shape !== undefined ? pieceShape(name) : pieceDiff(name);
}

/** The files of definitions/ and the lock, parsed and placed; null when any is not fit to check. */
function readTree(root: string, problems: Problems): Tree | null {
  const folder = join(root, 'definitions');
  const files = { noteTypes: {}, modules: {}, lists: {} } as {
    noteTypes: Record<string, NoteType>;
    modules: Record<string, Module>;
    lists: Record<string, OptionList>;
  };
  const byKind = { noteType: files.noteTypes, module: files.modules, list: files.lists };
  const specTexts: Record<string, string> = {};
  const paths = readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => statSync(join(folder, path)).isFile())
    .sort();
  for (const file of paths) {
    const text = readFileSync(join(folder, file), 'utf8');
    if (file.startsWith('spec/')) {
      specTexts[file] = text;
      continue;
    }
    const kind = KINDS.find(({ path }) => path.test(file))?.kind;
    if (!kind) {
      problems.add([
        {
          file,
          path: '$',
          rule: 'export.unknown_file',
          message:
            'is not where a note type version, a module version or a shared list lives (note-types/<key>/v<N>.json, modules/<name>/v<N>.json, lists/<name>.json), so nothing would read it',
        },
      ]);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      problems.add([{ file, path: '$', rule: 'export.bad_json', message: 'is not JSON: it does not parse' }]);
      continue;
    }
    const found = checkFile(kind, parsed);
    if (found.length > 0) problems.add(found.map((problem) => ({ file, ...problem })));
    else (byKind[kind] as Record<string, unknown>)[file] = parsed;
  }
  const { pieces, problems: pieceProblems } = readPieces(specTexts);
  problems.add(pieceProblems);
  if (problems.size > 0) return null;

  let lock: unknown = {};
  const lockPath = join(root, LOCK_FILE);
  let lockText: string | null = null;
  try {
    lockText = readFileSync(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (lockText !== null)
    try {
      lock = JSON.parse(lockText);
    } catch {
      // checkLock says what a lock must be.
      lock = null;
    }
  return { files, pieces, lock };
}

function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The problems found so far, each once: a fault in a shared file is found by every note type using it. */
class Problems {
  private readonly found = new Map<string, FileProblem>();

  add(problems: readonly FileProblem[]) {
    for (const problem of problems) {
      const key = `${problem.file}\u0000${problem.path}\u0000${problem.rule}`;
      if (!this.found.has(key)) this.found.set(key, problem);
    }
  }

  get size(): number {
    return this.found.size;
  }

  all(): FileProblem[] {
    return [...this.found.values()];
  }
}

/** The command: prints the notes, then each problem, and gives the exit code. */
export async function main(
  args: readonly string[],
  options: Omit<ExportOptions, 'release'> & { print: (line: string) => void },
): Promise<number> {
  const unknown = args.filter((arg) => arg !== '--release');
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown.join(' ')}; the only one is --release`);
  const release = args.includes('--release');
  const { print } = options;
  const result = await exportDefinitions({ root: options.root, phoneAsset: options.phoneAsset, release });
  for (const { file, message } of result.notes) print(`note  ${file}  ${message}`);
  for (const { file, path, rule, message } of result.problems) print(`${file}  ${path}  ${rule}  ${message}`);
  if (result.problems.length > 0) {
    print(`${result.problems.length} problem(s); nothing was written.`);
    return 1;
  }
  print(
    `Wrote ${PRESETS_FILE} and the phone's copy: ${result.presets.length} note type version(s)${release ? ', and released the tree in ' + LOCK_FILE : ''}.`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const phoneAsset = fileURLToPath(
    new URL('../../../apps/mobile/assets/forms/presets.json', import.meta.url),
  );
  process.exitCode = await main(process.argv.slice(2), {
    root,
    phoneAsset,
    print: (line) => console.log(line),
  });
}
