import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The API imports '@sineobex/presets' and is bundled for an edge runtime, as it imports
// '@sineobex/forms'. Whatever src/index.ts reaches is in that bundle, so it may reach this
// package's own files and data, and two packages: the forms package's index, which forms' own
// import-path test holds to forms' own files, and zod, which the API's routes bundle already. No
// other npm package, no `node:` module, and never '@sineobex/forms/schema', which loads the JSON
// Schema library (it builds its validators with `new Function`). The walk is forms' own, with the
// two packages let through by their exact names.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the index may load from outside the package. A subpath is another entry, so it is not. */
const ALLOWED = new Set(['@sineobex/forms', 'zod']);

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

async function reachable(
  base: string,
  entry: string,
): Promise<{ files: string[]; outside: string[]; uses: string[] }> {
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
    for (const name of forbidden(source)) uses.add(`${relative(base, file)} uses ${name}`);
    for (const spec of specifiers(source)) {
      // Each allowed package's own tests hold what it reaches; this walk stops at its name.
      if (ALLOWED.has(spec)) continue;
      const target = resolve(dirname(file), spec);
      if (!spec.startsWith('.') || relative(base, target).startsWith('..'))
        outside.add(`${relative(base, file)} imports ${spec}`);
      else queue.push(target);
    }
  }
  return {
    files: [...files].map((f) => relative(base, f)).sort(),
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
          "import data from '../data/ten.json' with { type: 'json' };",
        ].join('\n'),
      ),
    ).toEqual([
      'one',
      './two.ts',
      './three.ts',
      './four.ts',
      './five.ts',
      './nine.ts',
      '../data/ten.json',
      'six',
    ]);
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

  it('lets the forms index and zod through by their exact names, and nothing else from outside', async () => {
    const base = await mkdtemp(join(tmpdir(), 'presets-import-path-'));
    try {
      const put = async (path: string, text: string) => {
        await mkdir(dirname(join(base, path)), { recursive: true });
        await writeFile(join(base, path), text);
      };
      await put(
        'src/index.ts',
        [
          "export * from './rules.ts';",
          "export { z } from 'zod';",
          "import { fieldAt } from '@sineobex/forms';",
          "export type { Body } from './types-only.ts';",
        ].join('\n'),
      );
      await put(
        'src/rules.ts',
        [
          "import platform from '../data/platform.json' with { type: 'json' };",
          "import { checkFile } from '@sineobex/forms/schema';",
          "import { mini } from 'zod/mini';",
          "import { readFile } from 'node:fs/promises';",
          "import Ajv from 'ajv';",
          "import { install } from './install.ts';",
          'export const fromEnv = process.env.X;',
        ].join('\n'),
      );
      await put('src/install.ts', "import { lockTeamWrites } from '../../api/src/sync/locks.ts';");
      await put('data/platform.json', '[]');
      expect(await reachable(base, join(base, 'src/index.ts'))).toEqual({
        files: ['data/platform.json', 'src/index.ts', 'src/install.ts', 'src/rules.ts'],
        outside: [
          'src/install.ts imports ../../api/src/sync/locks.ts',
          'src/rules.ts imports @sineobex/forms/schema',
          'src/rules.ts imports ajv',
          'src/rules.ts imports node:fs/promises',
          'src/rules.ts imports zod/mini',
        ],
        uses: ['src/rules.ts uses process'],
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('is this package’s own source and data, the forms index and zod only', async () => {
    const { files, outside, uses } = await reachable(root, resolve(root, 'src/index.ts'));
    expect(outside).toEqual([]);
    expect(uses).toEqual([]);
    expect(files).toContain('src/index.ts');
  });
});
