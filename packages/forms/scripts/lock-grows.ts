/**
 * The lock only grows (docs/design/phase-4/forms.md, 4.2): a released file can never change again,
 * and the export holds every file to the lock it finds. A lock deleted or emptied would release
 * nothing, and every check would pass (review EXP-2), so this compares the lock with the one at a
 * base commit: every line there must still be here, with the same hash. Run in the drift step as
 * `pnpm --filter @sineobex/forms lock-grows <base>`, the base being the commit the change is made
 * on (the pull request's base, or the commit before a push).
 *
 * New lines are what a release is; nothing else about the lock is this check's business: the
 * export's lock check says what a lock must hold.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_FILE } from '../src/lock.ts';
import type { FileProblem } from '../src/resolve.ts';

/**
 * Every line of the base lock the head lock lost or changed. Each argument is a lock file's text,
 * or null when there is no file; a lock that is not an object of strings is a problem the export
 * reports, and here holds no line.
 */
export function lockShrinks(base: string | null, head: string | null): FileProblem[] {
  const before = lines(base);
  const after = lines(head);
  const problems: FileProblem[] = [];
  for (const [file, hash] of Object.entries(before)) {
    if (!Object.hasOwn(after, file))
      problems.push({
        file: LOCK_FILE,
        path: `$[${JSON.stringify(file)}]`,
        rule: 'lock.removed',
        message: `no longer holds ${file}, released at the base: a released file can never change, so its line stays`,
      });
    else if (after[file] !== hash)
      problems.push({
        file: LOCK_FILE,
        path: `$[${JSON.stringify(file)}]`,
        rule: 'lock.rehashed',
        message: `holds another hash for ${file} than the base does (${hash}): a released file can never change, so its line stays as it was`,
      });
  }
  return problems;
}

function lines(text: string | null): Record<string, string> {
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** The lock file's text at a commit, or null when the commit holds none. */
function lockAt(root: string, base: string): string | null {
  try {
    return execFileSync('git', ['show', `${base}:./${LOCK_FILE}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // The base has no lock: nothing was released there. Any other failure (a base that is not a
    // commit, git missing) is thrown: a check that cannot look must not pass.
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    if (/does not exist in|exists on disk, but not in/.test(stderr)) return null;
    throw error;
  }
}

function lockHere(root: string): string | null {
  try {
    return readFileSync(join(root, LOCK_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The command: prints each line lost or changed, and gives the exit code. */
export function main(
  args: readonly string[],
  options: { root: string; print: (line: string) => void },
): number {
  if (args.length !== 1 || args[0] === '')
    throw new Error('give the base commit to compare the lock with, and nothing else');
  const base = args[0]!;
  const problems = lockShrinks(lockAt(options.root, base), lockHere(options.root));
  for (const { file, path, rule, message } of problems)
    options.print(`${file}  ${path}  ${rule}  ${message}`);
  if (problems.length > 0) {
    options.print(`${problems.length} released line(s) lost or changed since ${base}.`);
    return 1;
  }
  options.print(`The lock holds every line it held at ${base}.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.exitCode = main(process.argv.slice(2), { root, print: (line) => console.log(line) });
}
