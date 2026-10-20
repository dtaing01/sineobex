import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/** Shapes in the generated spec that clients would read wrong. */
describe('openapi.json', () => {
  it('never makes a reference nullable through allOf (null could never match)', async () => {
    const spec = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8')) as unknown;
    const bad: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (node === null || typeof node !== 'object') return;
      const all = (node as { allOf?: unknown }).allOf;
      if (
        Array.isArray(all) &&
        all.some((m) => {
          const type = (m as { type?: unknown } | null)?.type;
          return type === 'null' || (Array.isArray(type) && type.includes('null'));
        })
      ) {
        bad.push(path);
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`);
    };
    walk(spec, '');
    // Use z.union([Schema, z.null()]) instead of Schema.nullable() for registered schemas.
    expect(bad).toEqual([]);
  });
});
