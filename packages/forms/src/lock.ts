/**
 * The lock (docs/design/phase-4/forms.md, 2.1 and 4.2): definitions.lock.json holds a hash of every
 * released note type version, module version and list. Once a file is in it, its content never
 * changes again: a note is read against the version it was written on for as long as it exists,
 * and the server refuses a version whose hash differs from the one it already stores (3.1).
 *
 * It holds two more things a released definition depends on:
 *  - the files of every piece a released definition names (`spec/<piece>.txt`, `.shape.json`,
 *    `.diff.json`): the checks read them against the definition, which can no longer be mended;
 *  - for each released note type version, the hash of its resolved definition (canonical JSON and
 *    SHA-256, as the server computes it), at `<the version's file>#resolved`: a change to the
 *    resolver, or to what a resolved definition carries, would change what the server refuses
 *    while every file stays the same.
 *
 * A file is released by adding its line to the lock. A file with no line is a draft and may change.
 *
 * Pure, like the resolver: the export reads the lock file and hands its parsed content over. The
 * definition files must have passed the schema check (checkFile): this check reads their sections
 * and fields without looking.
 */
import { canonicalJson, sha256Hex } from './canonical.ts';
import { listFile, moduleFile, resolve, SURFACE_LIST } from './resolve.ts';
import type { DefinitionFiles, FileProblem } from './resolve.ts';
import { pieceDiff, pieceShape, pieceText, sectionsByPiece } from './spec-check.ts';
import type { Pieces } from './spec-check.ts';
import type { Field, Include, Module, NoteType, Section } from './types.ts';

/** The lock file, beside definitions/. Problems in the lock itself name it. */
export const LOCK_FILE = 'definitions.lock.json';

/** The path of each released file under definitions/, and the hash of its content. */
export type Lock = Readonly<Record<string, string>>;

/** The lock's line for the resolved definition of a note type version file. */
export const resolvedEntry = (file: string): string => `${file}#resolved`;

