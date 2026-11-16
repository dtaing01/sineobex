import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The API imports '@sineobex/forms' and is bundled for an edge runtime. Whatever src/index.ts
// reaches is in that bundle, so it may reach this package's own files only: no npm package (the
// JSON Schema library builds its validators with `new Function`), no `node:` module, and not
// src/schema.ts, which loads that library.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `import type` and `export type` statements are erased (verbatimModuleSyntax), so they load nothing.
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT), ...source.matchAll(DYNAMIC)].map((m) => m[1]!);
}

async function reachable(entry: string): Promise<{ files: string[]; outside: string[] }> {
  const files = new Set<string>();
  const outside = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    // A data file is a leaf: it is in the bundle, and it imports nothing.
    if (file.endsWith('.json')) continue;
    for (const spec of specifiers(await readFile(file, 'utf8'))) {
      const target = resolve(dirname(file), spec);
      if (!spec.startsWith('.') || relative(root, target).startsWith('..'))
        outside.add(`${relative(root, file)} imports ${spec}`);
      else queue.push(target);
    }
  }
  return { files: [...files].map((f) => relative(root, f)).sort(), outside: [...outside].sort() };
}

describe('what the package index loads', () => {
  it('reads every form of import that loads a module, and skips the type-only ones', () => {
    expect(
      specifiers(
        [
          "import a from 'one';",
          "import { b, type C } from './two.ts';",
          "import './three.ts';",
          "export { d } from './four.ts';",
          "export * from './five.ts';",
          "const e = await import('six');",
          "import type { F } from 'seven';",
          "export type { G } from './eight.ts';",
          'import {',
          '  h,',
          "} from './nine.ts';",
        ].join('\n'),
      ),
    ).toEqual(['one', './two.ts', './three.ts', './four.ts', './five.ts', './nine.ts', 'six']);
  });

  it('is this package’s own source only, without the schema check', async () => {
    const { files, outside } = await reachable(resolve(root, 'src/index.ts'));
    expect(outside).toEqual([]);
    expect(files).toContain('src/canonical.ts');
    expect(files).not.toContain('src/schema.ts');
  });
});
