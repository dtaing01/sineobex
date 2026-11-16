/**
 * The first check of a definition file (design 4.2): its shape, against
 * schema/definition.schema.json. A misspelt key, a missing label, a wrong type.
 *
 * This file loads the JSON Schema library, which builds its validators with `new Function` and so
 * cannot run in the API's edge bundle. It is its own entry, '@sineobex/forms/schema', for the
 * export script and the tests; src/index.ts never reaches it.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import schema from '../schema/definition.schema.json' with { type: 'json' };
import type { Problem } from './types.ts';

/** The three kinds of file under definitions/, named as the schema's `$defs` name them. */
export type FileKind = 'noteType' | 'module' | 'list';
export const FILE_KINDS: readonly FileKind[] = ['noteType', 'module', 'list'];

// Strict: a keyword the library does not know, or one that cannot apply to its type, is an error in
// the schema itself and stops the first check instead of being skipped in silence. Not
// strictRequired: an `if` that asks whether a key is there names a key it does not define.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
ajv.addSchema(schema, 'definition');

const validators = new Map<FileKind, ValidateFunction>();

function validatorFor(kind: FileKind): ValidateFunction {
  let validate = validators.get(kind);
  if (!validate) {
    validate = ajv.compile({ $ref: `definition#/$defs/${kind}` });
    validators.set(kind, validate);
  }
  return validate;
}

/**
 * Every place where a parsed file of this kind departs from the schema. Empty when it fits.
 * `path` is where in the file (`$` is the file itself, then `.key` and `[index]`); `rule` is
 * `schema.` and the kind of fault; `message` says what is wrong there.
 */
export function checkFile(kind: FileKind, file: unknown): Problem[] {
  const validate = validatorFor(kind);
  if (validate(file)) return [];
  const errors = validate.errors ?? [];
  // What is not an object has no form to be wrong about: "must be an object" says it all.
  const notObjects = new Set(errors.filter((e) => e.keyword === 'type').map((e) => e.instancePath));
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    if (error.keyword === 'oneOf' && notObjects.has(error.instancePath)) continue;
    const problem = problemOf(error, file);
    if (!problem) continue;
    const key = `${problem.path}\n${problem.rule}\n${problem.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(problem);
  }
  return problems;
}

function problemOf(error: ErrorObject, file: unknown): Problem | null {
  // Says only that a branch failed; what failed in the branch is reported on its own.
  if (error.keyword === 'if') return null;
  // A condition's five forms are the branches of a oneOf. A condition that is none of them fails
  // every branch; the one oneOf error says so, and the ten from the branches say nothing more.
  if (error.schemaPath.includes('/oneOf/')) return null;

  const steps = pointerSteps(error.instancePath);
  const path = pathOf(steps, file);
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'additionalProperties': {
      const key = String(params.additionalProperty);
      return {
        path: `${path}${keyStep(key)}`,
        rule: 'schema.unknown_key',
        message: `${ownerOf(valueAt(steps, file))} has no key "${key}"`,
      };
    }
    case 'false schema':
      return {
        path,
        rule: 'schema.unknown_key',
        message: `${ownerOf(valueAt(steps.slice(0, -1), file))} cannot carry "${steps.at(-1)}" with its other keys as they are`,
      };
    case 'required':
      return {
        path,
        rule: 'schema.missing_key',
        message: `${ownerOf(valueAt(steps, file))} needs "${String(params.missingProperty)}"`,
      };
    case 'type':
      return { path, rule: 'schema.wrong_type', message: `must be ${typeNames(params.type)}` };
    case 'enum': {
      const allowed = (params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ');
      // Only a field has a key named `kind`.
      return steps.at(-1) === 'kind'
        ? { path, rule: 'schema.unknown_kind', message: `is not a kind of field; the kinds are ${allowed}` }
        : { path, rule: 'schema.not_allowed', message: `must be one of ${allowed}` };
    }
    case 'const':
      return {
        path,
        rule: 'schema.not_allowed',
        message: `can only be ${JSON.stringify(params.allowedValue)}; leave the key out otherwise`,
      };
    case 'pattern':
      return { path, rule: 'schema.bad_format', message: `must match ${String(params.pattern)}` };
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return {
        path,
        rule: 'schema.limit',
        message: `must be ${String(params.comparison)} ${String(params.limit)}`,
      };
    case 'minLength':
    case 'maxLength':
      return { path, rule: 'schema.limit', message: countMessage(error.keyword, params.limit, 'character') };
    case 'minItems':
    case 'maxItems':
      return { path, rule: 'schema.limit', message: countMessage(error.keyword, params.limit, 'item') };
    case 'minProperties':
    case 'maxProperties':
      return { path, rule: 'schema.limit', message: countMessage(error.keyword, params.limit, 'key') };
    case 'uniqueItems':
      return {
        path,
        rule: 'schema.duplicate',
        message: `items ${String(params.j)} and ${String(params.i)} are the same`,
      };
    case 'oneOf':
      return {
        path,
        rule: 'schema.bad_condition',
        message:
          'must be exactly one of { field, is }, { field, filled }, { all }, { any } and { not }, with no other key',
      };
    default:
      // A keyword the schema gains later still reports, under its own name.
      return { path, rule: `schema.${error.keyword}`, message: error.message ?? 'does not fit the schema' };
  }
}

function pointerSteps(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((step) => step.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function valueAt(steps: string[], file: unknown): unknown {
  let value = file;
  for (const step of steps) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[step];
  }
  return value;
}

const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const keyStep = (key: string): string => (PLAIN_KEY.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`);

function pathOf(steps: string[], file: unknown): string {
  let path = '$';
  let value = file;
  for (const step of steps) {
    path += Array.isArray(value) ? `[${step}]` : keyStep(step);
    value =
      value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[step] : undefined;
  }
  return path;
}

/** "a text field", where the value says what it is; "this" where it does not. */
function ownerOf(value: unknown): string {
  const kind = value !== null && typeof value === 'object' ? (value as { kind?: unknown }).kind : undefined;
  return typeof kind === 'string' ? `a field of kind "${kind}"` : 'this';
}

function typeNames(type: unknown): string {
  const names = (Array.isArray(type) ? type : [type]).map((t) =>
    t === 'integer'
      ? 'a whole number'
      : t === 'array'
        ? 'a list'
        : `${/^[aeio]/.test(String(t)) ? 'an' : 'a'} ${String(t)}`,
  );
  return names.join(' or ');
}

function countMessage(keyword: string, limit: unknown, unit: string): string {
  const n = Number(limit);
  const units = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return keyword.startsWith('min') ? `must have at least ${units}` : `must have at most ${units}`;
}
