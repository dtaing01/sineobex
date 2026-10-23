/**
 * Generates the phone's Dart API client from the OpenAPI document.
 *
 * Deliberately small: it supports exactly the schema shapes the API's Zod definitions produce
 * (objects, arrays, string enums and literals, date-time strings, numbers, booleans, maps,
 * nullable values, and free-form JSON). Anything else is a generator error, not a silent `dynamic`,
 * so a new kind of schema forces a decision here.
 */

export interface SchemaObject {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  additionalProperties?: boolean | SchemaObject;
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  allOf?: SchemaObject[];
  nullable?: boolean;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: SchemaObject;
  description?: string;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: SchemaObject }>; required?: boolean };
  responses?: Record<string, { content?: Record<string, { schema?: SchemaObject }>; description?: string }>;
}

export interface OpenApiDocument {
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, SchemaObject> };
}

interface DartType {
  type: string;
  decode: (expr: string) => string;
  encode: (expr: string) => string;
}

const DART_RESERVED = new Set(
  'abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for function get hide if implements import in interface is late library mixin new null of on operator part required rethrow return sealed set show static super switch sync this throw true try type typedef var void when while with yield values index hashCode runtimeType toString noSuchMethod'.split(
    ' ',
  ),
);

export function pascal(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
}

export function camel(s: string): string {
  const p = pascal(s);
  let name = p.length > 0 ? p[0]!.toLowerCase() + p.slice(1) : 'value';
  if (/^[0-9]/.test(name)) name = `v${name}`;
  if (DART_RESERVED.has(name)) name = `${name}Value`;
  return name;
}

function enumMemberName(wire: string): string {
  const cleaned = wire.replace(/\+/g, ' plus ').replace(/</g, ' lt ').replace(/>/g, ' gt ');
  const name = camel(cleaned) || 'empty';
  // Every enum ends with an `unknown('')` fallback, so a wire value that is itself "unknown" (an
  // allergy's severity) takes the suffix reserved words get.
  return name === 'unknown' ? 'unknownValue' : name;
}

function dartString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/\n/g, '\\n')}'`;
}

class Generator {
  private readonly classes = new Map<string, string>();
  private readonly enums = new Map<string, string>();
  private readonly componentKinds = new Map<string, 'class' | 'enum' | 'alias'>();
  private readonly aliases = new Map<string, DartType>();

  constructor(private readonly doc: OpenApiDocument) {}

  run(): string {
    const schemas = this.doc.components?.schemas ?? {};
    for (const [name, schema] of Object.entries(schemas)) {
      this.componentKinds.set(name, this.isEnum(schema) ? 'enum' : this.isObject(schema) ? 'class' : 'alias');
    }
    for (const [name, schema] of Object.entries(schemas)) {
      const kind = this.componentKinds.get(name);
      if (kind === 'enum') this.emitEnum(pascal(name), schema);
      else if (kind === 'class') this.emitClass(pascal(name), schema);
      else this.aliases.set(name, this.resolve(schema, pascal(name)));
    }
    const client = this.emitClient();
    const parts = [
      '// GENERATED FILE. Do not edit by hand.',
      `// Source: packages/contract/openapi.json (${this.doc.info.title} ${this.doc.info.version}).`,
      '// Regenerate with `pnpm contract:generate`; CI fails if this file is out of date.',
      '// ignore_for_file: type=lint, unused_element',
      '',
      "import 'transport.dart';",
      '',
      ...[...this.enums.keys()].sort().map((k) => this.enums.get(k)!),
      ...[...this.classes.keys()].sort().map((k) => this.classes.get(k)!),
      client,
    ];
    return `${parts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()}\n`;
  }

  private isNull(s: SchemaObject): boolean {
    return s.type === 'null';
  }

  private isEnum(s: SchemaObject): boolean {
    return Array.isArray(s.enum) && s.enum.every((v) => typeof v === 'string') && s.enum.length > 1;
  }

  private isObject(s: SchemaObject): boolean {
    return (s.type === 'object' || s.properties !== undefined) && s.properties !== undefined;
  }

