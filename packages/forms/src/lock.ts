/**
 * The lock (docs/design/phase-4/forms.md, 2.1 and 4.2): definitions.lock.json holds a hash of every
 * released note type version, module version and list. Once a file is in it, its content never
 * changes again: a note is read against the version it was written on for as long as it exists,
 * and the server refuses a version whose hash differs from the one it already stores (3.1).
 *
 * A file is released by adding its line to the lock. A file with no line is a draft and may change.
 *
 * Pure, like the resolver: the export reads the lock file and hands its parsed content over.
 */
import { canonicalJson, sha256Hex } from './canonical.ts';
import { listFile, moduleFile, SURFACE_LIST } from './resolve.ts';
import type { DefinitionFiles, FileProblem } from './resolve.ts';
import type { Field, Include, Module, NoteType, Section } from './types.ts';

/** The lock file, beside definitions/. Problems in the lock itself name it. */
export const LOCK_FILE = 'definitions.lock.json';

/** The path of each released file under definitions/, and the hash of its content. */
export type Lock = Readonly<Record<string, string>>;

// The three kinds of file of 2.1, each at the only path the resolver looks it up by.
const RELEASABLE =
  /^(?:(?:note-types|modules)\/[a-z][a-z0-9_]{1,60}\/v[1-9][0-9]*|lists\/[a-z][a-z0-9_]{1,60})\.json$/;
const HASH = /^[0-9a-f]{64}$/;

// Of the content, not of the bytes: a file reformatted, or written with its keys in another order,
// is the same file to everything that reads it.
const hashOf = (file: unknown): Promise<string> => sha256Hex(canonicalJson(file));

const everyFile = (files: DefinitionFiles): Record<string, unknown> => ({
  ...files.noteTypes,
  ...files.modules,
  ...files.lists,
});

/** The lock that releases every file of the tree as it stands. */
export async function lockOf(files: DefinitionFiles): Promise<Record<string, string>> {
  const lock: Record<string, string> = {};
  for (const [file, content] of Object.entries(everyFile(files))) lock[file] = await hashOf(content);
  return lock;
}

/** The lock as the file holds it: sorted, one file to a line, so a release is a diff of added lines. */
export function lockText(lock: Lock): string {
  const sorted = Object.keys(lock)
    .sort()
    .map((file) => [file, lock[file]]);
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

/**
 * Every way the tree breaks the lock; empty when every released file is as it was released.
 * `lock` is the parsed lock file, not yet trusted. The rules:
 *  - `lock.bad_file`, `lock.bad_entry`: the lock is not a map from a releasable file to a hash
 *  - `lock.changed`: a released file whose content changed
 *  - `lock.missing`: a released file that is no longer there
 *  - `lock.unreleased_part`: a released file that includes a module version, or names a list, that
 *    is not released. Its resolved content could then still change under it.
 */
export async function checkLock(lock: unknown, files: DefinitionFiles): Promise<FileProblem[]> {
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock))
    return [
      {
        file: LOCK_FILE,
        path: '$',
        rule: 'lock.bad_file',
        message: 'must be an object: each released file under definitions/ and its hash',
      },
    ];
  const problems: FileProblem[] = [];
  const present = everyFile(files);
  const released = new Set<string>();
  for (const [file, hash] of Object.entries(lock)) {
    if (!RELEASABLE.test(file) || typeof hash !== 'string' || !HASH.test(hash)) {
      problems.push({
        file: LOCK_FILE,
        path: `$[${JSON.stringify(file)}]`,
        rule: 'lock.bad_entry',
        message: RELEASABLE.test(file)
          ? 'must be the SHA-256 of the file, as 64 lower-case hex digits'
          : 'is not the path of a note type version, a module version or a list',
      });
      continue;
    }
    released.add(file);
    const content = present[file];
    if (content === undefined)
      problems.push({
        file,
        path: '$',
        rule: 'lock.missing',
        message: 'was released and is no longer there: notes written on it could not be read',
      });
    else if ((await hashOf(content)) !== hash)
      problems.push({
        file,
        path: '$',
        rule: 'lock.changed',
        message: 'was released and has changed: a released file is never edited, a change is a new version',
      });
  }

  for (const [file, content] of [...Object.entries(files.noteTypes), ...Object.entries(files.modules)]) {
    if (!released.has(file)) continue;
    for (const part of partsOf(content))
      if (!released.has(part.file))
        problems.push({
          file,
          path: part.path,
          rule: 'lock.unreleased_part',
          message: `is released, and ${part.file}, which is copied into it, is not: release both together`,
        });
  }
  return problems;
}

type Part = { file: string; path: string };

/** The module versions a file includes and the lists it names, each where the file names it. */
function partsOf(file: NoteType | Module): Part[] {
  const parts: Part[] = [];
  file.sections.forEach((section: Section | Include, index) => {
    const path = `$.sections[${index}]`;
    if ('include' in section) parts.push({ file: moduleFile(section.include, section.version), path });
    else section.fields.forEach((field, i) => listsOf(field, `${path}.fields[${i}]`, parts));
  });
  return parts;
}

function listsOf(field: Field, path: string, parts: Part[]) {
  const named = (options: unknown, key: string) => {
    if (options && typeof options === 'object' && 'list' in options)
      parts.push({ file: listFile(String(options.list)), path: `${path}.${key}.list` });
  };
  switch (field.kind) {
    case 'choice':
      return named(field.options, 'options');
    case 'region':
      if (field.side) parts.push({ file: listFile(field.side), path: `${path}.side` });
      if (field.surface) parts.push({ file: listFile(SURFACE_LIST), path: `${path}.surface` });
      return named(field.options, 'options');
    case 'group':
      return field.fields.forEach((child, i) => listsOf(child, `${path}.fields[${i}]`, parts));
    case 'grid':
      named(field.rows, 'rows');
      return listsOf(field.cell, `${path}.cell`, parts);
    default:
  }
}