// The three kinds of file of 2.1, each at the only path the resolver looks it up by; a piece's
// three files; and the resolved definition of a note type version.
const RELEASABLE =
  /^(?:(?:(?:note-types|modules)\/[a-z][a-z0-9_]{1,60}\/v[1-9][0-9]*|lists\/[a-z][a-z0-9_]{1,60})\.json|spec\/[a-z0-9][a-z0-9-]{0,60}\.(?:txt|shape\.json|diff\.json)|note-types\/[a-z][a-z0-9_]{1,60}\/v[1-9][0-9]*\.json#resolved)$/;
const HASH = /^[0-9a-f]{64}$/;

// Of the content, not of the bytes: a file reformatted, or written with its keys in another order,
// is the same file to everything that reads it. A piece's lines are text, and are hashed as such.
const hashOf = (file: unknown): Promise<string> =>
  sha256Hex(typeof file === 'string' ? file : canonicalJson(file));

/** Every file of the tree that the lock can hold, by its lock line, with what is hashed. */
function everyFile(files: DefinitionFiles, pieces: Pieces): Record<string, unknown> {
  const all: Record<string, unknown> = { ...files.noteTypes, ...files.modules, ...files.lists };
  for (const [name, piece] of Object.entries(pieces)) {
    if (piece.text !== undefined) all[pieceText(name)] = piece.text;
    if (piece.shape !== undefined) all[pieceShape(name)] = piece.shape;
    if (piece.diff !== undefined) all[pieceDiff(name)] = piece.diff;
  }
  for (const file of Object.keys(files.noteTypes)) {
    const resolved = resolve(file, files);
    if (resolved.ok) all[resolvedEntry(file)] = resolved.definition;
  }
  return all;
}

/** The lock that releases every file of the tree as it stands, with the pieces its files name. */
export async function lockOf(files: DefinitionFiles, pieces: Pieces = {}): Promise<Record<string, string>> {
  const lock: Record<string, string> = {};
  for (const [file, content] of Object.entries(everyFile(files, pieces))) lock[file] = await hashOf(content);
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
 * `lock` is the parsed lock file, not yet trusted; `pieces` the files of definitions/spec. The rules:
 *  - `lock.bad_file`, `lock.bad_entry`: the lock is not a map from a releasable file to a hash
 *  - `lock.changed`: a released file whose content changed, or a released note type version whose
 *    resolved definition changed (named at the version's file)
 *  - `lock.missing`: a released file that is no longer there
 *  - `lock.unreleased_part`: a released file that includes a module version, names a list or a
 *    piece, that is not released; or a released note type version whose resolved hash is not held.
 *    Its resolved content, or what it is checked against, could then still change under it.
 */
export async function checkLock(
  lock: unknown,
  files: DefinitionFiles,
  pieces: Pieces = {},
): Promise<FileProblem[]> {
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
  const present = everyFile(files, pieces);
  const released = new Set<string>();
  /** The released files that changed or went: a resolved definition made from one is told by it. */
  const broken = new Set<string>();
  const resolvedChanges: { file: string; message: string }[] = [];
  for (const [entry, hash] of Object.entries(lock)) {
    if (!RELEASABLE.test(entry) || typeof hash !== 'string' || !HASH.test(hash)) {
      problems.push({
        file: LOCK_FILE,
        path: `$[${JSON.stringify(entry)}]`,
        rule: 'lock.bad_entry',
        message: RELEASABLE.test(entry)
          ? 'must be the SHA-256 of the file, as 64 lower-case hex digits'
          : 'is not the path of a note type version, a module version, a list or a piece’s file',
      });
      continue;
    }
    released.add(entry);
    const resolvedOf = entry.endsWith('#resolved') ? entry.slice(0, -'#resolved'.length) : null;
    const file = resolvedOf ?? entry;
    const content = Object.hasOwn(present, entry) ? present[entry] : undefined;
    if (resolvedOf !== null) {
      // Gone with its file (reported as missing), or no longer resolving (the resolver says why).
      if (content !== undefined && (await hashOf(content)) !== hash)
        resolvedChanges.push({
          file,
          message:
            'was released, and its resolved definition has changed though none of its files has: the server would refuse it. Did the resolver, or what a resolved definition carries, change?',
        });
    } else if (content === undefined) {
      broken.add(entry);
      problems.push({
        file,
        path: '$',
        rule: 'lock.missing',
        message: 'was released and is no longer there: notes written on it could not be read',
      });
    } else if ((await hashOf(content)) !== hash) {
      broken.add(entry);
      problems.push({
        file,
        path: '$',
        rule: 'lock.changed',
        message: 'was released and has changed: a released file is never edited, a change is a new version',
      });
    }
  }
  for (const { file, message } of resolvedChanges) {
    // One that no longer resolves is the resolver's to report, with the reason.
    const resolved = resolve(file, files);
    if (!resolved.ok) continue;
    if (!resolved.origins.some((origin) => broken.has(origin.file)))
      problems.push({ file, path: '$', rule: 'lock.changed', message });
  }

  for (const [file, content] of [...Object.entries(files.noteTypes), ...Object.entries(files.modules)]) {
    if (!released.has(file)) continue;
    const parts = [...partsOf(content), ...piecesOf(content, pieces)];
    for (const part of parts)
      if (!released.has(part.file))
        problems.push({
          file,
          path: part.path,
          rule: 'lock.unreleased_part',
          message: `is released, and ${part.file}, which it is made of or checked against, is not: release both together`,
        });
    if ('key' in content && !released.has(resolvedEntry(file)) && Object.hasOwn(present, resolvedEntry(file)))
      problems.push({
        file,
        path: '$',
        rule: 'lock.unreleased_part',
        message: `is released, and the hash of its resolved definition is not: add ${resolvedEntry(file)} with it`,
      });
  }
  return problems;
}

/** The files of each piece a file's sections name, where it names them. */
function piecesOf(file: NoteType | Module, pieces: Pieces): Part[] {
  const parts: Part[] = [];
  for (const [name, sections] of sectionsByPiece(file)) {
    const piece = Object.hasOwn(pieces, name) ? pieces[name]! : {};
    const path = `${sections[0]!.at}.spec`;
    if (piece.text !== undefined) parts.push({ file: pieceText(name), path });
    if (piece.shape !== undefined) parts.push({ file: pieceShape(name), path });
    if (piece.diff !== undefined) parts.push({ file: pieceDiff(name), path });
  }
  return parts;
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