  /** Splits `T | null` into T plus a nullable flag. */
  private unwrapNullable(s: SchemaObject): { schema: SchemaObject; nullable: boolean } {
    if (Array.isArray(s.type) && s.type.includes('null')) {
      const rest = s.type.filter((t) => t !== 'null');
      return { schema: { ...s, type: rest.length === 1 ? rest[0] : rest }, nullable: true };
    }
    const union = s.anyOf ?? s.oneOf;
    if (union && union.some((u) => this.isNull(u))) {
      const rest = union.filter((u) => !this.isNull(u));
      if (rest.length === 1) return { schema: rest[0]!, nullable: true };
      return { schema: { ...s, anyOf: rest, oneOf: undefined }, nullable: true };
    }
    if (s.nullable) return { schema: { ...s, nullable: false }, nullable: true };
    return { schema: s, nullable: false };
  }

  resolve(raw: SchemaObject, contextName: string): DartType {
    const { schema, nullable } = this.unwrapNullable(raw);
    const base = this.resolveNonNull(schema, contextName);
    if (!nullable || base.type === 'Object?') return base;
    return {
      type: `${base.type}?`,
      decode: (e) => `${e} == null ? null : ${base.decode(e)}`,
      encode: (e) => `${e} == null ? null : ${base.encode(`${e}!`)}`,
    };
  }

  private resolveNonNull(s: SchemaObject, contextName: string): DartType {
    if (s.$ref) {
      const name = s.$ref.replace('#/components/schemas/', '');
      const kind = this.componentKinds.get(name);
      if (!kind) throw new Error(`Unresolved $ref ${s.$ref}`);
      if (kind === 'alias') {
        const alias = this.aliases.get(name);
        if (alias) return alias;
        return this.resolve(this.doc.components!.schemas![name]!, pascal(name));
      }
      const dart = pascal(name);
      if (kind === 'enum') {
        return {
          type: dart,
          decode: (e) => `${dart}.fromJson(${e} as String)`,
          encode: (e) => `${e}.toJson()`,
        };
      }
      return {
        type: dart,
        decode: (e) => `${dart}.fromJson(${e} as Map<String, dynamic>)`,
        encode: (e) => `${e}.toJson()`,
      };
    }
    if (s.allOf && s.allOf.length === 1) return this.resolve(s.allOf[0]!, contextName);
    if (s.allOf && s.allOf.length > 1) {
      // `Base.extend({...})` in Zod: merge the object parts into one class.
      const merged = this.mergeAllOf(s.allOf);
      if (merged) return this.resolveNonNull(merged, contextName);
    }
    if (s.anyOf || s.oneOf || s.allOf) {
      // Unions are kept as raw JSON; the API avoids them in request and response bodies.
      return { type: 'Object?', decode: (e) => e, encode: (e) => e };
    }
    if (this.isEnum(s)) {
      this.emitEnum(contextName, s);
      return {
        type: contextName,
        decode: (e) => `${contextName}.fromJson(${e} as String)`,
        encode: (e) => `${e}.toJson()`,
      };
    }
    const type = Array.isArray(s.type) ? undefined : s.type;
    if (s.const !== undefined || (Array.isArray(s.enum) && s.enum.length === 1)) {
      const value = s.const ?? s.enum![0];
      if (typeof value === 'string') return this.primitive('String');
      if (typeof value === 'boolean') return this.primitive('bool');
      if (typeof value === 'number') return Number.isInteger(value) ? this.int() : this.double();
    }
    switch (type) {
      case 'string':
        if (s.format === 'date-time') {
          return {
            type: 'DateTime',
            decode: (e) => `DateTime.parse(${e} as String)`,
            encode: (e) => `${e}.toUtc().toIso8601String()`,
          };
        }
        return this.primitive('String');
      case 'integer':
        return this.int();
      case 'number':
        return this.double();
      case 'boolean':
        return this.primitive('bool');
      case 'array': {
        if (!s.items) throw new Error(`Array without items in ${contextName}`);
        const item = this.resolve(s.items, `${contextName}Item`);
        return {
          type: `List<${item.type}>`,
          decode: (e) => `(${e} as List<dynamic>).map((e) => ${item.decode('e')}).toList()`,
          encode: (e) => `${e}.map((e) => ${item.encode('e')}).toList()`,
        };
      }
      case 'object':
      case undefined: {
        if (s.properties) {
          this.emitClass(contextName, s);
          return {
            type: contextName,
            decode: (e) => `${contextName}.fromJson(${e} as Map<String, dynamic>)`,
            encode: (e) => `${e}.toJson()`,
          };
        }
        if (typeof s.additionalProperties === 'object' && Object.keys(s.additionalProperties).length > 0) {
          const value = this.resolve(s.additionalProperties, `${contextName}Value`);
          return {
            type: `Map<String, ${value.type}>`,
            decode: (e) => `(${e} as Map<String, dynamic>).map((k, v) => MapEntry(k, ${value.decode('v')}))`,
            encode: (e) => `${e}.map((k, v) => MapEntry(k, ${value.encode('v')}))`,
          };
        }
        if (type === 'object') {
          return {
            type: 'Map<String, Object?>',
            decode: (e) => `Map<String, Object?>.from(${e} as Map)`,
            encode: (e) => e,
          };
        }
        // `{}`: any JSON value.
        return { type: 'Object?', decode: (e) => e, encode: (e) => e };
      }
      default:
        throw new Error(`Unsupported schema type ${JSON.stringify(s.type)} in ${contextName}`);
    }
  }

