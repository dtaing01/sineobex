import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DefinitionFiles } from '../../src/resolve.ts';

const rootOf = (tree: string) => fileURLToPath(new URL(`./${tree}/`, import.meta.url));

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** The files as a test may change them: plain JSON, so a test can break a file in ways the types forbid. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above */
export type LooseFiles = { [K in keyof DefinitionFiles]: Record<string, any> };

/**
 * The small made-up tree under fixtures/definitions, laid out as packages/forms/definitions is:
 * every file by its path under that folder. A fresh copy each time, so a test can change one thing.
 * `tree` names another such folder: `example` is the worked example of the transcription recipe.
 */
export function definitionFiles(tree = 'definitions'): LooseFiles {
  const root = rootOf(tree);
  const files: Mutable<LooseFiles> = { noteTypes: {}, modules: {}, lists: {} };
  const folders = { 'note-types': files.noteTypes, modules: files.modules, lists: files.lists };
  for (const path of readdirSync(root, { recursive: true, encoding: 'utf8' }).sort()) {
    const file = path.replaceAll('\\', '/');
    if (!file.endsWith('.json') || file.startsWith('spec/')) continue;
    const folder = folders[file.split('/')[0] as keyof typeof folders];
    folder[file] = JSON.parse(readFileSync(`${root}${path}`, 'utf8'));
  }
  return files;
}

/** The files of a tree's spec folder as the export reads them: each one's text, by its path under the tree. */
export function specTexts(tree: string): Record<string, string> {
  const root = rootOf(tree);
  const texts: Record<string, string> = {};
  for (const name of readdirSync(`${root}spec`).sort())
    texts[`spec/${name}`] = readFileSync(`${root}spec/${name}`, 'utf8');
  return texts;
}
