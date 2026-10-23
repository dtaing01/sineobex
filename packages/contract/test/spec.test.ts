import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface Schema {
  $ref?: string;
  format?: string;
  enum?: unknown[];
  pattern?: string;
}
interface Operation {
  parameters?: { in: string; name: string; schema?: Schema }[];
  responses?: Record<string, unknown>;
}
interface Spec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
}

const loadSpec = async () =>
  JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8')) as Spec;

/** Every schema component a node reaches, following $refs. */
function reachable(spec: Spec, node: unknown, seen = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => reachable(spec, n, seen));
  else if (node && typeof node === 'object') {
    const ref = (node as Schema).$ref;
    if (typeof ref === 'string') {
      const name = ref.replace('#/components/schemas/', '');
      if (!seen.has(name)) {
        seen.add(name);
        reachable(spec, spec.components.schemas[name], seen);
      }
    }
    for (const v of Object.values(node)) reachable(spec, v, seen);
  }
  return seen;
}

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

/** Patient details stay out of URLs and out of refusals (phase 3 design 3). */
describe('openapi.json, patient data in requests and refusals', () => {
  // Besides UUIDs and enums, a query string may carry a field name or a numeric history cursor.
  const ALLOWED_PATTERNS = ['^[a-z][a-zA-Z]{0,40}$', '^\\d{1,19}$'];

  it('takes no name, birth date or search text outside a POST body', async () => {
    const spec = await loadSpec();
    const bad: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        for (const p of op.parameters ?? []) {
          const s = p.schema ?? {};
          const uuid = s.format === 'uuid';
          const query = uuid || Array.isArray(s.enum) || ALLOWED_PATTERNS.includes(s.pattern ?? '');
          const ok = p.in === 'path' ? uuid : p.in === 'query' && query;
          if (!ok) bad.push(`${method.toUpperCase()} ${path} ${p.in} ${p.name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never carries a chart value, a summary or a token in a 409', async () => {
    // A 409 is thrown inside the transaction and rolls its audit event back, so it discloses
    // codes, IDs and versions only; the client re-reads through the audited GET.
    const spec = await loadSpec();
    const forbidden = ['FieldState', 'PatientSummary', 'PatientChart', 'IdLinkView'];
    const bad: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const conflict = op.responses?.['409'];
        if (!conflict) continue;
        const refs = reachable(spec, conflict);
        for (const f of forbidden) if (refs.has(f)) bad.push(`${method.toUpperCase()} ${path}: ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('defines every phase 3 route', async () => {
    const spec = await loadSpec();
    const routes: [string, string][] = [
      ['post', '/v1/patients/search'],
      ['post', '/v1/patients/match'],
      ['get', '/v1/patients/{patientId}'],
      ['post', '/v1/patients/charts'],
      ['post', '/v1/patients/index'],
      ['get', '/v1/patients/{patientId}/history'],
      ['post', '/v1/patients/{patientId}/corrections'],
      ['get', '/v1/patients/{patientId}/id-link'],
      ['post', '/v1/patients/{patientId}/id-link'],
      ['get', '/v1/team/field-reviews'],
      ['post', '/v1/team/field-reviews/{reviewId}/decision'],
      ['get', '/v1/team/problem-reversals'],
      ['post', '/v1/problems/{problemId}/reverse'],
      ['post', '/v1/team/problem-reversals/{problemId}/decline'],
      ['post', '/v1/problems/{problemId}/merge'],
      ['get', '/v1/team/duplicates'],
      ['post', '/v1/team/duplicates'],
      ['get', '/v1/team/duplicates/{pairId}'],
      ['post', '/v1/team/duplicates/{pairId}/decision'],
      ['get', '/v1/team/merges'],
      ['post', '/v1/team/merges/{mergeId}/undo'],
    ];
    for (const [method, path] of routes)
      expect(spec.paths[path]?.[method], `${method} ${path}`).toBeDefined();
  });
});
