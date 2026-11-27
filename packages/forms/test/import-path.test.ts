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

/**
 * What would load or run code the bundle does not hold, or that the edge runtime lacks, written any
 * way at all: a dynamic import (a template literal included), require, a Node global, and code
 * built from a string. Comments are left out, so a word in one is no hit.
 */
const FORBIDDEN: [name: string, pattern: RegExp][] = [
  ['import(', /\bimport\s*\(/],
  ['require(', /\brequire\s*\(/],
  ['Buffer', /\bBuffer\b/],
  ['process', /\bprocess\b/],
  ['Function(', /\bFunction\s*\(/],
];

function forbidden(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT), ...source.matchAll(DYNAMIC)].map((m) => m[1]!);
}

async function reachable(entry: string): Promise<{ files: string[]; outside: string[]; uses: string[] }> {
  const files = new Set<string>();
  const outside = new Set<string>();
  const uses = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    // A data file is a leaf: it is in the bundle, and it imports nothing.
    if (file.endsWith('.json')) continue;
    const source = await readFile(file, 'utf8');
    for (const name of forbidden(source)) uses.add(`${relative(root, file)} uses ${name}`);
    for (const spec of specifiers(source)) {
      const target = resolve(dirname(file), spec);
      if (!spec.startsWith('.') || relative(root, target).startsWith('..'))
        outside.add(`${relative(root, file)} imports ${spec}`);
      else queue.push(target);
    }
  }
  return {
    files: [...files].map((f) => relative(root, f)).sort(),
    outside: [...outside].sort(),
    uses: [...uses].sort(),
  };
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

  it('finds a dynamic import, require, a Node global and code built from a string, outside comments', () => {
    expect(forbidden('export const lazy = () => import(`ajv`);')).toEqual(['import(']);
    expect(forbidden("const m = require('ajv');")).toEqual(['require(']);
    expect(forbidden('const n = Buffer.byteLength(s);')).toEqual(['Buffer']);
    expect(forbidden('if (process.env.X) f();')).toEqual(['process']);
    expect(forbidden("const g = new Function('return 1');")).toEqual(['Function(']);
    expect(forbidden("// import('x'), Buffer, process\n/* require('y') */\nconst a = 1;")).toEqual([]);
    expect(forbidden("const url = 'https://example.org'; const b = Buffer;")).toEqual(['Buffer']);
  });

  it('is this package’s own source only, without the schema check', async () => {
    const { files, outside, uses } = await reachable(resolve(root, 'src/index.ts'));
    expect(outside).toEqual([]);
    expect(uses).toEqual([]);
    expect(files).toContain('src/paths.ts');
    expect(files).toContain('src/canonical.ts');
    expect(files).not.toContain('src/schema.ts');
  });
});
