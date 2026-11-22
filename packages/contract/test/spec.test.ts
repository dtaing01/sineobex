import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface Schema {
  $ref?: string;
  format?: string;
  enum?: unknown[];
  pattern?: string;
}
interface Operation {
  operationId?: string;
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
  // A note type's key and version name a form, never a patient (forms 3.3). They are the only path
  // parameters that are not IDs, and only with exactly these patterns.
  const FORM_PATH_PATTERNS: Record<string, Record<string, string>> = {
    '/v1/forms/note-types/{key}/{version}': { key: '^[a-z][a-z0-9_]{1,60}$', version: '^[1-9][0-9]{0,8}$' },
  };
  // A preset's kind names a kind of team setting, never a patient (phase 5 design 7). It is let
  // through only on the admin preset paths, and only as the enum of exactly these kinds: a kind a
  // later phase adds (phase 10's billing_code_map) joins this list on purpose.
  const PRESET_KIND_PATHS = [
    '/v1/admin/presets/{kind}',
    '/v1/admin/presets/{kind}/{id}',
    '/v1/admin/presets/{kind}/{id}/archive',
    '/v1/admin/presets/{kind}/{id}/restore',
    '/v1/admin/presets/{kind}/{id}/take-update',
    '/v1/admin/presets/{kind}/{id}/history',
  ];
  const PRESET_KINDS = [
    'bag',
    'bundle',
    'condition_supply_map',
    'field_supply_map',
    'flag',
    'item',
    'order_category',
    'settings',
  ];
  const isPresetKind = (path: string, name: string, s: Schema) =>
    name === 'kind' &&
    PRESET_KIND_PATHS.includes(path) &&
    Array.isArray(s.enum) &&
    JSON.stringify([...s.enum].sort()) === JSON.stringify(PRESET_KINDS);
  // The reader's time zone names a place, never a patient: the handoff prints its times in it
  // (lifecycle 5.7). Only on that route's query, and only with exactly the API's pattern.
  const QUERY_PATTERNS: Record<string, Record<string, string>> = {
    '/v1/encounters/{encounterId}/ems-handoff': {
      timeZone: '^[A-Za-z][A-Za-z0-9_+-]{0,40}(\\/[A-Za-z0-9_+-]{1,40}){0,2}$',
    },
  };

  it('takes no name, birth date or search text outside a POST body', async () => {
    const spec = await loadSpec();
    const bad: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        for (const p of op.parameters ?? []) {
          const s = p.schema ?? {};
          const uuid = s.format === 'uuid';
          const query =
            uuid ||
            Array.isArray(s.enum) ||
            ALLOWED_PATTERNS.includes(s.pattern ?? '') ||
            (s.pattern !== undefined && QUERY_PATTERNS[path]?.[p.name] === s.pattern);
          const formPart = s.pattern !== undefined && FORM_PATH_PATTERNS[path]?.[p.name] === s.pattern;
          const ok =
            p.in === 'path' ? uuid || formPart || isPresetKind(path, p.name, s) : p.in === 'query' && query;
          if (!ok) bad.push(`${method.toUpperCase()} ${path} ${p.in} ${p.name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('takes a preset’s kind on exactly the admin preset paths, as the enum of the kinds', async () => {
    // The list names only paths that take a kind, so no later route takes the exception unasked.
    const spec = await loadSpec();
    const taken = new Set<string>();
    for (const [path, item] of Object.entries(spec.paths))
      for (const op of Object.values(item))
        for (const p of op.parameters ?? [])
          if (p.in === 'path' && isPresetKind(path, p.name, p.schema ?? {})) taken.add(path);
    expect([...taken].sort()).toEqual([...PRESET_KIND_PATHS].sort());
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

  it('defines every phase 5 preset route, under the name its clients call', async () => {
    // The phone's client names each method after its operation ID (scripts/dart.ts), so renaming
    // one renames what the phone calls.
    const spec = await loadSpec();
    const routes: [string, string, string][] = [
      ['get', '/v1/presets', 'pullPresets'],
      ['get', '/v1/admin/presets/{kind}', 'listPresets'],
      ['post', '/v1/admin/presets/{kind}', 'createPreset'],
      ['put', '/v1/admin/presets/{kind}/{id}', 'editPreset'],
      ['post', '/v1/admin/presets/{kind}/{id}/archive', 'archivePreset'],
      ['post', '/v1/admin/presets/{kind}/{id}/restore', 'restorePreset'],
      ['post', '/v1/admin/presets/{kind}/{id}/take-update', 'takePresetUpdate'],
      ['get', '/v1/admin/presets/{kind}/{id}/history', 'getPresetHistory'],
      ['post', '/v1/admin/preset-order/flag', 'reorderFlags'],
    ];
    for (const [method, path, operationId] of routes)
      expect(spec.paths[path]?.[method]?.operationId, `${method} ${path}`).toBe(operationId);
  });
});