  private mergeAllOf(parts: SchemaObject[]): SchemaObject | null {
    const properties: Record<string, SchemaObject> = {};
    const required = new Set<string>();
    for (const part of parts) {
      let schema = part;
      if (part.$ref) {
        const name = part.$ref.replace('#/components/schemas/', '');
        schema = this.doc.components?.schemas?.[name] ?? {};
      }
      if (!schema.properties) return null;
      Object.assign(properties, schema.properties);
      for (const r of schema.required ?? []) required.add(r);
    }
    return { type: 'object', properties, required: [...required] };
  }

  private primitive(t: 'String' | 'bool'): DartType {
    return { type: t, decode: (e) => `${e} as ${t}`, encode: (e) => e };
  }
  private int(): DartType {
    return { type: 'int', decode: (e) => `(${e} as num).toInt()`, encode: (e) => e };
  }
  private double(): DartType {
    return { type: 'double', decode: (e) => `(${e} as num).toDouble()`, encode: (e) => e };
  }

  private emitEnum(name: string, s: SchemaObject): void {
    if (this.enums.has(name)) return;
    const values = s.enum as string[];
    const members = values.map((v) => `  ${enumMemberName(v)}(${dartString(v)})`);
    const lines = [
      ...(s.description ? [`/// ${s.description.replace(/\n/g, ' ')}`] : []),
      `enum ${name} {`,
      `${members.join(',\n')},`,
      '',
      '  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.',
      "  unknown('');",
      '',
      `  const ${name}(this.wire);`,
      '  final String wire;',
      '',
      `  static ${name} fromJson(String value) =>`,
      `      ${name}.values.firstWhere((e) => e.wire == value, orElse: () => ${name}.unknown);`,
      '',
      '  String toJson() => wire;',
      '}',
      '',
    ];
    this.enums.set(name, lines.join('\n'));
  }

