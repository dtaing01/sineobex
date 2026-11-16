/**
 * The version rules (docs/design/phase-4/forms.md, 2.6). A note keeps the version it was written
 * on, so a new version may add, remove or reword anything. What it may never do is reuse a path or
 * an option code for another meaning: reports and supply mappings read paths and codes across
 * every version of a note type.
 *
 * Each version is compared with all the versions before it, not only the last: a path dropped in
 * version 2 still has version 1's meaning when version 3 brings it back.
 *
 * Pure, and loaded by the API: nothing here may import a package.
 */
import { locate, noteTypeFile, resolve } from './resolve.ts';
import type { DefinitionFiles, FileProblem, Origin, ResolvedNoteType } from './resolve.ts';
import { pathsOf } from './paths.ts';
import type { StoredPath } from './paths.ts';

/**
 * An option reworded on purpose: at `path`, the option `code` had the label `from` and now has
 * `to`. `path` is where the answer is stored, the entry's part of a repeating section left out;
 * for a row of a grid it is the grid's own path, and for an option in a cell the path of each row.
 */
export type Rename = { path: string; code: string; from: string; to: string };

/**
 * The renames each version declares, by the version's file under definitions/. Handed over beside
 * the files: 2.6 speaks of a version's declared `renames` list, and the definition format of 2.2
 * has no key for one yet.
 */
export type Renames = Readonly<Record<string, readonly Rename[]>>;

/**
 * Every version of every note type among the files against the versions before it. Empty when no
 * path and no code changed its meaning. The rules:
 *  - `versions.kind_changed`: a path that held one kind of answer and now holds another
 *  - `versions.unit_changed`: a number whose unit is another one
 *  - `versions.label_changed`: an option code whose label changed, with no rename declared
 *  - `versions.rename_unused`: a declared rename that covers no change
 * A version that does not resolve is skipped: the resolver says why.
 */
export function checkVersions(files: DefinitionFiles, renames: Renames = {}): FileProblem[] {
  const problems: FileProblem[] = [];
  const byKey = new Map<string, { file: string; definition: ResolvedNoteType; origins: Origin[] }[]>();
  for (const file of Object.keys(files.noteTypes)) {
    const resolved = resolve(file, files);
    if (!resolved.ok) continue;
    const { key } = resolved.definition;
    byKey.set(key, [...(byKey.get(key) ?? []), { file, ...resolved }]);
  }
  const compared = new Set<string>();
  for (const versions of byKey.values()) {
    versions.sort((a, b) => a.definition.version - b.definition.version);
    const earlier: ResolvedNoteType[] = [];
    for (const { file, definition, origins } of versions) {
      compared.add(file);
      problems.push(...versionProblems(earlier, definition, { origins, renames: renames[file] }));
      earlier.push(definition);
    }
  }
  // A rename for a file that was never compared covers nothing either.
  for (const [file, declared] of Object.entries(renames))
    if (!compared.has(file)) declared.forEach((_, index) => problems.push(unused(file, index)));
  return problems;
}

const unused = (file: string, index: number): FileProblem => ({
  file,
  path: `$.renames[${index}]`,
  rule: 'versions.rename_unused',
  message: 'covers no change: no option at that path and code went from the one label to the other',
});

/**
 * One version against the versions before it, oldest first. Without `origins` a place is a place
 * in the resolved definition, in the file a note type of that key and version would have.
 */
export function versionProblems(
  earlier: readonly ResolvedNoteType[],
  next: ResolvedNoteType,
  context: { origins?: readonly Origin[]; renames?: readonly Rename[] } = {},
): FileProblem[] {
  // What each path and each code last meant, and in which version.
  const paths = new Map<string, StoredPath & { version: number }>();
  const units = new Map<string, { unit: string; version: number }>();
  const labels = new Map<string, { label: string; version: number }>();
  for (const definition of earlier) {
    const { version } = definition;
    for (const stored of pathsOf(definition)) {
      paths.set(stored.path, { ...stored, version });
      if (stored.unit !== undefined) units.set(stored.path, { unit: stored.unit, version });
      for (const option of stored.options ?? [])
        labels.set(codeKey(stored.path, option.code), { label: option.label, version });
    }
  }

  const file = noteTypeFile(next.key, next.version);
  const origins = context.origins ?? [{ at: '$', file, path: '$' }];
  const renames = context.renames ?? [];
  const used = new Set<number>();
  // A cell is written once and stored once for each row: its fault is found for each and reported once.
  const problems = new Map<string, FileProblem>();
  const report = (at: string, rule: string, message: string) => {
    const place = locate(origins, at);
    const key = `${place.file}  ${place.path}  ${rule}`;
    if (!problems.has(key)) problems.set(key, { ...place, rule: `versions.${rule}`, message });
  };

  for (const stored of pathsOf(next)) {
    const before = paths.get(stored.path);
    if (before && before.holds !== stored.holds)
      report(
        stored.at,
        'kind_changed',
        `stores ${stored.holds} at ${stored.path}, which held ${before.holds} in version ${before.version}: a path is never used again for another kind of answer`,
      );
    const unit = units.get(stored.path);
    if (unit && stored.unit !== undefined && unit.unit !== stored.unit)
      report(
        stored.at,
        'unit_changed',
        `stores ${stored.path} in "${stored.unit}", and version ${unit.version} stored it in "${unit.unit}": the numbers of both would be read as one`,
      );
    (stored.options ?? []).forEach((option, index) => {
      const was = labels.get(codeKey(stored.path, option.code));
      if (!was || was.label === option.label) return;
      const rename = renames.findIndex(
        (r) =>
          r.path === stored.path && r.code === option.code && r.from === was.label && r.to === option.label,
      );
      if (rename >= 0) used.add(rename);
      else
        report(
          `${stored.optionsAt}[${index}].label`,
          'label_changed',
          `the code "${option.code}" at ${stored.path} was "${was.label}" in version ${was.version}: a code is never used again for another meaning, and a rewording is declared as a rename`,
        );
    });
  }
  const found = [...problems.values()];
  renames.forEach((_, index) => {
    if (!used.has(index)) found.push(unused(file, index));
  });
  return found;
}

// A path cannot hold a space, so the two parts stay apart.
const codeKey = (path: string, code: string): string => `${path} ${code}`;
