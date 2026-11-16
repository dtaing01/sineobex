import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DefinitionFiles } from '../../src/resolve.ts';

const root = fileURLToPath(new URL('./definitions/', import.meta.url));

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
/** The files as a test may change them: plain JSON, so a test can break a file in ways the types forbid. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above */
export type LooseFiles = { [K in keyof DefinitionFiles]: Record<string, any> };

/**
 * The small made-up tree under fixtures/definitions, laid out as packages/forms/definitions is:
 * every file by its path under that folder. A fresh copy each time, so a test can change one thing.
 */
export function definitionFiles(): LooseFiles {
  const files: Mutable<LooseFiles> = { noteTypes: {}, modules: {}, lists: {} };
  const folders = { 'note-types': files.noteTypes, modules: files.modules, lists: files.lists };
  for (const path of readdirSync(root, { recursive: true, encoding: 'utf8' }).sort()) {
    if (!path.endsWith('.json')) continue;
    const file = path.replaceAll('\\', '/');
    const folder = folders[file.split('/')[0] as keyof typeof folders];
    folder[file] = JSON.parse(readFileSync(`${root}${path}`, 'utf8'));
  }
  return files;
}