  private emitClass(name: string, s: SchemaObject): void {
    if (this.classes.has(name)) return;
    this.classes.set(name, ''); // reserve, so self-references terminate
    const required = new Set(s.required ?? []);
    const fields = Object.entries(s.properties ?? {}).map(([wire, prop]) => {
      const dartName = camel(wire);
      const resolved = this.resolve(prop, `${name}${pascal(wire)}`);
      const isRequired = required.has(wire);
      const alreadyNullable = resolved.type.endsWith('?');
      const type = isRequired || alreadyNullable ? resolved.type : `${resolved.type}?`;
      const decode =
        isRequired || alreadyNullable
          ? resolved.decode
          : (e: string) => `${e} == null ? null : ${resolved.decode(e)}`;
      // Optional fields are left out of the JSON when null, so the server sees "not sent", not "cleared".
      // An untyped field (`{}`) is the exception: null is one of its values (a sync change that
      // clears a field), so it is always sent.
      const untyped = resolved.type === 'Object?';
      const optional = !isRequired && !untyped;
      const encode = alreadyNullable
        ? resolved.encode
        : (e: string) => resolved.encode(optional ? `${e}!` : e);
      return { wire, dartName, type, isRequired, optional, decode, encode, description: prop.description };
    });

    const lines: string[] = [];
    if (s.description) lines.push(`/// ${s.description.replace(/\n/g, ' ')}`);
    lines.push(`class ${name} {`);
    if (fields.length === 0) {
      lines.push(`  const ${name}();`, '');
      lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) => const ${name}();`, '');
      lines.push('  Map<String, dynamic> toJson() => <String, dynamic>{};', '}', '');
      this.classes.set(name, lines.join('\n'));
      return;
    }
    lines.push(`  const ${name}({`);
    for (const f of fields) {
      const needsValue = f.isRequired;
      lines.push(`    ${needsValue ? 'required ' : ''}this.${f.dartName},`);
    }
    lines.push('  });', '');
    for (const f of fields) {
      if (f.description) lines.push(`  /// ${f.description.replace(/\n/g, ' ')}`);
      lines.push(`  final ${f.type} ${f.dartName};`);
    }
    lines.push('');
    lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) => ${name}(`);
    for (const f of fields) lines.push(`        ${f.dartName}: ${f.decode(`json[${dartString(f.wire)}]`)},`);
    lines.push('      );', '');
    lines.push('  Map<String, dynamic> toJson() => <String, dynamic>{');
    for (const f of fields) {
      if (f.optional) {
        lines.push(`        if (${f.dartName} != null) ${dartString(f.wire)}: ${f.encode(f.dartName)},`);
      } else {
        lines.push(`        ${dartString(f.wire)}: ${f.encode(f.dartName)},`);
      }
    }
    lines.push('      };', '}', '');
    this.classes.set(name, lines.join('\n'));
  }

  private emitClient(): string {
    const methods: string[] = [];
    const ops: { path: string; method: string; op: Operation }[] = [];
    for (const [path, item] of Object.entries(this.doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        ops.push({ path, method, op });
      }
    }
    ops.sort((a, b) => (a.op.operationId ?? '').localeCompare(b.op.operationId ?? ''));

    for (const { path, method, op } of ops) {
      if (!op.operationId) throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
      const name = camel(op.operationId);
      const typeBase = pascal(op.operationId);
      const params: string[] = [];
      const pathParams = (op.parameters ?? []).filter((p) => p.in === 'path');
      const queryParams = (op.parameters ?? []).filter((p) => p.in === 'query');
      for (const p of pathParams) params.push(`required String ${camel(p.name)}`);
      const body = op.requestBody?.content?.['application/json']?.schema;
      let bodyType: DartType | undefined;
      if (body) {
        bodyType = this.resolve(body, `${typeBase}Request`);
        params.push(`${op.requestBody?.required === false ? '' : 'required '}${bodyType.type} body`);
      }
      const queryTypes = queryParams.map((p) => ({
        p,
        t: this.resolve(p.schema ?? { type: 'string' }, `${typeBase}${pascal(p.name)}`),
      }));
      for (const { p, t } of queryTypes) {
        params.push(
          p.required
            ? `required ${t.type} ${camel(p.name)}`
            : `${t.type.replace(/\?$/, '')}? ${camel(p.name)}`,
        );
      }

      const success = Object.entries(op.responses ?? {}).find(([code]) => /^2\d\d$/.test(code));
      const responseSchema = success?.[1].content?.['application/json']?.schema;
      const resultType = responseSchema ? this.resolve(responseSchema, `${typeBase}Response`) : undefined;

      const dartPath = path.replace(/\{([^}]+)\}/g, (_, p: string) => `\${Uri.encodeComponent(${camel(p)})}`);
      const doc = op.summary ? [`  /// ${op.summary.replace(/\n/g, ' ')}`] : [];
      const sig = params.length > 0 ? `{${params.join(', ')}}` : '';
      const query =
        queryTypes.length > 0
          ? `query: <String, String>{${queryTypes
              .map(({ p, t }) => {
                // Inside `if (v != null)` Dart promotes the parameter, so no `!` is needed.
                const v = camel(p.name);
                return `if (${v} != null) ${dartString(p.name)}: (${t.encode(v)}).toString()`;
              })
              .join(', ')}}, `
          : '';
      const bodyArg = bodyType ? `body: ${bodyType.encode('body')}` : '';
      const call = `_transport.send(${dartString(method.toUpperCase())}, '${dartPath}'${query || bodyArg ? `, ${query}${bodyArg}` : ''})`;
      methods.push(...doc);
      if (resultType) {
        methods.push(`  Future<${resultType.type}> ${name}(${sig}) async {`);
        methods.push(`    final json = await ${call};`);
        methods.push(`    return ${resultType.decode('json')};`);
      } else {
        methods.push(`  Future<void> ${name}(${sig}) async {`);
        methods.push(`    await ${call};`);
      }
      methods.push('  }', '');
    }
    if (methods.at(-1) === '') methods.pop();

    return [
      '/// Typed client for every operation in the API contract.',
      'class SineobexApi {',
      '  SineobexApi(this._transport);',
      '',
      '  final ApiTransport _transport;',
      '',
      ...methods,
      '}',
      '',
    ].join('\n');
  }
}

export function generateDart(doc: OpenApiDocument): string {
  return new Generator(doc).run();
}
